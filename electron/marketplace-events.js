'use strict';

const crypto = require('node:crypto');
const { canonicalAssetName } = require('./asset-name');
const { classifyCssCargoEvents, playerTransferEvents, processHarvestRewardEvents } = require('./marketplace-rawdata');

const MARKETPLACE_EVENTS_MEASUREMENT = 'marketplace_events';
const EVENT_TYPES = new Set(['deposit', 'withdraw', 'transfer', 'reward', 'lm', 'gm']);

function escapeTag(value) {
  return String(value).replace(/([ ,=])/g, '\\$1');
}

function escapeField(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

function canonicalJson(value) {
  const normalize = (item) => {
    if (typeof item === 'bigint') return item.toString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    return item;
  };
  return JSON.stringify(normalize(value));
}

function eventPayloadHash(event) {
  return crypto.createHash('sha256').update(canonicalJson(event)).digest('hex');
}

function formatMarketplaceEventInfluxLine(event, blockTime) {
  const eventId = String(event?.eventId || '');
  const signature = String(event?.signature || '');
  const eventType = String(event?.eventType || event?.stream || '').toLowerCase();
  if (!eventId || !signature || !EVENT_TYPES.has(eventType) || !Number.isSafeInteger(Number(blockTime))) {
    throw new Error('invalid_marketplace_event');
  }
  const payload = { ...event, eventId, signature, eventType };
  return `${MARKETPLACE_EVENTS_MEASUREMENT},eventType=${escapeTag(eventType)},eventId=${escapeTag(eventId)},signature=${escapeTag(signature)} payload=${escapeField(canonicalJson(payload))},payloadHash=${escapeField(eventPayloadHash(payload))} ${BigInt(blockTime) * 1000000000n}`;
}

function rawRowSources(row) {
  return new Set(String(row?.discoverySource || '').split(',').map((value) => value.trim()).filter(Boolean));
}

function assetName(assetsByMint, mint) {
  const asset = assetsByMint[String(mint || '')];
  return canonicalAssetName(asset?.name || asset?.asset || asset || '');
}

function deriveCustodyEventsFromRawRows(rawRows, { cssScopes = [], assetsByMint = {} } = {}) {
  const events = [];
  for (const row of rawRows || []) {
    const transaction = row?.payload;
    if (!transaction || typeof transaction !== 'object') continue;
    const sources = rawRowSources(row);
    if (sources.has('css_account') || sources.has('multiple')) {
      for (const scope of cssScopes) {
        events.push(...classifyCssCargoEvents(transaction, {
          sageProgramId: scope.sageProgramId, cssStarbasePlayer: scope.address,
        }).map((event) => {
          return {
            ...event, eventType: event.stream, action: event.type,
            faction: String(scope.faction || ''), starbase: String(scope.starbase || ''),
            asset: assetName(assetsByMint, event.mint),
          };
        }));
      }
    }
    if (sources.has('token_account') || sources.has('multiple')) {
      const balanceOwners = [...new Set([
        ...(transaction.meta?.preTokenBalances || []), ...(transaction.meta?.postTokenBalances || []),
      ].map((balance) => String(balance?.owner || '')).filter(Boolean))];
      const rewards = processHarvestRewardEvents(transaction).map((event) => ({
        ...event, eventType: 'reward', asset: assetName(assetsByMint, event.mint),
      }));
      if (rewards.length) events.push(...rewards);
      else events.push(...playerTransferEvents(transaction, balanceOwners).map((event) => ({
        ...event, eventType: 'transfer', action: 'transfer', asset: assetName(assetsByMint, event.mint),
      })));
    }
  }
  return events;
}

function projectMarketplaceOrderAndExecutionEvents(scanned, market, { faction = '' } = {}) {
  const eventType = String(market || '').toLowerCase();
  const normalizedFaction = String(faction || '').trim().toUpperCase();
  let eventFaction = 'GLOBAL';
  if (eventType !== 'gm') {
    eventFaction = ['MUD', 'ONI', 'USTUR'].includes(normalizedFaction) ? normalizedFaction : 'USTUR';
  }
  const events = [];
  for (const order of scanned?.orders || []) {
    const signature = String(order.creationSignature || '');
    if (!signature || !order.orderId) continue;
    events.push({
      eventId: `${signature}:${eventType}:order:${order.orderId}`, signature, eventType,
      action: 'order_created', market: String(market || '').toUpperCase(), orderId: String(order.orderId),
      faction: eventFaction, starbase: eventType === 'gm' ? '' : String(order.starbase || ''),
      side: String(order.side || ''), fromWallet: String(order.initializer || ''), asset: canonicalAssetName(order.asset),
      mint: String(order.rawMint || order.certificateMint || ''), quantityRaw: String(order.originalQuantity ?? ''),
      unitPriceAtlas: Number(order.priceAtlas),
    });
  }
  for (const trade of scanned?.trades || []) {
    const signature = String(trade.signature || '');
    if (!signature || !trade.id) continue;
    events.push({
      eventId: `${signature}:${eventType}:execution:${trade.id}`, signature, eventType,
      action: 'execution', market: String(market || '').toUpperCase(), orderId: String(trade.orderId || ''),
      faction: eventFaction, starbase: eventType === 'gm' ? '' : String(trade.starbase || ''),
      side: String(trade.side || ''), fromWallet: String(trade.wallet || ''), asset: canonicalAssetName(trade.asset),
      mint: String(trade.rawMint || trade.certificateMint || ''), quantityRaw: String(trade.quantity ?? ''),
      unitPriceAtlas: Number(trade.unitPriceAtlas ?? trade.priceAtlas), grossAtlas: Number(trade.grossAtlas),
      marketplaceFeeAtlas: Number(trade.marketplaceFeeAtlas || 0), txFeeAtlas: Number(trade.txFeeAtlas || 0),
    });
  }
  for (const transaction of scanned?.rawTransactions || []) {
    const signature = String(transaction?.signature || transaction?.transaction?.signatures?.[0] || '');
    const cancellations = (transaction?.meta?.logMessages || []).filter((line) => String(line).includes('Instruction: ProcessCancel'));
    cancellations.forEach((_line, index) => events.push({
      eventId: `${signature}:${eventType}:cancel:${index}`, signature, eventType,
      action: 'order_cancelled', market: String(market || '').toUpperCase(), faction: eventFaction,
    }));
  }
  return events;
}

function priceAtOrBefore(rows, timestampMs) {
  let selected = null;
  for (const row of rows || []) {
    const ts = Number(row?.[0]);
    const price = Number(row?.[1]);
    if (!Number.isFinite(ts) || ts > timestampMs) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!selected || ts > selected.ts) selected = { ts, price };
  }
  return selected;
}

