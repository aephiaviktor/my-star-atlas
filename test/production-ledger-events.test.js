const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOpeningInventoryEvents,
  buildScanningAcquisitionEvents,
  buildMiningAcquisitionEvents,
  buildProductionLedger,
  buildCargoTransferEvents,
  buildCraftingEvents,
  buildUpgradingConsumptionEvents,
  buildCostLedgerResult,
  eventFingerprint,
} = require('../electron/production-ledger-events');

test('event fingerprints are deterministic across object key order', () => {
  const left = { type: 'acquire', timestamp: '2026-07-01T00:00:00.000Z', location: 'MUD-1', asset: 'Carbon', quantity: 2, source: 'mining', totalCost: 1 };
  const right = { totalCost: 1, source: 'mining', quantity: 2, asset: 'Carbon', location: 'MUD-1', timestamp: '2026-07-01T00:00:00.000Z', type: 'acquire' };
  assert.equal(eventFingerprint(left), eventFingerprint(right));
});

test('checkpoint fingerprints prevent overlapping events from being applied twice', () => {
  const first = buildCostLedgerResult({
    miningRows: [{ isoDate: '2026-07-01', starbase: 'MUD-1', rawMaterial: 'Carbon', mined: 5, totalCostsAtlas: 2 }],
  });
  const second = buildCostLedgerResult({
    initialLedger: first.ledger,
    seenEventFingerprints: first.seenEventFingerprints,
    miningRows: [
      { isoDate: '2026-07-01', starbase: 'MUD-1', rawMaterial: 'Carbon', mined: 5, totalCostsAtlas: 2 },
      { isoDate: '2026-07-02', starbase: 'MUD-1', rawMaterial: 'Carbon', mined: 3, totalCostsAtlas: 1.5 },
    ],
  });
  assert.equal(second.skippedDuplicateEvents.length, 1);
  assert.equal(second.ledger.get('MUD-1', 'Carbon').quantity, 8);
  assert.equal(second.ledger.get('MUD-1', 'Carbon').costs.mining, 3.5);
});

test('checkpointed consumption results remain available to historical earnings rows', () => {
  const first = buildCostLedgerResult({
    openingInventoryRows: [{ timestamp: '2026-06-30T23:59:59Z', starbase: 'UST-1', asset: 'Framework', quantity: 10 }],
    upgradingRows: [{ timestamp: '2026-07-01T12:00:00Z', starbase: 'UST-1', asset: 'Framework', installed: 2 }],
  });
  const second = buildCostLedgerResult({
    initialLedger: first.ledger,
    seenEventFingerprints: first.seenEventFingerprints,
    eventResultByFingerprint: first.eventResultByFingerprint,
    upgradingRows: [{ timestamp: '2026-07-01T12:00:00Z', starbase: 'UST-1', asset: 'Framework', installed: 2 }],
  });
  assert.equal(second.skippedDuplicateEvents.length, 1);
  assert.equal(second.appliedEventResults.length, 1);
  assert.equal(second.appliedEventResults[0].fromCheckpoint, true);
  assert.equal(second.appliedEventResults[0].result.uncostedQuantity, 2);
});

test('opening inventory becomes chronological explicitly uncosted acquisition events', () => {
  assert.deepEqual(buildOpeningInventoryEvents([
    { timestamp: '2026-06-25T23:55:00Z', starbase: 'MUD-1', asset: 'Carbon', quantity: 12 },
    { timestamp: 'invalid', starbase: 'MUD-1', asset: 'Food', quantity: 3 },
    { timestamp: '2026-06-25T23:55:00Z', starbase: '', asset: 'Fuel', quantity: 4 },
  ]), [{
    type: 'acquire', timestamp: '2026-06-25T23:55:00.000Z', location: 'MUD-1', asset: 'Carbon', quantity: 12,
  }]);
});

