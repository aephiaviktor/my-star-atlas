const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildScanningAcquisitionEvents,
  buildMiningAcquisitionEvents,
  buildProductionLedger,
  buildCargoTransferEvents,
  buildCraftingEvents,
  buildCostLedgerResult,
} = require('../electron/production-ledger-events');

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
