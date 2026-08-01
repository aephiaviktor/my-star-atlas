'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const api = require('../electron/marketplace-outbox-v2');
const point = require('../electron/marketplace-v2-point');
const { formatAssetFlowInfluxLine } = require('../electron/marketplace-asset-flow');

const INSTALLATION_ID = 'a'.repeat(64);
const BASE = { installationId: INSTALLATION_ID, applicationProfile: 'USTUR' };
const T0 = '2026-08-01T06:00:00.000Z';
const T1 = '2026-08-01T06:00:01.000Z';
const T2 = '2026-08-01T06:00:02.000Z';
const TS = '1784941200000000000';
const IDENTITY = { market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: '5abc', rawMint: 'ATLASmint', side: 'buy', quantity: 10 };
const FALLBACK = { fallbackQuantity: 10, fallbackSettledAtlas: 5, fallbackGrossAtlas: 5, fallbackMarketplaceFeeAtlas: 0, fallbackNetAtlas: 5, fallbackUnitPriceAtlas: .5, fallbackWallet: 'wallet1', fallbackStarbase: 'UST-1', fallbackAsset: 'Food', fallbackCertificateMint: 'cert1' };
const ENRICHED = { enrichedQuantity: 10, enrichedSettledAtlas: 5.03, enrichedGrossAtlas: 5, enrichedMarketplaceFeeAtlas: .02, enrichedTxFeeAtlas: .01, enrichedNetAtlas: 5.03, enrichedUnitPriceAtlas: .5, enrichedWallet: 'wallet1', enrichedStarbase: 'UST-1', enrichedAsset: 'Food', enrichedCertificateMint: 'cert1', enrichedOrderId: 'order1', enrichedCreationSignature: 'create1' };
const FLOW = { id: 'sig:0:deposit', timestamp: '2026-08-01T06:00:00.000Z', flow: 'css-deposit', asset: 'Food', origin: 'wallet:w', destination: 'UST-1', quantity: 2, txFeeAtlas: .1, signature: 'sig', rawMint: 'mint' };
function hash(tuple) { return crypto.createHash('sha256').update(JSON.stringify(tuple), 'utf8').digest('hex'); }
async function temp(fn) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-v2-rev-')); try { return await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); } }
function opts(root, extra = {}) { return { storageRoot: root, ...BASE, now: () => T0, ...extra }; }
async function configured(root) { return api.configureMarketplaceOutboxV2Destination(opts(root, { baseUrl: 'https://example.com', bucket: 'Main', authConfigured: true })); }
async function fallback(root, extra = {}) { return api.stageMarketplaceOutboxV2TradeRevision(opts(root, { identity: IDENTITY, pointTimestampNs: TS, revisionKind: 'fallback', sourceVersion: 'fallback_v1', fields: FALLBACK, ...extra })); }
async function enriched(root, extra = {}) { return api.stageMarketplaceOutboxV2TradeRevision(opts(root, { identity: IDENTITY, pointTimestampNs: TS, revisionKind: 'enriched', sourceVersion: 'enriched_v1', fields: ENRICHED, ...extra })); }
function get(document, ids) { const g = document.generations[ids.generationId]; const e = g.events[ids.eventId]; return { g, e, r: e.revisions[ids.revisionId] }; }

 test('exact revision identity formulas and exported strict limits are deterministic', () => {
  const generationId = '1'.repeat(64), identityHash = '2'.repeat(64);
  const eventId = api.deriveMarketplaceOutboxV2EventId({ generationId, eventType: 'trade', identityHash });
  assert.equal(eventId, hash(['msa-marketplace-outbox-event:v2', generationId, 'trade', identityHash]));
  const payloadHash = api.deriveMarketplaceOutboxV2PayloadHash('m,t=x f=1 1');
  assert.equal(payloadHash, hash(['msa-marketplace-outbox-payload:v2', 'influx_line', 'm,t=x f=1 1']));
  const revisionId = api.deriveMarketplaceOutboxV2RevisionId({ eventId, revisionKind: 'fallback', sourceVersion: 'fallback_v1', payloadHash });
  assert.equal(revisionId, hash(['msa-marketplace-outbox-revision:v2', eventId, 'fallback', 'fallback_v1', payloadHash]));
  assert.equal(api.deriveMarketplaceOutboxV2AttemptId({ generationId, eventId, revisionId, attemptSequence: 1 }), hash(['msa-marketplace-outbox-attempt:v2', generationId, eventId, revisionId, 1]));
  assert.equal(api.deriveMarketplaceAssetFlowIdentityHash('flow'), hash(['msa-marketplace-asset-flow-identity:v2', 'flow']));
  assert.deepEqual(api.MARKETPLACE_OUTBOX_V2_REVISION_STATES, ['pending','posting','published','superseded_pending','superseded_published','failed_retryable']);
  assert.equal(api.MARKETPLACE_OUTBOX_V2_LIMITS.maximumDocumentBytes, 134217728);
  assert.deepEqual(api.MARKETPLACE_OUTBOX_V2_RETRY_POLICY, { baseMs: 1000, factor: 2, maximumMs: 3600000, jitter: false });
});

