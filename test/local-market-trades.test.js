'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decodeLocalMarketTrade,
  buildLocalMarketLedgerEvents,
  formatLocalMarketInfluxLine,
} = require('../electron/local-market-trades');
const { scanLocalMarketTrades, decodeLocalMarketOrder, decodeOrderExecution, fetchTransactions, resolveLocalMarketStartIso, createLocalMarketPacer, computeTxFeeAtlas, calculateExecutionAccounting, DEFAULT_REQUESTS_PER_SECOND } = require('../electron/local-market-scanner');
const crypto = require('node:crypto');
const { MarketplaceRpcBudgetExhaustedError } = require('../electron/marketplace-rpc-telemetry');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;

const GM_PROGRAM_ID = 'traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg';
const ATLAS_MINT = 'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx';

test('buyer accounting excludes the seller-paid marketplace fee from ATLAS paid', () => {
  assert.deepEqual(calculateExecutionAccounting('buy', 100, 5, 0.25, 95), {
    marketplaceFeeAtlas: 0,
    netAtlas: 100.25,
  });
  assert.deepEqual(calculateExecutionAccounting('sell', 100, 5, 0.25, 95), {
    marketplaceFeeAtlas: 5,
    netAtlas: 94.75,
  });
});

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
  assert.deepEqual(result.stats, { signatureRequests: 2, transactionRequests: 1, transactionMisses: 0, totalRpcRequests: 3 });
});

test('incremental scanner uses durable wallet and active-order cursors', async () => {
  const calls = [];
  const connection = {
    async getSignaturesForAddress(address, options) {
      calls.push({ address: String(address), options });
      return [];
    },
    async getParsedTransaction() { throw new Error('no new signatures should be fetched'); },
  };
  const result = await scanLocalMarketTrades(connection, {
    trackedWallets: ['wallet-1'], walletCursors: { 'wallet-1': 'wallet-cursor' },
    knownOrders: [{ orderId: 'order-1', createdAt: '2026-07-25T00:00:00Z' }],
    activeOrderIds: ['order-1'], openOrderIds: ['order-1'], orderCursors: { 'order-1': 'order-cursor' },
    startIso: '2026-07-24T00:00:00Z',
  });
  assert.deepEqual(calls, [
    { address: 'wallet-1', options: { limit: 1000, until: 'wallet-cursor' } },
    { address: 'order-1', options: { limit: 1000, until: 'order-cursor' } },
  ]);
  assert.deepEqual(result.walletCursors, { 'wallet-1': 'wallet-cursor' });
  assert.deepEqual(result.orderCursors, { 'order-1': 'order-cursor' });
  assert.deepEqual(result.activeOrderIds, ['order-1']);
  assert.deepEqual(result.archivedOrderIds, []);
});

test('incremental scanner performs one final check then archives a closed order', async () => {
  const calls = [];
  const connection = {
    async getSignaturesForAddress(address, options) {
      calls.push({ address: String(address), options });
      return [];
    },
  };
  const result = await scanLocalMarketTrades(connection, {
    knownOrders: [{ orderId: 'closed-order', createdAt: '2026-07-25T00:00:00Z' }],
    activeOrderIds: ['closed-order'], orderCursors: { 'closed-order': 'last-seen' }, openOrderIds: [],
    startIso: '2026-07-24T00:00:00Z',
  });
  assert.deepEqual(calls, [{ address: 'closed-order', options: { limit: 1000, until: 'last-seen' } }]);
  assert.deepEqual(result.activeOrderIds, []);
  assert.deepEqual(result.archivedOrderIds, ['closed-order']);
  assert.deepEqual(result.orderCursors, {});
  assert.deepEqual(result.orders, []);
});

test('archived orders are never queried again', async () => {
  const connection = { async getSignaturesForAddress() { throw new Error('archived order was queried'); } };
  const result = await scanLocalMarketTrades(connection, {
    knownOrders: [{ orderId: 'archived-order', createdAt: '2026-07-25T00:00:00Z' }],
    activeOrderIds: ['archived-order'], archivedOrderIds: ['archived-order'], openOrderIds: [],
    startIso: '2026-07-24T00:00:00Z',
  });
  assert.equal(result.stats.totalRpcRequests, 0);
  assert.deepEqual(result.archivedOrderIds, ['archived-order']);
});

test('schema-v1 migration archives historical closed orders without querying them', async () => {
  const connection = { async getSignaturesForAddress() { throw new Error('historical closed order was queried'); } };
  const result = await scanLocalMarketTrades(connection, {
    knownOrders: [{ orderId: 'legacy-closed', createdAt: '2026-07-25T00:00:00Z' }],
    openOrderIds: [], startIso: '2026-07-24T00:00:00Z',
  });
  assert.deepEqual(result.archivedOrderIds, ['legacy-closed']);
  assert.deepEqual(result.orders, []);
  assert.equal(result.stats.totalRpcRequests, 0);
});

