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
    if (columns.includes('_field') && columns.includes('_value')) {
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

function groupCargoAllocationRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.isoDate}\n${row.fleet}\n${row.asset}\n${row.origin}\n${row.destination}\n${row.assignment}`;
    if (!groups.has(key)) {
      groups.set(key, { ...row, amount: 0, cargoVolume: 0, allocatedFuel: 0, allocatedTxCostSol: 0 });
    }
    const group = groups.get(key);
    group.amount += Number(row.amount) || 0;
    group.cargoVolume += Number(row.cargoVolume) || 0;
    group.allocatedFuel += Number(row.allocatedFuel) || 0;
    group.allocatedTxCostSol += Number(row.allocatedTxCostSol) || 0;
  }
  return Array.from(groups.values());
}

module.exports = { parseInfluxCsv, groupCargoAllocationRows, enrichCargoAllocationRows };
