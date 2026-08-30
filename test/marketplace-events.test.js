'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;
const {
  MARKETPLACE_EVENTS_MEASUREMENT, eventPayloadHash, formatMarketplaceEventInfluxLine,
  deriveCustodyEventsFromRawRows,
} = require('../electron/marketplace-events');
const { DEPOSIT_CARGO_TO_GAME, WITHDRAW_CARGO_FROM_GAME } = require('../electron/marketplace-rawdata');

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

test('existing Raw Data CSS rows backfill deposit and withdrawal events without an RPC dependency', () => {
  const rawSignature = '5MvCk4mRsPaGdqQsRFEf8kvVvGkm8YAFY77XfYRj2RJ69cqNJ2qa4z6aRAToBRScASmR9GN1oaTcSmPwkpTJXTcx';
  const sageProgramId = 'SAGE111111111111111111111111111111111111111';
  const cssStarbasePlayer = 'CSS1111111111111111111111111111111111111111';
  const payload = {
    signature: rawSignature, blockTime: 1788091200,
    transaction: { signatures: [rawSignature], message: {
      accountKeys: [sageProgramId, cssStarbasePlayer],
      instructions: [
        { programIdIndex: 0, accounts: [1], data: bs58.encode(DEPOSIT_CARGO_TO_GAME) },
        { programIdIndex: 0, accounts: [1], data: bs58.encode(WITHDRAW_CARGO_FROM_GAME) },
      ],
    } },
    meta: { err: null, innerInstructions: [], preTokenBalances: [], postTokenBalances: [] },
  };
  assert.deepEqual(deriveCustodyEventsFromRawRows([
    { signature: rawSignature, discoverySource: 'css_account', payload },
  ], { cssScopes: [{ sageProgramId, address: cssStarbasePlayer }] }).map((event) => event.eventType), [
    'deposit', 'withdraw',
  ]);
});
