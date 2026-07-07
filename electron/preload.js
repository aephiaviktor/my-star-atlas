const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myStarAtlas', {
  getProfileName: () => ipcRenderer.invoke('app:get-profile-name'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  getFleets: (payload) => ipcRenderer.invoke('fleet:list', payload),
  testInflux: (payload) => ipcRenderer.invoke('influx:test', payload),
  getDailySdu: (payload) => ipcRenderer.invoke('sdu:daily', payload),
  getDailyMining: (payload) => ipcRenderer.invoke('mining:daily', payload),
  getDailyCrafting: (payload) => ipcRenderer.invoke('crafting:daily', payload),
  getDailyProduction: (payload) => ipcRenderer.invoke('production:daily', payload),
  getDailyConsumptionMining: (payload) => ipcRenderer.invoke('consumption:mining', payload),
  getDailyConsumptionCrafting: (payload) => ipcRenderer.invoke('consumption:crafting', payload),
  getDailyConsumptionUpgrading: (payload) => ipcRenderer.invoke('consumption:upgrading', payload),
  getDailyConsumptionScanning: (payload) => ipcRenderer.invoke('consumption:scanning', payload),
  getDailyConsumptionCargo: (payload) => ipcRenderer.invoke('consumption:cargo', payload),
  getDailyConsumptionTotal: (payload) => ipcRenderer.invoke('consumption:total', payload),
});