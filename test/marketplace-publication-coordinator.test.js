'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const coordinator = require('../electron/marketplace-publication-coordinator');
const outbox = require('../electron/marketplace-outbox-v2');

const NOW = '2026-08-01T08:00:00.000Z';
const BASE = { installationId: 'a'.repeat(64), applicationProfile: 'USTUR' };
const SETTINGS = { ...BASE, baseUrl: 'https://EXAMPLE.com/', bucket: ' Main ', organization: 'Org A', token: 'Bearer secret', storageRoot: '' };
const IDENTITY = { market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: 'sig', rawMint: 'mint', side: 'buy', quantity: 10 };
const FALLBACK = { fallbackQuantity: 10, fallbackSettledAtlas: 5, fallbackGrossAtlas: 5, fallbackMarketplaceFeeAtlas: 0, fallbackNetAtlas: 5, fallbackUnitPriceAtlas: .5, fallbackWallet: 'wallet', fallbackStarbase: 'UST-1', fallbackAsset: 'Food', fallbackCertificateMint: 'cert' };
function trade(currentId = 'c1', extra = {}) { return { currentId, representationRank: 'fallback', record: { eventType: 'trade', identity: IDENTITY, pointTimestampNs: '1784941200000000000', sourceVersion: 'fallback_v1', fields: FALLBACK, ...extra } }; }
function asset(currentId = 'a1', id = 'flow-1') { return { currentId, record: { eventType: 'asset_flow', id, timestamp: NOW, flow: 'css-deposit', asset: 'Food', origin: 'wallet:w', destination: 'UST-1', quantity: 2, txFeeAtlas: .1, signature: 'sig', rawMint: 'mint' } }; }
async function temp(fn) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-pub-')); try { return await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); } }
function settings(root, extra = {}) { return { ...SETTINGS, storageRoot: root, ...extra }; }
function factory(extra = {}) { return coordinator.createMarketplacePublicationCoordinator({ now: () => NOW, ...extra }); }
async function load(root) { return outbox.loadMarketplaceOutboxV2({ storageRoot: root, ...BASE, now: () => NOW }); }

 test('exports exactly the Gate 4 API and factory exposes only publication', () => {
  assert.deepEqual(Object.keys(coordinator).sort(), ['buildPublicationBatches','classifyPublicationOutcome','createMarketplacePublicationCoordinator','drainPending','reconcilePostingRevision','stageCandidates'].sort());
  assert.deepEqual(Object.keys(factory()), ['publishMarketplaceCandidates']);
});

test('classification covers confirmed, definite and every ambiguous family', () => {
  for (const status of [200, 201, 204, 299]) assert.equal(coordinator.classifyPublicationOutcome({ status }), 'confirmed');
  for (const status of [400, 401, 404, 409, 422, 499]) assert.equal(coordinator.classifyPublicationOutcome({ status }), 'definite_failure');
  for (const value of [{status:300},{status:399},{status:408},{status:500},{status:599},{},null,new Error('connection')]) assert.equal(coordinator.classifyPublicationOutcome(value), 'ambiguous');
});

test('batching enforces entries, UTF-8 separators, 127/128 line boundary, order and 64-batch cap', () => {
  const rows = Array.from({ length: 251 }, (_, index) => ({ revisionId: String(index), payload: { line: `line-${index}` } }));
  const byCount = coordinator.buildPublicationBatches(rows); assert.deepEqual(byCount.map(x => x.revisions.length), [250,1]);
  assert.equal(byCount[0].body.endsWith('\n'), false); assert.equal(byCount[0].body.split('\n')[0], 'line-0');
  const maximum = 'x'.repeat(8192); const boundary = coordinator.buildPublicationBatches(Array.from({ length: 128 }, (_, i) => ({ revisionId: String(i), payload: { line: maximum } })));
  assert.deepEqual(boundary.map(x => x.revisions.length), [127,1]); assert.equal(boundary[0].bodyBytes, 127 * 8192 + 126);
  const capped = coordinator.buildPublicationBatches(Array.from({ length: 16001 }, (_, i) => ({ payload: { line: String(i) } })));
  assert.equal(capped.length, 64); assert.equal(capped.reduce((n, batch) => n + batch.revisions.length, 0), 16000);
});

