'use strict';

const COST_SOURCES = Object.freeze(['scanning', 'mining', 'crafting', 'lm', 'gm']);

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function key(location, asset) {
  return `${String(location || '').trim()}\n${String(asset || '').trim()}`;
}

function emptyCosts() {
  return Object.fromEntries(COST_SOURCES.map((source) => [source, 0]));
}

function projectInventoryCostLedgerRows({ ledgerRows = [], valuationRows = [] } = {}) {
  const ledgerByKey = new Map((ledgerRows || []).map((row) => [key(row?.location, row?.asset), row]));
  const valuationByKey = new Map((valuationRows || []).map((row) => [key(row?.starbase, row?.asset), row]));
  const keys = new Set([...ledgerByKey.keys(), ...valuationByKey.keys()]);

  return [...keys].map((poolKey) => {
    const ledger = ledgerByKey.get(poolKey) || {};
    const valuation = valuationByKey.get(poolKey);
    const [fallbackLocation, fallbackAsset] = poolKey.split('\n');
    const location = String(valuation?.starbase || ledger.location || fallbackLocation || '').trim();
    const asset = String(valuation?.asset || ledger.asset || fallbackAsset || '').trim();
    const ledgerQuantity = nonNegative(ledger.quantity);
    const ledgerUncosted = Math.min(ledgerQuantity, nonNegative(ledger.uncostedQuantity));
    const ledgerKnown = Math.max(0, ledgerQuantity - ledgerUncosted);
    const quantity = valuation ? nonNegative(valuation.inventory) : ledgerQuantity;
    const isShortfall = valuation?.reconciliationStatus === 'shortfall' && ledgerQuantity > 0;
    const knownCostQuantity = isShortfall
      ? quantity * (ledgerKnown / ledgerQuantity)
      : Math.min(quantity, ledgerKnown);
    const basisScale = ledgerKnown > 0 ? knownCostQuantity / ledgerKnown : 0;
    const costs = emptyCosts();
    for (const source of COST_SOURCES) costs[source] = nonNegative(ledger?.knownCosts?.[source] ?? ledger?.costs?.[source]) * basisScale;
    const cargoCost = nonNegative(ledger.knownCargoCost ?? ledger.cargoCost) * basisScale;
    const totalBasis = Object.values(costs).reduce((sum, value) => sum + value, cargoCost);

    return {
      location,
      asset,
      quantity,
      knownCostQuantity,
      uncostedQuantity: Math.max(0, quantity - knownCostQuantity),
      costs,
      cargoCost,
      totalCostPerUnit: knownCostQuantity > 0 ? totalBasis / knownCostQuantity : null,
      reconciliationStatus: valuation?.reconciliationStatus || 'ledger-only',
    };
  }).filter((row) => row.location && row.asset)
    .sort((left, right) => left.location.localeCompare(right.location) || left.asset.localeCompare(right.asset));
}

module.exports = { projectInventoryCostLedgerRows };
