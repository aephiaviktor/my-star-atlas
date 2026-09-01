'use strict';

const crypto = require('node:crypto');
const { classifyCssCargoEvents, playerTransferEvents } = require('./marketplace-rawdata');

const MARKETPLACE_EVENTS_MEASUREMENT = 'marketplace_events';
const EVENT_TYPES = new Set(['deposit', 'withdraw', 'transfer', 'lm', 'gm']);

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

function deriveCustodyEventsFromRawRows(rawRows, { cssScopes = [] } = {}) {
  const events = [];
  for (const row of rawRows || []) {
    const transaction = row?.payload;
    if (!transaction || typeof transaction !== 'object') continue;
    const sources = rawRowSources(row);
    if (sources.has('css_account') || sources.has('multiple')) {
      for (const scope of cssScopes) {
        events.push(...classifyCssCargoEvents(transaction, {
          sageProgramId: scope.sageProgramId, cssStarbasePlayer: scope.address,
        }).map((event) => ({
          ...event, eventType: event.stream, action: event.type,
          faction: String(scope.faction || ''), starbase: String(scope.starbase || ''),
        })));
      }
    }
    if (sources.has('token_account') || sources.has('multiple')) {
      const balanceOwners = [...new Set([
        ...(transaction.meta?.preTokenBalances || []), ...(transaction.meta?.postTokenBalances || []),
      ].map((balance) => String(balance?.owner || '')).filter(Boolean))];
      events.push(...playerTransferEvents(transaction, balanceOwners).map((event) => ({
        ...event, eventType: 'transfer', action: 'transfer',
      })));
    }
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
  deriveCustodyEventsFromRawRows, enrichMarketplaceEventsWithTransactionFees,
};