test('opening inventory prevents valid later consumption from overdrafting while preserving uncosted basis', () => {
  const result = buildCostLedgerResult({
    openingInventoryRows: [{ timestamp: '2026-06-25T23:55:00Z', starbase: 'UST-1', asset: 'Framework', quantity: 10 }],
    upgradingRows: [{ timestamp: '2026-06-26T12:30:00Z', starbase: 'UST-1', asset: 'Framework', installed: 4 }],
  });

  assert.equal(result.rejectedEvents.length, 0);
  assert.equal(result.ledger.get('UST-1', 'Framework').quantity, 6);
  assert.equal(result.ledger.get('UST-1', 'Framework').uncostedQuantity, 6);
  const consumed = result.appliedEventResults.find(({ event }) => event.purpose === 'upgrading').result;
  assert.equal(consumed.quantity, 4);
  assert.equal(consumed.uncostedQuantity, 4);
});

test('opening inventory is applied before later events even when supplied after production inputs', () => {
  const result = buildCostLedgerResult({
    openingInventoryRows: [{ timestamp: '2026-06-25T23:55:00Z', starbase: 'ONI-1', asset: 'Carbon', quantity: 5 }],
    miningRows: [{ isoDate: '2026-06-26', starbase: 'ONI-1', rawMaterial: 'Carbon', mined: 5, totalCostsAtlas: 2 }],
  });
  const row = result.ledger.get('ONI-1', 'Carbon');
  assert.equal(row.quantity, 10);
  assert.equal(row.uncostedQuantity, 5);
  assert.equal(row.costs.mining, 2);
});

test('legacy Ammo opening inventory protects later Ammunition basis by consuming uncosted quantity first', () => {
  const result = buildCostLedgerResult({
    openingInventoryRows: [{ timestamp: '2026-08-01T00:00:00Z', starbase: 'MUD-1', asset: 'Ammo', quantity: 3249852 }],
    assetFlowEvents: [
      { type: 'acquire-lot', timestamp: '2026-09-01T18:35:43Z', location: 'MUD-1', asset: 'Ammunition',
        quantity: 5000000, uncostedQuantity: 0, costs: { gm: 5011.45 }, cargoCost: 0 },
      { type: 'consume', timestamp: '2026-09-02T00:00:00Z', location: 'MUD-1', asset: 'Ammunition', quantity: 4013556 },
    ],
  });
  const ammunition = result.ledger.get('MUD-1', 'Ammunition');
  assert.equal(ammunition.quantity, 4236296);
  assert.equal(ammunition.uncostedQuantity, 0);
  assert.equal(ammunition.quantity - ammunition.uncostedQuantity, 4236296);
  assert.ok(Math.abs(ammunition.costs.gm / ammunition.quantity - 0.00100229) < 1e-12);
  assert.equal(result.ledger.get('MUD-1', 'Ammo').quantity, 0);
});

test('scanning acquisitions are split across deposit starbases without duplicating daily costs', () => {
  const events = buildScanningAcquisitionEvents([{
    isoDate: '2026-07-25',
    fleetName: 'Scanner 1',
    sduFound: 100,
    totalCostsAtlas: 50,
    productionByStarbase: [
      { starbase: 'MUD-1', quantity: 75 },
      { starbase: 'MUD-2', quantity: 25 },
    ],
  }]);

  assert.deepEqual(events, [
    { type: 'acquire', timestamp: '2026-07-25T00:00:00.000Z', location: 'MUD-1', asset: 'Survey Data Unit', quantity: 75, source: 'scanning', totalCost: 37.5 },
    { type: 'acquire', timestamp: '2026-07-25T00:00:00.000Z', location: 'MUD-2', asset: 'Survey Data Unit', quantity: 25, source: 'scanning', totalCost: 12.5 },
  ]);
});

test('mining acquisitions enter their recorded starbase with Mining cost basis', () => {
  const events = buildMiningAcquisitionEvents([{
    isoDate: '2026-07-24', starbase: 'ONI-3', rawMaterial: 'Carbon', mined: 20, totalCostsAtlas: 8,
  }]);
  assert.deepEqual(events, [{
    type: 'acquire', timestamp: '2026-07-24T00:00:00.000Z', location: 'ONI-3', asset: 'Carbon', quantity: 20, source: 'mining', totalCost: 8,
  }]);
});

