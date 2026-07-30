'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decodeLocalMarketTrade,
  buildLocalMarketLedgerEvents,
  formatLocalMarketInfluxLine,
} = require('../electron/local-market-trades');
const { scanLocalMarketTrades, decodeLocalMarketOrder, decodeOrderExecution, fetchTransactions, resolveLocalMarketStartIso, createLocalMarketPacer, computeTxFeeAtlas, DEFAULT_REQUESTS_PER_SECOND } = require('../electron/local-market-scanner');
const crypto = require('node:crypto');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;

const GM_PROGRAM_ID = 'traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg';
const ATLAS_MINT = 'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx';

function tx({ signature, wallet, assetMint, assetBefore, assetAfter, atlasBefore, atlasAfter }) {
  return {
    signature,
    blockTime: 1784159245,
    meta: {
      err: null,
      logMessages: [
        'Program log: Instruction: ProcessExchange',
        'Program log: Original Price: 100000000',
        'Program log: Transfer amounts: TransferAmount { purchase_quantity: 12, royalty: 50000000, transfer_amount: 1150000000, commission: None }',
        'Program log: Order exchange successful.',
      ],
      preTokenBalances: [
        { accountIndex: 1, mint: assetMint, owner: wallet, uiTokenAmount: { uiAmountString: String(assetBefore) } },
        { accountIndex: 2, mint: ATLAS_MINT, owner: wallet, uiTokenAmount: { uiAmountString: String(atlasBefore) } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: assetMint, owner: wallet, uiTokenAmount: { uiAmountString: String(assetAfter) } },
        { accountIndex: 2, mint: ATLAS_MINT, owner: wallet, uiTokenAmount: { uiAmountString: String(atlasAfter) } },
      ],
    },
    transaction: { message: { accountKeys: [{ pubkey: GM_PROGRAM_ID }, { pubkey: assetMint }] } },
  };
}

test('decodes an LM buy from confirmed wallet token deltas using settled ATLAS cost', () => {
  const trade = decodeLocalMarketTrade(tx({
    signature: 'buy-sig', wallet: 'wallet-1', assetMint: 'certificate-1', assetBefore: 0, assetAfter: 12,
    // Buy funds were escrowed when the order was placed, so the buyer's
    // ATLAS account does not change in the later fill transaction.
    atlasBefore: 87.5, atlasAfter: 87.5,
  }), {
    trackedWallets: ['wallet-1'],
    marketAssetsByMint: { 'certificate-1': { starbase: 'UST-1', asset: 'Food', rawMint: 'food-mint' } },
  });
  assert.deepEqual(trade, {
    id: 'buy-sig:certificate-1:UST-1', signature: 'buy-sig', timestamp: '2026-07-15T23:47:25.000Z',
    wallet: 'wallet-1', starbase: 'UST-1', asset: 'Food', rawMint: 'food-mint', certificateMint: 'certificate-1',
    side: 'buy', quantity: 12, settledAtlas: 12, grossAtlas: 12, marketplaceFeeAtlas: 0.5, netAtlas: 11.5, unitPriceAtlas: 1,
  });
});

test('decodes an LM sell and ignores failed or non-exchange transactions', () => {
  const input = tx({ signature: 'sell-sig', wallet: 'wallet-1', assetMint: 'certificate-1', assetBefore: 20, assetAfter: 20, atlasBefore: 10, atlasAfter: 21.5 });
  const trade = decodeLocalMarketTrade(input, { trackedWallets: ['wallet-1'], marketAssetsByMint: { 'certificate-1': { starbase: 'MUD-2', asset: 'Carbon' } } });
  assert.equal(trade.side, 'sell');
  assert.equal(trade.quantity, 12);
  assert.equal(trade.settledAtlas, 11.5);
  assert.equal(trade.grossAtlas, 12);
  assert.equal(trade.marketplaceFeeAtlas, 0.5);
  assert.equal(decodeLocalMarketTrade({ ...input, meta: { ...input.meta, err: { custom: 1 } } }, { trackedWallets: ['wallet-1'], marketAssetsByMint: {} }), null);
  assert.equal(decodeLocalMarketTrade({ ...input, meta: { ...input.meta, logMessages: [] } }, { trackedWallets: ['wallet-1'], marketAssetsByMint: {} }), null);
});

test('scanner deduplicates signatures found through multiple profile wallets', async () => {
  const fill = tx({ signature: 'shared-sig', wallet: 'wallet-1', assetMint: 'certificate-1', assetBefore: 0, assetAfter: 12, atlasBefore: 10, atlasAfter: 10 });
  const connection = {
    async getSignaturesForAddress() {
      return [{ signature: 'shared-sig', blockTime: fill.blockTime, err: null }];
    },
    async getParsedTransaction(signature) {
      assert.equal(signature, 'shared-sig');
      return fill;
    },
  };
  const result = await scanLocalMarketTrades(connection, {
    trackedWallets: ['wallet-1', 'wallet-2'],
    marketAssetsByMint: { 'certificate-1': { starbase: 'UST-1', asset: 'Food' } },
    startIso: '2026-07-15T00:00:00Z',
  });
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].id, 'shared-sig:certificate-1:UST-1');
  assert.deepEqual(result.stats, { signatureRequests: 2, transactionRequests: 1, totalRpcRequests: 3 });
});

