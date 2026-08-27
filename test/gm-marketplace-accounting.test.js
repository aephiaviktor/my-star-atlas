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
  projectGmFactionMarketplaceRows,
  formatGmFactionMarketplaceTestLine,
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

test('GM buys become faction rows only when DepositCargoToGame consumes global weighted-average inventory', () => {
  const universe = buildGmWalletUniverse({ gmTradingWallets: ['gm'], profileWalletsByFaction: { USTUR: ['hhd'] } });
  const rows = projectGmFactionMarketplaceRows({
    walletUniverse: universe,
    trades: [
      { id: 'b1', timestamp: '2026-08-24T00:00:00Z', marketplace: 'GM', side: 'buy', wallet: 'gm', asset: 'Fuel', rawMint: 'fuel', quantity: 100, settledAtlas: 200 },
      { id: 'b2', timestamp: '2026-08-24T01:00:00Z', marketplace: 'GM', side: 'buy', wallet: 'gm', asset: 'Fuel', rawMint: 'fuel', quantity: 50, settledAtlas: 200 },
    ],
    flows: [
      { id: 'move', signature: 'move-sig', timestamp: '2026-08-25T00:00:00Z', flow: 'wallet-transfer', asset: 'Fuel', rawMint: 'fuel', quantity: 60, origin: 'wallet:gm', destination: 'wallet:hhd' },
      { id: 'deposit', signature: 'deposit-sig', timestamp: '2026-08-26T00:00:00Z', flow: 'css-deposit', asset: 'Fuel', rawMint: 'fuel', quantity: 60, origin: 'wallet:hhd', destination: 'UST-1', faction: 'USTUR', starbase: 'UST-1' },
    ],
  });
  assert.deepEqual(rows.map((row) => ({ side: row.side, faction: row.faction, timestamp: row.timestamp, quantity: row.quantity, unitPriceAtlas: row.unitPriceAtlas })), [
    { side: 'buy', faction: 'USTUR', timestamp: '2026-08-26T00:00:00Z', quantity: 60, unitPriceAtlas: 400 / 150 },
  ]);
});

test('GM deposits with unknown wallet basis use faction starbase observations instead of zero', () => {
  const universe = buildGmWalletUniverse({ gmTradingWallets: ['gm'], profileWalletsByFaction: { USTUR: ['ust'] } });
  const input = {
    walletUniverse: universe,
    trades: [],
    flows: [
      { id: 'move', timestamp: '2026-08-25T00:00:00Z', flow: 'wallet-transfer', asset: 'Ammo', rawMint: 'ammo', quantity: 50, origin: 'wallet:gm', destination: 'wallet:ust' },
      { id: 'deposit', timestamp: '2026-08-26T00:00:00Z', flow: 'css-deposit', asset: 'Ammo', rawMint: 'ammo', quantity: 50, origin: 'wallet:ust', destination: 'UST-1', faction: 'USTUR' },
    ],
  };
  const unresolved = projectGmFactionMarketplaceRows(input);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].basisAvailable, false);
  const rows = projectGmFactionMarketplaceRows({ ...input, inventoryBasisObservations: [
    { timestamp: '2026-08-26T12:00:00Z', faction: 'USTUR', starbase: 'UST-1', asset: 'Ammo', knownQuantity: 100, knownInventoryValueAtlas: 20 },
  ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].basisAvailable, true);
  assert.equal(rows[0].unitPriceAtlas, 0.2);
  assert.equal(rows[0].grossAtlas, 10);
});

