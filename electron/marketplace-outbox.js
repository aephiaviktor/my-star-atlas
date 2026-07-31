'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const properLockfile = require('proper-lockfile');

const OUTBOX_SCHEMA_VERSION = 1;
const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxEntries: 50_000,
  maxLineBytes: 8_192,
  maxRetryCount: 2 ** 31 - 1,
  maxQuarantineCopies: 3,
  renameRetries: 3,
});
const FAILURE_CATEGORIES = new Set([
  'not_configured', 'authentication', 'rate_limited', 'timeout',
  'network', 'server', 'rejected', 'unknown',
]);
const DOCUMENT_KEYS = ['entries', 'schemaVersion', 'updatedAt'];
const ENTRY_KEYS = [
  'attemptedAt', 'createdAt', 'eventType', 'faction', 'key', 'market',
  'payload', 'publishedAt', 'retry', 'retryCount', 'sourceId', 'state', 'updatedAt',
];
const PAYLOAD_KEYS = ['kind', 'line'];
const RETRY_KEYS = ['failure', 'nextAttemptAt'];
const HEX_64 = /^[a-f0-9]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SENSITIVE_KEY_SUFFIXES = Object.freeze([
  'authorization', 'bearer', 'apikey', 'token', 'password', 'secret',
  'cookie', 'headers', 'header', 'rpcurl', 'influxurl',
]);
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);
const UNSUPPORTED_DIR_SYNC_ERRORS = new Set(['EINVAL', 'ENOTSUP', 'ENOSYS']);
const queues = new Map();

