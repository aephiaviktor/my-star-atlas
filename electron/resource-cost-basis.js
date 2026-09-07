'use strict';

// Pure projections: never feed display revaluation back into the inventory ledger.
(function (root) {
  const resources = {
    scanning: [['foodCosts', 'burnedFood', 'Food'], ['fuelCosts', 'burnedFuel', 'Fuel']],
    mining: [['ammoCosts', 'burnedAmmo', 'Ammunition'], ['foodCosts', 'burnedFood', 'Food'], ['fuelCosts', 'burnedFuel', 'Fuel']],
  };
  const valid = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
  const assetName = (value) => value === 'Ammo' ? 'Ammunition' : String(value || '').trim();
  const poolKey = (location, asset) => JSON.stringify([String(location || '').trim(), assetName(asset)]);

  function enrichRows(rows, subtab, inventoryRows) {
    // inventoryRows is the exact, already faction/profile-scoped Inventory Ledger projection.
    const pools = new Map(inventoryRows.map((row) => [poolKey(row.location, row.asset), row.totalCostPerUnit]));
    return rows.map((row) => {
      const internalResourceCosts = {};
      for (const [column, burned, asset] of resources[subtab]) {
        const quantity = row[burned];
        let cost = null;
        if (valid(quantity) && Number(quantity) === 0) cost = 0;
        else if (valid(quantity)) {
          const supplies = subtab === 'mining'
            ? [{ starbase: row.starbase, quantity: Number(quantity) }]
            : (row.resourceConsumptionByStarbase?.[burned] || []).filter((item) => item.quantity !== 0);
          const located = supplies.reduce((sum, item) => sum + (valid(item.quantity) ? Number(item.quantity) : 0), 0);
          if (supplies.length && Math.abs(located - Number(quantity)) <= Math.max(1e-8, Number(quantity) * 1e-9)
            && supplies.every((item) => item.starbase && !['unknown', '--'].includes(item.starbase.toLowerCase())
              && valid(item.quantity) && valid(pools.get(poolKey(item.starbase, asset))))) {
            cost = supplies.reduce((sum, item) => sum + Number(item.quantity) * Number(pools.get(poolKey(item.starbase, asset))), 0);
          }
        }
        internalResourceCosts[column] = cost;
      }
      return { ...row, internalResourceCosts };
    });
  }

  function selectRows(rows, subtab, mode) {
    const columns = resources[subtab].map(([column]) => column);
    const fallbackColumns = mode === 'internal'
      ? columns.filter((column) => rows.some((row) => !valid(row.internalResourceCosts?.[column]))) : [];
    const selected = rows.map((source) => {
      if (mode !== 'internal') return { ...source };
      const row = { ...source };
      for (const column of columns) {
        if (!fallbackColumns.includes(column)) row[`${column}Atlas`] = Number(row.internalResourceCosts[column]);
      }
      const resourceCosts = columns.map((column) => row[`${column}Atlas`]);
      // Retain existing rental/fee availability semantics; missing resource prices cannot masquerade as profit.
      const extras = [row.rentalRateAtlasPerDay, row.txsCostsAtlas].filter(valid).map(Number);
      row.totalCostsAtlas = resourceCosts.every(valid) ? resourceCosts.reduce((sum, value) => sum + Number(value), 0) + extras.reduce((sum, value) => sum + value, 0) : null;
      row.netProfitAtlas = valid(row.revenueAtlasPerDay) && row.totalCostsAtlas != null ? Number(row.revenueAtlasPerDay) - row.totalCostsAtlas : null;
      row.netProfitPerCrew = row.netProfitAtlas != null && row.totalRequiredCrew > 0 ? row.netProfitAtlas / row.totalRequiredCrew : null;
      row.profitMarginPercent = row.netProfitAtlas != null && row.revenueAtlasPerDay > 0 ? row.netProfitAtlas / row.revenueAtlasPerDay * 100 : null;
      const units = subtab === 'scanning' ? row.sduFound : row.mined;
      row.costsPerUnitAtlas = row.totalCostsAtlas != null && units > 0 ? row.totalCostsAtlas / units : null;
      return row;
    });
    return { rows: selected, fallbackColumns };
  }

  const api = { enrichRows, selectRows };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResourceCostBasis = Object.freeze(api);
})(globalThis);
