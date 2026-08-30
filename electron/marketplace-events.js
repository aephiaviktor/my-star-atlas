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
        }).map((event) => ({ ...event, eventType: event.stream, action: event.type })));
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

module.exports = {
  MARKETPLACE_EVENTS_MEASUREMENT, EVENT_TYPES, eventPayloadHash, formatMarketplaceEventInfluxLine,
  deriveCustodyEventsFromRawRows,
};
