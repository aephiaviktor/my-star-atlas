'use strict';

const CALCULATION_VERSION = 'upgrading-selection-utilization-v1';
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
function normalizeJob(raw) {
  const component = componentKey(raw.component ?? raw.input);
  const amount = finite(raw.amount), crew = finite(raw.crew);
  const completedMs = timestampMs(raw.completed_at ?? raw.completedAt ?? raw._time ?? raw.time);
  const startedMs = timestampMs(raw.started_at ?? raw.startedAt);
  const secondsPerUnit = COMPONENT_SECONDS[component];
  if (!component || !(amount > 0) || !(crew > 0) || !Number.isFinite(startedMs) || !Number.isFinite(completedMs) || completedMs < startedMs || !secondsPerUnit) return null;
  const activeEndMs = Math.min(completedMs, startedMs + amount * secondsPerUnit / crew * 1000);
  return { ...raw, component, amount, crew, startedMs, activeEndMs, completedMs, date: new Date(completedMs).toISOString().slice(0, 10), claimDelaySeconds: Math.max(0, (completedMs - activeEndMs) / 1000) };
}
function buildNeutralHours(rows, { faction = '', profile = '' } = {}) {
  const byHour = new Map();
  const canonicalFaction = value => String(value || '').toUpperCase().replace(/^UST$/, 'USTUR');
  const scoped = (rows || []).filter(raw => (!faction || !raw.faction || canonicalFaction(raw.faction) === canonicalFaction(faction)) && (!profile || !(raw.profile || raw.player_profile) || (raw.profile || raw.player_profile) === profile));
  // Newest recording wins within an intended hour, independent of response order.
  scoped.sort((a, b) => String(a.recorded_at ?? a._time ?? a.time).localeCompare(String(b.recorded_at ?? b._time ?? b.time)) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const raw of scoped) {
    const intendedMs = Date.parse(raw.snapshot_for_hour || '');
    const time = Number.isFinite(intendedMs) ? new Date(intendedMs).toISOString() : String(raw.time ?? raw._time ?? '');
    const ms = Date.parse(time), component = componentKey(raw.component);
    const crew = finite(raw.neutral_crew ?? raw.neutralCrew);
    if (!Number.isFinite(ms) || !component || !(crew >= 0)) continue;
    const hour = new Date(ms).toISOString().slice(0, 13);
    if (!byHour.has(hour)) byHour.set(hour, new Map());
    byHour.get(hour).set(component, crew);
  }
  for (const allocation of byHour.values()) {
    for (const [component, crew] of allocation) if (crew === 0) allocation.delete(component);
  }
  return byHour;
}
// Fill only a single missing hour from an observed preceding allocation. Never
// chain estimates, borrow future plans, or replace an observed zero allocation.
function recoverNeutralHours(rows, jobs, scope = {}) {
  const byHour = buildNeutralHours(rows, scope), estimated = new Map();
  const observed = new Map(byHour);
  for (const raw of jobs) {
    const job = normalizeJob(raw); if (!job) continue;
    splitInterval(job.startedMs, job.activeEndMs, job.crew, hour => {
      if (byHour.has(hour)) return;
      const previous = new Date(Date.parse(hour + ':00:00Z') - hourMs).toISOString().slice(0, 13);
      const allocation = observed.get(previous);
      if (!allocation?.size) return;
      byHour.set(hour, new Map(allocation)); estimated.set(hour, previous);
    });
  }
  return { byHour, estimated };
}
// Resolve the prices the completion-cohort comparison actually consumes. A
// previous-day neutral component may never appear in the completion day's plan.
async function recoverSelectionComponentPrices({ jobs = [], neutralHours = [], pricesByDate = {}, resolvePrice, faction = '', profile = '' }) {
  const result = Object.fromEntries(Object.entries(pricesByDate).map(([date, prices]) => [date, { ...prices }]));
  const { byHour } = recoverNeutralHours(neutralHours, jobs, { faction, profile });
  const required = new Map();
  for (const raw of jobs) {
    const job = normalizeJob(raw);
    if (!job) continue;
    if (!required.has(job.date)) required.set(job.date, new Set());
    const components = required.get(job.date);
    components.add(job.component);
    splitInterval(job.startedMs, job.activeEndMs, job.crew, (hour) => {
      for (const component of (byHour.get(hour) || new Map()).keys()) components.add(component);
    });
  }
  // Sequential lookup uses the existing historical cache and bounds concurrency.
  for (const [date, components] of required) {
    if (!result[date]) result[date] = {};
    for (const component of components) {
      const existing = result[date][component];
      if (existing != null && existing !== '' && Number.isFinite(Number(existing))) continue;
      const evidence = await resolvePrice(component, date);
      if (evidence?.status === 'complete' && evidence.priceATL != null && Number.isFinite(Number(evidence.priceATL))) {
        result[date][component] = Number(evidence.priceATL);
      }
    }
  }
  return result;
}
function calculateUpgradingSelectionUtilization({ jobs = [], neutralHours = [], configuredCrewByHour = {}, prices = {}, pricesByDate = null, atlasPerLpByDate = {}, faction = '', profile = '', priceSnapshotAt = null } = {}) {
  const normalizedJobs = jobs.map(normalizeJob).filter(Boolean);
  const { byHour: neutralByHour, estimated } = recoverNeutralHours(neutralHours, jobs, { faction, profile });
  const cohort = new Map(), calendar = new Map();
  const ensureCalendar = (date) => { if (!calendar.has(date)) calendar.set(date, { date, protocol_active_crew_hours: 0, claim_locked_crew_hours: 0, proven_eligible_idle_crew_hours: 0, proven_hard_unavailable_crew_hours: 0 }); return calendar.get(date); };
  for (const job of normalizedJobs) {
    if (!cohort.has(job.date)) cohort.set(job.date, []);
    cohort.get(job.date).push(job);
    splitInterval(job.startedMs, job.activeEndMs, job.crew, (hour, crewHours) => { ensureCalendar(hour.slice(0, 10)).protocol_active_crew_hours += crewHours; });
    splitInterval(job.activeEndMs, job.completedMs, job.crew, (hour, crewHours) => { ensureCalendar(hour.slice(0, 10)).claim_locked_crew_hours += crewHours; });
  }
  const selection = [...cohort].sort(([a], [b]) => a.localeCompare(b)).map(([date, dayJobs]) => {
    const valuationPrices = pricesByDate?.[date] || prices;
    const priceValue = (value) => value == null || value === '' ? null : finite(value);
    const activeByHour = new Map();
    for (const job of dayJobs) splitInterval(job.startedMs, job.activeEndMs, job.crew, (hour, crewHours) => activeByHour.set(hour, (activeByHour.get(hour) || 0) + crewHours));
    const missingHours = [...activeByHour.keys()].filter((hour) => !neutralByHour.has(hour));
    const actualLp = dayJobs.reduce((sum, job) => sum + job.amount * COMPONENT_LP[job.component], 0);
    let neutralLp = 0, neutralCost = 0;
    for (const [hour, activeCrewHours] of activeByHour) {
      const allocation = neutralByHour.get(hour); if (!allocation) continue;
      const totalCrew = [...allocation.values()].reduce((sum, value) => sum + value, 0);
      if (!(totalCrew > 0)) { missingHours.push(hour); continue; }
      for (const [component, crew] of allocation) {
        const units = activeCrewHours * (crew / totalCrew) * 3600 / COMPONENT_SECONDS[component];
        neutralLp += units * COMPONENT_LP[component];
        const price = priceValue(valuationPrices[component]); if (price != null) neutralCost += units * price;
      }
    }
    const actualCostComplete = dayJobs.every((job) => priceValue(valuationPrices[job.component]) != null);
    const neutralCostComplete = [...new Set([...activeByHour.keys()].flatMap((hour) => [...(neutralByHour.get(hour)?.keys() || [])]))].every((component) => priceValue(valuationPrices[component]) != null);
    const missingActualPrices = [...new Set(dayJobs.map((job) => job.component))].filter((component) => priceValue(valuationPrices[component]) == null);
    const missingNeutralPrices = [...new Set([...activeByHour.keys()].flatMap((hour) => [...(neutralByHour.get(hour)?.keys() || [])]))].filter((component) => priceValue(valuationPrices[component]) == null);
    const incompleteReasons = [];
    if (missingHours.length) incompleteReasons.push(`Hourly neutral allocation missing or zero for ${[...new Set(missingHours)].sort().join(', ')} UTC`);
    if (missingActualPrices.length) incompleteReasons.push(`Actual component prices missing for ${date}: ${missingActualPrices.join(', ')}`);
    if (missingNeutralPrices.length) incompleteReasons.push(`Neutral component prices missing for ${date}: ${missingNeutralPrices.join(', ')}`);
    if (priceValue(atlasPerLpByDate[date]) == null) incompleteReasons.push(`ATLAS/LP redemption value missing for ${date} UTC`);
    const complete = !missingHours.length && actualCostComplete && neutralCostComplete && Number.isFinite(priceValue(atlasPerLpByDate[date]));
    const activeCrewHours = [...activeByHour.values()].reduce((sum, value) => sum + value, 0), activeCrewDays = activeCrewHours / 24;
    const actualCost = dayJobs.reduce((sum, job) => sum + job.amount * (priceValue(valuationPrices[job.component]) || 0), 0);
    const upliftLp = complete ? actualLp - neutralLp : null;
    const upliftAtlas = complete ? upliftLp * finite(atlasPerLpByDate[date]) - (actualCost - neutralCost) : null;
    const estimatedHours = [...activeByHour.keys()].filter(hour => estimated.has(hour)).sort();
    return { date, estimated: estimatedHours.length > 0, estimated_neutral_hours: estimatedHours.map(hour => ({ hour, source_hour: estimated.get(hour) })), time_basis: 'completion_cohort', atlas_per_lp: priceValue(atlasPerLpByDate[date]), price_basis: pricesByDate ? 'historical_at_or_before' : 'current_component_prices', price_basis_complete: actualCostComplete && neutralCostComplete, actual_cohort_lp: actualLp, neutral_cohort_lp: complete ? neutralLp : null, selection_uplift_lp: upliftLp, selection_uplift_lp_per_active_crew_hour: complete && activeCrewHours > 0 ? upliftLp / activeCrewHours : null, selection_uplift_lp_per_active_crew_day: complete && activeCrewDays > 0 ? upliftLp / activeCrewDays : null, selection_uplift_atlas: upliftAtlas, selection_uplift_atlas_per_active_crew_day: complete && activeCrewDays > 0 ? upliftAtlas / activeCrewDays : null, completion_cohort_active_crew_hours: activeCrewHours, active_crew_days: activeCrewDays, completed_job_count: dayJobs.length, cohort_complete: !missingHours.length, neutral_allocation_complete: !missingHours.length, evidence_complete: complete && !estimatedHours.length, display_available: complete, incomplete_reason: complete ? null : incompleteReasons.join('; ') };
  });
  const utilization = [...calendar].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => {
    const hours = Object.entries(configuredCrewByHour).filter(([hour]) => hour.startsWith(date));
    const configured = hours.reduce((sum, [, crew]) => sum + Math.max(0, finite(crew) || 0), 0);
    const observed = row.protocol_active_crew_hours + row.claim_locked_crew_hours + row.proven_eligible_idle_crew_hours + row.proven_hard_unavailable_crew_hours;
    row.configured_crew_hours = configured;
    row.capacity_not_observed_crew_hours = Math.max(0, configured - observed);
    row.identity_complete = configured > 0 && observed <= configured + 1e-6;
    row.evidence_complete = row.identity_complete;
    row.time_basis = 'utc_calendar';
    row.feasible_neutral_lower_crew_hours = row.protocol_active_crew_hours;
    row.feasible_neutral_upper_crew_hours = Math.max(0, configured - row.claim_locked_crew_hours - row.proven_hard_unavailable_crew_hours);
    for (const key of ['protocol_active', 'claim_locked', 'proven_eligible_idle', 'proven_hard_unavailable', 'capacity_not_observed']) row[`${key}_percent`] = configured > 0 ? row[`${key}_crew_hours`] / configured * 100 : null;
    return row;
  });
  const claimDelays = normalizedJobs.map((job) => job.claimDelaySeconds);
  const claimLockedCrewHours = utilization.reduce((sum, row) => sum + row.claim_locked_crew_hours, 0), configuredCrewHours = utilization.reduce((sum, row) => sum + row.configured_crew_hours, 0);
  return { data_version: DATA_VERSION, calculation_version: CALCULATION_VERSION, faction, profile, price_basis: pricesByDate ? 'historical_at_or_before' : 'current_component_prices', price_snapshot_at: priceSnapshotAt, price_basis_complete: selection.every((row) => row.evidence_complete), component_prices_used: pricesByDate || prices, price_warning: pricesByDate ? null : CURRENT_PRICE_WARNING, selection, utilization, claim_lock: { claim_locked_crew_hours: claimLockedCrewHours, claim_locked_percent: configuredCrewHours > 0 ? claimLockedCrewHours / configuredCrewHours * 100 : null, median_claim_delay_seconds: quantile(claimDelays, .5), p90_claim_delay_seconds: quantile(claimDelays, .9), p95_claim_delay_seconds: quantile(claimDelays, .95), maximum_claim_delay_seconds: claimDelays.length ? Math.max(...claimDelays) : null, attempt_count: null, retry_count: null, failure_count: null, evidence_completeness: 'Attempt/retry/failure evidence NOT OBSERVED' } };
}
module.exports = { buildNeutralHours, recoverSelectionComponentPrices, COMPONENT_SECONDS, COMPONENT_LP, calculateUpgradingSelectionUtilization, normalizeJob, splitInterval, CURRENT_PRICE_WARNING };
