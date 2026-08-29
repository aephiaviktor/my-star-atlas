'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;
const { Keypair } = require('@solana/web3.js');
const {
  MARKETPLACE_RAWDATA_MEASUREMENT, DEPOSIT_CARGO_TO_GAME, WITHDRAW_CARGO_FROM_GAME,
  deriveCssStarbasePlayer, classifyCssCargoEvents, playerTransferEvents, buildLmRawRecords,
  formatRawTransactionInfluxLine, formatRawEventInfluxLine,
} = require('../electron/marketplace-rawdata');

function key() { return Keypair.generate().publicKey.toBase58(); }
function tx({ signature = key(), accountKeys = [], instructions = [], preTokenBalances = [], postTokenBalances = [] } = {}) {
  return { slot: 123, blockTime: 1788030000, transaction: { signatures: [signature], message: { accountKeys, instructions } },
    meta: { err: null, fee: 5000, preTokenBalances, postTokenBalances, innerInstructions: [] } };
}

test('derives one deterministic CSS StarbasePlayer from profile, game and CSS starbase', () => {
  const input = { sageProgramId: key(), gameId: key(), playerProfile: key(), starbase: key() };
  const first = deriveCssStarbasePlayer(input);
  assert.equal(deriveCssStarbasePlayer(input), first);
  assert.notEqual(deriveCssStarbasePlayer({ ...input, starbaseSeqId: 1 }), first);
});

test('CSS candidate classification retains only exact deposit and withdraw instructions for that StarbasePlayer', () => {
  const sageProgramId = key();
  const css = key();
  const other = key();
  const signature = key();
  const transaction = tx({ signature, accountKeys: [sageProgramId, css, other], instructions: [
    { programIdIndex: 0, accounts: [1], data: bs58.encode(DEPOSIT_CARGO_TO_GAME) },
    { programIdIndex: 0, accounts: [1], data: bs58.encode(WITHDRAW_CARGO_FROM_GAME) },
    { programIdIndex: 0, accounts: [2], data: bs58.encode(DEPOSIT_CARGO_TO_GAME) },
    { programIdIndex: 0, accounts: [1], data: bs58.encode(Buffer.alloc(8, 9)) },
  ] });
  assert.deepEqual(classifyCssCargoEvents(transaction, { sageProgramId, cssStarbasePlayer: css }).map((row) => row.stream), ['deposit', 'withdraw']);
  assert.deepEqual(classifyCssCargoEvents(transaction, { sageProgramId, cssStarbasePlayer: css }).map((row) => row.eventId), [
    `${signature}:0:outer`, `${signature}:1:outer`,
  ]);
});

test('transfer projection keeps only balanced token movements between configured player owners', () => {
  const mud = key(); const oni = key(); const outsider = key(); const mint = key(); const signature = key();
  const transaction = tx({ signature,
    preTokenBalances: [
      { accountIndex: 0, owner: mud, mint, uiTokenAmount: { amount: '500', decimals: 2 } },
      { accountIndex: 1, owner: oni, mint, uiTokenAmount: { amount: '0', decimals: 2 } },
      { accountIndex: 2, owner: outsider, mint, uiTokenAmount: { amount: '50', decimals: 2 } },
    ],
    postTokenBalances: [
      { accountIndex: 0, owner: mud, mint, uiTokenAmount: { amount: '375', decimals: 2 } },
      { accountIndex: 1, owner: oni, mint, uiTokenAmount: { amount: '125', decimals: 2 } },
      { accountIndex: 2, owner: outsider, mint, uiTokenAmount: { amount: '50', decimals: 2 } },
    ],
  });
  assert.deepEqual(playerTransferEvents(transaction, [mud, oni]), [{ eventId: `${signature}:transfer:0`, signature,
    stream: 'transfer', fromWallet: mud, toWallet: oni, mint, quantityRaw: '125', decimals: 2 }]);
});

test('raw Influx projection preserves the complete transaction and separate event identities', () => {
  const signature = key();
  const transaction = tx({ signature });
  const line = formatRawTransactionInfluxLine({ transaction });
  assert.match(line, new RegExp(`^${MARKETPLACE_RAWDATA_MEASUREMENT},record=transaction,stream=chain,eventId=transaction,signature=`));
  assert.match(line, /payload="/);
  assert.match(line, /payloadHash="[a-f0-9]{64}"/);
  assert.doesNotMatch(line, /discoveredBy=|streams=|fetchedAt=/);
  const eventA = formatRawEventInfluxLine({ eventId: `${signature}:0:outer`, signature, stream: 'deposit' }, transaction.blockTime);
  const eventB = formatRawEventInfluxLine({ eventId: `${signature}:1:outer`, signature, stream: 'deposit' }, transaction.blockTime);
  assert.match(eventA, /payloadHash="[a-f0-9]{64}"/);
  assert.notEqual(eventA, eventB);
});

test('LM projection archives only already-fetched transactions with decoded order or execution facts', () => {
  const orderSignature = key(); const executionSignature = key(); const unrelatedSignature = key();
  const orderTransaction = tx({ signature: orderSignature });
  const executionTransaction = tx({ signature: executionSignature });
  const unrelatedTransaction = tx({ signature: unrelatedSignature });
  const records = buildLmRawRecords({
    transactions: [orderTransaction, executionTransaction, unrelatedTransaction],
    orders: [{ orderId: 'order-1', creationSignature: orderSignature, side: 'buy', initializer: 'wallet-1', asset: 'Iron', rawMint: 'mint-1', originalQuantity: 25, priceAtlas: 2 }],
    trades: [{ id: 'trade-1', orderId: 'order-1', signature: executionSignature, side: 'buy', wallet: 'wallet-1', asset: 'Iron', rawMint: 'mint-1', quantity: 5, grossAtlas: 10 }],
  });
  assert.deepEqual(records.map((record) => record.signature), [orderSignature, executionSignature]);
  assert.deepEqual(records.flatMap((record) => record.events.map((event) => event.type)), ['order_created', 'execution']);
  assert.ok(records.every((record) => record.streams[0] === 'lm'));
});
