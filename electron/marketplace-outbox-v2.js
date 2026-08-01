'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const properLockfile = require('proper-lockfile');
const { writeJsonAtomic } = require('./atomic-json');
const { projectMarketplaceRevision } = require('./marketplace-v2-point');
const { formatAssetFlowInfluxLine } = require('./marketplace-asset-flow');

const MARKETPLACE_OUTBOX_V2_SCHEMA_VERSION = 2;
const MARKETPLACE_OUTBOX_V2_DIRECTORY = ['marketplace', 'outbox-v2'].join('-');
const MARKETPLACE_OUTBOX_V2_LOCK_OPTIONS = Object.freeze({
  stale: 30000,
  update: 10000,
  retries: Object.freeze({ retries: 50, factor: 1.2, minTimeout: 10, maxTimeout: 100, randomize: false }),
  realpath: false,
});
const HEX_64 = /^[a-f0-9]{64}$/;
const PROFILE = /^[A-Za-z0-9._-]{1,64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_DESTINATION_VALUE_BYTES = 1024;
const MARKETPLACE_OUTBOX_V2_EVENT_TYPES = Object.freeze(['trade', 'asset_flow']);
const MARKETPLACE_OUTBOX_V2_REVISION_STATES = Object.freeze([
  'pending', 'posting', 'published', 'superseded_pending', 'superseded_published', 'failed_retryable',
]);
const MARKETPLACE_OUTBOX_V2_LIMITS = Object.freeze({
  maximumDocumentBytes: 134217728, maximumGenerations: 64, maximumEventsPerGeneration: 100000,
  maximumTradeRevisions: 2, maximumAssetFlowRevisions: 1, maximumLineBytes: 8192,
  maximumFailureCodeBytes: 64, maximumPendingListResult: 16000,
});
const MARKETPLACE_OUTBOX_V2_RETRY_POLICY = Object.freeze({ baseMs: 1000, factor: 2, maximumMs: 3600000, jitter: false });
const DOCUMENT_KEYS = Object.freeze([
  'schemaVersion', 'installationId', 'applicationProfile', 'documentRevision',
  'nextGenerationSequence', 'activeGenerationId', 'generations',
]);
const GENERATION_KEYS = Object.freeze([
  'generationId', 'generationFingerprint', 'generationSequence', 'mode',
  'createdAt', 'updatedAt', 'destination', 'events',
]);
const DESTINATION_KEYS = Object.freeze([
  'baseUrl', 'bucket', 'organizationHash', 'destinationHash', 'state',
]);
const TRADE_EVENT_KEYS = Object.freeze([
  'eventId', 'eventType', 'identityHash', 'tradeId', 'identity', 'pointTimestampNs',
  'currentRevisionId', 'createdAt', 'updatedAt', 'revisions',
]);
const ASSET_FLOW_EVENT_KEYS = Object.freeze([
  'eventId', 'eventType', 'identityHash', 'flowId', 'pointTimestampNs',
  'currentRevisionId', 'createdAt', 'updatedAt', 'revisions',
]);
const TRADE_IDENTITY_KEYS = Object.freeze([
  'market', 'faction', 'profileScope', 'executionSignature', 'rawMint', 'side', 'canonicalQuantity',
]);
const REVISION_KEYS = Object.freeze([
  'revisionId', 'revisionKind', 'sourceVersion', 'payloadHash', 'payload', 'state', 'createdAt', 'updatedAt',
  'supersededAt', 'publishedAt', 'retryCount', 'nextAttemptAt', 'attemptSequence', 'activeAttempt',
  'lastCompletedAttempt', 'lastFailure',
]);
const queues = new Map();

class MarketplaceOutboxV2Error extends Error {
  constructor(code) {
    super(code);
    this.name = 'MarketplaceOutboxV2Error';
    this.code = code;
  }
}
function fail(code) { throw new MarketplaceOutboxV2Error(code); }
function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function hashTuple(tuple) { return sha256(JSON.stringify(tuple)); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function compareCodeUnits(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort(compareCodeUnits);
  const wanted = Array.from(expected).sort(compareCodeUnits);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(code);
}
function canonicalIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid_timestamp');
  return value;
}
function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now;
  return canonicalIso(value || new Date().toISOString());
}
function boundedTrimmed(value, code) {
  if (typeof value !== 'string') fail(code);
  const result = value.trim();
  if (!result || Buffer.byteLength(result, 'utf8') > MAX_DESTINATION_VALUE_BYTES || CONTROL.test(result)) fail(code);
  return result;
}