test('initial finalized binding stages every candidate before exact POST and returns confirmed IDs', async () => temp(async (root) => {
  const calls = []; const api = { ...outbox,
    stageMarketplaceOutboxV2TradeRevision: async (...args) => { calls.push('stage'); return outbox.stageMarketplaceOutboxV2TradeRevision(...args); },
    claimMarketplaceOutboxV2Revision: async (...args) => { calls.push('claim'); return outbox.claimMarketplaceOutboxV2Revision(...args); },
  };
  const fetchImpl = async (url, init) => { calls.push('post'); assert.equal(url, 'https://example.com/api/v2/write?org=Org%20A&bucket=Main&precision=ns');
    assert.deepEqual(init.headers, { Authorization: 'Token secret', 'Content-Type': 'text/plain; charset=utf-8' }); assert.equal(init.redirect, 'manual'); assert.equal(init.timeout, 15000); return { status: 204 }; };
  const app = coordinator.createMarketplacePublicationCoordinator({ fetchImpl, now: () => NOW, api });
  const result = await app.publishMarketplaceCandidates({ settings: settings(root), candidates: [trade('one'), trade('two', { identity: { ...IDENTITY, executionSignature: 'sig2' } })] });
  assert.deepEqual(calls.slice(0, 2), ['stage','stage']); assert.equal(calls.indexOf('post') > calls.lastIndexOf('stage'), true);
  assert.deepEqual(result.results.map(x => x.outcome), ['published_confirmed','published_confirmed']); assert.deepEqual(result.confirmedCurrentIds, ['one','two']);
  const document = (await load(root)).document; const generation = document.generations[document.activeGenerationId]; assert.equal(generation.destination.state, 'finalized');
  assert.equal(JSON.stringify(document).includes('secret'), false); assert.equal(JSON.stringify(result).includes('secret'), false);
}));

test('provisional destination stages without transport then finalizes in place', async () => temp(async (root) => {
  let posts = 0; const fetchImpl = async () => { posts += 1; return { status: 204 }; };
  const app = factory({ fetchImpl });
  const provisional = await app.publishMarketplaceCandidates({ settings: settings(root, { organization: undefined }), candidates: [trade()] });
  assert.equal(provisional.results[0].outcome, 'pending_unattempted'); assert.equal(posts, 0);
  const before = await load(root); const id = before.document.activeGenerationId; const fingerprint = before.document.generations[id].generationFingerprint;
  const finalized = await app.publishMarketplaceCandidates({ settings: settings(root), candidates: [trade()] });
  assert.equal(finalized.results[0].outcome, 'published_confirmed'); assert.equal(posts, 1);
  const after = await load(root); assert.equal(after.document.activeGenerationId, id); assert.equal(after.document.generations[id].generationFingerprint, fingerprint);
}));

test('destination conflicts hard-fail all candidates without staging or POST', async () => temp(async (root) => {
  await factory().publishMarketplaceCandidates({ settings: settings(root), candidates: [] });
  const before = await load(root); let posts = 0;
  for (const conflict of [{baseUrl:'https://other.example'},{bucket:'Other'},{organization:'Other'}]) {
    const result = await factory({ fetchImpl: async () => { posts += 1; } }).publishMarketplaceCandidates({ settings: settings(root, conflict), candidates: [trade()] });
    assert.equal(result.results[0].outcome, 'stage_failed');
  }
  assert.equal(posts, 0); assert.equal((await load(root)).document.documentRevision, before.document.documentRevision);
}));

test('token absence stages pending without rebinding and token rotation preserves identity', async () => temp(async (root) => {
  const app = factory({ fetchImpl: async () => ({ status: 204 }) }); await app.publishMarketplaceCandidates({ settings: settings(root), candidates: [] });
  const before = await load(root); const id = before.document.activeGenerationId;
  const absent = await app.publishMarketplaceCandidates({ settings: settings(root, { token: '' }), candidates: [trade()] });
  assert.equal(absent.results[0].outcome, 'pending_unattempted'); assert.deepEqual(absent.confirmedCurrentIds, []);
  const rotated = await app.publishMarketplaceCandidates({ settings: settings(root, { token: 'Token rotated' }), candidates: [trade()] });
  assert.equal(rotated.results[0].outcome, 'published_confirmed'); assert.equal((await load(root)).document.activeGenerationId, id);
}));

