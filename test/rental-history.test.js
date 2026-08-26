'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRentalHistoryFluxQuery,
  projectRentalHistoryRows,
  createRentalHistoryIndex,
  resolveHistoricalRental,
} = require('../electron/rental-history');

test('query reads only the canonical daily rental measurement without writing', () => {
  const query = buildRentalHistoryFluxQuery('slya"bucket');
  assert.match(query, /from\(bucket: "slya\\"bucket"\)/);
  assert.match(query, /r\._measurement == "fleet_rental_daily_v1"/);
  assert.match(query, /pivot\(rowKey: \["_time", "fleetAccount", "contractId", "rentalId"\]/);
  assert.doesNotMatch(query, /api\/v2\/write|to\(/);
});

test('rows are normalized to authoritative fleet account and UTC date', () => {
  const records = projectRentalHistoryRows([{
    _time: '2026-08-25T00:00:00.000Z', fleetAccount: ' fleet-a ', contractId: 'contract', rentalId: 'rental',
    rentalCostAtlas: '12.5', dailyRateAtlas: '25', fleetLabel: 'BARBARI', faction: 'UST', programGeneration: 'current',
  }]);
  assert.deepEqual(records, [{
    fleetAccount: 'fleet-a', contractId: 'contract', rentalId: 'rental', isoDate: '2026-08-25',
    rentalCostAtlas: 12.5, dailyRateAtlas: 25, fleetLabel: 'BARBARI', faction: 'USTUR', programGeneration: 'current',
  }]);
});

test('exact fleet-account and date lookup wins over label fallback', () => {
  const records = projectRentalHistoryRows([
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet-a', contractId: 'ca', rentalId: 'ra', rentalCostAtlas: 10, fleetLabel: 'Same', faction: 'MUD' },
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet-b', contractId: 'cb', rentalId: 'rb', rentalCostAtlas: 20, fleetLabel: 'Same', faction: 'MUD' },
  ]);
  const index = createRentalHistoryIndex(records);
  assert.equal(resolveHistoricalRental(index, { fleetAccount: 'fleet-a', fleetLabel: 'Same', faction: 'MUD', isoDate: '2026-08-25' }).rentalCostAtlas, 10);
  assert.equal(resolveHistoricalRental(index, { fleetAccount: 'missing', fleetLabel: 'Same', faction: 'MUD', isoDate: '2026-08-25' }), null);
  assert.equal(resolveHistoricalRental(index, { fleetLabel: 'Same', faction: 'MUD', isoDate: '2026-08-25' }), null);
});

test('unambiguous faction-label fallback recovers an ended fleet absent from current My Fleets', () => {
  const index = createRentalHistoryIndex(projectRentalHistoryRows([{
    _time: '2026-08-25T00:00:00Z', fleetAccount: 'barbari-account', contractId: 'contract', rentalId: 'rental',
    rentalCostAtlas: 8, fleetLabel: 'BARBARI', faction: 'USTUR', programGeneration: 'legacy',
  }]));
  assert.deepEqual(resolveHistoricalRental(index, { fleetLabel: 'barbari', faction: 'UST', isoDate: '2026-08-25' }), {
    fleetAccount: 'barbari-account', rentalCostAtlas: 8, rentalContract: 'contract', rentalIds: ['rental'], programGenerations: ['legacy'],
  });
  assert.equal(resolveHistoricalRental(index, { fleetLabel: 'barbari', faction: 'MUD', isoDate: '2026-08-25' }), null);
});

test('multiple rental intervals on one fleet/day are summed once by distinct rental identity', () => {
  const index = createRentalHistoryIndex(projectRentalHistoryRows([
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet', contractId: 'contract', rentalId: 'r1', rentalCostAtlas: 3, fleetLabel: 'Fleet', faction: 'ONI' },
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet', contractId: 'contract', rentalId: 'r2', rentalCostAtlas: 4, fleetLabel: 'Fleet', faction: 'ONI' },
  ]));
  const rental = resolveHistoricalRental(index, { fleetAccount: 'fleet', isoDate: '2026-08-25' });
  assert.equal(rental.rentalCostAtlas, 7);
  assert.equal(rental.rentalContract, null);
});

test('invalid and non-finite rows fail closed', () => {
  assert.deepEqual(projectRentalHistoryRows([
    { _time: 'bad', fleetAccount: 'fleet', contractId: 'c', rentalId: 'r', rentalCostAtlas: 1 },
    { _time: '2026-08-25T00:00:00Z', fleetAccount: '', contractId: 'c', rentalId: 'r', rentalCostAtlas: 1 },
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet', contractId: 'c', rentalId: 'r', rentalCostAtlas: -1 },
  ]), []);
});
