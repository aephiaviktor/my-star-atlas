'use strict';

const CALCULATION_VERSION = 'upgrading-selection-utilization-estimated-v3';
const DATA_VERSION = 1;
const CURRENT_PRICE_WARNING = 'Indicative reconstruction — valued at current component prices';
const COMPONENT_SECONDS = Object.freeze({
  'power source': 15, framework: 12, electromagnet: 16, electronics: 14,
  'field stabilizer': 24, 'particle accelerator': 96, 'radiation absorber': 48,
  'survey data unit': 120, ink: 60,
});
const COMPONENT_LP = Object.freeze({
  'power source': 98, framework: 68, electromagnet: 133, electronics: 92,
  'field stabilizer': 222, 'particle accelerator': 498, 'radiation absorber': 331,
  'survey data unit': 1325, ink: 100000,
});
const hourMs = 3600000;

function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function componentKey(value) { return String(value || '').trim().toLowerCase(); }
function timestampMs(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== '') return numeric < 1e12 ? numeric * 1000 : numeric;
  return Date.parse(String(value || ''));
}
function quantile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction, low = Math.floor(index), high = Math.ceil(index);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}
function splitInterval(startMs, endMs, crew, visit) {
  let cursor = startMs;
  while (cursor < endMs) {
    const hourStart = Math.floor(cursor / hourMs) * hourMs;
    const next = Math.min(endMs, hourStart + hourMs);
    visit(new Date(hourStart).toISOString().slice(0, 13), crew * (next - cursor) / hourMs);
    cursor = next;
  }
}
function normalizeCapacityIntervals(rows) {
  const intervals = (rows || []).map((row) => {
    const startMs = timestampMs(row.start), endMs = timestampMs(row.stop ?? row.end);
    const multiplier = finite(row.multiplier);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      && multiplier != null && (multiplier === 0 || multiplier === 1)
      ? { startMs, endMs, multiplier } : null;
  }).filter(Boolean).sort((a, b) => a.startMs - b.startMs);
  if (intervals.some((row, i) => i > 0 && row.startMs < intervals[i - 1].endMs)) return [];
  return intervals;
}
function visitCapacitySegments(startMs, endMs, intervals, visit) {
  let cursor = startMs;
  for (const interval of intervals) {
    if (interval.endMs <= cursor || interval.startMs >= endMs) continue;
    if (interval.startMs > cursor) visit(cursor, Math.min(endMs, interval.startMs), 0);
    const segmentStart = Math.max(cursor, interval.startMs), segmentEnd = Math.min(endMs, interval.endMs);
    if (segmentEnd > segmentStart) visit(segmentStart, segmentEnd, interval.multiplier);
    cursor = Math.max(cursor, segmentEnd);
    if (cursor >= endMs) break;
  }
  if (cursor < endMs) visit(cursor, endMs, 0);
}
function capacityCoverageMs(startMs, endMs, intervals) {
  let covered = 0, cursor = startMs;
  for (const interval of intervals) {
    const start = Math.max(cursor, interval.startMs), end = Math.min(endMs, interval.endMs);
    if (end > start) { covered += end - start; cursor = end; }
    if (cursor >= endMs) break;
  }
  return covered;
}
function advanceByEffectiveDuration(startMs, requiredMs, completedMs, intervals) {
  let remaining = requiredMs, result = null;
  visitCapacitySegments(startMs, completedMs, intervals, (start, end, multiplier) => {
    if (remaining <= 0 || multiplier <= 0) return;
    const effective = (end - start) * multiplier;
    if (remaining <= effective) { result = start + remaining / multiplier; remaining = 0; }
    else remaining -= effective;
  });
  return result;
}
function splitEffectiveInterval(startMs, endMs, crew, intervals, visit) {
  visitCapacitySegments(startMs, endMs, intervals, (start, end, multiplier) => {
    splitInterval(start, end, crew * multiplier, visit);
  });
}
function normalizeJob(raw, capacityIntervals = []) {
  const component = componentKey(raw.component ?? raw.input);
  const amount = finite(raw.amount), crew = finite(raw.crew);
  const completedMs = timestampMs(raw.completed_at ?? raw.completedAt ?? raw._time ?? raw.time);
  const startedMs = timestampMs(raw.started_at ?? raw.startedAt);
  const secondsPerUnit = COMPONENT_SECONDS[component];
  if (!component || !(amount > 0) || !(crew > 0) || !Number.isFinite(startedMs) || !Number.isFinite(completedMs) || completedMs < startedMs || !secondsPerUnit) return null;
  const requiredMs = amount * secondsPerUnit / crew * 1000;
  let activeEndMs = capacityIntervals.length ? advanceByEffectiveDuration(startedMs, requiredMs, completedMs, capacityIntervals) : Math.min(completedMs, startedMs + requiredMs);
  let workScale = 1, jobIntervals = capacityIntervals;
  if (raw.estimateTiming && activeEndMs == null && completedMs > startedMs) {
    activeEndMs = completedMs;
    let availableMs = 0;
    visitCapacitySegments(startedMs, completedMs, jobIntervals, (start, end, multiplier) => { availableMs += (end - start) * multiplier; });
    if (!availableMs) {
      jobIntervals = [{ startMs: startedMs, endMs: completedMs, multiplier: 1 }];
      availableMs = completedMs - startedMs;
    }
    workScale = requiredMs / availableMs;
  }
  let claimDelaySeconds = activeEndMs == null ? null : Math.max(0, (completedMs - activeEndMs) / 1000);

  return { ...raw, component, amount, crew, workScale, jobIntervals, startedMs, activeEndMs, completedMs, date: new Date(completedMs).toISOString().slice(0, 10), claimDelaySeconds };
}
function buildNeutralHours(rows) {
  const byHour = new Map();
  for (const raw of rows || []) {
    const time = String(raw.time ?? raw._time ?? '');
    const ms = Date.parse(time), component = componentKey(raw.component);
    const crew = finite(raw.neutral_crew ?? raw.neutralCrew);
    if (!Number.isFinite(ms) || !component || !(crew >= 0)) continue;
    const hour = new Date(ms).toISOString().slice(0, 13);
    if (!byHour.has(hour)) byHour.set(hour, new Map());
    byHour.get(hour).set(component, crew);
  }
  return byHour;
}
function calculateStrictUpgradingSelectionUtilization({ jobs = [], neutralHours = [], configuredCrewByHour = {}, capacityIntervals = [], capacityEvidenceRequired = false, prices = {}, pricesByDate = null, atlasPerLpByDate = {}, faction = '', profile = '', priceSnapshotAt = null } = {}) {
  let normalizedCapacityIntervals = normalizeCapacityIntervals(capacityIntervals);
  if (!capacityEvidenceRequired && !capacityIntervals.length) normalizedCapacityIntervals = [{ startMs: 0, endMs: 8640000000000000, multiplier: 1 }];
  const normalizedJobs = jobs.map((job) => normalizeJob(job, normalizedCapacityIntervals)).filter(Boolean).map((job) => ({
    ...job,
    capacityComplete: job.activeEndMs != null && (!capacityEvidenceRequired || capacityCoverageMs(job.startedMs, job.completedMs, normalizedCapacityIntervals) >= job.completedMs - job.startedMs),
  }));
  const neutralByHour = buildNeutralHours(neutralHours);
  const cohort = new Map(), calendar = new Map();
  const ensureCalendar = (date) => { if (!calendar.has(date)) calendar.set(date, { date, protocol_active_crew_hours: 0, claim_locked_crew_hours: 0, proven_eligible_idle_crew_hours: 0, proven_hard_unavailable_crew_hours: 0 }); return calendar.get(date); };
  for (const job of normalizedJobs) {
    if (!cohort.has(job.date)) cohort.set(job.date, []);
    cohort.get(job.date).push(job);
    if (!job.capacityComplete) {
      splitInterval(job.startedMs, job.completedMs, job.crew, (hour) => { ensureCalendar(hour.slice(0, 10)).job_evidence_incomplete = true; });
      continue;
    }
    splitEffectiveInterval(job.startedMs, job.activeEndMs, job.crew * job.workScale, job.jobIntervals, (hour, crewHours) => { ensureCalendar(hour.slice(0, 10)).protocol_active_crew_hours += crewHours; });
    splitEffectiveInterval(job.activeEndMs, job.completedMs, job.crew, normalizedCapacityIntervals, (hour, crewHours) => { ensureCalendar(hour.slice(0, 10)).claim_locked_crew_hours += crewHours; });
  }
  const selection = [...cohort].sort(([a], [b]) => a.localeCompare(b)).map(([date, dayJobs]) => {
    const valuationPrices = pricesByDate?.[date] || prices;
    const activeByHour = new Map();
    for (const job of dayJobs.filter(job => job.capacityComplete)) splitEffectiveInterval(job.startedMs, job.activeEndMs, job.crew * job.workScale, job.jobIntervals, (hour, crewHours) => activeByHour.set(hour, (activeByHour.get(hour) || 0) + crewHours));
    const missingHours = [...activeByHour.keys()].filter((hour) => {
      const hourStart = Date.parse(`${hour}:00:00.000Z`);
      return !neutralByHour.has(hour) || (capacityEvidenceRequired && capacityCoverageMs(hourStart, hourStart + hourMs, normalizedCapacityIntervals) < hourMs);
    });
    const actualLp = dayJobs.reduce((sum, job) => sum + job.amount * COMPONENT_LP[job.component], 0);
    let neutralLp = 0, neutralCost = 0;
    for (const [hour, activeCrewHours] of activeByHour) {
      const allocation = neutralByHour.get(hour); if (!allocation) continue;
      const totalCrew = [...allocation.values()].reduce((sum, value) => sum + value, 0);
      if (!(totalCrew > 0)) { missingHours.push(hour); continue; }
      for (const [component, crew] of allocation) {
        const units = activeCrewHours * (crew / totalCrew) * 3600 / COMPONENT_SECONDS[component];
        neutralLp += units * COMPONENT_LP[component];
        const price = finite(valuationPrices[component]); if (price != null) neutralCost += units * price;
      }
    }
    const actualCostComplete = dayJobs.every((job) => finite(valuationPrices[job.component]) != null);
    const neutralCostComplete = [...new Set([...activeByHour.keys()].flatMap((hour) => [...(neutralByHour.get(hour)?.keys() || [])]))].every((component) => finite(valuationPrices[component]) != null);
    const jobsComplete = dayJobs.every(job => job.capacityComplete);
    const complete = jobsComplete && !missingHours.length && actualCostComplete && neutralCostComplete && Number.isFinite(finite(atlasPerLpByDate[date]));
    const activeCrewHours = [...activeByHour.values()].reduce((sum, value) => sum + value, 0), activeCrewDays = activeCrewHours / 24;
    const actualCost = dayJobs.reduce((sum, job) => sum + job.amount * (finite(valuationPrices[job.component]) || 0), 0);
    const upliftLp = complete ? actualLp - neutralLp : null;
    const upliftAtlas = complete ? upliftLp * finite(atlasPerLpByDate[date]) - (actualCost - neutralCost) : null;
    return { date, time_basis: 'completion_cohort', atlas_per_lp: finite(atlasPerLpByDate[date]), price_basis: pricesByDate ? 'historical_at_or_before' : 'current_component_prices', price_basis_complete: actualCostComplete && neutralCostComplete, actual_cohort_lp: actualLp, neutral_cohort_lp: complete ? neutralLp : null, selection_uplift_lp: upliftLp, selection_uplift_lp_per_active_crew_hour: complete && activeCrewHours > 0 ? upliftLp / activeCrewHours : null, selection_uplift_lp_per_active_crew_day: complete && activeCrewDays > 0 ? upliftLp / activeCrewDays : null, selection_uplift_atlas: upliftAtlas, selection_uplift_atlas_per_active_crew_day: complete && activeCrewDays > 0 ? upliftAtlas / activeCrewDays : null, completion_cohort_active_crew_hours: jobsComplete ? activeCrewHours : null, active_crew_days: jobsComplete ? activeCrewDays : null, completed_job_count: dayJobs.length, cohort_complete: jobsComplete && !missingHours.length, neutral_allocation_complete: !missingHours.length, evidence_complete: complete, incomplete_reason: complete ? null : (!jobsComplete ? 'Toolkit clock coverage incomplete or required work inconsistent' : missingHours.length ? `Hourly neutral allocation missing for ${[...new Set(missingHours)].join(', ')}` : 'Price or redemption evidence incomplete') };
  });
  for (const hour of Object.keys(configuredCrewByHour)) ensureCalendar(hour.slice(0, 10));
  const utilization = [...calendar].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => {
    const hours = Object.entries(configuredCrewByHour).filter(([hour]) => hour.startsWith(date));
    const nominalConfigured = hours.reduce((sum, [, crew]) => sum + Math.max(0, finite(crew) || 0), 0);
    let configured = 0, toolkitCapacityComplete = !capacityEvidenceRequired || hours.length === 24;
    for (const [hour, crew] of hours) {
      const hourStart = Date.parse(`${hour}:00:00.000Z`), normalizedCrew = Math.max(0, finite(crew) || 0);
      if (capacityEvidenceRequired && capacityCoverageMs(hourStart, hourStart + hourMs, normalizedCapacityIntervals) < hourMs) toolkitCapacityComplete = false;
      visitCapacitySegments(hourStart, hourStart + hourMs, normalizedCapacityIntervals, (start, end, multiplier) => { configured += normalizedCrew * (end - start) / hourMs * multiplier; });
    }
    const observed = row.protocol_active_crew_hours + row.claim_locked_crew_hours + row.proven_eligible_idle_crew_hours + row.proven_hard_unavailable_crew_hours;
    row.nominal_configured_crew_hours = nominalConfigured;
    row.toolkit_degraded_crew_hours = toolkitCapacityComplete ? Math.max(0, nominalConfigured - configured) : null;
    row.toolkit_capacity_complete = !capacityEvidenceRequired || toolkitCapacityComplete;
    row.configured_capacity_complete = !capacityEvidenceRequired || hours.length === 24;
    row.configured_crew_hours = configured;
    row.capacity_not_observed_crew_hours = Math.max(0, configured - observed);
    row.identity_complete = !row.job_evidence_incomplete && row.toolkit_capacity_complete && configured > 0 && observed <= configured + 1e-6;
    row.evidence_complete = row.identity_complete;
    row.time_basis = 'utc_calendar';
    row.feasible_neutral_lower_crew_hours = row.protocol_active_crew_hours;
    row.feasible_neutral_upper_crew_hours = Math.max(0, configured - row.claim_locked_crew_hours - row.proven_hard_unavailable_crew_hours);
    for (const key of ['protocol_active', 'claim_locked', 'proven_eligible_idle', 'proven_hard_unavailable', 'capacity_not_observed']) row[`${key}_percent`] = row.identity_complete ? row[`${key}_crew_hours`] / configured * 100 : null;
    return row;
  });
  const claimCapacityComplete = normalizedJobs.every((job) => job.capacityComplete) && utilization.every(row => row.toolkit_capacity_complete && !row.job_evidence_incomplete);
  const claimDelays = normalizedJobs.filter((job) => job.capacityComplete).map((job) => job.claimDelaySeconds);
  const completeUtilization = utilization.filter((row) => row.identity_complete);
  const claimLockedCrewHours = completeUtilization.reduce((sum, row) => sum + row.claim_locked_crew_hours, 0), configuredCrewHours = completeUtilization.reduce((sum, row) => sum + row.configured_crew_hours, 0);
  const toolkitDegradedCrewHours = utilization.reduce((sum, row) => sum + row.toolkit_degraded_crew_hours, 0);
  return { data_version: DATA_VERSION, calculation_version: CALCULATION_VERSION, faction, profile, price_basis: pricesByDate ? 'historical_at_or_before' : 'current_component_prices', price_snapshot_at: priceSnapshotAt, price_basis_complete: selection.every((row) => row.evidence_complete), component_prices_used: pricesByDate || prices, price_warning: pricesByDate ? null : CURRENT_PRICE_WARNING, selection, utilization, toolkit_capacity: { degraded_crew_hours: toolkitDegradedCrewHours, evidence_observed: capacityIntervals.length > 0 }, claim_lock: { capacity_evidence_complete: claimCapacityComplete, claim_locked_crew_hours: claimCapacityComplete ? claimLockedCrewHours : null, claim_locked_percent: claimCapacityComplete && configuredCrewHours > 0 ? claimLockedCrewHours / configuredCrewHours * 100 : null, median_claim_delay_seconds: claimCapacityComplete ? quantile(claimDelays, .5) : null, p90_claim_delay_seconds: claimCapacityComplete ? quantile(claimDelays, .9) : null, p95_claim_delay_seconds: claimCapacityComplete ? quantile(claimDelays, .95) : null, maximum_claim_delay_seconds: claimCapacityComplete && claimDelays.length ? Math.max(...claimDelays) : null, attempt_count: null, retry_count: null, failure_count: null, evidence_completeness: 'Attempt/retry/failure evidence NOT OBSERVED' } };
}
function calculateUpgradingSelectionUtilization(input = {}) {
  if (!input.capacityEvidenceRequired) return calculateStrictUpgradingSelectionUtilization(input);
  const observedIntervals = normalizeCapacityIntervals(input.capacityIntervals);
  const jobs = (input.jobs || []).map(job => normalizeJob(job, observedIntervals)).filter(Boolean);
  const configured = { ...(input.configuredCrewByHour || {}) };
  const dates = new Set(Object.keys(configured).map(hour => hour.slice(0, 10)));
  for (const job of jobs) splitInterval(job.startedMs, Math.max(job.startedMs + 1, job.completedMs), 1, hour => dates.add(hour.slice(0, 10)));
  const observations = Object.entries(configured).filter(([hour, crew]) => Number.isFinite(Date.parse(`${hour}:00:00Z`)) && crew != null && Number.isFinite(Number(crew)) && Number(crew) >= 0)
    .map(([hour, crew]) => ({ time: Date.parse(`${hour}:00:00Z`), crew: Number(crew) })).sort((a, b) => a.time - b.time);
  const inferredDates = new Set(), missingToolkitDates = new Set(), timingDates = new Set();
  const events = jobs.flatMap(job => [[job.startedMs, job.crew], [job.completedMs, -job.crew]]).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  let peak = 0, active = 0;
  for (const [, change] of events) { active += change; peak = Math.max(peak, active); }
  const intervals = [];
  for (const date of [...dates].sort()) {
    const start = Date.parse(`${date}T00:00:00Z`), end = start + 24 * hourMs;
    if (!Number.isFinite(start)) continue;
    if (capacityCoverageMs(start, end, observedIntervals) < end - start) missingToolkitDates.add(date);
    let cursor = start;
    for (const interval of observedIntervals) {
      const left = Math.max(start, interval.startMs), right = Math.min(end, interval.endMs);
      if (right <= left) continue;
      if (left > cursor) intervals.push({ start: cursor, stop: left, multiplier: 1 });
      intervals.push({ start: left, stop: right, multiplier: interval.multiplier });
      cursor = right;
    }
    if (cursor < end) intervals.push({ start: cursor, stop: end, multiplier: 1 });
    for (let time = start; time < end; time += hourMs) {
      const hour = new Date(time).toISOString().slice(0, 13);
      if (configured[hour] != null && Number.isFinite(Number(configured[hour])) && Number(configured[hour]) >= 0) continue;
      const nearest = observations.reduce((best, row) => !best || Math.abs(row.time - time) < Math.abs(best.time - time) ? row : best, null);
      // With no configured observations, peak simultaneous job crew is only a lower-bound estimate.
      configured[hour] = nearest ? nearest.crew : peak;
      inferredDates.add(date);
    }
  }
  const filled = normalizeCapacityIntervals(intervals);
  const estimatedJobs = (input.jobs || []).map(raw => {
    const job = normalizeJob(raw, filled);
    if (job && job.activeEndMs == null) {
      timingDates.add(job.date);
      splitInterval(job.startedMs, job.completedMs, 1, hour => timingDates.add(hour.slice(0, 10)));
    }
    return { ...raw, estimateTiming: true };
  });
  const neutralHours = [...(input.neutralHours || [])], neutral = buildNeutralHours(neutralHours);
  const neutralEstimates = new Set();
  const neutralObservations = [...neutral].filter(([, allocation]) => [...allocation.values()].some(crew => crew > 0));
  for (const job of jobs) splitInterval(job.startedMs, job.completedMs, 1, hour => {
    if (neutral.has(hour) || !neutralObservations.length) return;
    const time = Date.parse(`${hour}:00:00Z`);
    const nearest = neutralObservations.reduce((best, row) => !best || Math.abs(Date.parse(`${row[0]}:00:00Z`) - time) < Math.abs(Date.parse(`${best[0]}:00:00Z`) - time) ? row : best, null);
    for (const [component, crew] of nearest[1]) neutralHours.push({ time: `${hour}:00:00Z`, component, neutral_crew: crew });
    neutral.set(hour, nearest[1]);
    neutralEstimates.add(job.date);
  });
  const result = calculateStrictUpgradingSelectionUtilization({ ...input, jobs: estimatedJobs, neutralHours, configuredCrewByHour: configured, capacityIntervals: intervals, capacityEvidenceRequired: false });
  for (const row of result.utilization) {
    const observed = row.protocol_active_crew_hours + row.claim_locked_crew_hours;
    if (observed > row.configured_crew_hours) {
      row.configured_crew_hours = observed;
      inferredDates.add(row.date);
      row.capacity_not_observed_crew_hours = 0;
      row.feasible_neutral_upper_crew_hours = row.protocol_active_crew_hours;
    }
    row.estimated = missingToolkitDates.has(row.date) || inferredDates.has(row.date) || timingDates.has(row.date);
    row.display_available = row.configured_crew_hours > 0;
    row.toolkit_capacity_complete = !missingToolkitDates.has(row.date);
    row.configured_capacity_complete = !inferredDates.has(row.date);
    row.evidence_complete = row.identity_complete = row.display_available && !row.estimated;
    for (const key of ['protocol_active', 'claim_locked', 'proven_eligible_idle', 'proven_hard_unavailable', 'capacity_not_observed']) row[`${key}_percent`] = row.display_available ? row[`${key}_crew_hours`] / row.configured_crew_hours * 100 : null;
  }
  for (const row of result.selection) {
    row.estimated = neutralEstimates.has(row.date) || timingDates.has(row.date) || jobs.some(job => job.date === row.date && capacityCoverageMs(job.startedMs, job.completedMs, observedIntervals) < job.completedMs - job.startedMs);
    row.display_available = row.evidence_complete;
    if (row.estimated) row.evidence_complete = false;
  }
  result.estimate_note = [...result.selection, ...result.utilization].some(row => row.estimated)
    ? 'Estimated: unknown Toolkit periods assume full supply; missing crew uses the nearest configured observation (or observed job crew as a lower bound). Missing neutral allocation uses the nearest observed mix. Completed work is preserved; inconsistent timing/capacity is reconciled to that work.' : null;
  const available = result.utilization.filter(row => row.display_available);
  const configuredTotal = available.reduce((sum, row) => sum + row.configured_crew_hours, 0);
  result.claim_lock.claim_locked_crew_hours = available.reduce((sum, row) => sum + row.claim_locked_crew_hours, 0);
  result.claim_lock.claim_locked_percent = configuredTotal > 0 ? result.claim_lock.claim_locked_crew_hours / configuredTotal * 100 : null;
  result.claim_lock.estimated = Boolean(result.estimate_note);
  result.claim_lock.capacity_evidence_complete = !result.estimate_note;
  return result;
}
module.exports = { calculateUpgradingSelectionUtilization, normalizeJob, splitInterval, normalizeCapacityIntervals, CURRENT_PRICE_WARNING };
