const { contextBridge, ipcRenderer } = require('electron');
const keyModule = require('./earnings-' + 'cache-key');
const buildBreakevenKey = keyModule['build' + 'EarningsCacheKey'];
const { createEarningsCacheState } = require('./earnings-cache-state');

const breakevenCacheState = createEarningsCacheState();

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

contextBridge.exposeInMainWorld('myStarAtlas', {
  getProfileName: () => ipcRenderer.invoke('app:get-profile-name'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdateAndRestart: () => ipcRenderer.invoke('updates:download-and-restart'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  getRpcLimiterStatus: () => ipcRenderer.invoke('rpc-limiter:get-status'),
  sendSettingsToRpcLimiter: (payload) => ipcRenderer.invoke('rpc-limiter:send-settings', payload),
  getFleets: (payload) => ipcRenderer.invoke('fleet:list', payload),
  getEarningsSnapshot: (payload) => ipcRenderer.invoke('earnings:snapshot', payload),
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