test('trade staging stores exact ordered schema, Gate 1 identity, and no mutable legacy IDs', async () => temp(async (root) => {
  await configured(root); const result = await fallback(root); assert.equal(result.status, 'staged');
  const { e, r } = get(result.document, result);
  const projected = point.projectMarketplaceRevision({ identity: IDENTITY, rank: 'fallback', fields: FALLBACK, pointTimestampNs: TS });
  assert.equal(e.identityHash, projected.tradeId); assert.equal(e.tradeId, projected.tradeId); assert.equal(r.payload.line, projected.line);
  assert.deepEqual(Object.keys(e), ['eventId','eventType','identityHash','tradeId','identity','pointTimestampNs','currentRevisionId','createdAt','updatedAt','revisions']);
  assert.deepEqual(Object.keys(e.identity), ['market','faction','profileScope','executionSignature','rawMint','side','canonicalQuantity']);
  assert.deepEqual(Object.keys(r), ['revisionId','revisionKind','sourceVersion','payloadHash','payload','state','createdAt','updatedAt','supersededAt','publishedAt','retryCount','nextAttemptAt','attemptSequence','activeAttempt','lastCompletedAttempt','lastFailure']);
  assert.equal(JSON.stringify(result.document).includes('legacyTradeId'), false);
  const bytes = await fs.readFile(api.resolveMarketplaceOutboxV2Paths({ storageRoot: root, ...BASE }).documentPath);
  const replay = await fallback(root); assert.equal(replay.status, 'pending_unattempted'); assert.equal(replay.written, false);
  assert.deepEqual(await fs.readFile(api.resolveMarketplaceOutboxV2Paths({ storageRoot: root, ...BASE }).documentPath), bytes);
  assert.equal((await fallback(root, { pointTimestampNs: '1784941200000000001' })).status, 'identity_conflict');
  assert.equal((await fallback(root, { fields: { ...FALLBACK, fallbackNetAtlas: 4 } })).status, 'identity_conflict');
}));

test('asset-flow staging preserves existing formatter bytes and event.id and conflicts on replay changes', async () => temp(async (root) => {
  await configured(root); const result = await api.stageMarketplaceOutboxV2AssetFlow(opts(root, { event: FLOW }));
  assert.equal(result.status, 'staged'); const { e, r } = get(result.document, result);
  assert.equal(e.flowId, FLOW.id); assert.equal(r.payload.line, formatAssetFlowInfluxLine(FLOW));
  assert.deepEqual(Object.keys(e), ['eventId','eventType','identityHash','flowId','pointTimestampNs','currentRevisionId','createdAt','updatedAt','revisions']);
  assert.equal((await api.stageMarketplaceOutboxV2AssetFlow(opts(root, { event: { ...FLOW, quantity: 3 } }))).status, 'identity_conflict');
  assert.equal((await api.stageMarketplaceOutboxV2AssetFlow(opts(root, { event: { ...FLOW, timestamp: T1 } }))).status, 'identity_conflict');
}));