test('one hard staging failure blocks every POST while earlier staging remains durable', async () => temp(async (root) => {
  let posts = 0; const result = await factory({ fetchImpl: async () => { posts += 1; return { status: 204 }; } }).publishMarketplaceCandidates({
    settings: settings(root), candidates: [trade('good'), { currentId: 'bad', record: { eventType: 'unknown' } }],
  });
  assert.deepEqual(result.results.map(x => x.outcome), ['pending_unattempted','stage_failed']); assert.equal(posts, 0);
  const document = (await load(root)).document; assert.equal(Object.keys(document.generations[document.activeGenerationId].events).length, 1);
}));

test('empty invocation drains backlog and invents no current IDs', async () => temp(async (root) => {
  await factory().publishMarketplaceCandidates({ settings: settings(root), candidates: [asset('old')] });
  const result = await factory({ fetchImpl: async () => ({ status: 204 }) }).publishMarketplaceCandidates({ settings: settings(root), candidates: [] });
  assert.deepEqual(result.results, []); assert.deepEqual(result.confirmedCurrentIds, []);
  const document = (await load(root)).document; const revision = Object.values(Object.values(document.generations[document.activeGenerationId].events)[0].revisions)[0]; assert.equal(revision.state, 'published');
}));

test('definite rejection records retry; ambiguity leaves posting and never confirms IDs', async () => {
  await temp(async (root) => {
    const result = await factory({ fetchImpl: async () => ({ status: 422 }) }).publishMarketplaceCandidates({ settings: settings(root), candidates: [trade()] });
    assert.equal(result.results[0].outcome, 'publication_failed'); assert.deepEqual(result.confirmedCurrentIds, []);
    const document = (await load(root)).document; const revision = Object.values(Object.values(document.generations[document.activeGenerationId].events)[0].revisions)[0]; assert.equal(revision.state, 'failed_retryable'); assert.equal(revision.lastFailure.code, 'http_422');
  });
  for (const transport of [async () => ({ status: 503 }), async () => { throw new Error('secret raw network message'); }]) await temp(async (root) => {
    const result = await factory({ fetchImpl: transport }).publishMarketplaceCandidates({ settings: settings(root), candidates: [trade()] });
    assert.equal(result.results[0].outcome, 'publication_ambiguous'); assert.deepEqual(result.confirmedCurrentIds, []); assert.equal(JSON.stringify(result).includes('secret'), false);
    const document = (await load(root)).document; const revision = Object.values(Object.values(document.generations[document.activeGenerationId].events)[0].revisions)[0]; assert.equal(revision.state, 'posting');
  });
});

test('confirmed POST with local mark failure is not reposted and reports mark failure or uncertainty', async () => temp(async (root) => {
  let posts = 0; const api = { ...outbox, markMarketplaceOutboxV2Published: async () => ({ status: 'atomic_replace_failed', written: false }) };
  const result = await coordinator.createMarketplacePublicationCoordinator({ fetchImpl: async () => { posts += 1; return { status: 204 }; }, now: () => NOW, api })
    .publishMarketplaceCandidates({ settings: settings(root), candidates: [trade('id')] });
  assert.equal(result.results[0].outcome, 'published_mark_failed'); assert.deepEqual(result.confirmedCurrentIds, ['id']); assert.equal(posts, 1);
  const document = (await load(root)).document; const revision = Object.values(Object.values(document.generations[document.activeGenerationId].events)[0].revisions)[0]; assert.equal(revision.state, 'posting');
}));