test('production with unavailable cost remains explicit uncosted inventory', () => {
  const ledger = buildProductionLedger({
    scanningRows: [{ isoDate: '2026-07-25', sduFound: 10, totalCostsAtlas: null, productionByStarbase: [{ starbase: 'UST-1', quantity: 10 }] }],
    miningRows: [{ isoDate: '2026-07-25', starbase: 'UST-1', rawMaterial: 'Iron Ore', mined: 5, totalCostsAtlas: null }],
  });
  assert.equal(ledger.get('UST-1', 'Survey Data Unit').uncostedQuantity, 10);
  assert.equal(ledger.get('UST-1', 'Iron Ore').uncostedQuantity, 5);
});

test('rows without a reliable production starbase are omitted rather than assigned to an invented location', () => {
  assert.deepEqual(buildScanningAcquisitionEvents([{ isoDate: '2026-07-25', sduFound: 10, totalCostsAtlas: 2 }]), []);
  assert.deepEqual(buildMiningAcquisitionEvents([{ isoDate: '2026-07-25', rawMaterial: 'Iron Ore', mined: 5, totalCostsAtlas: 1 }]), []);
});

test('cargo transfers preserve weighted source basis and add cargo costs only at the destination', () => {
  const result = buildCostLedgerResult({
    miningRows: [{ isoDate: '2026-07-24', starbase: 'MUD-1', rawMaterial: 'Carbon', mined: 100, totalCostsAtlas: 20 }],
    cargoRows: [
      { timestamp: '2026-07-24T12:00:00Z', origin: 'MUD-1', destination: 'MUD-2', asset: 'Carbon', amount: 40, totalCostsAtlas: 4 },
      { timestamp: '2026-07-24T13:00:00Z', origin: 'MUD-1', destination: 'MUD-2', asset: 'Carbon', amount: 10, totalCostsAtlas: 1 },
    ],
  });

  assert.equal(result.rejectedEvents.length, 0);
  assert.equal(result.ledger.get('MUD-1', 'Carbon').quantity, 50);
  assert.equal(result.ledger.get('MUD-2', 'Carbon').quantity, 50);
  assert.equal(result.ledger.get('MUD-2', 'Carbon').costs.mining, 10);
  assert.equal(result.ledger.get('MUD-2', 'Carbon').cargoCost, 5);
});

test('cargo events use telemetry timestamps and reject incomplete routes or costs', () => {
  assert.deepEqual(buildCargoTransferEvents([
    { timestamp: '2026-07-25T10:15:00Z', origin: 'ONI-1', destination: 'ONI-2', asset: 'Food', amount: 5, totalCostsAtlas: 2 },
    { isoDate: '2026-07-25', origin: '--', destination: 'ONI-2', asset: 'Food', amount: 5, totalCostsAtlas: 2 },
    { isoDate: '2026-07-25', origin: 'ONI-1', destination: 'ONI-2', asset: 'Food', amount: 5, totalCostsAtlas: null },
  ]), [{
    type: 'transfer', timestamp: '2026-07-25T10:15:00.000Z', origin: 'ONI-1', destination: 'ONI-2', asset: 'Food', quantity: 5, cargoCost: 2,
  }]);
});

test('crafting events carry ingredient basis and add only direct conversion costs', () => {
  const result = buildCostLedgerResult({
    miningRows: [{ isoDate: '2026-07-24', starbase: 'UST-1', rawMaterial: 'Carbon', mined: 10, totalCostsAtlas: 5 }],
    craftingRows: [{ isoDate: '2026-07-25', starbase: 'UST-1', output: 'Framework', crafted: 2, ingredients: [{ input: 'Carbon', amount: 10 }], feeCostsAtlas: 1, txsCostsAtlas: 2 }],
  });
  assert.equal(result.rejectedEvents.length, 0);
  const output = result.ledger.get('UST-1', 'Framework');
  assert.equal(output.quantity, 2);
  assert.equal(output.costs.mining, 5);
  assert.equal(output.costs.crafting, 3);
});