function validateMarketplaceInstallationId(value) {
  if (typeof value !== 'string' || !HEX_64.test(value)) fail('invalid_installation_id');
  return value;
}
function validateMarketplaceApplicationProfile(value) {
  if (typeof value !== 'string' || !PROFILE.test(value)) fail('invalid_application_profile');
  return value;
}
function canonicalizeMarketplaceInfluxBaseUrl(value) {
  const raw = boundedTrimmed(value, 'invalid_base_url');
  let url;
  try { url = new URL(raw); } catch (_error) { fail('invalid_base_url'); }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) fail('invalid_base_url');
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) url.port = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname === '/') pathname = '';
  return `${url.protocol}//${url.host}${pathname}`;
}
function deriveMarketplaceOrganizationHash(organization) {
  return hashTuple(['msa-influx-organization:v2', boundedTrimmed(organization, 'invalid_organization')]);
}
function canonicalizeMarketplaceDestination({ baseUrl, bucket, organization, organizationHash } = {}) {
  const canonicalBaseUrl = canonicalizeMarketplaceInfluxBaseUrl(baseUrl);
  const canonicalBucket = boundedTrimmed(bucket, 'invalid_bucket');
  let resolvedOrganizationHash = null;
  if (organization !== undefined && organization !== null) resolvedOrganizationHash = deriveMarketplaceOrganizationHash(organization);
  else if (organizationHash !== undefined && organizationHash !== null) {
    if (typeof organizationHash !== 'string' || !HEX_64.test(organizationHash)) fail('invalid_organization_hash');
    resolvedOrganizationHash = organizationHash;
  }
  return { baseUrl: canonicalBaseUrl, bucket: canonicalBucket, organizationHash: resolvedOrganizationHash };
}
function deriveMarketplaceDestinationHash(destination) {
  const canonical = canonicalizeMarketplaceDestination(destination);
  return hashTuple(['msa-influx-destination:v2', canonical.baseUrl, canonical.bucket, canonical.organizationHash]);
}
function deriveMarketplaceGenerationFingerprint({ installationId, applicationProfile, baseUrl, bucket } = {}) {
  return hashTuple([
    'msa-marketplace-generation-scope:v2',
    validateMarketplaceInstallationId(installationId),
    validateMarketplaceApplicationProfile(applicationProfile),
    canonicalizeMarketplaceInfluxBaseUrl(baseUrl),
    boundedTrimmed(bucket, 'invalid_bucket'),
  ]);
}
function deriveMarketplaceGenerationId({ generationFingerprint, generationSequence } = {}) {
  if (typeof generationFingerprint !== 'string' || !HEX_64.test(generationFingerprint)) fail('invalid_generation_fingerprint');
  if (!Number.isSafeInteger(generationSequence) || generationSequence < 1) fail('invalid_generation_sequence');
  return hashTuple(['msa-marketplace-generation:v2', generationFingerprint, generationSequence]);
}
function validHash(value, code) { if (typeof value !== 'string' || !HEX_64.test(value)) fail(code); return value; }
function deriveMarketplaceAssetFlowIdentityHash(flowId) {
  const value = boundedTrimmed(flowId, 'invalid_flow_id');
  return hashTuple(['msa-marketplace-asset-flow-identity:v2', value]);
}
function deriveMarketplaceOutboxV2EventId({ generationId, eventType, identityHash } = {}) {
  validHash(generationId, 'invalid_generation_id');
  if (!MARKETPLACE_OUTBOX_V2_EVENT_TYPES.includes(eventType)) fail('invalid_event_type');
  validHash(identityHash, 'invalid_identity_hash');
  return hashTuple([['msa-marketplace', 'outbox-event:v2'].join('-'), generationId, eventType, identityHash]);
}
function deriveMarketplaceOutboxV2PayloadHash(line) {
  if (typeof line !== 'string' || !line || Buffer.byteLength(line, 'utf8') > MARKETPLACE_OUTBOX_V2_LIMITS.maximumLineBytes || CONTROL.test(line)) fail('invalid_payload');
  return hashTuple([['msa-marketplace', 'outbox-payload:v2'].join('-'), 'influx_line', line]);
}
function deriveMarketplaceOutboxV2RevisionId({ eventId, revisionKind, sourceVersion, payloadHash } = {}) {
  validHash(eventId, 'invalid_event_id'); validHash(payloadHash, 'invalid_payload_hash');
  boundedTrimmed(revisionKind, 'invalid_revision_kind'); boundedTrimmed(sourceVersion, 'invalid_source_version');
  return hashTuple([['msa-marketplace', 'outbox-revision:v2'].join('-'), eventId, revisionKind, sourceVersion, payloadHash]);
}
function deriveMarketplaceOutboxV2AttemptId({ generationId, eventId, revisionId, attemptSequence } = {}) {
  validHash(generationId, 'invalid_generation_id'); validHash(eventId, 'invalid_event_id'); validHash(revisionId, 'invalid_revision_id');
  if (!Number.isSafeInteger(attemptSequence) || attemptSequence < 1) fail('invalid_attempt_sequence');
  return hashTuple([['msa-marketplace', 'outbox-attempt:v2'].join('-'), generationId, eventId, revisionId, attemptSequence]);
}
function resolveMarketplaceOutboxV2Paths({ storageRoot, installationId, applicationProfile } = {}) {
  if (typeof storageRoot !== 'string' || !storageRoot || !path.isAbsolute(storageRoot)) fail('invalid_storage_root');
  const id = validateMarketplaceInstallationId(installationId);
  const profile = validateMarketplaceApplicationProfile(applicationProfile);
  const directoryPath = path.resolve(storageRoot, MARKETPLACE_OUTBOX_V2_DIRECTORY);
  const documentPath = path.join(directoryPath, `${profile}.${id}.json`);
  return { directoryPath, documentPath, lockPath: `${documentPath}.lock-target` };
}

function destinationRecord(destination) {
  const canonical = canonicalizeMarketplaceDestination(destination);
  return {
    baseUrl: canonical.baseUrl,
    bucket: canonical.bucket,
    organizationHash: canonical.organizationHash,
    destinationHash: deriveMarketplaceDestinationHash(canonical),
    state: canonical.organizationHash === null ? 'provisional' : 'finalized',
  };
}
function createGeneration({ installationId, applicationProfile, sequence, now, destination }) {
  const generationFingerprint = deriveMarketplaceGenerationFingerprint({
    installationId, applicationProfile, baseUrl: destination.baseUrl, bucket: destination.bucket,
  });
  const generationId = deriveMarketplaceGenerationId({ generationFingerprint, generationSequence: sequence });
  return {
    generationId,
    generationFingerprint,
    generationSequence: sequence,
    mode: 'active',
    createdAt: now,
    updatedAt: now,
    destination: destinationRecord(destination),
    events: {},
  };
}
function createMarketplaceOutboxV2Document({ installationId, applicationProfile, destination, now } = {}) {
  const id = validateMarketplaceInstallationId(installationId);
  const profile = validateMarketplaceApplicationProfile(applicationProfile);
  const timestamp = resolveNow(now);
  const generation = createGeneration({ installationId: id, applicationProfile: profile, sequence: 1, now: timestamp, destination });
  return {
    schemaVersion: MARKETPLACE_OUTBOX_V2_SCHEMA_VERSION,
    installationId: id,
    applicationProfile: profile,
    documentRevision: 1,
    nextGenerationSequence: 2,
    activeGenerationId: generation.generationId,
    generations: { [generation.generationId]: generation },
  };
}

