'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const api = require('../electron/marketplace-publication-checkpoint');

const T0 = '2026-08-01T00:00:00.000Z';
const T1 = '2026-08-02T00:00:00.000Z';
const T31 = '2026-09-01T00:00:00.000Z';
const input = { walletCursors: { wallet: 'old' }, orderCursors: { order: 'old' }, activeOrderIds: ['active-old'], archivedOrderIds: ['archived-old'] };
const output = { walletCursors: { wallet: 'new' }, orderCursors: { order: 'new' }, activeOrderIds: ['active-new'], archivedOrderIds: ['archived-new'] };
let roots = [];
async function root() { const value = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-holds-')); roots.push(value); return value; }
test.after(async () => { await Promise.all(roots.splice(0).map((value) => fs.rm(value, { recursive: true, force: true }))); });
function trade(overrides = {}) {
  return {
    market: 'LM', kind: 'trade', logicalKeyOrSourceId: 'stable-trade-key', eventId: null, currentRevisionId: null,
    currentRank: 'fallback', currentMutableIds: ['mutable-fallback'], candidateTimestamp: T0,
    candidateSnapshot: { id: 'mutable-fallback', timestamp: T0, signature: 'signature', rawMint: 'mint', side: 'buy', quantity: 2 },
    cursorInputSnapshot: input, cursorOutputSnapshot: output, ...overrides,
  };
}
function flow(overrides = {}) {
  return {
    market: 'GM', kind: 'asset_flow', logicalKeyOrSourceId: 'flow-source', eventId: null, currentRevisionId: null,
    currentRank: 'asset_flow', currentMutableIds: [], observedFlowIds: ['flow-id'], candidateTimestamp: T0,
    candidateSnapshot: { id: 'flow-id', type: 'transfer', timestamp: T0, origin: 'a', destination: 'b', asset: 'Food', quantity: 1, cargoCost: 0 },
    cursorInputSnapshot: input, cursorOutputSnapshot: output, ...overrides,
  };
}
async function record(installationRoot, candidate = trade(), now = T0, extra = {}) {
  return api.recordMarketplacePublicationHold({ installationRoot, candidate, now, ...extra });
}
async function loaded(installationRoot) { return api.loadMarketplacePublicationHolds({ installationRoot }); }

 test('hold API exports exactly the authorized set', () => {
  assert.deepEqual(Object.keys(api).sort(), [
    'loadMarketplacePublicationHolds','recordMarketplacePublicationHold','updateMarketplacePublicationHold',
    'resolveMarketplaceDiscoveryCursors','listMarketplaceReconciliationWork','releaseMarketplacePublicationHold',
    'completeMarketplacePublicationHold',
  ].sort());
});

test('hold storage uses the exact versioned schema and canonical installation-root path', async () => {
  const installationRoot = await root();
  const result = await record(installationRoot);
  assert.equal(result.status, 'hold_recorded');
  const state = await loaded(installationRoot);
  assert.equal(state.status, 'loaded'); assert.equal(state.document.schemaVersion, 1);
  assert.equal(state.paths.documentPath, path.join(installationRoot, 'data', 'marketplace-publication', 'publication-holds-v1.json'));
  assert.equal(state.paths.lockPath, `${state.paths.documentPath}.lock-target`);
  const hold = Object.values(state.document.holds)[0];
  assert.deepEqual(Object.keys(hold).sort(), ['candidateSnapshot','candidateTimestamp','createdAt','currentRevisionId','cursorInputSnapshot','cursorOutputSnapshot','eventId','firstSeenAt','holdId','kind','lastCoordinatorResult','lastSeenAt','logicalKeyOrSourceId','market','observedFlowIds','observedMutableIdsByRank','observedMutableIdsByRevision','releaseConditions','retry','state','updatedAt'].sort());
  assert.equal(hold.eventId, null); assert.equal(hold.currentRevisionId, null); assert.equal(hold.state, 'held_not_configured');
});

test('identical hold recording is idempotent and deterministic hold ordering is stable', async () => {
  const installationRoot = await root();
  const first = await record(installationRoot); const bytes = await fs.readFile((await loaded(installationRoot)).paths.documentPath);
  const second = await record(installationRoot); const sameBytes = await fs.readFile((await loaded(installationRoot)).paths.documentPath);
  assert.equal(first.status, 'hold_recorded'); assert.equal(second.status, 'hold_unchanged'); assert.deepEqual(sameBytes, bytes);
  await record(installationRoot, trade({ logicalKeyOrSourceId: 'aaa', currentMutableIds: ['a'] }), T1);
  const state = await loaded(installationRoot); const keys = Object.keys(state.document.holds); assert.deepEqual(keys, [...keys].sort());
});

test('repeated hold sightings union current mutable IDs into explicit revision and rank histories', async () => {
  const installationRoot = await root();
  const fallback = await record(installationRoot, trade({
    currentRevisionId: 'fallback-revision',
    currentMutableIds: ['mutable-fallback', 'mutable-fallback'],
    observedMutableIdsByRevision: { 'fallback-revision': ['fallback-id', 'fallback-id'] },
    observedMutableIdsByRank: { fallback: ['mutable-fallback', 'mutable-fallback'] },
  }), T0);
  assert.deepEqual(fallback.hold.observedMutableIdsByRevision, {
    'fallback-revision': ['fallback-id', 'mutable-fallback'],
  });
  assert.deepEqual(fallback.hold.observedMutableIdsByRank, { fallback: ['mutable-fallback'] });

  const enriched = await record(installationRoot, trade({
    currentRank: 'enriched', currentRevisionId: 'enriched-revision', currentMutableIds: ['enriched-id', 'enriched-id'],
    cursorInputSnapshot: { ...input, walletCursors: { wallet: 'unsafe-later' } },
    observedMutableIdsByRevision: { 'enriched-revision': ['enriched-id', 'enriched-id'] },
    observedMutableIdsByRank: { enriched: ['enriched-id', 'enriched-id'] },
    candidateSnapshot: { id: 'enriched-id', timestamp: T1, orderId: 'order', signature: 'signature', rawMint: 'mint', side: 'buy', quantity: 2 },
    candidateTimestamp: T1,
  }), T1);
  assert.equal(enriched.status, 'hold_updated');
  assert.equal(enriched.hold.currentRevisionId, 'enriched-revision');
  assert.deepEqual(enriched.hold.candidateSnapshot.currentRevisionId, 'enriched-revision');
  assert.equal(enriched.hold.candidateSnapshot.currentRank, 'enriched');
  assert.deepEqual(enriched.hold.candidateSnapshot.currentMutableIds, ['enriched-id']);
  assert.deepEqual(enriched.hold.observedMutableIdsByRevision, {
    'enriched-revision': ['enriched-id'],
    'fallback-revision': ['fallback-id', 'mutable-fallback'],
  });
  assert.deepEqual(enriched.hold.observedMutableIdsByRank, {
    enriched: ['enriched-id'], fallback: ['mutable-fallback'],
  });
  assert.deepEqual(enriched.hold.cursorInputSnapshot, input);

  await api.updateMarketplacePublicationHold({
    installationRoot, holdId: enriched.hold.holdId, now: T1,
    lastCoordinatorResult: { outcome: 'publication_ambiguous', detailCode: null },
  });
  const reloaded = (await loaded(installationRoot)).document.holds[enriched.hold.holdId];
  assert.equal(reloaded.candidateSnapshot.currentRank, 'enriched');
  assert.deepEqual(reloaded.candidateSnapshot.currentMutableIds, ['enriched-id']);
  assert.deepEqual(reloaded.observedMutableIdsByRevision, enriched.hold.observedMutableIdsByRevision);
  assert.deepEqual(reloaded.observedMutableIdsByRank, enriched.hold.observedMutableIdsByRank);
  const work = await api.listMarketplaceReconciliationWork({ installationRoot });
  assert.equal(work.work[0].currentRevisionId, 'enriched-revision');
  assert.equal(work.work[0].candidateSnapshot.currentRank, 'enriched');
  assert.deepEqual(work.work[0].candidateSnapshot.currentMutableIds, ['enriched-id']);
  await api.completeMarketplacePublicationHold({
    installationRoot, holdId: enriched.hold.holdId, checkpointWritten: true,
    currentRevisionPublished: true, mutableIdsRecorded: true, reconciliationClear: true, now: T31,
  });
  const released = (await loaded(installationRoot)).document.holds[enriched.hold.holdId];
  assert.equal(released.currentRevisionId, 'enriched-revision');
  assert.equal(released.candidateSnapshot.currentRank, 'enriched');
  assert.deepEqual(released.candidateSnapshot.currentMutableIds, ['enriched-id']);
});

test('null current revision and rank create no keys and enriched-only rows invent no fallback IDs', async () => {
  const installationRoot = await root();
  const nullTuple = await record(installationRoot, trade({
    logicalKeyOrSourceId: 'null-tuple', currentRevisionId: null, currentRank: null,
    currentMutableIds: ['orphan-id', 'orphan-id'], observedMutableIdsByRevision: {}, observedMutableIdsByRank: {},
  }));
  assert.deepEqual(nullTuple.hold.observedMutableIdsByRevision, {});
  assert.deepEqual(nullTuple.hold.observedMutableIdsByRank, {});

  const enrichedOnly = await record(installationRoot, trade({
    logicalKeyOrSourceId: 'enriched-only', currentRevisionId: 'enriched-revision', currentRank: 'enriched',
    currentMutableIds: ['enriched-id'], observedMutableIdsByRevision: {}, observedMutableIdsByRank: {},
    candidateSnapshot: { id: 'enriched-id', timestamp: T1 }, candidateTimestamp: T1,
  }), T1);
  assert.deepEqual(enrichedOnly.hold.observedMutableIdsByRevision, { 'enriched-revision': ['enriched-id'] });
  assert.deepEqual(enrichedOnly.hold.observedMutableIdsByRank, { enriched: ['enriched-id'] });
  assert.equal(JSON.stringify(enrichedOnly.hold).includes('fallback'), false);
});

test('LM and GM trade/flow holds remain isolated and flow mapping is exactly one source event id', async () => {
  const installationRoot = await root();
  await record(installationRoot, trade());
  await record(installationRoot, trade({ market: 'GM', logicalKeyOrSourceId: 'gm-trade' }));
  await record(installationRoot, flow());
  const holds = Object.values((await loaded(installationRoot)).document.holds);
  assert.equal(holds.length, 3);
  assert.deepEqual(holds.find((hold) => hold.kind === 'asset_flow').observedFlowIds, ['flow-id']);
  assert.equal(new Set(holds.map((hold) => `${hold.market}:${hold.kind}:${hold.logicalKeyOrSourceId}`)).size, 3);
});

test('atomic hold replacement failure preserves previous evidence and compatible lock serializes writers', async () => {
  const installationRoot = await root();
  await record(installationRoot); const state = await loaded(installationRoot); const before = await fs.readFile(state.paths.documentPath);
  const failed = await record(installationRoot, trade({ candidateSnapshot: { id: 'new', timestamp: T1 } }), T1, { writeHooks: { beforeRename: async () => { throw new Error('raw secret failure https://secret.invalid'); } } });
  assert.equal(failed.status, 'atomic_replace_failed'); assert.deepEqual(await fs.readFile(state.paths.documentPath), before);
  const [left, right] = await Promise.all([
    record(installationRoot, trade({ logicalKeyOrSourceId: 'left' }), T1),
    record(installationRoot, trade({ logicalKeyOrSourceId: 'right' }), T1),
  ]);
  assert.equal(left.status, 'hold_recorded'); assert.equal(right.status, 'hold_recorded'); assert.equal(Object.keys((await loaded(installationRoot)).document.holds).length, 3);
});

test('corrupt or unsupported hold state preserves original evidence and fails closed', async () => {
  for (const content of ['not-json', '{"schemaVersion":99,"updatedAt":"2026-08-01T00:00:00.000Z","holds":{}}']) {
    const installationRoot = await root(); const file = path.join(installationRoot, 'data', 'marketplace-publication', 'publication-holds-v1.json');
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); const before = await fs.readFile(file);
    const result = await record(installationRoot); assert.ok(['corrupt_json','unsupported_version'].includes(result.status)); assert.deepEqual(await fs.readFile(file), before);
  }
});

