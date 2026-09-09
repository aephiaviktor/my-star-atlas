const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

test('visible faction data is followed by a cancellable sequential background prefetch', () => {
  assert.match(renderer, /let factionPrefetchGeneration = 0;/);
  assert.match(renderer, /async function runFactionBackgroundPrefetch\(generation, faction, activeSection\)/);
  assert.match(renderer, /for \(const task of tasks\)/);
  assert.match(renderer, /if \(generation !== factionPrefetchGeneration\) return;/);
  assert.match(renderer, /await task\.load\(\);/);
  assert.match(renderer, /function loadVisibleThenPrefetch\(loader\)/);
});

test('background prefetch covers every top-level faction dataset', () => {
  for (const key of [
    'fleet', 'scanning', 'mining', 'crafting', 'production',
    'consumption-scanning', 'consumption-mining', 'consumption-cargo',
    'consumption-crafting', 'consumption-upgrading', 'consumption-total',
    'pcr', 'inventory', 'earnings', 'optimization-scanning', 'optimization-upgrading',
  ]) {
    assert.match(renderer, new RegExp(`key: '${key}'`));
  }
});

test('prefetch stores results under its captured faction instead of renderer globals', () => {
  assert.match(renderer, /const settings = \{[\s\S]*?faction,[\s\S]*?playerProfiles:/);
  assert.match(renderer, /setCachedFactionResult\(faction, 'fleet', result\)/);
  assert.match(renderer, /cachePrefetchedFilterResult\(faction, 'sdu'/);
  assert.match(renderer, /faction === normalizeFaction\(\(latestSettings \|\| getFormPayload\(\)\)\.faction\)/);
});

test('faction switching clears loaded-result guards and starts without filters', () => {
  const handler = renderer.slice(
    renderer.indexOf('factionButtons.forEach((button) => {'),
    renderer.indexOf("scanningFleetFilter.addEventListener('change'"),
  );
  assert.match(handler, /resetFactionScopedState\(\)/);
  assert.doesNotMatch(handler, /recordFactionFilterState|restoreFactionFilterState/);

  const reset = renderer.slice(
    renderer.indexOf('function resetFactionScopedState()'),
    renderer.indexOf('function resetLegacyFleetState'),
  );
  assert.match(reset, /earningsFilters\.upgrading = \{ date: '', starbase: '', asset: '' \}/);
  assert.match(reset, /earningsFilters\.breakeven = \{ starbase: '', asset: '', hideLowInventory: false \}/);
  assert.match(reset, /resetFactionFilterState\(\)/);

  const filters = renderer.slice(
    renderer.indexOf('function resetFactionFilterState()'),
    renderer.indexOf('function openSettings()'),
  );
  for (const field of [
    'selectedScanningFleet', 'selectedMiningFleet', 'selectedMiningStarbase',
    'selectedCraftingStarbase', 'selectedCraftingRecipe', 'selectedProductionStarbase',
    'selectedProductionAsset', 'selectedConsMiningStarbase', 'selectedConsMiningFleet',
    'selectedConsCraftingStarbase', 'selectedConsCraftingRecipe',
    'selectedConsUpgradingStarbase', 'selectedConsUpgradingComponent',
    'selectedConsScanningStarbase', 'selectedConsScanningFleet',
    'selectedConsCargoStarbase', 'selectedConsCargoFleet',
    'selectedConsTotalStarbase', 'selectedConsTotalAsset',
  ]) {
    assert.match(filters, new RegExp(`${field} = '';`));
  }
  assert.match(filters, /invSelectedStarbase = '__all__'/);
});
