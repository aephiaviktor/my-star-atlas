'use strict';
// Read-only economic projection. Existing cohort charts and stored evidence are untouched.
const { COMPONENT_SECONDS, COMPONENT_LP, normalizeJob, splitInterval, buildNeutralHours } = require('./upgrading-selection-utilization');
const { project } = require('./toolkit-capacity-chart');
const number = value => value != null && Number.isFinite(Number(value)) ? Number(value) : null;
function calculateManagementImpact({ jobs = [], neutralHours = [], configuredCrewByHour = {}, pricesByDate = {}, atlasPerLpByDate = {}, utilization = [], toolkitDowntime = {}, faction = '', profile = '', now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const allocations = buildNeutralHours(neutralHours, { faction, profile }), work = new Map();
  for (const raw of jobs || []) {
    const job = normalizeJob(raw); if (!job) continue;
    splitInterval(job.startedMs, job.activeEndMs, job.crew, (hour, hours) => {
      if (!work.has(hour)) work.set(hour, []);
      work.get(hour).push({ component: job.component, hours });
    });
  }
  const calendar = new Map(utilization.map(row => [row.date, row]));
  // Days without completed jobs still have real configured, but unclassified, capacity.
  for (const hour of Object.keys(configuredCrewByHour)) {
    const date = hour.slice(0, 10);
    if (!calendar.has(date)) calendar.set(date, { date, configured_crew_hours: 0, protocol_active_crew_hours: 0, claim_locked_crew_hours: 0, capacity_not_observed_crew_hours: 0 });
  }
  const rows = [];
  for (const [date, source] of [...calendar].sort(([a], [b]) => a.localeCompare(b))) {
    if (date >= today) continue;
    const warnings = [];
    const configured = Object.entries(configuredCrewByHour).filter(([h, c]) => h.startsWith(date) && number(c) != null && Number(c) >= 0);
    const total = configured.reduce((s, [, c]) => s + Number(c), 0);
    const base = { ...source };
    if (!(base.configured_crew_hours > 0)) { base.configured_crew_hours = total; base.capacity_not_observed_crew_hours = total; }
    const adjusted = project(base, toolkitDowntime.rows?.find(r => r.date === date), true);
    warnings.push(...adjusted.warnings);
    if (!adjusted.adjusted) warnings.push('Toolkit capacity unadjusted; net capacity assumes no additional downtime');
    if (configured.length < 24) warnings.push(`Configured crew observed for ${configured.length}/24 hours; denominator may be incomplete`);
    const netHours = adjusted.adjusted ? adjusted.net_capacity_crew_hours : adjusted.configured_crew_hours;
    const netDays = netHours / 24;
    const rate = number(atlasPerLpByDate[date]), prices = pricesByDate[date] || {};
    const dayAllocations = [...allocations.keys()].filter(h => h.startsWith(date)).sort();
    let benchmarkSum = 0, benchmarkWeight = 0, selection = 0, economicsComplete = rate != null && rate >= 0;
    const contribution = component => {
      const price = number(prices[component]);
      return price != null && price >= 0 && COMPONENT_SECONDS[component] && rate != null
        ? (COMPONENT_LP[component] * rate - price) * 3600 / COMPONENT_SECONDS[component] : null;
    };
    const neutralRate = hour => {
      let allocation = allocations.get(hour);
      if (!allocation && dayAllocations.length) {
        const nearest = dayAllocations.reduce((best, h) => Math.abs(Date.parse(h + ':00:00Z') - Date.parse(hour + ':00:00Z')) < Math.abs(Date.parse(best + ':00:00Z') - Date.parse(hour + ':00:00Z')) ? h : best);
        allocation = allocations.get(nearest); warnings.push('Missing hourly neutral mix estimated from the nearest same-day observation');
      }
      if (!allocation) return null;
      let sum = 0, weight = 0;
      for (const [component, crew] of allocation) {
        if (!crew) continue;
        const value = contribution(component); if (value == null) return null;
        sum += value * crew; weight += crew;
      }
      return weight > 0 ? sum / weight : null;
    };
    for (const [hour, crew] of configured) {
      if (!(Number(crew) > 0)) continue;
      const value = neutralRate(hour);
      if (value == null) economicsComplete = false;
      else { benchmarkSum += value * Number(crew); benchmarkWeight += Number(crew); }
    }
    for (const [hour, entries] of work) {
      if (!hour.startsWith(date)) continue;
      const neutral = neutralRate(hour);
      for (const entry of entries) {
        const actual = contribution(entry.component);
        if (neutral == null || actual == null) economicsComplete = false;
        else selection += entry.hours * (actual - neutral);
      }
    }
    const benchmark = benchmarkWeight > 0 ? benchmarkSum / benchmarkWeight : null;
    const lostHours = Math.max(0, adjusted.claim_locked_crew_hours || 0) + Math.max(0, adjusted.proven_eligible_idle_crew_hours || 0);
    const unknownHours = Math.max(0, adjusted.capacity_not_observed_crew_hours || 0);
    const classified = ['protocol_active', 'claim_locked', 'proven_eligible_idle', 'proven_hard_unavailable', 'capacity_not_observed'].reduce((sum, key) => sum + Math.max(0, adjusted[`${key}_crew_hours`] || 0), 0);
    if (classified > netHours + 1e-6) warnings.push('Classified hours exceed net capacity; estimates are not forced to reconcile');
    if (benchmark != null && benchmark < 0) warnings.push('Neutral contribution is negative; no forgone-profit loss is assigned to unused capacity');
    const available = economicsComplete && benchmark != null && netDays > 0;
    const loss = available ? (-lostHours * Math.max(0, benchmark) || 0) : null;
    const lower = available ? (-(lostHours + unknownHours) * Math.max(0, benchmark) || 0) : null;
    rows.push({ date, atlasPerLp: rate, available, timeBasis: 'utc_calendar', netCrewHours: netHours, netCrewDays: netDays,
      lostCrewHours: lostHours, unknownCrewHours: unknownHours, toolkitCrewHours: adjusted.toolkit_downtime_crew_hours || 0,
      coverage: adjusted.coverage ?? 0, adjusted: adjusted.adjusted, benchmarkAtlasPerCrewHour: benchmark,
      selectionAtlas: available ? selection : null, lossAtlas: loss,
      selection: available ? selection / netDays : null, loss: available ? loss / netDays : null,
      lossLower: available ? lower / netDays : null, combined: available ? (selection + loss) / netDays : null,
      combinedLower: available ? (selection + lower) / netDays : null,
      warnings: [...new Set(warnings)], reason: available ? null : !(netDays > 0) ? 'No positive net capacity' : 'Neutral allocation, historical component price, or ATLAS/LP unavailable' });
  }
  return { faction, profile, timeBasis: 'utc_calendar', costBasis: 'historical_external_component_contribution', rows };
}
module.exports = { calculateManagementImpact };
