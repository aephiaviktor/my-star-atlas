'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

test('every primary menu activation starts visible-first whole-menu prefetch', () => {
  assert.match(renderer, /function setActiveSection\(section\)[\s\S]*?void loadVisibleThenPrefetch\(refreshVisibleFactionViews\)/);
});

test('active menu finishes before Earnings and excludes unrelated menus', () => {
  const prefetch = renderer.slice(renderer.indexOf('async function runFactionBackgroundPrefetch'), renderer.indexOf('function loadVisibleThenPrefetch'));
  for (const key of ["key: 'earnings'", "key: 'earnings-breakeven'", "key: 'earnings-upgrading'", "key: 'earnings-marketplace'"]) {
    assert.match(prefetch, new RegExp(key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
  assert.match(prefetch, /const tasks = activeSection === 'earnings'\s*\? earningsTasks\s*:\s*\[\.\.\.\(tasksBySection\[activeSection\] \|\| \[\]\), \.\.\.earningsTasks\]/);
  assert.doesNotMatch(prefetch, /syncMarketplace/);
});

test('navigation preempts the old queue and captures the new active menu', () => {
  const orchestration = renderer.slice(renderer.indexOf('async function runFactionBackgroundPrefetch'), renderer.indexOf('// Per-filter cache'));
  assert.match(orchestration, /if \(generation !== factionPrefetchGeneration\) return/);
  assert.match(orchestration, /const activeSection = currentSection/);
  assert.match(orchestration, /runFactionBackgroundPrefetch\(generation, faction, activeSection\)/);
});

test('startup queues marketplace writes only after foreground and background data loading settle', () => {
  const start = renderer.indexOf('async function loadInitialState');
  const startup = renderer.slice(start, renderer.indexOf("document.querySelectorAll('.nav-button')", start));
  assert.match(startup, /void loadVisibleThenPrefetch\(refreshVisibleFactionViews\)\.then\(runMarketplaceBackgroundSync\)/);
  assert.doesNotMatch(startup, /await loadVisibleThenPrefetch/);
});

test('regular Earnings snapshots always retain Crafting internal ingredient basis', () => {
  const start = renderer.indexOf('async function refreshEarnings()');
  const refresh = renderer.slice(start, renderer.indexOf('function refreshCurrentVisibleData', start));
  assert.match(refresh, /earningsSubtab: 'crafting'/);
  assert.doesNotMatch(refresh, /earningsSubtab: currentEarningsSubtab/);
});

test('Marketplace stale cache remains rendered while background synchronization runs', () => {
  const refresh = renderer.slice(renderer.indexOf('async function refreshMarketplace'), renderer.indexOf('function runMarketplaceBackgroundSync'));
  assert.match(refresh, /const cached = marketplaceSnapshotCache\.get\(cacheKey\)/);
  assert.match(refresh, /if \(cached\) \{[\s\S]*renderEarningsMarketplace\(latestMarketplaceResult\)/);
  assert.match(refresh, /if \(!cached\) renderEarningsMarketplaceLoading/);
});
