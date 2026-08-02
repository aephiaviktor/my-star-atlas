'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const { buildEarningsCacheKey } = require('../electron/earnings-cache-key');
const between = (a,b) => renderer.slice(renderer.indexOf(a), renderer.indexOf(b, renderer.indexOf(a)));

test('Consumption Cargo descriptor is exact and isolated by canonical dimensions', () => {
  const base={schemaVersion:'1',faction:'MUD',playerProfile:'ProfileA',section:'consumption',subtab:'cargo',datasetScope:'cargo-consumption-31d',filters:{starbaseFilter:'',fleetFilter:''}};
  const key=buildEarningsCacheKey(base);
  assert.equal(key,'msa:earnings-cache:{"datasetScope":"cargo-consumption-31d","faction":"MUD","filters":{"fleetFilter":"","starbaseFilter":""},"playerProfile":"ProfileA","schemaVersion":"1","section":"consumption","subtab":"cargo"}');
  for(const changed of [{faction:'ONI'},{playerProfile:'ProfileB'},{filters:{starbaseFilter:'S',fleetFilter:''}},{filters:{starbaseFilter:'',fleetFilter:'F'}}]) assert.notEqual(key,buildEarningsCacheKey({...base,...changed}));
  for(const other of [{section:'earnings',subtab:'breakeven',datasetScope:'complete',filters:{}},{section:'earnings',subtab:'upgrading',datasetScope:'upgrading-ledger',filters:{}},{section:'consumption',subtab:'upgrading',datasetScope:'upgrade-consumption-31d',filters:{componentFilter:'',starbaseFilter:''}},{section:'consumption',subtab:'scanning',datasetScope:'scan-consumption-31d',filters:{starbaseFilter:'',fleetFilter:''}}]) assert.notEqual(key,buildEarningsCacheKey({...base,...other}));
});

test('all Cargo entry points converge and legacy state cannot suppress canonical loading', () => {
  const refresh=between('function getConsumptionCargoCacheInput','/* ---- Consumption: Total ---- */');
  assert.match(refresh,/getActivePlayerProfile\(settings\)/); assert.match(refresh,/starbaseFilter: String/); assert.match(refresh,/fleetFilter: String/);
  assert.match(refresh,/consumptionCargoCache\.inspect\(input\)/); assert.match(refresh,/consumptionCargoCache\.ensure\(input/); assert.match(refresh,/getDailyConsumptionCargo\(requestSettings\)/);
  assert.doesNotMatch(refresh,/getCachedFilterResult|latestConsCargoResult/);
  const parent=between('function refreshVisibleProductionSubtab','function refreshVisibleFactionViews');
  assert.match(parent,/refreshConsCargo\(\)/); assert.doesNotMatch(parent,/latestConsCargoResult \? Promise\.resolve/);
  const setActive=between('function setActiveSubtab','function setActiveEarningsSubtab');
  assert.match(setActive,/subtab === 'consumption'.*refreshConsCargo\(\)/s); assert.doesNotMatch(setActive,/!latestConsCargoResult.*refreshConsCargo/);
  const internal=between('// Consumption subtab switching','// Consumption — Cargo filters');
  assert.match(internal,/currentConsumptionSubtab === 'cargo'\) refreshConsCargo\(\)/);
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  assert.match(prefetch,/consumption-cargo.*isConsumptionCargoCacheFresh.*refreshConsCargo\(\{ settings, starbaseFilter: '', fleetFilter: '' \}\)/s);
});

test('manual refresh and settings save force canonical Cargo revalidation', () => {
  const manual=between('function refreshCurrentVisibleData','function setActiveSubtab');
  assert.match(manual,/currentConsumptionSubtab === 'cargo'\) return refreshConsCargo\(\{ force: true \}\)/);
  const save=between("form.addEventListener('submit'","testInfluxButton.addEventListener");
  assert.match(save,/refreshConsCargo\(\{ force: true \}\)/);
});

test('profile/filter/view/key/generation guard blocks obsolete renderer mutations', () => {
  const block=between('function isActiveConsumptionCargoContext','/* ---- Consumption: Total ---- */');
  assert.match(block,/currentSection !== 'production'/); assert.match(block,/currentSubtab !== 'consumption'/); assert.match(block,/currentConsumptionSubtab !== 'cargo'/);
  assert.match(block,/getConsumptionCargoCacheInput\(\)/); assert.match(block,/buildKey\(input\) !== key/); assert.match(block,/entry\?\.generation === generation/);
  assert.match(block,/if \(!isActiveConsumptionCargoContext\(settled\.key, settled\.entry\.generation\)\) return settled/);
  assert.doesNotMatch(block,/latestConsCargoResult|getCachedFilterResult/);
});

test('faction/profile switch clears incompatible Cargo DOM and starts canonical next identity', () => {
  const factionSwitch=between('// Render cached data immediately if available','saveStatus.textContent = `Switching to ${clickedFaction}...`');
  assert.doesNotMatch(factionSwitch,/getCachedFilterResult\(faction, 'consCargo'/);
  assert.match(factionSwitch,/currentSection === 'production'.*currentSubtab === 'consumption'.*currentConsumptionSubtab === 'cargo'/s);
  assert.match(factionSwitch,/renderConsCargoEmpty\('Loading cargo consumption\.\.\.'\)/); assert.match(factionSwitch,/refreshConsCargo\(\{ settings: nextSettings \}\)/);
  assert.equal((renderer.match(/renderConsCargo\(/g)||[]).length,3,'definition plus two guarded canonical calls only');
});

test('filter listeners use existing selections and automatically canonical-load new keys', () => {
  const listeners=between('// Consumption — Cargo filters','// Consumption — Total filter');
  assert.match(listeners,/selectedConsCargoStarbase = consCargoStarbaseFilter\.value/);
  assert.match(listeners,/selectedConsCargoFleet = ''/);
  assert.match(listeners,/selectedConsCargoFleet = consCargoFleetFilter\.value/);
  assert.equal((listeners.match(/refreshConsCargo\(\)/g)||[]).length,2);
});

test('other five Consumption loaders and prefetch jobs remain in their established architecture', () => {
  for(const name of ['refreshConsScanning','refreshConsMining','refreshConsCrafting','refreshConsUpgrading','refreshConsTotal']) assert.match(renderer,new RegExp(name));
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  for(const key of ['consumption-scanning','consumption-mining','consumption-crafting','consumption-upgrading','consumption-total']) assert.match(prefetch,new RegExp(key));
  assert.doesNotMatch(renderer,/CONSUMPTION_MINING_CACHE_FRESHNESS_MS|900000/);
});