function validateDestination(destination) {
  exactKeys(destination, DESTINATION_KEYS, 'invalid_destination');
  const canonical = destinationRecord(destination);
  if (JSON.stringify(destination) !== JSON.stringify(canonical)) fail('invalid_destination');
  return destination;
}
function nullableIso(value, code = 'invalid_timestamp') { if (value !== null) { try { canonicalIso(value); } catch (_error) { fail(code); } } }
function validateMarketplaceOutboxV2Revision(revision, eventType, eventId) {
  exactKeys(revision, REVISION_KEYS, 'invalid_revision');
  validHash(revision.revisionId, 'invalid_revision_id'); validHash(revision.payloadHash, 'invalid_payload_hash');
  const allowed = eventType === 'trade'
    ? ((revision.revisionKind === 'fallback' && ['fallback_v1', 'fallback_v2'].includes(revision.sourceVersion))
      || (revision.revisionKind === 'enriched' && ['enriched_v1', 'enriched_v2'].includes(revision.sourceVersion)))
    : revision.revisionKind === 'asset_flow' && revision.sourceVersion === 'asset_flow_v1';
  if (!allowed) fail('invalid_revision_kind');
  exactKeys(revision.payload, ['kind', 'line'], 'invalid_payload');
  if (revision.payload.kind !== 'influx_line' || deriveMarketplaceOutboxV2PayloadHash(revision.payload.line) !== revision.payloadHash) fail('invalid_payload');
  if (deriveMarketplaceOutboxV2RevisionId({ eventId, revisionKind: revision.revisionKind, sourceVersion: revision.sourceVersion, payloadHash: revision.payloadHash }) !== revision.revisionId) fail('invalid_revision_id');
  if (!MARKETPLACE_OUTBOX_V2_REVISION_STATES.includes(revision.state)) fail('invalid_state');
  canonicalIso(revision.createdAt); canonicalIso(revision.updatedAt); nullableIso(revision.supersededAt); nullableIso(revision.publishedAt);
  if (!Number.isSafeInteger(revision.retryCount) || revision.retryCount < 0 || !Number.isSafeInteger(revision.attemptSequence) || revision.attemptSequence < 0) fail('invalid_attempt_sequence');
  nullableIso(revision.nextAttemptAt);
  if (revision.activeAttempt !== null) {
    exactKeys(revision.activeAttempt, ['attemptId', 'attemptSequence', 'claimedAt'], 'invalid_attempt');
    validHash(revision.activeAttempt.attemptId, 'invalid_attempt_id'); canonicalIso(revision.activeAttempt.claimedAt);
    if (revision.activeAttempt.attemptSequence !== revision.attemptSequence) fail('invalid_attempt');
  }
  if (revision.lastCompletedAttempt !== null) {
    exactKeys(revision.lastCompletedAttempt, ['attemptId', 'outcome'], 'invalid_completed_attempt');
    validHash(revision.lastCompletedAttempt.attemptId, 'invalid_attempt_id');
    if (!['published', 'failed'].includes(revision.lastCompletedAttempt.outcome)) fail('invalid_completed_attempt');
  }
  if (revision.lastFailure !== null) {
    exactKeys(revision.lastFailure, ['code', 'httpStatus', 'failedAt'], 'invalid_failure');
    if (typeof revision.lastFailure.code !== 'string' || !revision.lastFailure.code || Buffer.byteLength(revision.lastFailure.code, 'utf8') > MARKETPLACE_OUTBOX_V2_LIMITS.maximumFailureCodeBytes || CONTROL.test(revision.lastFailure.code)) fail('invalid_failure');
    if (revision.lastFailure.httpStatus !== null && (!Number.isInteger(revision.lastFailure.httpStatus) || revision.lastFailure.httpStatus < 100 || revision.lastFailure.httpStatus > 599)) fail('invalid_failure');
    canonicalIso(revision.lastFailure.failedAt);
  }
  if ((revision.state === 'posting') !== (revision.activeAttempt !== null)) fail('invalid_attempt');
  if (['published', 'superseded_published'].includes(revision.state)
    && (revision.publishedAt === null || revision.lastCompletedAttempt?.outcome !== 'published')) fail('invalid_state');
  if (revision.state === 'failed_retryable'
    && (revision.nextAttemptAt === null || revision.lastFailure === null || revision.lastCompletedAttempt?.outcome !== 'failed')) fail('invalid_state');
  if (revision.state.startsWith('superseded_') && revision.supersededAt === null) fail('invalid_state');
  return revision;
}
function validateMarketplaceOutboxV2Event(event, objectKey, generationId) {
  if (!event || !MARKETPLACE_OUTBOX_V2_EVENT_TYPES.includes(event.eventType)) fail('invalid_event');
  exactKeys(event, event.eventType === 'trade' ? TRADE_EVENT_KEYS : ASSET_FLOW_EVENT_KEYS, 'invalid_event');
  if (event.eventId !== objectKey) fail('invalid_event_id'); validHash(event.identityHash, 'invalid_identity_hash');
  if (deriveMarketplaceOutboxV2EventId({ generationId, eventType: event.eventType, identityHash: event.identityHash }) !== event.eventId) fail('invalid_event_id');
  canonicalIso(event.createdAt); canonicalIso(event.updatedAt);
  if (typeof event.pointTimestampNs !== 'string' || !/^\d+$/.test(event.pointTimestampNs)) fail('invalid_point_timestamp');
  if (event.eventType === 'trade') {
    if (event.tradeId !== event.identityHash) fail('invalid_trade_id');
    exactKeys(event.identity, TRADE_IDENTITY_KEYS, 'invalid_trade_identity');
    if (Object.values(event.identity).some((value) => typeof value !== 'string')) fail('invalid_trade_identity');
  } else if (typeof event.flowId !== 'string' || deriveMarketplaceAssetFlowIdentityHash(event.flowId) !== event.identityHash) fail('invalid_flow_id');
  if (!event.revisions || typeof event.revisions !== 'object' || Array.isArray(event.revisions)) fail('invalid_revisions');
  const revisions = Object.entries(event.revisions);
  const maximum = event.eventType === 'trade' ? MARKETPLACE_OUTBOX_V2_LIMITS.maximumTradeRevisions : MARKETPLACE_OUTBOX_V2_LIMITS.maximumAssetFlowRevisions;
  if (!revisions.length || revisions.length > maximum) fail('invalid_revisions');
  const ranks = new Set();
  for (const [revisionId, revision] of revisions) {
    if (revision.revisionId !== revisionId) fail('invalid_revision_id');
    validateMarketplaceOutboxV2Revision(revision, event.eventType, event.eventId);
    if (ranks.has(revision.revisionKind)) fail('invalid_revisions'); ranks.add(revision.revisionKind);
  }
  if (!event.revisions[event.currentRevisionId]) fail('invalid_current_revision');
  if (event.eventType === 'trade' && ranks.has('enriched') && event.revisions[event.currentRevisionId].revisionKind !== 'enriched') fail('invalid_current_revision');
  return event;
}
function validateGeneration(generation, objectKey, root) {
  exactKeys(generation, GENERATION_KEYS, 'invalid_generation');
  if (!HEX_64.test(objectKey) || generation.generationId !== objectKey) fail('invalid_generation_id');
  if (!HEX_64.test(generation.generationFingerprint)) fail('invalid_generation_fingerprint');
  if (!Number.isSafeInteger(generation.generationSequence) || generation.generationSequence < 1) fail('invalid_generation_sequence');
  if (generation.mode !== 'active' && generation.mode !== 'published_only') fail('invalid_generation_mode');
  canonicalIso(generation.createdAt); canonicalIso(generation.updatedAt);
  validateDestination(generation.destination);
  const expectedFingerprint = deriveMarketplaceGenerationFingerprint({
    installationId: root.installationId, applicationProfile: root.applicationProfile,
    baseUrl: generation.destination.baseUrl, bucket: generation.destination.bucket,
  });
  if (generation.generationFingerprint !== expectedFingerprint) fail('generation_fingerprint_mismatch');
  if (deriveMarketplaceGenerationId({ generationFingerprint: expectedFingerprint, generationSequence: generation.generationSequence }) !== generation.generationId) fail('generation_id_mismatch');
  if (!generation.events || typeof generation.events !== 'object' || Array.isArray(generation.events)) fail('invalid_events');
  if (Object.keys(generation.events).length > MARKETPLACE_OUTBOX_V2_LIMITS.maximumEventsPerGeneration) fail('event_capacity');
  for (const [eventId, event] of Object.entries(generation.events)) validateMarketplaceOutboxV2Event(event, eventId, generation.generationId);
  return generation;
}
function validateMarketplaceOutboxV2Document(document, expectedIdentity = {}) {
  exactKeys(document, DOCUMENT_KEYS, 'invalid_document');
  if (!Number.isSafeInteger(document.schemaVersion)) fail('invalid_schema_version');
  if (document.schemaVersion !== MARKETPLACE_OUTBOX_V2_SCHEMA_VERSION) fail('unsupported_version');
  validateMarketplaceInstallationId(document.installationId);
  validateMarketplaceApplicationProfile(document.applicationProfile);
  if (expectedIdentity.installationId !== undefined && document.installationId !== expectedIdentity.installationId) fail('identity_mismatch');
  if (expectedIdentity.applicationProfile !== undefined && document.applicationProfile !== expectedIdentity.applicationProfile) fail('identity_mismatch');
  if (!Number.isSafeInteger(document.documentRevision) || document.documentRevision < 1) fail('invalid_document_revision');
  if (!Number.isSafeInteger(document.nextGenerationSequence) || document.nextGenerationSequence < 2) fail('invalid_generation_sequence');
  if (document.activeGenerationId !== null && !HEX_64.test(String(document.activeGenerationId))) fail('invalid_active_generation');
  if (!document.generations || typeof document.generations !== 'object' || Array.isArray(document.generations)) fail('invalid_generations');
  const generations = Object.entries(document.generations);
  if (!generations.length) fail('invalid_generations');
  if (generations.length > MARKETPLACE_OUTBOX_V2_LIMITS.maximumGenerations) fail('generation_capacity');
  const sequences = new Set();
  let activeCount = 0;
  let maximumSequence = 0;
  for (const [generationId, generation] of generations) {
    validateGeneration(generation, generationId, document);
    if (sequences.has(generation.generationSequence)) fail('duplicate_generation_sequence');
    sequences.add(generation.generationSequence);
    maximumSequence = Math.max(maximumSequence, generation.generationSequence);
    if (generation.mode === 'active') activeCount += 1;
  }
  if (activeCount > 1) fail('multiple_active_generations');
  if ((activeCount === 0) !== (document.activeGenerationId === null)) fail('active_generation_mismatch');
  if (activeCount === 1 && document.generations[document.activeGenerationId]?.mode !== 'active') fail('active_generation_mismatch');
  if (document.nextGenerationSequence !== maximumSequence + 1) fail('invalid_generation_sequence');
  return document;
}
function canonicalDocument(document) {
  const generations = Object.fromEntries(Object.entries(document.generations).sort(([a], [b]) => compareCodeUnits(a, b)));
  return {
    schemaVersion: document.schemaVersion,
    installationId: document.installationId,
    applicationProfile: document.applicationProfile,
    documentRevision: document.documentRevision,
    nextGenerationSequence: document.nextGenerationSequence,
    activeGenerationId: document.activeGenerationId,
    generations,
  };
}

