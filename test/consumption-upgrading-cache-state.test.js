'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const { buildEarningsCacheKey } = require('../electron/earnings-cache-key');
const between = (a,b) => renderer.slice(renderer.indexOf(a), renderer.indexOf(b, renderer.indexOf(a)));

test('Consumption Upgrading descriptor is isolated by every canonical dimension', () => {
  const base={schemaVersion:'1',faction:'MUD',playerProfile:'ProfileA',section:'consumption',subtab:'upgrading',datasetScope:'upgrade-consumption-31d',filters:{componentFilter:'',starbaseFilter:''}};
  const key=buildEarningsCacheKey(base);
  assert.equal(key,'msa:earnings-cache:{"datasetScope":"upgrade-consumption-31d","faction":"MUD","filters":{"componentFilter":"","starbaseFilter":""},"playerProfile":"ProfileA","schemaVersion":"1","section":"consumption","subtab":"upgrading"}');
  for(const changed of [{faction:'ONI'},{playerProfile:'ProfileB'},{filters:{componentFilter:'A',starbaseFilter:''}},{filters:{componentFilter:'',starbaseFilter:'S'}}]) assert.notEqual(key,buildEarningsCacheKey({...base,...changed}));
  assert.notEqual(key,buildEarningsCacheKey({...base,section:'earnings',datasetScope:'upgrading-ledger'}));
  assert.notEqual(key,buildEarningsCacheKey({...base,section:'earnings',subtab:'breakeven',datasetScope:'complete'}));
});

test('all existing entry points converge on canonical ensure and legacy cache cannot suppress it', () => {
  const refresh=between('function getConsumptionUpgradingCacheInput','/* ---- Consumption: Scanning ---- */');
  assert.match(refresh,/getActivePlayerProfile\(settings\)/); assert.match(refresh,/componentFilter: String/); assert.match(refresh,/starbaseFilter: String/);
  assert.match(refresh,/consumptionUpgradingCache\.inspect\(input\)/); assert.match(refresh,/consumptionUpgradingCache\.ensure\(input/);
  assert.match(refresh,/getDailyConsumptionUpgrading\(requestSettings\)/);
  assert.doesNotMatch(refresh,/getCachedFilterResult|latestConsUpgradingResult/);
  const activation=between('// Consumption subtab switching','// Consumption — Mining filters');
  assert.match(activation,/currentConsumptionSubtab === 'upgrading'\) refreshConsUpgrading\(\)/);
  const parent=between('function refreshVisibleProductionSubtab','function refreshVisibleFactionViews');
  assert.match(parent,/currentSubtab === 'consumption'\) return refreshVisibleConsumptionIdentity\(\)/);
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  assert.match(prefetch,/consumption-upgrading.*isConsumptionUpgradingCacheFresh.*refreshConsUpgrading\(\{ settings, starbaseFilter: '', componentFilter: '' \}\)/s);
});

test('manual refresh and settings save force canonical revalidation', () => {
  const manual=between('function refreshCurrentVisibleData','function setActiveSubtab');
  assert.match(manual,/currentConsumptionSubtab === 'upgrading'\) return refreshConsUpgrading\(\{ force: true \}\)/);
  const save=between('async function applySettingsSave',"form.addEventListener('submit'");
  assert.match(save,/await refreshVisibleIdentity\(\{ force \}\)/);
});

test('late context responses require parent, internal view, identity, filters, key and generation', () => {
  const block=between('function isActiveConsumptionUpgradingContext','/* ---- Consumption: Scanning ---- */');
  assert.match(block,/currentSection !== 'production'/); assert.match(block,/currentSubtab !== 'consumption'/); assert.match(block,/currentConsumptionSubtab !== 'upgrading'/);
  assert.match(block,/getConsumptionUpgradingCacheInput\(\)/); assert.match(block,/buildKey\(input\) !== key/); assert.match(block,/entry\?\.generation === generation/);
  assert.match(block,/if \(!isActiveConsumptionUpgradingContext\(settled\.key, settled\.entry\.generation\)\) return settled/);
});

test('faction switch bypasses legacy Upgrading data, clears old DOM, and starts the canonical next identity', () => {
  const factionSwitch=between('// Render cached data immediately if available','saveStatus.textContent = `Switching to ${clickedFaction}...`');
  assert.doesNotMatch(factionSwitch,/getCachedFilterResult\(faction, 'consUpgrading'/);
  assert.match(factionSwitch,/currentSection === 'production'.*currentSubtab === 'consumption'.*currentConsumptionSubtab === 'upgrading'/s);
  assert.match(factionSwitch,/renderConsUpgradingEmpty\('Loading upgrading consumption\.\.\.'\)/);
  assert.match(factionSwitch,/refreshConsUpgrading\(\{ settings: nextSettings \}\)/);
  assert.equal((renderer.match(/renderConsUpgrading\(/g) || []).length, 3, 'only the definition and two guarded canonical render sites remain');
});

test('same-faction profile and filter changes cannot accept legacy or delayed mismatched results', () => {
  const guard=between('function isActiveConsumptionUpgradingContext','async function refreshConsUpgrading');
  assert.match(guard,/getConsumptionUpgradingCacheInput\(\)/);
  assert.match(guard,/buildKey\(input\) !== key/);
  assert.match(guard,/entry\?\.generation === generation/);
  const refresh=between('async function refreshConsUpgrading','/* ---- Consumption: Scanning ---- */');
  assert.match(refresh,/if \(!isActiveConsumptionUpgradingContext\(settled\.key, settled\.entry\.generation\)\) return settled;/);
  assert.doesNotMatch(refresh,/latestConsUpgradingResult|getCachedFilterResult|renderConsUpgrading\([^dv]/);
});

test('other five Consumption loaders and existing IPC shape remain present', () => {
  for(const name of ['refreshConsScanning','refreshConsMining','refreshConsCargo','refreshConsCrafting','refreshConsTotal']) assert.match(renderer,new RegExp(name));
  assert.doesNotMatch(renderer,/CONSUMPTION_UPGRADING_CACHE_FRESHNESS_MS|900000/);
});
