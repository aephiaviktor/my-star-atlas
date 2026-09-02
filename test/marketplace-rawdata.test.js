'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;
const { Keypair } = require('@solana/web3.js');
const {
  MARKETPLACE_RAWDATA_MEASUREMENT, GM_PROGRAM_ID, DEPOSIT_CARGO_TO_GAME, WITHDRAW_CARGO_FROM_GAME,
  PROCESS_HARVEST, CLAIM_STAKE_PROGRAM_ID, CLAIM_STAKE_TREASURY_AUTHORITY,
  deriveCssStarbasePlayer, hasCssCargoGameInstruction, hasGmProgramInstruction, hasTraderProgramInstruction,
  hasTokenTransferInstruction, hasProcessHarvestInstruction,
  classifyCssCargoEvents, playerTransferEvents, buildLmRawRecords,
  formatRawTransactionInfluxLine, formatRawEventInfluxLine, scanMarketplaceRawData,
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
  assert.equal(hasCssCargoGameInstruction(transaction, { sageProgramId, cssStarbasePlayer: css }), true);
  assert.equal(hasCssCargoGameInstruction(transaction, { sageProgramId, cssStarbasePlayer: other }), true);
  assert.equal(hasCssCargoGameInstruction(tx({ accountKeys: [sageProgramId, css], instructions: [
    { programIdIndex: 0, accounts: [1], data: bs58.encode(Buffer.alloc(8, 9)) },
  ] }), { sageProgramId, cssStarbasePlayer: css }), false);
});

test('GM qualification requires the exact GM program instruction and configured wallet account', () => {
  const wallet = key(); const other = key();
  const transaction = tx({ accountKeys: [GM_PROGRAM_ID, wallet, other], instructions: [
    { programIdIndex: 0, accounts: [1], data: bs58.encode(Buffer.alloc(8, 7)) },
  ] });
  assert.equal(hasGmProgramInstruction(transaction, wallet), true);
  assert.equal(hasGmProgramInstruction(transaction, other), false);
  assert.equal(hasGmProgramInstruction(tx({ accountKeys: [wallet], instructions: [] }), wallet), false);
});

test('token qualification accepts exact transfer endpoints and rejects unrelated token instructions', () => {
  const source = key(); const destination = key(); const mint = key();
  const transaction = tx({ instructions: [
    { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: {
      type: 'transferChecked', info: { source, destination, mint, tokenAmount: { amount: '5', decimals: 0 } },
    } },
  ] });
  assert.equal(hasTokenTransferInstruction(transaction, source), true);
  assert.equal(hasTokenTransferInstruction(transaction, destination), true);
  assert.equal(hasTokenTransferInstruction(transaction, mint), false);
  assert.equal(hasTokenTransferInstruction(tx({ instructions: [
    { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: { type: 'approve', info: { source } } },
  ] }), source), false);
  const innerOnly = tx();
  innerOnly.meta.innerInstructions = [{ index: 0, instructions: [{
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: {
      type: 'transferChecked', info: { source, destination, mint, tokenAmount: { amount: '5', decimals: 0 } },
    },
  }] }];
  assert.equal(hasTokenTransferInstruction(innerOnly, source), false);
});

test('ProcessHarvest qualification accepts only exact rewards into the scanned player token account', () => {
  const playerToken = key(); const otherPlayerToken = key(); const treasuryToken = key();
  const accountKeys = [CLAIM_STAKE_PROGRAM_ID, treasuryToken, playerToken, otherPlayerToken, CLAIM_STAKE_TREASURY_AUTHORITY];
  const accounts = [0, 0, 0, 1, 1, 1, 1, 2, 3, 3, 3, 4];
  const transaction = tx({ accountKeys, instructions: [
    { programIdIndex: 0, accounts, data: bs58.encode(PROCESS_HARVEST) },
  ] });
  assert.equal(hasProcessHarvestInstruction(transaction, playerToken), true);
  assert.equal(hasProcessHarvestInstruction(transaction, otherPlayerToken), true);
  assert.equal(hasProcessHarvestInstruction(transaction, treasuryToken), false);
  const wrongAuthority = tx({ accountKeys: [...accountKeys.slice(0, 4), key()], instructions: [
    { programIdIndex: 0, accounts, data: bs58.encode(PROCESS_HARVEST) },
  ] });
  assert.equal(hasProcessHarvestInstruction(wrongAuthority, playerToken), false);
  const wrongInstruction = tx({ accountKeys, instructions: [
    { programIdIndex: 0, accounts, data: bs58.encode(Buffer.alloc(8, 9)) },
  ] });
  assert.equal(hasProcessHarvestInstruction(wrongInstruction, playerToken), false);
});