test('fallback supersession covers pending, failed, posting, published and enriched suppresses fallback', async () => {
  for (const mode of ['pending','failed','posting','published']) await temp(async (root) => {
    await configured(root); const f = await fallback(root); let doc = f.document; let ids = f;
    if (mode !== 'pending') {
      const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...ids, now: () => T0 })); doc = claim.document;
      if (mode === 'failed') doc = (await api.recordMarketplaceOutboxV2FailedAttempt(opts(root, { ...ids, payloadHash: get(doc, ids).r.payloadHash, attemptId: claim.attemptId, failureCode: 'http_500', httpStatus: 500, now: () => T0 }))).document;
      if (mode === 'published') doc = (await api.markMarketplaceOutboxV2Published(opts(root, { ...ids, payloadHash: get(doc, ids).r.payloadHash, attemptId: claim.attemptId, now: () => T0 }))).document;
    }
    const result = await enriched(root, { now: () => T1 }); assert.equal(result.status, 'staged_superseding');
    const old = get(result.document, ids).r;
    assert.equal(old.state, mode === 'published' ? 'superseded_published' : mode === 'posting' ? 'posting' : 'superseded_pending');
    assert.equal(old.supersededAt, T1); assert.equal(result.document.generations[ids.generationId].events[ids.eventId].currentRevisionId, result.revisionId);
    assert.equal((await fallback(root)).status, mode === 'posting' ? 'posting_in_progress'
      : mode === 'published' ? 'already_published' : mode === 'failed' ? 'pending_retryable' : 'pending_unattempted');
  });
  await temp(async (root) => { await configured(root); await enriched(root); assert.equal((await fallback(root)).status, 'older_representation_suppressed'); });
});

test('pending list, retry eligibility, claims and concurrent single claim are deterministic', async () => temp(async (root) => {
  await configured(root); const f = await fallback(root); const e = await enriched(root, { now: () => T1 });
  const listed = await api.listMarketplaceOutboxV2Pending(opts(root, { now: () => T2 })); assert.equal(listed.status, 'pending_listed');
  assert.deepEqual(listed.revisions.map(x => x.revisionKind), ['fallback','enriched']);
  const pair = await Promise.all([api.claimMarketplaceOutboxV2Revision(opts(root, { ...f })), api.claimMarketplaceOutboxV2Revision(opts(root, { ...f }))]);
  assert.deepEqual(pair.map(x => x.status).sort(), ['invalid_state','posting_claimed']);
  const winner = pair.find(x => x.status === 'posting_claimed'); const loaded = await api.loadMarketplaceOutboxV2(opts(root));
  assert.equal(get(loaded.document, f).r.state, 'posting');
  const failed = await api.recordMarketplaceOutboxV2FailedAttempt(opts(root, { ...f, payloadHash: get(loaded.document, f).r.payloadHash, attemptId: winner.attemptId, failureCode: 'definite_500', httpStatus: 500 }));
  assert.equal(failed.status, 'superseded_pending'); assert.equal(failed.nextAttemptAt, T1);
  assert.equal((await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f, now: () => '2026-08-01T06:00:00.999Z' }))).status, 'not_yet_retryable');
  assert.equal((await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f, now: () => T1 }))).status, 'posting_claimed');
  assert.ok(e.revisionId);
}));

