'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MARKETPLACE_EVENTS_MEASUREMENT, eventPayloadHash, formatMarketplaceEventInfluxLine } = require('../electron/marketplace-events');

const signature = '5abc';

test('Marketplace event lines preserve deterministic identity and source transaction linkage', () => {
  const event = { eventId: `${signature}:0:outer`, signature, eventType: 'deposit', asset: 'Food', quantityRaw: '25' };
  const line = formatMarketplaceEventInfluxLine(event, 1788091200);
  assert.match(line, new RegExp(`^${MARKETPLACE_EVENTS_MEASUREMENT},eventType=deposit,eventId=${signature}:0:outer,signature=${signature} `));
  assert.match(line, /payload="/);
  assert.match(line, /payloadHash="[a-f0-9]{64}"/);
  assert.equal(eventPayloadHash(event), eventPayloadHash({ quantityRaw: '25', asset: 'Food', eventType: 'deposit', signature, eventId: `${signature}:0:outer` }));
});

test('Marketplace event lines reject missing transaction links and unknown types', () => {
  assert.throws(() => formatMarketplaceEventInfluxLine({ eventId: 'event', eventType: 'deposit' }, 1788091200), /invalid_marketplace_event/);
  assert.throws(() => formatMarketplaceEventInfluxLine({ eventId: 'event', signature, eventType: 'calculation' }, 1788091200), /invalid_marketplace_event/);
});
