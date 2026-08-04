'use strict';

const crypto = require('node:crypto');

const RAW_COST_SCHEMA_VERSION = '1';
const RAW_COST_HISTORY_WINDOW = '-31d';
const RAW_COST_CUTOVER_MANIFEST_VERSION = 1;
const RAW_COST_CUTOVER_UTC = '2026-08-05T00:00:00.000Z';
const RAW_COST_CUTOVERS = Object.freeze({
  'MUD\nMUD': RAW_COST_CUTOVER_UTC,
  'ONI\nONI': RAW_COST_CUTOVER_UTC,
  'UST\nUSTUR2': RAW_COST_CUTOVER_UTC,
});

function clean(value) { return String(value ?? '').trim(); }
function exactUnsigned(value) { const text = clean(value); return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : ''; }
function exactPositiveDecimal(value) { const text = clean(value); return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && Number(text) > 0 ? text : ''; }
function immutableSourcePayload(record) {
  return JSON.stringify({
    schemaVersion: record.schemaVersion,
    eventType: record.eventType, eventIdentity: record.eventIdentity,
    timestamp: record.timestamp, timestampProvenance: record.timestampProvenance,
    sourceProvenance: record.sourceProvenance, faction: record.faction,
    instance: record.instance, fleetAccount: record.fleetAccount,
    fuelQuantity: record.fuelQuantity, movementEventId: record.movementEventId,
    cycleId: record.cycleId, movementIndex: record.movementIndex,
    txFeeLamports: record.txFeeLamports, transactionSignature: record.transactionSignature,
    eventPosition: record.eventPosition,
  });
}

function canonicalPayload(record) {
  return JSON.stringify({
    immutableSourcePayload: immutableSourcePayload(record),
    fleetLabel: record.fleetLabel,
    assignment: record.assignment,
  });
}

function canonicalRawCostIdentity(row) {
  return `cargo-cost-source:v${RAW_COST_SCHEMA_VERSION}:${clean(row.faction)}:${clean(row.instance)}:${clean(row.eventType)}:${clean(row.eventIdentity)}`;
}

function buildRawCostFluxQuery(bucket) {
  const escaped = clean(bucket).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `from(bucket: "${escaped}")\n  |> range(start: ${RAW_COST_HISTORY_WINDOW})\n  |> filter(fn: (r) => r._measurement == "cargo_cost_source_event_v1")\n  |> filter(fn: (r) => exists r.schemaVersion and r.schemaVersion == "${RAW_COST_SCHEMA_VERSION}")\n  |> pivot(rowKey: ["_time", "eventType", "eventIdentity", "schemaVersion"], columnKey: ["_field"], valueColumn: "_value")\n  |> keep(columns: ["_time", "eventType", "eventIdentity", "schemaVersion", "fuelQuantity", "movementEventId", "cycleId", "movementIndex", "txFeeLamports", "transactionSignature", "eventPosition", "timestampProvenance", "sourceProvenance", "faction", "instance", "fleetAccount", "fleetLabel", "assignment"])\n  |> sort(columns: ["_time", "eventIdentity"])`;
}

function projectRawCostEvents(rows = []) {
  const records = new Map();
  const conflicted = new Set();
  const rejected = [];
  for (const row of rows || []) {
    if (clean(row.schemaVersion) !== RAW_COST_SCHEMA_VERSION) continue;
    const eventType = clean(row.eventType);
    const eventIdentity = clean(row.eventIdentity);
    const faction = clean(row.faction);
    const instance = clean(row.instance);
    const timestamp = new Date(row._time);
    const commonValid = eventIdentity && faction && instance
      && !Number.isNaN(timestamp.getTime()) && clean(row.timestampProvenance)
      && clean(row.sourceProvenance);
    if (!commonValid) {
      rejected.push({ reason: eventIdentity ? 'invalid_source_event' : 'source_identity_missing', eventIdentity: eventIdentity || null });
      continue;
    }
    const record = {
      id: canonicalRawCostIdentity({ faction, instance, eventType, eventIdentity }),
      schemaVersion: 1, eventType, eventIdentity, faction, instance,
      timestamp: timestamp.toISOString(), timestampProvenance: clean(row.timestampProvenance),
      sourceProvenance: clean(row.sourceProvenance), fleetAccount: clean(row.fleetAccount),
      fleetLabel: clean(row.fleetLabel), assignment: clean(row.assignment),
      fuelQuantity: null, movementEventId: null, cycleId: null, movementIndex: null,
      txFeeLamports: null, transactionSignature: null, eventPosition: null,
      valuation: { status: 'incomplete', amountATL: null },
    };
    if (eventType === 'fuel') {
      const quantity = exactPositiveDecimal(row.fuelQuantity);
      const movementIndex = exactUnsigned(row.movementIndex);
      if (!quantity || !clean(row.movementEventId) || !clean(row.cycleId) || !movementIndex) {
        rejected.push({ reason: 'invalid_source_event', eventIdentity });
        continue;
      }
      Object.assign(record, { fuelQuantity: quantity, movementEventId: clean(row.movementEventId), cycleId: clean(row.cycleId), movementIndex });
    } else if (eventType === 'sol_fee') {
      const lamports = exactUnsigned(row.txFeeLamports);
      const position = clean(row.eventPosition);
      if (!lamports || lamports === '0' || !clean(row.transactionSignature) || (position && !exactUnsigned(position))) {
        rejected.push({ reason: 'invalid_source_event', eventIdentity });
        continue;
      }
      Object.assign(record, { txFeeLamports: lamports, transactionSignature: clean(row.transactionSignature), eventPosition: position ? exactUnsigned(position) : null });
    } else {
      rejected.push({ reason: 'invalid_source_event', eventIdentity });
      continue;
    }
    const existing = records.get(record.id);
    if (existing && immutableSourcePayload(existing) !== immutableSourcePayload(record)) {
      records.delete(record.id);
      conflicted.add(record.id);
      rejected.push({ reason: 'source_identity_conflict', eventIdentity, id: record.id });
      continue;
    }
    if (!conflicted.has(record.id) && (!existing || canonicalPayload(record) < canonicalPayload(existing))) {
      records.set(record.id, record);
    }
  }
  return { records: Array.from(records.values()), rejected };
}