test('exact attempts publish and fail current or superseded revisions idempotently', async () => temp(async (root) => {
  await configured(root); const f = await fallback(root); const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f }));
  assert.equal((await api.markMarketplaceOutboxV2Published(opts(root, { ...f, payloadHash: '0'.repeat(64), attemptId: claim.attemptId }))).status, 'attempt_mismatch');
  const posting = await api.loadMarketplaceOutboxV2(opts(root)); const payloadHash = get(posting.document, f).r.payloadHash;
  const published = await api.markMarketplaceOutboxV2Published(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, now: () => T1 }));
  assert.equal(published.status, 'published_current');
  const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot: root, ...BASE }); const bytes = await fs.readFile(paths.documentPath);
  assert.equal((await api.markMarketplaceOutboxV2Published(opts(root, { ...f, payloadHash, attemptId: claim.attemptId }))).status, 'already_published');
  assert.deepEqual(await fs.readFile(paths.documentPath), bytes);
  const en = await enriched(root, { now: () => T2 }); assert.equal(en.status, 'staged_superseding');
  assert.equal((await api.recordMarketplaceOutboxV2FailedAttempt(opts(root, { ...en, payloadHash: get(en.document, en).r.payloadHash, attemptId: '1'.repeat(64), failureCode: 'x', httpStatus: null }))).status, 'attempt_mismatch');
}));

test('posting inspection and all reconciliation outcomes preserve ambiguity', async () => temp(async (root) => {
  await configured(root); const f = await fallback(root); const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f }));
  let loaded = await api.loadMarketplaceOutboxV2(opts(root)); const payloadHash = get(loaded.document, f).r.payloadHash;
  assert.equal((await api.inspectMarketplaceOutboxV2Posting(opts(root))).revisions.length, 1);
  for (const outcome of ['mismatch','indeterminate']) {
    const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot: root, ...BASE }); const before = await fs.readFile(paths.documentPath);
    const result = await api.reconcileMarketplaceOutboxV2Revision(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, outcome }));
    assert.equal(result.status, `reconciliation_${outcome}`); assert.deepEqual(await fs.readFile(paths.documentPath), before);
  }
  const absent = await api.reconcileMarketplaceOutboxV2Revision(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, outcome: 'absent', now: () => T1 }));
  assert.equal(absent.status, 'reconciled_pending');
  const claim2 = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f, now: () => T1 }));
  const matched = await api.reconcileMarketplaceOutboxV2Revision(opts(root, { ...f, payloadHash, attemptId: claim2.attemptId, outcome: 'matched', now: () => T2 }));
  assert.equal(matched.status, 'reconciled_published_current');
}));

test('pre-rename failures preserve prior bytes for stage, claim, publish, failed attempt and reconcile', async () => temp(async (root) => {
  await configured(root); const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot: root, ...BASE });
  const hook = { beforeRename: async () => { throw new Error('injected'); } };
  let before = await fs.readFile(paths.documentPath);
  assert.equal((await fallback(root, { writeHooks: hook })).status, 'atomic_replace_failed'); assert.deepEqual(await fs.readFile(paths.documentPath), before);
  const f = await fallback(root); before = await fs.readFile(paths.documentPath);
  assert.equal((await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f, writeHooks: hook }))).status, 'atomic_replace_failed'); assert.deepEqual(await fs.readFile(paths.documentPath), before);
  const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f })); let loaded = await api.loadMarketplaceOutboxV2(opts(root)); const payloadHash = get(loaded.document, f).r.payloadHash; before = await fs.readFile(paths.documentPath);
  assert.equal((await api.markMarketplaceOutboxV2Published(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, writeHooks: hook }))).status, 'atomic_replace_failed'); assert.deepEqual(await fs.readFile(paths.documentPath), before);
  assert.equal((await api.recordMarketplaceOutboxV2FailedAttempt(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, failureCode: 'x', httpStatus: null, writeHooks: hook }))).status, 'atomic_replace_failed'); assert.deepEqual(await fs.readFile(paths.documentPath), before);
  assert.equal((await api.reconcileMarketplaceOutboxV2Revision(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, outcome: 'absent', writeHooks: hook }))).status, 'atomic_replace_failed'); assert.deepEqual(await fs.readFile(paths.documentPath), before);
}));