function transactionSignature(transaction) {
  return String(transaction?.signature || transaction?.transaction?.signatures?.[0] || '');
}

function transactionFeePayer(transaction) {
  const key = transaction?.transaction?.message?.accountKeys?.[0];
  return String(key?.pubkey || key || '');
}

function enrichMarketplaceEventsWithTransactionFees(events, transactions, priceSeries = {}) {
  const transactionsBySignature = new Map((transactions || []).map((transaction) => [transactionSignature(transaction), transaction]));
  return (events || []).map((event) => {
    const transaction = transactionsBySignature.get(String(event?.signature || ''));
    const feeLamports = Number(transaction?.meta?.fee);
    const transactionFeeSol = Number.isFinite(feeLamports) && feeLamports >= 0 ? feeLamports / 1e9 : null;
    const timestampMs = Number(transaction?.blockTime) * 1000;
    const sol = priceAtOrBefore(priceSeries.sol, timestampMs);
    const atlas = priceAtOrBefore(priceSeries.atlas, timestampMs);
    const transactionFeeAtlas = transactionFeeSol != null && sol && atlas
      ? transactionFeeSol * sol.price / atlas.price
      : null;
    return {
      ...event,
      slot: Number.isSafeInteger(Number(transaction?.slot)) ? Number(transaction.slot) : (event?.slot ?? null),
      transactionFeeSol,
      transactionFeeAtlas,
      transactionFeePayer: transactionFeePayer(transaction),
      transactionFeeConversionStatus: transactionFeeAtlas == null ? 'missing_price' : 'complete',
      transactionFeeConversionSource: 'Aephia token price series',
      solUsdPrice: sol?.price ?? null,
      solUsdPriceTimestamp: sol ? new Date(sol.ts).toISOString() : '',
      atlasUsdPrice: atlas?.price ?? null,
      atlasUsdPriceTimestamp: atlas ? new Date(atlas.ts).toISOString() : '',
    };
  });
}

module.exports = {
  MARKETPLACE_EVENTS_MEASUREMENT, EVENT_TYPES, eventPayloadHash, formatMarketplaceEventInfluxLine,
  deriveCustodyEventsFromRawRows, enrichMarketplaceEventsWithTransactionFees, projectMarketplaceOrderAndExecutionEvents,
};
