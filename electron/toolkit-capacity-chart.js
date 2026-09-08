'use strict';
// Presentation-only estimate: never changes work, source evidence, or summary calculations.
(function (root) {
  const keys = ['protocol_active', 'claim_locked', 'proven_eligible_idle', 'proven_hard_unavailable', 'capacity_not_observed'];
  function project(row, evidence, net = false, context = {}) {
    const result = { ...row, warnings: [], adjusted: false, net: false };
    if (row.date < '2026-09-08') return result;
    let total = row.configured_crew_hours;
    const stop = Date.parse(context.stop);
    const hours = Object.entries(context.configuredCrewByHour || {}).filter(([hour]) => hour.startsWith(row.date));
    if (hours.length && Number.isFinite(stop)) {
      total = hours.reduce((sum, [hour, crew]) => {
        const start = Date.parse(`${hour}:00:00Z`);
        return sum + Math.max(0, Number(crew) || 0) * Math.max(0, Math.min(1, (stop - start) / 3600000));
      }, 0);
      result.configured_crew_hours = total;
      const classified = keys.filter(key => key !== 'capacity_not_observed').reduce((sum,key) => sum + (row[`${key}_crew_hours`] || 0),0);
      result.capacity_not_observed_crew_hours = Math.max(0,total-classified);
      for (const key of keys) result[`${key}_percent`] = total > 0 ? (result[`${key}_crew_hours`] || 0) / total * 100 : 0;
    }
    const covered = evidence?.coveredSeconds, period = evidence?.periodSeconds, stopped = evidence?.downtimeSeconds;
    result.coverage = Number.isFinite(covered) && period > 0 ? Math.min(1, covered / period) : 0;
    if (!(covered > 0) || !Number.isFinite(stopped) || stopped < 0 || stopped > covered) {
      result.warnings.push('No Toolkit observations; capacity unadjusted'); return result;
    }
    if (!(total > 0)) { result.warnings.push('Configured capacity unavailable; capacity unadjusted'); return result; }
    result.adjusted = true;
    // The daily observed time fraction is applied to the sum of configured hourly crew.
    // Intra-day correlation between crew changes and outages is not known.
    result.toolkit_downtime_crew_hours = total * stopped / covered;
    result.net_capacity_crew_hours = total - result.toolkit_downtime_crew_hours;
    let remainder = result.toolkit_downtime_crew_hours;
    for (const key of ['claim_locked', 'capacity_not_observed']) {
      const field = `${key}_crew_hours`, removed = Math.min(Math.max(0, result[field] || 0), remainder);
      result[field] = Math.max(0, result[field] || 0) - removed; remainder -= removed;
    }
    if (result.coverage < .9) result.warnings.push(`Toolkit adjustment estimated; ${(100 * (1 - result.coverage)).toFixed(1)}% of this day is uncovered`);
    if (remainder > 1e-6) result.warnings.push(`Downtime exceeds claim-locked and unclassified capacity by ${remainder.toFixed(1)} crew-hours; work unchanged`);
    result.net = net;
    if (net && result.net_capacity_crew_hours <= 0) result.warnings.push('Zero net capacity; net percentages unavailable (crew-hours retained in tooltips)');
    const denominator = result.net ? result.net_capacity_crew_hours : total;
    for (const key of [...keys, 'toolkit_downtime']) result[`${key}_percent`] = denominator > 0 ? (result[`${key}_crew_hours`] || 0) / denominator * 100 : 0;
    if (result.net) result.toolkit_downtime_percent = 0;
    return result;
  }
  const api = { project };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ToolkitCapacityChart = api;
})(globalThis);
