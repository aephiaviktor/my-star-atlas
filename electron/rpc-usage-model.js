(function exposeRpcUsageModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RpcUsageModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRpcUsageModel() {
  'use strict';

  function safeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  const TABS_BY_MENU = Object.freeze({
    MF: Object.freeze([Object.freeze({ value: 'fleets', label: 'My Fleets' })]),
    PC: Object.freeze([
      ['scanning', 'Scanning'], ['mining', 'Mining'], ['crafting', 'Crafting'],
      ['production', 'Production'], ['consumption', 'Consumption'], ['pct-charts', 'PCR Charts'], ['inventory', 'Inventory'],
    ].map(([value, label]) => Object.freeze({ value, label }))),
    EA: Object.freeze([
      ['scanning', 'Scanning'], ['mining', 'Mining'], ['marketplace', 'Marketplace'], ['cargo', 'Cargo'],
      ['crafting', 'Crafting'], ['upgrading', 'Upgrading'], ['breakeven', 'Breakeven Analysis'],
    ].map(([value, label]) => Object.freeze({ value, label }))),
    OP: Object.freeze([Object.freeze({ value: 'scanning', label: 'Scanning' }), Object.freeze({ value: 'upgrading', label: 'Upgrading' })]),
    other: Object.freeze([Object.freeze({ value: 'unattributed', label: 'Unattributed' })]),
  });

  function tabsForMenu(menu, rows = []) {
    const tabs = TABS_BY_MENU[menu] || [];
    const hasUnattributed = rows.some((row) => row?.menu === menu && row?.tab === 'unattributed');
    return hasUnattributed && !tabs.some((tab) => tab.value === 'unattributed')
      ? [...tabs, Object.freeze({ value: 'unattributed', label: 'Unattributed' })]
      : tabs;
  }

  function buildRpcUsageView(summary, { menu = 'all', tab = 'all', faction = 'all', method = 'all' } = {}) {
    const rows = Array.isArray(summary?.rows) ? summary.rows : [];
    const matching = rows.filter((row) => (
      (menu === 'all' || row.menu === menu)
      && (tab === 'all' || row.tab === tab)
      && (faction === 'all' || row.faction === faction)
      && (method === 'all' || row.method === method)
    ));
    const filtered = matching.reduce((result, row) => ({
      requests: result.requests + safeInteger(row.requests),
      retries: result.retries + safeInteger(row.retries),
      fallbackAttempts: result.fallbackAttempts + safeInteger(row.fallbackAttempts),
      batchElements: result.batchElements + safeInteger(row.batchElements),
    }), { requests: 0, retries: 0, fallbackAttempts: 0, batchElements: 0 });
    const methodMap = new Map();
    const providerMap = new Map();
    for (const row of matching) {
      const methodRow = methodMap.get(row.method) || {
        method: row.method,
        requests: 0,
        retries: 0,
        fallbackAttempts: 0,
        batchElements: 0,
      };
      methodRow.requests += safeInteger(row.requests);
      methodRow.retries += safeInteger(row.retries);
      methodRow.fallbackAttempts += safeInteger(row.fallbackAttempts);
      methodRow.batchElements += safeInteger(row.batchElements);
      methodMap.set(row.method, methodRow);
      providerMap.set(row.provider, safeInteger(providerMap.get(row.provider)) + safeInteger(row.requests));
    }
    const dayTotal = safeInteger(summary?.totalRequests);
    return {
      dayTotal,
      filtered,
      filteredShare: dayTotal > 0 ? filtered.requests / dayTotal : 0,
      methods: [...methodMap.values()].sort((left, right) => right.requests - left.requests || left.method.localeCompare(right.method)),
      providers: [...providerMap.entries()]
        .map(([key, requests]) => ({ key, requests }))
        .sort((left, right) => right.requests - left.requests || left.key.localeCompare(right.key)),
    };
  }

  return { buildRpcUsageView, tabsForMenu };
}));
