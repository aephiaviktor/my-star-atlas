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

function enrichCargoAllocationRows(rows, fleetByLabel, normalizeFleetLabel) {
  return rows.map((row) => {
    const fleet = fleetByLabel.get(normalizeFleetLabel(row.fleet));
    return {
      ...row,
      fleetName: row.fleet,
      fleetAccount: fleet?.key || '',
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
      const group = { ...row, amount: 0, cargoVolume: 0, allocatedFuel: 0, allocatedTxCostSol: 0 };
      if (row.allocatedFuelExact != null) group.allocatedFuelExact = '0';
      if (row.allocatedTxFeeLamports != null) group.allocatedTxFeeLamports = '0';
      groups.set(key, group);
    }
    const group = groups.get(key);
    group.amount += Number(row.amount) || 0;
    group.cargoVolume += Number(row.cargoVolume) || 0;
    group.allocatedFuel += Number(row.allocatedFuel) || 0;
    if (row.allocatedFuelExact != null) group.allocatedFuelExact = sumExactDecimals([group.allocatedFuelExact || '0', row.allocatedFuelExact]);
    group.allocatedTxCostSol += Number(row.allocatedTxCostSol) || 0;
    if (row.allocatedTxFeeLamports != null) group.allocatedTxFeeLamports = (BigInt(group.allocatedTxFeeLamports || '0') + BigInt(row.allocatedTxFeeLamports)).toString();
  }
  return Array.from(groups.values());
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
      fleet,
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

function buildCargoRowsFromCompletedAllocations({ completionRows = [], allocationRows = [], includedDays = null } = {}) {
  const allocationsByCycle = new Map();
  for (const row of allocationRows) {
    const cycleId = String(row?.cycleId || '').trim();
    if (!cycleId) continue;
    if (!allocationsByCycle.has(cycleId)) allocationsByCycle.set(cycleId, []);
    allocationsByCycle.get(cycleId).push(row);
  }
  const rows = new Map();
  for (const completion of completionRows) {
    const cycleId = String(completion?.cycleId || '').trim();
    const fleet = String(completion?.fleet || '').trim();
    const assignment = String(completion?.assignment || '').trim();
    const isoDate = utcDateKey(completion?._time);
    const cargoLegs = Number(completion?._value);
    const allocations = allocationsByCycle.get(cycleId) || [];
    if (!cycleId || !fleet || !assignment || !isoDate || (includedDays && !includedDays.has(isoDate)) || !Number.isFinite(cargoLegs) || cargoLegs <= 0 || !allocations.length) continue;
    const key = `${isoDate}\n${fleet}\n${assignment}`;
    if (!rows.has(key)) rows.set(key, {
      fleet,
      fleetAccount: cargoFleetAccountFromCycleId(cycleId) || '',
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

module.exports = { parseInfluxCsv, isCargoCycleId, cargoFleetAccountFromCycleId, groupCargoAllocationRows, enrichCargoAllocationRows, dedupeCargoAllocationFieldRows, buildCargoAllocationRecords, buildCargoRowsFromCompletedAllocations };
