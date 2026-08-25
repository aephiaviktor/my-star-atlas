'use strict';

const crypto = require('node:crypto');

const TYPES = new Set(['purchase', 'sale', 'inbound_transfer', 'outbound_transfer']);
const MARKETS = new Set(['LM', 'GM']);
const RECONCILIATION_STATES = new Set(['attributed', 'pending_allocation', 'unallocated', 'quarantined']);
const EXACT_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function clean(value) { return String(value ?? '').trim(); }
function exact(value, { positive = false } = {}) {
  const text = clean(value);
  if (!EXACT_DECIMAL.test(text) || (positive && !/[1-9]/.test(text))) throw new Error('invalid-exact-decimal');
  return text;
}
function normalizeTimestamp(value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error('invalid-timestamp');
  return timestamp.toISOString();
}
function eventHash(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }

function decimalAdd(values) {
  let atoms = 0n;
  let decimals = 0;
  for (const value of values) {
    const text = exact(value);
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > decimals) {
      atoms *= 10n ** BigInt(fraction.length - decimals);
      decimals = fraction.length;
    }
    atoms += BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
  }
  const digits = atoms.toString().padStart(decimals + 1, '0');
  return decimals
    ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/0+$/, '').replace(/\.$/, '')
    : digits;
}

function normalizeActivity(input, scope) {
  if (!input || Number(input.schemaVersion) !== 2) throw new Error('unsupported-schema');
  const eventId = clean(input.eventId || input.tradeId);
  const market = clean(input.market).toUpperCase();
  const transactionType = clean(input.transactionType).toLowerCase();
  const asset = clean(input.asset);
  const rawMint = clean(input.rawMint);
  const exactQuantity = exact(input.exactQuantity, { positive: true });
  if (!eventId || !MARKETS.has(market) || !TYPES.has(transactionType) || !asset || !rawMint) throw new Error('invalid-activity-identity');
  const reconciliationState = clean(input.reconciliationState).toLowerCase();
  if (!RECONCILIATION_STATES.has(reconciliationState)) throw new Error('invalid-reconciliation-state');
  const confidence = clean(input.confidence).toLowerCase();
  const faction = clean(input.faction).toUpperCase();
  const profile = clean(input.profile);
  const wallet = clean(input.wallet);
  const location = clean(input.location);
  const origin = clean(input.origin);
  const destination = clean(input.destination);
  const isTransfer = transactionType.endsWith('_transfer');
  if (isTransfer && (!origin || !destination)) throw new Error('invalid-transfer-lineage');
  if (!isTransfer && (!wallet || !location)) throw new Error('invalid-trade-lineage');
  const attributed = reconciliationState === 'attributed' && confidence === 'verified'
    && faction === clean(scope.faction).toUpperCase() && profile === clean(scope.profile);
  const resolvedState = attributed ? 'attributed'
    : reconciliationState === 'quarantined' ? 'quarantined'
      : reconciliationState === 'pending_allocation' ? 'pending_allocation' : 'unallocated';
  const values = {
    schemaVersion: 2, eventId, tradeId: clean(input.tradeId), timestamp: normalizeTimestamp(input.timestamp),
    market, transactionType, side: clean(input.side).toLowerCase(), asset, rawMint, exactQuantity,
    grossAtlas: exact(input.grossAtlas ?? '0'), marketplaceFeeAtlas: exact(input.marketplaceFeeAtlas ?? '0'),
    transactionFeeAtlas: exact(input.transactionFeeAtlas ?? '0'), netAtlas: exact(input.netAtlas ?? '0'),
    wallet, location, origin, destination, faction, profile,
    provenance: clean(input.provenance) || 'unavailable', confidence,
    reconciliationState: resolvedState, reason: clean(input.reason), signature: clean(input.signature),
  };
  if (market === 'LM' && resolvedState === 'attributed' && (!values.tradeId || !values.location)) throw new Error('lm-scope-unproven');
  if (market === 'GM' && resolvedState === 'attributed' && (!values.wallet || !values.profile || values.profile === 'GLOBAL')) throw new Error('gm-wallet-lineage-unproven');
  return values;
}

function quarantineInvalid(input, reason) {
  return {
    schemaVersion: 2,
    eventId: clean(input?.eventId || input?.tradeId) || `invalid:${eventHash(input)}`,
    tradeId: clean(input?.tradeId), timestamp: (() => { try { return normalizeTimestamp(input?.timestamp); } catch (_error) { return ''; } })(),
    market: clean(input?.market).toUpperCase() || 'UNKNOWN', transactionType: clean(input?.transactionType).toLowerCase() || 'ambiguous',
    side: clean(input?.side).toLowerCase(), asset: clean(input?.asset) || 'Unknown', rawMint: clean(input?.rawMint),
    exactQuantity: (() => { try { return exact(input?.exactQuantity, { positive: true }); } catch (_error) { return '0'; } })(),
    grossAtlas: '0', marketplaceFeeAtlas: '0', transactionFeeAtlas: '0', netAtlas: '0',
    wallet: clean(input?.wallet), location: clean(input?.location), origin: clean(input?.origin), destination: clean(input?.destination),
    faction: clean(input?.faction).toUpperCase(), profile: clean(input?.profile), provenance: clean(input?.provenance) || 'unavailable',
    confidence: 'conflicting', reconciliationState: 'quarantined', reason,
  };
}