test('published-only generations drain but reject staging and process death stays posting', async () => temp(async (root) => {
  await configured(root); const f = await fallback(root); await api.setMarketplaceOutboxV2PublishedOnly(opts(root, { generationId: f.generationId }));
  assert.equal((await fallback(root, { generationId: f.generationId })).status, 'generation_not_writable');
  const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f })); assert.equal(claim.status, 'posting_claimed');
  const loaded = await api.loadMarketplaceOutboxV2(opts(root)); assert.equal(get(loaded.document, f).r.state, 'posting');
  assert.equal((await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f, now: () => '2030-01-01T00:00:00.000Z' }))).status, 'invalid_state');
}));

test('current and superseded failed/published attempts and superseded reconciliation use exact states', async () => {
  await temp(async (root) => {
    await configured(root); const f = await fallback(root); const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f }));
    const loaded = await api.loadMarketplaceOutboxV2(opts(root)); const payloadHash = get(loaded.document, f).r.payloadHash;
    const failed = await api.recordMarketplaceOutboxV2FailedAttempt(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, failureCode: 'definite', httpStatus: null }));
    assert.equal(failed.status, 'failed_retryable');
    assert.equal((await api.recordMarketplaceOutboxV2FailedAttempt(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, failureCode: 'definite', httpStatus: null }))).status, 'already_failed_attempt');
    assert.equal((await fallback(root)).status, 'pending_retryable');
  });
  await temp(async (root) => {
    await configured(root); const f = await fallback(root); const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f }));
    const posting = await api.loadMarketplaceOutboxV2(opts(root)); const payloadHash = get(posting.document, f).r.payloadHash;
    await enriched(root, { now: () => T1 });
    const done = await api.markMarketplaceOutboxV2Published(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, now: () => T2 }));
    assert.equal(done.status, 'published_superseded_revision'); assert.equal(get(done.document, f).r.state, 'superseded_published');
  });
  await temp(async (root) => {
    await configured(root); const f = await fallback(root); const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f }));
    const posting = await api.loadMarketplaceOutboxV2(opts(root)); const payloadHash = get(posting.document, f).r.payloadHash;
    await enriched(root, { now: () => T1 });
    const absent = await api.reconcileMarketplaceOutboxV2Revision(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, outcome: 'absent', now: () => T2 }));
    assert.equal(absent.status, 'reconciled_superseded_pending'); assert.equal(get(absent.document, f).r.state, 'superseded_pending');
  });
});

test('strict bounded inputs reject oversized lines, failure codes, pending limits and exhausted attempts', async () => temp(async (root) => {
  assert.throws(() => api.deriveMarketplaceOutboxV2PayloadHash('x'.repeat(8193)), error => error.code === 'invalid_payload');
  await configured(root); const f = await fallback(root);
  assert.equal((await api.listMarketplaceOutboxV2Pending(opts(root, { limit: 16001 }))).status, 'invalid_limit');
  const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f })); const loaded = await api.loadMarketplaceOutboxV2(opts(root)); const payloadHash = get(loaded.document, f).r.payloadHash;
  assert.equal((await api.recordMarketplaceOutboxV2FailedAttempt(opts(root, { ...f, payloadHash, attemptId: claim.attemptId, failureCode: 'x'.repeat(65), httpStatus: null }))).status, 'invalid_failure');
  const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot: root, ...BASE });
  const document = loaded.document; const revision = get(document, f).r; revision.attemptSequence = Number.MAX_SAFE_INTEGER; revision.state = 'pending'; revision.activeAttempt = null;
  await fs.writeFile(paths.documentPath, `${JSON.stringify(document, null, 2)}\n`);
  assert.equal((await api.claimMarketplaceOutboxV2Revision(opts(root, { ...f }))).status, 'attempt_sequence_exhausted');
}));

