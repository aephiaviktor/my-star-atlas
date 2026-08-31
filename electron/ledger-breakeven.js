'use strict';

function normalizeAssetName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Estimate current inventory basis from the weighted basis of every known-cost
// unit. Unknown opening/surplus quantity inherits that average for planning;
// coverage fields keep the extrapolated share explicit.
function buildLedgerBreakevenRows({ ledgerRows = [], inventoryRows = [], prices = null } = {}) {
  const resourcePriceByName = (prices && prices.resourcePricesAtlByName) || {};
  const ledgerByKey = new Map((ledgerRows || []).map((row) => [`${String(row.location || '').trim()}\n${String(row.asset || '').trim()}`, row]));
  const inventoryEntries = Array.from(inventoryRows || []);
  const inventoryKeys = new Set(inventoryEntries.map((row) => `${String(row.starbase || '').trim()}\n${String(row.asset || '').trim()}`));
  for (const ledgerRow of ledgerRows || []) {
    const key = `${String(ledgerRow.location || '').trim()}\n${String(ledgerRow.asset || '').trim()}`;
    if (!inventoryKeys.has(key)) inventoryEntries.push({ starbase: ledgerRow.location, asset: ledgerRow.asset, quantity: 0 });
  }

  return inventoryEntries.map((inventoryRow) => {
    const starbase = String(inventoryRow.starbase || '').trim();
    const asset = String(inventoryRow.asset || '').trim();
    const inventory = Number(inventoryRow.quantity) || 0;
    const ledger = ledgerByKey.get(`${starbase}\n${asset}`);
    const ledgerQuantity = Number(ledger?.quantity || 0);
    const quantityVariance = inventory - ledgerQuantity;
    const reconciliationStatus = Math.abs(quantityVariance) <= 1e-9
      ? 'reconciled'
      : quantityVariance > 0 ? 'surplus' : 'shortfall';
    const unreconciledQuantity = Math.max(0, quantityVariance);
    const uncostedQuantity = Math.max(0, Number(ledger?.uncostedQuantity || 0)) + unreconciledQuantity;
    const knownCostQuantity = Math.max(0, ledgerQuantity - Number(ledger?.uncostedQuantity || 0));
    const coverageDenominator = Math.max(inventory, ledgerQuantity, 0);
    const knownCoverageRatio = coverageDenominator > 0
      ? Math.min(1, knownCostQuantity / coverageDenominator)
      : 0;
    const estimatedPercent = coverageDenominator > 0 ? Math.round((1 - knownCoverageRatio) * 100) : null;
    const fullyTracked = inventory > 0 && reconciliationStatus === 'reconciled' && uncostedQuantity <= 1e-9;
    const perUnit = (value) => knownCostQuantity > 0 ? Number(value || 0) / knownCostQuantity : null;
    const knownCosts = ledger?.knownCosts || ledger?.costs;
    const scanningCostPerUnit = perUnit(knownCosts?.scanning);
    const miningCostPerUnit = perUnit(knownCosts?.mining);
    const craftingCostPerUnit = perUnit(knownCosts?.crafting);
    const lmCostPerUnit = perUnit(knownCosts?.lm);
    const gmCostPerUnit = perUnit(knownCosts?.gm);
    const baseCostPerUnit = knownCostQuantity > 0
      ? scanningCostPerUnit + miningCostPerUnit + craftingCostPerUnit + lmCostPerUnit + gmCostPerUnit
      : null;
    const cargoCostPerUnit = perUnit(ledger?.knownCargoCost ?? ledger?.cargoCost);
    const landedCostPerUnit = knownCostQuantity > 0 ? baseCostPerUnit + cargoCostPerUnit : null;
    return {
      starbase, asset, inventory,
      scanningCostPerUnit, miningCostPerUnit, craftingCostPerUnit, lmCostPerUnit, gmCostPerUnit,
      baseCostPerUnit, cargoCostPerUnit, landedCostPerUnit,
      inventoryValue: landedCostPerUnit == null ? null : inventory * landedCostPerUnit,
      gmPricePerUnit: Number(resourcePriceByName[normalizeAssetName(asset)]) || null,
      inventoryExternalValue: Number(resourcePriceByName[normalizeAssetName(asset)]) > 0
        ? inventory * Number(resourcePriceByName[normalizeAssetName(asset)])
        : null,
      knownCostQuantity,
      estimatedPercent,
      fullyTracked,
      uncostedQuantity,
      ledgerQuantity,
      quantityVariance,
      reconciliationStatus,
      lastInventoryDate: inventoryRow.lastDate || null,
    };
  }).filter((row) => row.starbase && row.asset)
    .sort((a, b) => a.starbase.localeCompare(b.starbase) || a.asset.localeCompare(b.asset));
}

module.exports = { buildLedgerBreakevenRows };
