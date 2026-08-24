const { DELIVERY_EVIDENCE_FIELDS } = require('./cargo-delivery-evidence');

function parseCsvLine(line) {
  const columns = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      columns.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  columns.push(value);
  return columns;
}

function parseInfluxCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim().length);
  let header = null;
  const rows = [];
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const columns = parseCsvLine(line);
    // Annotated Flux CSV can start a new table with a different tag schema and
    // column order. Aggregate queries often omit `_field`, so key header
    // detection on the invariant metadata/system columns instead.
    if (columns.includes('result') && columns.includes('table')
      && (columns.includes('_value') || columns.includes('_time') || columns.includes('_field'))) {
      header = columns;
      continue;
    }
    if (!header) {
      header = columns;
      continue;
    }
    const row = {};
    header.forEach((name, index) => {
      row[name] = columns[index] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function isCargoCycleId(value) {
  return /^[^;]+;-?\d+,-?\d+;\d+$/.test(String(value || '').trim());
}

function cargoFleetAccountFromCycleId(value) {
  const account = String(value || '').trim().split(':', 1)[0];
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(account) ? account : null;
}

function enrichCargoAllocationRows(rows, fleetByLabel, normalizeFleetLabel, fleetByAccount = new Map()) {
  return rows.map((row) => {
    const authoritativeAccount = String(row?.fleetAccount || cargoFleetAccountFromCycleId(row?.cycleId) || '').trim();
    const fleet = (authoritativeAccount ? fleetByAccount.get(authoritativeAccount) : null)
      || (!authoritativeAccount ? fleetByLabel.get(normalizeFleetLabel(row.fleet)) : null);
    return {
      ...row,
      fleetName: row.fleet,
      fleetAccount: authoritativeAccount || fleet?.key || '',
      ownership: fleet?.ownership || '',
      relationship: fleet?.relationship || '',
      ships: fleet?.ships || [],
      shipTypes: fleet?.shipTypes || 0,
      totalRequiredCrew: fleet?.totalRequiredCrew ?? null,
    };
  });
}

function sumExactDecimals(values) {
  const parsed = values.map((value) => {
    const normalized = String(value ?? '0').trim();
    const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
    if (!match) return { units: 0n, scale: 0 };
    const fraction = match[3] || '';
    const units = BigInt(`${match[1]}${match[2]}${fraction}`);
    return { units, scale: fraction.length };
  });
  const scale = parsed.reduce((max, value) => Math.max(max, value.scale), 0);
  const units = parsed.reduce((sum, value) => sum + value.units * (10n ** BigInt(scale - value.scale)), 0n);
  if (scale === 0) return units.toString();
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const result = `${negative ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '');
  return result === '-0' ? '0' : result;
}

function groupCargoAllocationRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.isoDate}\n${row.fleet}\n${row.asset}\n${row.origin}\n${row.destination}\n${row.assignment}`;
    if (!groups.has(key)) {
      const group = { ...row, amount: 0, cargoVolume: 0, allocatedFuel: 0, allocatedTxCostSol: 0, fuelAllocationUnavailable: false, txAllocationUnavailable: false };
      if (row.allocatedFuelExact != null) group.allocatedFuelExact = '0';
      if (row.allocatedTxFeeLamports != null) group.allocatedTxFeeLamports = '0';
      groups.set(key, group);
    }
    const group = groups.get(key);
    group.amount += Number(row.amount) || 0;
    group.cargoVolume += Number(row.cargoVolume) || 0;
    if (row.allocatedFuel == null) group.fuelAllocationUnavailable = true;
    else group.allocatedFuel += Number(row.allocatedFuel) || 0;
    if (row.allocatedFuelExact != null) group.allocatedFuelExact = sumExactDecimals([group.allocatedFuelExact || '0', row.allocatedFuelExact]);
    if (row.allocatedTxCostSol == null) group.txAllocationUnavailable = true;
    else group.allocatedTxCostSol += Number(row.allocatedTxCostSol) || 0;
    if (row.allocatedTxFeeLamports != null) group.allocatedTxFeeLamports = (BigInt(group.allocatedTxFeeLamports || '0') + BigInt(row.allocatedTxFeeLamports)).toString();
  }
  return Array.from(groups.values()).map((group) => {
    const { fuelAllocationUnavailable, txAllocationUnavailable, ...row } = group;
    if (fuelAllocationUnavailable) { row.allocatedFuel = null; row.allocatedFuelExact = null; }
    if (txAllocationUnavailable) { row.allocatedTxCostSol = null; row.allocatedTxFeeLamports = null; }
    return row;
  });
}

function dedupeCargoAllocationFieldRows(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const cycleId = String(row?.cycleId || '').trim();
    const allocationIndex = String(row?.allocationIndex ?? '').trim();
    const field = String(row?._field || '').trim();
    if (!cycleId || !allocationIndex || !field) return true;
    const key = `${cycleId}\n${allocationIndex}\n${field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function utcDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function canonicalCargoUtcDay(row) {
  const timestamp = row?.timestamp ?? row?._time;
  if (timestamp != null && String(timestamp).trim()) return utcDateKey(timestamp);
  const isoDate = String(row?.isoDate || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? utcDateKey(`${isoDate}T00:00:00.000Z`) : '';
}

function cargoFleetDayIdentity(row) {
  const day = canonicalCargoUtcDay(row);
  const fleet = String(row?.fleetAccount || row?.fleet || '').trim().toLowerCase();
  const assignment = String(row?.assignment || '').trim().toLowerCase();
  return day && fleet && assignment ? `${day}\n${fleet}\n${assignment}` : '';
}

function buildCargoAllocationRecords(fieldRows = [], includedDays = null) {
  const grouped = new Map();
  for (const row of dedupeCargoAllocationFieldRows(fieldRows)) {
    const date = new Date(row?._time);
    const isoDate = utcDateKey(date);
    const fleet = String(row?.fleet || '').trim();
    if (!isoDate || (includedDays && !includedDays.has(isoDate)) || !fleet) continue;
    const asset = String(row?.rss || 'Unknown asset').trim() || 'Unknown asset';
    const assignment = String(row?.assignment || 'Unknown').trim() || 'Unknown';
    const origin = String(row?.originStarbase || '').trim() || '--';
    const destination = String(row?.deliveryStarbase || '').trim() || '--';
    const cycleId = String(row?.cycleId || '').trim();
    const key = `${isoDate}\n${fleet}\n${asset}\n${origin}\n${destination}\n${assignment}\n${cycleId}`;
    if (!grouped.has(key)) grouped.set(key, {
      isoDate,
      timestamp: date.toISOString(),
      label: isoDate,
      faction: String(row?.faction || '').trim(),
      instance: String(row?.instance || '').trim(),
      fleet,
      fleetAccount: cargoFleetAccountFromCycleId(cycleId) || '',
      asset,
      origin,
      destination,
      assignment,
      cycleId,
      amount: 0,
      cargoVolume: 0,
      allocatedFuel: 0,
      allocatedTxCostSol: 0,
    });
    const target = grouped.get(key);
    if (date.toISOString() < target.timestamp) target.timestamp = date.toISOString();
    const value = Number(row?._value);
    if (Number.isFinite(value) && Object.hasOwn(target, row?._field)) target[row._field] += value;
  }
  return Array.from(grouped.values()).sort((a, b) => b.isoDate.localeCompare(a.isoDate) || a.fleet.localeCompare(b.fleet) || a.asset.localeCompare(b.asset) || a.origin.localeCompare(b.origin) || a.destination.localeCompare(b.destination) || a.assignment.localeCompare(b.assignment));
}

function cargoAllocationUtcBatches({ now = new Date(), days = 30, batchDays = 5 } = {}) {
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isInteger(days) || days <= 0 || !Number.isInteger(batchDays) || batchDays <= 0 || Number.isNaN(current.getTime())) return [];
  const todayStart = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  const oldestMs = todayStart - (days - 1) * 86_400_000;
  const stopMs = todayStart + 86_400_000;
  const batches = [];
  for (let startMs = oldestMs; startMs < stopMs; startMs += batchDays * 86_400_000) {
    batches.push({
      start: new Date(startMs).toISOString(),
      stop: new Date(Math.min(stopMs, startMs + batchDays * 86_400_000)).toISOString(),
    });
  }
  return batches;
}

function cargoAllocationProcessingFailure(upstreamCount, downstreamCount, diagnostics = {}) {
  if (!(Number(upstreamCount) > 0) || Number(downstreamCount) !== 0) return '';
  return `cargo_allocation_processing_zero:${JSON.stringify(diagnostics)}`.slice(0, 240);
}

function buildCargoAllocationRecordsFromPivotRows(pivotRows = [], includedDays = null) {
  const records = new Map();
  for (const row of pivotRows) {
    const isoDate = utcDateKey(row?._time);
    const cycleId = String(row?.cycleId || '').trim();
    const allocationIndex = String(row?.allocationIndex ?? '').trim();
    const fleet = String(row?.fleet || '').trim();
    const fleetAccount = cargoFleetAccountFromCycleId(cycleId) || '';
    const numericFields = [row?.amount, row?.cargoVolume, row?.allocatedFuel, row?.allocatedTxCostSol];
    const [amount, cargoVolume, allocatedFuel, allocatedTxCostSol] = numericFields.map(Number);
    if (!isoDate || (includedDays && !includedDays.has(isoDate)) || !cycleId || !allocationIndex || !fleet || !fleetAccount
      || numericFields.some((value) => value == null || String(value).trim() === '')
      || ![amount, cargoVolume, allocatedFuel, allocatedTxCostSol].every(Number.isFinite)) continue;
    const key = `${cycleId}\n${allocationIndex}`;
    if (records.has(key)) continue;
    records.set(key, {
      isoDate,
      timestamp: new Date(row._time).toISOString(),
      label: isoDate,
      faction: String(row?.faction || '').trim(),
      instance: String(row?.instance || '').trim(),
      fleet,
      fleetAccount,
      asset: String(row?.rss || 'Unknown asset').trim() || 'Unknown asset',
      assetMint: String(row?.assetMint || '').trim(),
      origin: String(row?.originStarbase || '').trim() || '--',
      destination: String(row?.deliveryStarbase || '').trim() || '--',
      assignment: String(row?.assignment || 'Unknown').trim() || 'Unknown',
      cycleId,
      allocationIndex,
      amount,
      cargoVolume,
      allocatedFuel,
      allocatedTxCostSol,
      ...Object.fromEntries(DELIVERY_EVIDENCE_FIELDS
        .filter((field) => row?.[field] != null && String(row[field]).trim() !== '')
        .map((field) => [field, String(row[field]).trim()])),
    });
  }
  return Array.from(records.values()).sort((a, b) => b.isoDate.localeCompare(a.isoDate) || a.fleet.localeCompare(b.fleet) || a.asset.localeCompare(b.asset) || a.origin.localeCompare(b.origin) || a.destination.localeCompare(b.destination) || a.assignment.localeCompare(b.assignment) || a.cycleId.localeCompare(b.cycleId) || a.allocationIndex.localeCompare(b.allocationIndex));
}

function buildCargoRowsFromCompletedAllocations({ completionRows = [], allocationRows = [], includedDays = null } = {}) {
  const allocationsByCycle = new Map();
  for (const row of allocationRows) {
    const cycleId = String(row?.cycleId || '').trim();
    if (!cycleId) continue;
    if (!allocationsByCycle.has(cycleId)) allocationsByCycle.set(cycleId, []);
    allocationsByCycle.get(cycleId).push(row);
  }
  const rows = new Map();
  const seenCycles = new Set();
  for (const completion of completionRows) {
    const cycleId = String(completion?.cycleId || '').trim();
    const fleet = String(completion?.fleet || '').trim();
    const assignment = String(completion?.assignment || '').trim();
    const isoDate = utcDateKey(completion?._time);
    const cargoLegs = Number(completion?._value);
    const allocations = allocationsByCycle.get(cycleId) || [];
    const fleetAccount = cargoFleetAccountFromCycleId(cycleId) || '';
    if (!cycleId || seenCycles.has(cycleId) || !fleetAccount || !fleet || !assignment || !isoDate || (includedDays && !includedDays.has(isoDate)) || !Number.isFinite(cargoLegs) || cargoLegs <= 0 || !allocations.length) continue;
    seenCycles.add(cycleId);
    const key = `${isoDate}\n${fleetAccount.toLowerCase()}\n${assignment.toLowerCase()}`;
    if (!rows.has(key)) rows.set(key, {
      faction: String(completion?.faction || allocations[0]?.faction || '').trim(),
      instance: String(completion?.instance || allocations[0]?.instance || '').trim(),
      fleet,
      fleetAccount,
      assignment,
      isoDate,
      label: isoDate,
      starbases: [],
      burnedFuel: 0,
      txCostSol: 0,
      txsDaily: 0,
      cargoCycles: 0,
      cargoLegs: 0,
      cargoVolume: 0,
      completedCycleIds: [],
      travelModeTime: null,
      travelModeWarpPercent: null,
    });
    const target = rows.get(key);
    target.burnedFuel += allocations.reduce((sum, row) => sum + (Number(row.allocatedFuel) || 0), 0);
    target.txCostSol += allocations.reduce((sum, row) => sum + (Number(row.allocatedTxCostSol) || 0), 0);
    target.cargoVolume += allocations.reduce((sum, row) => sum + (Number(row.cargoVolume) || 0), 0);
    target.cargoCycles += 1;
    target.cargoLegs += cargoLegs;
    target.completedCycleIds.push(cycleId);
    target.starbases = Array.from(new Set([...target.starbases, ...allocations.flatMap((row) => [row.origin, row.destination]).filter((value) => value && value !== '--')])).sort();
  }
  return Array.from(rows.values());
}

function mergeCargoRowsWithCompletedAllocations({ movementRows = [], completionRows = [], allocationRows = [], includedDays = null } = {}) {
  const normalizedMovement = movementRows.map((row) => {
    const isoDate = canonicalCargoUtcDay(row);
    return { ...row, isoDate, label: row.label || isoDate };
  }).filter((row) => row.isoDate && (!includedDays || includedDays.has(row.isoDate)));
  const movementCycles = new Set(normalizedMovement.flatMap((row) => [
    ...(Array.isArray(row.movementCycleIds) ? row.movementCycleIds : []),
    ...(Array.isArray(row.completedCycleIds) ? row.completedCycleIds : []),
  ]).map((value) => String(value || '').trim()).filter(Boolean));
  const missingCompletions = completionRows.filter((row) => !movementCycles.has(String(row?.cycleId || '').trim()));
  const reconstructed = buildCargoRowsFromCompletedAllocations({ completionRows: missingCompletions, allocationRows, includedDays });
  const byIdentity = new Map(normalizedMovement.map((row) => [cargoFleetDayIdentity(row), { ...row }]));
  for (const row of reconstructed) {
    const key = cargoFleetDayIdentity(row);
    if (!key) continue;
    if (!byIdentity.has(key)) {
      byIdentity.set(key, { ...row, movementCycleIds: [] });
      continue;
    }
    const target = byIdentity.get(key);
    target.burnedFuel = (Number(target.burnedFuel) || 0) + (Number(row.burnedFuel) || 0);
    target.txCostSol = (Number(target.txCostSol) || 0) + (Number(row.txCostSol) || 0);
    target.cargoVolume = (Number(target.cargoVolume) || 0) + (Number(row.cargoVolume) || 0);
    target.cargoLegs = (Number(target.cargoLegs) || 0) + (Number(row.cargoLegs) || 0);
    target.completedCycleIds = Array.from(new Set([...(target.completedCycleIds || []), ...(row.completedCycleIds || [])]));
    target.cargoCycles = target.completedCycleIds.length;
    target.starbases = Array.from(new Set([...(target.starbases || []), ...(row.starbases || [])])).sort();
  }
  return Array.from(byIdentity.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

module.exports = { parseInfluxCsv, isCargoCycleId, cargoFleetAccountFromCycleId, groupCargoAllocationRows, enrichCargoAllocationRows, dedupeCargoAllocationFieldRows, buildCargoAllocationRecords, cargoAllocationUtcBatches, cargoAllocationProcessingFailure, buildCargoAllocationRecordsFromPivotRows, buildCargoRowsFromCompletedAllocations, canonicalCargoUtcDay, cargoFleetDayIdentity, mergeCargoRowsWithCompletedAllocations };
