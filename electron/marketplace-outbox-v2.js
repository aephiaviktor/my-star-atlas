'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const properLockfile = require('proper-lockfile');
const { writeJsonAtomic } = require('./atomic-json');

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
  if (Object.keys(generation.events).length) fail('event_schema_not_enabled');
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
    if (!mutation.changed) return { status: mutation.status, written: false, document: clone(loaded.document) };
    const expectedRevision = loaded.status === 'missing' ? 1 : loaded.document.documentRevision + 1;
    if (mutation.document?.documentRevision !== expectedRevision) return { status: 'invalid_document_revision', written: false };
    const document = canonicalDocument(mutation.document);
    try { validateMarketplaceOutboxV2Document(document, { installationId: options.installationId, applicationProfile: options.applicationProfile }); }
    catch (error) { return { status: error?.code || 'invalid_document', written: false };
    }
    try { await writeJsonAtomic(paths.documentPath, document, options.writeHooks || {}); }
    catch (_error) { return { status: 'atomic_replace_failed', written: false };
    }
    return { status: mutation.status, written: true, document: clone(document) };
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

module.exports = {
  MARKETPLACE_OUTBOX_V2_SCHEMA_VERSION,
  MARKETPLACE_OUTBOX_V2_DIRECTORY,
  MARKETPLACE_OUTBOX_V2_LOCK_OPTIONS,
  validateMarketplaceInstallationId,
  validateMarketplaceApplicationProfile,
  canonicalizeMarketplaceInfluxBaseUrl,
  canonicalizeMarketplaceDestination,
  deriveMarketplaceOrganizationHash,
  deriveMarketplaceDestinationHash,
  deriveMarketplaceGenerationFingerprint,
  deriveMarketplaceGenerationId,
  resolveMarketplaceOutboxV2Paths,
  createMarketplaceOutboxV2Document,
  validateMarketplaceOutboxV2Document,
  loadMarketplaceOutboxV2,
  mutateMarketplaceOutboxV2,
  configureMarketplaceOutboxV2Destination,
  finalizeMarketplaceOutboxV2Organization,
  setMarketplaceOutboxV2PublishedOnly,
  verifyMarketplaceOutboxV2Destination,
};
