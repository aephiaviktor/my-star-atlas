'use strict';

const exactArithmetic = require('./exact-arithmetic');
const { buildCargoTransferEvents, eventFingerprint } = require('./production-ledger-events');

function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function key(row) { return `${row.isoDate}\n${String(row.fleetAccount || '').trim().toLowerCase()}\n${String(row.assignment || '').trim().toLowerCase()}`; }
function allocate(total, weight, weightTotal) {
  if (!finite(total) || !finite(weight)) return null;
  if (Number(total) === 0) return 0;
  return Number(weightTotal) > 0 ? Number(total) * Number(weight) / Number(weightTotal) : null;
}
function plainDecimal(value) {
  const source = String(value);
  if (!/[eE]/.test(source)) return source;
  const match = source.match(/^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return '';
  const digits = `${match[1]}${match[2] || ''}`;
  const point = match[1].length + Number(match[3]);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${digits}${'0'.repeat(point - digits.length)}`;
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}
function exactValue(value, unit) {
  const match = plainDecimal(value).match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || '';
  return { atoms: `${match[1]}${fraction}`.replace(/^0+(?=\d)/, ''), decimals: fraction.length, unit };
}
function exactCargoCostPerUnit(cost, rawQuantity, mintDecimals) {
  const numerator = exactValue(cost, 'ATLAS');
  const denominator = { atoms: String(rawQuantity || ''), decimals: Number(mintDecimals), unit: 'asset' };
  const divided = numerator && exactArithmetic.ratio(numerator, denominator);
  const rendered = divided?.status === 'ok' ? exactArithmetic.renderRatio(divided.value) : null;
  return rendered?.status === 'ok' ? rendered.value : null;
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
    const currencyConversionMissing = (finite(allocation.allocatedFuel) && !finite(fuelCost))
      || (finite(allocation.allocatedTxCostSol) && !finite(transactionCost));
    if (!finite(allocation.amount) || Number(allocation.amount) <= 0) missing.push('delivered quantity missing');
    if (currencyConversionMissing) missing.push('currency conversion missing');
    else if (!finite(fuelCost)) missing.push('Fuel cost missing');
    if (!finite(rentalCost)) missing.push('Rental cost missing');
    if (!currencyConversionMissing && !finite(transactionCost)) missing.push('Transaction cost missing');
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
      fuelCost, fuelCostDisplay: finite(fuelCost) ? fuelCost : (finite(allocation.allocatedFuel) ? Number(allocation.allocatedFuel) : null),
      fuelCostCurrency: finite(fuelCost) ? 'ATLAS' : (finite(allocation.allocatedFuel) ? 'FUEL' : null),
      rentalCost, rentalCostCurrency: finite(rentalCost) ? 'ATLAS' : null,
      transactionCost, transactionCostDisplay: finite(transactionCost) ? transactionCost : (finite(allocation.allocatedTxCostSol) ? Number(allocation.allocatedTxCostSol) : null),
      transactionCostCurrency: finite(transactionCost) ? 'ATLAS' : (finite(allocation.allocatedTxCostSol) ? 'SOL' : null),
      cargoCost, cargoCostCurrency: finite(cargoCost) ? 'ATLAS' : null, evidenceAuthority: 'legacy_unverified', missing, ledgerRow };
  });
}

function buildAuthoritativeCargoBetaInputs({ joinedDeliveries = [], cargoRows = [] } = {}) {
  const daily = new Map(cargoRows.map((row) => [key(row), row]));
  const totals = new Map();
  for (const delivery of joinedDeliveries) {
    const current = totals.get(key(delivery)) || { fuel: 0, tx: 0, volume: 0 };
    current.fuel += Number(delivery.allocatedFuelExact);
    current.tx += Number(delivery.allocatedTxCostSolExact);
    current.volume += Number(delivery.cargoVolumeExact);
    totals.set(key(delivery), current);
  }
  return joinedDeliveries.map((delivery) => {
    const costs = daily.get(key(delivery));
    const weights = totals.get(key(delivery));
    const allocatedFuel = Number(delivery.allocatedFuelExact);
    const allocatedTxCostSol = Number(delivery.allocatedTxCostSolExact);
    const cargoVolume = Number(delivery.cargoVolumeExact);
    const fuelCost = costs ? valueNativeShare(allocatedFuel, costs.burnedFuel, costs.fuelCostsAtlas) : null;
    const transactionCost = costs ? valueNativeShare(allocatedTxCostSol, costs.txCostSol, costs.txsCostsAtlas) : null;
    const rentalCost = costs ? allocate(costs.rentalRateAtlasPerDay, cargoVolume, weights.volume) : null;
    const missing = [];
    const currencyConversionMissing = !finite(fuelCost) || !finite(transactionCost);
    if (currencyConversionMissing) missing.push('currency conversion missing');
    if (!finite(rentalCost)) missing.push('Rental cost missing');
    const cargoCost = missing.length ? null : fuelCost + rentalCost + transactionCost;
    const confirmedBlockTime = BigInt(delivery.confirmedBlockTime);
    const timestamp = new Date(Number(confirmedBlockTime * 1000n)).toISOString();
    const addedCargo = !missing.length ? {
      fuel: exactValue(fuelCost, 'ATLAS'), rental: exactValue(rentalCost, 'ATLAS'), tx: exactValue(transactionCost, 'ATLAS'),
    } : null;
    const ledgerRow = !missing.length ? {
      evidenceAuthority: 'authoritative_v1', deliveryEventId: delivery.deliveryEventId, payloadHash: delivery.payloadHash,
      timestamp, confirmedSlot: delivery.confirmedSlot, confirmedBlockTime: delivery.confirmedBlockTime,
      scope: { faction: costs?.faction || delivery.faction, profile: costs?.profile || delivery.profileAccount }, currency: 'ATLAS',
      origin: delivery.origin, destination: delivery.destination, asset: delivery.asset, assetMint: delivery.assetMint,
      rawAmount: delivery.rawAmount, mintDecimals: delivery.mintDecimals, decimalAmount: delivery.decimalAmount,
      totalCostsAtlas: cargoCost, addedCargo,
    } : null;
    return {
      betaId: delivery.deliveryEventId, deliveryEventId: delivery.deliveryEventId, evidenceAuthority: 'authoritative_v1',
      profile: costs?.profile || delivery.profileAccount, faction: costs?.faction || delivery.faction,
      isoDate: timestamp.slice(0, 10), timestamp, fleetName: costs?.fleetName || delivery.fleetLabel,
      fleetAccount: delivery.fleetAccount, cycleId: delivery.cycleId, allocationIndex: delivery.allocationId,
      origin: delivery.origin, destination: delivery.destination, asset: delivery.asset, assetMint: delivery.assetMint,
      rawQuantity: delivery.rawAmount, mintDecimals: delivery.mintDecimals, deliveredQuantity: delivery.decimalAmount,
      allocatedFuel, allocatedTxCostSol, cargoVolume,
      fuelCost, fuelCostDisplay: finite(fuelCost) ? fuelCost : allocatedFuel, fuelCostCurrency: finite(fuelCost) ? 'ATLAS' : 'FUEL',
      rentalCost, rentalCostCurrency: finite(rentalCost) ? 'ATLAS' : null,
      transactionCost, transactionCostDisplay: finite(transactionCost) ? transactionCost : allocatedTxCostSol,
      transactionCostCurrency: finite(transactionCost) ? 'ATLAS' : 'SOL',
      cargoCost, cargoCostCurrency: finite(cargoCost) ? 'ATLAS' : null, missing, ledgerRow,
      evidenceStatus: missing.length ? `Incomplete — ${missing.join('; ')}` : 'Authoritative — delivery evidence v1',
    };
  });
}

function resultByTransferFingerprint(appliedEventResults = []) {
  return new Map(appliedEventResults.filter((entry) => entry?.event?.type === 'transfer').map((entry) => [eventFingerprint(entry.event), entry.result]));
}
function buildCargoBreakevenBetaRows({ betaInputs = [], appliedEventResults = [] } = {}) {
  const results = resultByTransferFingerprint(appliedEventResults);
  return betaInputs.map((input) => {
    const authoritative = input.evidenceAuthority === 'authoritative_v1';
    const event = !authoritative && input.ledgerRow ? buildCargoTransferEvents([input.ledgerRow])[0] : null;
    const moved = event ? results.get(eventFingerprint(event)) : null;
    const missing = [...input.missing];
    const quantity = input.deliveredQuantity;
    const cargoCostPerUnit = authoritative
      ? exactCargoCostPerUnit(input.cargoCost, input.rawQuantity, input.mintDecimals)
      : finite(input.cargoCost) && finite(quantity) && quantity > 0 ? input.cargoCost / quantity : null;
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
    return { ...input, ledgerRow: undefined, cargoCostPerUnit, cargoCostPerUnitCurrency: finite(cargoCostPerUnit) ? 'ATLAS' : null,
      baseCostPerUnit, baseCostPerUnitCurrency: finite(baseCostPerUnit) ? 'ATLAS' : null,
      totalCostPerUnit, totalCostPerUnitCurrency: finite(totalCostPerUnit) ? 'ATLAS' : null,
      evidenceStatus: uniqueMissing.length ? `Incomplete — ${uniqueMissing.join('; ')}` : (authoritative ? 'Authoritative — delivery evidence v1' : 'Estimated — legacy evidence'),
      missingReason: uniqueMissing.join('; ') || null };
  });
}

module.exports = { buildCargoBetaInputs, buildAuthoritativeCargoBetaInputs, buildCargoBreakevenBetaRows };
