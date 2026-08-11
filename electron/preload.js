const { contextBridge, ipcRenderer } = require('electron');
const keyModule = require('./earnings-' + 'cache-key');
const buildBreakevenKey = keyModule['build' + 'EarningsCacheKey'];
const { createEarningsCacheState, UPGRADING_CACHE_FRESHNESS_MS, CONSUMPTION_UPGRADING_CACHE_FRESHNESS_MS, CONSUMPTION_SCANNING_CACHE_FRESHNESS_MS, CONSUMPTION_MINING_CACHE_FRESHNESS_MS, CONSUMPTION_CARGO_CACHE_FRESHNESS_MS, CONSUMPTION_CRAFTING_CACHE_FRESHNESS_MS, CONSUMPTION_TOTAL_CACHE_FRESHNESS_MS } = require('./earnings-cache-state');

const breakevenCacheState = createEarningsCacheState();
const upgradingCacheState = createEarningsCacheState({ freshnessMs: UPGRADING_CACHE_FRESHNESS_MS });
const consumptionUpgradingCacheState = createEarningsCacheState({ freshnessMs: CONSUMPTION_UPGRADING_CACHE_FRESHNESS_MS });
const consumptionScanningCacheState = createEarningsCacheState({ freshnessMs: CONSUMPTION_SCANNING_CACHE_FRESHNESS_MS });
const consumptionMiningCacheState = createEarningsCacheState({ freshnessMs: CONSUMPTION_MINING_CACHE_FRESHNESS_MS });
const consumptionCargoCacheState = createEarningsCacheState({ freshnessMs: CONSUMPTION_CARGO_CACHE_FRESHNESS_MS });
const consumptionCraftingCacheState = createEarningsCacheState({ freshnessMs: CONSUMPTION_CRAFTING_CACHE_FRESHNESS_MS });
const consumptionTotalCacheState = createEarningsCacheState({ freshnessMs: CONSUMPTION_TOTAL_CACHE_FRESHNESS_MS });

function breakevenCacheDescriptor({ faction, playerProfile, filters = {} } = {}) {
  return {
    schemaVersion: '1',
    faction,
    playerProfile,
    section: 'earnings',
    subtab: 'breakeven',
    datasetScope: 'complete',
    filters,
  };
}

function breakevenCacheKey(input) {
  return buildBreakevenKey(breakevenCacheDescriptor(input));
}

function upgradingCacheDescriptor({ faction, playerProfile, filters = {} } = {}) {
  return {
    schemaVersion: '1',
    faction,
    playerProfile,
    section: 'earnings',
    subtab: 'upgrading',
    datasetScope: 'upgrading-ledger',
    filters,
  };
}

function upgradingCacheKey(input) {
  return buildBreakevenKey(upgradingCacheDescriptor(input));
}

function consumptionUpgradingCacheDescriptor({ faction, playerProfile, componentFilter = '', starbaseFilter = '' } = {}) {
  return {
    schemaVersion: '1',
    faction,
    playerProfile,
    section: 'consumption',
    subtab: 'upgrading',
    datasetScope: 'upgrade-consumption-31d',
    filters: {
      componentFilter: String(componentFilter || ''),
      starbaseFilter: String(starbaseFilter || ''),
    },
  };
}

function consumptionUpgradingCacheKey(input) {
  return buildBreakevenKey(consumptionUpgradingCacheDescriptor(input));
}

function consumptionScanningCacheDescriptor({ faction, playerProfile, starbaseFilter = '', fleetFilter = '' } = {}) {
  return {
    schemaVersion: '1',
    faction,
    playerProfile,
    section: 'consumption',
    subtab: 'scanning',
    datasetScope: 'scan-consumption-31d',
    filters: {
      starbaseFilter: String(starbaseFilter || ''),
      fleetFilter: String(fleetFilter || ''),
    },
  };
}

function consumptionScanningCacheKey(input) {
  return buildBreakevenKey(consumptionScanningCacheDescriptor(input));
}

function consumptionMiningCacheDescriptor({ faction, playerProfile, starbaseFilter = '', fleetFilter = '' } = {}) {
  return {
    schemaVersion: '1',
    faction,
    playerProfile,
    section: 'consumption',
    subtab: 'mining',
    datasetScope: 'mining-consumption-31d',
    filters: {
      starbaseFilter: String(starbaseFilter || '').trim(),
      fleetFilter: String(fleetFilter || '').trim(),
    },
  };
}

function consumptionMiningCacheKey(input) {
  return buildBreakevenKey(consumptionMiningCacheDescriptor(input));
}

