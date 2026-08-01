'use strict';

const crypto = require('node:crypto');

const MARKETPLACE_V2_MEASUREMENT = 'marketplace_v2';
const MARKETPLACE_V2_TAG_KEYS = Object.freeze([
  'market', 'faction', 'profile', 'executionSignature', 'rawMint', 'side', 'tradeId',
]);
const FALLBACK_FIELD_KEYS = Object.freeze([
  'fallbackQuantity', 'fallbackSettledAtlas', 'fallbackGrossAtlas',
  'fallbackMarketplaceFeeAtlas', 'fallbackNetAtlas', 'fallbackUnitPriceAtlas',
  'fallbackWallet', 'fallbackStarbase', 'fallbackAsset', 'fallbackCertificateMint',
]);
const ENRICHED_FIELD_KEYS = Object.freeze([
  'enrichedQuantity', 'enrichedSettledAtlas', 'enrichedGrossAtlas',
  'enrichedMarketplaceFeeAtlas', 'enrichedTxFeeAtlas', 'enrichedNetAtlas',
  'enrichedUnitPriceAtlas', 'enrichedWallet', 'enrichedStarbase', 'enrichedAsset',
  'enrichedCertificateMint', 'enrichedOrderId', 'enrichedCreationSignature',
]);
const FALLBACK_NUMERIC_KEYS = new Set(FALLBACK_FIELD_KEYS.slice(0, 6));
const ENRICHED_NUMERIC_KEYS = new Set(ENRICHED_FIELD_KEYS.slice(0, 7));
const CONTROL = /[\u0000-\u001f\u007f]/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const POINT_TIMESTAMP = /^(?:0|-?[1-9]\d*)$/;
const MIN_INFLUX_NS = -9223372036854775806n;
const MAX_INFLUX_NS = 9223372036854775806n;

class MarketplaceV2PointError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MarketplaceV2PointError';
    this.code = code;
  }
}

function fail(code) { throw new MarketplaceV2PointError(code); }
function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function utf8Length(value) { return Buffer.byteLength(value, 'utf8'); }

function boundedString(value, code, { allowEmpty = false, max = 512 } = {}) {
  if (typeof value !== 'string') fail(code);
  if ((!allowEmpty && value.length === 0) || utf8Length(value) > max || CONTROL.test(value)) fail(code);
  return value;
}

function sanitizeMarketplaceProfileScope(value) {
  if (typeof value !== 'string') fail('invalid_profile');
  const normalized = value.trim();
  if (!normalized || utf8Length(normalized) > 128 || !/^[A-Za-z0-9._-]+$/.test(normalized)) fail('invalid_profile');
  return normalized;
}

