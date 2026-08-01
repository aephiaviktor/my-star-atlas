'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const api = require('../electron/marketplace-outbox-v2');

const INSTALLATION_ID = 'a'.repeat(64);
const PROFILE = 'USTUR';
const NOW = '2026-08-01T06:00:00.000Z';
const BASE = Object.freeze({ installationId: INSTALLATION_ID, applicationProfile: PROFILE });

async function withTemp(callback) {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-outbox-v2-'));
  try { return await callback(storageRoot); }
  finally { await fs.rm(storageRoot, { recursive: true, force: true }); }
}
function code(callback) {
  try { callback(); } catch (error) { return error?.code; }
  return null;
}
function hashTuple(tuple) { return crypto.createHash('sha256').update(JSON.stringify(tuple), 'utf8').digest('hex'); }
function options(storageRoot, extra = {}) { return { storageRoot, ...BASE, now: () => NOW, ...extra }; }

test('exports exactly the authorized Gate 2 API', () => {
  assert.deepEqual(Object.keys(api).sort(), [
    'MARKETPLACE_OUTBOX_V2_DIRECTORY', 'MARKETPLACE_OUTBOX_V2_LOCK_OPTIONS', 'MARKETPLACE_OUTBOX_V2_SCHEMA_VERSION',
    'canonicalizeMarketplaceDestination', 'canonicalizeMarketplaceInfluxBaseUrl',
    'configureMarketplaceOutboxV2Destination', 'createMarketplaceOutboxV2Document',
    'deriveMarketplaceDestinationHash', 'deriveMarketplaceGenerationFingerprint',
    'deriveMarketplaceGenerationId', 'deriveMarketplaceOrganizationHash',
    'finalizeMarketplaceOutboxV2Organization', 'loadMarketplaceOutboxV2',
    'mutateMarketplaceOutboxV2', 'resolveMarketplaceOutboxV2Paths',
    'setMarketplaceOutboxV2PublishedOnly', 'validateMarketplaceApplicationProfile',
    'validateMarketplaceInstallationId', 'validateMarketplaceOutboxV2Document',
    'verifyMarketplaceOutboxV2Destination',
  ].sort());
  assert.equal(api.MARKETPLACE_OUTBOX_V2_SCHEMA_VERSION, 2);
  assert.equal(api.MARKETPLACE_OUTBOX_V2_DIRECTORY, 'marketplace-outbox-v2');
  assert.deepEqual(api.MARKETPLACE_OUTBOX_V2_LOCK_OPTIONS, {
    stale: 30000, update: 10000,
    retries: { retries: 50, factor: 1.2, minTimeout: 10, maxTimeout: 100, randomize: false },
    realpath: false,
  });
});

test('resolves the exact authoritative document and lock paths', () => {
  const result = api.resolveMarketplaceOutboxV2Paths({ storageRoot: '/tmp/msa-store', ...BASE });
  assert.equal(result.documentPath, path.resolve('/tmp/msa-store', 'marketplace-outbox-v2', `${PROFILE}.${INSTALLATION_ID}.json`));
  assert.equal(result.lockPath, `${result.documentPath}.lock-target`);
});

test('validates injected installation and canonical case-sensitive profile', () => {
  assert.equal(api.validateMarketplaceInstallationId(INSTALLATION_ID), INSTALLATION_ID);
  assert.equal(api.validateMarketplaceApplicationProfile('Custom.Profile-2'), 'Custom.Profile-2');
  for (const value of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) assert.equal(code(() => api.validateMarketplaceInstallationId(value)), 'invalid_installation_id');
  for (const value of ['', 'bad profile', 'x'.repeat(65), ' USTUR ']) assert.equal(code(() => api.validateMarketplaceApplicationProfile(value)), 'invalid_application_profile');
});