test('not configured hold survives restart, scanner disappearance, and more than 30 days', async () => {
  const installationRoot = await root(); await record(installationRoot);
  const restarted = await loaded(installationRoot); const holdId = Object.keys(restarted.document.holds)[0];
  await api.updateMarketplacePublicationHold({ installationRoot, holdId, now: T31, state: 'held_not_configured' });
  const after = await loaded(installationRoot); assert.equal(after.document.holds[holdId].state, 'held_not_configured'); assert.deepEqual(after.document.holds[holdId].candidateSnapshot.id, 'mutable-fallback');
  assert.equal((await api.updateMarketplacePublicationHold({ installationRoot, holdId, now: T31, state: 'abandoned' })).status, 'conclusive_decision_required');
  assert.equal((await api.updateMarketplacePublicationHold({ installationRoot, holdId, now: T31, state: 'abandoned', conclusive: true })).hold.state, 'abandoned');
});

test('posting, ambiguous, and mark failed holds remain active reconciliation work and are never age-released', async () => {
  for (const state of ['held_posting','held_ambiguous','held_mark_failed']) {
    const installationRoot = await root(); const made = await record(installationRoot);
    const outcome = state === 'held_posting' ? 'posting' : state === 'held_ambiguous' ? 'publication_ambiguous' : 'published_mark_failed';
    await api.updateMarketplacePublicationHold({ installationRoot, holdId: made.hold.holdId, now: T31, lastCoordinatorResult: { outcome, detailCode: 'bounded_code' } });
    const work = await api.listMarketplaceReconciliationWork({ installationRoot });
    assert.equal(work.work.length, 1); assert.equal(work.work[0].state, state);
    assert.equal((await loaded(installationRoot)).document.holds[made.hold.holdId].state, state);
  }
});

