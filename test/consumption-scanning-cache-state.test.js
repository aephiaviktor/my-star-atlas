'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const { buildEarningsCacheKey } = require('../electron/earnings-cache-key');
const between = (a,b) => renderer.slice(renderer.indexOf(a), renderer.indexOf(b, renderer.indexOf(a)));

test('Consumption Scanning descriptor is exact and isolated by canonical dimensions', () => {
  const base={schemaVersion:'1',faction:'MUD',playerProfile:'ProfileA',section:'consumption',subtab:'scanning',datasetScope:'scan-consumption-31d',filters:{starbaseFilter:'',fleetFilter:''}};
  const key=buildEarningsCacheKey(base);
  assert.equal(key,'msa:earnings-cache:{"datasetScope":"scan-consumption-31d","faction":"MUD","filters":{"fleetFilter":"","starbaseFilter":""},"playerProfile":"ProfileA","schemaVersion":"1","section":"consumption","subtab":"scanning"}');
  for(const changed of [{faction:'ONI'},{playerProfile:'ProfileB'},{filters:{starbaseFilter:'S',fleetFilter:''}},{filters:{starbaseFilter:'',fleetFilter:'F'}}]) assert.notEqual(key,buildEarningsCacheKey({...base,...changed}));
  for(const other of [{section:'earnings',subtab:'breakeven',datasetScope:'complete',filters:{}},{section:'earnings',subtab:'upgrading',datasetScope:'upgrading-ledger',filters:{}},{section:'consumption',subtab:'upgrading',datasetScope:'upgrade-consumption-31d',filters:{componentFilter:'',starbaseFilter:''}}]) assert.notEqual(key,buildEarningsCacheKey({...base,...other}));
});

test('all Scanning entry points converge and legacy state cannot suppress canonical loading', () => {
  const refresh=between('function getConsumptionScanningCacheInput','/* ---- Consumption: Cargo ---- */');
  assert.match(refresh,/getActivePlayerProfile\(settings\)/); assert.match(refresh,/starbaseFilter: String/); assert.match(refresh,/fleetFilter: String/);
  assert.match(refresh,/consumptionScanningCache\.inspect\(input\)/); assert.match(refresh,/consumptionScanningCache\.ensure\(input/); assert.match(refresh,/getDailyConsumptionScanning\(requestSettings\)/);
  assert.doesNotMatch(refresh,/getCachedFilterResult|latestConsScanningResult/);
  const parent=between('function refreshVisibleProductionSubtab','function refreshVisibleFactionViews');
  assert.match(parent,/currentSubtab === 'consumption'\) return refreshVisibleConsumptionIdentity\(\)/);
  const setActive=between('function setActiveSubtab','function setActiveEarningsSubtab');
  assert.match(setActive,/subtab === 'consumption'.*refreshVisibleConsumptionIdentity\(\)/s);
  const internal=between('// Consumption subtab switching','// Consumption — Mining filters');
  assert.match(internal,/currentConsumptionSubtab === 'scanning'\) refreshConsScanning\(\)/);
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  assert.match(prefetch,/consumption-scanning.*isConsumptionScanningCacheFresh.*refreshConsScanning\(\{ settings, starbaseFilter: '', fleetFilter: '' \}\)/s);
});

test('manual refresh and settings save force canonical Scanning revalidation', () => {
  const manual=between('function refreshCurrentVisibleData','function setActiveSubtab');
  assert.match(manual,/currentConsumptionSubtab === 'scanning'\) return refreshConsScanning\(\{ force: true \}\)/);
  const save=between('async function applySettingsSave',"form.addEventListener('submit'");
  assert.match(save,/await refreshVisibleIdentity\(\{ force \}\)/);
});

test('profile/filter/view/key/generation guard blocks obsolete renderer mutations', () => {
  const block=between('function isActiveConsumptionScanningContext','/* ---- Consumption: Cargo ---- */');
  assert.match(block,/currentSection !== 'production'/); assert.match(block,/currentSubtab !== 'consumption'/); assert.match(block,/currentConsumptionSubtab !== 'scanning'/);
  assert.match(block,/getConsumptionScanningCacheInput\(\)/); assert.match(block,/buildKey\(input\) !== key/); assert.match(block,/entry\?\.generation === generation/);
  assert.match(block,/if \(!isActiveConsumptionScanningContext\(settled\.key, settled\.entry\.generation\)\) return settled/);
  assert.doesNotMatch(block,/latestConsScanningResult|getCachedFilterResult/);
});

test('faction/profile switch clears incompatible Scanning DOM and starts canonical next identity', () => {
  const factionSwitch=between('// Render cached data immediately if available','saveStatus.textContent = `Switching to ${clickedFaction}...`');
  assert.doesNotMatch(factionSwitch,/getCachedFilterResult\(faction, 'consScanning'/);
  assert.match(factionSwitch,/currentSection === 'production'.*currentSubtab === 'consumption'.*currentConsumptionSubtab === 'scanning'/s);
  assert.match(factionSwitch,/renderConsScanningEmpty\('Loading scanning consumption\.\.\.'\)/); assert.match(factionSwitch,/refreshConsScanning\(\{ settings: nextSettings \}\)/);
  assert.equal((renderer.match(/renderConsScanning\(/g)||[]).length,3,'definition plus two guarded canonical calls only');
});

test('filter listeners use existing selections and automatically canonical-load new keys', () => {
  const listeners=between('// Consumption — Scanning filters','// Consumption — Cargo filters');
  assert.match(listeners,/selectedConsScanningStarbase = consScanningStarbaseFilter\.value/);
  assert.match(listeners,/selectedConsScanningFleet = ''/);
  assert.match(listeners,/selectedConsScanningFleet = consScanningFleetFilter\.value/);
  assert.equal((listeners.match(/refreshConsScanning\(\)/g)||[]).length,2);
});

test('other five Consumption loaders and prefetch jobs remain in their established architecture', () => {
  for(const name of ['refreshConsMining','refreshConsCargo','refreshConsCrafting','refreshConsUpgrading','refreshConsTotal']) assert.match(renderer,new RegExp(name));
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  for(const key of ['consumption-mining','consumption-cargo','consumption-crafting','consumption-upgrading','consumption-total']) assert.match(prefetch,new RegExp(key));
  assert.doesNotMatch(renderer,/CONSUMPTION_SCANNING_CACHE_FRESHNESS_MS|900000/);
});
