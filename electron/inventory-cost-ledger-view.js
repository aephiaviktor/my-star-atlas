'use strict';

const { scaleOrigins, sourceUnitMetrics } = require('./inventory-source-units');

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

function projectInventoryCostLedgerRows({ ledgerRows = [], valuationRows = [], poolBasisRows = [] } = {}) {
  const ledgerByKey = new Map((ledgerRows || []).map((row) => [key(row?.location, row?.asset), row]));
  const valuationByKey = new Map((valuationRows || []).map((row) => [key(row?.starbase, row?.asset), row]));
  const poolBasisByKey = new Map((poolBasisRows || []).map((row) => [key(row?.location, row?.asset), row]));
  const keys = new Set([...ledgerByKey.keys(), ...valuationByKey.keys()]);

  return [...keys].map((poolKey) => {
    const ledger = ledgerByKey.get(poolKey) || {};
    const valuation = valuationByKey.get(poolKey);
    const poolBasis = poolBasisByKey.get(poolKey);
    const [fallbackLocation, fallbackAsset] = poolKey.split('\n');
    const location = String(valuation?.starbase || ledger.location || fallbackLocation || '').trim();
    const asset = String(valuation?.asset || ledger.asset || fallbackAsset || '').trim();
    const ledgerQuantity = nonNegative(ledger.quantity);
    const ledgerUncosted = Math.min(ledgerQuantity, nonNegative(ledger.uncostedQuantity));
    const ledgerKnown = Math.max(0, ledgerQuantity - ledgerUncosted);
    const quantity = valuation ? nonNegative(valuation.inventory) : ledgerQuantity;
    const removedQuantity = Math.max(0, ledgerQuantity - quantity);
    const uncostedQuantity = quantity >= ledgerQuantity
      ? Math.max(0, quantity - ledgerKnown)
      : Math.max(0, ledgerUncosted - removedQuantity);
    const knownCostQuantity = Math.max(0, quantity - uncostedQuantity);
    const hasBasis = Boolean(poolBasis) || ledgerKnown > 0;
    const basisStatus = !hasBasis ? 'unpriced'
      : uncostedQuantity > 1e-9 ? 'estimated' : 'priced';
    const unitCosts = emptyCosts();
    for (const source of COST_SOURCES) {
      unitCosts[source] = poolBasis
        ? nonNegative(poolBasis?.unitCosts?.[source])
        : ledgerKnown > 0 ? nonNegative(ledger?.knownCosts?.[source] ?? ledger?.costs?.[source]) / ledgerKnown : 0;
    }
    const cargoCostPerUnit = poolBasis
      ? nonNegative(poolBasis.cargoCostPerUnit)
      : ledgerKnown > 0 ? nonNegative(ledger.knownCargoCost ?? ledger.cargoCost) / ledgerKnown : 0;
    const costs = emptyCosts();
    for (const source of COST_SOURCES) costs[source] = unitCosts[source] * quantity;
    const cargoCost = cargoCostPerUnit * quantity;
    const totalBasis = Object.values(costs).reduce((sum, value) => sum + value, cargoCost);

    const origins = scaleOrigins(ledger.origins,
      ledgerKnown > 0 ? Math.min(1, knownCostQuantity / ledgerKnown) : 0, 0);
    const acquisition = {};
    for (const [route, sources] of Object.entries({ purchased: ['gm', 'lm'], produced: ['scanning', 'mining', 'crafting'] })) {
      const parts = origins.filter((part) => !part.uncosted && sources.includes(part.source));
      const qty = parts.reduce((sum, part) => sum + part.quantity, 0);
      const cost = parts.reduce((sum, part) => sum + Object.values(part.costs).reduce((a, b) => a + b, part.cargoCost), 0);
      acquisition[route] = { quantity: qty, cost, unitCost: qty > 0 ? cost / qty : null };
    }
    const unknownOriginQuantity = Math.max(0, knownCostQuantity - acquisition.purchased.quantity - acquisition.produced.quantity);
    return {
      acquisition,
      unknownOriginQuantity,
      producedPercent: knownCostQuantity > 0 ? acquisition.produced.quantity / knownCostQuantity * 100 : null,
      ...sourceUnitMetrics(origins),
      location,
      asset,
      quantity,
      knownCostQuantity,
      uncostedQuantity,
      costs,
      cargoCost,
      totalCostPerUnit: hasBasis ? Object.values(unitCosts).reduce((sum, value) => sum + value, cargoCostPerUnit) : null,
      basisStatus,
      basisTimestamp: poolBasis?.timestamp || null,
      reconciliationStatus: valuation?.reconciliationStatus || 'ledger-only',
    };
  }).filter((row) => row.location && row.asset)
    .sort((left, right) => left.location.localeCompare(right.location) || left.asset.localeCompare(right.asset));
}

module.exports = { projectInventoryCostLedgerRows };