test('crafting adapter rejects incomplete telemetry rather than inventing ingredients or cost', () => {
  assert.deepEqual(buildCraftingEvents([
    { isoDate: '2026-07-25', starbase: 'UST-1', output: 'Framework', crafted: 2, ingredients: [], feeCostsAtlas: 1, txsCostsAtlas: 2 },
    { isoDate: '2026-07-25', starbase: 'UST-1', output: 'Framework', crafted: 2, ingredients: [{ input: 'Carbon', amount: 10 }], feeCostsAtlas: 1, txsCostsAtlas: null },
  ]), []);
});

test('upgrading consumes installed components at their local weighted cost basis', () => {
  const result = buildCostLedgerResult({
    miningRows: [{ isoDate: '2026-07-24', starbase: 'UST-1', rawMaterial: 'Framework', mined: 10, totalCostsAtlas: 5 }],
    upgradingRows: [{ timestamp: '2026-07-24T12:30:00Z', starbase: 'UST-1', asset: 'Framework', installed: 4 }],
  });

  assert.equal(result.rejectedEvents.length, 0);
  assert.deepEqual(buildUpgradingConsumptionEvents([
    { timestamp: '2026-07-24T12:30:00Z', starbase: 'UST-1', asset: 'Framework', installed: 4 },
  ]), [{ type: 'consume', timestamp: '2026-07-24T12:30:00.000Z', location: 'UST-1', asset: 'Framework', quantity: 4, purpose: 'upgrading' }]);
  assert.equal(result.ledger.get('UST-1', 'Framework').quantity, 6);
  assert.equal(result.ledger.get('UST-1', 'Framework').costs.mining, 3);
  const appliedUpgrade = result.appliedEventResults.find(({ event }) => event.purpose === 'upgrading');
  assert.equal(appliedUpgrade.result.quantity, 4);
  assert.equal(appliedUpgrade.result.costs.mining, 2);
  assert.equal(appliedUpgrade.result.cargoCost, 0);
});

test('upgrading rejects incomplete component telemetry and overdrafts without mutating inventory', () => {
  assert.deepEqual(buildUpgradingConsumptionEvents([
    { timestamp: 'invalid', starbase: 'UST-1', asset: 'Framework', installed: 1 },
    { timestamp: '2026-07-24T12:30:00Z', starbase: '', asset: 'Framework', installed: 1 },
    { timestamp: '2026-07-24T12:30:00Z', starbase: 'UST-1', asset: 'Framework', installed: 0 },
  ]), []);
  const result = buildCostLedgerResult({
    miningRows: [{ isoDate: '2026-07-24', starbase: 'UST-1', rawMaterial: 'Framework', mined: 2, totalCostsAtlas: 1 }],
    upgradingRows: [{ timestamp: '2026-07-24T12:30:00Z', starbase: 'UST-1', asset: 'Framework', installed: 3 }],
  });
  assert.equal(result.rejectedEvents.length, 1);
  assert.match(result.rejectedEvents[0].error, /insufficient inventory/);
  assert.equal(result.ledger.get('UST-1', 'Framework').quantity, 2);
});

test('an overdraft cargo event fails closed without corrupting earlier ledger state', () => {
  const result = buildCostLedgerResult({
    miningRows: [{ isoDate: '2026-07-24', starbase: 'UST-1', rawMaterial: 'Iron Ore', mined: 5, totalCostsAtlas: 1 }],
    cargoRows: [{ timestamp: '2026-07-24T12:00:00Z', origin: 'UST-1', destination: 'UST-2', asset: 'Iron Ore', amount: 8, totalCostsAtlas: 2 }],
  });
  assert.equal(result.rejectedEvents.length, 1);
  assert.match(result.rejectedEvents[0].error, /insufficient inventory/);
  assert.equal(result.ledger.get('UST-1', 'Iron Ore').quantity, 5);
  assert.equal(result.ledger.get('UST-2', 'Iron Ore').quantity, 0);
});

