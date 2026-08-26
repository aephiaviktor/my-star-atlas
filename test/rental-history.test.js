'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRentalHistoryFluxQuery,
  projectRentalHistoryRows,
  createRentalHistoryIndex,
  resolveHistoricalRental,
  applyVerifiedFleetCrew,
} = require('../electron/rental-history');

test('query reads only the canonical daily rental measurement without writing', () => {
  const query = buildRentalHistoryFluxQuery('slya"bucket');
  assert.match(query, /from\(bucket: "slya\\"bucket"\)/);
  assert.match(query, /r\._measurement == "fleet_rental_daily_v1"/);
  assert.match(query, /pivot\(rowKey: \["_time", "fleetAccount", "contractId", "rentalId"\]/);
  assert.match(query, /"requiredCrew", "crewCount", "crewSnapshotSource"/);
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
    requiredCrew: null, crewCount: null, crewSnapshotSource: '',
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
    requiredCrew: null, crewCount: null, crewSnapshotSource: '',
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

test('authoritative observed crew facts are preserved only when consistent', () => {
  const consistent = createRentalHistoryIndex(projectRentalHistoryRows([
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet', contractId: 'contract', rentalId: 'r1', rentalCostAtlas: 3, requiredCrew: '42', crewCount: '42', crewSnapshotSource: 'fleet_account_observed' },
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet', contractId: 'contract', rentalId: 'r2', rentalCostAtlas: 4, requiredCrew: '42', crewCount: '42', crewSnapshotSource: 'fleet_account_observed' },
  ]));
  assert.deepEqual(resolveHistoricalRental(consistent, { fleetAccount: 'fleet', isoDate: '2026-08-25' }), {
    fleetAccount: 'fleet', rentalCostAtlas: 7, rentalContract: null, rentalIds: ['r1', 'r2'], programGenerations: [],
    requiredCrew: 42, crewCount: 42, crewSnapshotSource: 'fleet_account_observed',
  });

  const historicalComposition = createRentalHistoryIndex(projectRentalHistoryRows([
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet', contractId: 'contract', rentalId: 'r1', rentalCostAtlas: 3, requiredCrew: 43, crewSnapshotSource: 'fleet_composition_historical_verified' },
  ]));
  assert.deepEqual(resolveHistoricalRental(historicalComposition, { fleetAccount: 'fleet', isoDate: '2026-08-25' }), {
    fleetAccount: 'fleet', rentalCostAtlas: 3, rentalContract: 'contract', rentalIds: ['r1'], programGenerations: [],
    requiredCrew: 43, crewCount: null, crewSnapshotSource: 'fleet_composition_historical_verified',
  });

  const conflicting = createRentalHistoryIndex(projectRentalHistoryRows([
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet', contractId: 'contract', rentalId: 'r1', rentalCostAtlas: 3, requiredCrew: 42, crewCount: 42, crewSnapshotSource: 'fleet_account_observed' },
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet', contractId: 'contract', rentalId: 'r2', rentalCostAtlas: 4, requiredCrew: 43, crewCount: 43, crewSnapshotSource: 'fleet_account_observed' },
  ]));
  const result = resolveHistoricalRental(conflicting, { fleetAccount: 'fleet', isoDate: '2026-08-25' });
  assert.equal(result.requiredCrew, null);
  assert.equal(result.crewCount, null);
  assert.equal(result.crewSnapshotSource, '');
});

test('verified fleet composition fills missing crew facts for every record of that fleet only', () => {
  const records = projectRentalHistoryRows([
    { _time: '2026-08-24T00:00:00Z', fleetAccount: 'fleet-a', contractId: 'ca', rentalId: 'ra', rentalCostAtlas: 10, fleetLabel: 'A', faction: 'ONI' },
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet-a', contractId: 'ca', rentalId: 'ra', rentalCostAtlas: 5, fleetLabel: 'A', faction: 'ONI', requiredCrew: 43, crewSnapshotSource: 'fleet_account_observed' },
    { _time: '2026-08-24T00:00:00Z', fleetAccount: 'fleet-b', contractId: 'cb', rentalId: 'rb', rentalCostAtlas: 8, fleetLabel: 'B', faction: 'ONI' },
  ]);
  const recovered = applyVerifiedFleetCrew(records, new Map([['fleet-a', 51]]));

  assert.equal(recovered[0].requiredCrew, 51);
  assert.equal(recovered[0].crewSnapshotSource, 'fleet_composition_chain_verified');
  assert.equal(recovered[1].requiredCrew, 43);
  assert.equal(recovered[1].crewSnapshotSource, 'fleet_account_observed');
  assert.equal(recovered[2].requiredCrew, null);
});

test('invalid and non-finite rows fail closed', () => {
  assert.deepEqual(projectRentalHistoryRows([
    { _time: 'bad', fleetAccount: 'fleet', contractId: 'c', rentalId: 'r', rentalCostAtlas: 1 },
    { _time: '2026-08-25T00:00:00Z', fleetAccount: '', contractId: 'c', rentalId: 'r', rentalCostAtlas: 1 },
    { _time: '2026-08-25T00:00:00Z', fleetAccount: 'fleet', contractId: 'c', rentalId: 'r', rentalCostAtlas: -1 },
  ]), []);
});
