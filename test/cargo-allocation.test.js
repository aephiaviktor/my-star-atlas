const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseInfluxCsv,
  groupCargoAllocationRows,
  enrichCargoAllocationRows,
} = require('../electron/influx-data');

test('parseInfluxCsv realigns rows when Flux emits a new table header', () => {
  const csv = [
    '#group,false,false,true,true,false,false',
    ',result,table,fleet,rss,originStarbase,_field,_value',
    ',,0,Fleet Alpha,Hydrogen,MRZ-1,amount,25',
    '#group,false,false,true,true,false,false,false',
    ',result,table,originStarbase,fleet,rss,deliveryStarbase,_field,_value',
    ',,1,MRZ-2,Fleet Beta,Food,MRZ-9,amount,10',
  ].join('\n');

  assert.deepEqual(parseInfluxCsv(csv), [
    { '': '', result: '', table: '0', fleet: 'Fleet Alpha', rss: 'Hydrogen', originStarbase: 'MRZ-1', _field: 'amount', _value: '25' },
    { '': '', result: '', table: '1', originStarbase: 'MRZ-2', fleet: 'Fleet Beta', rss: 'Food', deliveryStarbase: 'MRZ-9', _field: 'amount', _value: '10' },
  ]);
});

test('groupCargoAllocationRows keeps fleet and route dimensions separate', () => {
  const rows = [
    { isoDate: '2026-07-22', label: '22 Jul', fleet: 'Fleet Alpha', asset: 'Food', origin: 'MRZ-1', destination: 'MRZ-2', assignment: 'Transport', amount: 4, cargoVolume: 8, allocatedFuel: 2, allocatedTxCostSol: 0.01 },
    { isoDate: '2026-07-22', label: '22 Jul', fleet: 'Fleet Beta', asset: 'Food', origin: 'MRZ-3', destination: 'MRZ-2', assignment: 'Transport', amount: 6, cargoVolume: 12, allocatedFuel: 3, allocatedTxCostSol: 0.02 },
  ];

  assert.deepEqual(groupCargoAllocationRows(rows), rows);
});

test('enrichCargoAllocationRows adds fleet metadata without changing allocation dimensions', () => {
  const rows = [{ isoDate: '2026-07-22', fleet: 'Fleet Alpha', asset: 'Food', origin: 'MRZ-1', destination: 'MRZ-2' }];
  const fleetByLabel = new Map([['fleet alpha', {
    key: 'fleet-key', ownership: 'Owned', relationship: 'owned', ships: [{ name: 'Pearce X4', amount: 2 }], shipTypes: 1, totalRequiredCrew: 16,
  }]]);

  assert.deepEqual(enrichCargoAllocationRows(rows, fleetByLabel, (value) => String(value).toLowerCase()), [{
    ...rows[0], fleetName: 'Fleet Alpha', fleetAccount: 'fleet-key', ownership: 'Owned', relationship: 'owned',
    ships: [{ name: 'Pearce X4', amount: 2 }], shipTypes: 1, totalRequiredCrew: 16,
  }]);
});

test('groupCargoAllocationRows sums duplicate field rows for the same fleet route and asset', () => {
  const rows = [
    { isoDate: '2026-07-22', label: '22 Jul', fleet: 'Fleet Alpha', asset: 'Food', origin: 'MRZ-1', destination: 'MRZ-2', assignment: 'Transport', amount: 4, cargoVolume: 8, allocatedFuel: 2, allocatedTxCostSol: 0.01 },
    { isoDate: '2026-07-22', label: '22 Jul', fleet: 'Fleet Alpha', asset: 'Food', origin: 'MRZ-1', destination: 'MRZ-2', assignment: 'Transport', amount: 6, cargoVolume: 12, allocatedFuel: 3, allocatedTxCostSol: 0.02 },
  ];

  assert.deepEqual(groupCargoAllocationRows(rows), [{
    isoDate: '2026-07-22', label: '22 Jul', fleet: 'Fleet Alpha', asset: 'Food', origin: 'MRZ-1', destination: 'MRZ-2', assignment: 'Transport',
    amount: 10, cargoVolume: 20, allocatedFuel: 5, allocatedTxCostSol: 0.03,
  }]);
});
