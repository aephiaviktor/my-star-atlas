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

  return { buildRpcUsageView };
}));
