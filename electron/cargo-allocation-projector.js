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
      const fuelPrice = requireFuelPrice(await resolvePrice('Fuel', row.isoDate), row.isoDate);
      const fuelCostsAtlas = canonicalRaw && Number(row.allocatedFuelExact || 0) > 0
        ? valueNativeCost({ eventType: 'fuel', timestamp: row.timestamp, fuelQuantity: row.allocatedFuelExact }, fuelPrice)?.amountATL ?? null
        : (['complete', 'provisional'].includes(fuelPrice.status) ? row.allocatedFuel * fuelPrice.priceATL : null);
      const solPrice = canonicalRaw ? requireSameDatePrice(await resolvePrice('SOL', row.isoDate), row.isoDate) : null;
      const txsCostsAtlas = canonicalRaw && BigInt(row.allocatedTxFeeLamports || '0') > 0n
        ? valueNativeCost({ eventType: 'sol_fee', timestamp: row.timestamp, txFeeLamports: row.allocatedTxFeeLamports }, solPrice)?.amountATL ?? null
        : (Number.isFinite(Number(prices.atlasPerSol)) ? row.allocatedTxCostSol * Number(prices.atlasPerSol) : null);
      const totalCostsAtlas = Number.isFinite(fuelCostsAtlas) && Number.isFinite(txsCostsAtlas) ? fuelCostsAtlas + txsCostsAtlas : null;
      return { ...row, label: formatDate(new Date(row.timestamp)), fleetName: row.fleet, fuelCostsAtlas, txsCostsAtlas, totalCostsAtlas, costsPerUnitAtlas: Number.isFinite(totalCostsAtlas) && row.amount > 0 ? totalCostsAtlas / row.amount : null };
    }));
    return { rows: grouped, diagnostics: { completedCycleIdentityCount: completedCycleIds.size, exactCycleMatchCount: completed.length, fleetScopedCount: fleetScopedCargoAllocationRows.length, completedCycleMatchedCount: completed.length } };
  };
}
module.exports = { createCargoAllocationProjector };
