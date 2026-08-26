'use strict';

const crypto = require('node:crypto');
const {
  FALLBACK_FIELD_KEYS,
  ENRICHED_FIELD_KEYS,
  canonicalMarketplaceQuantity,
  deriveMarketplaceTradeId,
} = require('./marketplace-v2-point');

const OUTPUT_KEYS = Object.freeze([
  'id', 'tradeId', 'timestamp', 'marketplace', 'faction', 'profile', 'starbase', 'asset',
  'side', 'wallet', 'quantity', 'settledAtlas', 'grossAtlas', 'marketplaceFeeAtlas',
  'txFeeAtlas', 'netAtlas', 'unitPriceAtlas', 'signature', 'creationSignature', 'rawMint',
  'certificateMint', 'orderId', 'representationRank', 'schemaGeneration',
]);
const VECTOR_KEYS = Object.freeze([
  'hasOrderId', 'hasCreationSignature', 'hasNonzeroTxFeeAtlas', 'hasSettledAtlas',
  'hasGrossAtlas', 'hasMarketplaceFeeAtlas', 'hasNetAtlas', 'hasUnitPriceAtlas',
]);

function canonicalRecursiveSerialize(value) {
  const seen = new Set();
  function encode(item) {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('invalid_number');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new TypeError('unsupported_value');
    if (seen.has(item)) throw new TypeError('cyclic_value');
    seen.add(item);
    let result;
    if (Array.isArray(item)) result = `[${item.map(encode).join(',')}]`;
    else {
      const pairs = Object.keys(item).sort().map((key) => {
        if (item[key] === undefined) throw new TypeError('unsupported_value');
        return `${JSON.stringify(key)}:${encode(item[key])}`;
      });
      result = `{${pairs.join(',')}}`;
    }
    seen.delete(item);
    return result;
  }
  return encode(value);
}

