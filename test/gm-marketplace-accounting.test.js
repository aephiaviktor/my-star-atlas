'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGmWalletUniverse,
  createStarbasePoolKey,
  calculateForwardStockpileAverage,
  applyForwardStockpileImputation,
  matchGmCustodyFlows,
  calculateGmWalletInventoryBasis,
  enrichGmTradesWithInventoryBasis,
} = require('../electron/gm-marketplace-accounting');

test('wallet universe keeps GM wallets separate from faction profile custody wallets', () => {
  const universe = buildGmWalletUniverse({
    gmTradingWallets: ['gm-a', 'shared', 'gm-a'],
    profileWalletsByFaction: {
      MUD: ['mud-a', 'shared'],
      ONI: ['oni-a'],
      USTUR: ['ust-a', 'ust-expired', 'ust-a'],
    },
  });

  assert.deepEqual(universe.gmWallets, ['gm-a', 'shared']);
  assert.deepEqual(universe.profileWalletsByFaction, {
    MUD: ['mud-a', 'shared'], ONI: ['oni-a'], USTUR: ['ust-a', 'ust-expired'],
  });
  assert.deepEqual(universe.memberships.get('shared'), { gm: true, factions: ['MUD'] });
  assert.deepEqual(universe.allWallets, ['gm-a', 'shared', 'mud-a', 'oni-a', 'ust-a', 'ust-expired']);
});

test('starbase inventory pool identity is faction, starbase, and asset specific', () => {
  assert.equal(createStarbasePoolKey({ faction: 'UST', starbase: 'UST-1', asset: 'Electronics' }), 'USTUR\nUST-1\nElectronics');
  assert.notEqual(
    createStarbasePoolKey({ faction: 'USTUR', starbase: 'UST-1', asset: 'Electronics' }),
    createStarbasePoolKey({ faction: 'USTUR', starbase: 'MRZ-20', asset: 'Electronics' }),
  );
});

test('forward seven-day stockpile basis is quantity-and-time weighted', () => {
  const result = calculateForwardStockpileAverage([
    { timestamp: '2026-08-01T00:00:00Z', knownQuantity: 100, knownInventoryValueAtlas: 200 },
    { timestamp: '2026-08-03T00:00:00Z', knownQuantity: 300, knownInventoryValueAtlas: 1200 },
    { timestamp: '2026-08-08T00:00:00Z', knownQuantity: 1, knownInventoryValueAtlas: 999 },
  ], { from: '2026-08-01T00:00:00Z', now: '2026-08-20T00:00:00Z' });

  // (200 ATLAS * 2d + 1200 ATLAS * 5d) / (100 units * 2d + 300 units * 5d)
  assert.equal(result.unitCostAtlas, 6400 / 1700);
  assert.equal(result.provisional, false);
  assert.equal(result.provenance, 'imputed_forward_7d_stockpile_average');
});

test('GM buy custody matching supports profile-wallet hops, split deposits, and gapless remainder', () => {
  const universe = buildGmWalletUniverse({ gmTradingWallets: ['gm'], profileWalletsByFaction: { USTUR: ['p1', 'p2'] } });
  const result = matchGmCustodyFlows([
    { id: 'a', timestamp: '2026-08-01T00:00:00Z', asset: 'Electronics', quantity: 100, origin: 'wallet:gm', destination: 'wallet:p1', flow: 'wallet-transfer' },
    { id: 'b', timestamp: '2026-08-01T00:01:00Z', asset: 'Electronics', quantity: 100, origin: 'wallet:p1', destination: 'wallet:p2', flow: 'wallet-transfer' },
    { id: 'c', timestamp: '2026-08-01T00:02:00Z', asset: 'Electronics', quantity: 60, origin: 'wallet:p2', destination: 'UST-1', flow: 'css-deposit', faction: 'USTUR' },
    { id: 'd', timestamp: '2026-08-01T00:03:00Z', asset: 'Electronics', quantity: 60, origin: 'wallet:p2', destination: 'UST-1', flow: 'css-deposit', faction: 'USTUR' },
  ], universe);

  assert.deepEqual(result.buys.map(({ quantity, provenance, depositFlowId, sourceWallet }) => ({ quantity, provenance, depositFlowId, sourceWallet })), [
    { quantity: 60, provenance: 'exact', depositFlowId: 'c', sourceWallet: 'gm' },
    { quantity: 40, provenance: 'exact', depositFlowId: 'd', sourceWallet: 'gm' },
    { quantity: 20, provenance: 'imputed_fifo', depositFlowId: 'd', sourceWallet: '' },
  ]);
});

test('GM sell projection uses consumed weighted basis and reports net profit gaplessly', () => {
  const trades = [
    { id: 'buy', marketplace: 'GM', side: 'buy', quantity: 10, settledAtlas: 50 },
    { id: 'sell', marketplace: 'GM', side: 'sell', quantity: 4, settledAtlas: 32 },
  ];
  const projected = enrichGmTradesWithInventoryBasis(trades, [{
    event: { type: 'consume', purpose: 'gm-sell', tradeId: 'sell' },
    result: { quantity: 4, costs: { gm: 20 }, cargoCost: 2, uncostedQuantity: 0 },
  }]);
  assert.equal(projected[0].inventoryCostAtlas, null);
  assert.equal(projected[1].inventoryCostAtlas, 22);
  assert.equal(projected[1].netProfitAtlas, 10);
  assert.equal(projected[1].profitMarginPercent, 31.25);
  assert.equal(projected[1].basisProvenance, 'exact');
});