test('canonicalizes URLs, buckets, organizations, and exact hashes', () => {
  assert.equal(api.canonicalizeMarketplaceInfluxBaseUrl(' HTTPS://Example.COM:443/api/v2/ '), 'https://example.com/api/v2');
  assert.equal(api.canonicalizeMarketplaceInfluxBaseUrl('http://EXAMPLE.com:8086/'), 'http://example.com:8086');
  for (const value of ['ftp://example.com', 'https://u:p@example.com', 'https://example.com?a=1', 'https://example.com/#x']) {
    assert.equal(code(() => api.canonicalizeMarketplaceInfluxBaseUrl(value)), 'invalid_base_url');
  }
  const destination = api.canonicalizeMarketplaceDestination({ baseUrl: 'https://EXAMPLE.com/', bucket: ' Main ', organization: ' Org A ' });
  const organizationHash = hashTuple(['msa-influx-organization:v2', 'Org A']);
  assert.deepEqual(destination, { baseUrl: 'https://example.com', bucket: 'Main', organizationHash });
  assert.equal(api.deriveMarketplaceOrganizationHash(' Org A '), organizationHash);
  assert.equal(api.deriveMarketplaceDestinationHash(destination), hashTuple(['msa-influx-destination:v2', 'https://example.com', 'Main', organizationHash]));
  assert.equal(code(() => api.canonicalizeMarketplaceDestination({ baseUrl: 'https://example.com', bucket: '\n', organization: null })), 'invalid_bucket');
});

test('derives generation scope without organization or token influence', () => {
  const fingerprint = api.deriveMarketplaceGenerationFingerprint({ ...BASE, baseUrl: 'https://example.com', bucket: 'Main' });
  assert.equal(fingerprint, hashTuple(['msa-marketplace-generation-scope:v2', INSTALLATION_ID, PROFILE, 'https://example.com', 'Main']));
  assert.equal(api.deriveMarketplaceGenerationId({ generationFingerprint: fingerprint, generationSequence: 1 }), hashTuple(['msa-marketplace-generation:v2', fingerprint, 1]));
});

test('missing document loads as missing and is not created', async () => withTemp(async (storageRoot) => {
  const result = await api.loadMarketplaceOutboxV2(options(storageRoot));
  assert.equal(result.status, 'missing');
  const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot, ...BASE });
  await assert.rejects(fs.access(paths.documentPath), { code: 'ENOENT' });
}));

test('missing configuration or auth does not create a document', async () => withTemp(async (storageRoot) => {
  for (const input of [
    { baseUrl: '', bucket: 'Main', authConfigured: true },
    { baseUrl: 'https://example.com', bucket: '', authConfigured: true },
    { baseUrl: 'https://example.com', bucket: 'Main', authConfigured: false },
  ]) {
    const result = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, input));
    assert.equal(result.status, 'not_configured');
  }
  assert.equal((await api.loadMarketplaceOutboxV2(options(storageRoot))).status, 'missing');
}));

test('creates provisional and initially finalized generations deterministically', async () => {
  await withTemp(async (storageRoot) => {
    const result = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://EXAMPLE.com/', bucket: ' Main ', authConfigured: true }));
    assert.equal(result.status, 'configured_provisional');
    assert.equal(result.document.documentRevision, 1);
    const generation = result.document.generations[result.document.activeGenerationId];
    assert.equal(generation.destination.state, 'provisional');
    assert.equal(generation.destination.organizationHash, null);
    assert.deepEqual(generation.events, {});
  });
  await withTemp(async (storageRoot) => {
    const result = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', organization: 'Org', authConfigured: true }));
    assert.equal(result.status, 'configured_finalized');
    const generation = result.document.generations[result.document.activeGenerationId];
    assert.equal(generation.destination.state, 'finalized');
    assert.equal(generation.destination.organizationHash, api.deriveMarketplaceOrganizationHash('Org'));
  });
});

test('finalizes organization in place with stable generation identity and idempotent replay', async () => withTemp(async (storageRoot) => {
  const created = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', authConfigured: true }));
  const beforeId = created.document.activeGenerationId;
  const beforeFingerprint = created.document.generations[beforeId].generationFingerprint;
  const finalized = await api.finalizeMarketplaceOutboxV2Organization(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', organization: 'Org', authConfigured: true }));
  assert.equal(finalized.status, 'organization_finalized');
  assert.equal(finalized.document.activeGenerationId, beforeId);
  assert.equal(finalized.document.generations[beforeId].generationFingerprint, beforeFingerprint);
  assert.equal(finalized.document.documentRevision, 2);
  const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot, ...BASE });
  const bytes = await fs.readFile(paths.documentPath);
  const replay = await api.finalizeMarketplaceOutboxV2Organization(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', organization: 'Org', authConfigured: true, authToken: 'rotated-secret' }));
  assert.equal(replay.status, 'organization_already_finalized');
  assert.equal(replay.written, false);
  assert.deepEqual(await fs.readFile(paths.documentPath), bytes);
  assert.equal(JSON.stringify(replay).includes('rotated-secret'), false);
}));

