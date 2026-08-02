'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const { buildEarningsCacheKey } = require('../electron/earnings-cache-key');
const between = (a,b) => renderer.slice(renderer.indexOf(a), renderer.indexOf(b, renderer.indexOf(a)));

test('Consumption Total descriptor is exact and isolated by canonical dimensions', () => {
  const base={schemaVersion:'1',faction:'MUD',playerProfile:'ProfileA',section:'consumption',subtab:'total',datasetScope:'total-consumption-31d',filters:{starbaseFilter:'',assetFilter:''}};
  const key=buildEarningsCacheKey(base);
  assert.equal(key,'msa:earnings-cache:{"datasetScope":"total-consumption-31d","faction":"MUD","filters":{"assetFilter":"","starbaseFilter":""},"playerProfile":"ProfileA","schemaVersion":"1","section":"consumption","subtab":"total"}');
  for(const changed of [{faction:'ONI'},{playerProfile:'ProfileB'},{filters:{starbaseFilter:'S',assetFilter:''}},{filters:{starbaseFilter:'',assetFilter:'R'}}]) assert.notEqual(key,buildEarningsCacheKey({...base,...changed}));
  for(const other of [
    {section:'earnings',subtab:'breakeven',datasetScope:'complete',filters:{}},
    {section:'earnings',subtab:'upgrading',datasetScope:'upgrading-ledger',filters:{}},
    {section:'consumption',subtab:'upgrading',datasetScope:'upgrade-consumption-31d',filters:{componentFilter:'',starbaseFilter:''}},
    {section:'consumption',subtab:'scanning',datasetScope:'scan-consumption-31d',filters:{starbaseFilter:'',fleetFilter:''}},
    {section:'consumption',subtab:'mining',datasetScope:'mining-consumption-31d',filters:{starbaseFilter:'',fleetFilter:''}},
    {section:'consumption',subtab:'cargo',datasetScope:'cargo-consumption-31d',filters:{starbaseFilter:'',fleetFilter:''}},
    {section:'consumption',subtab:'crafting',datasetScope:'crafting-consumption-31d',filters:{starbaseFilter:'',recipeFilter:''}},
  ]) assert.notEqual(key,buildEarningsCacheKey({...base,...other}));
});

test('all Total entry points converge and legacy state cannot suppress canonical loading', () => {
  const refresh=between('function getConsumptionTotalCacheInput','/* ---- PCR Charts ---- */');
  assert.match(refresh,/getActivePlayerProfile\(settings\)/); assert.match(refresh,/starbaseFilter: String/); assert.match(refresh,/assetFilter: String/);
  assert.match(refresh,/consumptionTotalCache\.inspect\(input\)/); assert.match(refresh,/consumptionTotalCache\.ensure\(input/); assert.match(refresh,/getDailyConsumptionTotal\(requestSettings\)/);
  assert.doesNotMatch(refresh,/getCachedFilterResult|latestConsTotalResult/);
  const parent=between('function refreshVisibleProductionSubtab','function refreshVisibleFactionViews');
  assert.match(parent,/currentSubtab === 'consumption'\) return refreshVisibleConsumptionIdentity\(\)/);
  const setActive=between('function setActiveSubtab','function setActiveEarningsSubtab');
  assert.match(setActive,/subtab === 'consumption'.*refreshVisibleConsumptionIdentity\(\)/s);
  const internal=between('// Consumption subtab switching','// Consumption — Mining filters');
  assert.match(internal,/currentConsumptionSubtab === 'total'\) refreshConsTotal\(\)/);
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  assert.match(prefetch,/consumption-total.*isConsumptionTotalCacheFresh.*refreshConsTotal\(\{ settings, starbaseFilter: '', assetFilter: '' \}\)/s);
});

test('manual refresh and settings save force canonical Total revalidation', () => {
  const manual=between('function refreshCurrentVisibleData','function setActiveSubtab');
  assert.match(manual,/currentConsumptionSubtab === 'total'\) return refreshConsTotal\(\{ force: true \}\)/);
  const save=between('async function applySettingsSave',"form.addEventListener('submit'");
  assert.match(save,/await refreshVisibleIdentity\(\{ force \}\)/);
});

test('profile/filter/view/key/generation guard blocks obsolete renderer mutations', () => {
  const block=between('function isActiveConsumptionTotalContext','/* ---- PCR Charts ---- */');
  assert.match(block,/currentSection !== 'production'/); assert.match(block,/currentSubtab !== 'consumption'/); assert.match(block,/currentConsumptionSubtab !== 'total'/);
  assert.match(block,/getConsumptionTotalCacheInput\(\)/); assert.match(block,/buildKey\(input\) !== key/); assert.match(block,/entry\?\.generation === generation/);
  assert.match(block,/if \(!isActiveConsumptionTotalContext\(settled\.key, settled\.entry\.generation\)\) return settled/);
  assert.doesNotMatch(block,/latestConsTotalResult|getCachedFilterResult/);
});

test('faction/profile switch clears incompatible Total DOM and starts canonical next identity', () => {
  const factionSwitch=between('// Render cached data immediately if available','saveStatus.textContent = `Switching to ${clickedFaction}...`');
  assert.doesNotMatch(factionSwitch,/getCachedFilterResult\(faction, 'consTotal'/);
  assert.match(factionSwitch,/currentSection === 'production'.*currentSubtab === 'consumption'.*currentConsumptionSubtab === 'total'/s);
  assert.match(factionSwitch,/renderConsTotalEmpty\('Loading total consumption\.\.\.'\)/); assert.match(factionSwitch,/refreshConsTotal\(\{ settings: nextSettings \}\)/);
  assert.equal((renderer.match(/renderConsTotal\(/g)||[]).length,3,'definition plus two guarded canonical calls only');
});

test('filter listeners use existing selections and automatically canonical-load new keys', () => {
  const listeners=between('// Consumption — Total filter','openSettingsButton.addEventListener');
  assert.match(listeners,/selectedConsTotalStarbase = consTotalStarbaseFilter\.value/);
  assert.match(listeners,/selectedConsTotalAsset = consTotalAssetFilter\.value/);
  assert.match(listeners,/selectedConsTotalStarbase = ''/);
  assert.equal((listeners.match(/refreshConsTotal\(\)/g)||[]).length,2);
});

test('asset-driven starbase invalidation rebuilds and converges on the resulting exact identity', () => {
  const refresh=between('async function refreshConsTotal','/* ---- PCR Charts ---- */');
  assert.match(refresh,/renderConsTotal\(displayable\);[\s\S]*getConsumptionTotalCacheInput\(\)[\s\S]*buildKey\(resultingInput\) !== initial\.key[\s\S]*return refreshConsTotal\(\)/);
  assert.match(refresh,/renderConsTotal\(value\);[\s\S]*getConsumptionTotalCacheInput\(\)[\s\S]*buildKey\(resultingInput\) !== settled\.key[\s\S]*return refreshConsTotal\(\)/);
});

test('other five Consumption loaders and prefetch jobs remain in their established architecture', () => {
  for(const name of ['refreshConsScanning','refreshConsMining','refreshConsCargo','refreshConsCrafting','refreshConsUpgrading']) assert.match(renderer,new RegExp(name));
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  for(const key of ['consumption-scanning','consumption-mining','consumption-cargo','consumption-crafting','consumption-upgrading']) assert.match(prefetch,new RegExp(key));
  assert.doesNotMatch(renderer,/CONSUMPTION_MINING_CACHE_FRESHNESS_MS|900000/);
});
