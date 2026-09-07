'use strict';
const crypto = require('node:crypto');
const { normalizeState } = require('./starbase-upkeep-capacity');
const { splitToolkitClockWindow } = require('./toolkit-clock-observations');
const MEASUREMENT = 'starbase_toolkit_clock_v1';
const RETENTION = 35 * 86400;
const FIELDS = ['faction', 'starbase', 'starbasePublicKey', 'slot', 'observedAt', 'globalTime', 'localTime', 'balance', 'depletionRate', 'reserve', 'level'];
function canonicalObservation(raw, scope) {
  const state = normalizeState(raw);
  if (!state || state.faction !== scope.faction || state.starbasePublicKey !== scope.starbasePublicKey || state.starbase !== scope.starbase) return null;
  return Object.fromEntries(FIELDS.map(key => [key, state[key]]));
}
const observationId = state => crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
function formatClockObservation(state) {
  const tag = value => String(value).replace(/([ ,=])/g, '\\$1');
  const record = JSON.stringify(state).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${MEASUREMENT},faction=${tag(state.faction)},starbase=${tag(state.starbase)},address=${tag(state.starbasePublicKey)},observation=${observationId(state)} record="${record}" ${BigInt(state.observedAt) * 1000000000n}`;
}
function mergeClockObservations(raw, scope, now) {
  const unique = new Map();
  for (const row of raw) {
    const state = canonicalObservation(row, scope);
    if (state && state.observedAt >= now - RETENTION && state.observedAt <= now) unique.set(observationId(state), state);
  }
  return [...unique.values()].sort((a,b) => a.slot-b.slot || a.observedAt-b.observedAt || observationId(a).localeCompare(observationId(b)));
}
function sharedClockWindows(observations) {
  // Different payloads at one finalized slot conflict: don't bridge across them.
  const groups = new Map();
  for (const state of observations) {
    if (!groups.has(state.slot)) groups.set(state.slot, []);
    groups.get(state.slot).push(state);
  }
  const windows = []; let previous = null;
  for (const states of groups.values()) {
    if (states.length !== 1) { previous = null; continue; }
    const target = states[0];
    if (previous) {
      try { windows.push(...splitToolkitClockWindow({ anchor: previous, target })); }
      catch (_) { /* Invalid/configuration-changing pair is a gap, not lost history. */ }
    }
    previous = target;
  }
  return windows;
}
module.exports = { MEASUREMENT, canonicalObservation, observationId, formatClockObservation, mergeClockObservations, sharedClockWindows };

// Local outbox/cache is persisted before network work; remote imports are never
// republished. Same point bytes make retries safe after ambiguous HTTP failures.
async function syncSharedToolkitClocks({ load, save, local = [], scope, readRemote, publish, now = Math.floor(Date.now()/1000) }) {
  const stored = await load();
  if (stored && (stored.version !== 1 || stored.faction !== scope.faction || stored.starbasePublicKey !== scope.starbasePublicKey
      || !Array.isArray(stored.observations) || !Array.isArray(stored.localIds) || !Array.isArray(stored.publishedIds))) throw new Error('upkeep_shared_cache_invalid');
  const journal = stored || { version:1, faction:scope.faction, starbasePublicKey:scope.starbasePublicKey, observations:[], localIds:[], publishedIds:[] };
  journal.observations = mergeClockObservations([...journal.observations, ...local], scope, now);
  const ids = new Set(journal.observations.map(observationId));
  journal.localIds = [...new Set([...journal.localIds,...mergeClockObservations(local,scope,now).map(observationId)])].filter(id=>ids.has(id));
  journal.publishedIds = journal.publishedIds.filter(id=>ids.has(id));
  const result = { sharedReadStatus:readRemote ? 'shared_read_ok' : null, sharedWriteStatus:'shared_write_ok' };
  const persist = async () => {
    try { await save(journal); return true; }
    catch (_) { result.sharedWriteStatus='upkeep_shared_save_failed'; return false; }
  };
  const durable = await persist();
  if (readRemote) {
    try { journal.observations = mergeClockObservations([...journal.observations,...await readRemote()],scope,now); await persist(); }
    catch (_) { result.sharedReadStatus='upkeep_shared_read_failed'; }
  }
  const published = new Set(journal.publishedIds), owned = new Set(journal.localIds);
  const pending = journal.observations.filter(row=>owned.has(observationId(row)) && !published.has(observationId(row)));
  if (durable) {
    // Bound each pass; the persisted queue resumes at the next retry/refresh.
    for (let offset=0; offset<Math.min(pending.length,512); offset+=128) {
      const batch=pending.slice(offset,offset+128);
      try { await publish(batch.map(formatClockObservation).join('\n')); }
      catch (_) { result.sharedWriteStatus='upkeep_shared_publish_failed'; break; }
      for (const row of batch) published.add(observationId(row));
      journal.publishedIds=[...published];
      if (!await persist()) break;
    }
  }
  return { ...result, pendingObservations:pending.filter(row=>!published.has(observationId(row))).length,
    clockWindows:sharedClockWindows(journal.observations), sharedObservationCount:journal.observations.length };
}
module.exports.syncSharedToolkitClocks = syncSharedToolkitClocks;