function buildMarketplaceActivityV2({ scope = {}, trades = [], transfers = [] } = {}) {
  const normalized = [...trades, ...transfers].map((input) => {
    try { return normalizeActivity(input, scope); }
    catch (error) { return quarantineInvalid(input, String(error.message || error)); }
  });
  const groups = new Map();
  for (const row of normalized) {
    if (!groups.has(row.eventId)) groups.set(row.eventId, []);
    groups.get(row.eventId).push(row);
  }
  const activities = [];
  for (const rows of groups.values()) {
    const hashes = new Set(rows.map(eventHash));
    if (hashes.size === 1) activities.push(rows[0]);
    else rows.forEach((row) => activities.push({ ...row, confidence: 'conflicting', reconciliationState: 'quarantined', reason: 'immutable-event-conflict' }));
  }
  activities.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.eventId.localeCompare(right.eventId) || eventHash(left).localeCompare(eventHash(right)));
  const attributed = activities.filter((row) => row.reconciliationState === 'attributed');
  const pendingAllocation = activities.filter((row) => ['pending_allocation', 'unallocated'].includes(row.reconciliationState));
  const quarantined = activities.filter((row) => row.reconciliationState === 'quarantined');
  const quantity = (rows, types) => decimalAdd(rows.filter((row) => types.has(row.transactionType)).map((row) => row.exactQuantity));
  return {
    activities, attributed, pendingAllocation, quarantined,
    reconciliation: {
      activityCount: activities.length, attributedCount: attributed.length,
      pendingAllocationCount: pendingAllocation.length, quarantinedCount: quarantined.length,
      attributedPurchaseQuantity: quantity(attributed, new Set(['purchase'])),
      attributedSaleQuantity: quantity(attributed, new Set(['sale'])),
      attributedTransferQuantity: quantity(attributed, new Set(['inbound_transfer', 'outbound_transfer'])),
      pendingQuantity: decimalAdd(pendingAllocation.map((row) => row.exactQuantity)),
    },
  };
}

function buildMarketplaceLedgerEvents(result, scope = {}) {
  return (result?.activities || []).map((row, index) => {
    const base = {
      eventId: `marketplace:v2:${row.eventId}${row.reason === 'immutable-event-conflict' ? `:conflict:${index}` : ''}`,
      timestamp: row.timestamp, source: row.market === 'GM' ? 'gm' : 'lm', asset: row.asset,
      quantity: row.exactQuantity, tradeId: row.tradeId || null, originWallet: row.wallet || null,
      lineageStatus: row.reconciliationState, provenance: row.provenance, evidenceAuthority: 'marketplace_v2', scope,
    };
    if (row.reconciliationState === 'quarantined') return { ...base, type: 'quarantined', reason: row.reason || 'marketplace-activity-quarantined' };
    if (row.reconciliationState !== 'attributed') return { ...base, type: row.reconciliationState === 'pending_allocation' ? 'pending' : 'unallocated' };
    if (row.transactionType === 'purchase') return {
      ...base, type: 'acquisition', location: row.location, basis: row.grossAtlas,
      fees: decimalAdd([row.marketplaceFeeAtlas, row.transactionFeeAtlas]),
      marketplaceFee: row.marketplaceFeeAtlas, transactionFee: row.transactionFeeAtlas,
    };
    if (row.transactionType === 'sale') return {
      ...base, type: 'sale', location: row.location, grossProceeds: row.grossAtlas,
      fees: decimalAdd([row.marketplaceFeeAtlas, row.transactionFeeAtlas]),
      marketplaceFee: row.marketplaceFeeAtlas, transactionFee: row.transactionFeeAtlas,
    };
    return {
      ...base, type: 'transfer', location: row.origin, destination: row.destination,
      cargoCost: row.transactionFeeAtlas,
    };
  });
}

