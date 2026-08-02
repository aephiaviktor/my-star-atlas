'use strict';

const BREAKEVEN_CACHE_FRESHNESS_MS = 15 * 60 * 1000;
const UPGRADING_CACHE_FRESHNESS_MS = BREAKEVEN_CACHE_FRESHNESS_MS;
const CONSUMPTION_UPGRADING_CACHE_FRESHNESS_MS = UPGRADING_CACHE_FRESHNESS_MS;
const CONSUMPTION_SCANNING_CACHE_FRESHNESS_MS = CONSUMPTION_UPGRADING_CACHE_FRESHNESS_MS;
const CONSUMPTION_MINING_CACHE_FRESHNESS_MS = CONSUMPTION_SCANNING_CACHE_FRESHNESS_MS;
const CONSUMPTION_CARGO_CACHE_FRESHNESS_MS = CONSUMPTION_MINING_CACHE_FRESHNESS_MS;

function safeError(error) {
  if (!error) return null;
  return { name: String(error.name || 'Error'), message: String(error.message || error) };
}

function snapshot(entry, now) {
  if (!entry) return null;
  const status = entry.lastGoodValue !== null && entry.staleAt !== null && now >= entry.staleAt
    ? 'stale'
    : entry.status;
  return {
    status,
    value: entry.lastGoodValue,
    lastGoodValue: entry.lastGoodValue,
    requestedAt: entry.requestedAt,
    fetchedAt: entry.fetchedAt,
    staleAt: entry.staleAt,
    error: entry.error,
    generation: entry.generation,
    inFlight: Boolean(entry.inFlightPromise),
  };
}

function createEarningsCacheState({ now = Date.now, freshnessMs = BREAKEVEN_CACHE_FRESHNESS_MS } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (!Number.isFinite(freshnessMs) || freshnessMs < 0) throw new TypeError('freshnessMs must be non-negative');
  const entries = new Map();
  const generations = new Map();

  function inspect(key) {
    return snapshot(entries.get(key), now());
  }

  function ensureData(key, loader, { force = false } = {}) {
    if (typeof key !== 'string' || !key) throw new TypeError('key is required');
    if (typeof loader !== 'function') throw new TypeError('loader must be a function');
    let entry = entries.get(key);
    if (entry?.inFlightPromise) return entry.inFlightPromise;
    const current = snapshot(entry, now());
    if (!force && current?.status === 'ready') return Promise.resolve(current);

    const generation = (generations.get(key) || 0) + 1;
    generations.set(key, generation);
    const requestedAt = now();
    const lastGoodValue = entry?.lastGoodValue ?? null;
    entry = {
      status: lastGoodValue === null ? 'loading' : 'stale',
      lastGoodValue,
      requestedAt,
      fetchedAt: entry?.fetchedAt ?? null,
      staleAt: entry?.staleAt ?? null,
      error: null,
      generation,
      inFlightPromise: null,
    };
    entries.set(key, entry);

    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (generations.get(key) !== generation || entries.get(key) !== entry) return inspect(key);
        const fetchedAt = now();
        entry.status = 'ready';
        entry.lastGoodValue = value;
        entry.fetchedAt = fetchedAt;
        entry.staleAt = fetchedAt + freshnessMs;
        entry.error = null;
        entry.inFlightPromise = null;
        return snapshot(entry, now());
      }, (error) => {
        if (generations.get(key) !== generation || entries.get(key) !== entry) return inspect(key);
        entry.status = entry.lastGoodValue === null ? 'error' : 'stale';
        entry.error = safeError(error);
        entry.inFlightPromise = null;
        return snapshot(entry, now());
      });
    entry.inFlightPromise = promise;
    return promise;
  }

  function invalidate(key) {
    entries.delete(key);
    return generations.get(key) || 0;
  }

  return { inspect, ensureData, invalidate };
}

module.exports = { BREAKEVEN_CACHE_FRESHNESS_MS, UPGRADING_CACHE_FRESHNESS_MS, CONSUMPTION_UPGRADING_CACHE_FRESHNESS_MS, CONSUMPTION_SCANNING_CACHE_FRESHNESS_MS, CONSUMPTION_MINING_CACHE_FRESHNESS_MS, CONSUMPTION_CARGO_CACHE_FRESHNESS_MS, createEarningsCacheState };