function clean(value) { return String(value ?? '').trim(); }
function finite(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function meaningful(value) { return clean(value).length > 0; }
function validTime(value) { return meaningful(value) && Number.isFinite(Date.parse(String(value))); }

function resolveMarketplaceProfileScope(input = {}) {
  const market = clean(input.market || input.marketplace || 'LM').toUpperCase();
  if (market === 'GM') return { profileScope: 'GLOBAL', certain: true, historicalProfile: clean(input.rowProfile ?? input.profile) };
  const applicationProfile = clean(input.applicationProfile || input.startupProfile || input.profileName);
  const selectedProfile = clean(input.selectedProfile || input.selectedPlayerProfile);
  const rowProfile = clean(input.rowProfile ?? input.profile);
  if (!applicationProfile) return { profileScope: rowProfile, certain: false, historicalProfile: rowProfile };
  if (rowProfile === applicationProfile || (selectedProfile && rowProfile === selectedProfile)) {
    return { profileScope: applicationProfile, certain: true, historicalProfile: rowProfile };
  }
  if (!rowProfile && input.scopeProven === true) return { profileScope: applicationProfile, certain: true, historicalProfile: '' };
  return { profileScope: rowProfile || applicationProfile, certain: false, historicalProfile: rowProfile };
}

function inferMarketplaceV1Rank(row = {}) {
  return meaningful(row.orderId) || meaningful(row.creationSignature) || (finite(row.txFeeAtlas) !== null && finite(row.txFeeAtlas) !== 0)
    ? 'enriched' : 'fallback';
}

function commonEconomics(row, names = {}) {
  const value = (key) => row[names[key] || key];
  const quantity = finite(value('quantity'));
  const settledAtlas = finite(value('settledAtlas'));
  const grossAtlas = finite(value('grossAtlas'));
  const marketplaceFeeAtlas = finite(value('marketplaceFeeAtlas'));
  const netAtlas = finite(value('netAtlas'));
  const unitPriceAtlas = finite(value('unitPriceAtlas'));
  if (!(quantity > 0) || [settledAtlas, grossAtlas, marketplaceFeeAtlas, netAtlas, unitPriceAtlas].some((n) => n === null || n < 0)) return null;
  return { quantity, settledAtlas, grossAtlas, marketplaceFeeAtlas, netAtlas, unitPriceAtlas };
}

function makeOutput(values) {
  return Object.fromEntries(OUTPUT_KEYS.map((key) => [key, values[key] ?? (['quantity','settledAtlas','grossAtlas','marketplaceFeeAtlas','txFeeAtlas','netAtlas','unitPriceAtlas'].includes(key) ? 0 : '')]));
}

function identityFor(row, context, economics) {
  const market = clean(row.market || row.marketplace || context.market || 'LM').toUpperCase();
  const faction = market === 'GM' ? 'GLOBAL' : clean(row.faction || context.faction).toUpperCase();
  const profile = resolveMarketplaceProfileScope({
    market, applicationProfile: context.applicationProfile || context.startupProfile,
    selectedProfile: context.selectedProfile, rowProfile: row.profile,
    scopeProven: context.scopeProven === true,
  });
  const signature = clean(row.executionSignature || row.signature);
  const rawMint = clean(row.rawMint);
  const side = clean(row.side).toLowerCase();
  if (!profile.certain || !signature || !rawMint || !['buy','sell'].includes(side) || !['LM','GM'].includes(market)) {
    return { certain: false, market, faction, profile, signature, rawMint, side };
  }
  try {
    const tradeId = deriveMarketplaceTradeId({ market, faction, profileScope: profile.profileScope, executionSignature: signature, rawMint, side, quantity: economics.quantity });
    return { certain: true, market, faction, profile, signature, rawMint, side, tradeId };
  } catch (_error) {
    return { certain: false, market, faction, profile, signature, rawMint, side };
  }
}

function normalizeMarketplaceV1Row(row = {}, context = {}) {
  const economics = commonEconomics(row);
  const rank = inferMarketplaceV1Rank(row);
  const identity = economics ? identityFor(row, context, economics) : { certain: false, market: clean(row.market || 'LM').toUpperCase(), faction: clean(row.faction), profile: resolveMarketplaceProfileScope({ market: row.market || 'LM', applicationProfile: context.applicationProfile || context.startupProfile, selectedProfile: context.selectedProfile, rowProfile: row.profile, scopeProven: context.scopeProven === true }), signature: clean(row.signature), rawMint: clean(row.rawMint), side: clean(row.side).toLowerCase() };
  const complete = Boolean(economics && validTime(row._time || row.timestamp) && identity.certain);
  const preservedEconomics = economics || {
    quantity: finite(row.quantity) ?? 0,
    settledAtlas: finite(row.settledAtlas) ?? 0,
    grossAtlas: finite(row.grossAtlas) ?? 0,
    marketplaceFeeAtlas: finite(row.marketplaceFeeAtlas) ?? 0,
    netAtlas: finite(row.netAtlas) ?? 0,
    unitPriceAtlas: finite(row.unitPriceAtlas) ?? 0,
  };
  const output = makeOutput({
    id: clean(row.tradeId || row.id), tradeId: complete ? identity.tradeId : '', timestamp: clean(row._time || row.timestamp),
    marketplace: identity.market || 'LM', faction: identity.faction, profile: identity.profile?.profileScope || '',
    starbase: clean(row.starbase), asset: clean(row.asset), side: identity.side, wallet: clean(row.wallet),
    ...preservedEconomics, txFeeAtlas: finite(row.txFeeAtlas) ?? 0, signature: identity.signature,
    creationSignature: clean(row.creationSignature), rawMint: identity.rawMint, certificateMint: clean(row.certificateMint),
    orderId: clean(row.orderId), representationRank: complete ? rank : 'identity_uncertain', schemaGeneration: 'v1',
  });
  Object.defineProperties(output, {
    _certain: { value: complete, enumerable: false },
    historicalProfile: { value: identity.profile?.historicalProfile || '', enumerable: false },
  });
  return output;
}

function completeNamespace(row, rank) {
  const keys = rank === 'enriched' ? ENRICHED_FIELD_KEYS : FALLBACK_FIELD_KEYS;
  if (!keys.every((key) => Object.hasOwn(row, key))) return null;
  const prefix = rank;
  const names = Object.fromEntries(['quantity','settledAtlas','grossAtlas','marketplaceFeeAtlas','netAtlas','unitPriceAtlas'].map((key) => [key, `${prefix}${key[0].toUpperCase()}${key.slice(1)}`]));
  const economics = commonEconomics(row, names);
  if (!economics || Object.values(economics).some((value) => value < 0)) return null;
  const requiredStrings = rank === 'enriched'
    ? ['enrichedWallet','enrichedAsset','enrichedCertificateMint','enrichedOrderId','enrichedCreationSignature']
    : ['fallbackWallet','fallbackAsset','fallbackCertificateMint'];
  if (requiredStrings.some((key) => !meaningful(row[key]))) return null;
  if (rank === 'enriched' && (!(finite(row.enrichedTxFeeAtlas) >= 0))) return null;
  return { economics, prefix };
}

function normalizeMarketplaceV2Row(row = {}, context = {}) {
  const chosen = completeNamespace(row, 'enriched') || completeNamespace(row, 'fallback');
  if (!chosen || !validTime(row._time || row.timestamp)) return null;
  const rank = chosen.prefix;
  const identity = identityFor({ ...row, signature: row.executionSignature }, { ...context, scopeProven: false, applicationProfile: context.applicationProfile || context.startupProfile }, chosen.economics);
  if (!identity.certain || !clean(row.tradeId) || clean(row.tradeId) !== identity.tradeId) return null;
  const cap = (key) => `${rank}${key[0].toUpperCase()}${key.slice(1)}`;
  if (identity.market === 'LM' && !meaningful(row[cap('starbase')])) return null;
  return makeOutput({
    id: identity.tradeId, tradeId: identity.tradeId, timestamp: clean(row._time || row.timestamp), marketplace: identity.market,
    faction: identity.faction, profile: identity.profile.profileScope, starbase: clean(row[cap('starbase')]), asset: clean(row[cap('asset')]),
    side: identity.side, wallet: clean(row[cap('wallet')]), ...chosen.economics,
    txFeeAtlas: rank === 'enriched' ? finite(row.enrichedTxFeeAtlas) ?? 0 : 0,
    signature: identity.signature, creationSignature: rank === 'enriched' ? clean(row.enrichedCreationSignature) : '', rawMint: identity.rawMint,
    certificateMint: clean(row[cap('certificateMint')]), orderId: rank === 'enriched' ? clean(row.enrichedOrderId) : '',
    representationRank: rank, schemaGeneration: 'v2',
  });
}

function deriveMarketplaceUnionKey(row) {
  if (row && row.representationRank !== 'identity_uncertain' && meaningful(row.tradeId)) return `certain:${row.tradeId}`;
  const bounded = Object.fromEntries(OUTPUT_KEYS.map((key) => [key, row?.[key] ?? null]));
  bounded.historicalProfile = row?.historicalProfile ?? null;
  return `uncertain:${crypto.createHash('sha256').update(canonicalRecursiveSerialize(bounded)).digest('hex')}`;
}

function vector(row) {
  return [meaningful(row.orderId), meaningful(row.creationSignature), finite(row.txFeeAtlas) !== 0,
    ...['settledAtlas','grossAtlas','marketplaceFeeAtlas','netAtlas','unitPriceAtlas'].map((key) => finite(row[key]) !== null)];
}
function bytesCompare(a, b) { return Buffer.compare(Buffer.from(canonicalRecursiveSerialize(a)), Buffer.from(canonicalRecursiveSerialize(b))); }
function compareMarketplaceRepresentations(a, b) {
  const fidelity = (row) => row.representationRank === 'enriched' ? 2 : row.representationRank === 'fallback' ? 1 : 0;
  let delta = fidelity(a) - fidelity(b); if (delta) return delta;
  delta = (a.schemaGeneration === 'v2' ? 1 : 0) - (b.schemaGeneration === 'v2' ? 1 : 0); if (delta) return delta;
  const av = vector(a); const bv = vector(b);
  for (let i = 0; i < VECTOR_KEYS.length; i += 1) if (av[i] !== bv[i]) return av[i] ? 1 : -1;
  return bytesCompare(a, b);
}

function dedupeMarketplaceRows(rows = []) {
  const winners = new Map();
  const order = [];
  for (const row of rows) {
    if (!row) continue;
    const key = deriveMarketplaceUnionKey(row);
    if (!winners.has(key)) { winners.set(key, row); order.push(key); }
    else if (compareMarketplaceRepresentations(row, winners.get(key)) > 0) winners.set(key, row);
  }
  return order.map((key) => winners.get(key));
}

module.exports = {
  normalizeMarketplaceV1Row,
  normalizeMarketplaceV2Row,
  resolveMarketplaceProfileScope,
  canonicalRecursiveSerialize,
  deriveMarketplaceUnionKey,
  inferMarketplaceV1Rank,
  compareMarketplaceRepresentations,
  dedupeMarketplaceRows,
};