test('all three release conditions and durable checkpoint are required', async () => {
  const installationRoot = await root(); const made = await record(installationRoot); const holdId = made.hold.holdId;
  assert.equal((await api.releaseMarketplacePublicationHold({ installationRoot, holdId, now: T1 })).status, 'release_conditions_not_met');
  assert.equal((await api.completeMarketplacePublicationHold({ installationRoot, holdId, checkpointWritten: false, currentRevisionPublished: true, mutableIdsRecorded: true, reconciliationClear: true, now: T1 })).status, 'checkpoint_not_durable');
  assert.equal((await api.updateMarketplacePublicationHold({ installationRoot, holdId, releaseConditions: { mutableIdsRecorded: true }, now: T1 })).status, 'checkpoint_not_durable');
  const partial = await api.completeMarketplacePublicationHold({ installationRoot, holdId, checkpointWritten: true, currentRevisionPublished: true, mutableIdsRecorded: false, reconciliationClear: true, now: T1 });
  assert.equal(partial.status, 'release_conditions_not_met');
  const complete = await api.completeMarketplacePublicationHold({ installationRoot, holdId, checkpointWritten: true, currentRevisionPublished: true, mutableIdsRecorded: true, reconciliationClear: true, now: T31 });
  assert.equal(complete.status, 'released'); assert.equal(complete.hold.state, 'released');
});

