'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const point = require('../electron/marketplace-v2-point');

const {
  MARKETPLACE_V2_MEASUREMENT,
  MARKETPLACE_V2_TAG_KEYS,
  FALLBACK_FIELD_KEYS,
  ENRICHED_FIELD_KEYS,
  sanitizeMarketplaceProfileScope,
  canonicalMarketplaceQuantity,
  canonicalInfluxNumber,
  deriveMarketplaceTradeId,
  deriveMarketplaceIdentityHash,
  deriveMarketplaceTradeIdentity,
  projectMarketplaceRevision,
  formatMarketplaceV2Line,
} = point;

const FALLBACK_FIELDS = Object.freeze({
  fallbackQuantity: 10,
  fallbackSettledAtlas: 5,
  fallbackGrossAtlas: 5,
  fallbackMarketplaceFeeAtlas: 0,
  fallbackNetAtlas: 5,
  fallbackUnitPriceAtlas: 0.5,
  fallbackWallet: 'wallet1',
  fallbackStarbase: 'UST-1',
  fallbackAsset: 'Food',
  fallbackCertificateMint: 'cert1',
});

const ENRICHED_FIELDS = Object.freeze({
  enrichedQuantity: 10,
  enrichedSettledAtlas: 5.03,
  enrichedGrossAtlas: 5,
  enrichedMarketplaceFeeAtlas: 0.02,
  enrichedTxFeeAtlas: 0.01,
  enrichedNetAtlas: 5.03,
  enrichedUnitPriceAtlas: 0.5,
  enrichedWallet: 'wallet1',
  enrichedStarbase: 'UST-1',
  enrichedAsset: 'Food',
  enrichedCertificateMint: 'cert1',
  enrichedOrderId: 'order1',
  enrichedCreationSignature: 'create1',
});

const IDENTITY_INPUT = Object.freeze({
  market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: '5abc',
  rawMint: 'ATLASmint', side: 'buy', quantity: 10,
});

const TIMESTAMP = '1784941200000000000';
const TRADE_ID = 'd5648b6ce76b6566c435a7baac995380d69fef4616e948a8e94f60823c52fcf2';

function errorCode(callback) {
  try { callback(); } catch (error) { return error?.code; }
  return null;
}

function pointIdentity(line) {
  const firstSpace = line.indexOf(' ');
  const lastSpace = line.lastIndexOf(' ');
  return `${line.slice(0, firstSpace)} ${line.slice(lastSpace + 1)}`;
}

test('exports the exact measurement, immutable tag order, and disjoint field orders', () => {
  assert.equal(MARKETPLACE_V2_MEASUREMENT, 'marketplace_v2');
  assert.deepEqual(MARKETPLACE_V2_TAG_KEYS, [
    'market', 'faction', 'profile', 'executionSignature', 'rawMint', 'side', 'tradeId',
  ]);
  assert.deepEqual(FALLBACK_FIELD_KEYS, Object.keys(FALLBACK_FIELDS));
  assert.deepEqual(ENRICHED_FIELD_KEYS, Object.keys(ENRICHED_FIELDS));
  assert.equal(FALLBACK_FIELD_KEYS.some((key) => ENRICHED_FIELD_KEYS.includes(key)), false);
  assert.equal(Object.isFrozen(MARKETPLACE_V2_TAG_KEYS), true);
  assert.equal(Object.isFrozen(FALLBACK_FIELD_KEYS), true);
  assert.equal(Object.isFrozen(ENRICHED_FIELD_KEYS), true);
});

test('derives the required tradeId from the exact canonical tuple', () => {
  const expectedBytes = JSON.stringify([
    'msa-marketplace-logical-trade:v2', 'LM', 'USTUR', 'USTUR', '5abc', 'ATLASmint', 'buy', '10',
  ]);
  assert.equal(deriveMarketplaceTradeId(IDENTITY_INPUT), TRADE_ID);
  assert.equal(TRADE_ID, crypto.createHash('sha256').update(expectedBytes, 'utf8').digest('hex'));
});

