'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;
const {
  MARKETPLACE_EVENTS_MEASUREMENT, eventPayloadHash, formatMarketplaceEventInfluxLine,
  deriveCustodyEventsFromRawRows, enrichMarketplaceEventsWithTransactionFees,
} = require('../electron/marketplace-events');
const { DEPOSIT_CARGO_TO_GAME, WITHDRAW_CARGO_FROM_GAME, PROCESS_HARVEST,
  CLAIM_STAKE_PROGRAM_ID, CLAIM_STAKE_TREASURY_AUTHORITY } = require('../electron/marketplace-rawdata');

const signature = '5abc';

test('Marketplace event lines preserve deterministic identity and source transaction linkage', () => {
  const event = { eventId: `${signature}:0:outer`, signature, eventType: 'deposit', asset: 'Food', quantityRaw: '25' };
  const line = formatMarketplaceEventInfluxLine(event, 1788091200);
  assert.match(line, new RegExp(`^${MARKETPLACE_EVENTS_MEASUREMENT},eventType=deposit,eventId=${signature}:0:outer,signature=${signature} `));
  assert.match(line, /payload="/);
  assert.match(line, /payloadHash="[a-f0-9]{64}"/);
  assert.equal(eventPayloadHash(event), eventPayloadHash({ quantityRaw: '25', asset: 'Food', eventType: 'deposit', signature, eventId: `${signature}:0:outer` }));
});

test('transaction fees use independently forward-filled historical SOL/USD and ATLAS/USD prices', () => {
  const transaction = {
    signature: 'fee-signature', blockTime: 1788091200, slot: 443094410,
    transaction: { signatures: ['fee-signature'], message: { accountKeys: [{ pubkey: 'fee-payer' }] } },
    meta: { fee: 5000 },
  };
  const [event] = enrichMarketplaceEventsWithTransactionFees([
    { eventId: 'fee-signature:0', signature: 'fee-signature', eventType: 'transfer' },
  ], [transaction], {
    sol: [[1788090000000, 150], [1788091800000, 999]],
    atlas: [[1788089400000, 0.0015], [1788090600000, 0.002], [1788091800000, 9]],
  });
  assert.equal(event.transactionFeeSol, 0.000005);
  assert.equal(event.slot, 443094410);
  assert.equal(event.transactionFeeAtlas, 0.375);
  assert.equal(event.transactionFeePayer, 'fee-payer');
  assert.equal(event.transactionFeeConversionSource, 'Aephia token price series');
  assert.equal(event.solUsdPriceTimestamp, '2026-08-30T11:40:00.000Z');
  assert.equal(event.atlasUsdPriceTimestamp, '2026-08-30T11:50:00.000Z');
});

test('transaction fee ATLAS remains unavailable without both prior positive token prices', () => {
  const transaction = { signature: 'missing-price', blockTime: 1788091200,
    transaction: { signatures: ['missing-price'], message: { accountKeys: ['payer'] } }, meta: { fee: 5000 } };
  const [event] = enrichMarketplaceEventsWithTransactionFees([
    { eventId: 'missing-price:0', signature: 'missing-price', eventType: 'deposit' },
  ], [transaction], { sol: [[1788091800000, 150]], atlas: [[1788090600000, 0.002]] });
  assert.equal(event.transactionFeeSol, 0.000005);
  assert.equal(event.transactionFeeAtlas, null);
  assert.equal(event.transactionFeeConversionStatus, 'missing_price');
});

test('Marketplace event lines reject missing transaction links and unknown types', () => {
  assert.throws(() => formatMarketplaceEventInfluxLine({ eventId: 'event', eventType: 'deposit' }, 1788091200), /invalid_marketplace_event/);
  assert.throws(() => formatMarketplaceEventInfluxLine({ eventId: 'event', signature, eventType: 'calculation' }, 1788091200), /invalid_marketplace_event/);
});

test('existing Raw Data CSS rows backfill deposit and withdrawal events without an RPC dependency', () => {
  const rawSignature = '5MvCk4mRsPaGdqQsRFEf8kvVvGkm8YAFY77XfYRj2RJ69cqNJ2qa4z6aRAToBRScASmR9GN1oaTcSmPwkpTJXTcx';
  const sageProgramId = 'SAGE111111111111111111111111111111111111111';
  const cssStarbasePlayer = 'CSS1111111111111111111111111111111111111111';
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(10n);
  const payload = {
    signature: rawSignature, blockTime: 1788091200,
    transaction: { signatures: [rawSignature], message: {
      accountKeys: [sageProgramId, cssStarbasePlayer, 'starbase', 'profile', 'wallet', 'from-token', 'to-token', 'mint'],
      instructions: [
        { programIdIndex: 0, accounts: [2, 1, 1, 1, 1, 1, 3, 1, 1, 1, 5, 6, 1, 7], data: bs58.encode(Buffer.concat([DEPOSIT_CARGO_TO_GAME, amount])) },
        { programIdIndex: 0, accounts: [2, 1, 1, 1, 1, 1, 3, 1, 1, 1, 5, 6, 1, 7], data: bs58.encode(Buffer.concat([WITHDRAW_CARGO_FROM_GAME, amount])) },
      ],
    } },
    meta: {
      err: null, innerInstructions: [],
      preTokenBalances: [{ accountIndex: 5, mint: 'mint', owner: 'wallet-from' }],
      postTokenBalances: [{ accountIndex: 6, mint: 'mint', owner: 'wallet-to' }],
    },
  };
  const events = deriveCustodyEventsFromRawRows([
    { signature: rawSignature, discoverySource: 'css_account', payload },
  ], {
    cssScopes: [{ faction: 'MUD', starbase: 'MUD-1', sageProgramId, address: cssStarbasePlayer }],
    assetsByMint: { mint: { name: 'Fuel' } },
  });
  assert.deepEqual(events.map((event) => event.eventType), ['deposit', 'withdraw']);
  assert.ok(events.every((event) => event.faction === 'MUD' && event.starbase === 'MUD-1'));
  assert.ok(events.every((event) => event.asset === 'Fuel'));
  assert.ok(events.every((event) => event.quantityRaw === '10'));
});

test('decoded wallet transfers carry the registered asset name into the ledger', () => {
  const transaction = {
    blockTime: 1788091200,
    transaction: { signatures: ['wallet-transfer'], message: {
      accountKeys: ['source-token', 'destination-token'],
      instructions: [{ parsed: { type: 'transferChecked', info: {
        source: 'source-token', destination: 'destination-token', mint: 'carbon-mint',
        tokenAmount: { amount: '125', decimals: 0 },
      } } }],
    } },
    meta: {
      err: null, innerInstructions: [],
      preTokenBalances: [
        { accountIndex: 0, owner: 'gm-wallet', mint: 'carbon-mint' },
        { accountIndex: 1, owner: 'player-wallet', mint: 'carbon-mint' },
      ],
      postTokenBalances: [
        { accountIndex: 0, owner: 'gm-wallet', mint: 'carbon-mint' },
        { accountIndex: 1, owner: 'player-wallet', mint: 'carbon-mint' },
      ],
    },
  };
  const [event] = deriveCustodyEventsFromRawRows([
    { signature: 'wallet-transfer', discoverySource: 'token_account', payload: transaction },
  ], { assetsByMint: { 'carbon-mint': { name: 'Carbon' } } });
  assert.equal(event.eventType, 'transfer');
  assert.equal(event.asset, 'Carbon');
});

test('Claim Stake ProcessHarvest emits zero-principal reward inventory movements', () => {
  const transaction = {
    blockTime: 1788290000,
    transaction: { signatures: ['harvest-signature'], message: {
      accountKeys: ['player', CLAIM_STAKE_PROGRAM_ID, CLAIM_STAKE_TREASURY_AUTHORITY, 'treasury-token', 'player-token'],
      instructions: [{ programIdIndex: 1, accounts: [0, 0, 0, 3, 3, 3, 3, 4, 4, 4, 4, 2], data: bs58.encode(PROCESS_HARVEST) }],
    } },
    meta: {
      err: null, innerInstructions: [{ index: 0, instructions: [{ parsed: { type: 'transfer', info: {
        source: 'treasury-token', destination: 'player-token', amount: '25',
      } } }] }],
      preTokenBalances: [
        { accountIndex: 3, mint: 'ammo-mint', owner: CLAIM_STAKE_TREASURY_AUTHORITY, uiTokenAmount: { amount: '100', decimals: 0, uiAmountString: '100' } },
        { accountIndex: 4, mint: 'ammo-mint', owner: 'player', uiTokenAmount: { amount: '0', decimals: 0, uiAmountString: '0' } },
      ],
      postTokenBalances: [
        { accountIndex: 3, mint: 'ammo-mint', owner: CLAIM_STAKE_TREASURY_AUTHORITY, uiTokenAmount: { amount: '75', decimals: 0, uiAmountString: '75' } },
        { accountIndex: 4, mint: 'ammo-mint', owner: 'player', uiTokenAmount: { amount: '25', decimals: 0, uiAmountString: '25' } },
      ],
    },
  };
  const events = deriveCustodyEventsFromRawRows([
    { signature: 'harvest-signature', discoverySource: 'token_account', payload: transaction },
  ], { assetsByMint: { 'ammo-mint': { name: 'Ammo' } } });
  assert.equal(events.length, 1, 'harvest token transfers must not be duplicated as generic custody transfers');
  const reward = events.find((event) => event.eventType === 'reward');
  assert.deepEqual({ action: reward.action, from: reward.fromWallet, to: reward.toWallet, asset: reward.asset,
    quantity: reward.quantityRaw, principal: reward.principalAtlas }, {
    action: 'process_harvest', from: CLAIM_STAKE_TREASURY_AUTHORITY, to: 'player', asset: 'Ammunition', quantity: '25', principal: 0,
  });
});
