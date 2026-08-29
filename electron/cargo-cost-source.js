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
    const fleetAccount = clean(record.fleetAccount);
    if (!isoDate) continue;
    const allocationStatus = fleetAccount ? 'scoped' : 'unallocated';
    const allocationKey = fleetAccount
      ? `fleet:${fleetAccount}`
      : `unallocated:v1:${record.faction}:${record.instance}:${isoDate}:${record.eventType}`;
    const key = `${isoDate}\n${allocationKey}`;
    if (!groups.has(key)) groups.set(key, { isoDate, faction: record.faction, instance: record.instance, fleetAccount, allocationKey, allocationStatus, eventType: fleetAccount ? null : record.eventType, fuel: [], lamports: 0n, transactions: 0, fuelValuations: [], solValuations: [], sourceIds: [], hasFuelCoverage: false, hasFeeCoverage: false });
    const group = groups.get(key);
    if (record.eventType === 'fuel') { group.fuel.push(record.fuelQuantity); group.hasFuelCoverage = true; }
    if (record.eventType === 'sol_fee') {
      group.lamports += BigInt(record.txFeeLamports);
      group.transactions += 1;
      group.hasFeeCoverage = true;
    }
    if (record.eventType === 'fuel') group.fuelValuations.push(record.valuation);
    if (record.eventType === 'sol_fee') group.solValuations.push(record.valuation);
    group.sourceIds.push(record.id);
  }
  return Array.from(groups.values()).map((group) => {
    const fuelQuantity = addExactDecimals(group.fuel);
    const txFeeLamports = String(group.lamports);
    const txCostSolExact = lamportsToSolDecimal(txFeeLamports);
    const unallocated = group.allocationStatus === 'unallocated';
    const aggregateValuation = (valuations) => {
      if (!valuations.length) return null;
      if (valuations.some((value) => !value || value.status === 'incomplete')) {
        return { status: 'incomplete', amountATL: null, amountATLExact: null, eventDay: group.isoDate, priceDay: null, reason: valuations.find((value) => value?.reason)?.reason || 'historical_price_missing' };
      }
      const amountATLExact = addExactDecimals(valuations.map((value) => value.amountATLExact));
      const first = valuations[0];
      return { ...first, status: valuations.some((value) => value.status === 'provisional') ? 'provisional' : 'complete', amountATLExact, amountATL: Number(amountATLExact) };
    };
    return {
      isoDate: group.isoDate, timestamp: `${group.isoDate}T00:00:00.000Z`, faction: group.faction, instance: group.instance,
      fleet: unallocated ? null : group.fleetAccount, fleetAccount: group.fleetAccount,
      assignment: null, allocationKey: group.allocationKey, allocationStatus: group.allocationStatus,
      allocationReason: unallocated ? 'allocation_scope_missing' : null, eventType: group.eventType,
      burnedFuelExact: fuelQuantity, burnedFuel: Number(fuelQuantity),
      txFeeLamports, txCostSolExact, txCostSol: Number(txCostSolExact), txsDaily: group.transactions,
      starbases: [], completedCycleIds: [], cargoCycles: 0, cargoLegs: 0,
      travelModeTime: null, travelModeWarpPercent: null, sourceIds: group.sourceIds.sort(), sourceMode: 'canonical_raw',
      fuelValuation: aggregateValuation(group.fuelValuations), solValuation: aggregateValuation(group.solValuations),
      hasFuelCoverage: group.hasFuelCoverage, hasFeeCoverage: group.hasFeeCoverage,
    };
  });
}

function decimalUnits(value) {
  const text = clean(value) || '0';
  const [whole, fraction = ''] = text.split('.');
  return { units: BigInt(`${whole || '0'}${fraction}`), scale: fraction.length };
}