test('formats the representative fallback and enriched lines exactly', () => {
  const fallback = projectMarketplaceRevision({
    identity: IDENTITY_INPUT, rank: 'fallback', fields: FALLBACK_FIELDS, pointTimestampNs: TIMESTAMP,
  });
  const enriched = projectMarketplaceRevision({
    identity: IDENTITY_INPUT, rank: 'enriched', fields: ENRICHED_FIELDS, pointTimestampNs: TIMESTAMP,
  });
  assert.equal(fallback.line,
    `marketplace_v2,market=LM,faction=USTUR,profile=USTUR,executionSignature=5abc,rawMint=ATLASmint,side=buy,tradeId=${TRADE_ID} fallbackQuantity=10,fallbackSettledAtlas=5,fallbackGrossAtlas=5,fallbackMarketplaceFeeAtlas=0,fallbackNetAtlas=5,fallbackUnitPriceAtlas=0.5,fallbackWallet="wallet1",fallbackStarbase="UST-1",fallbackAsset="Food",fallbackCertificateMint="cert1" ${TIMESTAMP}`);
  assert.equal(enriched.line,
    `marketplace_v2,market=LM,faction=USTUR,profile=USTUR,executionSignature=5abc,rawMint=ATLASmint,side=buy,tradeId=${TRADE_ID} enrichedQuantity=10,enrichedSettledAtlas=5.03,enrichedGrossAtlas=5,enrichedMarketplaceFeeAtlas=0.02,enrichedTxFeeAtlas=0.01,enrichedNetAtlas=5.03,enrichedUnitPriceAtlas=0.5,enrichedWallet="wallet1",enrichedStarbase="UST-1",enrichedAsset="Food",enrichedCertificateMint="cert1",enrichedOrderId="order1",enrichedCreationSignature="create1" ${TIMESTAMP}`);
  assert.equal(formatMarketplaceV2Line(fallback.identity, FALLBACK_FIELDS, TIMESTAMP, 'fallback'), fallback.line);
});

test('fallback and enriched revisions address one byte-identical Influx point', () => {
  const fallback = projectMarketplaceRevision({ identity: IDENTITY_INPUT, rank: 'fallback', fields: FALLBACK_FIELDS, pointTimestampNs: TIMESTAMP });
  const enriched = projectMarketplaceRevision({ identity: IDENTITY_INPUT, rank: 'enriched', fields: ENRICHED_FIELDS, pointTimestampNs: TIMESTAMP });
  assert.equal(pointIdentity(fallback.line), pointIdentity(enriched.line));
  assert.equal(fallback.identityHash, enriched.identityHash);
  assert.equal(fallback.tradeId, enriched.tradeId);
  assert.equal(fallback.pointTimestampNs, TIMESTAMP);
  assert.equal(enriched.pointTimestampNs, TIMESTAMP);
});

test('replay and field output are byte-identical regardless of caller object insertion order', () => {
  const input = { identity: IDENTITY_INPUT, rank: 'fallback', fields: FALLBACK_FIELDS, pointTimestampNs: TIMESTAMP };
  const first = projectMarketplaceRevision(input);
  const replay = projectMarketplaceRevision(input);
  const reversedFields = Object.fromEntries(Object.entries(FALLBACK_FIELDS).reverse());
  const reordered = projectMarketplaceRevision({ ...input, fields: reversedFields });
  assert.equal(replay.line, first.line);
  assert.equal(reordered.line, first.line);
  assert.equal(reordered.identityHash, first.identityHash);
});

test('fallback cannot name enriched fields and enriched cannot name fallback fields', () => {
  const fallback = projectMarketplaceRevision({ identity: IDENTITY_INPUT, rank: 'fallback', fields: FALLBACK_FIELDS, pointTimestampNs: TIMESTAMP });
  const enriched = projectMarketplaceRevision({ identity: IDENTITY_INPUT, rank: 'enriched', fields: ENRICHED_FIELDS, pointTimestampNs: TIMESTAMP });
  assert.equal(ENRICHED_FIELD_KEYS.some((key) => fallback.line.includes(`${key}=`)), false);
  assert.equal(FALLBACK_FIELD_KEYS.some((key) => enriched.line.includes(`${key}=`)), false);
});

test('canonical numbers are deterministic, plain decimal, and reject unsafe input', () => {
  assert.equal(canonicalMarketplaceQuantity('10.000'), '10');
  assert.equal(canonicalMarketplaceQuantity(1e-7), '0.0000001');
  assert.equal(canonicalInfluxNumber(1e21), '1000000000000000000000');
  assert.equal(canonicalInfluxNumber(-0), '0');
  assert.equal(errorCode(() => canonicalMarketplaceQuantity(0)), 'invalid_quantity');
  assert.equal(errorCode(() => canonicalInfluxNumber(Infinity)), 'invalid_number');
  assert.equal(errorCode(() => canonicalInfluxNumber(' 1')), 'invalid_number');
  assert.equal(errorCode(() => canonicalInfluxNumber('0x10')), 'invalid_number');
});

test('validates canonical profile scope without compatibility inference', () => {
  assert.equal(sanitizeMarketplaceProfileScope(' USTUR '), 'USTUR');
  assert.equal(sanitizeMarketplaceProfileScope('custom.Profile-2'), 'custom.Profile-2');
  assert.equal(errorCode(() => sanitizeMarketplaceProfileScope('')), 'invalid_profile');
  assert.equal(errorCode(() => sanitizeMarketplaceProfileScope('bad profile')), 'invalid_profile');
  assert.equal(errorCode(() => sanitizeMarketplaceProfileScope('x'.repeat(129))), 'invalid_profile');
});

