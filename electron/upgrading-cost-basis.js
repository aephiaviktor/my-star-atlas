'use strict';

const { canonicalAssetName } = require('./asset-name');

function upgradingPoolKey(starbase, asset) {
  return `${String(starbase || '').trim()}\n${canonicalAssetName(asset)}`;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveUpgradingCostsAtlas({ componentBasis = null, installed, inventoryBasis = null } = {}) {
  const exactBasis = finiteNumber(componentBasis?.basis);
  if (componentBasis && !componentBasis.uncosted && exactBasis !== null) return exactBasis;

  const quantity = finiteNumber(installed);
  const unitBasis = finiteNumber(inventoryBasis?.totalCostPerUnit);
  if (quantity === null || quantity < 0 || unitBasis === null || unitBasis < 0) return null;
  return quantity * unitBasis;
}

module.exports = { upgradingPoolKey, resolveUpgradingCostsAtlas };
