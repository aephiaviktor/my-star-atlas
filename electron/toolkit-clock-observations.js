'use strict';
const { normalizeState, projectClock } = require('./starbase-upkeep-capacity');
const RETENTION = 35 * 86400;

// The clock difference measures total stopped time, not where within the window it occurred.
function compareToolkitClocks(rawAnchor, rawTarget) {
  const anchor = normalizeState(rawAnchor), target = normalizeState(rawTarget);
  if (!anchor || !target) throw new Error('upkeep_snapshot_invalid');
  for (const key of ['faction', 'starbase', 'starbasePublicKey', 'level', 'depletionRate', 'reserve']) {
    if (anchor[key] !== target[key]) throw new Error('upkeep_configuration_changed');
  }
  const seconds = target.observedAt - anchor.observedAt;
  if (target.slot <= anchor.slot || seconds <= 0 || seconds > RETENTION) throw new Error('upkeep_boundary_invalid');
  const activeSeconds = projectClock(target, target.observedAt).localTime - projectClock(anchor, anchor.observedAt).localTime;
  if (activeSeconds < 0 || activeSeconds > seconds) throw new Error('upkeep_clock_reconciliation_failed');
  return { start: new Date(anchor.observedAt * 1000).toISOString(), stop: new Date(target.observedAt * 1000).toISOString(),
    downtimeSeconds: seconds - activeSeconds };
}

// A post-boundary account can recover midnight only if its upkeep state has not
// been updated after midnight. Never project a pre-midnight observation forward.
function splitToolkitClockWindow({ anchor, target }) {
  const whole = compareToolkitClocks(anchor, target);
  const day = 86400;
  const boundaries = [];
  for (let at = (Math.floor(anchor.observedAt / day) + 1) * day; at < target.observedAt; at += day) {
    if (target.globalTime > at) return [whole];
    boundaries.push(at);
  }
  if (!boundaries.length) return [whole];
  const points = [{ at: anchor.observedAt, clock: projectClock(anchor, anchor.observedAt).localTime },
    ...boundaries.map(at => ({ at, clock: projectClock(target, at).localTime })),
    { at: target.observedAt, clock: projectClock(target, target.observedAt).localTime }];
  const windows = points.slice(1).map((point, i) => ({
    start: new Date(points[i].at * 1000).toISOString(), stop: new Date(point.at * 1000).toISOString(),
    downtimeSeconds: point.at - points[i].at - (point.clock - points[i].clock),
  }));
  if (windows.some(w => w.downtimeSeconds < 0 || w.downtimeSeconds > (Date.parse(w.stop)-Date.parse(w.start))/1000)) return [whole];
  return windows;
}

async function observeToolkitClock({ load, save, latest }) {
  let journal = await load();
  if (journal && (journal.version !== 1 || !normalizeState(journal.latest) || !Array.isArray(journal.pairs))) throw new Error('upkeep_observations_invalid');
  if (!latest && !journal) return { clockWindows: [], clockStatus: 'upkeep_snapshot_unavailable' };
  const target = normalizeState(latest || journal.latest);
  if (!target) throw new Error('upkeep_snapshot_invalid');
  if (journal && ['faction', 'starbasePublicKey'].some(key => journal.latest[key] !== target[key])) throw new Error('upkeep_scope_mismatch');
  journal ||= { version: 1, latest: target, pairs: [] };
  const pairs = [];
  for (const pair of journal.pairs) {
    try {
      if (pair.target.observedAt < target.observedAt - RETENTION) continue;
      if (pair.target.faction !== target.faction || pair.target.starbasePublicKey !== target.starbasePublicKey) continue;
      compareToolkitClocks(pair.anchor, pair.target);
      pairs.push(pair);
    } catch (_) { /* One invalid window does not discard other observations. */ }
  }
  let status = pairs.length ? 'clock_observed' : 'baseline_only';
  if (target.slot > journal.latest.slot && target.observedAt > journal.latest.observedAt) {
    try { compareToolkitClocks(journal.latest, target); pairs.push({ anchor: journal.latest, target }); status = 'clock_observed'; }
    catch (error) { status = error.message; }
    journal.latest = target; // A failed pair is a local gap; the next pair can recover.
  }
  journal.pairs = pairs;
  if (latest) {
    try { await save(journal); } // Independent of Influx writes and signature availability.
    catch (_) { status = 'upkeep_observations_save_failed'; }
  } else status = 'upkeep_snapshot_unavailable';
  return { clockWindows: pairs.flatMap(splitToolkitClockWindow), clockStatus: status };
}
module.exports = { compareToolkitClocks, observeToolkitClock, splitToolkitClockWindow };
