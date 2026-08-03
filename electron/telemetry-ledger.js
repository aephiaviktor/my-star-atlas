'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const lockfile = require('proper-lockfile');
const { writeJsonAtomic } = require('./atomic-json');
const { normalizeContext } = require('./telemetry-context');

const SCHEMA_VERSION = 1;
const MAX_INTEGER = Number.MAX_SAFE_INTEGER;
const COUNTERS = Object.freeze([
  'logicalOperations', 'logicalCompletedOperations', 'logicalSuccesses', 'logicalFailures',
  'wireAttempts', 'wireCompletedAttempts', 'wireTransportSuccesses', 'wireTransportFailures',
  'retries', 'fallbackAttempts', 'limiterAdmissions', 'limiterStops', 'budgetStops',
  'cacheHits', 'cacheMisses', 'inFlightCoalesced', 'preventedDuplicates',
  'cursorResumes', 'paginationPages', 'transactionMisses', 'operationDurationMs', 'attemptDurationMs', 'telemetryWriteFailures',
  'batchElements',
]);
const COUNTER_SET = new Set(COUNTERS);
const MAX_DIMENSION_ROWS_PER_MINUTE = 256;
const MAX_SNAPSHOTS = 32;
const COMPLETED_RETENTION_DAYS = 14;

function clampInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(MAX_INTEGER, Math.floor(number));
}
function addSafe(left, right) { return Math.min(MAX_INTEGER, clampInteger(left) + clampInteger(right)); }
function utcDate(at) { return new Date(at).toISOString().slice(0, 10); }
function utcMinute(at) { return new Date(at).toISOString().slice(11, 16); }
function boundaryIso(at = Date.now()) {
  const date = new Date(at);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}
function persistedDimensions(context) {
  const safe = normalizeContext(context);
  return { ...safe, logicalOperationId: null, parentOperationId: null };
}
function dimensionKey(context) {
  const safe = persistedDimensions(context);
  return [safe.profile, safe.faction, safe.feature, safe.suboperation, safe.trigger, safe.providerRole, safe.rpcMethod].join('\u001f');
}
function createCounters() { return Object.fromEntries(COUNTERS.map((key) => [key, 0])); }
function createRow(context) { return { dimensions: persistedDimensions(context), counters: createCounters() }; }
function createDay(installationId, date) {
  return { schemaVersion: SCHEMA_VERSION, installationId, utcDate: date, revision: 0, updatedAt: null, minutes: {}, runtime: [] };
}
function validInstallation(value) {
  return value && value.schemaVersion === SCHEMA_VERSION && /^[a-f0-9]{32}$/.test(value.installationId)
    && typeof value.createdAt === 'string';
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
}
function validCounters(value) {
  return exactKeys(value, COUNTERS)
    && COUNTERS.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0);
}
function validDimensions(value) {
  if (!exactKeys(value, ['profile', 'faction', 'feature', 'suboperation', 'trigger', 'logicalOperationId', 'parentOperationId', 'providerRole', 'rpcMethod'])) return false;
  return JSON.stringify(value) === JSON.stringify(persistedDimensions(value));
}
function validRuntime(value) {
  const allowed = new Set(['sessionId', 'startedAt', 'progressAt', 'cleanStopAt', 'clockReversal', 'openLogicalOperations', 'openWireAttempts', 'telemetryWriteFailures']);
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key))
    && /^[a-f0-9]{32}$/.test(String(value.sessionId || ''))
    && Number.isFinite(Date.parse(value.startedAt)) && Number.isFinite(Date.parse(value.progressAt))
    && (value.cleanStopAt == null || Number.isFinite(Date.parse(value.cleanStopAt)))
    && typeof value.clockReversal === 'boolean'
    && ['openLogicalOperations', 'openWireAttempts', 'telemetryWriteFailures'].every((key) => Number.isSafeInteger(Number(value[key] || 0)) && Number(value[key] || 0) >= 0);
}
function validDay(value, installationId, date) {
  if (!exactKeys(value, ['schemaVersion', 'installationId', 'utcDate', 'revision', 'updatedAt', 'minutes', 'runtime'])) return false;
  if (value.schemaVersion !== SCHEMA_VERSION || value.installationId !== installationId || value.utcDate !== date
      || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isFinite(Date.parse(value.updatedAt))
      || !value.minutes || typeof value.minutes !== 'object' || Array.isArray(value.minutes)
      || !Array.isArray(value.runtime) || value.runtime.length > 64 || !value.runtime.every(validRuntime)) return false;
  return Object.entries(value.minutes).every(([minute, bucket]) => /^([01]\d|2[0-3]):[0-5]\d$/.test(minute)
    && exactKeys(bucket, ['rows']) && Array.isArray(bucket.rows) && bucket.rows.length <= MAX_DIMENSION_ROWS_PER_MINUTE
    && bucket.rows.every((row) => exactKeys(row, ['dimensions', 'counters']) && validDimensions(row.dimensions) && validCounters(row.counters)));
}
async function readJson(filePath) { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
async function exists(filePath) { try { await fs.access(filePath); return true; } catch (_) { return false; } }

async function renameWithRetry(source, target, { attempts = 5, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { await fs.rename(source, target); return; }
    catch (error) {
      last = error;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt + 1 >= attempts) throw error;
      await sleep(20 * 2 ** attempt);
    }
  }
  throw last;
}

