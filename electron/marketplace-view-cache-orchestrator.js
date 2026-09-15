'use strict';

function createMarketplaceViewCacheOrchestrator({
  sourceForSettings,
  openCache,
  buildSnapshot,
  onBackgroundError = () => {},
  onCacheWriteError = () => {},
} = {}) {
  if (typeof sourceForSettings !== 'function') throw new TypeError('marketplace_view_source_factory_required');
  if (typeof openCache !== 'function') throw new TypeError('marketplace_view_cache_factory_required');
  if (typeof buildSnapshot !== 'function') throw new TypeError('marketplace_view_snapshot_builder_required');
  if (typeof onBackgroundError !== 'function') throw new TypeError('marketplace_view_background_error_handler_required');
  if (typeof onCacheWriteError !== 'function') throw new TypeError('marketplace_view_cache_write_error_handler_required');
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
        materializedAtMs: Number(metadata.materializedAtMs) || 0,
      },
    };
  }

  function refresh(settings, source) {
    const key = cacheKey(source);
    const existing = refreshes.get(key);
    if (existing) return existing;
    const promise = (async () => {
      const snapshot = await buildSnapshot(settings);
      try {
        const written = withCache(source, (cache) => cache.write(snapshot));
        return decorate(snapshot, 'fresh', written);
      } catch (error) {
        try { onCacheWriteError(error, snapshot, source); } catch (_) { /* Diagnostics must not hide usable data. */ }
        return decorate(snapshot, 'rejected');
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
    const cached = withCache(source, (cache) => cache.read());
    if (!cached) return refresh(settings, source);
    if (waitForRefresh) return refresh(settings, source);
    if (startBackgroundRefresh) refresh(settings, source).catch(onBackgroundError);
    return decorate(cached.snapshot, 'stale', cached);
  }

  return { load };
}

module.exports = { createMarketplaceViewCacheOrchestrator };
