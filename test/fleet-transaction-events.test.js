'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  aggregateFleetTransactionEvents,
  applyFleetTransactionTotals,
  recoverFleetTransactionAssignments,
  unambiguousFleetDayKeys,
} = require('../electron/fleet-transaction-events');

function fee(overrides = {}) {
  return {
    eventType: 'sol_fee',
    timestamp: '2026-09-13T08:00:00.000Z',
    faction: 'MUD',
    instance: 'MUD',
    fleetAccount: 'fleet-a',
    fleetLabel: 'MINER-A',
    assignment: 'Mine',
    txFeeLamports: '5001',
    transactionSignature: 'sig-a',
    ...overrides,
  };
}

test('blank historical assignments recover only from unambiguous fleet-day telemetry evidence', () => {
  const records = [
    fee({ assignment: '', transactionSignature: 'recover-me' }),
    fee({ assignment: '', fleetAccount: 'fleet-b', transactionSignature: 'ambiguous' }),
    fee({ assignment: '', fleetAccount: 'fleet-c', transactionSignature: 'unknown' }),
    fee({ assignment: 'Mine', transactionSignature: 'already-canonical' }),
  ];
  const recovered = recoverFleetTransactionAssignments(records, [
    { isoDate: '2026-09-13', fleetAccount: 'fleet-a', assignment: 'Scan' },
    { isoDate: '2026-09-13', fleetAccount: 'fleet-a', assignment: 'Scan' },
    { isoDate: '2026-09-13', fleetAccount: 'fleet-b', assignment: 'Mine' },
    { isoDate: '2026-09-13', fleetAccount: 'fleet-b', assignment: 'Scan' },
    { isoDate: '2026-09-13', fleetAccount: 'fleet-c', assignment: 'Craft' },
  ]);

  assert.equal(recovered[0].assignment, 'Scan');
  assert.equal(recovered[0].assignmentProvenance, 'telemetry_fleet_day');
  const [total] = aggregateFleetTransactionEvents(recovered, { assignments: ['Scan'], faction: 'MUD', instance: 'MUD' });
  assert.equal(total.txsDaily, 1);
  assert.equal(total.assignmentProvenance, 'telemetry_fleet_day');
  assert.equal(applyFleetTransactionTotals({ isoDate: '2026-09-13' }, 'fleet-a', [total]).transactionCostSource,
    'canonical_signature_stream_with_recovered_assignment');
  assert.equal(recovered[1].assignment, '');
  assert.equal(recovered[2].assignment, '');
  assert.equal(recovered[3].assignment, 'Mine');
  assert.equal(recovered[3].assignmentProvenance, undefined);
  assert.equal(records[0].assignment, '', 'source records remain immutable');
});

test('Mine totals deduplicate signatures and sum exact lamports by authoritative fleet and UTC day', () => {
  const totals = aggregateFleetTransactionEvents([
    fee(),
    fee(),
    fee({ transactionSignature: 'sig-b', txFeeLamports: '5002', timestamp: '2026-09-13T23:59:59.000Z' }),
  ], { assignments: ['Mine'], faction: 'MUD', instance: 'MUD' });

  assert.deepEqual(totals, [{
    isoDate: '2026-09-13',
    fleetAccount: 'fleet-a',
    fleetLabel: 'MINER-A',
    txFeeLamports: '10003',
    txCostSolExact: '0.000010003',
    txCostSol: 0.000010003,
    txsDaily: 2,
  }]);
});

test('Mine totals exclude other assignments, factions, instances, event types, and invalid fee evidence', () => {
  const totals = aggregateFleetTransactionEvents([
    fee(),
    fee({ assignment: 'Scan', transactionSignature: 'scan' }),
    fee({ faction: 'ONI', transactionSignature: 'oni' }),
    fee({ instance: 'OTHER', transactionSignature: 'instance' }),
    fee({ eventType: 'fuel', transactionSignature: 'fuel' }),
    fee({ txFeeLamports: '0', transactionSignature: 'free' }),
    fee({ fleetAccount: '', transactionSignature: 'unscoped' }),
  ], { assignments: ['Mine'], faction: 'MUD', instance: 'MUD' });

  assert.equal(totals.length, 1);
  assert.equal(totals[0].txsDaily, 1);
  assert.equal(totals[0].txFeeLamports, '5001');
});

test('valid fee-bearing records count regardless of transaction success metadata', () => {
  const totals = aggregateFleetTransactionEvents([
    fee({ transactionSignature: 'failed-on-chain', success: false }),
  ], { assignments: ['Mine'], faction: 'MUD', instance: 'MUD' });

  assert.equal(totals[0].txsDaily, 1);
  assert.equal(totals[0].txFeeLamports, '5001');
});