test('superseded fallback replay precedence is deterministic and byte-idempotent in all six cases', async () => {
  async function noMutation(root, beforeDocument, operation, expectedStatus) {
    const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot: root, ...BASE });
    const bytes = await fs.readFile(paths.documentPath);
    const result = await operation();
    assert.equal(result.status, expectedStatus);
    assert.equal(result.written, false);
    assert.equal(result.document.documentRevision, beforeDocument.documentRevision);
    assert.deepEqual(await fs.readFile(paths.documentPath), bytes);
  }

  await temp(async (root) => {
    await configured(root); const staged = await fallback(root); const superseded = await enriched(root, { now: () => T1 });
    await noMutation(root, superseded.document, () => fallback(root), 'pending_unattempted');
    assert.equal(get(superseded.document, staged).r.retryCount, 0);
  });

  await temp(async (root) => {
    await configured(root); const staged = await fallback(root); const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...staged }));
    const posting = await api.loadMarketplaceOutboxV2(opts(root));
    const failed = await api.recordMarketplaceOutboxV2FailedAttempt(opts(root, { ...staged, payloadHash: get(posting.document, staged).r.payloadHash,
      attemptId: claim.attemptId, failureCode: 'definite', httpStatus: null }));
    const superseded = await enriched(root, { now: () => T1 });
    await noMutation(root, superseded.document, () => fallback(root), 'pending_retryable');
    assert.equal(get(superseded.document, staged).r.retryCount, 1);
    assert.equal(failed.status, 'failed_retryable');
  });

  await temp(async (root) => {
    await configured(root); const staged = await fallback(root); const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...staged }));
    const posting = await api.loadMarketplaceOutboxV2(opts(root)); const payloadHash = get(posting.document, staged).r.payloadHash;
    await enriched(root, { now: () => T1 });
    const failed = await api.recordMarketplaceOutboxV2FailedAttempt(opts(root, { ...staged, payloadHash, attemptId: claim.attemptId,
      failureCode: 'definite', httpStatus: 500, now: () => T2 }));
    await noMutation(root, failed.document, () => fallback(root), 'pending_retryable');
    assert.equal(get(failed.document, staged).r.state, 'superseded_pending');
  });

  await temp(async (root) => {
    await configured(root); const first = await enriched(root); const paths = api.resolveMarketplaceOutboxV2Paths({ storageRoot: root, ...BASE });
    const bytes = await fs.readFile(paths.documentPath); const result = await fallback(root);
    assert.equal(result.status, 'older_representation_suppressed'); assert.equal(result.written, false);
    assert.equal(result.document.documentRevision, first.document.documentRevision); assert.deepEqual(await fs.readFile(paths.documentPath), bytes);
  });

  await temp(async (root) => {
    await configured(root); const staged = await fallback(root); const superseded = await enriched(root, { now: () => T1 });
    await noMutation(root, superseded.document, () => fallback(root, { fields: { ...FALLBACK, fallbackNetAtlas: 4 } }), 'identity_conflict');
    assert.equal(get(superseded.document, staged).r.state, 'superseded_pending');
  });

  await temp(async (root) => {
    await configured(root); const staged = await fallback(root); const claim = await api.claimMarketplaceOutboxV2Revision(opts(root, { ...staged }));
    const posting = await api.loadMarketplaceOutboxV2(opts(root)); const payloadHash = get(posting.document, staged).r.payloadHash;
    const published = await api.markMarketplaceOutboxV2Published(opts(root, { ...staged, payloadHash, attemptId: claim.attemptId }));
    const superseded = await enriched(root, { now: () => T1 });
    await noMutation(root, superseded.document, () => fallback(root), 'already_published');
    assert.equal(get(superseded.document, staged).r.state, 'superseded_published'); assert.equal(published.status, 'published_current');
  });
});