test('chronological ledger emits deterministic basis snapshots after starbase pool changes only', () => {
  const result = buildCostLedgerResult({
    inventoryBasisFaction: 'UST',
    miningRows: [{ isoDate: '2026-07-24', starbase: 'UST-1', rawMaterial: 'Iron Ore', mined: 10, totalCostsAtlas: 5 }],
    assetFlowEvents: [
      { type: 'transfer', timestamp: '2026-07-24T01:00:00Z', origin: 'UST-1', destination: 'wallet:handler', asset: 'Iron Ore', quantity: 4, cargoCost: 1 },
    ],
  });
  assert.equal(result.inventoryBasisSnapshots.length, 2);
  assert.deepEqual(result.inventoryBasisSnapshots.map(({ faction, starbase, asset, quantity, knownInventoryValueAtlas }) => ({ faction, starbase, asset, quantity, knownInventoryValueAtlas })), [
    { faction: 'USTUR', starbase: 'UST-1', asset: 'Iron Ore', quantity: 10, knownInventoryValueAtlas: 5 },
    { faction: 'USTUR', starbase: 'UST-1', asset: 'Iron Ore', quantity: 6, knownInventoryValueAtlas: 3 },
  ]);
  assert.ok(result.inventoryBasisSnapshots.every(({ snapshotId }) => /^[a-f0-9]{64}$/.test(snapshotId)));
});

test('GM sell consumption basis survives checkpoint replay for Earnings projection', () => {
  const input = {
    localMarketTrades: [
      { id: 'buy', marketplace: 'GM', timestamp: '2026-07-25T00:00:00Z', wallet: 'gm', asset: 'Food', side: 'buy', quantity: 10, settledAtlas: 50 },
      { id: 'sell', marketplace: 'GM', timestamp: '2026-07-25T01:00:00Z', wallet: 'gm', asset: 'Food', side: 'sell', quantity: 4, settledAtlas: 32 },
    ],
  };
  const first = buildCostLedgerResult(input);
  const replay = buildCostLedgerResult({
    ...input,
    initialLedger: first.ledger,
    eventFingerprintCounts: first.eventFingerprintCounts,
    eventResultsByFingerprint: first.eventResultsByFingerprint,
  });
  const sale = replay.appliedEventResults.find(({ event }) => event.tradeId === 'sell');
  assert.equal(sale.fromCheckpoint, true);
  assert.equal(sale.result.quantity, 4);
  assert.equal(sale.result.costs.gm, 20);
});

test('GM basis follows the buying wallet through handler custody into CSS', () => {
  const result = buildCostLedgerResult({
    localMarketTrades: [{
      id: 'gm-buy', marketplace: 'GM', timestamp: '2026-07-25T00:00:00Z', wallet: 'gm-wallet',
      asset: 'Food', side: 'buy', quantity: 10, settledAtlas: 5,
    }],
    assetFlowEvents: [
      { type: 'transfer', timestamp: '2026-07-25T00:01:00Z', origin: 'wallet:gm-wallet', destination: 'wallet:handler', asset: 'Food', quantity: 10, cargoCost: 0.01 },
      { type: 'transfer', timestamp: '2026-07-25T00:02:00Z', origin: 'wallet:handler', destination: 'UST-1', asset: 'Food', quantity: 10, cargoCost: 0.02 },
    ],
  });
  const css = result.ledger.get('UST-1', 'Food');
  assert.equal(css.quantity, 10);
  assert.equal(css.costs.gm, 5);
  assert.ok(Math.abs(css.cargoCost - 0.03) < 1e-12);
  assert.equal(result.rejectedEvents.length, 0);
});
