'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const between = (a, b) => renderer.slice(renderer.indexOf(a), renderer.indexOf(b, renderer.indexOf(a)));

function loadPolicy() {
  const source = between('function classifySettingsImpact', 'async function applySettingsSave');
  const context = { normalizeFaction: (value) => String(value || 'USTUR').toUpperCase(), getActivePlayerProfile: (settings) => settings?.profile || '' };
  vm.runInNewContext(`${source}\nthis.policy = { classifySettingsImpact, getVisibleDataset, isVisibleDatasetAffected, getLegacyResetPlan };`, context);
  return context.policy;
}

function impact(overrides = {}) {
  return { factionChanged: false, profileChanged: false, influxConnectionChanged: false, influxBucketChanged: false, optimizationBucketChanged: false, aephiaSourceChanged: false, rpcSourceChanged: false, ...overrides };
}

test('visible dispatcher targets exactly one Consumption identity and manual refresh remains force-only without prefetch', () => {
  const dispatcher = between('function refreshVisibleConsumptionIdentity', 'function refreshVisibleIdentity');
  for (const name of ['Scanning', 'Mining', 'Cargo', 'Crafting', 'Upgrading', 'Total']) assert.match(dispatcher, new RegExp(`currentConsumptionSubtab === '.*?'\\) return refreshCons${name}\\(\\{ force \\}\\)`));
  const parent = between('function refreshVisibleProductionSubtab', 'function refreshVisibleFactionViews');
  assert.match(parent, /refreshVisibleConsumptionIdentity\(\)/);
  assert.doesNotMatch(parent, /Promise\.all/);
  const manual = between('function refreshCurrentVisibleData', 'function setActiveSubtab');
  assert.doesNotMatch(manual, /runFactionBackgroundPrefetch|loadVisibleThenPrefetch/);
  for (const name of ['Breakeven', 'EarningsUpgrading', 'ConsMining', 'ConsCrafting', 'ConsUpgrading', 'ConsScanning', 'ConsCargo', 'ConsTotal']) assert.match(manual, new RegExp(`refresh${name}\\(\\{ force: true \\}\\)`));
});

test('settings classification separates connection, primary bucket, optimization, Aephia, RPC, runtime and Marketplace inputs', () => {
  const { classifySettingsImpact } = loadPolicy();
  const previous = { faction: 'MUD', profile: 'A', influxUrl: 'u', influxBucket: 'main', influxOptimizationBucket: 'opt', useRpcLimiter: false };
  const saved = { ...previous };
  assert.equal(classifySettingsImpact(previous, { influxAuthToken: '' }, saved).dataChanged, false, 'blank secure value preserves the secret');
  assert.equal(classifySettingsImpact(previous, { influxAuthToken: 'new' }, saved).influxConnectionChanged, true);
  assert.equal(classifySettingsImpact(previous, {}, { ...saved, influxBucket: 'other' }).influxBucketChanged, true);
  assert.equal(classifySettingsImpact(previous, {}, { ...saved, influxOptimizationBucket: 'other' }).optimizationBucketChanged, true);
  assert.equal(classifySettingsImpact(previous, { aephiaApiKey: 'new' }, saved).aephiaSourceChanged, true);
  assert.equal(classifySettingsImpact(previous, {}, { ...saved, useRpcLimiter: true }).rpcSourceChanged, true);
  assert.equal(classifySettingsImpact(previous, { rpcRequestsPerSecond: '9', gmTradingWallets: 'wallet' }, saved).dataChanged, false);
});