function expandDecimal(value) {
  const match = value.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) fail('invalid_number');
  const sign = match[1];
  const integer = match[2];
  const fraction = match[3] || '';
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) fail('invalid_number');
  const digits = `${integer}${fraction}`;
  const decimalAt = integer.length + exponent;
  let result;
  if (decimalAt <= 0) result = `0.${'0'.repeat(-decimalAt)}${digits}`;
  else if (decimalAt >= digits.length) result = `${digits}${'0'.repeat(decimalAt - digits.length)}`;
  else result = `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
  let [whole, decimal = ''] = result.split('.');
  whole = whole.replace(/^0+(?=\d)/, '') || '0';
  decimal = decimal.replace(/0+$/, '');
  result = decimal ? `${whole}.${decimal}` : whole;
  if (result === '0') return '0';
  result = sign ? `-${result}` : result;
  if (result.length > 128) fail('invalid_number');
  return result;
}

function canonicalInfluxNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') fail('invalid_number');
  if (typeof value === 'string' && (!value || value.trim() !== value || !DECIMAL.test(value))) fail('invalid_number');
  if (typeof value === 'number' && !Number.isFinite(value)) fail('invalid_number');
  const text = typeof value === 'number' ? String(value) : value;
  const result = expandDecimal(text);
  if (!Number.isFinite(Number(result))) fail('invalid_number');
  return result;
}

function canonicalMarketplaceQuantity(value) {
  let result;
  try { result = canonicalInfluxNumber(value); } catch (_error) { fail('invalid_quantity'); }
  if (!(Number(result) > 0)) fail('invalid_quantity');
  return result;
}

function validateIdentityInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_identity');
  const market = input.market;
  const faction = input.faction;
  const profile = sanitizeMarketplaceProfileScope(input.profileScope);
  if (market !== 'LM' && market !== 'GM') fail('invalid_classification');
  if (market === 'LM' && !['MUD', 'ONI', 'USTUR'].includes(faction)) fail('invalid_classification');
  if (market === 'GM' && (faction !== 'GLOBAL' || profile !== 'GLOBAL')) fail('invalid_classification');
  const executionSignature = boundedString(input.executionSignature, 'invalid_execution_signature', { max: 256 });
  const rawMint = boundedString(input.rawMint, 'invalid_raw_mint', { max: 256 });
  if (input.side !== 'buy' && input.side !== 'sell') fail('invalid_side');
  const canonicalQuantity = canonicalMarketplaceQuantity(input.quantity);
  return { market, faction, profile, executionSignature, rawMint, side: input.side, canonicalQuantity };
}

function deriveMarketplaceTradeId(input) {
  const value = validateIdentityInput(input);
  return sha256(JSON.stringify([
    'msa-marketplace-logical-trade:v2', value.market, value.faction, value.profile,
    value.executionSignature, value.rawMint, value.side, value.canonicalQuantity,
  ]));
}

function deriveMarketplaceTradeIdentity(input) {
  const value = validateIdentityInput(input);
  const tradeId = deriveMarketplaceTradeId(input);
  const tags = [
    ['market', value.market],
    ['faction', value.faction],
    ['profile', value.profile],
    ['executionSignature', value.executionSignature],
    ['rawMint', value.rawMint],
    ['side', value.side],
    ['tradeId', tradeId],
  ];
  return {
    measurement: MARKETPLACE_V2_MEASUREMENT,
    market: value.market,
    faction: value.faction,
    profile: value.profile,
    executionSignature: value.executionSignature,
    rawMint: value.rawMint,
    side: value.side,
    canonicalQuantity: value.canonicalQuantity,
    tradeId,
    tags,
  };
}

function exactIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) fail('invalid_identity');
  const expected = [
    'canonicalQuantity', 'executionSignature', 'faction', 'market', 'measurement',
    'profile', 'rawMint', 'side', 'tags', 'tradeId',
  ];
  if (JSON.stringify(Object.keys(identity).sort()) !== JSON.stringify(expected)) fail('invalid_identity');
  if (identity.measurement !== MARKETPLACE_V2_MEASUREMENT) fail('invalid_identity');
  const rebuilt = deriveMarketplaceTradeIdentity({
    market: identity.market, faction: identity.faction, profileScope: identity.profile,
    executionSignature: identity.executionSignature, rawMint: identity.rawMint,
    side: identity.side, quantity: identity.canonicalQuantity,
  });
  if (JSON.stringify(identity) !== JSON.stringify(rebuilt)) fail('invalid_identity');
  return identity;
}

function deriveMarketplaceIdentityHash(identityOrInput) {
  const identity = Object.hasOwn(identityOrInput || {}, 'measurement')
    ? exactIdentity(identityOrInput)
    : deriveMarketplaceTradeIdentity(identityOrInput);
  return sha256(JSON.stringify(identity));
}

function validateTimestamp(value) {
  if (typeof value !== 'string' || !POINT_TIMESTAMP.test(value)) fail('invalid_point_timestamp');
  let timestamp;
  try { timestamp = BigInt(value); } catch (_error) { fail('invalid_point_timestamp'); }
  if (timestamp < MIN_INFLUX_NS || timestamp > MAX_INFLUX_NS) fail('invalid_point_timestamp');
  return value;
}

function escapeTag(value) {
  return value.replace(/\\/g, '\\\\').replace(/ /g, '\\ ').replace(/,/g, '\\,').replace(/=/g, '\\=');
}
function escapeFieldString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function validateProjection(identity, rank, fields) {
  const keys = rank === 'fallback' ? FALLBACK_FIELD_KEYS : rank === 'enriched' ? ENRICHED_FIELD_KEYS : null;
  const numeric = rank === 'fallback' ? FALLBACK_NUMERIC_KEYS : ENRICHED_NUMERIC_KEYS;
  if (!keys || !fields || typeof fields !== 'object' || Array.isArray(fields)) fail('invalid_projection_fields');
  const actual = Object.keys(fields).sort();
  const expected = Array.from(keys).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail('invalid_projection_fields');
  const rendered = [];
  for (const key of keys) {
    if (numeric.has(key)) {
      const value = key.endsWith('Quantity') ? canonicalMarketplaceQuantity(fields[key]) : canonicalInfluxNumber(fields[key]);
      if (!key.endsWith('Quantity') && Number(value) < 0) fail('invalid_projection_number');
      rendered.push(`${key}=${value}`);
    } else {
      const allowEmpty = key.endsWith('Starbase') && identity.market === 'GM';
      const value = boundedString(fields[key], 'invalid_projection_string', { allowEmpty });
      rendered.push(`${key}=${escapeFieldString(value)}`);
    }
  }
  const projectedQuantity = canonicalMarketplaceQuantity(fields[keys[0]]);
  if (projectedQuantity !== identity.canonicalQuantity) fail('quantity_mismatch');
  return rendered.join(',');
}

function formatMarketplaceV2Line(identity, fields, pointTimestampNs, rank) {
  const validatedIdentity = exactIdentity(identity);
  const timestamp = validateTimestamp(pointTimestampNs);
  const tagText = validatedIdentity.tags.map(([key, value], index) => {
    if (key !== MARKETPLACE_V2_TAG_KEYS[index]) fail('invalid_identity');
    return `${key}=${escapeTag(value)}`;
  }).join(',');
  const fieldText = validateProjection(validatedIdentity, rank, fields);
  return `${MARKETPLACE_V2_MEASUREMENT},${tagText} ${fieldText} ${timestamp}`;
}

function projectMarketplaceRevision({ identity: identityInput, rank, fields, pointTimestampNs } = {}) {
  const identity = deriveMarketplaceTradeIdentity(identityInput);
  const timestamp = validateTimestamp(pointTimestampNs);
  const line = formatMarketplaceV2Line(identity, fields, timestamp, rank);
  return {
    rank,
    tradeId: identity.tradeId,
    identity,
    identityHash: deriveMarketplaceIdentityHash(identity),
    pointTimestampNs: timestamp,
    fields: Object.fromEntries(Object.entries(fields)),
    line,
  };
}

module.exports = {
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
};