function gmData(name, ...values) {
  const discriminator = crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
  const encoded = values.map((value) => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; });
  return bs58.encode(Buffer.concat([discriminator, ...encoded]));
}

function lifecycleTx({ signature, name, accounts, values = [], fee = 5000, logs = [] }) {
  return {
    signature, blockTime: 1784159245,
    meta: { err: null, fee, logMessages: logs, preTokenBalances: [], postTokenBalances: [] },
    transaction: { signatures: [signature], message: { accountKeys: accounts.map((pubkey, index) => ({ pubkey, signer: index === 0 })), instructions: [{ programId: GM_PROGRAM_ID, accounts, data: gmData(name, ...values) }] } },
  };
}

test('transaction fetches use one RPC call per signature so batch-disabled plans still work', async () => {
  const rows = new Map(Array.from({ length: 5 }, (_, index) => {
    const signature = `signature-${index}`;
    return [signature, { signature, blockTime: index + 1 }];
  }));
  const calledSignatures = [];
  const connection = {
    async getParsedTransaction(signature) {
      calledSignatures.push(signature);
      return { blockTime: Number(signature.split('-')[1]) + 1, transaction: { signatures: [signature] }, meta: { err: null } };
    },
    getParsedTransactions() {
      throw new Error('getParsedTransactions must not be used for batch-disabled RPC plans');
    },
  };

  const transactions = await fetchTransactions(connection, rows);
  assert.equal(transactions.length, 5);
  assert.deepEqual(calledSignatures, Array.from(rows.keys()));
  assert.deepEqual(transactions.map((transaction) => transaction.signature), Array.from(rows.keys()));
});

test('tracks LM order creation separately and matches fills by order ID', () => {
  const orderTx = lifecycleTx({
    signature: 'create', name: 'process_initialize_sell', values: [34900, 30000000],
    accounts: ['lancer', 'market-vars', 'certificate-1', ATLAS_MINT, 'vault', 'vault-auth', 'asset-ata', 'atlas-ata', 'order-1'],
  });
  const order = decodeLocalMarketOrder(orderTx, {
    trackedWallets: ['handler', 'lancer'],
    marketAssetsByMint: { 'certificate-1': { starbase: 'ONI-1', asset: 'Hydrogen', rawMint: 'hydrogen-mint' } },
    atlasPerSol: 1000,
  });
  assert.equal(order.orderId, 'order-1');
  assert.equal(order.side, 'sell');
  assert.equal(order.priceAtlas, 0.000349);
  assert.equal(order.creationSignature, 'create');
  assert.equal(order.creationTxFeeSol, 0.000005);
  assert.equal(order.creationTxFeeAtlas, 0.005);

  const fillTx = lifecycleTx({
    signature: 'fill', name: 'process_exchange', values: [10000000, 34900], fee: 5000,
    accounts: ['taker', 'taker-deposit', 'taker-receive', ATLAS_MINT, 'certificate-1', 'lancer', 'init-deposit', 'init-receive', 'vault', 'vault-auth', 'order-1'],
    logs: ['Program log: Transfer amounts: TransferAmount { purchase_quantity: 10000000, royalty: 3490000, transfer_amount: 348965100000, commission: None }'],
  });
  const execution = decodeOrderExecution(fillTx, new Map([[order.orderId, order]]), ['handler', 'lancer']);
  assert.equal(execution.orderId, 'order-1');
  assert.equal(execution.quantity, 10000000);
  assert.equal(execution.marketplaceFeeAtlas, 0.0349);
  assert.ok(Math.abs(execution.txFeeAtlas - (0.005 / 3)) < 1e-12);
  assert.ok(Math.abs(execution.netAtlas - (3489.651 - (0.005 / 3))) < 1e-12);
  assert.equal(execution.creationSignature, 'create');
});

test('LM execution tx fee converts from SOL to ATLAS using the cached atlasPerSol rate', () => {
  const txWithoutUserPayer = lifecycleTx({
    signature: 'fill', name: 'process_exchange', values: [10000000, 34900], fee: 5000,
    accounts: ['taker', 'taker-deposit', 'taker-receive', ATLAS_MINT, 'certificate-1', 'lancer', 'init-deposit', 'init-receive', 'vault', 'vault-auth', 'order-1'],
    logs: ['Program log: Transfer amounts: TransferAmount { purchase_quantity: 10000000, royalty: 3490000, transfer_amount: 348965100000, commission: None }'],
  });
  const order = { orderId: 'order-1', side: 'sell', initializer: 'lancer', priceAtlas: 0.000349 };
  const execution = decodeOrderExecution(txWithoutUserPayer, new Map([[order.orderId, order]]), ['handler', 'lancer'], { atlasPerSol: 1000 });
  assert.equal(execution.txFeeAtlas, 0);
});