test('conflicting organization is rejected without mutation', async () => withTemp(async (storageRoot) => {
  await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', organization: 'Org1', authConfigured: true }));
  const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot, ...BASE });
  const before = await fs.readFile(paths.documentPath);
  const result = await api.finalizeMarketplaceOutboxV2Organization(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', organization: 'Org2', authConfigured: true }));
  assert.equal(result.status, 'destination_mismatch');
  assert.deepEqual(await fs.readFile(paths.documentPath), before);
}));

test('published-only is explicit and idempotent', async () => withTemp(async (storageRoot) => {
  const configured = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', authConfigured: true }));
  const generationId = configured.document.activeGenerationId;
  const result = await api.setMarketplaceOutboxV2PublishedOnly(options(storageRoot, { generationId }));
  assert.equal(result.status, 'published_only');
  assert.equal(result.document.activeGenerationId, null);
  assert.equal(result.document.generations[generationId].mode, 'published_only');
  assert.equal(result.document.documentRevision, 2);
  const replay = await api.setMarketplaceOutboxV2PublishedOnly(options(storageRoot, { generationId }));
  assert.equal(replay.status, 'already_published_only');
  assert.equal(replay.written, false);
}));

test('empty active destination replacement freezes old generation and creates one new active generation', async () => withTemp(async (storageRoot) => {
  const first = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://one.example', bucket: 'One', authConfigured: true }));
  const oldId = first.document.activeGenerationId;
  const changed = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://two.example', bucket: 'Two', authConfigured: true }));
  assert.equal(changed.status, 'destination_replaced');
  assert.notEqual(changed.document.activeGenerationId, oldId);
  assert.equal(changed.document.generations[oldId].mode, 'published_only');
  assert.equal(changed.document.generations[changed.document.activeGenerationId].generationSequence, 2);
  assert.equal(changed.document.nextGenerationSequence, 3);
  assert.equal(changed.document.documentRevision, 2);
}));

test('event-bearing destination replacement is blocked before unsupported event schema replacement', async () => withTemp(async (storageRoot) => {
  const configured = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://one.example', bucket: 'One', authConfigured: true }));
  const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot, ...BASE });
  const document = structuredClone(configured.document);
  document.generations[document.activeGenerationId].events.example = { future: true };
  await fs.writeFile(paths.documentPath, `${JSON.stringify(document, null, 2)}\n`);
  const result = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://two.example', bucket: 'Two', authConfigured: true }));
  assert.equal(result.status, 'destination_change_blocked');
}));

