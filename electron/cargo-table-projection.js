'use strict';

const crypto = require('node:crypto');
const { calculateTravelModeTime } = require('./earnings-math');

function projectCargoTableRow(row, { formatDate } = {}) {
  const isoDate = String(row?.isoDate || '').trim();
  const label = isoDate && typeof formatDate === 'function' ? formatDate(isoDate) : (row?.label || isoDate);
  return { ...row, isoDate, label };
}

function provisionalValuationTooltip(row) {
  const valuations = [row?.fuelValuation, row?.solValuation].filter((value) => value?.status === 'provisional');
  if (!valuations.length) return '';
  const pairs = Array.from(new Set(valuations.map((value) => `${value.eventDay} priced with ${value.priceDay}`)));
  return `Provisional: ${pairs.join('; ')} (frozen seed carry-forward)`;
}

function clean(value) { return String(value ?? '').trim(); }
function canonicalOperationalSection(assignment) {
  const value = clean(assignment).toLowerCase();
  if (value === 'scan' || value === 'scanning') return 'scanning';
  if (value === 'mine' || value === 'mining') return 'mining';
  if (value === 'cargo' || value === 'transport' || value === 'supply chain') return 'cargo';
  return null;
}
function operationalIdentity(row) {
  const isoDate = clean(row?.isoDate);
  const faction = clean(row?.faction);
  const instance = clean(row?.instance);
  const fleetAccount = clean(row?.fleetAccount);
  return isoDate && faction && instance && fleetAccount ? `${isoDate}\n${faction}\n${instance}\n${fleetAccount}` : '';
}
function finiteOrNull(value) { return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value); }
function sumKnown(rows, field) {
  const values = rows.map((row) => finiteOrNull(row?.[field])).filter((value) => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}
function oneKnown(rows, field) {
  const values = Array.from(new Set(rows.map((row) => clean(row?.[field])).filter(Boolean))).sort();
  return values.length === 1 ? values[0] : null;
}
function oneFinite(rows, field) {
  const values = Array.from(new Set(rows.map((row) => finiteOrNull(row?.[field])).filter((value) => value != null)));
  return values.length === 1 ? values[0] : null;
}

function aggregateOperationalCargoRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = operationalIdentity(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return new Map(Array.from(groups.entries()).map(([key, fragments]) => {
    const sorted = [...fragments].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const first = sorted[0];
    const completedCycleIds = Array.from(new Set(sorted.flatMap((row) => Array.isArray(row.completedCycleIds) ? row.completedCycleIds : []).map(clean).filter(Boolean))).sort();
    const starbases = Array.from(new Set(sorted.flatMap((row) => Array.isArray(row.starbases) ? row.starbases : []).map(clean).filter(Boolean))).sort();
    const travelTimeByMode = {
      warp: sorted.reduce((sum, row) => sum + Math.max(0, finiteOrNull(row?.travelTimeByMode?.warp) || 0), 0),
      subwarp: sorted.reduce((sum, row) => sum + Math.max(0, finiteOrNull(row?.travelTimeByMode?.subwarp) || 0), 0),
    };
    const explicitCycles = sumKnown(sorted, 'cargoCycles');
    const cargoCycles = completedCycleIds.length ? completedCycleIds.length : explicitCycles;
    const cargoLegs = sumKnown(sorted, 'cargoLegs');
    const cargoVolume = sumKnown(sorted, 'cargoVolume');
    return [key, {
      ...first,
      fleet: oneKnown(sorted, 'fleet'),
      assignment: oneKnown(sorted, 'assignment'),
      txsDaily: sumKnown(sorted, 'txsDaily'),
      completedCycleIds,
      cargoCycles,
      cargoLegs,
      starbases,
      travelTimeByMode,
      travelModeTime: calculateTravelModeTime(travelTimeByMode),
      travelModeWarpPercent: calculateTravelModeTime(travelTimeByMode)?.warpPercent ?? null,
      cargoVolume,
      fleetCargoCapacity: oneFinite(sorted, 'fleetCargoCapacity'),
    }];
  }));
}

function emptyCanonicalCost(operation) {
  const eventDay = clean(operation.isoDate);
  return {
    isoDate: eventDay,
    faction: clean(operation.faction),
    instance: clean(operation.instance),
    fleetAccount: clean(operation.fleetAccount),
    fleet: clean(operation.fleet),
    allocationKey: `fleet:${clean(operation.fleetAccount)}`,
    allocationStatus: 'scoped',
    sourceMode: 'canonical_raw',
    burnedFuelExact: '0',
    burnedFuel: 0,
    txFeeLamports: '0',
    txCostSolExact: '0',
    txCostSol: 0,
    txsDaily: finiteOrNull(operation.txsDaily) ?? 0,
    fuelValuation: { status: 'complete', amountATLExact: '0', amountATL: 0, eventDay, priceDay: eventDay, source: 'no_cost', provenance: 'No attributable Cargo fuel cost', estimated: false },
    solValuation: { status: 'complete', amountATLExact: '0', amountATL: 0, eventDay, priceDay: eventDay, source: 'no_cost', provenance: 'No attributable Cargo transaction fee', estimated: false },
    sourceIds: [],
  };
}

function joinCanonicalCostsWithOperationalRows({ legacyRows = [], costRows = [], operationalRows = [] } = {}) {
  const operations = aggregateOperationalCargoRows(operationalRows);
  const costs = new Map(costRows
    .filter((cost) => cost?.allocationStatus !== 'unallocated')
    .map((cost) => [operationalIdentity(cost), cost])
    .filter(([identity]) => identity));
  const canonical = Array.from(operations.entries())
    .filter(([, operation]) => canonicalOperationalSection(operation.assignment) === 'cargo')
    .map(([identity, operation]) => {
      const cost = costs.get(identity) || emptyCanonicalCost(operation);
      return {
        ...cost,
        fleet: operation.fleet,
        fleetAccount: operation.fleetAccount,
        faction: operation.faction,
        instance: operation.instance,
        isoDate: operation.isoDate,
        assignment: operation.assignment,
        txsDaily: finiteOrNull(cost.txsDaily) ?? finiteOrNull(operation.txsDaily) ?? 0,
        completedCycleIds: operation.completedCycleIds,
        cargoCycles: operation.cargoCycles ?? 0,
        cargoLegs: operation.cargoLegs ?? 0,
        starbases: operation.starbases,
        travelTimeByMode: operation.travelTimeByMode,
        travelModeTime: operation.travelModeTime,
        travelModeWarpPercent: operation.travelModeWarpPercent,
        cargoVolume: operation.cargoVolume ?? 0,
        fleetCargoCapacity: operation.fleetCargoCapacity,
        operationalStatus: 'joined',
        operationalReason: null,
      };
    })
    .sort((a, b) => clean(b.isoDate).localeCompare(clean(a.isoDate)) || clean(a.fleetAccount).localeCompare(clean(b.fleetAccount)));
  return [...legacyRows.filter((row) => canonicalOperationalSection(row?.assignment) === 'cargo'), ...canonical];
}

function operationalCargoDigest(rows = []) {
  return crypto.createHash('sha256').update(rows.map((row) => JSON.stringify(row)).join('\n')).digest('hex');
}

module.exports = { projectCargoTableRow, provisionalValuationTooltip, joinCanonicalCostsWithOperationalRows, operationalCargoDigest, aggregateOperationalCargoRows, canonicalOperationalSection };