test('visible-impact policy excludes unrelated views and Marketplace', () => {
  const { isVisibleDatasetAffected } = loadPolicy();
  assert.equal(isVisibleDatasetAffected(impact({ aephiaSourceChanged: true }), 'production'), false);
  assert.equal(isVisibleDatasetAffected(impact({ rpcSourceChanged: true }), 'production'), false);
  assert.equal(isVisibleDatasetAffected(impact({ rpcSourceChanged: true }), 'production-consumption'), false);
  assert.equal(isVisibleDatasetAffected(impact({ influxConnectionChanged: true }), 'marketplace'), false);
  assert.equal(isVisibleDatasetAffected(impact({ optimizationBucketChanged: true }), 'production'), false);
  assert.equal(isVisibleDatasetAffected(impact({ optimizationBucketChanged: true }), 'optimization'), true);
  assert.equal(isVisibleDatasetAffected(impact({ aephiaSourceChanged: true }), 'earnings'), true);
  assert.equal(isVisibleDatasetAffected(impact({ rpcSourceChanged: true }), 'fleet'), true);
  assert.equal(isVisibleDatasetAffected(impact({ influxBucketChanged: true }), 'optimization'), false);
  assert.equal(isVisibleDatasetAffected(impact({ influxConnectionChanged: true }), 'optimization'), true);
  assert.equal(isVisibleDatasetAffected(impact({ factionChanged: true }), 'marketplace'), true);
});

test('selective legacy reset plan exactly matches each settings category', () => {
  const { getLegacyResetPlan } = loadPolicy();
  const scopes = (value) => Object.entries(getLegacyResetPlan(value)).filter(([, enabled]) => enabled).map(([name]) => name).sort();
  assert.deepEqual(scopes(impact({ optimizationBucketChanged: true })), ['optimization']);
  assert.deepEqual(scopes(impact({ influxBucketChanged: true })), ['earnings', 'influxPrimary']);
  assert.deepEqual(scopes(impact({ influxConnectionChanged: true })), ['earnings', 'influxPrimary', 'optimization']);
  assert.deepEqual(scopes(impact({ aephiaSourceChanged: true })), ['earnings']);
  assert.deepEqual(scopes(impact({ rpcSourceChanged: true })), ['earnings', 'fleet']);
  assert.deepEqual(scopes(impact()), []);
  assert.deepEqual(scopes(impact({ factionChanged: true })), ['identity']);
});

test('explicit targeted reset functions preserve unrelated state categories', () => {
  const fleet = between('function resetLegacyFleetState', 'function resetLegacyEarningsState');
  const earnings = between('function resetLegacyEarningsState', 'function resetLegacyOptimizationState');
  const optimization = between('function resetLegacyOptimizationState', 'function resetLegacyInfluxPrimaryState');
  const influxPrimary = between('function resetLegacyInfluxPrimaryState', 'function updateTitle');
  assert.match(fleet, /latestFleetResult = null/);
  assert.match(earnings, /latestEarningsResult = null/);
  assert.match(optimization, /latestOptimizationResult = null[^]*latestUpgradingOptimizationResult = null/);
  assert.match(influxPrimary, /latestSduResult = null[^]*latestConsTotalResult = null[^]*latestPcrResult = null[^]*latestInventoryResult = null/);
  assert.doesNotMatch(earnings, /latestFleetResult|latestSduResult|latestConsMiningResult|latestInventoryResult|latestOptimizationResult|refreshMarketplace/);
  assert.doesNotMatch(fleet, /latestEarningsResult|latestSduResult|latestOptimizationResult|refreshMarketplace/);
  assert.doesNotMatch(influxPrimary, /latestOptimizationResult|latestUpgradingOptimizationResult|refreshMarketplace/);
});

test('settings save loads only an affected visible dataset, then starts bounded background work', () => {
  const save = between('async function applySettingsSave', "form.addEventListener('submit'");
  assert.match(save, /const visibleDataset = getVisibleDataset\(\)/);
  assert.match(save, /const visibleAffected = isVisibleDatasetAffected\(impact, visibleDataset\)/);
  assert.match(save, /if \(visibleAffected\)[^]*setNextRendererTelemetryTrigger\('settings'\)[^]*await refreshVisibleIdentity\(\{ force \}\)/);
  assert.ok(save.indexOf('await refreshVisibleIdentity') < save.indexOf('runFactionBackgroundPrefetch'));
  assert.match(save, /const force = impact\.influxSourceChanged \|\| impact\.optimizationBucketChanged \|\| impact\.earningsSourceChanged/);
  assert.doesNotMatch(save, /resetFactionScopedState\(\).*influxSourceChanged|refreshMarketplace/);
  assert.match(save, /orchestrationGeneration !== settingsSaveGeneration\) return saved/);
});

