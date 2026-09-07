'use strict';

// Read-only diagnostic projection. Never supplies inputs to chart calculations.
function summarizeToolkitDowntime({ intervals = [], faction, starbase, start, stop, status } = {}) {
  const from = Date.parse(start), until = Date.parse(stop), dayMs = 86400000;
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || until - from > 35 * dayMs) return { rows: [], status };
  const events = new Map();
  const add = (time, value, delta) => {
    if (!events.has(time)) events.set(time, [0, 0]);
    events.get(time)[value] += delta;
  };
  add(from, 0, 0); add(until, 0, 0);
  for (let day = Math.floor(from / dayMs) * dayMs + dayMs; day < until; day += dayMs) add(day, 0, 0);
  for (const interval of intervals) {
    const begin = Math.max(from, Date.parse(interval.start)), end = Math.min(until, Date.parse(interval.stop));
    if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin || ![0, 1].includes(interval.multiplier)) continue;
    add(begin, interval.multiplier, 1); add(end, interval.multiplier, -1);
  }
  const counts = [0, 0], rows = new Map();
  const times = [...events.keys()].sort((a,b) => a-b);
  for (let i=0; i<times.length-1; i++) {
    const time = times[i], delta = events.get(time);
    counts[0] += delta[0]; counts[1] += delta[1];
    const date = new Date(time).toISOString().slice(0,10), seconds = (times[i+1]-time)/1000;
    if (!rows.has(date)) rows.set(date, { date, faction, starbase, periodSeconds: 0, coveredSeconds: 0, downtimeSeconds: 0, unknownSeconds: 0 });
    const row = rows.get(date); row.periodSeconds += seconds;
    if ((counts[0] > 0) !== (counts[1] > 0)) {
      row.coveredSeconds += seconds;
      if (counts[0] > 0) row.downtimeSeconds += seconds;
    } else row.unknownSeconds += seconds; // Only the conflicting or absent interval is unknown.
  }
  return { status, rows: [...rows.values()].reverse().map(row => ({ ...row,
    downtimeSeconds: row.coveredSeconds > 0 ? row.downtimeSeconds : null,
    // Optional full-period estimate uses this day's observed downtime share only.
    estimatedDowntimeSeconds: row.coveredSeconds > 0 && row.unknownSeconds > 0
      ? row.downtimeSeconds / row.coveredSeconds * row.periodSeconds : null,
    evidenceStatus: row.coveredSeconds === 0 ? 'Not observed' : row.unknownSeconds > 0 ? 'Partial · estimate' : 'Reconciled',
  })) };
}
module.exports = { summarizeToolkitDowntime };
