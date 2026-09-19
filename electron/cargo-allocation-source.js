'use strict';

const { cargoAllocationUtcBatches, cargoAllocationProcessingFailure, buildCargoAllocationRecordsFromPivotRows } = require('./influx-data');

const DEFAULT_BATCH_TIMEOUT_MS = 20_000;
const DEFAULT_WORKER_TIMEOUT_MS = 135_000;
const DEFAULT_CACHE_TTL_MS = 15 * 60_000;
const RECENT_REFRESH_DAYS = 2;

function allocationScopeKey(settings = {}) {
  return [settings.faction, settings.profile || settings.profileName, settings.playerProfile, settings.influxBucket, '30d']
    .map((value) => String(value || '').trim()).join('|');
}

function buildCargoAllocationPivotFlux(bucket, scopeFilterFlux, { start, stop }) {
  return `from(bucket: "${bucket}")
  |> range(start: time(v: "${start}"), stop: time(v: "${stop}"))
  |> filter(fn: (r) => r._measurement == "cargo_cost_allocation")
  |> filter(fn: (r) => r._field == "amount" or r._field == "cargoVolume" or r._field == "allocatedFuel" or r._field == "allocatedTxCostSol")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet and exists r.rss and exists r.assignment and exists r.originStarbase and exists r.deliveryStarbase and exists r.cycleId and exists r.allocationIndex)
  |> pivot(rowKey: ["_time", "cycleId", "allocationIndex"], columnKey: ["_field"], valueColumn: "_value")
  |> filter(fn: (r) => exists r.amount and exists r.cargoVolume and exists r.allocatedFuel and exists r.allocatedTxCostSol)
  |> keep(columns: ["_time", "fleet", "rss", "assignment", "originStarbase", "deliveryStarbase", "cycleId", "allocationIndex", "faction", "instance", "amount", "cargoVolume", "allocatedFuel", "allocatedTxCostSol"])`;
}

function boundedError(error) {
  return String(error?.message || error || 'cargo_allocation_query_failed').slice(0, 240);
}

