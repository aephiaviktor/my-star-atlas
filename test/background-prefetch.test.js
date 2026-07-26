const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

test('visible faction data is followed by a cancellable sequential background prefetch', () => {
  assert.match(renderer, /let factionPrefetchGeneration = 0;/);
  assert.match(renderer, /async function runFactionBackgroundPrefetch\(generation, faction\)/);
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

test('faction switching clears previous-faction loaded-result guards before restoring filters', () => {
  const handler = renderer.slice(
    renderer.indexOf('factionButtons.forEach((button) => {'),
    renderer.indexOf("scanningFleetFilter.addEventListener('change'"),
  );
  const recordIndex = handler.indexOf('recordFactionFilterState(oldFaction)');
  const resetIndex = handler.indexOf('resetFactionScopedState()');
  const restoreIndex = handler.indexOf('restoreFactionFilterState(clickedFaction)');
  assert.ok(recordIndex >= 0);
  assert.ok(resetIndex > recordIndex);
  assert.ok(restoreIndex > resetIndex);
});