function consumptionCargoCacheDescriptor({ faction, playerProfile, starbaseFilter = '', fleetFilter = '' } = {}) {
  return {
    schemaVersion: '1', faction, playerProfile, section: 'consumption', subtab: 'cargo',
    datasetScope: 'cargo-consumption-31d',
    filters: { starbaseFilter: String(starbaseFilter || '').trim(), fleetFilter: String(fleetFilter || '').trim() },
  };
}

function consumptionCargoCacheKey(input) {
  return buildBreakevenKey(consumptionCargoCacheDescriptor(input));
}

function consumptionCraftingCacheDescriptor({ faction, playerProfile, starbaseFilter = '', recipeFilter = '' } = {}) {
  return {
    schemaVersion: '1', faction, playerProfile, section: 'consumption', subtab: 'crafting',
    datasetScope: 'crafting-consumption-31d',
    filters: { starbaseFilter: String(starbaseFilter || '').trim(), recipeFilter: String(recipeFilter || '').trim() },
  };
}

function consumptionCraftingCacheKey(input) {
  return buildBreakevenKey(consumptionCraftingCacheDescriptor(input));
}

function consumptionTotalCacheDescriptor({ faction, playerProfile, starbaseFilter = '', assetFilter = '' } = {}) {
  return {
    schemaVersion: '1', faction, playerProfile, section: 'consumption', subtab: 'total',
    datasetScope: 'total-consumption-31d',
    filters: { starbaseFilter: String(starbaseFilter || '').trim(), assetFilter: String(assetFilter || '').trim() },
  };
}

function consumptionTotalCacheKey(input) {
  return buildBreakevenKey(consumptionTotalCacheDescriptor(input));
}