function getRawCostCutover(faction, instance) { return RAW_COST_CUTOVERS[`${clean(faction)}\n${clean(instance)}`] || null; }
function utcDay(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10); }

function selectLegacyRawCutover({ legacyRows = [], rawRecords = [], faction, instance } = {}) {
  const cutover = getRawCostCutover(faction, instance);
  if (!cutover) return { cutover: null, legacyRows: [...legacyRows], rawRecords: [], trackingDisabled: clean(instance) === 'USTUR1' };
  const cutoverDay = utcDay(cutover);
  return {
    cutover,
    legacyRows: legacyRows.filter((row) => clean(row.isoDate || utcDay(row.timestamp)) < cutoverDay),
    rawRecords: rawRecords.filter((row) => clean(row.faction) === clean(faction) && clean(row.instance) === clean(instance) && new Date(row.timestamp).getTime() >= Date.parse(cutover)),
    trackingDisabled: false,
  };
}

function lamportsToSolDecimal(lamports) {
  const value = BigInt(exactUnsigned(lamports) || '0');
  const whole = value / 1000000000n;
  const fraction = String(value % 1000000000n).padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function exporterForFaction(faction) {
  const value = clean(faction).toUpperCase();
  if (value === 'MUD') return { faction: 'MUD', instance: 'MUD' };
  if (value === 'ONI') return { faction: 'ONI', instance: 'ONI' };
  if (value === 'UST' || value === 'USTUR') return { faction: 'UST', instance: 'USTUR2' };
  return null;
}

function addExactDecimals(values) {
  const normalized = values.map(exactPositiveDecimal).filter(Boolean);
  const scale = normalized.reduce((max, value) => Math.max(max, (value.split('.')[1] || '').length), 0);
  const total = normalized.reduce((sum, value) => {
    const [whole, fraction = ''] = value.split('.');
    return sum + BigInt(whole + fraction.padEnd(scale, '0'));
  }, 0n);
  if (!scale) return String(total);
  const padded = String(total).padStart(scale + 1, '0');
  const result = `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return result;
}

function aggregateRawCostsByFleetDay(records = []) {
  const groups = new Map();
  for (const record of records) {
    const isoDate = utcDay(record.timestamp);
    const fleet = clean(record.fleetAccount || record.fleetLabel);
    if (!isoDate || !fleet) continue;
    const key = `${isoDate}\n${fleet}`;
    if (!groups.has(key)) groups.set(key, { isoDate, fleet, fleetAccount: clean(record.fleetAccount), fleetLabel: clean(record.fleetLabel), assignments: new Set(), fuel: [], lamports: 0n, sourceIds: [] });
    const group = groups.get(key);
    if (clean(record.assignment)) group.assignments.add(clean(record.assignment));
    if (record.eventType === 'fuel') group.fuel.push(record.fuelQuantity);
    if (record.eventType === 'sol_fee') group.lamports += BigInt(record.txFeeLamports);
    group.sourceIds.push(record.id);
  }
  return Array.from(groups.values()).map((group) => {
    const fuelQuantity = addExactDecimals(group.fuel);
    const txFeeLamports = String(group.lamports);
    const txCostSolExact = lamportsToSolDecimal(txFeeLamports);
    return {
      isoDate: group.isoDate, timestamp: `${group.isoDate}T00:00:00.000Z`,
      fleet: group.fleetLabel || group.fleet, fleetAccount: group.fleetAccount,
      assignment: group.assignments.size === 1 ? Array.from(group.assignments)[0] : 'Transport',
      burnedFuelExact: fuelQuantity, burnedFuel: Number(fuelQuantity),
      txFeeLamports, txCostSolExact, txCostSol: Number(txCostSolExact), txsDaily: 0,
      starbases: [], completedCycleIds: [], cargoCycles: 0, cargoLegs: 0,
      travelModeTime: null, travelModeWarpPercent: null, sourceIds: group.sourceIds.sort(), sourceMode: 'canonical_raw',
    };
  });
}

function applyRawCostsToCargoAllocations(rows = [], rawDailyRows = [], cutoverUtc = RAW_COST_CUTOVER_UTC) {
  const cutoverDay = utcDay(cutoverUtc);
  const rawByFleetDay = new Map(rawDailyRows.map((row) => [`${row.isoDate}\n${clean(row.fleetAccount || row.fleet)}`, row]));
  const groups = new Map();
  for (const row of rows) {
    if (clean(row.isoDate) < cutoverDay) continue;
    const key = `${row.isoDate}\n${clean(row.fleetAccount || row.fleet)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const replacements = new Map();
  for (const [key, group] of groups) {
    const raw = rawByFleetDay.get(key);
    const totalWeight = group.reduce((sum, row) => sum + Math.max(0, Number(row.cargoVolume) || Number(row.amount) || 0), 0);
    group.forEach((row, index) => {
      const weight = Math.max(0, Number(row.cargoVolume) || Number(row.amount) || 0);
      const ratio = totalWeight > 0 ? weight / totalWeight : (index === 0 ? 1 : 0);
      replacements.set(row, { ...row, allocatedFuel: raw ? raw.burnedFuel * ratio : 0, allocatedTxCostSol: raw ? raw.txCostSol * ratio : 0, sourceMode: raw ? 'canonical_raw' : 'raw_missing' });
    });
  }
  return rows.map((row) => replacements.get(row) || row);
}

async function valueCanonicalRawCosts(records, { resolveFuelPrice } = {}) {
  return Promise.all(records.map(async (record) => {
    if (record.eventType !== 'fuel' || typeof resolveFuelPrice !== 'function') return record;
    const result = await resolveFuelPrice('Fuel', utcDay(record.timestamp));
    return { ...record, valuation: result?.status === 'complete'
      ? { status: 'complete', amountATL: Number(record.fuelQuantity) * result.priceATL, effectiveUtcDate: result.effectiveUtcDate, source: result.source, provenance: result.provenance, estimated: result.estimated }
      : { status: 'incomplete', amountATL: null, effectiveUtcDate: utcDay(record.timestamp) } };
  }));
}

function buildCanonicalRawCostPool(records = [], rejected = []) {
  return {
    costs: records.map((record) => ({
      id: record.id, fleet: record.fleetAccount || record.fleetLabel,
      utcDate: utcDay(record.timestamp), kind: record.eventType === 'fuel' ? 'fuel' : 'transaction_fee',
      sourceIdentity: record.eventIdentity, amount: record.eventType === 'fuel' ? record.fuelQuantity : record.txFeeLamports,
      currency: record.eventType === 'fuel' ? 'FUEL' : 'LAMPORTS', timestamp: record.timestamp,
      sourceId: record.eventIdentity, transactionSignature: record.transactionSignature,
      instructionIndex: record.eventPosition, valuation: record.valuation,
      native: record,
    })),
    references: records.map((record) => ({ costId: record.id, assignment: record.assignment || null, resourceMint: null, destination: null })),
    pending: rejected.map((entry) => ({ status: 'data_quality_failure', ...entry })),
  };
}

function rawCostDigest(records = []) {
  return crypto.createHash('sha256').update(records.map((record) => canonicalPayload(record)).sort().join('\n')).digest('hex');
}

module.exports = {
  RAW_COST_SCHEMA_VERSION, RAW_COST_HISTORY_WINDOW, RAW_COST_CUTOVER_MANIFEST_VERSION,
  RAW_COST_CUTOVER_UTC, RAW_COST_CUTOVERS, buildRawCostFluxQuery, canonicalRawCostIdentity,
  projectRawCostEvents, selectLegacyRawCutover, getRawCostCutover, lamportsToSolDecimal, rawCostDigest,
  exporterForFaction, aggregateRawCostsByFleetDay, applyRawCostsToCargoAllocations, valueCanonicalRawCosts,
  buildCanonicalRawCostPool,
};
