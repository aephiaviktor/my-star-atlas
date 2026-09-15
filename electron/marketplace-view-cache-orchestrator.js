'use strict';

const { performance } = require('node:perf_hooks');

function createMarketplaceViewCacheOrchestrator({
  sourceForSettings,
  openCache,
  buildSnapshot,
  onBackgroundError = () => {},
  onCacheWriteError = () => {},
  freshnessMs = 0,
  now = Date.now,
  clock = () => performance.now(),
} = {}) {
  if (typeof sourceForSettings !== 'function') throw new TypeError('marketplace_view_source_factory_required');
  if (typeof openCache !== 'function') throw new TypeError('marketplace_view_cache_factory_required');
  if (typeof buildSnapshot !== 'function') throw new TypeError('marketplace_view_snapshot_builder_required');
  if (typeof onBackgroundError !== 'function') throw new TypeError('marketplace_view_background_error_handler_required');
  if (typeof onCacheWriteError !== 'function') throw new TypeError('marketplace_view_cache_write_error_handler_required');
  if (!Number.isFinite(freshnessMs) || freshnessMs < 0) throw new TypeError('marketplace_view_freshness_ms_invalid');
  if (typeof now !== 'function' || typeof clock !== 'function') throw new TypeError('marketplace_view_clock_required');
  const refreshes = new Map();
  const forcedRefreshes = new Map();

  function withCache(source, operation) {
    const cache = openCache(source);
    try {
      return operation(cache);
    } finally {
      cache.close();
    }
  }

  function cacheKey(source) {
    const key = String(source?.sourceKey || '').trim();
    if (!key) throw new TypeError('marketplace_view_source_key_required');
    return key;
  }

  function decorate(snapshot, status, metadata = {}) {
    return {
      ...snapshot,
      marketplaceViewCache: {
        status,
        source: metadata.source || 'projection',
        materializedAtMs: Number(metadata.materializedAtMs) || 0,
        snapshotAgeMs: Math.max(0, Number(metadata.snapshotAgeMs) || 0),
        readDurationMs: Math.max(0, Number(metadata.readDurationMs) || 0),
        projectionDurationMs: Math.max(0, Number(metadata.projectionDurationMs) || 0),
        writeDurationMs: Math.max(0, Number(metadata.writeDurationMs) || 0),
        refreshPending: Boolean(metadata.refreshPending),
        persisted: Boolean(metadata.persisted),
      },
    };
  }

  function readCached(source) {
    const startedAt = clock();
    const cached = withCache(source, (cache) => cache.read());
    return { cached, readDurationMs: Math.max(0, clock() - startedAt) };
  }

  function refresh(settings, source) {
    const key = cacheKey(source);
    const existing = refreshes.get(key);
    if (existing) return existing;
    const promise = (async () => {
      const projectionStartedAt = clock();
      const snapshot = await buildSnapshot(settings);
      const projectionDurationMs = Math.max(0, clock() - projectionStartedAt);
      try {
        const writeStartedAt = clock();
        const written = withCache(source, (cache) => cache.write(snapshot));
        return decorate(snapshot, 'fresh', {
          ...written,
          source: 'projection',
          projectionDurationMs,
          writeDurationMs: Math.max(0, clock() - writeStartedAt),
          persisted: true,
        });
      } catch (error) {
        try { onCacheWriteError(error, snapshot, source); } catch (_) { /* Diagnostics must not hide usable data. */ }
        return decorate(snapshot, 'rejected', { source: 'projection', projectionDurationMs });
      }
    })().finally(() => {
      if (refreshes.get(key) === promise) refreshes.delete(key);
    });
    refreshes.set(key, promise);
    return promise;
  }

  function refreshForced(settings, source) {
    const key = cacheKey(source);
    const existingForced = forcedRefreshes.get(key);
    if (existingForced) return existingForced;
    const promise = (async () => {
      const existingBackground = refreshes.get(key);
      if (existingBackground) await existingBackground.catch(() => {});
      return refresh(settings, source);
    })().finally(() => {
      if (forcedRefreshes.get(key) === promise) forcedRefreshes.delete(key);
    });
    forcedRefreshes.set(key, promise);
    return promise;
  }

  async function load(settings, {
    forceRefresh = false,
    waitForRefresh = false,
    startBackgroundRefresh = true,
  } = {}) {
    const source = sourceForSettings(settings);
    if (forceRefresh) return refreshForced(settings, source);
    const { cached, readDurationMs } = readCached(source);
    if (!cached) return refresh(settings, source);
    const snapshotAgeMs = Math.max(0, now() - Number(cached.materializedAtMs));
    const cachedMetadata = {
      ...cached,
      source: 'sqlite',
      snapshotAgeMs,
      readDurationMs,
      persisted: true,
    };
    if (freshnessMs > 0 && snapshotAgeMs < freshnessMs) {
      return decorate(cached.snapshot, 'fresh', cachedMetadata);
    }
    if (waitForRefresh) return refresh(settings, source);
    if (startBackgroundRefresh) refresh(settings, source).catch(onBackgroundError);
    return decorate(cached.snapshot, 'stale', {
      ...cachedMetadata,
      refreshPending: startBackgroundRefresh,
    });
  }

  return { load };
}

module.exports = { createMarketplaceViewCacheOrchestrator };