test('canonical totals replace legacy values and missing authoritative evidence is explicitly unavailable', () => {
  const canonical = aggregateFleetTransactionEvents([
    fee(),
  ], { assignments: ['Mine'], faction: 'MUD', instance: 'MUD' });
  const legacy = { isoDate: '2026-09-13', fleet: 'MINER-A', txsDaily: 9, txCostSol: 0.9 };

  assert.deepEqual(applyFleetTransactionTotals(legacy, 'fleet-a', canonical), {
    ...legacy,
    txsDaily: 1,
    txCostSol: 0.000005001,
    txFeeLamports: '5001',
    transactionCostSource: 'canonical_signature_stream',
  });
  assert.deepEqual(applyFleetTransactionTotals(legacy, 'fleet-b', canonical), {
    ...legacy,
    txsDaily: null,
    txCostSol: null,
    txFeeLamports: null,
    transactionCostSource: 'unavailable',
  });
  assert.equal(applyFleetTransactionTotals({ ...legacy, isoDate: '2026-09-12' }, 'fleet-a', canonical).txsDaily, null);
  assert.equal(applyFleetTransactionTotals(legacy, '', canonical).txCostSol, null);
});

test('ambiguous multi-row fleet days fail closed instead of duplicating one canonical fleet total', () => {
  const rows = [
    { isoDate: '2026-09-13', fleet: 'MINER-A', rawMaterial: 'Iron' },
    { isoDate: '2026-09-13', fleet: 'MINER-A', rawMaterial: 'Copper' },
    { isoDate: '2026-09-13', fleet: 'MINER-B', rawMaterial: 'Carbon' },
  ];
  const keys = unambiguousFleetDayKeys(rows, (row) => row.fleet === 'MINER-A' ? 'fleet-a' : 'fleet-b');
  assert.equal(keys.has('2026-09-13\nfleet-a'), false);
  assert.equal(keys.has('2026-09-13\nfleet-b'), true);
});

test('Mining projection replaces its legacy totals from the shared canonical stream only', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /assignmentRecoveredRawRecords = recoverFleetTransactionAssignments/);
  assert.match(main, /canonicalMiningTransactions = rawExporter[\s\S]*assignmentRecoveredRawRecords[\s\S]*assignments: \['Mine'\]/);
  const miningProjection = main.slice(main.indexOf('const mining = await Promise.all'), main.indexOf('const cargo = await Promise.all'));
  assert.match(miningProjection, /unambiguousMiningFleetDays\.has/);
  assert.match(miningProjection, /applyFleetTransactionTotals\(miningRow, transactionFleetAccount, canonicalMiningTransactions\)/);
});

test('Scanning projection replaces its legacy totals from exact Scan-assignment signatures', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /canonicalScanningTransactions = rawExporter[\s\S]*assignments: \['Scan'\]/);
  const scanningProjection = main.slice(main.indexOf('const rows = await Promise.all'), main.indexOf('const mining = await Promise.all'));
  assert.match(scanningProjection, /applyFleetTransactionTotals\(scanRow, fleet\?\.key \|\| historicalRental\?\.fleetAccount, canonicalScanningTransactions\)/);
});

test('Cargo canonical costs include only Transport and Supply Chain source records', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /canonicalCargoAssignments = \['Transport', 'Supply Chain'\]/);
  assert.match(main, /canonicalCargoRawRecords = assignmentRecoveredRawRecords\.filter[\s\S]*canonicalCargoAssignments\.includes\(record\.assignment\)/);
  assert.match(main, /valueCanonicalRawCosts\(canonicalCargoRawRecords/);

  const totals = aggregateFleetTransactionEvents([
    fee({ assignment: 'Transport', transactionSignature: 'transport' }),
    fee({ assignment: 'Supply Chain', transactionSignature: 'supply', txFeeLamports: '5002' }),
    fee({ assignment: 'Mine', transactionSignature: 'mine' }),
  ], { assignments: ['Transport', 'Supply Chain'], faction: 'MUD', instance: 'MUD' });
  assert.equal(totals[0].txsDaily, 2);
  assert.equal(totals[0].txFeeLamports, '10003');
});

test('missing transaction evidence cannot become zero or a partial total in Earnings', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  const cargoProjection = fs.readFileSync(path.join(__dirname, '..', 'electron', 'cargo-table-projection.js'), 'utf8');

  assert.match(main, /hasTransactionEvidence && Number\.isFinite\(txsCostsAtlas\)/);
  assert.match(renderer, /function invalidateIncompleteTransactionTotal/);
  assert.match(renderer, /entry\.txsDaily == null \? 'N\/A'/);
  assert.doesNotMatch(cargoProjection, /fee: feeCovered \? 'canonical' : 'legacy'/);
  assert.match(cargoProjection, /fee: feeCovered \? 'canonical' : 'unavailable'/);
});
