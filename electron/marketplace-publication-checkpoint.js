'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const properLockfile = require('proper-lockfile');
const { writeJsonAtomic } = require('./atomic-json');

const SCHEMA_VERSION = 1;
const DIRECTORY = 'marketplace-publication';
const FILE = 'publication-holds-v1.json';
const LOCK_OPTIONS = Object.freeze({
  stale: 30000,
  update: 10000,
  retries: Object.freeze({ retries: 50, factor: 1.2, minTimeout: 10, maxTimeout: 100, randomize: false }),
  realpath: false,
});
const STATES = Object.freeze([
  'held_not_configured', 'held_staged', 'held_posting', 'held_ambiguous',
  'held_mark_failed', 'released', 'abandoned',
]);
const ACTIVE_STATES = new Set(STATES.filter((state) => state !== 'released' && state !== 'abandoned'));
const RECONCILIATION_STATES = new Set(['held_posting', 'held_ambiguous', 'held_mark_failed']);
const HOLD_KEYS = Object.freeze([
  'holdId', 'market', 'kind', 'logicalKeyOrSourceId', 'eventId', 'currentRevisionId', 'state',
  'createdAt', 'updatedAt', 'firstSeenAt', 'lastSeenAt', 'candidateTimestamp',
  'observedMutableIdsByRevision', 'observedMutableIdsByRank', 'observedFlowIds', 'candidateSnapshot',
  'cursorInputSnapshot', 'cursorOutputSnapshot', 'releaseConditions', 'lastCoordinatorResult', 'retry',
]);
const CURSOR_KEYS = Object.freeze(['walletCursors', 'orderCursors', 'activeOrderIds', 'archivedOrderIds']);
const CONDITION_KEYS = Object.freeze(['currentRevisionPublished', 'mutableIdsRecorded', 'reconciliationClear']);
const RETRY_KEYS = Object.freeze(['failure', 'nextAttemptAt', 'retryCount']);
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 128 * 1024;
const MAX_CODE_BYTES = 64;
const CODE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SENSITIVE_KEY = /(?:authorization|bearer|api[_-]?key|token|password|secret|cookie|headers?|rpc[_-]?url|influx[_-]?url|flux|response(?:body)?|raw(?:error|exception))/i;
const URL = /https?:\/\//i;
const queues = new Map();

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function compare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function hash(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(compare);
  const wanted = Array.from(expected).sort(compare);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function iso(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('invalid_timestamp');
  return value;
}
function nowValue(now) { return iso(typeof now === 'function' ? now() : (now || new Date().toISOString())); }
function bounded(value, code, max = 512, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw new Error(code);
  const result = value.trim();
  if (!result || Buffer.byteLength(result, 'utf8') > max || CONTROL.test(result) || URL.test(result)) throw new Error(URL.test(result) ? 'sensitive_value' : code);
  return result;
}
function boundedCode(value, nullable = true) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !CODE.test(value) || Buffer.byteLength(value, 'utf8') > MAX_CODE_BYTES) throw new Error('invalid_code');
  return value;
}
function safeErrorCode(error, fallback) {
  const value = error?.message;
  return typeof value === 'string' && CODE.test(value) && Buffer.byteLength(value, 'utf8') <= MAX_CODE_BYTES ? value : fallback;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, canonical(value[key])]));
  return value;
}
function safeSnapshot(value, keyPath = '') {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('invalid_snapshot'); return value; }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > 8192 || CONTROL.test(value) || URL.test(value)) throw new Error('sensitive_snapshot');
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => safeSnapshot(entry, `${keyPath}.${index}`));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('invalid_snapshot');
  const output = {};
  for (const key of Object.keys(value).sort(compare)) {
    if (SENSITIVE_KEY.test(key)) throw new Error('sensitive_snapshot');
    output[key] = safeSnapshot(value[key], `${keyPath}.${key}`);
  }
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_SNAPSHOT_BYTES) throw new Error('snapshot_capacity');
  return output;
}
function stringArray(value) {
  if (!Array.isArray(value)) throw new Error('invalid_string_array');
  return Array.from(new Set(value.map((entry) => bounded(entry, 'invalid_identifier', 512)))).sort(compare);
}
function stringMapOfArrays(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_identifier_map');
  return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [bounded(key, 'invalid_identifier', 128), stringArray(value[key])]));
}
function cursorSnapshot(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    walletCursors: canonical(source.walletCursors && typeof source.walletCursors === 'object' && !Array.isArray(source.walletCursors) ? safeSnapshot(source.walletCursors) : {}),
    orderCursors: canonical(source.orderCursors && typeof source.orderCursors === 'object' && !Array.isArray(source.orderCursors) ? safeSnapshot(source.orderCursors) : {}),
    activeOrderIds: stringArray(Array.isArray(source.activeOrderIds) ? source.activeOrderIds : []),
    archivedOrderIds: stringArray(Array.isArray(source.archivedOrderIds) ? source.archivedOrderIds : []),
  };
}
function releaseConditions(value = {}) {
  return Object.fromEntries(CONDITION_KEYS.map((key) => [key, value[key] === true]));
}
function retryRecord(value = {}) {
  return {
    failure: boundedCode(value.failure),
    nextAttemptAt: value.nextAttemptAt == null ? null : iso(value.nextAttemptAt),
    retryCount: Number.isSafeInteger(value.retryCount) && value.retryCount >= 0 ? value.retryCount : 0,
  };
}
function coordinatorResult(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_coordinator_result');
  const outcome = boundedCode(value.outcome, false);
  const detailCode = boundedCode(value.detailCode);
  return { outcome, detailCode };
}
function pathsFor(installationRoot) {
  if (typeof installationRoot !== 'string' || !path.isAbsolute(installationRoot)) throw new Error('invalid_installation_root');
  const directoryPath = path.resolve(installationRoot, 'data', DIRECTORY);
  return { directoryPath, documentPath: path.join(directoryPath, FILE), lockPath: path.join(directoryPath, `${FILE}.lock-target`) };
}
function queueFor(key, callback) {
  const prior = queues.get(key) || Promise.resolve();
  const next = prior.catch(() => undefined).then(callback);
  const tracked = next.finally(() => { if (queues.get(key) === tracked) queues.delete(key); });
  tracked.catch(() => undefined); queues.set(key, tracked); return next;
}
async function acquire(paths, options) {
  const fsAdapter = options.fsAdapter || fs;
  await fsAdapter.mkdir(paths.directoryPath, { recursive: true });
  const handle = await fsAdapter.open(paths.lockPath, 'a', 0o600); await handle.close();
  if (options.lockAdapter) return options.lockAdapter(paths.lockPath, LOCK_OPTIONS);
  return properLockfile.lock(paths.lockPath, LOCK_OPTIONS);
}
function canonicalDocument(document) {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: document.updatedAt, holds: Object.fromEntries(Object.entries(document.holds).sort(([a], [b]) => compare(a, b)).map(([key, hold]) => [key, canonical(hold)])) };
}
function validateHold(hold, holdId) {
  if (!exactKeys(hold, HOLD_KEYS) || hold.holdId !== holdId || !/^[a-f0-9]{64}$/.test(holdId)) throw new Error('invalid_hold');
  if (!['LM','GM'].includes(hold.market) || !['trade','asset_flow'].includes(hold.kind)) throw new Error('invalid_classification');
  if (hold.market === 'LM' && hold.kind !== 'trade') throw new Error('invalid_classification');
  bounded(hold.logicalKeyOrSourceId, 'invalid_logical_key', 512);
  bounded(hold.eventId, 'invalid_event_id', 512, true); bounded(hold.currentRevisionId, 'invalid_revision_id', 512, true);
  if (!STATES.includes(hold.state)) throw new Error('invalid_state');
  iso(hold.createdAt); iso(hold.updatedAt); iso(hold.firstSeenAt); iso(hold.lastSeenAt); iso(hold.candidateTimestamp);
  stringMapOfArrays(hold.observedMutableIdsByRevision); stringMapOfArrays(hold.observedMutableIdsByRank); stringArray(hold.observedFlowIds);
  safeSnapshot(hold.candidateSnapshot);
  if (!exactKeys(hold.cursorInputSnapshot, CURSOR_KEYS) || !exactKeys(hold.cursorOutputSnapshot, CURSOR_KEYS)) throw new Error('invalid_cursor_snapshot');
  cursorSnapshot(hold.cursorInputSnapshot); cursorSnapshot(hold.cursorOutputSnapshot);
  if (!exactKeys(hold.releaseConditions, CONDITION_KEYS)) throw new Error('invalid_release_conditions');
  if (!CONDITION_KEYS.every((key) => typeof hold.releaseConditions[key] === 'boolean')) throw new Error('invalid_release_conditions');
  coordinatorResult(hold.lastCoordinatorResult);
  if (!exactKeys(hold.retry, RETRY_KEYS)) throw new Error('invalid_retry'); retryRecord(hold.retry);
  return hold;
}
function validateDocument(document) {
  if (!exactKeys(document, ['schemaVersion','updatedAt','holds']) || document.schemaVersion !== SCHEMA_VERSION) throw new Error(document?.schemaVersion === undefined ? 'invalid_document' : 'unsupported_version');
  iso(document.updatedAt);
  if (!document.holds || typeof document.holds !== 'object' || Array.isArray(document.holds)) throw new Error('invalid_document');
  for (const [holdId, hold] of Object.entries(document.holds)) validateHold(hold, holdId);
  return canonicalDocument(document);
}
async function readDocument(paths, options) {
  const fsAdapter = options.fsAdapter || fs;
  let text;
  try { text = await fsAdapter.readFile(paths.documentPath, 'utf8'); }
  catch (error) { return error?.code === 'ENOENT' ? { status: 'missing', document: null } : { status: 'read_failed', document: null }; }
  if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) return { status: 'document_capacity', document: null };
  let parsed; try { parsed = JSON.parse(text); } catch (_error) { return { status: 'corrupt_json', document: null }; }
  if (Number.isSafeInteger(parsed?.schemaVersion) && parsed.schemaVersion !== SCHEMA_VERSION) return { status: 'unsupported_version', document: null };
  try { return { status: 'loaded', document: validateDocument(parsed) }; }
  catch (error) { return { status: safeErrorCode(error, 'invalid_document'), document: null }; }
}
async function locked(options, callback) {
  let paths; try { paths = pathsFor(options.installationRoot); } catch (error) { return { status: safeErrorCode(error, 'invalid_options'), written: false }; }
  return queueFor(paths.documentPath, async () => {
    let release;
    try {
      release = await acquire(paths, options);
      return await callback({ paths, loaded: await readDocument(paths, options), fsAdapter: options.fsAdapter || fs });
    } catch (_error) { return { status: 'storage_failed', written: false }; }
    finally { if (release) { try { await Promise.resolve(release()); } catch (_error) { /* result remains authoritative */ } } }
  });
}
async function persist(paths, document, options) {
  const canonicalValue = validateDocument(canonicalDocument(document));
  if (Buffer.byteLength(`${JSON.stringify(canonicalValue, null, 2)}\n`, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('document_capacity');
  await writeJsonAtomic(paths.documentPath, canonicalValue, options.writeHooks || {});
  return canonicalValue;
}
function emptyDocument(now) { return { schemaVersion: SCHEMA_VERSION, updatedAt: now, holds: {} }; }
function holdIdFor(market, kind, logicalKeyOrSourceId) { return hash(JSON.stringify(['msa-marketplace-publication-hold:v1', market, kind, logicalKeyOrSourceId])); }
function mergeMaps(left, right) {
  const keys = Array.from(new Set([...Object.keys(left || {}), ...Object.keys(right || {})])).sort(compare);
  return Object.fromEntries(keys.map((key) => [key, stringArray([...(left?.[key] || []), ...(right?.[key] || [])])]));
}
function normalizeCandidate(candidate, now) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('invalid_candidate');
  const market = candidate.market;
  const kind = candidate.kind;
  if (!['LM','GM'].includes(market) || !['trade','asset_flow'].includes(kind) || (market === 'LM' && kind !== 'trade')) throw new Error('invalid_classification');
  const logicalKeyOrSourceId = bounded(candidate.logicalKeyOrSourceId ?? candidate.logicalKey ?? candidate.sourceId, 'invalid_logical_key', 512);
  const eventId = candidate.eventId == null ? null : bounded(candidate.eventId, 'invalid_event_id', 512);
  const currentRevisionId = candidate.currentRevisionId == null ? null : bounded(candidate.currentRevisionId, 'invalid_revision_id', 512);
  const candidateTimestamp = iso(candidate.candidateTimestamp || candidate.candidateSnapshot?.timestamp || now);
  const snapshot = safeSnapshot(candidate.candidateSnapshot || {});
  const currentRank = candidate.currentRank == null ? null : bounded(candidate.currentRank, 'invalid_rank', 64);
  const currentMutableIds = stringArray(candidate.currentMutableIds || []);
  const observedMutableIdsByRevision = mergeMaps(
    stringMapOfArrays(candidate.observedMutableIdsByRevision || {}),
    currentRevisionId ? { [currentRevisionId]: currentMutableIds } : {},
  );
  const observedMutableIdsByRank = mergeMaps(
    stringMapOfArrays(candidate.observedMutableIdsByRank || {}),
    currentRank ? { [currentRank]: currentMutableIds } : {},
  );
  const observedFlowIds = stringArray(candidate.observedFlowIds || (kind === 'asset_flow' && candidate.flowId ? [candidate.flowId] : []));
  return {
    market, kind, logicalKeyOrSourceId, eventId, currentRevisionId, candidateTimestamp,
    observedMutableIdsByRevision, observedMutableIdsByRank, observedFlowIds,
    candidateSnapshot: canonical({ ...snapshot, logicalKey: candidate.logicalKey ?? logicalKeyOrSourceId, currentRevisionId, currentRank, currentMutableIds }),
    cursorInputSnapshot: cursorSnapshot(candidate.cursorInputSnapshot), cursorOutputSnapshot: cursorSnapshot(candidate.cursorOutputSnapshot),
  };
}

async function loadMarketplacePublicationHolds(options = {}) {
  return locked(options, async ({ loaded, paths }) => ({ status: loaded.status, document: clone(loaded.document), paths: { documentPath: paths.documentPath, lockPath: paths.lockPath } }));
}

async function recordMarketplacePublicationHold(options = {}) {
  let candidate; let now;
  try { now = nowValue(options.now); candidate = normalizeCandidate(options.candidate || options.hold, now); }
  catch (error) { return { status: safeErrorCode(error, 'invalid_candidate'), written: false, hold: null }; }
  return locked(options, async ({ loaded, paths }) => {
    if (!['missing','loaded'].includes(loaded.status)) return { status: loaded.status, written: false, hold: null };
    const document = loaded.status === 'loaded' ? loaded.document : emptyDocument(now);
    const holdId = holdIdFor(candidate.market, candidate.kind, candidate.logicalKeyOrSourceId);
    const prior = document.holds[holdId];
    const revisionChanged = prior && candidate.currentRevisionId !== null && candidate.currentRevisionId !== prior.currentRevisionId;
    const rankChanged = prior && candidate.candidateSnapshot.currentRank !== null
      && candidate.candidateSnapshot.currentRank !== prior.candidateSnapshot.currentRank;
    const reactivated = prior && (revisionChanged || rankChanged) && (prior.state === 'released' || prior.state === 'abandoned');
    const hold = prior ? {
      ...prior,
      eventId: candidate.eventId ?? prior.eventId,
      currentRevisionId: candidate.currentRevisionId ?? prior.currentRevisionId,
      state: reactivated ? 'held_not_configured' : prior.state,
      updatedAt: now, lastSeenAt: now, candidateTimestamp: candidate.candidateTimestamp,
      observedMutableIdsByRevision: mergeMaps(prior.observedMutableIdsByRevision, candidate.observedMutableIdsByRevision),
      observedMutableIdsByRank: mergeMaps(prior.observedMutableIdsByRank, candidate.observedMutableIdsByRank),
      observedFlowIds: stringArray([...prior.observedFlowIds, ...candidate.observedFlowIds]),
      candidateSnapshot: candidate.candidateSnapshot,
      cursorInputSnapshot: reactivated ? candidate.cursorInputSnapshot : prior.cursorInputSnapshot,
      cursorOutputSnapshot: candidate.cursorOutputSnapshot,
      releaseConditions: reactivated ? releaseConditions() : prior.releaseConditions,
      lastCoordinatorResult: reactivated ? null : prior.lastCoordinatorResult,
      retry: reactivated ? retryRecord() : prior.retry,
    } : {
      holdId, market: candidate.market, kind: candidate.kind, logicalKeyOrSourceId: candidate.logicalKeyOrSourceId,
      eventId: candidate.eventId, currentRevisionId: candidate.currentRevisionId, state: 'held_not_configured',
      createdAt: now, updatedAt: now, firstSeenAt: now, lastSeenAt: now, candidateTimestamp: candidate.candidateTimestamp,
      observedMutableIdsByRevision: candidate.observedMutableIdsByRevision,
      observedMutableIdsByRank: candidate.observedMutableIdsByRank,
      observedFlowIds: candidate.observedFlowIds,
      candidateSnapshot: candidate.candidateSnapshot,
      cursorInputSnapshot: candidate.cursorInputSnapshot,
      cursorOutputSnapshot: candidate.cursorOutputSnapshot,
      releaseConditions: releaseConditions(), lastCoordinatorResult: null, retry: retryRecord(),
    };
    const unchanged = prior && JSON.stringify(canonical({ ...prior, updatedAt: null, lastSeenAt: null }))
      === JSON.stringify(canonical({ ...hold, updatedAt: null, lastSeenAt: null }));
    if (unchanged) return { status: 'hold_unchanged', written: false, hold: clone(prior) };
    document.holds[holdId] = hold; document.updatedAt = now;
    try { const saved = await persist(paths, document, options); return { status: prior ? 'hold_updated' : 'hold_recorded', written: true, hold: clone(saved.holds[holdId]) }; }
    catch (error) { return { status: safeErrorCode(error, 'atomic_replace_failed'), written: false, hold: clone(prior || null) }; }
  });
}

async function updateMarketplacePublicationHold(options = {}) {
  const holdId = String(options.holdId || '');
  if (!/^[a-f0-9]{64}$/.test(holdId)) return { status: 'invalid_hold_id', written: false, hold: null };
  let now; try { now = nowValue(options.now); } catch (_error) { return { status: 'invalid_timestamp', written: false, hold: null }; }
  return locked(options, async ({ loaded, paths }) => {
    if (loaded.status !== 'loaded') return { status: loaded.status, written: false, hold: null };
    const prior = loaded.document.holds[holdId]; if (!prior) return { status: 'hold_not_found', written: false, hold: null };
    let state = options.state ?? prior.state;
    if (!STATES.includes(state) || state === 'released') return { status: 'invalid_state', written: false, hold: clone(prior) };
    if (state === 'abandoned' && options.conclusive !== true) return { status: 'conclusive_decision_required', written: false, hold: clone(prior) };
    let result; let retry;
    try { result = options.lastCoordinatorResult === undefined ? prior.lastCoordinatorResult : coordinatorResult(options.lastCoordinatorResult); retry = options.retry === undefined ? prior.retry : retryRecord(options.retry); }
    catch (error) { return { status: safeErrorCode(error, 'invalid_update'), written: false, hold: clone(prior) }; }
    if (options.releaseConditions?.mutableIdsRecorded === true && options.checkpointWritten !== true) {
      return { status: 'checkpoint_not_durable', written: false, hold: clone(prior) };
    }
    const conditions = { ...prior.releaseConditions, ...Object.fromEntries(CONDITION_KEYS.filter((key) => options.releaseConditions?.[key] !== undefined).map((key) => [key, options.releaseConditions[key] === true])) };
    if (result && options.state === undefined) {
      if (result.outcome === 'posting') { state = 'held_posting'; conditions.reconciliationClear = false; }
      else if (result.outcome === 'publication_ambiguous') { state = 'held_ambiguous'; conditions.reconciliationClear = false; }
      else if (result.outcome === 'published_mark_failed' || result.outcome === 'published_mark_uncertain') {
        state = 'held_mark_failed'; conditions.currentRevisionPublished = true; conditions.reconciliationClear = false;
      } else if (result.outcome === 'published_confirmed' || result.outcome === 'already_published') {
        if (state === 'released' || state === 'abandoned') state = 'held_staged';
        conditions.currentRevisionPublished = true;
      } else if (result.outcome === 'published_superseded_revision') {
        if (state === 'released' || state === 'abandoned') state = 'held_staged';
        conditions.currentRevisionPublished = false;
      } else if (result.outcome === 'pending_unattempted' || result.outcome === 'publication_failed') state = 'held_staged';
    }
    let observedMutableIdsByRevision; let observedMutableIdsByRank; let observedFlowIds;
    try {
      observedMutableIdsByRevision = mergeMaps(prior.observedMutableIdsByRevision, options.observedMutableIdsByRevision || {});
      observedMutableIdsByRank = mergeMaps(prior.observedMutableIdsByRank, options.observedMutableIdsByRank || {});
      observedFlowIds = stringArray([...prior.observedFlowIds, ...(options.observedFlowIds || [])]);
    } catch (_error) {
      return { status: 'invalid_update', written: false, hold: clone(prior) };
    }
    const hold = {
      ...prior, state,
      eventId: options.eventId === undefined ? prior.eventId : options.eventId,
      currentRevisionId: options.currentRevisionId === undefined ? prior.currentRevisionId : options.currentRevisionId,
      updatedAt: now, releaseConditions: conditions, lastCoordinatorResult: result, retry,
      observedMutableIdsByRevision, observedMutableIdsByRank, observedFlowIds,
    };
    loaded.document.holds[holdId] = hold; loaded.document.updatedAt = now;
    try { const saved = await persist(paths, loaded.document, options); return { status: 'hold_updated', written: true, hold: clone(saved.holds[holdId]) }; }
    catch (_error) { return { status: 'atomic_replace_failed', written: false, hold: clone(prior) }; }
  });
}

async function resolveMarketplaceDiscoveryCursors(options = {}) {
  const input = cursorSnapshot(options.cursorInputSnapshot);
  const output = cursorSnapshot(options.cursorOutputSnapshot);
  if (options.holdWriteSucceeded === false) return { status: 'hold_write_failed', cursorSnapshot: input };
  let holds = options.holds;
  if (!Array.isArray(holds)) {
    const loaded = await loadMarketplacePublicationHolds(options);
    if (loaded.status !== 'loaded' && loaded.status !== 'missing') return { status: loaded.status, cursorSnapshot: input };
    holds = Object.values(loaded.document?.holds || {});
  }
  const market = options.market;
  const kinds = new Set(options.kinds || (market === 'GM' ? ['trade','asset_flow'] : ['trade']));
  const relevant = holds.filter((hold) => hold.market === market && kinds.has(hold.kind));
  const active = relevant.filter((hold) => ACTIVE_STATES.has(hold.state));
  if (active.length) {
    const ordered = [...active].sort((left, right) => compare(left.firstSeenAt, right.firstSeenAt) || compare(left.holdId, right.holdId));
    return { status: 'held', cursorSnapshot: clone(ordered[0].cursorInputSnapshot), activeHoldIds: ordered.map((hold) => hold.holdId).sort(compare) };
  }
  const released = relevant.filter((hold) => hold.state === 'released').sort((left, right) => compare(right.updatedAt, left.updatedAt) || compare(left.holdId, right.holdId));
  const resolved = options.cursorOutputSnapshot === undefined && released.length
    ? clone(released[0].cursorOutputSnapshot) : clone(output);
  if (Number(options.transactionMisses || 0) > 0) resolved.walletCursors = clone(input.walletCursors);
  return { status: Number(options.transactionMisses || 0) > 0 ? 'transaction_misses' : 'released', cursorSnapshot: resolved, activeHoldIds: [] };
}

async function listMarketplaceReconciliationWork(options = {}) {
  const loaded = await loadMarketplacePublicationHolds(options);
  if (loaded.status !== 'loaded' && loaded.status !== 'missing') return { status: loaded.status, work: [] };
  const work = Object.values(loaded.document?.holds || {}).filter((hold) => RECONCILIATION_STATES.has(hold.state)).sort((a, b) => compare(a.holdId, b.holdId)).map((hold) => ({
    holdId: hold.holdId, market: hold.market, kind: hold.kind,
    logicalKeyOrSourceId: hold.logicalKeyOrSourceId,
    eventId: hold.eventId, currentRevisionId: hold.currentRevisionId, state: hold.state,
    candidateSnapshot: clone(hold.candidateSnapshot),
    lastCoordinatorResult: clone(hold.lastCoordinatorResult), retry: clone(hold.retry),
  }));
  return { status: 'ok', work };
}

async function releaseMarketplacePublicationHold(options = {}) {
  const holdId = String(options.holdId || '');
  if (!/^[a-f0-9]{64}$/.test(holdId)) return { status: 'invalid_hold_id', written: false, hold: null };
  let now; try { now = nowValue(options.now); } catch (_error) { return { status: 'invalid_timestamp', written: false, hold: null }; }
  return locked(options, async ({ loaded, paths }) => {
    if (loaded.status !== 'loaded') return { status: loaded.status, written: false, hold: null };
    const prior = loaded.document.holds[holdId]; if (!prior) return { status: 'hold_not_found', written: false, hold: null };
    if (!CONDITION_KEYS.every((key) => prior.releaseConditions[key] === true)) return { status: 'release_conditions_not_met', written: false, hold: clone(prior) };
    const hold = { ...prior, state: 'released', updatedAt: now };
    loaded.document.holds[holdId] = hold; loaded.document.updatedAt = now;
    try { const saved = await persist(paths, loaded.document, options); return { status: 'released', written: true, hold: clone(saved.holds[holdId]) }; }
    catch (_error) { return { status: 'atomic_replace_failed', written: false, hold: clone(prior) }; }
  });
}

async function completeMarketplacePublicationHold(options = {}) {
  if (options.checkpointWritten !== true) return { status: 'checkpoint_not_durable', written: false, hold: null };
  const updated = await updateMarketplacePublicationHold({ ...options, releaseConditions: { currentRevisionPublished: options.currentRevisionPublished === true, mutableIdsRecorded: options.mutableIdsRecorded === true, reconciliationClear: options.reconciliationClear === true } });
  if (updated.status !== 'hold_updated') return updated;
  return releaseMarketplacePublicationHold(options);
}

module.exports = {
  loadMarketplacePublicationHolds,
  recordMarketplacePublicationHold,
  updateMarketplacePublicationHold,
  resolveMarketplaceDiscoveryCursors,
  listMarketplaceReconciliationWork,
  releaseMarketplacePublicationHold,
  completeMarketplacePublicationHold,
};
