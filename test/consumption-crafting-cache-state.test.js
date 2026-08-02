'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const { buildEarningsCacheKey } = require('../electron/earnings-cache-key');
const between = (a,b) => renderer.slice(renderer.indexOf(a), renderer.indexOf(b, renderer.indexOf(a)));

test('Consumption Crafting descriptor is exact and isolated by canonical dimensions', () => {
  const base={schemaVersion:'1',faction:'MUD',playerProfile:'ProfileA',section:'consumption',subtab:'crafting',datasetScope:'crafting-consumption-31d',filters:{starbaseFilter:'',recipeFilter:''}};
  const key=buildEarningsCacheKey(base);
  assert.equal(key,'msa:earnings-cache:{"datasetScope":"crafting-consumption-31d","faction":"MUD","filters":{"recipeFilter":"","starbaseFilter":""},"playerProfile":"ProfileA","schemaVersion":"1","section":"consumption","subtab":"crafting"}');
  for(const changed of [{faction:'ONI'},{playerProfile:'ProfileB'},{filters:{starbaseFilter:'S',recipeFilter:''}},{filters:{starbaseFilter:'',recipeFilter:'R'}}]) assert.notEqual(key,buildEarningsCacheKey({...base,...changed}));
  for(const other of [{section:'earnings',subtab:'breakeven',datasetScope:'complete',filters:{}},{section:'earnings',subtab:'upgrading',datasetScope:'upgrading-ledger',filters:{}},{section:'consumption',subtab:'upgrading',datasetScope:'upgrade-consumption-31d',filters:{componentFilter:'',starbaseFilter:''}},{section:'consumption',subtab:'scanning',datasetScope:'scan-consumption-31d',filters:{starbaseFilter:'',recipeFilter:''}}]) assert.notEqual(key,buildEarningsCacheKey({...base,...other}));
});

test('all Crafting entry points converge and legacy state cannot suppress canonical loading', () => {
  const refresh=between('function getConsumptionCraftingCacheInput','/* ---- Consumption: Total ---- */');
  assert.match(refresh,/getActivePlayerProfile\(settings\)/); assert.match(refresh,/starbaseFilter: String/); assert.match(refresh,/recipeFilter: String/);
  assert.match(refresh,/consumptionCraftingCache\.inspect\(input\)/); assert.match(refresh,/consumptionCraftingCache\.ensure\(input/); assert.match(refresh,/getDailyConsumptionCrafting\(requestSettings\)/);
  assert.doesNotMatch(refresh,/getCachedFilterResult|latestConsCraftingResult/);
  const parent=between('function refreshVisibleProductionSubtab','function refreshVisibleFactionViews');
  assert.match(parent,/currentSubtab === 'consumption'\) return refreshVisibleConsumptionIdentity\(\)/);
  const setActive=between('function setActiveSubtab','function setActiveEarningsSubtab');
  assert.match(setActive,/subtab === 'consumption'.*refreshVisibleConsumptionIdentity\(\)/s);
  const internal=between('// Consumption subtab switching','// Consumption — Crafting filters');
  assert.match(internal,/currentConsumptionSubtab === 'crafting'\) refreshConsCrafting\(\)/);
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  assert.match(prefetch,/consumption-crafting.*isConsumptionCraftingCacheFresh.*refreshConsCrafting\(\{ settings, starbaseFilter: '', recipeFilter: '' \}\)/s);
});

test('manual refresh and settings save force canonical Crafting revalidation', () => {
  const manual=between('function refreshCurrentVisibleData','function setActiveSubtab');
  assert.match(manual,/currentConsumptionSubtab === 'crafting'\) return refreshConsCrafting\(\{ force: true \}\)/);
  const save=between('async function applySettingsSave',"form.addEventListener('submit'");
  assert.match(save,/await refreshVisibleIdentity\(\{ force \}\)/);
});

test('profile/filter/view/key/generation guard blocks obsolete renderer mutations', () => {
  const block=between('function isActiveConsumptionCraftingContext','/* ---- Consumption: Total ---- */');
  assert.match(block,/currentSection !== 'production'/); assert.match(block,/currentSubtab !== 'consumption'/); assert.match(block,/currentConsumptionSubtab !== 'crafting'/);
  assert.match(block,/getConsumptionCraftingCacheInput\(\)/); assert.match(block,/buildKey\(input\) !== key/); assert.match(block,/entry\?\.generation === generation/);
  assert.match(block,/if \(!isActiveConsumptionCraftingContext\(settled\.key, settled\.entry\.generation\)\) return settled/);
  assert.doesNotMatch(block,/latestConsCraftingResult|getCachedFilterResult/);
});

test('faction/profile switch clears incompatible Crafting DOM and starts canonical next identity', () => {
  const factionSwitch=between('// Render cached data immediately if available','saveStatus.textContent = `Switching to ${clickedFaction}...`');
  assert.doesNotMatch(factionSwitch,/getCachedFilterResult\(faction, 'consCrafting'/);
  assert.match(factionSwitch,/currentSection === 'production'.*currentSubtab === 'consumption'.*currentConsumptionSubtab === 'crafting'/s);
  assert.match(factionSwitch,/renderConsCraftingEmpty\('Loading crafting consumption\.\.\.'\)/); assert.match(factionSwitch,/refreshConsCrafting\(\{ settings: nextSettings \}\)/);
  assert.equal((renderer.match(/renderConsCrafting\(/g)||[]).length,3,'definition plus two guarded canonical calls only');
});

test('filter listeners use existing selections and automatically canonical-load new keys', () => {
  const listeners=between('// Consumption — Crafting filters','// Consumption — Total filter');
  assert.match(listeners,/selectedConsCraftingStarbase = consCraftingStarbaseFilter\.value/);
  assert.match(listeners,/selectedConsCraftingRecipe = consCraftingRecipeFilter\.value/);
  assert.equal((listeners.match(/refreshConsCrafting\(\)/g)||[]).length,2);
});

test('recipe-driven starbase invalidation rebuilds and converges on the resulting exact identity', () => {
  const refresh=between('async function refreshConsCrafting','/* ---- Consumption: Upgrading ---- */');
  assert.match(refresh,/renderConsCrafting\(displayable\);[\s\S]*getConsumptionCraftingCacheInput\(\)[\s\S]*buildKey\(resultingInput\) !== initial\.key[\s\S]*return refreshConsCrafting\(\)/);
  assert.match(refresh,/renderConsCrafting\(value\);[\s\S]*getConsumptionCraftingCacheInput\(\)[\s\S]*buildKey\(resultingInput\) !== settled\.key[\s\S]*return refreshConsCrafting\(\)/);
});

test('other five Consumption loaders and prefetch jobs remain in their established architecture', () => {
  for(const name of ['refreshConsScanning','refreshConsMining','refreshConsCargo','refreshConsUpgrading','refreshConsTotal']) assert.match(renderer,new RegExp(name));
  const prefetch=between('async function runFactionBackgroundPrefetch','function loadVisibleThenPrefetch');
  for(const key of ['consumption-scanning','consumption-mining','consumption-cargo','consumption-upgrading','consumption-total']) assert.match(prefetch,new RegExp(key));
  assert.doesNotMatch(renderer,/CONSUMPTION_MINING_CACHE_FRESHNESS_MS|900000/);
});