test('escapes tags and strings deterministically', () => {
  const projected = projectMarketplaceRevision({
    identity: { ...IDENTITY_INPUT, rawMint: 'ATLAS,mint', executionSignature: 'sig=x y\\z' },
    rank: 'fallback',
    fields: { ...FALLBACK_FIELDS, fallbackWallet: 'wallet"\\one' },
    pointTimestampNs: TIMESTAMP,
  });
  assert.match(projected.line, /executionSignature=sig\\=x\\ y\\\\z,rawMint=ATLAS\\,mint,/);
  assert.match(projected.line, /fallbackWallet="wallet\\"\\\\one"/);
  assert.equal(errorCode(() => projectMarketplaceRevision({
    identity: { ...IDENTITY_INPUT, executionSignature: 'bad\nvalue' }, rank: 'fallback', fields: FALLBACK_FIELDS, pointTimestampNs: TIMESTAMP,
  })), 'invalid_execution_signature');
});

test('validates actual Influx signed-int64 timestamp range and emits it unchanged', () => {
  for (const timestamp of ['-9223372036854775806', '0', '9223372036854775806']) {
    const result = projectMarketplaceRevision({ identity: IDENTITY_INPUT, rank: 'fallback', fields: FALLBACK_FIELDS, pointTimestampNs: timestamp });
    assert.equal(result.pointTimestampNs, timestamp);
    assert.ok(result.line.endsWith(` ${timestamp}`));
  }
  for (const timestamp of ['-9223372036854775807', '9223372036854775807', '+1', '01', '1.0', ' 1']) {
    assert.equal(errorCode(() => projectMarketplaceRevision({ identity: IDENTITY_INPUT, rank: 'fallback', fields: FALLBACK_FIELDS, pointTimestampNs: timestamp })), 'invalid_point_timestamp');
  }
});

test('fails closed on wrong rank fields, unknown fields, and invalid identity combinations', () => {
  assert.equal(errorCode(() => projectMarketplaceRevision({ identity: IDENTITY_INPUT, rank: 'fallback', fields: ENRICHED_FIELDS, pointTimestampNs: TIMESTAMP })), 'invalid_projection_fields');
  assert.equal(errorCode(() => projectMarketplaceRevision({ identity: IDENTITY_INPUT, rank: 'fallback', fields: { ...FALLBACK_FIELDS, extra: 1 }, pointTimestampNs: TIMESTAMP })), 'invalid_projection_fields');
  assert.equal(errorCode(() => projectMarketplaceRevision({ identity: { ...IDENTITY_INPUT, market: 'GM', faction: 'USTUR' }, rank: 'fallback', fields: FALLBACK_FIELDS, pointTimestampNs: TIMESTAMP })), 'invalid_classification');
  assert.equal(errorCode(() => projectMarketplaceRevision({ identity: { ...IDENTITY_INPUT, quantity: 11 }, rank: 'fallback', fields: FALLBACK_FIELDS, pointTimestampNs: TIMESTAMP })), 'quantity_mismatch');
});

test('identity hashing is canonical, deterministic, and distinct from tradeId', () => {
  const identity = deriveMarketplaceTradeIdentity(IDENTITY_INPUT);
  assert.equal(identity.tradeId, TRADE_ID);
  assert.equal(deriveMarketplaceIdentityHash(identity), deriveMarketplaceIdentityHash(deriveMarketplaceTradeIdentity({ ...IDENTITY_INPUT })));
  assert.notEqual(deriveMarketplaceIdentityHash(identity), identity.tradeId);
  assert.equal(identity.tags.map(([key]) => key).join(','), MARKETPLACE_V2_TAG_KEYS.join(','));
});

test('self-contained fallback and enriched decoder fixtures resolve the same logical execution', () => {
  const fallbackDecoderFixture = {
    signature: '5abc', rawMint: 'ATLASmint', side: 'buy', quantity: 10,
    wallet: 'wallet1', starbase: 'UST-1', asset: 'Food', certificateMint: 'cert1',
  };
  const enrichedDecoderFixture = {
    id: '5abc:order1', signature: '5abc', rawMint: 'ATLASmint', side: 'buy', quantity: 10,
    orderId: 'order1', creationSignature: 'create1',
  };
  const common = (row) => ({
    market: 'LM', faction: 'USTUR', profileScope: 'USTUR', executionSignature: row.signature,
    rawMint: row.rawMint, side: row.side, quantity: row.quantity,
  });
  assert.equal(deriveMarketplaceTradeId(common(fallbackDecoderFixture)), deriveMarketplaceTradeId(common(enrichedDecoderFixture)));
});
