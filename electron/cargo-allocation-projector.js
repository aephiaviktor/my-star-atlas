'use strict';

function createCargoAllocationProjector(deps) {
  const {
    fetchCargoRows, fetchCompletionRows, fetchPrices, fetchRawCosts,
    getIncludedDays, mergeCargoRows, cargoFleetAccountFromCycleId,
    filterCompleted, exporterForFaction, selectCutover, valueRawCosts,
    resolvePrice, requireFuelPrice, requireSameDatePrice, aggregateRawCosts,
    applyRawCosts, groupRows, valueNativeCost, formatDate,
  } = deps;
  return async function projectCargoAllocation(settings, allocationRows, diagnostics, signal) {
    if (signal.aborted) throw new Error('cargo_allocation_cancelled');
    const [movementRows, completionRows, prices, rawCargoCosts] = await Promise.all([
      fetchCargoRows(settings).catch(() => []), fetchCompletionRows(settings), fetchPrices(),
      fetchRawCosts(settings).catch(() => ({ records: [], rejected: [] })),
    ]);
    const includedDays = new Set(getIncludedDays());
    const compatibilityCargoRows = mergeCargoRows({ movementRows, completionRows, allocationRows, includedDays });
    const scopedCargoFleetAccounts = new Set(compatibilityCargoRows.map((row) => String(row.fleetAccount || '').trim()).filter(Boolean));
    const completedCycleIds = new Set(compatibilityCargoRows.flatMap((row) => row.completedCycleIds || []).map(String));
    const fleetScopedCargoAllocationRows = allocationRows.filter((row) => scopedCargoFleetAccounts.has(String(row.fleetAccount || cargoFleetAccountFromCycleId(row.cycleId) || '').trim()));
    let completed = filterCompleted(fleetScopedCargoAllocationRows, compatibilityCargoRows);
    const rawExporter = exporterForFaction(settings.faction);
    const cutoverSelection = rawExporter ? selectCutover({ legacyRows: compatibilityCargoRows, rawRecords: rawCargoCosts.records, ...rawExporter }) : { cutover: null, rawRecords: [] };
    if (cutoverSelection.cutover) {
      const valued = await valueRawCosts(cutoverSelection.rawRecords, {
        resolvePrice: async (asset, date) => asset === 'Fuel' ? requireFuelPrice(await resolvePrice(asset, date), date) : requireSameDatePrice(await resolvePrice(asset, date), date),
      });
      completed = applyRawCosts(completed, aggregateRawCosts(valued), cutoverSelection.cutover);
    }
    const grouped = await Promise.all(groupRows(completed).map(async (row) => {
      const canonicalRaw = row.sourceMode === 'canonical_raw';
      const rawMissing = row.sourceMode === 'raw_missing' || row.allocationCostStatus === 'unavailable';
      const fuelPrice = requireFuelPrice(await resolvePrice('Fuel', row.isoDate), row.isoDate);
      const fuelPriceAvailable = ['complete', 'provisional'].includes(fuelPrice.status);
      const fuelQuantityAvailable = !rawMissing && row.allocatedFuel != null && Number.isFinite(Number(row.allocatedFuel));
      const fuelCostsAtlas = !fuelQuantityAvailable || !fuelPriceAvailable
        ? null
        : canonicalRaw && Number(row.allocatedFuelExact) > 0
          ? valueNativeCost({ eventType: 'fuel', timestamp: row.timestamp, fuelQuantity: row.allocatedFuelExact }, fuelPrice)?.amountATL ?? null
          : Number(row.allocatedFuel) * fuelPrice.priceATL;
      const solPrice = canonicalRaw ? requireSameDatePrice(await resolvePrice('SOL', row.isoDate), row.isoDate) : null;
      const txQuantityAvailable = !rawMissing && row.allocatedTxCostSol != null && Number.isFinite(Number(row.allocatedTxCostSol));
      const txPriceAvailable = canonicalRaw
        ? ['complete', 'provisional'].includes(solPrice?.status)
        : prices.atlasPerSol != null && Number.isFinite(Number(prices.atlasPerSol));
      const txsCostsAtlas = !txQuantityAvailable || !txPriceAvailable
        ? null
        : canonicalRaw && BigInt(row.allocatedTxFeeLamports || '0') > 0n
          ? valueNativeCost({ eventType: 'sol_fee', timestamp: row.timestamp, txFeeLamports: row.allocatedTxFeeLamports }, solPrice)?.amountATL ?? null
          : Number(row.allocatedTxCostSol) * Number(prices.atlasPerSol);
      const fuelCostStatus = Number.isFinite(fuelCostsAtlas) ? 'available' : 'unavailable';
      const txsCostStatus = Number.isFinite(txsCostsAtlas) ? 'available' : 'unavailable';
      const totalCostsAtlas = fuelCostStatus === 'available' && txsCostStatus === 'available' ? fuelCostsAtlas + txsCostsAtlas : null;
      return {
        ...row,
        label: formatDate(new Date(row.timestamp)),
        fleetName: row.fleet,
        fuelCostStatus,
        fuelCostReason: fuelCostStatus === 'available' ? null : (row.allocationCostReason || (fuelQuantityAvailable ? 'fuel_price_unavailable' : 'fuel_allocation_unavailable')),
        txsCostStatus,
        txsCostReason: txsCostStatus === 'available' ? null : (row.allocationCostReason || (txQuantityAvailable ? 'transaction_valuation_unavailable' : 'transaction_allocation_unavailable')),
        fuelCostsAtlas,
        txsCostsAtlas,
        totalCostsAtlas,
        costsPerUnitAtlas: Number.isFinite(totalCostsAtlas) && Number(row.amount) > 0 ? totalCostsAtlas / Number(row.amount) : null,
      };
    }));
    const unavailableRawCostCount = grouped.filter((row) => row.allocationCostReason === 'canonical_raw_cost_missing').length;
    const unavailableFuelCostCount = grouped.filter((row) => row.fuelCostStatus === 'unavailable').length;
    const unavailableTxsCostCount = grouped.filter((row) => row.txsCostStatus === 'unavailable').length;
    return { rows: grouped, diagnostics: { completedCycleIdentityCount: completedCycleIds.size, exactCycleMatchCount: completed.length, fleetScopedCount: fleetScopedCargoAllocationRows.length, completedCycleMatchedCount: completed.length, unavailableRawCostCount, unavailableFuelCostCount, unavailableTxsCostCount } };
  };
}
module.exports = { createCargoAllocationProjector };
