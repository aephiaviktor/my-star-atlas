'use strict';
const { MEASUREMENT, mergeClockObservations, sharedClockWindows } = require('./toolkit-clock-sharing');
const { reconcileToolkitHistory } = require('./starbase-upkeep-capacity');
// This boundary has no RPC, publication or timer capability. Legacy queues are read,
// never drained or rewritten. Only the disposable reader cache may be saved.
async function readToolkitEvidence({ faction, starbase, starbasePublicKey, readLocal, readRemote, saveCache, now = Math.floor(Date.now()/1000) }) {
  const scope = { faction, starbase, starbasePublicKey };
  const [old, shared, observations, cache] = await Promise.all(['', '.shared', '.observations', '.reader'].map(readLocal));
  const list = value => Array.isArray(value) ? value : [];
  let raw = [...list(shared?.observations), ...list(cache?.observations), observations?.latest,
    ...list(observations?.pairs).flatMap(p => [p?.anchor,p?.target])].filter(Boolean);
  let batches = [...list(old?.batches), ...list(cache?.batches)];
  let sharedReadStatus = 'shared_read_ok', status = 'shared_read_only';
  const results = await Promise.allSettled([readRemote(MEASUREMENT), readRemote('starbase_upkeep_state')]);
  if (results[0].status === 'fulfilled') raw.push(...list(results[0].value));
  else sharedReadStatus = 'upkeep_shared_read_failed';
  if (results[1].status === 'fulfilled') batches.push(...list(results[1].value));
  else status = 'upkeep_history_read_failed';
  raw = mergeClockObservations(raw, scope, now);
  const valid = new Map();
  for (const b of batches) {
    try {
      if (b.anchor?.faction !== faction || b.anchor?.starbasePublicKey !== starbasePublicKey || b.anchor?.starbase !== starbase || b.target?.observedAt < now-35*86400) continue;
      const replay = reconcileToolkitHistory({...b, deposits:b.events || b.deposits || []});
      valid.set(JSON.stringify([b.anchor,b.target,b.deposits || b.events]), {...b, ...replay});
    } catch (_) { /* Bad evidence affects only its own interval. */ }
  }
  // The table's interval sweep keeps only conflicting overlaps unknown.
  const intervals = [...valid.values()].flatMap(b=>b.intervals);
  try { await saveCache({version:1, observations:raw, batches:[...valid.values()]}); } catch (_) { /* Read result survives cache failure. */ }
  const clockWindows = sharedClockWindows(raw);
  return { intervals, clockWindows, clockStatus:clockWindows.length?'clock_observed':'baseline_only', sharedReadStatus, status };
}
module.exports = { readToolkitEvidence };
