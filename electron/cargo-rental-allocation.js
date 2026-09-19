'use strict';

function normalize(value) {
  return String(value || '').trim();
}

function fleetDayKey(row = {}) {
  const fleetAccount = normalize(row.fleetAccount);
  const isoDate = normalize(row.isoDate);
  return fleetAccount && isoDate ? `${fleetAccount}\n${isoDate}` : '';
}

function allocateFleetDayRentalCosts(rows = [], {
  rentalHistoryIndex = null,
  faction = '',
  resolveRental,
} = {}) {
  if (typeof resolveRental !== 'function') throw new TypeError('cargo_rental_resolver_required');
  const output = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
  const groups = new Map();
  for (const row of output) {
    const key = fleetDayKey(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    const rental = resolveRental(rentalHistoryIndex, {
      fleetAccount: first.fleetAccount,
      fleetLabel: first.fleetName || first.fleet,
      faction,
      isoDate: first.isoDate,
    });
    const rentalCostAtlas = Number(rental?.rentalCostAtlas);
    const totalVolume = groupRows.reduce((sum, row) => sum + Math.max(0, Number(row.cargoVolume) || 0), 0);
    const relationships = new Set(groupRows.map((row) => normalize(row.relationship)).filter(Boolean));
    const ownedOnly = relationships.size === 1 && relationships.has('owned');

    if (!rental || !Number.isFinite(rentalCostAtlas) || rentalCostAtlas < 0 || totalVolume <= 0) {
      for (const row of groupRows) {
        row.rentalCostsAtlas = ownedOnly ? 0 : null;
        row.rentalCostStatus = ownedOnly ? 'available' : 'unavailable';
        row.rentalCostReason = ownedOnly ? null : (totalVolume > 0 ? 'rental_history_unavailable' : 'rental_allocation_volume_unavailable');
      }
      continue;
    }

    let allocated = 0;
    groupRows.forEach((row, index) => {
      const cost = index === groupRows.length - 1
        ? rentalCostAtlas - allocated
        : rentalCostAtlas * Math.max(0, Number(row.cargoVolume) || 0) / totalVolume;
      row.rentalCostsAtlas = cost;
      row.rentalCostStatus = 'available';
      row.rentalCostReason = null;
      allocated += cost;
    });
  }

  for (const row of output) {
    if (row.rentalCostStatus) continue;
    row.rentalCostsAtlas = null;
    row.rentalCostStatus = 'unavailable';
    row.rentalCostReason = 'rental_fleet_identity_unavailable';
  }
  return output;
}

module.exports = { allocateFleetDayRentalCosts, fleetDayKey };