test('superseded revision records only observed IDs and current publication remains held until checkpoint completion', async () => {
  const installationRoot = await root(); const made = await record(installationRoot, trade({ currentRevisionId: 'current', observedMutableIdsByRevision: { current: ['current-id'] } }));
  const updated = await api.updateMarketplacePublicationHold({ installationRoot, holdId: made.hold.holdId, now: T1, observedMutableIdsByRevision: { superseded: ['superseded-id'] }, lastCoordinatorResult: { outcome: 'published_superseded_revision', detailCode: null } });
  assert.deepEqual(updated.hold.observedMutableIdsByRevision.superseded, ['superseded-id']); assert.deepEqual(updated.hold.observedMutableIdsByRevision.current, ['current-id', 'mutable-fallback']);
  assert.equal((await api.releaseMarketplacePublicationHold({ installationRoot, holdId: made.hold.holdId, now: T31 })).status, 'release_conditions_not_met');
});

test('active LM hold retains input cursors; released hold permits output; transaction misses preserve prior wallet cursor', async () => {
  const installationRoot = await root(); const made = await record(installationRoot);
  const laterInput = { ...input, walletCursors: { wallet: 'unsafe-later' } };
  let result = await api.resolveMarketplaceDiscoveryCursors({ installationRoot, market: 'LM', kinds: ['trade'], cursorInputSnapshot: laterInput, cursorOutputSnapshot: output, transactionMisses: 0, holdWriteSucceeded: true });
  assert.equal(result.status, 'held'); assert.deepEqual(result.cursorSnapshot, input);
  await api.completeMarketplacePublicationHold({ installationRoot, holdId: made.hold.holdId, checkpointWritten: true, currentRevisionPublished: true, mutableIdsRecorded: true, reconciliationClear: true, now: T1 });
  result = await api.resolveMarketplaceDiscoveryCursors({ installationRoot, market: 'LM', kinds: ['trade'], cursorInputSnapshot: input, cursorOutputSnapshot: output, transactionMisses: 0, holdWriteSucceeded: true });
  assert.equal(result.status, 'released'); assert.deepEqual(result.cursorSnapshot, output);
  result = await api.resolveMarketplaceDiscoveryCursors({ holds: [], market: 'LM', kinds: ['trade'], cursorInputSnapshot: input, cursorOutputSnapshot: output, transactionMisses: 2, holdWriteSucceeded: true });
  assert.equal(result.status, 'transaction_misses'); assert.deepEqual(result.cursorSnapshot.walletCursors, input.walletCursors); assert.deepEqual(result.cursorSnapshot.orderCursors, output.orderCursors);
});

