'use strict';
const HOUR_MS = 3_600_000;
const finite = (v) => v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const integer = (v) => { const n = finite(v?.toString?.() ?? v); return Number.isSafeInteger(n) ? n : null; };
const timestampMs = (v) => { const n = Date.parse(String(v || '')); return Number.isFinite(n) ? n : null; };
const iso = (ms) => new Date(ms).toISOString();
const escapeTag = (v) => String(v).replace(/([ ,=])/g, '\\$1');

// Versioned evidence never treats the previous slowdown reconstruction as observed.
function normalizeState(raw) {
  if (!raw || !['MUD', 'ONI', 'USTUR'].includes(raw.faction) || !raw.starbase || !raw.starbasePublicKey) return null;
  const out = { ...raw };
  for (const key of ['slot', 'observedAt', 'globalTime', 'localTime', 'balance', 'depletionRate', 'reserve', 'level']) {
    out[key] = integer(raw[key]);
    if (out[key] == null || out[key] < 0) return null;
  }
  if (out.globalTime > out.observedAt || out.localTime > out.globalTime || out.level > 6) return null;
  // The SDK BN helper truncates fractional rates. Do not silently use that approximation.
  if (out.reserve > 0 && (!(out.depletionRate > 0) || out.depletionRate % 100 !== 0)) return null;
  return out;
}
function projectDecodedUpkeepState({ faction, starbase, starbasePublicKey, observedSlot, observedAt, decodedStarbase: sb, decodedGameState: gs }) {
  const level = integer(sb?.level), upkeep = gs?.fleet?.upkeep?.[`level${level}`];
  return normalizeState({ faction, starbase, starbasePublicKey, slot: observedSlot, observedAt, level,
    balance: sb?.upkeepToolkitBalance, globalTime: sb?.upkeepToolkitGlobalLastUpdate,
    localTime: sb?.upkeepToolkitLastUpdate, depletionRate: upkeep?.toolkitDepletionRate, reserve: upkeep?.toolkitReserve });
}
function projectClock(state, at) {
  if (!Number.isSafeInteger(at) || at < state.globalTime) throw new Error('upkeep_time_invalid');
  if (state.reserve === 0) return { ...state, globalTime: at, localTime: at };
  const rate = BigInt(state.depletionRate / 100);
  const elapsed = BigInt(Math.min(at - state.globalTime, at - state.localTime));
  const available = BigInt(state.balance) / rate;
  const active = elapsed < available ? elapsed : available;
  return { ...state, globalTime: at, localTime: state.localTime + Number(active), balance: state.balance - Number(active * rate) };
}
function stateIntervals(state, start, stop) {
  if (stop <= start) return [];
  const atStart = projectClock(state, start), atStop = projectClock(state, stop);
  const active = atStop.localTime - atStart.localTime;
  const result = [];
  if (active > 0) result.push({ start: iso(start * 1000), stop: iso((start + active) * 1000), multiplier: 1 });
  if (stop > start + active) result.push({ start: iso((start + active) * 1000), stop: iso(stop * 1000), multiplier: 0, toolkitEmpty: true });
  return result;
}
function reconcileToolkitHistory({ anchor: rawAnchor, target: rawTarget, deposits = [] }) {
  const anchor = normalizeState(rawAnchor), target = normalizeState(rawTarget);
  if (!anchor || !target) throw new Error('upkeep_state_invalid');
  for (const key of ['faction', 'starbase', 'starbasePublicKey', 'level', 'depletionRate', 'reserve']) {
    if (anchor[key] !== target[key]) throw new Error('upkeep_configuration_changed');
  }
  if (target.slot <= anchor.slot || target.observedAt < anchor.observedAt) throw new Error('upkeep_boundary_invalid');
  let state = anchor, cursor = anchor.observedAt;
  const intervals = [], events = [];
  for (const event of deposits) {
    const at = timestampMs(event.time) / 1000;
    if (!Number.isSafeInteger(at) || at < cursor || at > target.observedAt || event.slot <= anchor.slot || event.slot > target.slot || !(integer(event.amount) >= 0)) throw new Error('upkeep_deposit_boundary_invalid');
    intervals.push(...stateIntervals(state, cursor, at));
    state = projectClock(state, at);
    state.balance = Number(BigInt(state.balance) + BigInt(event.amount) > BigInt(state.reserve) ? BigInt(state.reserve) : BigInt(state.balance) + BigInt(event.amount));
    events.push({ ...state, ...event, observedAt: at });
    cursor = at;
  }
  intervals.push(...stateIntervals(state, cursor, target.observedAt));
  const predicted = projectClock(state, target.observedAt), observed = projectClock(target, target.observedAt);
  if (predicted.balance !== observed.balance || predicted.localTime !== observed.localTime) throw new Error('upkeep_clock_reconciliation_failed');
  return { intervals, events };
}
function decodeUpkeepInstruction(data, coder) {
  let decoded;
  try { decoded = coder?.decode(data, typeof data === 'string' ? 'base58' : undefined); } catch (_error) { return null; }
  if (decoded?.name !== 'depositStarbaseUpkeepResource') return null;
  const resourceType = integer(decoded.data?.input?.resourceType);
  const amount = integer(decoded.data?.input?.amount);
  return resourceType == null || amount == null || amount < 0 ? null : { resourceType, amount };
}