test('LM execution tx fee is attributed to the user when their wallet pays it and atlasPerSol is supplied', () => {
  const order = { orderId: 'order-1', side: 'sell', initializer: 'lancer', priceAtlas: 0.000349 };
  const userPayerTx = lifecycleTx({
    signature: 'fill-user-pays', name: 'process_exchange', values: [10000000, 34900], fee: 5000,
    accounts: ['lancer', 'lancer-deposit', 'lancer-receive', ATLAS_MINT, 'certificate-1', 'init-deposit', 'init-receive', 'vault', 'vault-auth', 'taker', 'order-1'],
    logs: ['Program log: Transfer amounts: TransferAmount { purchase_quantity: 10000000, royalty: 3490000, transfer_amount: 348965100000, commission: None }'],
  });
  const execution = decodeOrderExecution(userPayerTx, new Map([[order.orderId, order]]), ['lancer', 'handler'], { atlasPerSol: 1000 });
  // 5000 lamports = 0.000005 SOL; atlasPerSol = 1000 → 0.005 ATLAS
  assert.equal(execution.txFeeAtlas, 0.005);
  assert.equal(computeTxFeeAtlas({ meta: { fee: 0 } }, 1000), 0);
  assert.equal(computeTxFeeAtlas({ meta: { fee: 5000 } }, null), 0);
  assert.equal(computeTxFeeAtlas({}, 1000), 0);
});

test('local market start ISO falls back to a rolling 30-day window after the anchor', () => {
  const anchorMs = Date.parse('2026-07-24T00:00:00.000Z');
  assert.equal(resolveLocalMarketStartIso(anchorMs + 6 * 24 * 60 * 60 * 1000), '2026-07-24T00:00:00.000Z');
  assert.equal(resolveLocalMarketStartIso(anchorMs + 35 * 24 * 60 * 60 * 1000), '2026-07-29T00:00:00.000Z');
  assert.equal(resolveLocalMarketStartIso(anchorMs + 90 * 24 * 60 * 60 * 1000), '2026-09-22T00:00:00.000Z');
});

test('local market pacer spaces calls and never exceeds the configured rate', async () => {
  const pacer = createLocalMarketPacer(20);
  const start = Date.now();
  for (let index = 0; index < 5; index += 1) await pacer();
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 4 * 50 - 10, `expected >=190ms (got ${elapsed}ms) for 5 calls at 20 RPS`);
  assert.equal(DEFAULT_REQUESTS_PER_SECOND, 8);
});

test('LM buys acquire weighted lm basis while sells consume local weighted basis', () => {
  assert.deepEqual(buildLocalMarketLedgerEvents([
    { id: 'a', timestamp: '2026-07-25T01:00:00Z', starbase: 'UST-1', asset: 'Food', side: 'buy', quantity: 10, settledAtlas: 5 },
    { id: 'b', timestamp: '2026-07-25T02:00:00Z', starbase: 'UST-1', asset: 'Food', side: 'sell', quantity: 4, settledAtlas: 3 },
  ]), [
    { type: 'acquire', timestamp: '2026-07-25T01:00:00.000Z', location: 'UST-1', asset: 'Food', quantity: 10, source: 'lm', totalCost: 5, tradeId: 'a' },
    { type: 'consume', timestamp: '2026-07-25T02:00:00.000Z', location: 'UST-1', asset: 'Food', quantity: 4, purpose: 'lm-sell', tradeId: 'b' },
  ]);
});

test('formats an idempotent Influx point under the marketplace measurement with the LM market tag', () => {
  const line = formatLocalMarketInfluxLine({ id: 'sig:0', signature: 'sig', timestamp: '2026-07-25T01:00:00Z', wallet: 'wallet', starbase: 'UST-1', asset: 'Food', side: 'buy', quantity: 10, settledAtlas: 5, unitPriceAtlas: 0.5 }, { faction: 'USTUR', profile: 'USTUR' });
  assert.match(line, /^marketplace,/);
  assert.match(line, /market=LM/);
  assert.match(line, /tradeId=sig:0/);
  assert.match(line, /quantity=10,settledAtlas=5,grossAtlas=5,marketplaceFeeAtlas=0,txFeeAtlas=0,netAtlas=5,unitPriceAtlas=0.5/);
  assert.match(line, /1784941200000000000$/);
});

test('allows overriding the market tag so future GM trades can share the measurement', () => {
  const line = formatLocalMarketInfluxLine({ id: 'sig:1', signature: 'sig', timestamp: '2026-07-25T01:00:00Z', wallet: 'wallet', starbase: 'UST-1', asset: 'Food', side: 'buy', quantity: 1, settledAtlas: 1, unitPriceAtlas: 1 }, { faction: 'USTUR', profile: 'USTUR', market: 'GM' });
  assert.match(line, /^marketplace,/);
  assert.match(line, /market=GM/);
});