async function writeAtomicDurable(targetPath, value, hooks = {}) {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    const handle = await fs.open(temporaryPath, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await hooks.beforeRename?.(temporaryPath, targetPath);
    await renameWithRetry(temporaryPath, targetPath, hooks);
    try { const directoryHandle = await fs.open(directory, 'r'); try { await directoryHandle.sync(); } finally { await directoryHandle.close(); } } catch (_) { /* unsupported on Windows */ }
  } finally { await fs.rm(temporaryPath, { force: true }); }
}

async function withSharedLock(root, callback) {
  await fs.mkdir(root, { recursive: true });
  const target = path.join(root, '.ledger-lock');
  if (!(await exists(target))) await fs.writeFile(target, '', { flag: 'a', mode: 0o600 });
  let release;
  try {
    release = await lockfile.lock(target, { realpath: false, retries: { retries: 5, minTimeout: 10, maxTimeout: 100 }, stale: 30_000 });
    return await callback();
  } finally { if (release) await release(); }
}

async function ensureInstallation(root, now = Date.now) {
  const filePath = path.join(root, 'installation-v1.json');
  return withSharedLock(root, async () => {
    if (await exists(filePath)) {
      const value = await readJson(filePath);
      if (!validInstallation(value)) throw new Error('telemetry_installation_invalid');
      return value;
    }
    const value = { schemaVersion: SCHEMA_VERSION, installationId: crypto.randomBytes(16).toString('hex'), createdAt: new Date(now()).toISOString() };
    await writeAtomicDurable(filePath, value);
    return value;
  });
}

function incrementsForEvent(event) {
  const counters = createCounters();
  if (event.type === 'logical-start') counters.logicalOperations = 1;
  else if (event.type === 'logical-complete') {
    counters.logicalCompletedOperations = 1;
    counters[event.outcome === 'success' ? 'logicalSuccesses' : 'logicalFailures'] = 1;
    counters.operationDurationMs = clampInteger(event.durationMs);
  } else if (event.type === 'wire-start') {
    counters.wireAttempts = 1;
    if (event.retry) counters.retries = 1;
    if (event.fallback) counters.fallbackAttempts = 1;
    counters.batchElements = clampInteger(event.batchElements);
  } else if (event.type === 'wire-complete') {
    counters.wireCompletedAttempts = 1;
    counters[event.outcome === 'success' ? 'wireTransportSuccesses' : 'wireTransportFailures'] = 1;
    counters.attemptDurationMs = clampInteger(event.durationMs);
  } else if (event.type === 'counter' && COUNTER_SET.has(event.counter)) counters[event.counter] = clampInteger(event.amount || 1);
  return counters;
}

