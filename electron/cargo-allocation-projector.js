'use strict';

function createCargoAllocationProjector(deps) {
  const {
    fetchCargoRows, fetchCompletionRows, fetchPrices, fetchRawCosts, fetchRentalHistory,
    getIncludedDays, mergeCargoRows, cargoFleetAccountFromCycleId,
    filterCompleted, exporterForFaction, selectCutover, valueRawCosts,
    resolvePrice, requireFuelPrice, requireSameDatePrice, aggregateRawCosts,
    applyRawCosts, groupRows, allocateRentalCosts, resolveRental, valueNativeCost, formatDate,
  } = deps;
  return async function projectCargoAllocation(settings, allocationRows, diagnostics, signal) {
    if (signal.aborted) throw new Error('cargo_allocation_cancelled');
    const [movementRows, completionRows, prices, rawCargoCosts, rentalHistoryIndex] = await Promise.all([
      fetchCargoRows(settings).catch(() => []), fetchCompletionRows(settings), fetchPrices(),
      fetchRawCosts(settings).catch(() => ({ records: [], rejected: [] })),
      fetchRentalHistory(settings).catch(() => null),
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
    const metadataByFleetDay = new Map(compatibilityCargoRows.map((row) => [
      `${String(row.fleetAccount || '').trim()}\n${String(row.isoDate || '').trim()}`,
      row,
    ]));
    const groupedRows = groupRows(completed).map((row) => {
      const metadata = metadataByFleetDay.get(`${String(row.fleetAccount || '').trim()}\n${String(row.isoDate || '').trim()}`);
      return metadata ? {
        ...row,
        ownership: metadata.ownership || '',
        relationship: metadata.relationship || '',
        ships: metadata.ships || [],
        shipTypes: metadata.shipTypes || 0,
        totalRequiredCrew: metadata.totalRequiredCrew ?? null,
      } : row;
    });
    const rentalAllocatedRows = allocateRentalCosts(groupedRows, {
      rentalHistoryIndex,
      faction: settings.faction,
      resolveRental,
    });
    const grouped = await Promise.all(rentalAllocatedRows.map(async (row) => {
      const canonicalFuel = row.fuelAllocationStatus === 'canonical' || row.fuelAllocationStatus === 'canonical_zero' || (row.fuelAllocationStatus == null && row.sourceMode === 'canonical_raw');
      const canonicalTx = row.txAllocationStatus === 'canonical' || row.txAllocationStatus === 'canonical_zero' || (row.txAllocationStatus == null && row.sourceMode === 'canonical_raw');
      const fuelPrice = requireFuelPrice(await resolvePrice('Fuel', row.isoDate), row.isoDate);
      const fuelPriceAvailable = ['complete', 'provisional'].includes(fuelPrice.status);
      const fuelQuantityAvailable = !['invalid', 'unavailable'].includes(row.fuelAllocationStatus) && row.allocatedFuel != null && Number.isFinite(Number(row.allocatedFuel));
      const fuelCostsAtlas = !fuelQuantityAvailable || !fuelPriceAvailable
        ? null
        : canonicalFuel && Number(row.allocatedFuelExact) > 0
          ? valueNativeCost({ eventType: 'fuel', timestamp: row.timestamp, fuelQuantity: row.allocatedFuelExact }, fuelPrice)?.amountATL ?? null
          : Number(row.allocatedFuel) * fuelPrice.priceATL;
      const solPrice = requireSameDatePrice(await resolvePrice('SOL', row.isoDate), row.isoDate);
      const txQuantityAvailable = !['invalid', 'unavailable'].includes(row.txAllocationStatus) && row.allocatedTxCostSol != null && Number.isFinite(Number(row.allocatedTxCostSol));
      const txPriceAvailable = ['complete', 'provisional'].includes(solPrice?.status);
      const txsCostsAtlas = !txQuantityAvailable || !txPriceAvailable
        ? null
        : canonicalTx && BigInt(row.allocatedTxFeeLamports || '0') > 0n
          ? valueNativeCost({ eventType: 'sol_fee', timestamp: row.timestamp, txFeeLamports: row.allocatedTxFeeLamports }, solPrice)?.amountATL ?? null
          : Number(row.allocatedTxCostSol) * Number(solPrice.priceATL);
      const fuelCostStatus = Number.isFinite(fuelCostsAtlas) ? 'available' : 'unavailable';
      const txsCostStatus = Number.isFinite(txsCostsAtlas) ? 'available' : 'unavailable';
      const rentalCostStatus = row.rentalCostStatus === 'available' && Number.isFinite(Number(row.rentalCostsAtlas)) ? 'available' : 'unavailable';
      const totalCostsAtlas = fuelCostStatus === 'available' && txsCostStatus === 'available'
        ? fuelCostsAtlas + (rentalCostStatus === 'available' ? Number(row.rentalCostsAtlas) : 0) + txsCostsAtlas
        : null;
      return {
        ...row,
        label: formatDate(new Date(row.timestamp)),
        fleetName: row.fleet,
        fuelCostStatus,
        fuelCostReason: fuelCostStatus === 'available' ? null : (row.fuelAllocationReason || (fuelQuantityAvailable ? 'fuel_price_unavailable' : 'fuel_allocation_unavailable')),
        txsCostStatus,
        txsCostReason: txsCostStatus === 'available' ? null : (row.txAllocationReason || (txQuantityAvailable ? 'transaction_valuation_unavailable' : 'transaction_allocation_unavailable')),
        fuelCostsAtlas,
        rentalCostStatus,
        rentalCostReason: rentalCostStatus === 'available' ? null : row.rentalCostReason,
        rentalCostsAtlas: rentalCostStatus === 'available' ? Number(row.rentalCostsAtlas) : null,
        txsCostsAtlas,
        totalCostsAtlas,
        costsPerUnitAtlas: Number.isFinite(totalCostsAtlas) && Number(row.amount) > 0 ? totalCostsAtlas / Number(row.amount) : null,
      };
    }));
    const unavailableRawCostCount = grouped.filter((row) => row.allocationCostReason === 'canonical_raw_cost_missing').length;
    const unavailableFuelCostCount = grouped.filter((row) => row.fuelCostStatus === 'unavailable').length;
    const unavailableRentalCostCount = grouped.filter((row) => row.rentalCostStatus === 'unavailable').length;
    const unavailableTxsCostCount = grouped.filter((row) => row.txsCostStatus === 'unavailable').length;
    return { rows: grouped, diagnostics: { completedCycleIdentityCount: completedCycleIds.size, exactCycleMatchCount: completed.length, fleetScopedCount: fleetScopedCargoAllocationRows.length, completedCycleMatchedCount: completed.length, unavailableRawCostCount, unavailableFuelCostCount, unavailableRentalCostCount, unavailableTxsCostCount } };
  };
}
module.exports = { createCargoAllocationProjector };
