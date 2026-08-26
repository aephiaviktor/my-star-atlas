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
  const volumeKnown = cargoVolume != null && cargoVolume !== '';
  const volume = volumeKnown ? Number(cargoVolume) : NaN;
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

function cargoVolumeRangeStart(includedUtcDays = []) {
  const oldest = includedUtcDays[0];
  if (!(oldest instanceof Date) || Number.isNaN(oldest.getTime())) return '';
  return `${oldest.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function buildCargoVolumeRows(rows = [], includedDays = null) {
  const records = new Map();
  for (const row of rows) {
    const date = new Date(row?._time);
    const isoDate = Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    const cycleId = String(row?.cycleId || '').trim();
    const fleetAccount = cycleId.split(':', 1)[0];
    const fleet = String(row?.fleet || '').trim();
    const assignment = String(row?.assignment || '').trim();
    const cargoVolume = Number(row?._value);
    if (!isoDate || (includedDays && !includedDays.has(isoDate))
      || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(fleetAccount)
      || !cycleId || !fleet || !assignment || !Number.isFinite(cargoVolume) || cargoVolume < 0) continue;
    const key = `${isoDate}\n${cycleId}`;
    if (!records.has(key)) records.set(key, { isoDate, fleet, fleetAccount, assignment, cycleId, cargoVolume });
  }
  return Array.from(records.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.cycleId.localeCompare(b.cycleId));
}

function buildCargoVolumeByFleetDayAssignment(rows = []) {
  const totals = new Map();
  for (const row of rows) {
    const isoDate = String(row?.isoDate || '').trim();
    const fleet = normalizeFleetKey(row?.fleetAccount || row?.fleetName || row?.fleet);
    const assignment = String(row?.assignment || '').trim();
    const cargoVolume = Number(row?.cargoVolume);
    if (!isoDate || !fleet || !assignment || !Number.isFinite(cargoVolume) || cargoVolume < 0) continue;
    const key = `${isoDate}\n${fleet}\n${assignment}`;
    totals.set(key, (totals.get(key) || 0) + cargoVolume);
  }
  return totals;
}

function buildCargoVolumeByFleetDay(rows = []) {
  const totals = new Map();
  for (const row of rows) {
    const isoDate = String(row?.isoDate || '').trim();
    const fleetAccount = normalizeFleetKey(row?.fleetAccount);
    const cargoVolume = Number(row?.cargoVolume);
    if (!isoDate || !fleetAccount || !Number.isFinite(cargoVolume) || cargoVolume < 0) continue;
    const key = `${isoDate}\n${fleetAccount}`;
    totals.set(key, (totals.get(key) || 0) + cargoVolume);
  }
  return totals;
}

function filterCargoAllocationsToCompletedCycles(allocations = [], cargoRows = []) {
  const completionEvidenceAvailable = cargoRows.some((row) => row?.cargoCycles != null || (Array.isArray(row?.completedCycleIds) && row.completedCycleIds.length));
  if (!completionEvidenceAvailable) return allocations;
  const completedCycleIds = new Set(
    cargoRows.flatMap((row) => Array.isArray(row?.completedCycleIds) ? row.completedCycleIds : [])
      .map((cycleId) => String(cycleId || '').trim())
      .filter(Boolean)
  );
  return allocations.filter((row) => completedCycleIds.has(String(row?.cycleId || '').trim()));
}

function calculateTravelModeTime(durations = {}) {
  const warp = Number(durations.warp || 0);
  const subwarp = Number(durations.subwarp || 0);
  if (!Number.isFinite(warp) || !Number.isFinite(subwarp) || warp < 0 || subwarp < 0 || warp + subwarp <= 0) {
    return null;
  }
  const warpPercent = Math.round((warp / (warp + subwarp)) * 100);
  const subwarpPercent = 100 - warpPercent;
  return {
    warpPercent,
    subwarpPercent,
    label: `${warpPercent}% Warp | ${subwarpPercent}% Subwarp`,
  };
}

module.exports = {
  calculateFleetCargoCapacity,
  calculateCargoEfficiency,
  cargoVolumeRangeStart,
  buildCargoVolumeRows,
  buildCargoVolumeByFleetDayAssignment,
  buildCargoVolumeByFleetDay,
  filterCargoAllocationsToCompletedCycles,
  calculateTravelModeTime,
};
