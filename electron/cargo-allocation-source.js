'use strict';

const { cargoAllocationUtcBatches, cargoAllocationProcessingFailure, buildCargoAllocationRecordsFromPivotRows } = require('./influx-data');

const DEFAULT_BATCH_TIMEOUT_MS = 20_000;
const DEFAULT_WORKER_TIMEOUT_MS = 135_000;
const DEFAULT_CACHE_TTL_MS = 15 * 60_000;

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

function withTimeout(promise, timeoutMs, timeoutError, signal) {
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
    const timer = setTimeout(() => finish(reject, new Error(timeoutError)), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

function createCargoAllocationSource({ queryBatch, parseCsv, projectRows, now = () => new Date(), clock = Date.now, batchTimeoutMs = DEFAULT_BATCH_TIMEOUT_MS, workerTimeoutMs = DEFAULT_WORKER_TIMEOUT_MS, cacheTtlMs = DEFAULT_CACHE_TTL_MS } = {}) {
  if (typeof queryBatch !== 'function' || typeof parseCsv !== 'function' || typeof projectRows !== 'function') throw new TypeError('cargo_allocation_source_dependencies_required');
  const cache = new Map();
  const flights = new Map();

  async function execute(settings, signal) {
    const startedAt = Date.now();
    const batches = cargoAllocationUtcBatches({ now: now() });
    if (batches.length !== 6 || batches.some((batch, index) => index && batches[index - 1].stop !== batch.start)) throw new Error('cargo_allocation_invalid_utc_batches');
    const pivotRows = [];
    const batchRecordCounts = [];
    for (let index = 0; index < batches.length; index += 1) {
      if (signal.aborted) throw new Error('cargo_allocation_cancelled');
      const csv = await withTimeout(queryBatch(settings, batches[index], signal), batchTimeoutMs, `cargo_allocation_query_timeout_${batchTimeoutMs}ms`, signal);
      const rows = parseCsv(csv);
      batchRecordCounts.push(rows.length);
      pivotRows.push(...rows);
    }
    const includedDays = new Set(batches.flatMap(({ start, stop }) => {
      const days = [];
      for (let value = Date.parse(start); value < Date.parse(stop); value += 86_400_000) days.push(new Date(value).toISOString().slice(0, 10));
      return days;
    }));
    const records = buildCargoAllocationRecordsFromPivotRows(pivotRows, includedDays);
    const diagnostics = { durationMs: Date.now() - startedAt, batchCount: batches.length, batchRecordCounts, returnedRecordCount: pivotRows.length, parsedRecordCount: pivotRows.length, completeValueCount: pivotRows.length, deduplicatedAllocationCount: records.length };
    if (pivotRows.length && !records.length) throw new Error(cargoAllocationProcessingFailure(pivotRows.length, 0, diagnostics));
    const projected = await projectRows(settings, records, diagnostics, signal);
    const outputRows = Array.isArray(projected?.rows) ? projected.rows : [];
    Object.assign(diagnostics, projected?.diagnostics || {}, { ipcRowCount: outputRows.length });
    const failure = cargoAllocationProcessingFailure(records.length, outputRows.length, diagnostics);
    if (failure) throw new Error(failure);
    return { ok: true, availability: outputRows.length ? 'ready' : 'empty', rows: outputRows, diagnostics, checkedAt: new Date().toISOString() };
  }

  function load(settings = {}, { retry = false } = {}) {
    const key = allocationScopeKey(settings);
    const cached = cache.get(key);
    if (!retry && cached && clock() - cached.savedAt < cacheTtlMs) return Promise.resolve({ ...cached.value, cacheHit: true });
    if (flights.has(key)) return flights.get(key).promise;
    const controller = new AbortController();
    const promise = withTimeout(execute(settings, controller.signal), workerTimeoutMs, `cargo_allocation_worker_timeout_${workerTimeoutMs}ms`, controller.signal)
      .then((value) => { cache.set(key, { savedAt: clock(), value }); return value; })
      .catch((error) => {
        const refreshError = boundedError(error);
        if (cached && !refreshError.includes('cancelled')) {
          return { ...cached.value, ok: true, availability: 'stale', stale: true, refreshError, cacheHit: true };
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
