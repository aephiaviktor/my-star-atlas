'use strict';

function normalizeFleetKey(value) {
  return String(value || '').trim().toLowerCase();
}

function calculateFleetCargoCapacity(ships = []) {
  if (!Array.isArray(ships) || !ships.length) return null;
  let total = 0;
  for (const ship of ships) {
    const amount = Number(ship?.amount);
    const cargoCapacity = ship?.cargoCapacity == null ? NaN : Number(ship.cargoCapacity);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(cargoCapacity) || cargoCapacity < 0) return null;
    total += amount * cargoCapacity;
  }
  return total;
}

function calculateCargoEfficiency({ cargoVolume, fleetCargoCapacity, cargoLegs } = {}) {
  const capacityPerLeg = Number(fleetCargoCapacity);
  const legs = Number(cargoLegs);
  const volume = Number(cargoVolume);
  if (!Number.isFinite(capacityPerLeg) || capacityPerLeg <= 0 || !Number.isFinite(legs) || legs <= 0) {
    return { cargoCapacity: null, cargoEfficiencyPercent: null };
  }
  const cargoCapacity = capacityPerLeg * legs;
  return {
    cargoCapacity,
    cargoEfficiencyPercent: Number.isFinite(volume) && volume >= 0
      ? (volume / cargoCapacity) * 100
      : null,
  };
}

function buildCargoVolumeByFleetDayAssignment(rows = []) {
  const totals = new Map();
  for (const row of rows) {
    const isoDate = String(row?.isoDate || '').trim();
    const fleet = normalizeFleetKey(row?.fleetName || row?.fleet);
    const assignment = String(row?.assignment || '').trim();
    const cargoVolume = Number(row?.cargoVolume);
    if (!isoDate || !fleet || !assignment || !Number.isFinite(cargoVolume) || cargoVolume < 0) continue;
    const key = `${isoDate}\n${fleet}\n${assignment}`;
    totals.set(key, (totals.get(key) || 0) + cargoVolume);
  }
  return totals;
}

module.exports = {
  calculateFleetCargoCapacity,
  calculateCargoEfficiency,
  buildCargoVolumeByFleetDayAssignment,
};
