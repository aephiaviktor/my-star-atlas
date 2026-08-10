const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseInfluxCsv,
  isCargoCycleId,
  groupCargoAllocationRows,
  enrichCargoAllocationRows,
  dedupeCargoAllocationFieldRows,
  buildCargoAllocationRecords,
  buildCargoAllocationRecordsFromPivotRows,
} = require('../electron/influx-data');

test('cargo allocation field rows deduplicate repeated cycle allocations', () => {
  const duplicate = { cycleId: 'fleet;0,0;1', allocationIndex: '0', _field: 'cargoVolume', _value: '500' };
  const rows = [
    duplicate,
    { ...duplicate },
    { ...duplicate, allocationIndex: '1', _value: '300' },
    { _field: 'cargoVolume', _value: '200' },
    { _field: 'cargoVolume', _value: '200' },
  ];

  assert.deepEqual(dedupeCargoAllocationFieldRows(rows), [
    duplicate,
    { ...duplicate, allocationIndex: '1', _value: '300' },
    { _field: 'cargoVolume', _value: '200' },
    { _field: 'cargoVolume', _value: '200' },
  ]);
});

test('pivoted Cargo allocations preserve exact identity and reject incomplete records', () => {
  const base = {
    _time: '2026-08-10T00:17:45.499845471Z',
    cycleId: 'DDdAJk2KZZtJNVa7J1qdRzMW4tgfvJLrjMhU5Ct12uwy:35,16:1786320383633',
    allocationIndex: '0', fleet: 'CF-22|01b', rss: 'Food', assignment: 'Transport',
    originStarbase: 'MRZ-22', deliveryStarbase: 'UST-PHANTOM',
    amount: '100', cargoVolume: '200', allocatedFuel: '3.5', allocatedTxCostSol: '0.00001',
  };
  const rows = buildCargoAllocationRecordsFromPivotRows([base, { ...base }, { ...base, allocationIndex: '1', cargoVolume: '' }]);
  assert.equal(rows.length, 1);
  assert.deepEqual({
    fleetAccount: rows[0].fleetAccount, cycleId: rows[0].cycleId, allocationIndex: rows[0].allocationIndex,
    amount: rows[0].amount, cargoVolume: rows[0].cargoVolume, allocatedFuel: rows[0].allocatedFuel,
    allocatedTxCostSol: rows[0].allocatedTxCostSol, asset: rows[0].asset, origin: rows[0].origin, destination: rows[0].destination,
  }, {
    fleetAccount: 'DDdAJk2KZZtJNVa7J1qdRzMW4tgfvJLrjMhU5Ct12uwy', cycleId: base.cycleId, allocationIndex: '0',
    amount: 100, cargoVolume: 200, allocatedFuel: 3.5, allocatedTxCostSol: 0.00001,
    asset: 'Food', origin: 'MRZ-22', destination: 'UST-PHANTOM',
  });
});

test('pivoted and four-field inputs produce identical Allocation rows and totals', () => {
  const base = {
    _time: '2026-08-10T01:00:00.000Z', cycleId: '11111111111111111111111111111111:1,2:1786320000000',
    allocationIndex: '7', fleet: 'Fleet', rss: 'Food', assignment: 'Transport', originStarbase: 'MRZ-1', deliveryStarbase: 'MRZ-2',
  };
  const values = { amount: 12, cargoVolume: 24, allocatedFuel: 3.5, allocatedTxCostSol: 0.0002 };
  const fieldRows = Object.entries(values).map(([_field, _value]) => ({ ...base, _field, _value }));
  const legacy = buildCargoAllocationRecords(fieldRows);
  const pivoted = buildCargoAllocationRecordsFromPivotRows([{ ...base, ...values }]);
  assert.equal(legacy.length, 1);
  assert.equal(pivoted.length, 1);
  for (const key of ['isoDate', 'fleet', 'fleetAccount', 'asset', 'origin', 'destination', 'assignment', 'cycleId', 'amount', 'cargoVolume', 'allocatedFuel', 'allocatedTxCostSol']) {
    assert.equal(pivoted[0][key], legacy[0][key], key);
  }
});

test('production-sized pivot reduces 262004 field records to 65501 complete allocations', () => {
  const rows = Array.from({ length: 65501 }, (_, index) => ({
    _time: '2026-08-10T00:00:00.000Z',
    cycleId: `11111111111111111111111111111111:0,0:${1786320000000 + index}`,
    allocationIndex: '0', fleet: 'Fleet', rss: 'Food', assignment: 'Transport',
    amount: '1', cargoVolume: '2', allocatedFuel: '3', allocatedTxCostSol: '0.000001',
  }));
  assert.equal(rows.length * 4, 262004);
  assert.equal(buildCargoAllocationRecordsFromPivotRows(rows).length, 65501);
});

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
    { isoDate: '2026-07-22', label: '22 Jul', fleet: 'Fleet Alpha', asset: 'Food', origin: 'MRZ-1', destination: 'MRZ-2', assignment: 'Transport', amount: 4, cargoVolume: 8, allocatedFuel: 2, allocatedFuelExact: '2.125', allocatedTxCostSol: 0.01, allocatedTxFeeLamports: '1001' },
    { isoDate: '2026-07-22', label: '22 Jul', fleet: 'Fleet Alpha', asset: 'Food', origin: 'MRZ-1', destination: 'MRZ-2', assignment: 'Transport', amount: 6, cargoVolume: 12, allocatedFuel: 3, allocatedFuelExact: '3.375', allocatedTxCostSol: 0.02, allocatedTxFeeLamports: '2002' },
  ];

  assert.deepEqual(groupCargoAllocationRows(rows), [{
    isoDate: '2026-07-22', label: '22 Jul', fleet: 'Fleet Alpha', asset: 'Food', origin: 'MRZ-1', destination: 'MRZ-2', assignment: 'Transport',
    amount: 10, cargoVolume: 20, allocatedFuel: 5, allocatedFuelExact: '5.5', allocatedTxCostSol: 0.03, allocatedTxFeeLamports: '3003',
  }]);
});