test('verification distinguishes every destination state without mutation', async () => withTemp(async (storageRoot) => {
  assert.equal((await api.verifyMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: '', bucket: 'Main', authConfigured: true }))).status, 'not_configured');
  await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', authConfigured: true }));
  assert.equal((await api.verifyMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', authConfigured: true }))).status, 'provisional_match');
  assert.equal((await api.verifyMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', organization: 'Org', authConfigured: true }))).status, 'finalization_required');
  await api.finalizeMarketplaceOutboxV2Organization(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', organization: 'Org', authConfigured: true }));
  assert.equal((await api.verifyMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', authConfigured: true }))).status, 'runtime_organization_missing');
  assert.equal((await api.verifyMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://example.com', bucket: 'Main', organization: 'Org', authConfigured: true }))).status, 'finalized_match');
  assert.equal((await api.verifyMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://other.example', bucket: 'Main', organization: 'Org', authConfigured: true }))).status, 'destination_mismatch');
}));

test('strict loading preserves corrupt, unsupported, identity-mismatched, and multiple-active documents', async () => withTemp(async (storageRoot) => {
  const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot, ...BASE });
  await fs.mkdir(path.dirname(paths.documentPath), { recursive: true });
  const fixtures = [
    ['{bad', 'corrupt_json'],
    [JSON.stringify({ schemaVersion: 99 }), 'unsupported_version'],
  ];
  for (const [content, status] of fixtures) {
    await fs.writeFile(paths.documentPath, content);
    assert.equal((await api.loadMarketplaceOutboxV2(options(storageRoot))).status, status);
    assert.equal(await fs.readFile(paths.documentPath, 'utf8'), content);
  }
  const valid = api.createMarketplaceOutboxV2Document({ ...BASE, now: NOW, destination: { baseUrl: 'https://example.com', bucket: 'Main', organizationHash: null } });
  const mismatch = { ...valid, installationId: 'b'.repeat(64) };
  await fs.writeFile(paths.documentPath, `${JSON.stringify(mismatch)}\n`);
  assert.equal((await api.loadMarketplaceOutboxV2(options(storageRoot))).status, 'identity_mismatch');
  const duplicate = structuredClone(valid);
  const originalId = duplicate.activeGenerationId;
  const original = duplicate.generations[originalId];
  const secondId = api.deriveMarketplaceGenerationId({ generationFingerprint: original.generationFingerprint, generationSequence: 2 });
  duplicate.generations[secondId] = { ...structuredClone(original), generationId: secondId, generationSequence: 2 };
  duplicate.nextGenerationSequence = 3;
  await fs.writeFile(paths.documentPath, `${JSON.stringify(duplicate)}\n`);
  assert.equal((await api.loadMarketplaceOutboxV2(options(storageRoot))).status, 'multiple_active_generations');
}));

test('concurrent first, idempotent, and conflicting configurations serialize without lost updates', async () => withTemp(async (storageRoot) => {
  const firstPair = await Promise.all([
    api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://one.example', bucket: 'Main', authConfigured: true })),
    api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://one.example', bucket: 'Main', authConfigured: true })),
  ]);
  assert.deepEqual(firstPair.map((row) => row.status).sort(), ['configured_provisional', 'destination_unchanged']);
  const conflict = await Promise.all([
    api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://two.example', bucket: 'Two', authConfigured: true })),
    api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://three.example', bucket: 'Three', authConfigured: true })),
  ]);
  assert.equal(conflict.every((row) => ['destination_replaced'].includes(row.status)), true);
  const loaded = await api.loadMarketplaceOutboxV2(options(storageRoot));
  assert.equal(Object.values(loaded.document.generations).filter((row) => row.mode === 'active').length, 1);
  assert.equal(loaded.document.documentRevision, 3);
}));

test('pre-rename failure preserves prior document and releases lock', async () => withTemp(async (storageRoot) => {
  await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://one.example', bucket: 'One', authConfigured: true }));
  const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot, ...BASE });
  const before = await fs.readFile(paths.documentPath);
  const failed = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, {
    baseUrl: 'https://two.example', bucket: 'Two', authConfigured: true,
    writeHooks: { beforeRename: async () => { throw new Error('injected'); } },
  }));
  assert.equal(failed.status, 'atomic_replace_failed');
  assert.deepEqual(await fs.readFile(paths.documentPath), before);
  const retry = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, { baseUrl: 'https://two.example', bucket: 'Two', authConfigured: true }));
  assert.equal(retry.status, 'destination_replaced');
}));

test('tokens are neither persisted, hashed, nor returned and deterministic replay preserves bytes', async () => withTemp(async (storageRoot) => {
  const secret = 'super-secret-token';
  const result = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, {
    baseUrl: 'https://example.com', bucket: 'Main', organization: 'Org', authConfigured: true, authToken: secret,
  }));
  const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot, ...BASE });
  const before = await fs.readFile(paths.documentPath, 'utf8');
  assert.equal(before.includes(secret), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  const replay = await api.configureMarketplaceOutboxV2Destination(options(storageRoot, {
    baseUrl: 'https://example.com', bucket: 'Main', organization: 'Org', authConfigured: true, authToken: 'rotated-token',
  }));
  assert.equal(replay.written, false);
  assert.equal(await fs.readFile(paths.documentPath, 'utf8'), before);
}));