function exactFromFinite(value, fallback = '0') {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value);
  if (EXACT_DECIMAL.test(text)) return text;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  const match = text.toLowerCase().match(/^(\d+)(?:\.(\d+))?e([+-]?\d+)$/);
  if (!match) return fallback;
  const digits = `${match[1]}${match[2] || ''}`;
  const point = match[1].length + Number(match[3]);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`.replace(/0+$/, '').replace(/\.$/, '') || '0';
  if (point >= digits.length) return `${digits}${'0'.repeat(point - digits.length)}`;
  return `${digits.slice(0, point)}.${digits.slice(point)}`.replace(/0+$/, '').replace(/\.$/, '');
}

function projectMarketplaceEvidenceV2({ trades = [], transfers = [], scope = {} } = {}) {
  const projectedTrades = trades.map((trade) => {
    const market = clean(trade.market || trade.marketplace).toUpperCase();
    const isV2 = trade.schemaGeneration === 'v2' && clean(trade.tradeId) && trade.representationRank !== 'identity_uncertain';
    const lineageProven = market === 'LM'
      ? isV2 && clean(trade.faction).toUpperCase() === clean(scope.faction).toUpperCase() && clean(trade.profile) === clean(scope.profile) && clean(trade.starbase)
      : isV2 && clean(trade.lineageStatus).toLowerCase() === 'proven'
        && clean(trade.lineageFaction).toUpperCase() === clean(scope.faction).toUpperCase()
        && clean(trade.lineageProfile) === clean(scope.profile) && clean(trade.lineageLocation);
    const marketplaceFee = exactFromFinite(trade.marketplaceFeeAtlas);
    const transactionFee = exactFromFinite(trade.txFeeAtlas);
    const gross = exactFromFinite(trade.grossAtlas ?? trade.settledAtlas);
    const net = exactFromFinite(trade.netAtlas ?? trade.settledAtlas);
    return {
      schemaVersion: 2, eventId: clean(trade.tradeId || trade.id) || `uncertain:${eventHash(trade)}`,
      tradeId: clean(trade.tradeId), timestamp: trade.timestamp, market,
      transactionType: clean(trade.side).toLowerCase() === 'sell' ? 'sale' : 'purchase', side: clean(trade.side).toLowerCase(),
      asset: clean(trade.asset) || 'Unknown', rawMint: clean(trade.rawMint) || 'unknown',
      exactQuantity: exactFromFinite(trade.quantity), grossAtlas: gross, marketplaceFeeAtlas: marketplaceFee,
      transactionFeeAtlas: transactionFee, netAtlas: net, wallet: clean(trade.wallet) || 'unknown',
      location: market === 'LM' ? clean(trade.starbase) : clean(trade.lineageLocation) || `wallet:${clean(trade.wallet) || 'unknown'}`,
      faction: lineageProven ? (market === 'LM' ? clean(trade.faction).toUpperCase() : clean(trade.lineageFaction).toUpperCase()) : 'GLOBAL',
      profile: lineageProven ? (market === 'LM' ? clean(trade.profile) : clean(trade.lineageProfile)) : 'GLOBAL',
      provenance: isV2 ? `marketplace_v2_${trade.representationRank}` : 'legacy_compatibility_read',
      confidence: lineageProven ? 'verified' : isV2 ? 'ambiguous' : 'unverified',
      reconciliationState: lineageProven ? 'attributed' : isV2 ? 'unallocated' : 'quarantined',
      reason: lineageProven ? '' : isV2 ? `${market.toLowerCase()}-lineage-unproven` : 'legacy-identity-not-authoritative',
      signature: clean(trade.signature),
    };
  });
  const projectedTransfers = transfers.map((flow) => {
    const lineageProven = Number(flow.schemaVersion) === 2 && clean(flow.lineageStatus).toLowerCase() === 'proven'
      && clean(flow.faction).toUpperCase() === clean(scope.faction).toUpperCase() && clean(flow.profile) === clean(scope.profile);
    const origin = clean(flow.origin);
    const destination = clean(flow.destination);
    return {
      schemaVersion: 2, eventId: clean(flow.eventId || flow.flowId || flow.id) || `uncertain:${eventHash(flow)}`,
      timestamp: flow.timestamp, market: 'GM',
      transactionType: destination.startsWith('wallet:') ? 'outbound_transfer' : 'inbound_transfer',
      asset: clean(flow.asset) || 'Unknown', rawMint: clean(flow.rawMint) || 'unknown',
      exactQuantity: exactFromFinite(flow.exactQuantity ?? flow.quantity), transactionFeeAtlas: exactFromFinite(flow.txFeeAtlas ?? flow.cargoCost),
      grossAtlas: '0', marketplaceFeeAtlas: '0', netAtlas: '0', wallet: clean(flow.wallet) || clean(origin.replace(/^wallet:/, '')) || 'unknown',
      origin, destination, faction: lineageProven ? clean(flow.faction).toUpperCase() : 'GLOBAL',
      profile: lineageProven ? clean(flow.profile) : 'GLOBAL', provenance: clean(flow.provenance || flow.flow) || 'asset_flow',
      confidence: lineageProven ? 'verified' : 'ambiguous', reconciliationState: lineageProven ? 'attributed' : 'unallocated',
      reason: lineageProven ? '' : 'transfer-lineage-unproven', signature: clean(flow.signature),
    };
  });
  return buildMarketplaceActivityV2({ scope, trades: projectedTrades, transfers: projectedTransfers });
}

module.exports = { buildMarketplaceActivityV2, buildMarketplaceLedgerEvents, projectMarketplaceEvidenceV2, decimalAdd };