test('GM deposits blend known wallet basis with observed starbase basis for an inventory shortfall', () => {
  const rows = projectGmFactionMarketplaceRows({
    walletUniverse: buildGmWalletUniverse({ gmTradingWallets: ['gm'], profileWalletsByFaction: { MUD: ['mud'] } }),
    trades: [{ id: 'buy', timestamp: '2026-08-24T00:00:00Z', marketplace: 'GM', side: 'buy', wallet: 'gm', asset: 'Fuel', quantity: 25, settledAtlas: 5 }],
    flows: [
      { id: 'move', timestamp: '2026-08-25T00:00:00Z', flow: 'wallet-transfer', asset: 'Fuel', quantity: 50, origin: 'wallet:gm', destination: 'wallet:mud' },
      { id: 'deposit', timestamp: '2026-08-26T00:00:00Z', flow: 'css-deposit', asset: 'Fuel', quantity: 50, origin: 'wallet:mud', destination: 'MUD-1', faction: 'MUD' },
    ],
    inventoryBasisObservations: [
      { timestamp: '2026-08-26T12:00:00Z', faction: 'MUD', starbase: 'MUD-1', asset: 'Fuel', knownQuantity: 100, knownInventoryValueAtlas: 40 },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unitPriceAtlas, 0.3);
  assert.equal(rows[0].grossAtlas, 15);
});

test('GM basis follows a priced upstream wallet purchase through the configured GM wallet into CSS', () => {
  const walletUniverse = buildGmWalletUniverse({
    gmTradingWallets: ['upstream', 'gm'], profileWalletsByFaction: { ONI: ['gm'] },
  });
  const rows = projectGmFactionMarketplaceRows({
    walletUniverse,
    trades: [{
      id: 'buy', timestamp: '2026-08-24T00:00:00Z', marketplace: 'GM', side: 'buy',
      wallet: 'upstream', asset: 'Fuel', rawMint: 'fuel', quantity: 100, settledAtlas: 25,
    }],
    flows: [
      { id: 'upstream-hop', timestamp: '2026-08-24T01:00:00Z', flow: 'wallet-transfer', asset: 'Fuel', rawMint: 'fuel', quantity: 100, origin: 'wallet:upstream', destination: 'wallet:gm' },
      { id: 'deposit', timestamp: '2026-08-24T02:00:00Z', flow: 'css-deposit', asset: 'Fuel', rawMint: 'fuel', quantity: 100, origin: 'wallet:gm', destination: 'ONI-1', faction: 'ONI' },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].basisAvailable, true);
  assert.equal(rows[0].unitPriceAtlas, 0.25);
});

test('GM sells consume faction withdrawal lots on fill but retain the withdrawal timestamp', () => {
  const universe = buildGmWalletUniverse({ gmTradingWallets: ['gm'], profileWalletsByFaction: { MUD: ['mud'] } });
  const rows = projectGmFactionMarketplaceRows({
    walletUniverse: universe,
    trades: [{ id: 'fill', signature: 'fill-sig', orderId: 'order', timestamp: '2026-08-27T00:00:00Z', marketplace: 'GM', side: 'sell', wallet: 'gm', asset: 'Iron Ore', rawMint: 'iron', quantity: 40, unitPriceAtlas: 3, grossAtlas: 120, marketplaceFeeAtlas: 6, netAtlas: 114 }],
    flows: [
      { id: 'withdraw', signature: 'withdraw-sig', timestamp: '2026-08-25T00:00:00Z', flow: 'css-withdraw', asset: 'Iron Ore', rawMint: 'iron', quantity: 100, origin: 'MUD-1', destination: 'wallet:mud', faction: 'MUD', starbase: 'MUD-1' },
      { id: 'move', signature: 'move-sig', timestamp: '2026-08-25T01:00:00Z', flow: 'wallet-transfer', asset: 'Iron Ore', rawMint: 'iron', quantity: 100, origin: 'wallet:mud', destination: 'wallet:gm' },
    ],
  });
  assert.deepEqual(rows.map((row) => ({ side: row.side, faction: row.faction, timestamp: row.timestamp, quantity: row.quantity, unitPriceAtlas: row.unitPriceAtlas, netAtlas: row.netAtlas })), [
    { side: 'sell', faction: 'MUD', timestamp: '2026-08-25T00:00:00Z', quantity: 40, unitPriceAtlas: 3, netAtlas: 114 },
  ]);
  assert.match(formatGmFactionMarketplaceTestLine(rows[0]), /^marketplace_reconciliation_test_v1,/);
});

test('GM sell fills cannot consume a faction withdrawal that arrives later', () => {
  const universe = buildGmWalletUniverse({ gmTradingWallets: ['gm'], profileWalletsByFaction: { MUD: ['mud'] } });
  const rows = projectGmFactionMarketplaceRows({
    walletUniverse: universe,
    trades: [{ id: 'old-fill', timestamp: '2026-08-24T00:00:00Z', marketplace: 'GM', side: 'sell', wallet: 'gm', asset: 'Fuel', rawMint: 'fuel', quantity: 10, unitPriceAtlas: 2 }],
    flows: [
      { id: 'future-withdraw', timestamp: '2026-08-25T00:00:00Z', flow: 'css-withdraw', asset: 'Fuel', rawMint: 'fuel', quantity: 10, origin: 'MUD-1', destination: 'wallet:mud', faction: 'MUD' },
      { id: 'future-move', timestamp: '2026-08-25T01:00:00Z', flow: 'wallet-transfer', asset: 'Fuel', rawMint: 'fuel', quantity: 10, origin: 'wallet:mud', destination: 'wallet:gm' },
    ],
  });
  assert.deepEqual(rows, []);
});
