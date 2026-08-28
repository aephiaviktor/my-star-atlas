'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const coordinatorModule = require('../electron/marketplace-publication-coordinator');
const outbox = require('../electron/marketplace-outbox-v2');
const { projectMarketplaceRevision } = require('../electron/marketplace-v2-point');
const { formatAssetFlowInfluxLine } = require('../electron/marketplace-asset-flow');
const checkpoint = require('../electron/marketplace-publication-checkpoint');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

function functionBody(name, next) {
  const start = main.indexOf(`async function ${name}`);
  const end = main.indexOf(next, start);
  assert.notEqual(start, -1, name);
  assert.notEqual(end, -1, next);
  return main.slice(start, end);
}

function loadPureIntegrationHelpers() {
  const start = main.indexOf('const MARKETPLACE_PUBLICATION_SUCCESS');
  const end = main.indexOf('async function resolveMarketplaceExactPoint', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = main.slice(start, end);
  const context = {};
  vm.runInNewContext(`${source}\nthis.mapResult = mapMarketplacePublicationResult; this.group = groupMarketplacePublicationCandidates; this.effectiveOutcome = marketplaceEffectiveCoordinatorOutcome;`, context);
  return context;
}

function loadLineParser() {
  const start = main.indexOf('function splitMarketplaceLinePart');
  const end = main.indexOf('async function resolveMarketplaceExactPoint', start);
  const context = {};
  vm.runInNewContext(`${main.slice(start, end)}\nthis.parseLine = parseMarketplaceLineForReconciliation;`, context);
  return context.parseLine;
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

const LM_MATRIX = [
  ['already_published', ['current-id'], false, ''],
  ['published_confirmed', ['current-id'], false, ''],
  ['published_current', ['current-id'], false, ''],
  ['published_current_uncertain_durability', ['current-id'], false, ''],
  ['published_superseded_revision', ['old-id'], true, ''],
  ['staged', [], true, ''],
  ['pending_unattempted', [], true, ''],
  ['pending_invocation_limit', [], true, ''],
  ['not_configured', [], true, ''],
  ['publication_failed', [], true, 'publication_failed'],
  ['publication_ambiguous', [], true, 'publication_ambiguous'],
  ['published_mark_failed', [], true, 'published_mark_failed'],
  ['mark_failed_before_commit', [], true, 'mark_failed_before_commit'],
  ['stage_failed', [], true, 'stage_failed'],
];

test('LM and GM-trade executable result matrices preserve revision-specific mutable IDs', () => {
  const { mapResult } = loadPureIntegrationHelpers();
  for (const kind of ['LM', 'GM']) {
    for (const [outcome, ids, retainHold, error] of LM_MATRIX) {
      const superseded = outcome === 'published_superseded_revision';
      const result = plain(mapResult({
        kind: 'trade', outcome, detailCode: outcome,
        revisionId: superseded ? 'old-revision' : 'current-revision',
        currentRevisionId: 'current-revision',
        currentMutableIds: ['current-id'], revisionMutableIds: ['old-id'],
      }));
      assert.deepEqual(result, { publishedIds: ids, retainHold, error }, `${kind}:${outcome}`);
    }
  }
});

test('not-configured staging is lossless and does not become a publication error', () => {
  const { effectiveOutcome, mapResult } = loadPureIntegrationHelpers();
  const outcome = effectiveOutcome({ outcome: 'stage_failed', detailCode: 'not_configured' }, false);
  assert.equal(outcome, 'not_configured');
  assert.deepEqual(plain(mapResult({ kind: 'trade', outcome })), {
    publishedIds: [], retainHold: true, error: '',
  });
});

test('GM-flow executable result matrix accepts only successful current event identity', () => {
  const { mapResult } = loadPureIntegrationHelpers();
  for (const outcome of ['already_published', 'published_confirmed']) {
    assert.deepEqual(plain(mapResult({
      kind: 'asset_flow', outcome, revisionId: 'current', currentRevisionId: 'current', flowId: 'flow-id',
    })), { publishedIds: ['flow-id'], retainHold: false, error: '' });
  }
  for (const outcome of ['staged', 'pending_unattempted', 'pending_invocation_limit', 'not_configured']) {
    assert.deepEqual(plain(mapResult({
      kind: 'asset_flow', outcome, revisionId: 'current', currentRevisionId: 'current', flowId: 'flow-id',
    })), { publishedIds: [], retainHold: true, error: '' }, outcome);
  }
  for (const outcome of ['publication_failed', 'publication_ambiguous', 'published_mark_failed', 'stage_failed']) {
    assert.deepEqual(plain(mapResult({
      kind: 'asset_flow', outcome, detailCode: outcome, revisionId: 'current', currentRevisionId: 'current', flowId: 'flow-id',
    })), { publishedIds: [], retainHold: true, error: outcome }, outcome);
  }
  assert.deepEqual(plain(mapResult({
    kind: 'asset_flow', outcome: 'published_superseded_revision', revisionId: 'old', currentRevisionId: 'current', flowId: 'flow-id',
  })), { publishedIds: [], retainHold: true, error: 'asset_flow_superseded_revision' });
});

test('candidate grouping is deterministic and keeps fallback and enriched representations separate', () => {
  const { group } = loadPureIntegrationHelpers();
  const groups = group([
    { logicalKey: 'b', currentId: 'b2', representationRank: 'enriched' },
    { logicalKey: 'a', currentId: 'a2', representationRank: 'enriched' },
    { logicalKey: 'a', currentId: 'a1', representationRank: 'fallback' },
  ]);
  assert.deepEqual(Array.from(groups.keys()), ['a', 'b']);
  assert.deepEqual(plain(groups.get('a').map((row) => [row.representationRank, row.currentId])), [
    ['fallback', 'a1'], ['enriched', 'a2'],
  ]);
});

test('exact-point reconciliation parses accepted trade and asset-flow payloads byte-exactly', () => {
  const parseLine = loadLineParser();
  const trade = projectMarketplaceRevision({
    identity: {
      market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: 'sig',
      rawMint: 'mint', side: 'buy', quantity: 2,
    },
    rank: 'fallback', pointTimestampNs: '1784941200000000000',
    fields: {
      fallbackQuantity: 2, fallbackSettledAtlas: 4, fallbackGrossAtlas: 4,
      fallbackMarketplaceFeeAtlas: 0, fallbackNetAtlas: 4, fallbackUnitPriceAtlas: 2,
      fallbackWallet: 'wallet', fallbackStarbase: 'UST-1', fallbackAsset: 'Food', fallbackCertificateMint: 'cert',
    },
  });
  const parsedTrade = plain(parseLine(trade.line));
  assert.equal(parsedTrade.measurement, 'marketplace_v2');
  assert.equal(parsedTrade.tags.tradeId, trade.tradeId);
  assert.equal(parsedTrade.fields.fallbackQuantity, 2);
  assert.equal(parsedTrade.pointTimestampNs, '1784941200000000000');

  const flow = {
    id: 'sig:0:deposit', timestamp: '2026-08-01T08:00:00.000Z', flow: 'css-deposit', asset: 'Food',
    origin: 'wallet:one', destination: 'UST-1', quantity: 3, txFeeAtlas: 0.1, signature: 'sig', rawMint: 'mint',
  };
  const parsedFlow = plain(parseLine(formatAssetFlowInfluxLine(flow)));
  assert.equal(parsedFlow.measurement, 'asset_flow');
  assert.equal(parsedFlow.tags.flowId, flow.id);
  assert.equal(parsedFlow.fields.signature, 'sig');
  assert.equal(parsedFlow.fields.quantity, 3);
});

test('production integration is limited to the two authorized fetch paths with no legacy-v1 publication fallback', () => {
  const local = functionBody('fetchLocalMarketTrades', 'async function fetchGlobalMarketTrades');
  const global = functionBody('fetchGlobalMarketTrades', 'let marketplaceSyncActive');
  for (const body of [local, global]) {
    assert.match(body, /publishMarketplaceCandidateSet/);
    assert.match(body, /commitSafeCursor/);
    assert.doesNotMatch(body, /writeInfluxLines\(/);
    assert.doesNotMatch(body, /formatLocalMarketInfluxLine\(/);
  }
  assert.equal((global.match(/publishMarketplaceCandidateSet\(/g) || []).length, 1);
  assert.match(global, /\.\.\.trades\.map[\s\S]*\.\.\.assetFlows\.map/);
});

test('checkpoint IDs are durable before hold completion and cursor release for LM and GM', () => {
  const local = functionBody('fetchLocalMarketTrades', 'async function fetchGlobalMarketTrades');
  const global = functionBody('fetchGlobalMarketTrades', 'let marketplaceSyncActive');
  for (const body of [local, global]) {
    const safeCheckpoint = body.indexOf('commitSafeCursor: () => writeJsonAtomic(filePath, safeCheckpointDocument)');
    const completion = body.indexOf('completeMarketplacePublicationHolds');
    const finalCheckpoint = body.lastIndexOf('await writeJsonAtomic(filePath');
    assert.ok(safeCheckpoint > 0 && safeCheckpoint < completion);
    assert.ok(completion < finalCheckpoint);
    assert.match(body, /\.\.\.cursorOutputSnapshot/);
  }
});

test('safe cursor is committed after durable retry holds and staging but before publish transport', () => {
  const start = main.indexOf('async function publishMarketplaceCandidateSet');
  const end = main.indexOf('async function completeMarketplacePublicationHolds', start);
  const body = main.slice(start, end);
  const firstHold = body.indexOf('recordMarketplacePublicationHold');
  const stageOnly = body.indexOf('const stagingCoordinator');
  const safeCheckpoint = body.indexOf('await commitSafeCursor()');
  const publishingCoordinator = body.indexOf('const coordinator = createMarketplacePublicationCoordinator', stageOnly);
  assert.ok(firstHold > 0 && firstHold < stageOnly);
  assert.ok(stageOnly < safeCheckpoint && safeCheckpoint < publishingCoordinator);
  assert.match(body, /fetchImpl: publicationSettings\.canPost && !stagingFailed \? fetch : undefined/);
  assert.match(body, /error: 'safe_cursor_checkpoint_failed', safeCursorCommitted: false/);
});

test('complete retry holds persist exact normalized input and permit restart reconstruction', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'msa-gate8-retry-'));
  try {
    const publicationInput = {
      eventType: 'trade', identity: { market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: 'sig', rawMint: 'mint', side: 'buy', quantity: 2 },
      pointTimestampNs: '1784941200000000000', sourceVersion: 'fallback_v1',
      fields: { fallbackQuantity: 2 },
    };
    const made = await checkpoint.recordMarketplacePublicationHold({
      installationRoot: root, now: '2026-08-01T00:00:00.000Z',
      candidate: {
        market: 'LM', kind: 'trade', logicalKeyOrSourceId: 'logical', currentRank: 'fallback', currentMutableIds: ['mutable'],
        candidateTimestamp: '2026-08-01T00:00:00.000Z', candidateSnapshot: { timestamp: '2026-08-01T00:00:00.000Z', publicationInputs: [{ currentId: 'mutable', representationRank: 'fallback', record: publicationInput }] },
        cursorInputSnapshot: {}, cursorOutputSnapshot: { walletCursors: { wallet: 'safe' } },
      },
    });
    assert.equal(made.status, 'hold_recorded');
    assert.deepEqual(made.hold.candidateSnapshot.publicationInputs[0].record, publicationInput);
    assert.equal(made.hold.candidateSnapshot.currentRank, 'fallback');
    assert.deepEqual(made.hold.candidateSnapshot.currentMutableIds, ['mutable']);
    assert.match(main, /candidateSnapshot\?\.publicationInputs/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('publication and release failures preserve the already-committed safe cursor', () => {
  const local = functionBody('fetchLocalMarketTrades', 'async function fetchGlobalMarketTrades');
  const global = functionBody('fetchGlobalMarketTrades', 'let marketplaceSyncActive');
  for (const body of [local, global]) {
    assert.match(body, /commitSafeCursor: \(\) => writeJsonAtomic\(filePath, safeCheckpointDocument\)/);
    assert.match(body, /\.\.\.checkpointDocument, savedAt: new Date\(\)\.toISOString\(\), \.\.\.cursorOutputSnapshot/);
    const afterSafeCommit = body.slice(body.indexOf('if (!publication.safeCursorCommitted)'));
    assert.doesNotMatch(afterSafeCommit, /\.\.\.cursorInputSnapshot/);
  }
});

test('GM trades and flows form one atomic cursor-safety boundary', () => {
  const global = functionBody('fetchGlobalMarketTrades', 'let marketplaceSyncActive');
  assert.equal((global.match(/commitSafeCursor:/g) || []).length, 1);
  assert.match(global, /\.\.\.trades\.map[\s\S]*\.\.\.assetFlows\.map[\s\S]*commitSafeCursor/);
  assert.match(global, /publishedTradeIds:[\s\S]*publishedFlowIds:[\s\S]*\.\.\.cursorOutputSnapshot/);
});

test('GM routine synchronization resumes durable wallet cursors and batches transactions', () => {
  const global = functionBody('fetchGlobalMarketTrades', 'let marketplaceSyncActive');
  assert.match(global, /marketplaceCursorSnapshot\(\s*checkpoint\.walletCursors,/);
  assert.equal((global.match(/transactionBatchSize: 5/g) || []).length, 2);
  assert.doesNotMatch(global, /walletCursors: \{\}, orderCursors: \{\}/);
  assert.match(global, /upstreamWalletCursors/);
  assert.match(global, /combinedGlobalScan/);
  assert.match(global, /resolveMarketplaceCheckpointCursors\(checkpoint, combinedGlobalScan\)/);
});

test('all candidates stage before first POST and one staging failure blocks every POST', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'msa-gate7-stage-'));
  try {
    const settings = {
      storageRoot: root, installationId: 'a'.repeat(64), applicationProfile: 'USTUR',
      baseUrl: 'https://example.com', bucket: 'bucket', organization: 'org', token: 'secret',
    };
    const identity = (signature) => ({
      market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: signature,
      rawMint: 'mint', side: 'buy', quantity: 2,
    });
    const fields = {
      fallbackQuantity: 2, fallbackSettledAtlas: 4, fallbackGrossAtlas: 4,
      fallbackMarketplaceFeeAtlas: 0, fallbackNetAtlas: 4, fallbackUnitPriceAtlas: 2,
      fallbackWallet: 'wallet', fallbackStarbase: 'UST-1', fallbackAsset: 'Food', fallbackCertificateMint: 'cert',
    };
    const candidates = ['one', 'two'].map((id) => ({
      currentId: id, representationRank: 'fallback',
      record: { eventType: 'trade', identity: identity(id), pointTimestampNs: '1784941200000000000', sourceVersion: 'fallback_v1', fields },
    }));
    const order = [];
    const api = {
      ...outbox,
      stageMarketplaceOutboxV2TradeRevision: async (...args) => {
        order.push('stage');
        return outbox.stageMarketplaceOutboxV2TradeRevision(...args);
      },
    };
    const coordinator = coordinatorModule.createMarketplacePublicationCoordinator({
      api, fetchImpl: async () => { order.push('post'); return { status: 204 }; },
    });
    await coordinator.publishMarketplaceCandidates({ settings, candidates });
    assert.deepEqual(order.slice(0, 3), ['stage', 'stage', 'post']);

    let posts = 0;
    const failingApi = {
      ...outbox,
      stageMarketplaceOutboxV2TradeRevision: async (options) => options.identity.executionSignature === 'two'
        ? { status: 'identity_conflict' }
        : outbox.stageMarketplaceOutboxV2TradeRevision(options),
    };
    const blocked = coordinatorModule.createMarketplacePublicationCoordinator({
      api: failingApi, fetchImpl: async () => { posts += 1; return { status: 204 }; },
    });
    const result = await blocked.publishMarketplaceCandidates({ settings, candidates });
    assert.equal(result.results[1].outcome, 'stage_failed');
    assert.equal(posts, 0);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('durable pending recovery still drains after more than 30 simulated days', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'msa-gate7-age-'));
  const T0 = '2026-08-01T00:00:00.000Z';
  const T31 = '2026-09-01T00:00:00.000Z';
  try {
    const settings = {
      storageRoot: root, installationId: 'b'.repeat(64), applicationProfile: 'USTUR',
      baseUrl: 'https://example.com', bucket: 'bucket', organization: 'org', token: 'secret',
    };
    const candidate = {
      currentId: 'current-id', representationRank: 'fallback',
      record: {
        eventType: 'trade',
        identity: { market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: 'sig', rawMint: 'mint', side: 'buy', quantity: 2 },
        pointTimestampNs: '1784941200000000000', sourceVersion: 'fallback_v1',
        fields: {
          fallbackQuantity: 2, fallbackSettledAtlas: 4, fallbackGrossAtlas: 4,
          fallbackMarketplaceFeeAtlas: 0, fallbackNetAtlas: 4, fallbackUnitPriceAtlas: 2,
          fallbackWallet: 'wallet', fallbackStarbase: 'UST-1', fallbackAsset: 'Food', fallbackCertificateMint: 'cert',
        },
      },
    };
    const staged = coordinatorModule.createMarketplacePublicationCoordinator({ now: () => T0 });
    assert.equal((await staged.publishMarketplaceCandidates({ settings, candidates: [candidate] })).results[0].outcome, 'pending_unattempted');
    let posts = 0;
    const recovered = coordinatorModule.createMarketplacePublicationCoordinator({
      now: () => T31, fetchImpl: async () => { posts += 1; return { status: 204 }; },
    });
    await recovered.publishMarketplaceCandidates({ settings, candidates: [] });
    assert.equal(posts, 1);
    const loaded = await outbox.loadMarketplaceOutboxV2({ storageRoot: root, installationId: settings.installationId, applicationProfile: 'USTUR' });
    const revision = Object.values(Object.values(loaded.document.generations)[0].events)[0].revisions;
    assert.equal(Object.values(revision)[0].state, 'published');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('checkpoint failure keeps the hold active and discovery cursors at safe input', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'msa-gate7-checkpoint-'));
  try {
    const input = { walletCursors: { wallet: 'old' }, orderCursors: { order: 'old' }, activeOrderIds: [], archivedOrderIds: [] };
    const output = { walletCursors: { wallet: 'new' }, orderCursors: { order: 'new' }, activeOrderIds: [], archivedOrderIds: [] };
    const made = await checkpoint.recordMarketplacePublicationHold({
      installationRoot: root, now: '2026-08-01T00:00:00.000Z',
      candidate: {
        market: 'LM', kind: 'trade', logicalKeyOrSourceId: 'logical', eventId: 'event',
        currentRevisionId: 'revision', currentRank: 'fallback', currentMutableIds: ['mutable'],
        candidateTimestamp: '2026-08-01T00:00:00.000Z', candidateSnapshot: { timestamp: '2026-08-01T00:00:00.000Z' },
        cursorInputSnapshot: input, cursorOutputSnapshot: output,
      },
    });
    const incomplete = await checkpoint.completeMarketplacePublicationHold({
      installationRoot: root, holdId: made.hold.holdId, checkpointWritten: false,
      currentRevisionPublished: true, mutableIdsRecorded: true, reconciliationClear: true,
    });
    assert.equal(incomplete.status, 'checkpoint_not_durable');
    const cursors = await checkpoint.resolveMarketplaceDiscoveryCursors({
      installationRoot: root, market: 'LM', kinds: ['trade'],
      cursorInputSnapshot: input, cursorOutputSnapshot: output, holdWriteSucceeded: true,
    });
    assert.equal(cursors.status, 'held');
    assert.deepEqual(cursors.cursorSnapshot, input);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('restart and sync recovery use durable outbox and holds without scanner rows or blind repost', () => {
  const recoveryStart = main.indexOf('async function recoverMarketplacePublication');
  const recoveryEnd = main.indexOf('async function fetchLocalMarketTrades', recoveryStart);
  const recovery = main.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /publishMarketplaceCandidates\(\{ settings: coordinatorSettings, candidates: retryCandidates \}\)/);
  assert.match(recovery, /candidateSnapshot\?\.publicationInputs/);
  assert.match(recovery, /loadMarketplacePublicationHolds/);
  assert.match(recovery, /loadMarketplaceOutboxV2/);
  assert.match(recovery, /persistRecoveredMarketplaceIds/);
  assert.match(recovery, /checkpointWritten: true/);
  assert.match(main, /await recoverMarketplacePublication\(settings\)/);
  assert.match(main, /app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*recoverMarketplacePublication\(await readSettings\(\)\)/);
  assert.match(main, /resolveMarketplaceExactPoint/);
  assert.doesNotMatch(recovery, /scanLocalMarketTrades/);
});

test('backfill, enrichment, and GM trade-flow cursor interlock formulas remain explicit', () => {
  const local = functionBody('fetchLocalMarketTrades', 'async function fetchGlobalMarketTrades');
  const global = functionBody('fetchGlobalMarketTrades', 'let marketplaceSyncActive');
  assert.match(local, /marketplaceBackfilledNext = publication\.allCurrentComplete && holdsCompleted && !hasActiveTradeHold/);
  assert.match(local, /scanned\.stats\.transactionMisses === 0 && publishError === '' && publication\.allEnrichableComplete/);
  assert.match(global, /marketplaceBackfilledNext = publication\.allTradeCurrentComplete && tradeHoldsCompleted && !hasActiveTradeHold/);
  assert.match(global, /assetFlowBackfilledNext = combinedGlobalScan\.stats\.transactionMisses === 0 && publishError === ''/);
  assert.match(global, /\.\.\.trades\.map[\s\S]*\.\.\.assetFlows\.map/);
  assert.match(global, /tradeEnrichmentVersion: checkpoint\.tradeEnrichmentVersion/);
});

test('marketplace publication normalizes a configured Influx write URL to its base host', () => {
  const start = main.indexOf('function marketplacePublicationSettings');
  const end = main.indexOf('async function resolveMarketplacePublicationOrganization', start);
  const body = main.slice(start, end);
  assert.match(body, /baseUrl: getInfluxBaseUrl\(settings\.influxUrl\)/);
  assert.doesNotMatch(body, /baseUrl: String\(settings\.influxUrl/);
  const organizationStart = main.indexOf('async function resolveMarketplacePublicationOrganization');
  const organizationEnd = main.indexOf('async function writeInventoryBasisLinesToInflux', organizationStart);
  const organizationBody = main.slice(organizationStart, organizationEnd);
  assert.match(organizationBody, /resolveInfluxOrgId\(getInfluxBaseUrl\(settings\.influxUrl\), token, settings\.influxBucket\)/);
});

test('configuration and persisted diagnostics are bounded and secret-free', () => {
  assert.match(main, /token: realToken \|\| 'staging-only'/);
  assert.match(main, /canPost: Boolean\(realToken && organization\)/);
  assert.match(main, /\^\[A-Za-z0-9_.-\]\{1,64\}\$/);
  const checkpointModule = fs.readFileSync(path.join(__dirname, '..', 'electron', 'marketplace-publication-checkpoint.js'), 'utf8');
  assert.doesNotMatch(checkpointModule, /fetch\(|POST|publishMarketplaceCandidates/);
});