test('either unresolved GM trade or flow hold retains input cursors and both must clear', async () => {
  const installationRoot = await root(); const gmTrade = await record(installationRoot, trade({ market: 'GM', logicalKeyOrSourceId: 'gm-trade' })); const gmFlow = await record(installationRoot, flow());
  const args = { installationRoot, market: 'GM', kinds: ['trade','asset_flow'], cursorInputSnapshot: input, cursorOutputSnapshot: output, holdWriteSucceeded: true };
  assert.equal((await api.resolveMarketplaceDiscoveryCursors(args)).status, 'held');
  await api.completeMarketplacePublicationHold({ installationRoot, holdId: gmTrade.hold.holdId, checkpointWritten: true, currentRevisionPublished: true, mutableIdsRecorded: true, reconciliationClear: true, now: T1 });
  assert.equal((await api.resolveMarketplaceDiscoveryCursors(args)).status, 'held');
  await api.completeMarketplacePublicationHold({ installationRoot, holdId: gmFlow.hold.holdId, checkpointWritten: true, currentRevisionPublished: true, mutableIdsRecorded: true, reconciliationClear: true, now: T1 });
  assert.equal((await api.resolveMarketplaceDiscoveryCursors(args)).status, 'released');
});

test('hold-write failure retains cursor input and a committed hold before cursor crash safely rediscoveries', async () => {
  const installationRoot = await root();
  const failed = await api.resolveMarketplaceDiscoveryCursors({ holds: [], market: 'LM', cursorInputSnapshot: input, cursorOutputSnapshot: output, holdWriteSucceeded: false });
  assert.equal(failed.status, 'hold_write_failed'); assert.deepEqual(failed.cursorSnapshot, input);
  await record(installationRoot);
  const afterCrash = await api.resolveMarketplaceDiscoveryCursors({ installationRoot, market: 'LM', cursorInputSnapshot: input, cursorOutputSnapshot: output, holdWriteSucceeded: true });
  assert.equal(afterCrash.status, 'held'); assert.deepEqual(afterCrash.cursorSnapshot, input);
});

test('tokens URLs raw responses exceptions and unbounded diagnostics are absent from hold persistence and results', async () => {
  const installationRoot = await root();
  for (const candidateSnapshot of [{ token: 'secret' }, { rpcUrl: 'https://secret.invalid' }, { responseBody: 'secret' }, { rawException: 'secret' }]) {
    const result = await record(installationRoot, trade({ logicalKeyOrSourceId: `key-${Object.keys(candidateSnapshot)[0]}`, candidateSnapshot }));
    assert.equal(result.status, 'sensitive_snapshot'); assert.equal(JSON.stringify(result).includes('secret'), false);
  }
  await record(installationRoot); const text = await fs.readFile((await loaded(installationRoot)).paths.documentPath, 'utf8');
  assert.equal(/https?:\/\/|authorization|token|responseBody|rawException/i.test(text), false);
});

test('hold module contains no network, POST, v2 staging, coordinator, or remote resolver operation', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'electron', 'marketplace-publication-checkpoint.js'), 'utf8');
  for (const forbidden of ['fetch(', 'POST', 'stageMarketplaceOutboxV2', 'createMarketplacePublicationCoordinator', 'publishMarketplaceCandidates', 'resolveExactPoint']) assert.equal(source.includes(forbidden), false, forbidden);
});
