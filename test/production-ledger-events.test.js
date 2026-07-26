const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildScanningAcquisitionEvents,
  buildMiningAcquisitionEvents,
  buildProductionLedger,
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