function queueFor(filePath, callback) {
  const prior = queues.get(filePath) || Promise.resolve();
  const next = prior.catch(() => undefined).then(callback);
  const tracked = next.finally(() => { if (queues.get(filePath) === tracked) queues.delete(filePath); });
  tracked.catch(() => undefined);
  queues.set(filePath, tracked);
  return next;
}
async function ensureLockTarget(paths, fsAdapter) {
  await fsAdapter.mkdir(paths.directoryPath, { recursive: true });
  const handle = await fsAdapter.open(paths.lockPath, 'a', 0o600);
  await handle.close();
}
async function acquireLock(paths, fsAdapter, lockAdapter) {
  await ensureLockTarget(paths, fsAdapter);
  if (lockAdapter) return lockAdapter(paths.lockPath, MARKETPLACE_OUTBOX_V2_LOCK_OPTIONS);
  try { return await properLockfile.lock(paths.lockPath, MARKETPLACE_OUTBOX_V2_LOCK_OPTIONS); }
  catch (_error) { fail('lock_failed'); }
}
function statusForError(error) {
  const known = new Set([
    'unsupported_version', 'identity_mismatch', 'multiple_active_generations',
    'event_schema_not_enabled', 'generation_fingerprint_mismatch', 'generation_id_mismatch',
  ]);
  return known.has(error?.code) ? error.code : 'invalid_document';
}
async function readDocument(paths, identity, fsAdapter) {
  let text;
  try { text = await fsAdapter.readFile(paths.documentPath, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing', document: null };
    return { status: 'read_failed', document: null };
  }
  if (Buffer.byteLength(text, 'utf8') > MARKETPLACE_OUTBOX_V2_LIMITS.maximumDocumentBytes) return { status: 'document_capacity', document: null };
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (_error) { return { status: 'corrupt_json', document: null };
  }
  if (Number.isSafeInteger(parsed?.schemaVersion) && parsed.schemaVersion !== MARKETPLACE_OUTBOX_V2_SCHEMA_VERSION) {
    return { status: 'unsupported_version', document: null };
  }
  try {
    validateMarketplaceOutboxV2Document(parsed, identity);
    return { status: 'loaded', document: canonicalDocument(parsed) };
  } catch (error) {
    return { status: statusForError(error), document: error?.code === 'event_schema_not_enabled' ? parsed : null };
  }
}
function operationOptions(options) {
  const paths = resolveMarketplaceOutboxV2Paths(options);
  return { paths, identity: { installationId: options.installationId, applicationProfile: options.applicationProfile } };
}
async function withLockedDocument(options, callback) {
  const fsAdapter = options.fsAdapter || fs;
  const { paths, identity } = operationOptions(options);
  return queueFor(paths.documentPath, async () => {
    let release;
    try {
      release = await acquireLock(paths, fsAdapter, options.lockAdapter);
      const loaded = await readDocument(paths, identity, fsAdapter);
      return await callback({ loaded, paths, fsAdapter, identity });
    } catch (error) {
      if (error instanceof MarketplaceOutboxV2Error) return { status: error.code, written: false };
      return { status: 'mutation_failed', written: false };
    } finally {
      if (release) {
        try { await Promise.resolve(release()); } catch (_error) { /* Mutation result is authoritative. */ }
      }
    }
  });
}
async function loadMarketplaceOutboxV2(options = {}) {
  return withLockedDocument(options, async ({ loaded }) => ({ ...loaded, document: clone(loaded.document) }));
}
async function mutateInternal(options, mutator, { inspectUnsupportedEvents = false } = {}) {
  if (typeof mutator !== 'function') return { status: 'invalid_mutator', written: false };
  return withLockedDocument(options, async ({ loaded, paths }) => {
    const inspectableEvents = inspectUnsupportedEvents && loaded.status === 'event_schema_not_enabled' && loaded.document;
    if (loaded.status !== 'loaded' && loaded.status !== 'missing' && !inspectableEvents) return { ...loaded, written: false };
    if (inspectableEvents) return mutator(clone(loaded.document), loaded.status);
    let mutation;
    try { mutation = await mutator(clone(loaded.document), loaded.status); }
    catch (error) { return { status: error?.code || 'mutation_failed', written: false };
    }
    if (!mutation || typeof mutation !== 'object' || typeof mutation.status !== 'string') return { status: 'invalid_mutation', written: false };
    if (!mutation.changed) return { status: mutation.status, written: false, document: clone(loaded.document), ...(mutation.result || {}) };
    const expectedRevision = loaded.status === 'missing' ? 1 : loaded.document.documentRevision + 1;
    if (mutation.document?.documentRevision !== expectedRevision) return { status: 'invalid_document_revision', written: false };
    const document = canonicalDocument(mutation.document);
    try { validateMarketplaceOutboxV2Document(document, { installationId: options.installationId, applicationProfile: options.applicationProfile }); }
    catch (error) { return { status: error?.code || 'invalid_document', written: false };
    }
    if (Buffer.byteLength(`${JSON.stringify(document, null, 2)}\n`, 'utf8') > MARKETPLACE_OUTBOX_V2_LIMITS.maximumDocumentBytes) {
      return { status: 'document_capacity', written: false };
    }
    try { await writeJsonAtomic(paths.documentPath, document, options.writeHooks || {}); }
    catch (_error) { return { status: 'atomic_replace_failed', written: false };
    }
    return { status: mutation.status, written: true, document: clone(document), ...(mutation.result || {}) };
  });
}
async function mutateMarketplaceOutboxV2(options = {}, mutator) {
  return mutateInternal(options, mutator);
}

function configuredInput(options, requireOrganization = false) {
  if (!options.baseUrl || !options.bucket || options.authConfigured !== true || (requireOrganization && !options.organization)) return null;
  return canonicalizeMarketplaceDestination({ baseUrl: options.baseUrl, bucket: options.bucket, organization: options.organization });
}
function activeGeneration(document) {
  return document?.activeGenerationId ? document.generations[document.activeGenerationId] : null;
}
function sameScope(generation, destination) {
  return generation.destination.baseUrl === destination.baseUrl && generation.destination.bucket === destination.bucket;
}
function hasAnyEvents(document) {
  return Object.values(document?.generations || {}).some((generation) => Object.keys(generation?.events || {}).length > 0);
}
async function configureMarketplaceOutboxV2Destination(options = {}) {
  let destination;
  try { destination = configuredInput(options); }
  catch (error) { return { status: error.code || 'not_configured', written: false };
  }
  if (!destination) return { status: 'not_configured', written: false };
  return mutateInternal(options, (document, loadStatus) => {
    if (loadStatus === 'event_schema_not_enabled') {
      return { status: hasAnyEvents(document) ? 'destination_change_blocked' : 'event_schema_not_enabled', written: false };
    }
    const now = resolveNow(options.now);
    if (loadStatus === 'missing') {
      const created = createMarketplaceOutboxV2Document({
        installationId: options.installationId, applicationProfile: options.applicationProfile,
        destination, now,
      });
      return { changed: true, status: destination.organizationHash ? 'configured_finalized' : 'configured_provisional', document: created };
    }
    const current = activeGeneration(document);
    if (current && sameScope(current, destination)) {
      if (destination.organizationHash && current.destination.organizationHash && destination.organizationHash !== current.destination.organizationHash) {
        return { changed: false, status: 'destination_mismatch' };
      }
      if (destination.organizationHash && current.destination.organizationHash === null) return { changed: false, status: 'finalization_required' };
      return { changed: false, status: 'destination_unchanged' };
    }
    if (hasAnyEvents(document)) return { changed: false, status: 'destination_change_blocked' };
    if (current) {
      current.mode = 'published_only';
      current.updatedAt = now;
    }
    const sequence = document.nextGenerationSequence;
    const generation = createGeneration({
      installationId: document.installationId, applicationProfile: document.applicationProfile,
      sequence, now, destination,
    });
    document.generations[generation.generationId] = generation;
    document.activeGenerationId = generation.generationId;
    document.nextGenerationSequence += 1;
    document.documentRevision += 1;
    return { changed: true, status: 'destination_replaced', document };
  }, { inspectUnsupportedEvents: true });
}
async function finalizeMarketplaceOutboxV2Organization(options = {}) {
  let destination;
  try { destination = configuredInput(options, true); }
  catch (error) { return { status: error.code || 'not_configured', written: false };
  }
  if (!destination) return { status: 'not_configured', written: false };
  return mutateMarketplaceOutboxV2(options, (document, loadStatus) => {
    if (loadStatus === 'missing') return { changed: false, status: 'missing' };
    const current = activeGeneration(document);
    if (!current || !sameScope(current, destination)) return { changed: false, status: 'destination_mismatch' };
    if (current.destination.organizationHash !== null) {
      return { changed: false, status: current.destination.organizationHash === destination.organizationHash
        ? 'organization_already_finalized' : 'destination_mismatch' };
    }
    const now = resolveNow(options.now);
    current.destination = destinationRecord(destination);
    current.updatedAt = now;
    document.documentRevision += 1;
    return { changed: true, status: 'organization_finalized', document };
  });
}
async function setMarketplaceOutboxV2PublishedOnly(options = {}) {
  return mutateMarketplaceOutboxV2(options, (document, loadStatus) => {
    if (loadStatus === 'missing') return { changed: false, status: 'missing' };
    const generationId = options.generationId;
    const generation = document.generations[generationId];
    if (!generation) return { changed: false, status: 'generation_missing' };
    if (generation.mode === 'published_only') return { changed: false, status: 'already_published_only' };
    const now = resolveNow(options.now);
    generation.mode = 'published_only';
    generation.updatedAt = now;
    if (document.activeGenerationId === generationId) document.activeGenerationId = null;
    document.documentRevision += 1;
    return { changed: true, status: 'published_only', document };
  });
}
async function verifyMarketplaceOutboxV2Destination(options = {}) {
  let destination;
  try { destination = configuredInput(options); }
  catch (error) { return { status: error.code || 'not_configured' };
  }
  if (!destination) return { status: 'not_configured' };
  const loaded = await loadMarketplaceOutboxV2(options);
  if (loaded.status !== 'loaded') return { status: loaded.status };
  const current = activeGeneration(loaded.document);
  if (!current || !sameScope(current, destination)) return { status: 'destination_mismatch' };
  if (current.destination.organizationHash === null) {
    return { status: destination.organizationHash === null ? 'provisional_match' : 'finalization_required' };
  }
  if (destination.organizationHash === null) return { status: 'runtime_organization_missing' };
  return { status: destination.organizationHash === current.destination.organizationHash ? 'finalized_match' : 'destination_mismatch' };
}

function revisionRecord({ eventId, revisionKind, sourceVersion, line, now }) {
  const payloadHash = deriveMarketplaceOutboxV2PayloadHash(line);
  const revisionId = deriveMarketplaceOutboxV2RevisionId({ eventId, revisionKind, sourceVersion, payloadHash });
  return {
    revisionId, revisionKind, sourceVersion, payloadHash, payload: { kind: 'influx_line', line },
    state: 'pending', createdAt: now, updatedAt: now, supersededAt: null, publishedAt: null,
    retryCount: 0, nextAttemptAt: null, attemptSequence: 0, activeAttempt: null,
    lastCompletedAttempt: null, lastFailure: null,
  };
}
function replayStatus(revision) {
  if (revision.state === 'pending') return 'pending_unattempted';
  if (revision.state === 'superseded_pending') return revision.retryCount > 0 ? 'pending_retryable' : 'pending_unattempted';
  if (revision.state === 'failed_retryable') return 'pending_retryable';
  if (revision.state === 'posting') return 'posting_in_progress';
  return 'already_published';
}
function stageRevisionMutation(document, options, staged) {
  const generation = activeGeneration(document);
  if (!generation) return { changed: false, status: options.generationId && !document.generations[options.generationId] ? 'generation_missing' : 'generation_not_writable' };
  if (options.generationId && options.generationId !== generation.generationId) return { changed: false, status: document.generations[options.generationId] ? 'generation_not_writable' : 'generation_missing' };
  const now = resolveNow(options.now);
  const eventId = deriveMarketplaceOutboxV2EventId({ generationId: generation.generationId, eventType: staged.eventType, identityHash: staged.identityHash });
  const incoming = revisionRecord({ eventId, revisionKind: staged.revisionKind, sourceVersion: staged.sourceVersion, line: staged.line, now });
  const existing = generation.events[eventId];
  if (!existing) {
    if (Object.keys(generation.events).length >= MARKETPLACE_OUTBOX_V2_LIMITS.maximumEventsPerGeneration) return { changed: false, status: 'event_capacity' };
    const event = staged.eventType === 'trade'
      ? { eventId, eventType: 'trade', identityHash: staged.identityHash, tradeId: staged.tradeId, identity: staged.identity,
        pointTimestampNs: staged.pointTimestampNs, currentRevisionId: incoming.revisionId, createdAt: now, updatedAt: now, revisions: { [incoming.revisionId]: incoming } }
      : { eventId, eventType: 'asset_flow', identityHash: staged.identityHash, flowId: staged.flowId,
        pointTimestampNs: staged.pointTimestampNs, currentRevisionId: incoming.revisionId, createdAt: now, updatedAt: now, revisions: { [incoming.revisionId]: incoming } };
    generation.events[eventId] = event; generation.updatedAt = now; document.documentRevision += 1;
    return { changed: true, status: 'staged', document, result: { generationId: generation.generationId, eventId, revisionId: incoming.revisionId } };
  }
  if (existing.pointTimestampNs !== staged.pointTimestampNs || (staged.eventType === 'trade' && JSON.stringify(existing.identity) !== JSON.stringify(staged.identity))) {
    return { changed: false, status: 'identity_conflict' };
  }
  const sameRank = Object.values(existing.revisions).find((revision) => revision.revisionKind === staged.revisionKind);
  if (sameRank) {
    if (sameRank.payloadHash !== incoming.payloadHash || sameRank.sourceVersion !== incoming.sourceVersion) return { changed: false, status: 'identity_conflict' };
    return { changed: false, status: replayStatus(sameRank), result: { generationId: generation.generationId, eventId, revisionId: sameRank.revisionId } };
  }
  if (staged.eventType !== 'trade' || staged.revisionKind === 'fallback') return { changed: false, status: 'older_representation_suppressed' };
  const fallback = Object.values(existing.revisions)[0];
  if (fallback.revisionKind !== 'fallback') return { changed: false, status: 'older_representation_suppressed' };
  fallback.supersededAt = now; fallback.updatedAt = now;
  if (fallback.state === 'pending' || fallback.state === 'failed_retryable') fallback.state = 'superseded_pending';
  else if (fallback.state === 'published') fallback.state = 'superseded_published';
  existing.revisions[incoming.revisionId] = incoming; existing.currentRevisionId = incoming.revisionId; existing.updatedAt = now;
  generation.updatedAt = now; document.documentRevision += 1;
  return { changed: true, status: 'staged_superseding', document, result: { generationId: generation.generationId, eventId, revisionId: incoming.revisionId } };
}
async function stageMarketplaceOutboxV2TradeRevision(options = {}) {
  let projected;
  try { projected = projectMarketplaceRevision({ identity: options.identity, rank: options.revisionKind, fields: options.fields, pointTimestampNs: options.pointTimestampNs }); }
  catch (error) { return { status: error?.code || 'invalid_event', written: false }; }
  if (!['fallback_v1', 'fallback_v2', 'enriched_v1', 'enriched_v2'].includes(options.sourceVersion)
    || !options.sourceVersion.startsWith(`${options.revisionKind}_`)) return { status: 'invalid_revision_kind', written: false };
  return mutateMarketplaceOutboxV2(options, (document, loadStatus) => loadStatus === 'missing'
    ? { changed: false, status: 'generation_missing' }
    : stageRevisionMutation(document, options, { eventType: 'trade', identityHash: projected.tradeId, tradeId: projected.tradeId,
      identity: { market: projected.identity.market, faction: projected.identity.faction, profileScope: projected.identity.profile,
        executionSignature: projected.identity.executionSignature, rawMint: projected.identity.rawMint,
        side: projected.identity.side, canonicalQuantity: projected.identity.canonicalQuantity },
      pointTimestampNs: projected.pointTimestampNs, revisionKind: options.revisionKind,
      sourceVersion: options.sourceVersion, line: projected.line }));
}
async function stageMarketplaceOutboxV2AssetFlow(options = {}) {
  let line, identityHash, pointTimestampNs;
  try {
    line = formatAssetFlowInfluxLine(options.event);
    if (!line) fail('invalid_event');
    identityHash = deriveMarketplaceAssetFlowIdentityHash(options.event?.id);
    pointTimestampNs = line.slice(line.lastIndexOf(' ') + 1);
  } catch (error) { return { status: error?.code || 'invalid_event', written: false }; }
  return mutateMarketplaceOutboxV2(options, (document, loadStatus) => loadStatus === 'missing'
    ? { changed: false, status: 'generation_missing' }
    : stageRevisionMutation(document, options, { eventType: 'asset_flow', identityHash, flowId: options.event.id, pointTimestampNs,
      revisionKind: 'asset_flow', sourceVersion: 'asset_flow_v1', line }));
}
function locate(document, options) {
  const generation = document.generations[options.generationId];
  if (!generation) return { status: 'generation_missing' };
  const event = generation.events[options.eventId]; if (!event) return { status: 'revision_missing' };
  const revision = event.revisions[options.revisionId]; if (!revision) return { status: 'revision_missing' };
  return { generation, event, revision };
}
function eligibilityTime(revision) { return revision.nextAttemptAt || revision.createdAt; }
function eligible(revision, now) {
  if (revision.state === 'pending') return true;
  if (revision.state === 'failed_retryable' || revision.state === 'superseded_pending') return !revision.nextAttemptAt || revision.nextAttemptAt <= now;
  return false;
}
function pendingRows(document, now) {
  const rows = [];
  for (const generation of Object.values(document.generations)) for (const event of Object.values(generation.events)) {
    for (const revision of Object.values(event.revisions)) if (eligible(revision, now)) rows.push({
      generationId: generation.generationId, eventId: event.eventId, revisionId: revision.revisionId,
      eventType: event.eventType, revisionKind: revision.revisionKind, payloadHash: revision.payloadHash,
      payload: clone(revision.payload), state: revision.state, eligibilityTime: eligibilityTime(revision),
    });
  }
  return rows.sort((a, b) => (a.eventId === b.eventId
    ? ({ fallback: 0, enriched: 1 }[a.revisionKind] ?? 0) - ({ fallback: 0, enriched: 1 }[b.revisionKind] ?? 0)
    : compareCodeUnits(a.eligibilityTime, b.eligibilityTime) || compareCodeUnits(a.eventId, b.eventId))
    || compareCodeUnits(a.revisionId, b.revisionId));
}
async function listMarketplaceOutboxV2Pending(options = {}) {
  const loaded = await loadMarketplaceOutboxV2(options); if (loaded.status !== 'loaded') return loaded;
  let now; try { now = resolveNow(options.now); } catch (error) { return { status: error.code }; }
  const requested = options.limit === undefined ? MARKETPLACE_OUTBOX_V2_LIMITS.maximumPendingListResult : options.limit;
  if (!Number.isInteger(requested) || requested < 1 || requested > MARKETPLACE_OUTBOX_V2_LIMITS.maximumPendingListResult) return { status: 'invalid_limit' };
  return { status: 'pending_listed', revisions: pendingRows(loaded.document, now).slice(0, requested) };
}
async function claimMarketplaceOutboxV2Revision(options = {}) {
  return mutateMarketplaceOutboxV2(options, (document, loadStatus) => {
    if (loadStatus === 'missing') return { changed: false, status: 'generation_missing' };
    const found = locate(document, options); if (found.status) return { changed: false, status: found.status };
    const now = resolveNow(options.now); const { generation, revision } = found;
    if ((revision.state === 'failed_retryable' || revision.state === 'superseded_pending') && revision.nextAttemptAt && revision.nextAttemptAt > now) return { changed: false, status: 'not_yet_retryable' };
    if (!eligible(revision, now)) return { changed: false, status: 'invalid_state' };
    if (revision.attemptSequence >= Number.MAX_SAFE_INTEGER) return { changed: false, status: 'attempt_sequence_exhausted' };
    revision.attemptSequence += 1;
    const attemptId = deriveMarketplaceOutboxV2AttemptId({ generationId: generation.generationId, eventId: options.eventId, revisionId: options.revisionId, attemptSequence: revision.attemptSequence });
    revision.state = 'posting'; revision.updatedAt = now; revision.activeAttempt = { attemptId, attemptSequence: revision.attemptSequence, claimedAt: now };
    generation.updatedAt = now; document.documentRevision += 1;
    return { changed: true, status: 'posting_claimed', document, result: { attemptId, attemptSequence: revision.attemptSequence } };
  });
}
function exactAttempt(found, options) {
  return found.revision.state === 'posting' && found.revision.payloadHash === options.payloadHash
    && found.revision.activeAttempt?.attemptId === options.attemptId;
}
async function markMarketplaceOutboxV2Published(options = {}) {
  return mutateMarketplaceOutboxV2(options, (document, loadStatus) => {
    if (loadStatus === 'missing') return { changed: false, status: 'generation_missing' };
    const found = locate(document, options); if (found.status) return { changed: false, status: found.status };
    const { event, revision, generation } = found;
    if (revision.lastCompletedAttempt?.attemptId === options.attemptId && revision.lastCompletedAttempt.outcome === 'published'
      && revision.payloadHash === options.payloadHash) return { changed: false, status: 'already_published' };
    if (!exactAttempt(found, options)) return { changed: false, status: 'attempt_mismatch' };
    const now = resolveNow(options.now); const superseded = event.currentRevisionId !== revision.revisionId;
    revision.state = superseded ? 'superseded_published' : 'published'; revision.publishedAt = now; revision.updatedAt = now;
    revision.lastCompletedAttempt = { attemptId: options.attemptId, outcome: 'published' }; revision.activeAttempt = null; revision.nextAttemptAt = null;
    generation.updatedAt = now; document.documentRevision += 1;
    return { changed: true, status: superseded ? 'published_superseded_revision' : 'published_current', document };
  });
}
function retryDelay(retryCount) { return Math.min(MARKETPLACE_OUTBOX_V2_RETRY_POLICY.maximumMs, MARKETPLACE_OUTBOX_V2_RETRY_POLICY.baseMs * (2 ** Math.min(31, retryCount - 1))); }
async function recordMarketplaceOutboxV2FailedAttempt(options = {}) {
  return mutateMarketplaceOutboxV2(options, (document, loadStatus) => {
    if (loadStatus === 'missing') return { changed: false, status: 'generation_missing' };
    const found = locate(document, options); if (found.status) return { changed: false, status: found.status };
    const { event, revision, generation } = found;
    if (revision.lastCompletedAttempt?.attemptId === options.attemptId && revision.lastCompletedAttempt.outcome === 'failed'
      && revision.payloadHash === options.payloadHash) return { changed: false, status: 'already_failed_attempt' };
    if (!exactAttempt(found, options)) return { changed: false, status: 'attempt_mismatch' };
    if (typeof options.failureCode !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(options.failureCode)
      || Buffer.byteLength(options.failureCode, 'utf8') > MARKETPLACE_OUTBOX_V2_LIMITS.maximumFailureCodeBytes) return { changed: false, status: 'invalid_failure' };
    if (options.httpStatus !== null && options.httpStatus !== undefined && (!Number.isInteger(options.httpStatus) || options.httpStatus < 100 || options.httpStatus > 599)) return { changed: false, status: 'invalid_failure' };
    const now = resolveNow(options.now); revision.retryCount += 1;
    revision.state = event.currentRevisionId === revision.revisionId ? 'failed_retryable' : 'superseded_pending';
    revision.nextAttemptAt = new Date(Date.parse(now) + retryDelay(revision.retryCount)).toISOString(); revision.updatedAt = now;
    revision.lastFailure = { code: options.failureCode, httpStatus: options.httpStatus ?? null, failedAt: now };
    revision.lastCompletedAttempt = { attemptId: options.attemptId, outcome: 'failed' }; revision.activeAttempt = null;
    generation.updatedAt = now; document.documentRevision += 1;
    return { changed: true, status: revision.state, document, result: { nextAttemptAt: revision.nextAttemptAt } };
  });
}
async function inspectMarketplaceOutboxV2Posting(options = {}) {
  const loaded = await loadMarketplaceOutboxV2(options); if (loaded.status !== 'loaded') return loaded;
  const revisions = [];
  for (const generation of Object.values(loaded.document.generations)) for (const event of Object.values(generation.events)) for (const revision of Object.values(event.revisions)) {
    if (revision.state === 'posting') revisions.push({ generationId: generation.generationId, eventId: event.eventId, revisionId: revision.revisionId,
      payloadHash: revision.payloadHash, activeAttempt: clone(revision.activeAttempt), superseded: event.currentRevisionId !== revision.revisionId });
  }
  revisions.sort((a, b) => compareCodeUnits(a.generationId, b.generationId) || compareCodeUnits(a.eventId, b.eventId) || compareCodeUnits(a.revisionId, b.revisionId));
  return { status: 'posting_listed', revisions };
}
async function reconcileMarketplaceOutboxV2Revision(options = {}) {
  if (!['matched', 'absent', 'mismatch', 'indeterminate'].includes(options.outcome)) return { status: 'invalid_reconciliation', written: false };
  return mutateMarketplaceOutboxV2(options, (document, loadStatus) => {
    if (loadStatus === 'missing') return { changed: false, status: 'generation_missing' };
    const found = locate(document, options); if (found.status) return { changed: false, status: found.status };
    const { event, revision, generation } = found;
    if (!exactAttempt(found, options)) return { changed: false, status: 'attempt_mismatch' };
    if (options.outcome === 'mismatch') return { changed: false, status: 'reconciliation_mismatch' };
    if (options.outcome === 'indeterminate') return { changed: false, status: 'reconciliation_indeterminate' };
    const now = resolveNow(options.now); const superseded = event.currentRevisionId !== revision.revisionId;
    if (options.outcome === 'matched') {
      revision.state = superseded ? 'superseded_published' : 'published'; revision.publishedAt = now;
      revision.lastCompletedAttempt = { attemptId: options.attemptId, outcome: 'published' };
    } else revision.state = superseded ? 'superseded_pending' : 'pending';
    revision.activeAttempt = null; revision.updatedAt = now; revision.nextAttemptAt = null; generation.updatedAt = now; document.documentRevision += 1;
    return { changed: true, status: options.outcome === 'matched'
      ? (superseded ? 'reconciled_published_superseded' : 'reconciled_published_current')
      : (superseded ? 'reconciled_superseded_pending' : 'reconciled_pending'), document };
  });
}

module.exports = {
  MARKETPLACE_OUTBOX_V2_SCHEMA_VERSION,
  MARKETPLACE_OUTBOX_V2_DIRECTORY,
  MARKETPLACE_OUTBOX_V2_LOCK_OPTIONS,
  MARKETPLACE_OUTBOX_V2_EVENT_TYPES,
  MARKETPLACE_OUTBOX_V2_REVISION_STATES,
  MARKETPLACE_OUTBOX_V2_LIMITS,
  MARKETPLACE_OUTBOX_V2_RETRY_POLICY,
  validateMarketplaceInstallationId,
  validateMarketplaceApplicationProfile,
  canonicalizeMarketplaceInfluxBaseUrl,
  canonicalizeMarketplaceDestination,
  deriveMarketplaceOrganizationHash,
  deriveMarketplaceDestinationHash,
  deriveMarketplaceGenerationFingerprint,
  deriveMarketplaceGenerationId,
  deriveMarketplaceAssetFlowIdentityHash,
  deriveMarketplaceOutboxV2EventId,
  deriveMarketplaceOutboxV2PayloadHash,
  deriveMarketplaceOutboxV2RevisionId,
  deriveMarketplaceOutboxV2AttemptId,
  resolveMarketplaceOutboxV2Paths,
  createMarketplaceOutboxV2Document,
  validateMarketplaceOutboxV2Document,
  validateMarketplaceOutboxV2Event,
  validateMarketplaceOutboxV2Revision,
  loadMarketplaceOutboxV2,
  mutateMarketplaceOutboxV2,
  configureMarketplaceOutboxV2Destination,
  finalizeMarketplaceOutboxV2Organization,
  setMarketplaceOutboxV2PublishedOnly,
  verifyMarketplaceOutboxV2Destination,
  stageMarketplaceOutboxV2TradeRevision,
  stageMarketplaceOutboxV2AssetFlow,
  listMarketplaceOutboxV2Pending,
  claimMarketplaceOutboxV2Revision,
  markMarketplaceOutboxV2Published,
  recordMarketplaceOutboxV2FailedAttempt,
  inspectMarketplaceOutboxV2Posting,
  reconcileMarketplaceOutboxV2Revision,
};