test('unaffected visible view starts prefetch without an artificial foreground load and Marketplace/runtime saves do nothing', () => {
  const save = between('async function applySettingsSave', "form.addEventListener('submit'");
  assert.match(save, /if \(impact\.dataChanged\)[^]*if \(visibleAffected\)[^]*await refreshVisibleIdentity[^]*runFactionBackgroundPrefetch/s);
  const classify = between('function classifySettingsImpact', 'function getVisibleDataset');
  assert.doesNotMatch(classify, /gmTradingWallets|rpcRequestsPerSecond/);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function loadOrchestrator({ section = 'production', earningsSubtab = 'scanning', productionSubtab = 'scanning', previous = {}, saved = {}, savePromise } = {}) {
  const source = between('function classifySettingsImpact', 'let settingsSaveGeneration = 0;');
  const calls = { refresh: [], prefetch: [], reset: [], influxMarks: 0, earningsMarks: 0 };
  const context = {
    normalizeFaction: (value) => String(value || 'USTUR').toUpperCase(),
    getActivePlayerProfile: (settings) => settings?.profile || '',
    currentSection: section,
    currentEarningsSubtab: earningsSubtab,
    currentSubtab: productionSubtab,
    latestSettings: previous,
    settingsSaveGeneration: 1,
    factionPrefetchGeneration: 0,
    api: {
      saveSettings: () => savePromise || Promise.resolve(saved),
      settingsCacheControl: {
        markInfluxSourceChanged: () => { calls.influxMarks += 1; },
        markEarningsSourceChanged: () => { calls.earningsMarks += 1; },
      },
    },
    resetFactionScopedState: () => calls.reset.push('identity'),
    resetLegacyFleetState: () => calls.reset.push('fleet'),
    resetLegacyEarningsState: () => calls.reset.push('earnings'),
    resetLegacyOptimizationState: () => calls.reset.push('optimization'),
    resetLegacyInfluxPrimaryState: () => calls.reset.push('influx-primary'),
    setFormValues: () => {},
    updateFactionButtons: () => {},
    updateSettingsStatus: () => {},
    refreshVisibleIdentity: (options) => { calls.refresh.push(options); return context.foregroundPromise || Promise.resolve(); },
    runFactionBackgroundPrefetch: (generation, faction) => { calls.prefetch.push({ generation, faction }); },
    foregroundPromise: null,
  };
  vm.runInNewContext(`${source}\nthis.apply = applySettingsSave;`, context);
  return { context, calls, apply: context.apply };
}

test('affected foreground settles before background and identity uses ordinary activation', async () => {
  const foreground = deferred();
  const previous = { faction: 'MUD', profile: 'A', influxUrl: 'old', influxBucket: 'main', influxOptimizationBucket: 'opt', useRpcLimiter: false };
  const saved = { ...previous, influxUrl: 'new' };
  const run = loadOrchestrator({ section: 'production', previous, saved });
  run.context.foregroundPromise = foreground.promise;
  const pending = run.apply({}, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.calls.refresh.length, 1);
  assert.equal(run.calls.refresh[0].force, true);
  assert.equal(run.calls.prefetch.length, 0);
  foreground.resolve();
  await pending;
  assert.equal(run.calls.prefetch.length, 1);

  const identity = loadOrchestrator({ section: 'production', previous, saved: { ...previous, faction: 'ONI' } });
  await identity.apply({}, 1);
  assert.equal(identity.calls.refresh.length, 1);
  assert.equal(identity.calls.refresh[0].force, false);
  assert.equal(identity.calls.prefetch.length, 1);
});

test('unaffected source changes skip foreground and begin background immediately', async () => {
  const previous = { faction: 'MUD', profile: 'A', influxUrl: 'u', influxBucket: 'main', influxOptimizationBucket: 'opt', useRpcLimiter: false };
  const aephia = loadOrchestrator({ section: 'production', previous, saved: previous });
  await aephia.apply({ aephiaApiKey: 'replacement' }, 1);
  assert.equal(aephia.calls.refresh.length, 0);
  assert.equal(aephia.calls.prefetch.length, 1);
  assert.deepEqual(aephia.calls.reset, ['earnings']);

  const marketplace = loadOrchestrator({ section: 'earnings', earningsSubtab: 'marketplace', previous, saved: { ...previous, influxUrl: 'new' } });
  await marketplace.apply({}, 1);
  assert.equal(marketplace.calls.refresh.length, 0, 'core Influx must not trigger Marketplace sync');
  assert.equal(marketplace.calls.prefetch.length, 1);
});

test('optimization and RPC resets are selective while runtime and wallet saves are inert', async () => {
  const previous = { faction: 'MUD', profile: 'A', influxUrl: 'u', influxBucket: 'main', influxOptimizationBucket: 'opt', useRpcLimiter: false };
  const optimization = loadOrchestrator({ section: 'production', previous, saved: { ...previous, influxOptimizationBucket: 'other' } });
  await optimization.apply({}, 1);
  assert.deepEqual(optimization.calls.reset, ['optimization']);
  assert.equal(optimization.calls.refresh.length, 0);
  assert.equal(optimization.calls.prefetch.length, 1);

  const rpc = loadOrchestrator({ section: 'production', productionSubtab: 'consumption', previous, saved: { ...previous, useRpcLimiter: true } });
  await rpc.apply({}, 1);
  assert.deepEqual(rpc.calls.reset.sort(), ['earnings', 'fleet']);
  assert.equal(rpc.calls.refresh.length, 0);

  const inert = loadOrchestrator({ section: 'earnings', earningsSubtab: 'marketplace', previous, saved: previous });
  await inert.apply({ rpcRequestsPerSecond: '9', gmTradingWallets: 'wallet' }, 1);
  assert.deepEqual(inert.calls, { refresh: [], prefetch: [], reset: [], influxMarks: 0, earningsMarks: 0 });
});

test('obsolete rapid save cannot reset, render, refresh or start background work', async () => {
  const save = deferred();
  const previous = { faction: 'MUD', profile: 'A', influxUrl: 'u', influxBucket: 'main', influxOptimizationBucket: 'opt', useRpcLimiter: false };
  const run = loadOrchestrator({ previous, saved: { ...previous, influxUrl: 'new' }, savePromise: save.promise });
  const pending = run.apply({}, 1);
  run.context.settingsSaveGeneration = 2;
  save.resolve({ ...previous, influxUrl: 'new' });
  await pending;
  assert.deepEqual(run.calls, { refresh: [], prefetch: [], reset: [], influxMarks: 0, earningsMarks: 0 });
});

test('prefetch remains sequential, token-cancelled and preserves Consumption order and empty filters', () => {
  const prefetch = between('async function runFactionBackgroundPrefetch', 'function loadVisibleThenPrefetch');
  assert.match(prefetch, /for \(const task of tasks\)/);
  assert.match(prefetch, /generation !== factionPrefetchGeneration/);
  assert.match(prefetch, /await task\.load\(\)/);
  const keys = ['consumption-scanning', 'consumption-mining', 'consumption-cargo', 'consumption-crafting', 'consumption-upgrading', 'consumption-total'];
  let at = -1;
  for (const key of keys) { const next = prefetch.indexOf(`key: '${key}'`); assert.ok(next > at, key); at = next; }
  assert.match(prefetch, /refreshConsScanning\(\{ settings, starbaseFilter: '', fleetFilter: '' \}\)/);
  assert.match(prefetch, /refreshConsTotal\(\{ settings, starbaseFilter: '', assetFilter: '' \}\)/);
});

test('version and settings cache boundary remain explicit', () => {
  assert.equal(require('../package.json').version, '0.6.177');
  assert.doesNotMatch(renderer, /settingsCacheControl\[[^\]]+\]/);
});