test('GM sell projection retains unknown quantity as zero-basis imputation instead of dropping it', () => {
  const [projected] = enrichGmTradesWithInventoryBasis([
    { id: 'sell', marketplace: 'GM', side: 'sell', quantity: 4, settledAtlas: 32 },
  ], [{
    event: { type: 'consume', purpose: 'gm-sell', tradeId: 'sell' },
    result: { quantity: 4, costs: { gm: 15 }, cargoCost: 1, uncostedQuantity: 1 },
  }]);
  assert.equal(projected.inventoryCostAtlas, 16);
  assert.equal(projected.basisProvenance, 'imputed_gapless_zero');
  assert.equal(projected.imputedQuantity, 1);
});

test('GM wallet outgoing custody lots use the rolling weighted-average stockpile basis', () => {
  const result = calculateGmWalletInventoryBasis([
    { id: 'buy-1', timestamp: '2026-08-01T00:00:00Z', wallet: 'gm', asset: 'Electronics', side: 'buy', quantity: 100, unitPriceAtlas: 2 },
    { id: 'buy-2', timestamp: '2026-08-01T01:00:00Z', wallet: 'gm', asset: 'Electronics', side: 'buy', quantity: 50, unitPriceAtlas: 4 },
    { id: 'out-1', timestamp: '2026-08-01T02:00:00Z', wallet: 'gm', asset: 'Electronics', side: 'transfer-out', quantity: 60 },
    { id: 'sell-1', timestamp: '2026-08-01T03:00:00Z', wallet: 'gm', asset: 'Electronics', side: 'sell', quantity: 10, unitPriceAtlas: 5 },
  ]);

  assert.equal(result.outgoingBasis.get('out-1').unitCostAtlas, 400 / 150);
  assert.equal(result.outgoingBasis.get('out-1').totalCostAtlas, 60 * (400 / 150));
  assert.equal(result.inventory.get('gm\nElectronics').quantity, 80);
  assert.ok(Math.abs(result.inventory.get('gm\nElectronics').totalCostAtlas - 80 * (400 / 150)) < 1e-9);
});

test('GM wallet inventory stays gapless when outgoing quantity exceeds known stock', () => {
  const result = calculateGmWalletInventoryBasis([
    { id: 'buy', timestamp: '2026-08-01T00:00:00Z', wallet: 'gm', asset: 'Food', side: 'buy', quantity: 10, unitPriceAtlas: 2 },
    { id: 'out', timestamp: '2026-08-01T01:00:00Z', wallet: 'gm', asset: 'Food', side: 'transfer-out', quantity: 15 },
  ], { fallbackUnitCost: () => 3 });

  assert.equal(result.outgoingBasis.get('out').unitCostAtlas, 7 / 3);
  assert.equal(result.outgoingBasis.get('out').totalCostAtlas, 35);
  assert.equal(result.outgoingBasis.get('out').provenance, 'imputed_forward_7d_stockpile_average');
  assert.equal(result.inventory.get('gm\nFood').quantity, 0);
});

test('GM sell custody matching retains partial arrival and pending withdrawal quantities', () => {
  const universe = buildGmWalletUniverse({ gmTradingWallets: ['gm'], profileWalletsByFaction: { USTUR: ['p1'] } });
  const result = matchGmCustodyFlows([
    { id: 'w', timestamp: '2026-08-02T00:00:00Z', asset: 'Electronics', quantity: 100, origin: 'UST-1', destination: 'wallet:p1', flow: 'css-withdraw', faction: 'USTUR' },
    { id: 't', timestamp: '2026-08-02T00:01:00Z', asset: 'Electronics', quantity: 40, origin: 'wallet:p1', destination: 'wallet:gm', flow: 'wallet-transfer' },
  ], universe);

  assert.deepEqual(result.sells.map(({ quantity, provenance, withdrawalFlowId, destinationWallet }) => ({ quantity, provenance, withdrawalFlowId, destinationWallet })), [
    { quantity: 40, provenance: 'exact', withdrawalFlowId: 'w', destinationWallet: 'gm' },
  ]);
  assert.deepEqual(result.pending.map(({ quantity, withdrawalFlowId }) => ({ quantity, withdrawalFlowId })), [
    { quantity: 60, withdrawalFlowId: 'w' },
  ]);
});

test('newest unknown basis uses available forward observations provisionally and fills every quantity', () => {
  const observations = [
    { faction: 'USTUR', starbase: 'UST-1', asset: 'Electronics', timestamp: '2026-08-25T00:00:00Z', knownQuantity: 50, knownInventoryValueAtlas: 150 },
  ];
  const imputed = applyForwardStockpileImputation([
    { faction: 'USTUR', starbase: 'UST-1', asset: 'Electronics', timestamp: '2026-08-24T00:00:00Z', unknownQuantity: 20 },
  ], observations, { now: '2026-08-26T00:00:00Z' });

  assert.equal(imputed[0].unitCostAtlas, 3);
  assert.equal(imputed[0].imputedTotalCostAtlas, 60);
  assert.equal(imputed[0].provisional, true);
  assert.equal(imputed[0].provenance, 'imputed_forward_7d_stockpile_average');
});