function decodeToolkitDepositsFromTransactions({ signatures = [], transactions = [], starbasePublicKey, programId, coder } = {}) {
  if (transactions.length !== signatures.length || transactions.some((transaction) => !transaction
      || !Number.isInteger(transaction.blockTime) || transaction.blockTime <= 0
      || !Number.isSafeInteger(transaction.slot) || transaction.slot < 0 || transaction.meta?.err)) {
    throw new Error('upkeep_transaction_not_observed');
  }
  const deposits = [];
  transactions.forEach((transaction, index) => {
    const outer = transaction.transaction?.message?.instructions || [];
    const inner = new Map((transaction.meta?.innerInstructions || []).map(entry => [entry.index, entry.instructions || []]));
    const ordered = outer.flatMap((instruction, i) => [instruction, ...(inner.get(i) || [])]);
    for (const [instructionIndex, instruction] of ordered.entries()) {
      if (!instruction?.data || String(instruction.programId || '') !== String(programId || '')) continue;
      const decoded = decodeUpkeepInstruction(instruction.data, coder);
      if (!decoded || decoded.resourceType !== 3) continue;
      const accounts = (instruction.accounts || []).map(String);
      if (accounts[1] !== String(starbasePublicKey || '')) continue;
      deposits.push({
        time: new Date(transaction.blockTime * 1000).toISOString(), amount: decoded.amount,
        signature: signatures[index].signature, slot: transaction.slot, instructionIndex, transactionIndex: signatures[index].transactionIndex ?? 0,
      });
    }
  });
  return deposits.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.slot - b.slot);
}

function splitCapacityIntervalsByUtcHour(intervals = []) {
  const byHour = new Map();
  for (const interval of intervals) {
    let cursor = timestampMs(interval.start), stop = timestampMs(interval.stop);
    const multiplier = finite(interval.multiplier);
    if (cursor == null || stop == null || stop <= cursor || multiplier == null || multiplier < 0 || multiplier > 1) continue;
    while (cursor < stop) {
      const hourStart = Math.floor(cursor / HOUR_MS) * HOUR_MS;
      const next = Math.min(stop, hourStart + HOUR_MS);
      const seconds = (next - cursor) / 1000;
      const hour = iso(hourStart).slice(0, 13);
      if (!byHour.has(hour)) byHour.set(hour, { hour, observedSeconds: 0, effectiveCapacitySeconds: 0, lostCapacitySeconds: 0, toolkitEmptySeconds: 0 });
      const row = byHour.get(hour);
      row.observedSeconds += seconds;
      row.effectiveCapacitySeconds += seconds * multiplier;
      row.lostCapacitySeconds += seconds * (1 - multiplier);
      if (interval.toolkitEmpty) row.toolkitEmptySeconds += seconds;
      cursor = next;
    }
  }
  return [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

function influxFloat(value) {
  const number = finite(value);
  if (number == null) return null;
  return Number.isInteger(number) ? `${number}.0` : String(number);
}

function formatCapacityHourLine(row) {
  const faction = String(row?.faction || '').trim(), starbase = String(row?.starbase || '').trim();
  const hourMs = Date.parse(`${String(row?.hour || '')}:00:00.000Z`);
  const observed = finite(row?.observedSeconds), effective = finite(row?.effectiveCapacitySeconds);
  const lost = finite(row?.lostCapacitySeconds), empty = finite(row?.toolkitEmptySeconds);
  if (!faction || !starbase || !Number.isFinite(hourMs) || !(observed >= 0) || !(effective >= 0) || !(lost >= 0) || !(empty >= 0)) return null;
  return `starbase_upkeep_capacity_hourly,model=toolkit-stop-v2,faction=${escapeTag(faction)},starbase=${escapeTag(starbase)} observedSeconds=${influxFloat(observed)},effectiveCapacitySeconds=${influxFloat(effective)},lostCapacitySeconds=${influxFloat(lost)},toolkitEmptySeconds=${influxFloat(empty)},complete=${observed >= 3600} ${BigInt(hourMs) * 1_000_000n}`;
}


module.exports = { normalizeState, projectDecodedUpkeepState, projectClock, reconcileToolkitHistory, decodeUpkeepInstruction, decodeToolkitDepositsFromTransactions, splitCapacityIntervalsByUtcHour, formatCapacityHourLine };

// Independent installations can publish overlapping validated windows. Merge agreement,
// but never select one conflicting clock history by arrival order.
function mergeToolkitIntervals(rows) {
  const events = [];
  for (const row of rows) {
    const start = timestampMs(row.start), stop = timestampMs(row.stop);
    if (start == null || stop == null || stop <= start || ![0, 1].includes(row.multiplier)) throw new Error('upkeep_interval_invalid');
    events.push({ time: start, value: row.multiplier, delta: 1 }, { time: stop, value: row.multiplier, delta: -1 });
  }
  events.sort((a,b)=>a.time-b.time);
  const counts = [0, 0], merged = [];
  let previous = null;
  for (let i = 0; i < events.length;) {
    const time = events[i].time;
    if (previous != null && time > previous && (counts[0] || counts[1])) {
      if (counts[0] && counts[1]) throw new Error('upkeep_history_conflict');
      const multiplier = counts[1] ? 1 : 0;
      const last = merged.at(-1);
      if (last?.stop === iso(previous) && last.multiplier === multiplier) last.stop = iso(time);
      else merged.push({ start: iso(previous), stop: iso(time), multiplier, toolkitEmpty: multiplier === 0 });
    }
    while (i < events.length && events[i].time === time) { counts[events[i].value] += events[i].delta; i += 1; }
    previous = time;
  }
  return merged;
}
module.exports.mergeToolkitIntervals = mergeToolkitIntervals;