function unitsToDecimal(units, scale) {
  if (!scale) return String(units);
  const padded = String(units).padStart(scale + 1, '0');
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function multiplyExactDecimals(left, right) {
  const a = decimalUnits(left);
  const b = decimalUnits(right);
  return unitsToDecimal(a.units * b.units, a.scale + b.scale);
}

function valueNativeCost(record, price) {
  const eventDay = utcDay(record.timestamp);
  if (!price || !['complete', 'provisional'].includes(price.status) || !exactPositiveDecimal(price.priceATLExact ?? price.priceATL)) {
    return { status: 'incomplete', amountATL: null, amountATLExact: null, eventDay, priceDay: null, effectiveUtcDate: eventDay, reason: price?.reason || 'historical_price_missing' };
  }
  const priceATLExact = exactPositiveDecimal(price.priceATLExact ?? price.priceATL);
  const amountATLExact = record.eventType === 'fuel'
    ? multiplyExactDecimals(record.fuelQuantity, priceATLExact)
    : unitsToDecimal(BigInt(record.txFeeLamports) * decimalUnits(priceATLExact).units, decimalUnits(priceATLExact).scale + 9);
  return {
    status: price.status, amountATL: Number(amountATLExact), amountATLExact,
    eventDay, priceDay: price.priceDay || price.effectiveUtcDate,
    effectiveUtcDate: eventDay, priceATLExact,
    source: price.source, provenance: price.provenance, estimated: price.estimated,
  };
}

function requireSameDateCargoPrice(price, isoDate) {
  const eventDay = clean(isoDate);
  const priceATL = Number(price?.priceATLExact ?? price?.priceATL);
  if (!price || !eventDay || !Number.isFinite(priceATL) || priceATL <= 0 || !['complete', 'provisional'].includes(price.status)) {
    return { status: 'incomplete', priceATL: null, priceATLExact: null, priceDay: null, effectiveUtcDate: eventDay, reason: 'same_date_price_missing' };
  }
  return price;
}

function requireCargoFuelPrice(price, isoDate) {
  const eventDay = clean(isoDate);
  const priceDay = clean(price?.priceDay || price?.effectiveUtcDate);
  const effectiveUtcDate = clean(price?.effectiveUtcDate);
  const priceATL = Number(price?.priceATLExact ?? price?.priceATL);
  const approved = ['complete', 'provisional'].includes(price?.status) && effectiveUtcDate === eventDay;
  if (!eventDay || !Number.isFinite(priceATL) || priceATL <= 0 || !approved) {
    return {
      status: 'incomplete', priceATL: null, priceATLExact: null,
      priceDay: priceDay || null, effectiveUtcDate: eventDay,
      source: price?.source, reason: 'cargo_fuel_price_unavailable',
    };
  }
  return price;
}

function exactShares(total, weights) {
  const { units, scale } = decimalUnits(total);
  const normalized = weights.map((weight) => decimalUnits(String(Math.max(0, Number(weight) || 0))));
  const weightScale = normalized.reduce((max, row) => Math.max(max, row.scale), 0);
  const weightUnits = normalized.map((row) => row.units * (10n ** BigInt(weightScale - row.scale)));
  const weightTotal = weightUnits.reduce((sum, value) => sum + value, 0n);
  const shares = weightUnits.map((weight) => weightTotal ? (units * weight) / weightTotal : 0n);
  const receiver = weightTotal ? weightUnits.findLastIndex((weight) => weight > 0n) : 0;
  shares[receiver < 0 ? 0 : receiver] += units - shares.reduce((sum, value) => sum + value, 0n);
  return shares.map((share) => unitsToDecimal(share, scale));
}

function applyRawCostsToCargoAllocations(rows = [], rawDailyRows = [], cutoverUtc = RAW_COST_CUTOVER_UTC) {
  const cutoverDay = utcDay(cutoverUtc);
  const rawByFleetDay = new Map();
  for (const row of rawDailyRows.filter((entry) => entry.allocationStatus !== 'unallocated' && clean(entry.fleetAccount))) {
    const key = `${row.isoDate}\n${clean(row.fleetAccount)}`;
    if (!rawByFleetDay.has(key)) rawByFleetDay.set(key, []);
    rawByFleetDay.get(key).push(row);
  }
  const groups = new Map();
  for (const row of rows) {
    if (clean(row.isoDate) < cutoverDay) continue;
    const key = `${row.isoDate}\n${clean(row.fleetAccount || row.fleet)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const replacements = new Map();
  for (const [key, group] of groups) {
    const candidates = (rawByFleetDay.get(key) || []).filter((raw) => !clean(group[0]?.faction) || !clean(raw.faction) || clean(raw.faction) === clean(group[0].faction));
    const ambiguous = candidates.length > 1;
    const raw = candidates.length === 1 ? candidates[0] : null;
    const weights = group.map((row) => Math.max(0, Number(row.cargoVolume) || Number(row.amount) || 0));
    const hasFuelEvidence = Boolean(raw) && raw.hasFuelCoverage !== false;
    const hasTxEvidence = Boolean(raw) && raw.hasFeeCoverage !== false;
    const validFuel = hasFuelEvidence && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(clean(raw.burnedFuelExact));
    const validTx = hasTxEvidence && /^\d+$/.test(clean(raw.txFeeLamports));
    const fuelInvalid = ambiguous || (hasFuelEvidence && !validFuel);
    const txInvalid = ambiguous || (hasTxEvidence && !validTx);
    const fuelShares = validFuel ? exactShares(raw.burnedFuelExact, weights) : null;
    const lamportShares = validTx ? exactShares(raw.txFeeLamports, weights) : null;
    group.forEach((row, index) => {
      const persistedFuelAvailable = row.allocatedFuel != null && Number.isFinite(Number(row.allocatedFuel));
      const persistedTxAvailable = row.allocatedTxCostSol != null && Number.isFinite(Number(row.allocatedTxCostSol));
      const allocatedFuelExact = fuelShares?.[index] ?? null;
      const allocatedTxFeeLamports = lamportShares?.[index] ?? null;
      const allocatedTxCostSolExact = allocatedTxFeeLamports == null ? null : lamportsToSolDecimal(allocatedTxFeeLamports);
      const fuelAllocationStatus = fuelInvalid ? 'invalid' : validFuel ? (Number(allocatedFuelExact) === 0 ? 'canonical_zero' : 'canonical') : persistedFuelAvailable ? 'fallback' : 'unavailable';
      const txAllocationStatus = txInvalid ? 'invalid' : validTx ? (allocatedTxFeeLamports === '0' ? 'canonical_zero' : 'canonical') : persistedTxAvailable ? 'fallback' : 'unavailable';
      const fuelAllocationReason = fuelInvalid ? (ambiguous ? 'canonical_evidence_ambiguous' : 'canonical_evidence_invalid') : validFuel ? null : persistedFuelAvailable ? 'persisted_allocation_fallback_canonical_missing' : 'allocation_and_canonical_missing';
      const txAllocationReason = txInvalid ? (ambiguous ? 'canonical_evidence_ambiguous' : 'canonical_evidence_invalid') : validTx ? null : persistedTxAvailable ? 'persisted_allocation_fallback_canonical_missing' : 'allocation_and_canonical_missing';
      const fuelCanonical = fuelAllocationStatus === 'canonical' || fuelAllocationStatus === 'canonical_zero';
      const txCanonical = txAllocationStatus === 'canonical' || txAllocationStatus === 'canonical_zero';
      replacements.set(row, {
        ...row,
        allocatedFuelExact: fuelCanonical ? allocatedFuelExact : null,
        allocatedFuel: fuelInvalid ? null : fuelCanonical ? Number(allocatedFuelExact) : persistedFuelAvailable ? Number(row.allocatedFuel) : null,
        allocatedTxFeeLamports: txCanonical ? allocatedTxFeeLamports : null,
        allocatedTxCostSolExact: txCanonical ? allocatedTxCostSolExact : null,
        allocatedTxCostSol: txInvalid ? null : txCanonical ? Number(allocatedTxCostSolExact) : persistedTxAvailable ? Number(row.allocatedTxCostSol) : null,
        fuelAllocationStatus, fuelAllocationReason, txAllocationStatus, txAllocationReason,
        sourceMode: fuelCanonical && txCanonical ? 'canonical_raw' : (fuelCanonical || txCanonical) ? 'mixed_cost_source' : (fuelInvalid || txInvalid) ? 'raw_invalid' : (persistedFuelAvailable || persistedTxAvailable) ? 'allocation_fallback' : 'raw_missing',
        allocationCostStatus: ['invalid', 'unavailable'].includes(fuelAllocationStatus) || ['invalid', 'unavailable'].includes(txAllocationStatus) ? 'unavailable' : 'available',
        allocationCostReason: fuelAllocationReason || txAllocationReason,
      });
    });
  }
  return rows.map((row) => replacements.get(row) || row);
}

async function valueCanonicalRawCosts(records, { resolvePrice, resolveFuelPrice } = {}) {
  const resolver = resolvePrice || resolveFuelPrice;
  return Promise.all(records.map(async (record) => {
    if (typeof resolver !== 'function') return record;
    const asset = record.eventType === 'fuel' ? 'Fuel' : 'SOL';
    const result = await resolver(asset, utcDay(record.timestamp));
    return { ...record, valuation: valueNativeCost(record, result) };
  }));
}

function buildCanonicalRawCostPool(records = [], rejected = []) {
  return {
    costs: records.map((record) => ({
      id: record.id, fleet: clean(record.fleetAccount) || null,
      allocationKey: clean(record.fleetAccount) ? `fleet:${clean(record.fleetAccount)}` : `unallocated:v1:${record.faction}:${record.instance}:${utcDay(record.timestamp)}:${record.eventType}`,
      allocationStatus: clean(record.fleetAccount) ? 'scoped' : 'unallocated',
      allocationReason: clean(record.fleetAccount) ? null : 'allocation_scope_missing',
      utcDate: utcDay(record.timestamp), kind: record.eventType === 'fuel' ? 'fuel' : 'transaction_fee',
      sourceIdentity: record.eventIdentity, amount: record.eventType === 'fuel' ? record.fuelQuantity : record.txFeeLamports,
      currency: record.eventType === 'fuel' ? 'FUEL' : 'LAMPORTS', timestamp: record.timestamp,
      sourceId: record.eventIdentity, transactionSignature: record.transactionSignature,
      instructionIndex: record.eventPosition, valuation: record.valuation,
      native: record,
    })),
    references: records.map((record) => ({ costId: record.id, allocationKey: clean(record.fleetAccount) ? `fleet:${clean(record.fleetAccount)}` : `unallocated:v1:${record.faction}:${record.instance}:${utcDay(record.timestamp)}:${record.eventType}`, resourceMint: null, destination: null })),
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
  buildCanonicalRawCostPool, valueNativeCost, multiplyExactDecimals,
  requireSameDateCargoPrice, requireCargoFuelPrice,
};
