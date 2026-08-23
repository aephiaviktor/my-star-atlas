'use strict';

const { buildCargoTransferEvents, eventFingerprint } = require('./production-ledger-events');

function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function key(row) { return `${row.isoDate}\n${String(row.fleetAccount || '').trim().toLowerCase()}\n${String(row.assignment || '').trim().toLowerCase()}`; }
function allocate(total, weight, weightTotal) {
  if (!finite(total) || !finite(weight)) return null;
  if (Number(total) === 0) return 0;
  return Number(weightTotal) > 0 ? Number(total) * Number(weight) / Number(weightTotal) : null;
}
function valueNativeShare(value, nativeTotal, valuedTotal) {
  if (!finite(value) || !finite(nativeTotal) || !finite(valuedTotal)) return null;
  if (Number(nativeTotal) === 0) return Number(value) === 0 && Number(valuedTotal) === 0 ? 0 : null;
  return Number(value) * Number(valuedTotal) / Number(nativeTotal);
}

function buildCargoBetaInputs({ allocations = [], cargoRows = [] } = {}) {
  const daily = new Map(cargoRows.map((row) => [key(row), row]));
  const totals = new Map();
  for (const row of allocations) {
    const current = totals.get(key(row)) || { fuel: 0, tx: 0, volume: 0 };
    if (finite(row.allocatedFuel)) current.fuel += Number(row.allocatedFuel);
    if (finite(row.allocatedTxCostSol)) current.tx += Number(row.allocatedTxCostSol);
    if (finite(row.cargoVolume)) current.volume += Number(row.cargoVolume);
    totals.set(key(row), current);
  }
  return allocations.map((allocation) => {
    const costs = daily.get(key(allocation));
    const weights = totals.get(key(allocation));
    const fuelCost = costs ? valueNativeShare(allocation.allocatedFuel, costs.burnedFuel, costs.fuelCostsAtlas) : null;
    const transactionCost = costs ? valueNativeShare(allocation.allocatedTxCostSol, costs.txCostSol, costs.txsCostsAtlas) : null;
    const rentalCost = costs ? allocate(costs.rentalRateAtlasPerDay, allocation.cargoVolume, weights.volume) : null;
    const missing = [];
    if (!finite(allocation.amount) || Number(allocation.amount) <= 0) missing.push('delivered quantity missing');
    if (!finite(fuelCost)) missing.push('Fuel cost missing');
    if (!finite(rentalCost)) missing.push('Rental cost missing');
    if (!finite(transactionCost)) missing.push('Transaction cost missing');
    const cargoCost = missing.length ? null : fuelCost + rentalCost + transactionCost;
    const ledgerRow = !missing.length ? {
      timestamp: allocation.timestamp, isoDate: allocation.isoDate, origin: allocation.origin, destination: allocation.destination,
      asset: allocation.asset, amount: Number(allocation.amount), totalCostsAtlas: cargoCost,
    } : null;
    const allocationIdentity = allocation.allocationIndex ?? `${allocation.asset}:${allocation.origin}:${allocation.destination}`;
    return { betaId: `${allocation.cycleId}:${allocationIdentity}`, profile: costs?.profile || '', faction: costs?.faction || allocation.faction || '',
      isoDate: allocation.isoDate, timestamp: allocation.timestamp, fleetName: costs?.fleetName || allocation.fleet, fleetAccount: allocation.fleetAccount,
      cycleId: allocation.cycleId, allocationIndex: allocation.allocationIndex, origin: allocation.origin, destination: allocation.destination,
      asset: allocation.asset, deliveredQuantity: finite(allocation.amount) ? Number(allocation.amount) : null,
      fuelCost, rentalCost, transactionCost, cargoCost, missing, ledgerRow };
  });
}

function resultByTransferFingerprint(appliedEventResults = []) {
  return new Map(appliedEventResults.filter((entry) => entry?.event?.type === 'transfer').map((entry) => [eventFingerprint(entry.event), entry.result]));
}
function buildCargoBreakevenBetaRows({ betaInputs = [], appliedEventResults = [] } = {}) {
  const results = resultByTransferFingerprint(appliedEventResults);
  return betaInputs.map((input) => {
    const event = input.ledgerRow ? buildCargoTransferEvents([input.ledgerRow])[0] : null;
    const moved = event ? results.get(eventFingerprint(event)) : null;
    const missing = [...input.missing];
    const quantity = input.deliveredQuantity;
    const cargoCostPerUnit = finite(input.cargoCost) && finite(quantity) && quantity > 0 ? input.cargoCost / quantity : null;
    let baseCostPerUnit = null;
    if (!moved) missing.push('Base history missing');
    else if (Number(moved.uncostedQuantity || 0) > 1e-9) missing.push('Base basis incomplete');
    else {
      const base = Object.values(moved.costs || {}).reduce((sum, value) => sum + Number(value || 0), 0);
      baseCostPerUnit = finite(quantity) && quantity > 0 && Number.isFinite(base) ? base / quantity : null;
      if (!finite(baseCostPerUnit)) missing.push('Base basis missing');
    }
    const totalCostPerUnit = finite(cargoCostPerUnit) && finite(baseCostPerUnit) ? cargoCostPerUnit + baseCostPerUnit : null;
    const uniqueMissing = [...new Set(missing)];
    return { ...input, ledgerRow: undefined, cargoCostPerUnit, baseCostPerUnit, totalCostPerUnit,
      evidenceStatus: uniqueMissing.length ? `Incomplete — ${uniqueMissing.join('; ')}` : 'Estimated — legacy evidence',
      missingReason: uniqueMissing.join('; ') || null };
  });
}

module.exports = { buildCargoBetaInputs, buildCargoBreakevenBetaRows };
