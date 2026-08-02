'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const { buildEarningsCacheKey } = require('../electron/earnings-cache-key');
const between = (a,b) => renderer.slice(renderer.indexOf(a), renderer.indexOf(b, renderer.indexOf(a)));

test('Consumption Mining descriptor is exact and isolated by canonical dimensions', () => {
  const base={schemaVersion:'1',faction:'MUD',playerProfile:'ProfileA',section:'consumption',subtab:'mining',datasetScope:'mining-consumption-31d',filters:{starbaseFilter:'',fleetFilter:''}};
  const key=buildEarningsCacheKey(base);
  assert.equal(key,'msa:earnings-cache:{"datasetScope":"mining-consumption-31d","faction":"MUD","filters":{"fleetFilter":"","starbaseFilter":""},"playerProfile":"ProfileA","schemaVersion":"1","section":"consumption","subtab":"mining"}');
  for(const changed of [{faction:'ONI'},{playerProfile:'ProfileB'},{filters:{starbaseFilter:'S',fleetFilter:''}},{filters:{starbaseFilter:'',fleetFilter:'F'}}]) assert.notEqual(key,buildEarningsCacheKey({...base,...changed}));
  for(const other of [{section:'earnings',subtab:'breakeven',datasetScope:'complete',filters:{}},{section:'earnings',subtab:'upgrading',datasetScope:'upgrading-ledger',filters:{}},{section:'consumption',subtab:'upgrading',datasetScope:'upgrade-consumption-31d',filters:{componentFilter:'',starbaseFilter:''}},{section:'consumption',subtab:'scanning',datasetScope:'scan-consumption-31d',filters:{starbaseFilter:'',fleetFilter:''}}]) assert.notEqual(key,buildEarningsCacheKey({...base,...other}));
});

test('all Mining entry points converge and legacy state cannot suppress canonical loading', () => {
  const refresh=between('function getConsumptionMiningCacheInput','/* ---- Consumption: Crafting ---- */');
  assert.match(refresh,/getActivePlayerProfile\(settings\)/); assert.match(refresh,/starbaseFilter: String/); assert.match(refresh,/fleetFilter: String/);
  assert.match(refresh,/consumptionMiningCache\.inspect\(input\)/); assert.match(refresh,/consumptionMiningCache\.ensure\(input/); assert.match(refresh,/getDailyConsumptionMining\(requestSettings\)/);
  assert.doesNotMatch(refresh,/getCachedFilterResult|latestConsMiningResult/);
  const parent=between('function refreshVisibleProductionSubtab','function refreshVisibleFactionViews');
  assert.match(parent,/currentSubtab === 'consumption'\) return refreshVisibleConsumptionIdentity\(\)/);
  const setActive=between('function setActiveSubtab','function setActiveEarningsSubtab');
  assert.match(setActive,/subtab === 'consumption'.*refreshVisibleConsumptionIdentity\(\)/s);
  const internal=between('// Consumption subtab switching','// Consumption — Mining filters');
  assert.match(internal,/currentConsumptionSubtab === 'mining'\) refreshConsMining\(\)/);
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  assert.match(prefetch,/consumption-mining.*isConsumptionMiningCacheFresh.*refreshConsMining\(\{ settings, starbaseFilter: '', fleetFilter: '' \}\)/s);
});

test('manual refresh and settings save force canonical Mining revalidation', () => {
  const manual=between('function refreshCurrentVisibleData','function setActiveSubtab');
  assert.match(manual,/currentConsumptionSubtab === 'mining'\) return refreshConsMining\(\{ force: true \}\)/);
  const save=between('async function applySettingsSave',"form.addEventListener('submit'");
  assert.match(save,/await refreshVisibleIdentity\(\{ force \}\)/);
});

test('profile/filter/view/key/generation guard blocks obsolete renderer mutations', () => {
  const block=between('function isActiveConsumptionMiningContext','/* ---- Consumption: Crafting ---- */');
  assert.match(block,/currentSection !== 'production'/); assert.match(block,/currentSubtab !== 'consumption'/); assert.match(block,/currentConsumptionSubtab !== 'mining'/);
  assert.match(block,/getConsumptionMiningCacheInput\(\)/); assert.match(block,/buildKey\(input\) !== key/); assert.match(block,/entry\?\.generation === generation/);
  assert.match(block,/if \(!isActiveConsumptionMiningContext\(settled\.key, settled\.entry\.generation\)\) return settled/);
  assert.doesNotMatch(block,/latestConsMiningResult|getCachedFilterResult/);
});

test('faction/profile switch clears incompatible Mining DOM and starts canonical next identity', () => {
  const factionSwitch=between('// Render cached data immediately if available','saveStatus.textContent = `Switching to ${clickedFaction}...`');
  assert.doesNotMatch(factionSwitch,/getCachedFilterResult\(faction, 'consMining'/);
  assert.match(factionSwitch,/currentSection === 'production'.*currentSubtab === 'consumption'.*currentConsumptionSubtab === 'mining'/s);
  assert.match(factionSwitch,/renderConsMiningEmpty\('Loading mining consumption\.\.\.'\)/); assert.match(factionSwitch,/refreshConsMining\(\{ settings: nextSettings \}\)/);
  assert.equal((renderer.match(/renderConsMining\(/g)||[]).length,3,'definition plus two guarded canonical calls only');
});

test('filter listeners use existing selections and automatically canonical-load new keys', () => {
  const listeners=between('// Consumption — Mining filters','// Consumption — Crafting filters');
  assert.match(listeners,/selectedConsMiningStarbase = consMiningStarbaseFilter\.value/);
  assert.match(listeners,/selectedConsMiningFleet = ''/);
  assert.match(listeners,/selectedConsMiningFleet = consMiningFleetFilter\.value/);
  assert.equal((listeners.match(/refreshConsMining\(\)/g)||[]).length,2);
});

test('other five Consumption loaders and prefetch jobs remain in their established architecture', () => {
  for(const name of ['refreshConsScanning','refreshConsCargo','refreshConsCrafting','refreshConsUpgrading','refreshConsTotal']) assert.match(renderer,new RegExp(name));
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  for(const key of ['consumption-scanning','consumption-cargo','consumption-crafting','consumption-upgrading','consumption-total']) assert.match(prefetch,new RegExp(key));
  assert.doesNotMatch(renderer,/CONSUMPTION_MINING_CACHE_FRESHNESS_MS|900000/);
});