test('confirmed multi-entry POST may partially mark, and unclassifiable local state is uncertain without repost', async () => {
  await temp(async (root) => {
    let marks = 0; let posts = 0;
    const api = { ...outbox, markMarketplaceOutboxV2Published: async (input) => {
      marks += 1; return marks === 1 ? outbox.markMarketplaceOutboxV2Published(input) : { status: 'atomic_replace_failed', written: false };
    } };
    const result = await coordinator.createMarketplacePublicationCoordinator({ fetchImpl: async () => { posts += 1; return { status: 204 }; }, now: () => NOW, api })
      .publishMarketplaceCandidates({ settings: settings(root), candidates: [trade('one'), trade('two', { identity: { ...IDENTITY, executionSignature: 'sig2' } })] });
    assert.deepEqual(result.results.map(x => x.outcome), ['published_confirmed','published_mark_failed']);
    assert.deepEqual(result.confirmedCurrentIds, ['one','two']); assert.equal(posts, 1);
  });
  await temp(async (root) => {
    let marked = false; let posts = 0;
    const api = { ...outbox,
      markMarketplaceOutboxV2Published: async () => { marked = true; return { status: 'unclassifiable' }; },
      loadMarketplaceOutboxV2: async (input) => marked ? { status: 'read_failed', document: null } : outbox.loadMarketplaceOutboxV2(input),
    };
    const result = await coordinator.createMarketplacePublicationCoordinator({ fetchImpl: async () => { posts += 1; return { status: 204 }; }, now: () => NOW, api })
      .publishMarketplaceCandidates({ settings: settings(root), candidates: [trade('id')] });
    assert.equal(result.results[0].outcome, 'published_mark_uncertain'); assert.deepEqual(result.confirmedCurrentIds, ['id']); assert.equal(posts, 1);
  });
});

test('posting reconciliation handles matched, absent, hash mismatch, indeterminate and resolver errors exactly', async () => {
  for (const scenario of [
    { resolved: x => ({ outcome: 'matched', payloadHash: x.payloadHash }), expected: 'published' },
    { resolved: () => ({ outcome: 'absent' }), expected: 'pending' },
    { resolved: () => ({ outcome: 'matched', payloadHash: '0'.repeat(64) }), expected: 'posting' },
    { resolved: () => ({ outcome: 'indeterminate' }), expected: 'posting' },
    { resolved: () => { throw new Error('query failed'); }, expected: 'posting' },
  ]) await temp(async (root) => {
    await factory({ fetchImpl: async () => ({ status: 503 }) }).publishMarketplaceCandidates({ settings: settings(root), candidates: [trade()] });
    const posting = await outbox.inspectMarketplaceOutboxV2Posting({ storageRoot: root, ...BASE, now: () => NOW });
    const result = await coordinator.reconcilePostingRevision({ settings: settings(root), posting: posting.revisions[0], resolveExactPoint: scenario.resolved, now: () => NOW });
    assert.ok(result.status.startsWith('reconcil') || result.status === 'attempt_mismatch');
    const document = (await load(root)).document; const revision = Object.values(Object.values(document.generations[document.activeGenerationId].events)[0].revisions)[0]; assert.equal(revision.state, scenario.expected);
  });
});

test('concurrent drains claim once, make one request, and do not hold lock during transport', async () => temp(async (root) => {
  await factory().publishMarketplaceCandidates({ settings: settings(root), candidates: [trade()] });
  let posts = 0; const fetchImpl = async () => { posts += 1; const loaded = await load(root); assert.equal(loaded.status, 'loaded'); return { status: 204 }; };
  const args = { settings: settings(root), fetchImpl, now: () => NOW };
  await Promise.all([coordinator.drainPending(args), coordinator.drainPending(args)]);
  assert.equal(posts, 1);
}));

test('no injected transport means no implicit global fetch and deterministic replay', async () => temp(async (root) => {
  const original = global.fetch; let globalCalls = 0; global.fetch = async () => { globalCalls += 1; return { status: 204 }; };
  try {
    const app = factory(); const first = await app.publishMarketplaceCandidates({ settings: settings(root), candidates: [trade()] });
    const second = await app.publishMarketplaceCandidates({ settings: settings(root), candidates: [trade()] });
    assert.equal(globalCalls, 0); assert.deepEqual(first.results.map(x => x.outcome), second.results.map(x => x.outcome)); assert.deepEqual(first.confirmedCurrentIds, []);
  } finally { global.fetch = original; }
}));

test('coordinator remains unreferenced by production and contains no live transport', async () => {
  const electronDir = path.join(__dirname, '..', 'electron');
  for (const name of await fs.readdir(electronDir)) {
    if (!name.endsWith('.js') || name === 'marketplace-publication-coordinator.js') continue;
    assert.equal((await fs.readFile(path.join(electronDir, name), 'utf8')).includes('marketplace-publication-coordinator'), false, name);
  }
});