function mergeRows(target, source) {
  for (const key of COUNTERS) target.counters[key] = addSafe(target.counters[key], source.counters[key]);
}

function mergePendingIntoDay(day, pendingByMinute) {
  for (const [minute, pendingRows] of pendingByMinute) {
    const bucket = day.minutes[minute] ||= { rows: [] };
    const byKey = new Map(bucket.rows.map((row) => [dimensionKey(row.dimensions), row]));
    for (const row of pendingRows.values()) {
      const key = dimensionKey(row.dimensions);
      if (!byKey.has(key) && bucket.rows.length >= MAX_DIMENSION_ROWS_PER_MINUTE) continue;
      const target = byKey.get(key) || createRow(row.dimensions);
      if (!byKey.has(key)) { bucket.rows.push(target); byKey.set(key, target); }
      mergeRows(target, row);
    }
  }
}

function createTelemetryLedger({ userDataPath, profile = 'unknown', now = Date.now, flushIntervalMs = 30_000, writeAtomic = writeAtomicDurable } = {}) {
  if (!userDataPath) throw new TypeError('userDataPath is required');
  const root = path.join(userDataPath, 'telemetry');
  const activityRoot = path.join(root, 'rpc-activity-v1');
  const snapshotsRoot = path.join(root, 'snapshots-v1');
  const pending = new Map();
  let installation = null;
  let flushQueue = Promise.resolve();
  let timer = null;
  let stopped = false;
  let sessionId = crypto.randomBytes(16).toString('hex');
  let sessionStartedAt = new Date(now()).toISOString();
  let clockReversal = false;
  let lastObservedAt = Number(now());
  let writeFailures = 0;
  let openLogicalOperations = 0;
  let openWireAttempts = 0;

  function observe(at) { const numeric = Number(at); if (numeric < lastObservedAt) clockReversal = true; lastObservedAt = Math.max(lastObservedAt, numeric); }
  function record(event = {}) {
    try {
      const at = Number.isFinite(Number(event.at)) ? Number(event.at) : Number(now());
      observe(at);
      const date = utcDate(at); const minute = utcMinute(at);
      const dates = pending.get(date) || new Map(); pending.set(date, dates);
      const rows = dates.get(minute) || new Map(); dates.set(minute, rows);
      const context = normalizeContext({ ...event.context, profile: event.context?.profile === 'unknown' ? profile : event.context?.profile || profile });
      const key = dimensionKey(context);
      const row = rows.get(key) || createRow(context); rows.set(key, row);
      const increments = incrementsForEvent(event);
      for (const counter of COUNTERS) row.counters[counter] = addSafe(row.counters[counter], increments[counter]);
      if (event.type === 'logical-start') openLogicalOperations = addSafe(openLogicalOperations, 1);
      else if (event.type === 'logical-complete') openLogicalOperations = Math.max(0, openLogicalOperations - 1);
      else if (event.type === 'wire-start') openWireAttempts = addSafe(openWireAttempts, 1);
      else if (event.type === 'wire-complete') openWireAttempts = Math.max(0, openWireAttempts - 1);
    } catch (_) { /* never affect caller */ }
  }

  async function flushNow({ cleanStop = false } = {}) {
    installation ||= await ensureInstallation(root, now);
    const captured = new Map(pending); pending.clear();
    const progressAt = new Date(now()).toISOString();
    try {
      await withSharedLock(root, async () => {
        await fs.mkdir(activityRoot, { recursive: true });
        const dates = new Set([...captured.keys(), utcDate(Date.parse(progressAt))]);
        for (const date of dates) {
          const filePath = path.join(activityRoot, `${date}.json`);
          let day = createDay(installation.installationId, date);
          if (await exists(filePath)) {
            const value = await readJson(filePath);
            if (!validDay(value, installation.installationId, date)) throw new Error('telemetry_day_invalid');
            day = value;
          }
          mergePendingIntoDay(day, captured.get(date) || new Map());
          const prior = day.runtime.find((entry) => entry.sessionId === sessionId);
          if (prior) {
            prior.progressAt = progressAt;
            prior.cleanStopAt = cleanStop ? progressAt : prior.cleanStopAt;
            prior.clockReversal ||= clockReversal;
            prior.openLogicalOperations = openLogicalOperations;
            prior.openWireAttempts = openWireAttempts;
            prior.telemetryWriteFailures = writeFailures;
          } else day.runtime.push({
            sessionId, startedAt: sessionStartedAt, progressAt, cleanStopAt: cleanStop ? progressAt : null,
            clockReversal, openLogicalOperations, openWireAttempts, telemetryWriteFailures: writeFailures,
          });
          day.runtime = day.runtime.slice(-64);
          day.revision += 1; day.updatedAt = progressAt;
          await writeAtomic(filePath, day);
        }
      });
      await pruneRetention({ root, activityRoot, snapshotsRoot, now: now() });
    } catch (error) {
      for (const [date, minutes] of captured) {
        const targetMinutes = pending.get(date) || new Map(); pending.set(date, targetMinutes);
        for (const [minute, rows] of minutes) {
          const targetRows = targetMinutes.get(minute) || new Map(); targetMinutes.set(minute, targetRows);
          for (const [key, row] of rows) { const target = targetRows.get(key) || createRow(row.dimensions); targetRows.set(key, target); mergeRows(target, row); }
        }
      }
      writeFailures = addSafe(writeFailures, 1);
      throw error;
    }
  }

  function flush(options) {
    flushQueue = flushQueue.then(() => flushNow(options)).catch(() => {});
    return flushQueue;
  }
  async function start() { installation ||= await ensureInstallation(root, now); if (!timer && flushIntervalMs > 0) { timer = setInterval(() => void flush(), Math.min(30_000, flushIntervalMs)); timer.unref?.(); } await flush(); return installation; }
  async function stop() { if (stopped) return; stopped = true; if (timer) clearInterval(timer); timer = null; if (writeFailures) record({ type: 'counter', counter: 'telemetryWriteFailures', amount: writeFailures, at: now(), context: { profile } }); await flush({ cleanStop: true }); }

  return { root, activityRoot, snapshotsRoot, profile, record, flush, start, stop, getInstallation: () => installation, getPendingCount: () => pending.size };
}

async function pruneRetention({ root, activityRoot, snapshotsRoot, now = Date.now() }) {
  const cutoff = new Date(now); cutoff.setUTCDate(cutoff.getUTCDate() - COMPLETED_RETENTION_DAYS); const cutoffDate = cutoff.toISOString().slice(0, 10);
  for (const entry of await fs.readdir(activityRoot, { withFileTypes: true }).catch(() => [])) {
    if (entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name) && entry.name.slice(0, 10) < cutoffDate) await fs.rm(path.join(activityRoot, entry.name), { force: true });
  }
  const snapshots = (await fs.readdir(snapshotsRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort();
  for (const name of snapshots.slice(0, Math.max(0, snapshots.length - MAX_SNAPSHOTS))) await fs.rm(path.join(snapshotsRoot, name), { force: true });
}

module.exports = {
  SCHEMA_VERSION, COUNTERS, MAX_DIMENSION_ROWS_PER_MINUTE, MAX_SNAPSHOTS, COMPLETED_RETENTION_DAYS,
  clampInteger, addSafe, utcDate, utcMinute, boundaryIso, dimensionKey, createCounters, createTelemetryLedger,
  ensureInstallation, writeAtomicDurable, withSharedLock, validDay, readJson, pruneRetention,
};
