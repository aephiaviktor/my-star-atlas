'use strict';

const crypto = require('node:crypto');

const MEASUREMENT = 'breakeven_basis_state';
const NULL_NUMBER = -9007199254740991;
const COST_FIELDS = Object.freeze([
  'scanningCostPerUnit', 'miningCostPerUnit', 'craftingCostPerUnit', 'lmCostPerUnit', 'gmCostPerUnit',
  'baseCostPerUnit', 'cargoCostPerUnit', 'landedCostPerUnit',
]);
const NUMBER_FIELDS = Object.freeze([
  'inventory', 'knownCostQuantity', 'uncostedQuantity', 'ledgerQuantity', 'quantityVariance', 'estimatedPercent',
  ...COST_FIELDS,
]);

function text(value) { return String(value || '').trim(); }
function factionText(value) { const valueText = text(value).toUpperCase(); return valueText === 'UST' ? 'USTUR' : valueText; }
function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function escapeTag(value) { return String(value).replace(/([ ,=])/g, '\\$1'); }
function escapeField(value) { return `"${String(value).replace(/(["\\])/g, '\\$1')}"`; }
function booleanValue(value) { return value === true || String(value).toLowerCase() === 'true'; }
function stateKey(row) { return `${factionText(row?.faction)}\n${text(row?.starbase)}\n${text(row?.asset)}`; }

function createBreakevenBasisState(input = {}) {
  const faction = factionText(input.faction);
  const starbase = text(input.starbase);
  const asset = text(input.asset);
  const date = new Date(input.timestamp);
  const inventory = finite(input.inventory);
  if (!faction || !starbase || !asset || Number.isNaN(date.getTime()) || inventory == null || inventory < 0) return null;
  const state = {
    faction, starbase, asset, timestamp: date.toISOString(), inventory,
    fullyTracked: booleanValue(input.fullyTracked),
    reconciliationStatus: text(input.reconciliationStatus) || (inventory === 0 ? 'empty' : 'unknown'),
  };
  for (const field of NUMBER_FIELDS) {
    if (field === 'inventory') continue;
    state[field] = finite(input[field]);
  }
  state.stateHash = crypto.createHash('sha256').update(JSON.stringify({
    faction, starbase, asset, inventory, fullyTracked: state.fullyTracked,
    reconciliationStatus: state.reconciliationStatus,
    ...Object.fromEntries(NUMBER_FIELDS.filter((field) => field !== 'inventory').map((field) => [field, state[field]])),
  })).digest('hex');
  return state;
}

function formatBreakevenBasisStateInfluxLine(input) {
  const state = createBreakevenBasisState(input);
  if (!state) return '';
  const tags = `faction=${escapeTag(state.faction)},starbase=${escapeTag(state.starbase)},asset=${escapeTag(state.asset)}`;
  const fields = [
    `stateHash=${escapeField(state.stateHash)}`, `timestampMs=${Date.parse(state.timestamp)}i`, `inventory=${state.inventory}`,
    `fullyTracked=${state.fullyTracked ? 'true' : 'false'}`,
    `reconciliationStatus=${escapeField(state.reconciliationStatus)}`,
    ...NUMBER_FIELDS.filter((field) => field !== 'inventory').map((field) => `${field}=${state[field] ?? NULL_NUMBER}`),
  ];
  return `${MEASUREMENT},${tags} ${fields.join(',')} ${BigInt(Date.parse(state.timestamp)) * 1000000n}`;
}

function projectBreakevenBasisStateRows(rows) {
  return (rows || []).flatMap((row) => {
    const normalized = { ...row };
    for (const field of NUMBER_FIELDS) {
      if (Number(normalized[field]) === NULL_NUMBER) normalized[field] = null;
    }
    const timestampMs = Number(row?.timestampMs);
    const state = createBreakevenBasisState({
      ...normalized,
      timestamp: Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : row?._time || row?.timestamp,
    });
    return state && (!row?.stateHash || row.stateHash === state.stateHash) ? [state] : [];
  });
}

function diffBreakevenBasisStates(currentRows, persistedRows, { faction, timestamp } = {}) {
  const current = new Map((currentRows || []).map((row) => {
    const state = createBreakevenBasisState({ ...row, faction, timestamp });
    return [stateKey(state), state];
  }).filter(([, state]) => state));
  const persisted = new Map((persistedRows || []).map((row) => [stateKey(row), row]));
  const changes = [];
  for (const [key, state] of current) {
    if (state.stateHash !== persisted.get(key)?.stateHash) changes.push(state);
  }
  for (const [key, previous] of persisted) {
    if (!key.startsWith(`${factionText(faction)}\n`) || current.has(key) || Number(previous.inventory) === 0) continue;
    changes.push(createBreakevenBasisState({
      faction, starbase: previous.starbase, asset: previous.asset, timestamp, inventory: 0,
      fullyTracked: true, reconciliationStatus: 'empty', knownCostQuantity: 0, uncostedQuantity: 0,
      ledgerQuantity: 0, quantityVariance: 0, estimatedPercent: 0,
    }));
  }
  return changes.sort((a, b) => stateKey(a).localeCompare(stateKey(b)));
}

function buildLatestBreakevenBasisStateFlux(bucket) {
  const safeBucket = String(bucket || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `from(bucket: "${safeBucket}")
  |> range(start: 0)
  |> filter(fn: (r) => r._measurement == "${MEASUREMENT}")
  |> group(columns: ["faction", "starbase", "asset", "_field"])
  |> last()
  |> group(columns: ["faction", "starbase", "asset"])
  |> pivot(rowKey: ["faction", "starbase", "asset"], columnKey: ["_field"], valueColumn: "_value")
  |> group()
  |> sort(columns: ["faction", "starbase", "asset"])`;
}

function buildHistoricalBreakevenBasisStateFlux(bucket, { stop } = {}) {
  const safeBucket = String(bucket || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const stopClause = stop ? `, stop: time(v: ${JSON.stringify(new Date(stop).toISOString())})` : '';
  return `from(bucket: "${safeBucket}")
  |> range(start: 0${stopClause})
  |> filter(fn: (r) => r._measurement == "${MEASUREMENT}")
  |> pivot(rowKey: ["_time", "faction", "starbase", "asset"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time", "faction", "starbase", "asset"])`;
}

function resolveBreakevenBasisAtOrBefore(states, { faction, starbase, asset, timestamp } = {}) {
  const targetMs = Date.parse(timestamp);
  if (!Number.isFinite(targetMs)) return null;
  const key = `${factionText(faction)}\n${text(starbase)}\n${text(asset)}`;
  let selected = null;
  for (const state of states || []) {
    if (stateKey(state) !== key) continue;
    const stateMs = Date.parse(state.timestamp);
    if (!Number.isFinite(stateMs) || stateMs > targetMs || Number(state.inventory) <= 0
      || !Number.isFinite(Number(state.landedCostPerUnit))) continue;
    if (!selected || stateMs > Date.parse(selected.timestamp)) selected = state;
  }
  return selected;
}

module.exports = {
  BREAKEVEN_BASIS_STATE_MEASUREMENT: MEASUREMENT, COST_FIELDS, stateKey,
  createBreakevenBasisState, formatBreakevenBasisStateInfluxLine, projectBreakevenBasisStateRows,
  diffBreakevenBasisStates, buildLatestBreakevenBasisStateFlux, buildHistoricalBreakevenBasisStateFlux,
  resolveBreakevenBasisAtOrBefore,
};