contextBridge.exposeInMainWorld('myStarAtlas', {
  getProfileName: () => ipcRenderer.invoke('app:get-profile-name'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getRpcUsageDay: (utcDate) => ipcRenderer.invoke('telemetry:rpc-usage-day', utcDate),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdateAndRestart: () => ipcRenderer.invoke('updates:download-and-restart'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  getRpcLimiterStatus: () => ipcRenderer.invoke('rpc-limiter:get-status'),
  sendSettingsToRpcLimiter: (payload) => ipcRenderer.invoke('rpc-limiter:send-settings', payload),
  getFleets: (payload) => ipcRenderer.invoke('fleet:list', payload),
  getEarningsSnapshot: (payload) => ipcRenderer.invoke('earnings:snapshot', payload),
  recordEarningsRendererError: (payload) => ipcRenderer.invoke('diagnostic:earnings-renderer', payload),
  getCargoAllocation: (payload) => ipcRenderer.invoke('earnings:cargo-allocation', payload),
  getMarketplaceSnapshot: (payload) => ipcRenderer.invoke('marketplace:snapshot', payload),
  syncMarketplace: (payload) => ipcRenderer.invoke('marketplace:sync', payload),
  testInflux: (payload) => ipcRenderer.invoke('influx:test', payload),
  getDailySdu: (payload) => ipcRenderer.invoke('sdu:daily', payload),
  getDailySduConsumption: (payload) => ipcRenderer.invoke('sdu:consumption', payload),
  getDailyMining: (payload) => ipcRenderer.invoke('mining:daily', payload),
  getDailyCrafting: (payload) => ipcRenderer.invoke('crafting:daily', payload),
  getDailyProduction: (payload) => ipcRenderer.invoke('production:daily', payload),
  getDailyConsumptionMining: (payload) => ipcRenderer.invoke('consumption:mining', payload),
  getDailyConsumptionCrafting: (payload) => ipcRenderer.invoke('consumption:crafting', payload),
  getDailyConsumptionUpgrading: (payload) => ipcRenderer.invoke('consumption:upgrading', payload),
  getDailyConsumptionScanning: (payload) => ipcRenderer.invoke('consumption:scanning', payload),
  getDailyConsumptionCargo: (payload) => ipcRenderer.invoke('consumption:cargo', payload),
  getDailyConsumptionTotal: (payload) => ipcRenderer.invoke('consumption:total', payload),
  getPcrCharts: (payload) => ipcRenderer.invoke('pcr:daily', payload),
  getInventory: (payload) => ipcRenderer.invoke('inventory:daily', payload),
  getScanningOptimization: (payload) => ipcRenderer.invoke('optimization:scanning', payload),
  getUpgradingOptimization: (payload) => ipcRenderer.invoke('optimization:upgrading', payload),
  settingsCacheControl: {
    markInfluxSourceChanged: () => {
      for (const state of [breakevenCacheState, upgradingCacheState, consumptionUpgradingCacheState, consumptionScanningCacheState, consumptionMiningCacheState, consumptionCargoCacheState, consumptionCraftingCacheState, consumptionTotalCacheState]) state.markAllStale();
    },
    markEarningsSourceChanged: () => {
      breakevenCacheState.markAllStale();
      upgradingCacheState.markAllStale();
    },
  },
  consumptionTotalCache: {
    buildKey: (input) => consumptionTotalCacheKey(input),
    inspect: (input) => { const key = consumptionTotalCacheKey(input); return { key, entry: consumptionTotalCacheState.inspect(key) }; },
    ensure: (input, loader) => {
      if (typeof loader !== 'function') return Promise.reject(new TypeError('loader must be a function'));
      const key = consumptionTotalCacheKey(input);
      return consumptionTotalCacheState.ensureData(key, loader, { force: input?.force === true }).then((entry) => ({ key, entry }));
    },
  },
  consumptionCraftingCache: {
    buildKey: (input) => consumptionCraftingCacheKey(input),
    inspect: (input) => { const key = consumptionCraftingCacheKey(input); return { key, entry: consumptionCraftingCacheState.inspect(key) }; },
    ensure: (input, loader) => {
      if (typeof loader !== 'function') return Promise.reject(new TypeError('loader must be a function'));
      const key = consumptionCraftingCacheKey(input);
      return consumptionCraftingCacheState.ensureData(key, loader, { force: input?.force === true }).then((entry) => ({ key, entry }));
    },
  },
  consumptionCargoCache: {
    buildKey: (input) => consumptionCargoCacheKey(input),
    inspect: (input) => { const key = consumptionCargoCacheKey(input); return { key, entry: consumptionCargoCacheState.inspect(key) }; },
    ensure: (input, loader) => {
      if (typeof loader !== 'function') return Promise.reject(new TypeError('loader must be a function'));
      const key = consumptionCargoCacheKey(input);
      return consumptionCargoCacheState.ensureData(key, loader, { force: input?.force === true }).then((entry) => ({ key, entry }));
    },
  },
  consumptionMiningCache: {
    buildKey: (input) => consumptionMiningCacheKey(input),
    inspect: (input) => {
      const key = consumptionMiningCacheKey(input);
      return { key, entry: consumptionMiningCacheState.inspect(key) };
    },
    ensure: (input, loader) => {
      if (typeof loader !== 'function') return Promise.reject(new TypeError('loader must be a function'));
      const key = consumptionMiningCacheKey(input);
      return consumptionMiningCacheState.ensureData(key, loader, { force: input?.force === true })
        .then((entry) => ({ key, entry }));
    },
  },
  consumptionScanningCache: {
    buildKey: (input) => consumptionScanningCacheKey(input),
    inspect: (input) => {
      const key = consumptionScanningCacheKey(input);
      return { key, entry: consumptionScanningCacheState.inspect(key) };
    },
    ensure: (input, loader) => {
      if (typeof loader !== 'function') return Promise.reject(new TypeError('loader must be a function'));
      const key = consumptionScanningCacheKey(input);
      return consumptionScanningCacheState.ensureData(key, loader, { force: input?.force === true })
        .then((entry) => ({ key, entry }));
    },
  },
  consumptionUpgradingCache: {
    buildKey: (input) => consumptionUpgradingCacheKey(input),
    inspect: (input) => {
      const key = consumptionUpgradingCacheKey(input);
      return { key, entry: consumptionUpgradingCacheState.inspect(key) };
    },
    ensure: (input, loader) => {
      if (typeof loader !== 'function') return Promise.reject(new TypeError('loader must be a function'));
      const key = consumptionUpgradingCacheKey(input);
      return consumptionUpgradingCacheState.ensureData(key, loader, { force: input?.force === true })
        .then((entry) => ({ key, entry }));
    },
  },
  upgradingCache: {
    buildKey: (input) => upgradingCacheKey(input),
    inspect: (input) => {
      const key = upgradingCacheKey(input);
      return { key, entry: upgradingCacheState.inspect(key) };
    },
    ensure: (input, loader) => {
      if (typeof loader !== 'function') return Promise.reject(new TypeError('loader must be a function'));
      const key = upgradingCacheKey(input);
      return upgradingCacheState.ensureData(key, loader, { force: input?.force === true })
        .then((entry) => ({ key, entry }));
    },
  },
  breakevenCache: {
    buildKey: (input) => breakevenCacheKey(input),
    inspect: (input) => {
      const key = breakevenCacheKey(input);
      return { key, entry: breakevenCacheState.inspect(key) };
    },
    ensure: (input, loader) => {
      if (typeof loader !== 'function') return Promise.reject(new TypeError('loader must be a function'));
      const key = breakevenCacheKey(input);
      return breakevenCacheState.ensureData(key, loader, { force: input?.force === true })
        .then((entry) => ({ key, entry }));
    },
  },
});
