const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseInfluxCsv,
  isCargoCycleId,
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

test('parseInfluxCsv realigns aggregate query tables whose headers omit _field', () => {
  const csv = [
    '#group,false,false,true,true,false,false',
    ',result,table,fleet,assignment,_time,_value',
    ',,0,Fleet Alpha,Transport,2026-07-24T00:00:00Z,25',
    '#group,false,false,true,true,true,false,false',
    ',result,table,cycleId,fleet,assignment,_time,_value',
    ',,1,"fleet-key;0,0;1750000000000",Fleet Beta,Supply Chain,2026-07-24T01:00:00Z,10',
  ].join('\n');

  assert.deepEqual(parseInfluxCsv(csv), [
    { '': '', result: '', table: '0', fleet: 'Fleet Alpha', assignment: 'Transport', _time: '2026-07-24T00:00:00Z', _value: '25' },
    { '': '', result: '', table: '1', cycleId: 'fleet-key;0,0;1750000000000', fleet: 'Fleet Beta', assignment: 'Supply Chain', _time: '2026-07-24T01:00:00Z', _value: '10' },
  ]);
});

test('isCargoCycleId distinguishes telemetry cycle IDs from fleet labels', () => {
  assert.equal(isCargoCycleId('fleet-key;0,0;1750000000000'), true);
  assert.equal(isCargoCycleId('fleet-key;-12,34;1750000000000'), true);
  assert.equal(isCargoCycleId('Fleet Alpha'), false);
  assert.equal(isCargoCycleId(''), false);
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