function withTimeout(promise, timeoutMs, timeoutError, signal, onTimeout = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, new Error('cargo_allocation_cancelled'));
    const timer = setTimeout(() => {
      finish(reject, new Error(timeoutError));
      if (typeof onTimeout === 'function') onTimeout();
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

function utcDays(now) {
  return cargoAllocationUtcBatches({ now, batchDays: 1 }).map(({ start }) => start.slice(0, 10));
}

function rowsByDay(rows, days) {
  const allowed = new Set(days);
  const grouped = new Map(days.map((day) => [day, []]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const day = String(row?.isoDate || '');
    if (allowed.has(day)) grouped.get(day).push(row);
  }
  return grouped;
}

function readPersistentDays(persistentCache, days) {
  if (!persistentCache) return { complete: false, byDay: new Map(), rows: [], errors: [] };
  const byDay = new Map();
  const errors = [];
  for (const day of days) {
    try {
      const cached = persistentCache.readDay(day);
      if (cached) byDay.set(day, cached.rows);
    } catch (error) {
      errors.push({ operation: 'read', isoDate: day, error: boundedError(error) });
    }
  }
  return {
    complete: byDay.size === days.length,
    byDay,
    rows: days.flatMap((day) => byDay.get(day) || []),
    errors,
  };
}

function createCargoAllocationSource({
  queryBatch, parseCsv, projectRows, getPersistentCache = null,
  now = () => new Date(), clock = Date.now,
  batchTimeoutMs = DEFAULT_BATCH_TIMEOUT_MS, workerTimeoutMs = DEFAULT_WORKER_TIMEOUT_MS,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
} = {}) {
  if (typeof queryBatch !== 'function' || typeof parseCsv !== 'function' || typeof projectRows !== 'function') throw new TypeError('cargo_allocation_source_dependencies_required');
  const cache = new Map();
  const flights = new Map();

  function persistentFor(settings) {
    if (typeof getPersistentCache !== 'function') return null;
    try { return getPersistentCache(settings) || null; } catch (_) { return null; }
  }

  async function execute(settings, signal, persistentCache) {
    const startedAt = Date.now();
    const current = now();
    const days = utcDays(current);
    if (days.length !== 30) throw new Error('cargo_allocation_invalid_utc_days');
    const cached = readPersistentDays(persistentCache, days);
    const todayStartMs = Date.parse(`${days[days.length - 1]}T00:00:00.000Z`);
    const batches = cached.complete
      ? [{ start: new Date(todayStartMs - (RECENT_REFRESH_DAYS - 1) * 86_400_000).toISOString(), stop: new Date(todayStartMs + 86_400_000).toISOString() }]
      : cargoAllocationUtcBatches({ now: current });
    if ((!cached.complete && batches.length !== 6) || batches.some((batch, index) => index && batches[index - 1].stop !== batch.start)) {
      throw new Error('cargo_allocation_invalid_utc_batches');
    }
    const refreshedDays = new Set();
    for (const batch of batches) {
      for (let value = Date.parse(batch.start); value < Date.parse(batch.stop); value += 86_400_000) {
        const day = new Date(value).toISOString().slice(0, 10);
        if (days.includes(day)) refreshedDays.add(day);
      }
    }
    const pivotRows = [];
    const batchRecordCounts = [];
    try {
      for (let index = 0; index < batches.length; index += 1) {
        if (signal.aborted) throw new Error('cargo_allocation_cancelled');
        const csv = await withTimeout(queryBatch(settings, batches[index], signal), batchTimeoutMs, `cargo_allocation_query_timeout_${batchTimeoutMs}ms`, signal);
        const rows = parseCsv(csv);
        batchRecordCounts.push(rows.length);
        pivotRows.push(...rows);
      }
      const records = buildCargoAllocationRecordsFromPivotRows(pivotRows, new Set(days));
      const diagnostics = {
        durationMs: Date.now() - startedAt,
        batchCount: batches.length,
        batchRecordCounts,
        returnedRecordCount: pivotRows.length,
        parsedRecordCount: pivotRows.length,
        completeValueCount: pivotRows.length,
        deduplicatedAllocationCount: records.length,
        persistentCacheHitDays: cached.byDay.size,
        persistentCacheMissDays: days.length - cached.byDay.size,
        persistenceErrors: cached.errors.slice(),
      };
      if (pivotRows.length && !records.length) throw new Error(cargoAllocationProcessingFailure(pivotRows.length, 0, diagnostics));
      const projected = await projectRows(settings, records, diagnostics, signal);
      const refreshedRows = Array.isArray(projected?.rows) ? projected.rows : [];
      Object.assign(diagnostics, projected?.diagnostics || {});
      const failure = cargoAllocationProcessingFailure(records.length, refreshedRows.length, diagnostics);
      if (failure) throw new Error(failure);
      const refreshedByDay = rowsByDay(refreshedRows, Array.from(refreshedDays));
      if (persistentCache) {
        for (const day of refreshedDays) {
          try { persistentCache.writeDay(day, refreshedByDay.get(day) || []); }
          catch (error) { diagnostics.persistenceErrors.push({ operation: 'write', isoDate: day, error: boundedError(error) }); }
        }
        try { persistentCache.pruneBefore(days[0]); }
        catch (error) { diagnostics.persistenceErrors.push({ operation: 'prune', isoDate: days[0], error: boundedError(error) }); }
      }
      const outputRows = persistentCache
        ? days.flatMap((day) => refreshedDays.has(day) ? (refreshedByDay.get(day) || []) : (cached.byDay.get(day) || []))
        : refreshedRows;
      diagnostics.ipcRowCount = outputRows.length;
      return { ok: true, availability: outputRows.length ? 'ready' : 'empty', rows: outputRows, diagnostics, checkedAt: new Date().toISOString() };
    } catch (error) {
      if (cached.complete && !boundedError(error).includes('cancelled')) {
        return {
          ok: true,
          availability: 'stale',
          stale: true,
          rows: cached.rows,
          refreshError: boundedError(error),
          diagnostics: { persistentCacheHitDays: cached.byDay.size, persistentCacheMissDays: 0, persistenceErrors: cached.errors },
          checkedAt: new Date().toISOString(),
        };
      }
      throw error;
    }
  }

  function load(settings = {}, { retry = false, cacheOnly = false } = {}) {
    const key = allocationScopeKey(settings);
    const persistentCache = persistentFor(settings);
    if (cacheOnly) {
      const days = utcDays(now());
      const cached = readPersistentDays(persistentCache, days);
      if (!cached.complete) return Promise.resolve({ ok: false, availability: 'cache_miss', rows: [], persistentCacheHit: false });
      return Promise.resolve({
        ok: true,
        availability: cached.rows.length ? 'ready' : 'empty',
        rows: cached.rows,
        persistentCacheHit: true,
        diagnostics: { persistentCacheHitDays: cached.byDay.size, persistentCacheMissDays: 0, persistenceErrors: cached.errors },
      });
    }
    const cached = cache.get(key);
    if (!retry && cached && clock() - cached.savedAt < cacheTtlMs) return Promise.resolve({ ...cached.value, cacheHit: true });
    if (flights.has(key)) return flights.get(key).promise;
    const controller = new AbortController();
    const promise = withTimeout(
      execute(settings, controller.signal, persistentCache),
      workerTimeoutMs,
      `cargo_allocation_worker_timeout_${workerTimeoutMs}ms`,
      controller.signal,
      () => controller.abort(),
    )
      .then((value) => { cache.set(key, { savedAt: clock(), value }); return value; })
      .catch((error) => {
        const refreshError = boundedError(error);
        if (cached && !refreshError.includes('cancelled')) {
          return { ...cached.value, ok: true, availability: 'stale', stale: true, refreshError, cacheHit: true };
        }
        if (!refreshError.includes('cancelled')) {
          const persisted = readPersistentDays(persistentCache, utcDays(now()));
          if (persisted.complete) {
            return {
              ok: true,
              availability: 'stale',
              stale: true,
              rows: persisted.rows,
              refreshError,
              persistentCacheHit: true,
              diagnostics: { persistentCacheHitDays: persisted.byDay.size, persistentCacheMissDays: 0, persistenceErrors: persisted.errors },
              checkedAt: new Date().toISOString(),
            };
          }
        }
        return { ok: false, availability: refreshError.includes('cancelled') ? 'cancelled' : 'unavailable', rows: [], error: refreshError, diagnostics: { scopeKey: key }, checkedAt: new Date().toISOString() };
      })
      .finally(() => { if (flights.get(key)?.controller === controller) flights.delete(key); });
    flights.set(key, { controller, promise });
    return promise;
  }

  function cancelExcept(settings = {}) {
    const keepKey = allocationScopeKey(settings);
    for (const [key, flight] of flights) if (key !== keepKey) flight.controller.abort();
  }

  function cancelAll() { for (const flight of flights.values()) flight.controller.abort(); }
  return { load, cancelExcept, cancelAll, allocationScopeKey, cache, flights };
}

module.exports = { DEFAULT_BATCH_TIMEOUT_MS, DEFAULT_WORKER_TIMEOUT_MS, allocationScopeKey, buildCargoAllocationPivotFlux, createCargoAllocationSource };
