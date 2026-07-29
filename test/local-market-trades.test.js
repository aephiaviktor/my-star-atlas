'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decodeLocalMarketTrade,
  buildLocalMarketLedgerEvents,
  formatLocalMarketInfluxLine,
} = require('../electron/local-market-trades');
const { scanLocalMarketTrades } = require('../electron/local-market-scanner');

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
    async getParsedTransactions(signatures) {
      assert.deepEqual(signatures, ['shared-sig']);
      return [fill];
    },
  };
  const trades = await scanLocalMarketTrades(connection, {
    trackedWallets: ['wallet-1', 'wallet-2'],
    marketAssetsByMint: { 'certificate-1': { starbase: 'UST-1', asset: 'Food' } },
    startIso: '2026-07-15T00:00:00Z',
  });
  assert.equal(trades.length, 1);
  assert.equal(trades[0].id, 'shared-sig:certificate-1:UST-1');
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

test('formats an idempotent Influx point with reusable LM trade dimensions', () => {
  const line = formatLocalMarketInfluxLine({ id: 'sig:0', signature: 'sig', timestamp: '2026-07-25T01:00:00Z', wallet: 'wallet', starbase: 'UST-1', asset: 'Food', side: 'buy', quantity: 10, settledAtlas: 5, unitPriceAtlas: 0.5 }, { faction: 'USTUR', profile: 'USTUR' });
  assert.match(line, /^local_market_trade,/);
  assert.match(line, /tradeId=sig:0/);
  assert.match(line, /quantity=10,settledAtlas=5,grossAtlas=5,marketplaceFeeAtlas=0,netAtlas=5,unitPriceAtlas=0.5/);
  assert.match(line, /1784941200000000000$/);
});