test('missing parsed transactions preserve cursors and defer closed-order archival for retry', async () => {
  const connection = {
    async getSignaturesForAddress(address) {
      if (String(address) === 'wallet-1') return [{ signature: 'new-wallet-sig', blockTime: 1785410000, err: null }];
      return [{ signature: 'new-order-sig', blockTime: 1785410000, err: null }];
    },
    async getParsedTransaction() { return null; },
  };
  const result = await scanLocalMarketTrades(connection, {
    trackedWallets: ['wallet-1'], walletCursors: { 'wallet-1': 'old-wallet-sig' },
    knownOrders: [{ orderId: 'closing-order', createdAt: '2026-07-25T00:00:00Z' }],
    activeOrderIds: ['closing-order'], orderCursors: { 'closing-order': 'old-order-sig' }, openOrderIds: [],
    startIso: '2026-07-24T00:00:00Z',
  });
  assert.equal(result.stats.transactionMisses, 2);
  assert.deepEqual(result.walletCursors, { 'wallet-1': 'old-wallet-sig' });
  assert.deepEqual(result.orderCursors, { 'closing-order': 'old-order-sig' });
  assert.deepEqual(result.activeOrderIds, ['closing-order']);
  assert.deepEqual(result.archivedOrderIds, []);
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

test('transaction fetches use bounded micro-batches and fall back to singles when rejected', async () => {
  const rows = new Map(Array.from({ length: 7 }, (_, index) => [`sig-${index}`, { signature: `sig-${index}`, blockTime: index + 1 }]));
  const batches = [];
  const singles = [];
  const connection = {
    async getParsedTransactions(signatures) {
      batches.push(signatures);
      if (batches.length === 2) throw new Error('429');
      return signatures.map((signature) => ({ blockTime: 1, transaction: { signatures: [signature] }, meta: { err: null } }));
    },
    async getParsedTransaction(signature) {
      singles.push(signature);
      return { blockTime: 1, transaction: { signatures: [signature] }, meta: { err: null } };
    },
  };
  const stats = { transactionRequests: 0, transactionMisses: 0 };
  const transactions = await fetchTransactions(connection, rows, null, stats, 5);
  assert.deepEqual(batches.map((batch) => batch.length), [5, 2]);
  assert.deepEqual(singles, ['sig-5', 'sig-6']);
  assert.equal(transactions.length, 7);
  assert.equal(stats.transactionRequests, 3);
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

test('tracks ATLAS-quoted GM raw-asset orders and rejects other quote mints', () => {
  const gmContext = { marketplace: 'GM', asset: 'Food', rawMint: 'food-mint', quoteMint: ATLAS_MINT };
  const atlasOrder = decodeLocalMarketOrder(lifecycleTx({
    signature: 'gm-create', name: 'process_initialize_buy', values: [100000000, 10],
    accounts: ['handler', 'market-vars', ATLAS_MINT, 'food-mint', 'vault', 'vault-auth', 'atlas-ata', 'food-ata', 'gm-order'],
  }), { trackedWallets: ['handler'], marketAssetsByMint: { 'food-mint': gmContext } });
  assert.equal(atlasOrder.marketplace, 'GM');
  assert.equal(atlasOrder.asset, 'Food');
  assert.equal(atlasOrder.starbase, '');
  assert.equal(atlasOrder.orderId, 'gm-order');

  const usdcOrder = decodeLocalMarketOrder(lifecycleTx({
    signature: 'gm-usdc', name: 'process_initialize_buy', values: [1000000, 10],
    accounts: ['handler', 'market-vars', 'usdc-mint', 'food-mint', 'vault', 'vault-auth', 'usdc-ata', 'food-ata', 'gm-usdc-order'],
  }), { trackedWallets: ['handler'], marketAssetsByMint: { 'food-mint': gmContext } });
  assert.equal(usdcOrder, null);
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

test('local market start ISO uses the temporary rolling 3-day validation window after the anchor', () => {
  const anchorMs = Date.parse('2026-07-24T00:00:00.000Z');
  assert.equal(resolveLocalMarketStartIso(anchorMs + 6 * 24 * 60 * 60 * 1000), '2026-07-27T00:00:00.000Z');
  assert.equal(resolveLocalMarketStartIso(anchorMs + 35 * 24 * 60 * 60 * 1000), '2026-08-25T00:00:00.000Z');
  assert.equal(resolveLocalMarketStartIso(anchorMs + 90 * 24 * 60 * 60 * 1000), '2026-10-19T00:00:00.000Z');
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

test('scanner discovers custody transactions across G plus P but decodes GM executions only for G', async () => {
  const gmTx = tx({ signature: 'gm-fill', wallet: 'gm-wallet', assetMint: 'asset', assetBefore: 0, assetAfter: 10, atlasBefore: 100, atlasAfter: 90 });
  const profileTx = tx({ signature: 'profile-fill', wallet: 'profile-wallet', assetMint: 'asset', assetBefore: 0, assetAfter: 20, atlasBefore: 100, atlasAfter: 80 });
  const transactions = new Map([['gm-fill', gmTx], ['profile-fill', profileTx]]);
  const connection = {
    async getSignaturesForAddress(address) {
      const signature = String(address) === 'gm-wallet' ? 'gm-fill' : 'profile-fill';
      return [{ signature, blockTime: transactions.get(signature).blockTime, err: null }];
    },
    async getParsedTransaction(signature) { return transactions.get(signature); },
  };
  const result = await scanLocalMarketTrades(connection, {
    trackedWallets: ['gm-wallet', 'profile-wallet'],
    executionWallets: ['gm-wallet'],
    marketAssetsByMint: { asset: { starbase: 'GLOBAL', asset: 'Electronics' } },
    decodeAssetFlows: (transaction) => transaction.signature === 'profile-fill'
      ? [{ id: 'profile-flow', timestamp: '2026-07-25T00:00:00Z' }] : [],
    addressFactory: (value) => value,
    startIso: '2026-07-15T00:00:00Z',
    requestsPerSecond: 100000,
  });

  assert.deepEqual(result.trades.map((trade) => trade.wallet), ['gm-wallet']);
  assert.deepEqual(result.assetFlows.map((flow) => flow.id), ['profile-flow']);
  assert.deepEqual(Object.keys(result.walletCursors).sort(), ['gm-wallet', 'profile-wallet']);
});

test('signature exhaustion preserves incoming cursors and returns bounded partial state', async () => {
  const connection = {
    async getSignaturesForAddress(address) {
      if (String(address) === 'wallet-1') return [];
      throw new MarketplaceRpcBudgetExhaustedError('LM', 'getSignaturesForAddress');
    },
  };
  const result = await scanLocalMarketTrades(connection, {
    trackedWallets: ['wallet-1', 'wallet-2'],
    walletCursors: { 'wallet-1': 'cursor-1', 'wallet-2': 'cursor-2' },
    orderCursors: { 'order-1': 'order-cursor' },
    activeOrderIds: ['order-1'],
    startIso: '2026-07-24T00:00:00Z',
  });

  assert.equal(result.exhaustion.operation, 'LM');
  assert.deepEqual(result.walletCursors, { 'wallet-1': 'cursor-1', 'wallet-2': 'cursor-2' });
  assert.deepEqual(result.orderCursors, { 'order-1': 'order-cursor' });
  assert.equal(result.stats.signatureRequests, 1);
  assert.equal('exhaustion' in JSON.parse(JSON.stringify({ walletCursors: result.walletCursors })), false);
});

test('transaction exhaustion retains decoded trades but preserves incoming cursors', async () => {
  const first = tx({
    signature: 'decoded-before-budget', wallet: 'wallet-1', assetMint: 'certificate-1',
    assetBefore: 0, assetAfter: 12, atlasBefore: 10, atlasAfter: 10,
  });
  let parsedCalls = 0;
  const connection = {
    async getSignaturesForAddress() {
      return [
        { signature: 'decoded-before-budget', blockTime: first.blockTime, err: null },
        { signature: 'blocked-by-budget', blockTime: first.blockTime + 1, err: null },
      ];
    },
    async getParsedTransaction() {
      parsedCalls += 1;
      if (parsedCalls === 1) return first;
      throw new MarketplaceRpcBudgetExhaustedError('LM', 'getParsedTransaction');
    },
  };
  const result = await scanLocalMarketTrades(connection, {
    trackedWallets: ['wallet-1'], walletCursors: { 'wallet-1': 'prior-wallet-cursor' },
    marketAssetsByMint: { 'certificate-1': { starbase: 'UST-1', asset: 'Food' } },
    startIso: '2026-07-15T00:00:00Z',
  });

  assert.equal(result.exhaustion.method, 'getParsedTransaction');
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].signature, 'decoded-before-budget');
  assert.deepEqual(result.walletCursors, { 'wallet-1': 'prior-wallet-cursor' });
  assert.deepEqual(result.orderCursors, {});
  assert.equal(result.stats.transactionRequests, 1);
});