class OutboxError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'MarketplaceOutboxError';
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function hashTuple(tuple) { return sha256(JSON.stringify(tuple)); }
function compareCodeUnits(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function canonicalQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new OutboxError('invalid_quantity');
  return quantity.toString();
}
function boundedString(value, code, max = 512) {
  if (typeof value !== 'string') throw new OutboxError(code);
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > max || CONTROL.test(normalized)) throw new OutboxError(code);
  return normalized;
}
function deriveTradeSourceId({ signature, rawMint, side, quantity } = {}) {
  const normalizedSignature = boundedString(signature, 'invalid_signature', 256);
  const normalizedRawMint = boundedString(rawMint, 'invalid_raw_mint', 256);
  if (side !== 'buy' && side !== 'sell') throw new OutboxError('invalid_side');
  return hashTuple(['msa-marketplace-trade-execution:v1', normalizedSignature, normalizedRawMint, side, canonicalQuantity(quantity)]);
}
function deriveAssetFlowSourceId({ flowId } = {}) {
  return hashTuple(['msa-marketplace-asset-flow:v1', boundedString(flowId, 'invalid_flow_id', 512)]);
}
function deriveOutboxKey({ market, faction, eventType, sourceId } = {}) {
  validateClassification({ market, faction, eventType });
  if (!HEX_64.test(String(sourceId || ''))) throw new OutboxError('invalid_source_id');
  return hashTuple(['msa-marketplace-outbox-key:v1', market, faction, eventType, sourceId]);
}
function validateClassification({ market, faction, eventType }) {
  if (market !== 'LM' && market !== 'GM') throw new OutboxError('invalid_market');
  if (eventType !== 'trade' && eventType !== 'asset_flow') throw new OutboxError('invalid_event_type');
  if (market === 'LM' && (eventType !== 'trade' || !['MUD', 'ONI', 'USTUR'].includes(faction))) throw new OutboxError('invalid_classification');
  if (market === 'GM' && faction !== 'GLOBAL') throw new OutboxError('invalid_classification');
  if (eventType === 'asset_flow' && (market !== 'GM' || faction !== 'GLOBAL')) throw new OutboxError('invalid_classification');
}
function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OutboxError(code);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new OutboxError(code);
}
function iso(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new OutboxError('invalid_timestamp');
  return value;
}
function unescapedSeparators(value, separator, honorQuotes = false) {
  const indexes = [];
  let escaped = false;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (honorQuotes && character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === separator) indexes.push(index);
  }
  return indexes;
}
function isSensitiveLineKey(key) {
  const normalized = key.toLowerCase().replace(/[-_ ]/g, '');
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}
function lineKeys(section, separator) {
  const boundaries = [-1, ...unescapedSeparators(section, separator, true), section.length];
  const keys = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const item = section.slice(boundaries[index] + 1, boundaries[index + 1]);
    const equals = unescapedSeparators(item, '=', true)[0];
    if (equals === undefined || equals <= 0) throw new OutboxError('invalid_line');
    keys.push(item.slice(0, equals).replace(/\\(.)/g, '$1'));
  }
  return keys;
}
function validateLine(line, eventType, limits) {
  if (typeof line !== 'string' || !line || CONTROL.test(line)) throw new OutboxError('invalid_line');
  if (Buffer.byteLength(line, 'utf8') > limits.maxLineBytes) throw new OutboxError('line_too_large');
  if (/https?:\/\//i.test(line) || /\bbearer\s+[^, ]+/i.test(line)) throw new OutboxError('sensitive_line');
  const spaces = unescapedSeparators(line, ' ', true);
  if (spaces.length < 2) throw new OutboxError('invalid_line');
  const firstSpace = spaces[0];
  const lastSpace = spaces.at(-1);
  const series = line.slice(0, firstSpace);
  const fields = line.slice(firstSpace + 1, lastSpace);
  const timestamp = line.slice(lastSpace + 1);
  const measurementEnd = unescapedSeparators(series, ',', true)[0] ?? series.length;
  const measurement = series.slice(0, measurementEnd);
  const expected = eventType === 'trade' ? 'marketplace' : 'asset_flow';
  if (measurement !== expected) throw new OutboxError('invalid_measurement');
  if (!fields || !/^\d+$/.test(timestamp)) throw new OutboxError('invalid_line');
  const tagSection = measurementEnd < series.length ? series.slice(measurementEnd + 1) : '';
  const keys = [...(tagSection ? lineKeys(tagSection, ',') : []), ...lineKeys(fields, ',')];
  if (keys.some(isSensitiveLineKey)) throw new OutboxError('sensitive_line');
  return line;
}
function validateEntry(entry, objectKey, limits) {
  exactKeys(entry, ENTRY_KEYS, 'invalid_entry_fields');
  if (!HEX_64.test(objectKey) || entry.key !== objectKey) throw new OutboxError('invalid_key');
  if (!HEX_64.test(entry.sourceId)) throw new OutboxError('invalid_source_id');
  validateClassification(entry);
  exactKeys(entry.payload, PAYLOAD_KEYS, 'invalid_payload_fields');
  if (entry.payload.kind !== 'influx_line_v1') throw new OutboxError('invalid_payload_kind');
  validateLine(entry.payload.line, entry.eventType, limits);
  if (entry.state !== 'pending' && entry.state !== 'published') throw new OutboxError('invalid_state');
  iso(entry.createdAt); iso(entry.updatedAt); iso(entry.attemptedAt, true); iso(entry.publishedAt, true);
  if (entry.state === 'pending' && entry.publishedAt !== null) throw new OutboxError('invalid_published_state');
  if (entry.state === 'published' && entry.publishedAt === null) throw new OutboxError('invalid_published_state');
  if (!Number.isInteger(entry.retryCount) || entry.retryCount < 0 || entry.retryCount > limits.maxRetryCount) throw new OutboxError('invalid_retry_count');
  exactKeys(entry.retry, RETRY_KEYS, 'invalid_retry_fields');
  iso(entry.retry.nextAttemptAt, true);
  if (entry.retry.failure !== null && !FAILURE_CATEGORIES.has(entry.retry.failure)) throw new OutboxError('invalid_failure');
  return entry;
}
function validateDocument(document, limits) {
  exactKeys(document, DOCUMENT_KEYS, 'invalid_document_fields');
  if (!Number.isSafeInteger(document.schemaVersion)) throw new OutboxError('invalid_schema_version');
  if (document.schemaVersion !== OUTBOX_SCHEMA_VERSION) throw new OutboxError('unsupported_version');
  iso(document.updatedAt);
  if (!document.entries || typeof document.entries !== 'object' || Array.isArray(document.entries)) throw new OutboxError('invalid_entries');
  const entries = Object.entries(document.entries);
  if (entries.length > limits.maxEntries) throw new OutboxError('entry_capacity');
  for (const [key, entry] of entries) validateEntry(entry, key, limits);
  return document;
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function canonicalDocument(document) {
  return { schemaVersion: OUTBOX_SCHEMA_VERSION, updatedAt: document.updatedAt, entries: Object.fromEntries(Object.entries(document.entries).sort(([a], [b]) => compareCodeUnits(a, b))) };
}
function safeSchemaVersion(content) {
  try {
    const parsed = JSON.parse(content);
    return Number.isSafeInteger(parsed?.schemaVersion) ? parsed.schemaVersion : null;
  } catch (_error) { return null; }
}
function diagnostic(code, filePath, content, schemaVersion = null) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content || '');
  return { code, basename: path.basename(filePath), byteCount: bytes.length, contentHash: sha256(bytes).slice(0, 16), schemaVersion: Number.isSafeInteger(schemaVersion) ? schemaVersion : null };
}
function normalizeLimits(limits = {}) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new OutboxError('invalid_limits');
  const result = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || typeof value !== 'number' || !Number.isInteger(value)
      || value < 0 || value > DEFAULT_LIMITS[key]) throw new OutboxError('invalid_limits');
    result[key] = value;
  }
  return Object.freeze(result);
}
function normalizeNow(now) {
  const value = typeof now === 'function' ? now() : new Date().toISOString();
  return iso(value);
}
function immutableEqual(existing, incoming) {
  return existing.key === incoming.key && existing.sourceId === incoming.sourceId
    && existing.eventType === incoming.eventType && existing.market === incoming.market
    && existing.faction === incoming.faction && existing.payload.kind === incoming.payload.kind
    && existing.payload.line === incoming.payload.line;
}
function queueFor(filePath, callback) {
  const prior = queues.get(filePath) || Promise.resolve();
  const next = prior.catch(() => undefined).then(callback);
  const tracked = next.finally(() => { if (queues.get(filePath) === tracked) queues.delete(filePath); });
  tracked.catch(() => undefined);
  queues.set(filePath, tracked);
  return next;
}
function defaultLockAdapter(fsAdapter) {
  return {
    async acquire(lockPath) {
      await fsAdapter.mkdir(path.dirname(lockPath), { recursive: true });
      const handle = await fsAdapter.open(lockPath, 'a', 0o600);
      await handle.close();
      try {
        return await properLockfile.lock(lockPath, {
          realpath: false, stale: 10_000,
          retries: { retries: 20, minTimeout: 5, maxTimeout: 100, factor: 1.5 },
        });
      } catch (_error) { throw new OutboxError('lock_failed'); }
    },
  };
}
async function acquireLock(adapter, lockPath) {
  try {
    const release = typeof adapter === 'function' ? await adapter(lockPath) : await adapter.acquire(lockPath);
    if (typeof release !== 'function') throw new Error('invalid release');
    return release;
  } catch (error) {
    if (error instanceof OutboxError) throw error;
    throw new OutboxError('lock_failed');
  }
}
async function cleanupOwnedTemps(fsAdapter, filePath) {
  const directory = path.dirname(filePath);
  let names;
  try { names = await fsAdapter.readdir(directory); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  const escaped = path.basename(filePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\.${escaped}\\.\\d+\\.[a-f0-9-]{36}\\.tmp$`);
  await Promise.all(names.filter((name) => pattern.test(name)).map((name) => fsAdapter.rm(path.join(directory, name), { force: true })));
}
async function quarantine(fsAdapter, filePath, content, limits, nowValue) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const hash = sha256(bytes);
  let names = await fsAdapter.readdir(directory).catch(() => []);
  const prefix = `${basename}.corrupt.`;
  const escapedBasename = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ownedPattern = new RegExp(`^${escapedBasename}\\.corrupt\\.\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z\\.[a-f0-9]{64}\\.json$`);
  const ownedNames = names.filter((name) => ownedPattern.test(name));
  let alreadyQuarantined = false;
  for (const name of ownedNames) {
    const prior = await fsAdapter.readFile(path.join(directory, name)).catch(() => null);
    if (prior && sha256(prior) === hash) { alreadyQuarantined = true; break; }
  }
  if (!alreadyQuarantined) {
    const safeTime = nowValue.replace(/[:.]/g, '-');
    const quarantinePath = path.join(directory, `${prefix}${safeTime}.${hash}.json`);
    await fsAdapter.writeFile(quarantinePath, bytes, { mode: 0o600, flag: 'wx' }).catch((error) => { if (error?.code !== 'EEXIST') throw error; });
  }
  names = await fsAdapter.readdir(directory).catch(() => []);
  const copies = [];
  for (const name of names.filter((name) => ownedPattern.test(name))) {
    const full = path.join(directory, name);
    const stat = await fsAdapter.stat(full).catch(() => null);
    if (stat) copies.push({ full, mtimeMs: stat.mtimeMs, name });
  }
  copies.sort((a, b) => a.mtimeMs - b.mtimeMs || compareCodeUnits(a.name, b.name));
  while (copies.length > limits.maxQuarantineCopies) await fsAdapter.rm(copies.shift().full, { force: true });
}
async function readState(fsAdapter, filePath, limits, { quarantineInvalid = false, nowValue } = {}) {
  let stat;
  try { stat = await fsAdapter.stat(filePath); } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing', document: null };
    throw new OutboxError('read_failed');
  }
  if (stat.size > limits.maxFileBytes) return { status: 'invalid', document: null, diagnostic: { code: 'file_too_large', basename: path.basename(filePath), byteCount: stat.size, contentHash: null, schemaVersion: null } };
  let content;
  try { content = await fsAdapter.readFile(filePath); } catch (_error) { throw new OutboxError('read_failed'); }
  if (!Buffer.isBuffer(content)) content = Buffer.from(content);
  if (content.length > limits.maxFileBytes) return { status: 'invalid', document: null, diagnostic: { code: 'file_too_large', basename: path.basename(filePath), byteCount: content.length, contentHash: null, schemaVersion: null } };
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); }
  catch (_error) {
    if (quarantineInvalid) await quarantine(fsAdapter, filePath, content, limits, nowValue).catch(() => undefined);
    return { status: 'invalid', document: null, diagnostic: diagnostic('invalid_utf8', filePath, content, null) };
  }
  const schemaVersion = safeSchemaVersion(text);
  if (schemaVersion !== null && schemaVersion !== OUTBOX_SCHEMA_VERSION) {
    return { status: 'unsupported_version', document: null, diagnostic: diagnostic('unsupported_version', filePath, content, schemaVersion) };
  }
  try {
    const document = validateDocument(JSON.parse(text), limits);
    return { status: 'loaded', document: canonicalDocument(document), diagnostic: null };
  } catch (error) {
    if (error?.code === 'unsupported_version') return { status: 'unsupported_version', document: null, diagnostic: diagnostic('unsupported_version', filePath, content, schemaVersion) };
    if (quarantineInvalid) await quarantine(fsAdapter, filePath, content, limits, nowValue).catch(() => undefined);
    return { status: 'invalid', document: null, diagnostic: diagnostic(error?.code || 'invalid_document', filePath, content, schemaVersion) };
  }
}
async function atomicWrite(fsAdapter, filePath, document, limits, retryDelay) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const content = `${JSON.stringify(canonicalDocument(document), null, 2)}\n`;
  if (Buffer.byteLength(content) > limits.maxFileBytes) throw new OutboxError('file_capacity');
  await fsAdapter.mkdir(directory, { recursive: true });
  let renamed = false;
  try {
    const handle = await fsAdapter.open(temporaryPath, 'wx', 0o600);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    for (let attempt = 0; ; attempt += 1) {
      try { await fsAdapter.rename(temporaryPath, filePath); renamed = true; break; }
      catch (error) {
        if (!TRANSIENT_RENAME_ERRORS.has(error?.code) || attempt >= limits.renameRetries) throw new OutboxError('atomic_replace_failed');
        await retryDelay(attempt + 1);
      }
    }
    try {
      const directoryHandle = await fsAdapter.open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (error) {
      if (!UNSUPPORTED_DIR_SYNC_ERRORS.has(error?.code)) return { committed: true, durability: 'uncertain', code: 'directory_sync_failed' };
    }
    return { committed: true, durability: 'confirmed' };
  } finally {
    if (!renamed) await fsAdapter.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function createMarketplaceOutbox({ filePath, now = () => new Date().toISOString(), lockAdapter, fsAdapter = fs, retryDelay = async (attempt) => new Promise((resolve) => setTimeout(resolve, Math.min(100, attempt * 10))), limits } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new OutboxError('absolute_file_path_required');
  const canonicalPath = path.resolve(filePath);
  const resolvedLimits = normalizeLimits(limits);
  const resolvedLock = lockAdapter || defaultLockAdapter(fsAdapter);
  const lockPath = `${canonicalPath}.lock-target`;
  let snapshot = null;

  async function underLock(callback, { allowMissing = false } = {}) {
    return queueFor(canonicalPath, async () => {
      const release = await acquireLock(resolvedLock, lockPath);
      try {
        await cleanupOwnedTemps(fsAdapter, canonicalPath);
        const nowValue = normalizeNow(now);
        const loaded = await readState(fsAdapter, canonicalPath, resolvedLimits, { quarantineInvalid: true, nowValue });
        if (loaded.status === 'invalid' || loaded.status === 'unsupported_version') { snapshot = null; return loaded; }
        if (loaded.status === 'missing' && !allowMissing) return loaded;
        return await callback(loaded, nowValue);
      } finally {
        try { await Promise.resolve(release()); } catch (_releaseError) { /* Mutation outcome is authoritative. */ }
      }
    });
  }

  async function open() {
    const first = await readState(fsAdapter, canonicalPath, resolvedLimits);
    if (first.status === 'missing') { snapshot = null; return clone(first); }
    return underLock(async (loaded) => { snapshot = loaded.document; return clone(loaded); });
  }
  async function reload() { return open(); }

  function buildEntry(record, nowValue) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new OutboxError('invalid_record');
    const allowed = record.eventType === 'trade'
      ? ['eventType', 'faction', 'line', 'market', 'quantity', 'rawMint', 'side', 'signature']
      : ['eventType', 'faction', 'flowId', 'line', 'market'];
    const keys = Object.keys(record).sort();
    if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) throw new OutboxError('invalid_record_fields');
    validateClassification(record);
    const sourceId = record.eventType === 'trade' ? deriveTradeSourceId(record) : deriveAssetFlowSourceId(record);
    const key = deriveOutboxKey({ ...record, sourceId });
    const entry = {
      key, eventType: record.eventType, market: record.market, faction: record.faction, sourceId,
      payload: { kind: 'influx_line_v1', line: validateLine(record.line, record.eventType, resolvedLimits) },
      state: 'pending', createdAt: nowValue, updatedAt: nowValue, attemptedAt: null, publishedAt: null,
      retryCount: 0, retry: { nextAttemptAt: null, failure: null },
    };
    validateEntry(entry, key, resolvedLimits);
    return entry;
  }

  async function enqueue(record) {
    return underLock(async (loaded, nowValue) => {
      const document = loaded.document || { schemaVersion: OUTBOX_SCHEMA_VERSION, updatedAt: nowValue, entries: {} };
      const entry = buildEntry(record, nowValue);
      const existing = document.entries[entry.key];
      if (existing) {
        if (!immutableEqual(existing, entry)) throw new OutboxError('identity_conflict');
        snapshot = document;
        return { status: 'unchanged', key: entry.key, written: false, entry: clone(existing) };
      }
      if (Object.keys(document.entries).length >= resolvedLimits.maxEntries) throw new OutboxError('entry_capacity');
      document.entries[entry.key] = entry;
      document.updatedAt = nowValue;
      const write = await atomicWrite(fsAdapter, canonicalPath, document, resolvedLimits, retryDelay);
      snapshot = canonicalDocument(document);
      return { status: 'enqueued', key: entry.key, written: true, entry: clone(entry), ...write };
    }, { allowMissing: true });
  }

  async function listPending(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'limit')) throw new OutboxError('invalid_list_options');
    const limit = options.limit ?? resolvedLimits.maxEntries;
    if (!Number.isInteger(limit) || limit < 0 || limit > resolvedLimits.maxEntries) throw new OutboxError('invalid_limit');
    const first = await readState(fsAdapter, canonicalPath, resolvedLimits);
    if (first.status === 'missing') return { status: 'missing', entries: [] };
    return underLock(async (loaded) => {
      if (loaded.status !== 'loaded') return clone(loaded);
      snapshot = loaded.document;
      const entries = Object.values(loaded.document.entries).filter((entry) => entry.state === 'pending')
        .sort((a, b) => compareCodeUnits(a.createdAt, b.createdAt) || compareCodeUnits(a.key, b.key)).slice(0, limit);
      return { status: 'loaded', entries: clone(entries) };
    });
  }

  async function mutateExisting(key, mutate) {
    if (!HEX_64.test(String(key || ''))) throw new OutboxError('invalid_key');
    return underLock(async (loaded, nowValue) => {
      if (loaded.status === 'missing') return { status: 'missing_key', key };
      const document = loaded.document;
      const entry = document.entries[key];
      if (!entry) return { status: 'missing_key', key };
      const result = mutate(entry, nowValue);
      if (!result.changed) { snapshot = document; return { ...result.response, written: false, entry: clone(entry) }; }
      document.updatedAt = nowValue;
      const write = await atomicWrite(fsAdapter, canonicalPath, document, resolvedLimits, retryDelay);
      snapshot = canonicalDocument(document);
      return { ...result.response, written: true, entry: clone(entry), ...write };
    });
  }

  async function markPublished(key, publishedAt) {
    iso(publishedAt);
    return mutateExisting(key, (entry, nowValue) => {
      if (entry.state === 'published') return { changed: false, response: { status: 'already_published' } };
      entry.state = 'published'; entry.publishedAt = publishedAt; entry.updatedAt = nowValue;
      return { changed: true, response: { status: 'published' } };
    });
  }

  async function recordFailedAttempt(key, attempt = {}) {
    exactKeys(attempt, ['attemptedAt', 'failure', 'nextAttemptAt'], 'invalid_failure_fields');
    const { failure, attemptedAt, nextAttemptAt } = attempt;
    if (!FAILURE_CATEGORIES.has(failure)) throw new OutboxError('invalid_failure');
    iso(attemptedAt); iso(nextAttemptAt, true);
    return mutateExisting(key, (entry, nowValue) => {
      if (entry.state !== 'pending') return { changed: false, response: { status: 'invalid_state' } };
      entry.attemptedAt = attemptedAt; entry.updatedAt = nowValue;
      entry.retryCount = Math.min(resolvedLimits.maxRetryCount, entry.retryCount + 1);
      entry.retry = { nextAttemptAt, failure };
      return { changed: true, response: { status: 'failed_attempt_recorded' } };
    });
  }

  return { open, reload, enqueue, listPending, markPublished, recordFailedAttempt };
}

module.exports = {
  OUTBOX_SCHEMA_VERSION,
  FAILURE_CATEGORIES: Object.freeze(Array.from(FAILURE_CATEGORIES)),
  OutboxError,
  createMarketplaceOutbox,
  deriveTradeSourceId,
  deriveAssetFlowSourceId,
  deriveOutboxKey,
};
