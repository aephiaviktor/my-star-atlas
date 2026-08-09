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
    burnedFuelExact: null,
    burnedFuel: null,
    txFeeLamports: null,
    txCostSolExact: null,
    txCostSol: null,
    txsDaily: finiteOrNull(operation.txsDaily) ?? 0,
    fuelValuation: { status: 'unavailable', amountATLExact: null, amountATL: null, eventDay, priceDay: null, source: 'missing_raw_cost_evidence', provenance: 'No matching canonical Cargo fuel evidence', estimated: false },
    solValuation: { status: 'unavailable', amountATLExact: null, amountATL: null, eventDay, priceDay: null, source: 'missing_raw_cost_evidence', provenance: 'No matching canonical Cargo transaction-fee evidence', estimated: false },
    sourceIds: [],
  };
}

function selectCutoverOwnedCargoRows({ legacyRows = [], operationalRows = [], cutover = null } = {}) {
  const cutoverDay = clean(cutover).slice(0, 10);
  if (!cutoverDay) return { legacyRows: [...legacyRows], operationalRows: [] };
  return {
    legacyRows: legacyRows.filter((row) => clean(row?.isoDate) < cutoverDay),
    operationalRows: operationalRows.filter((row) => clean(row?.isoDate) >= cutoverDay),
  };
}

function projectCargoFleetDateRows(rows = [], { profile = '', faction = '', selectedDate = '' } = {}) {
  const expectedProfile = clean(profile);
  const expectedFaction = clean(faction).toUpperCase();
  const requestedDate = clean(selectedDate);
  const groups = new Map();
  for (const row of rows) {
    const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(clean(row?.isoDate)) ? clean(row.isoDate) : '';
    const fleetAccount = clean(row?.fleetAccount);
    const rowProfile = clean(row?.profile || expectedProfile);
    const rowFaction = clean(row?.faction || expectedFaction).toUpperCase();
    if (!isoDate || !fleetAccount || (requestedDate && isoDate !== requestedDate)
      || (expectedProfile && rowProfile !== expectedProfile)
      || (expectedFaction && rowFaction !== expectedFaction)) continue;
    const key = `${rowProfile}\n${rowFaction}\n${fleetAccount}\n${isoDate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, profile: rowProfile, faction: rowFaction, fleetAccount, isoDate });
  }
  const sumFields = ['burnedFuel', 'fuelCostsAtlas', 'txCostSol', 'txsCostsAtlas', 'totalCostsAtlas', 'txsDaily', 'cargoCycles', 'cargoLegs', 'cargoVolume'];
  return Array.from(groups.values()).map((fragments) => {
    const sorted = [...fragments].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const first = sorted[0];
    const result = { ...first };
    for (const field of sumFields) result[field] = sumKnown(sorted, field);
    const names = Array.from(new Set(sorted.map((row) => clean(row.fleetName || row.fleet)).filter(Boolean))).sort();
    result.fleetName = names[0] || first.fleetAccount;
    result.fleet = result.fleetName;
    const assignments = Array.from(new Set(sorted.map((row) => clean(row.assignment)).filter(Boolean))).sort();
    result.assignment = assignments.length === 1 ? assignments[0] : (assignments.length ? 'Mixed' : null);
    result.completedCycleIds = Array.from(new Set(sorted.flatMap((row) => Array.isArray(row.completedCycleIds) ? row.completedCycleIds : []).map(clean).filter(Boolean))).sort();
    result.starbases = Array.from(new Set(sorted.flatMap((row) => Array.isArray(row.starbases) ? row.starbases : []).map(clean).filter(Boolean))).sort();
    result.starbaseLabel = result.starbases.length ? result.starbases.join(', ') : '--';
    result.timestamp = sorted.map((row) => clean(row.timestamp)).filter(Boolean).sort()[0] || `${result.isoDate}T00:00:00.000Z`;
    return result;
  }).sort((a, b) => clean(b.isoDate).localeCompare(clean(a.isoDate)) || clean(a.fleetAccount).localeCompare(clean(b.fleetAccount)));
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
      const matchedCost = costs.get(identity);
      const cost = matchedCost || emptyCanonicalCost(operation);
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
        costEvidenceStatus: matchedCost ? 'available' : 'unavailable',
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

module.exports = { projectCargoTableRow, provisionalValuationTooltip, joinCanonicalCostsWithOperationalRows, operationalCargoDigest, aggregateOperationalCargoRows, canonicalOperationalSection, selectCutoverOwnedCargoRows, projectCargoFleetDateRows };