test('raw scan archives exact ProcessHarvest discovered through an owned destination token account', async () => {
  const player = key(); const playerToken = key(); const treasuryToken = key(); const signature = key();
  const accountKeys = [CLAIM_STAKE_PROGRAM_ID, treasuryToken, playerToken, CLAIM_STAKE_TREASURY_AUTHORITY];
  const transaction = tx({ signature, accountKeys, instructions: [{
    programIdIndex: 0, accounts: [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3], data: bs58.encode(PROCESS_HARVEST),
  }] });
  const connection = {
    async getSignaturesForAddress() { return [{ signature, blockTime: transaction.blockTime, slot: transaction.slot, err: null }]; },
    async getParsedTransactions() { return [transaction]; },
  };
  const scanned = await scanMarketplaceRawData(connection, {
    tokenAccounts: [{ address: playerToken, owner: player }], startIso: '2026-07-24T00:00:00Z', startSlot: 1,
  });
  assert.equal(scanned.records.length, 1);
  assert.deepEqual(scanned.records[0].discoverySources, ['token_account']);
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
  const line = formatRawTransactionInfluxLine({ transaction, discoverySource: 'gm_wallet' });
  assert.match(line, new RegExp(`^${MARKETPLACE_RAWDATA_MEASUREMENT},record=transaction,discoverySource=gm_wallet,eventId=transaction,signature=`));
  assert.match(line, /payload="/);
  assert.match(line, /payloadHash="[a-f0-9]{64}"/);
  assert.doesNotMatch(line, /discoveredBy=|streams=|fetchedAt=/);
  const eventA = formatRawEventInfluxLine({ eventId: `${signature}:0:outer`, signature, stream: 'deposit' }, transaction.blockTime);
  const eventB = formatRawEventInfluxLine({ eventId: `${signature}:1:outer`, signature, stream: 'deposit' }, transaction.blockTime);
  assert.match(eventA, /payloadHash="[a-f0-9]{64}"/);
  assert.notEqual(eventA, eventB);
});

test('LM raw projection archives only trader-program transactions without decoding instruction types', () => {
  const orderSignature = key(); const executionSignature = key(); const unrelatedSignature = key();
  const orderTransaction = tx({ signature: orderSignature, accountKeys: [GM_PROGRAM_ID], instructions: [
    { programIdIndex: 0, accounts: [], data: bs58.encode(Buffer.alloc(8, 1)) },
  ] });
  const executionTransaction = tx({ signature: executionSignature, instructions: [
    { programId: GM_PROGRAM_ID, accounts: [], data: bs58.encode(Buffer.alloc(8, 2)) },
  ] });
  const unrelatedTransaction = tx({ signature: unrelatedSignature });
  const records = buildLmRawRecords({
    transactions: [orderTransaction, executionTransaction, unrelatedTransaction],
    orders: [{ orderId: 'order-1', creationSignature: orderSignature, side: 'buy', initializer: 'wallet-1', asset: 'Iron', rawMint: 'mint-1', originalQuantity: 25, priceAtlas: 2 }],
    trades: [{ id: 'trade-1', orderId: 'order-1', signature: executionSignature, side: 'buy', wallet: 'wallet-1', asset: 'Iron', rawMint: 'mint-1', quantity: 5, grossAtlas: 10 }],
  });
  assert.equal(hasTraderProgramInstruction(orderTransaction), true);
  assert.equal(hasTraderProgramInstruction(unrelatedTransaction), false);
  assert.deepEqual(records.map((record) => record.signature), [orderSignature, executionSignature]);
  assert.ok(records.every((record) => !Object.hasOwn(record, 'events')));
  assert.ok(records.every((record) => record.discoverySources[0] === 'lm_scanner'));
});
