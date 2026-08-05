'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInfluxCsv } = require('../electron/influx-data');
const {
  RAW_COST_CUTOVER_UTC, RAW_COST_CUTOVERS, buildRawCostFluxQuery,
  projectRawCostEvents, selectLegacyRawCutover, lamportsToSolDecimal, rawCostDigest,
  aggregateRawCostsByFleetDay, applyRawCostsToCargoAllocations, valueCanonicalRawCosts,
  buildCanonicalRawCostPool,
} = require('../electron/cargo-cost-source');

const fuel = (overrides = {}) => ({ _time: '2026-08-05T00:01:02.003Z', schemaVersion: '1', eventType: 'fuel', eventIdentity: 'fuel:cycle:0', fuelQuantity: '12.500000000000001', movementEventId: 'cycle:0', cycleId: 'cycle', movementIndex: '0', timestampProvenance: 'solana_block_time', sourceProvenance: 'confirmed_movement', faction: 'MUD', instance: 'MUD', fleetAccount: 'fleet', fleetLabel: 'Fleet', assignment: 'Transport', ...overrides });
const sol = (overrides = {}) => ({ _time: '2026-08-05T00:01:02.003Z', schemaVersion: '1', eventType: 'sol_fee', eventIdentity: 'sol_fee:sig', txFeeLamports: '9007199254740993', transactionSignature: 'sig', timestampProvenance: 'solana_block_time', sourceProvenance: 'confirmed_transaction', faction: 'MUD', instance: 'MUD', fleetAccount: 'fleet', fleetLabel: 'Fleet', assignment: 'Transport', ...overrides });

test('raw Fuel and SOL project to canonical records with exact native values', () => {
  const result = projectRawCostEvents([fuel(), sol()]);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.records[0].fuelQuantity, '12.500000000000001');
  assert.equal(result.records[1].txFeeLamports, '9007199254740993');
  assert.equal(result.records[1].timestamp, '2026-08-05T00:01:02.003Z');
  assert.equal(lamportsToSolDecimal('9007199254740993'), '9007199.254740993');
  assert.equal(result.records[0].valuation.amountATL, null);
});

test('replay is idempotent, conflict fails closed, and distinct equal points remain distinct', () => {
  const replay = projectRawCostEvents([fuel(), fuel()]);
  assert.equal(replay.records.length, 1);
  const conflict = projectRawCostEvents([fuel(), fuel({ fuelQuantity: '13' }), fuel()]);
  assert.equal(conflict.records.length, 0);
  assert.equal(conflict.rejected[0].reason, 'source_identity_conflict');
  const distinct = projectRawCostEvents([fuel(), fuel({ eventIdentity: 'fuel:cycle:1', movementIndex: '1', movementEventId: 'cycle:1' })]);
  assert.equal(distinct.records.length, 2);
});

test('mutable assignment and fleet-label metadata merge deterministically without conflicts', () => {
  const variants = [
    fuel(),
    fuel({ assignment: 'Supply Chain' }),
    fuel({ fleetLabel: 'Renamed' }),
    fuel({ assignment: 'Supply Chain', fleetLabel: 'Renamed' }),
  ];
  for (const variant of variants.slice(1)) {
    const projected = projectRawCostEvents([variants[0], variant]);
    assert.equal(projected.records.length, 1);
    assert.equal(projected.rejected.length, 0);
  }
  const forward = projectRawCostEvents(variants);
  const reverse = projectRawCostEvents([...variants].reverse());
  assert.equal(forward.records.length, 1);
  assert.equal(reverse.records.length, 1);
  assert.deepEqual(forward.records, reverse.records);
  assert.equal(forward.records[0].fuelQuantity, '12.500000000000001');
});

test('immutable Fuel source facts still conflict and fail closed', () => {
  const changes = [
    { fuelQuantity: '13' },
    { _time: '2026-08-05T00:01:02.004Z' },
    { movementEventId: 'cycle:other' },
    { cycleId: 'other-cycle' },
    { movementIndex: '1' },
    { timestampProvenance: 'observed_at' },
    { sourceProvenance: 'other_source' },
  ];
  for (const change of changes) {
    const projected = projectRawCostEvents([fuel(), fuel(change)]);
    assert.equal(projected.records.length, 0);
    assert.equal(projected.rejected.length, 1);
    assert.equal(projected.rejected[0].reason, 'source_identity_conflict');
  }
});

test('immutable SOL amount, signature, event position, timestamp, and provenance still conflict', () => {
  const baseline = sol({ eventPosition: '0' });
  const changes = [
    { txFeeLamports: '9007199254740994' },
    { transactionSignature: 'different-signature' },
    { eventPosition: '1' },
    { _time: '2026-08-05T00:01:02.004Z' },
    { timestampProvenance: 'observed_at' },
    { sourceProvenance: 'other_source' },
  ];
  for (const change of changes) {
    const projected = projectRawCostEvents([baseline, { ...baseline, ...change }]);
    assert.equal(projected.records.length, 0);
    assert.equal(projected.rejected[0].reason, 'source_identity_conflict');
  }
});

test('CSV reconstruction ignores repeated table headers', () => {
  const csv = `,result,table,_time,eventType,eventIdentity,schemaVersion,fuelQuantity,movementEventId,cycleId,movementIndex,timestampProvenance,sourceProvenance,faction,instance,fleetAccount,fleetLabel,assignment\n,_result,0,2026-08-05T00:01:02.003Z,fuel,fuel:cycle:0,1,12.5,cycle:0,cycle,0,solana_block_time,confirmed_movement,MUD,MUD,fleet,Fleet,Transport\n,result,table,_time,eventType,eventIdentity,schemaVersion,txFeeLamports,transactionSignature,timestampProvenance,sourceProvenance,faction,instance,fleetAccount,fleetLabel,assignment\n,_result,1,2026-08-05T00:02:00Z,sol_fee,sol_fee:sig,1,5001,sig,solana_block_time,confirmed_transaction,MUD,MUD,fleet,Fleet,Transport`;
  const rows = parseInfluxCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(projectRawCostEvents(rows).records.map((row) => row.eventType), ['fuel', 'sol_fee']);
});

test('incremental projection equals full rebuild, including mutable metadata revisions', () => {
  const rows = [
    fuel(),
    fuel({ assignment: 'Supply Chain', fleetLabel: 'Renamed' }),
    sol(),
    fuel({ eventIdentity: 'fuel:cycle:1', movementIndex: '1', movementEventId: 'cycle:1' }),
  ];
  const full = projectRawCostEvents(rows);
  const accumulatedRows = [];
  let incremental;
  for (const chunk of [rows.slice(0, 1), rows.slice(1, 2), rows.slice(2)]) {
    accumulatedRows.push(...chunk);
    incremental = projectRawCostEvents(accumulatedRows);
  }
  assert.equal(rawCostDigest(incremental.records), rawCostDigest(full.records));
  assert.deepEqual(incremental.records, full.records);
});

test('versioned UTC cutover prevents legacy/raw overlap and excludes disabled USTUR1', () => {
  assert.equal(RAW_COST_CUTOVER_UTC, '2026-08-05T00:00:00.000Z');
  assert.equal(Object.keys(RAW_COST_CUTOVERS).length, 3);
  const raw = [projectRawCostEvents([fuel()]).records[0], projectRawCostEvents([fuel({ _time: '2026-08-04T23:59:59Z' })]).records[0]];
  const selected = selectLegacyRawCutover({ faction: 'MUD', instance: 'MUD', legacyRows: [{ isoDate: '2026-08-04' }, { isoDate: '2026-08-05' }], rawRecords: raw });
  assert.deepEqual(selected.legacyRows.map((r) => r.isoDate), ['2026-08-04']);
  assert.equal(selected.rawRecords.length, 1);
  const disabled = selectLegacyRawCutover({ faction: 'UST', instance: 'USTUR1', legacyRows: [{ isoDate: '2026-08-05' }], rawRecords: raw });
  assert.equal(disabled.cutover, null); assert.equal(disabled.trackingDisabled, true); assert.equal(disabled.legacyRows.length, 1); assert.equal(disabled.rawRecords.length, 0);
});

test('raw daily projection drives existing cargo-weight allocation with exact native conservation', () => {
  const records = projectRawCostEvents([fuel(), sol({ txFeeLamports: '5001' })]).records;
  const daily = aggregateRawCostsByFleetDay(records);
  assert.equal(daily[0].burnedFuelExact, '12.500000000000001');
  assert.equal(daily[0].txFeeLamports, '5001');
  assert.equal(daily[0].allocationKey, 'fleet:fleet');
  const allocated = applyRawCostsToCargoAllocations([
    { isoDate: '2026-08-05', fleetAccount: 'fleet', cargoVolume: 1, allocatedFuel: 999, allocatedTxCostSol: 999 },
    { isoDate: '2026-08-05', fleetAccount: 'fleet', cargoVolume: 3, allocatedFuel: 999, allocatedTxCostSol: 999 },
    { isoDate: '2026-08-04', fleetAccount: 'fleet', cargoVolume: 1, allocatedFuel: 7, allocatedTxCostSol: 0.1 },
  ], daily);
  assert.deepEqual(allocated.slice(0, 2).map((row) => row.allocatedFuelExact), ['3.125', '9.375000000000001']);
  assert.deepEqual(allocated.slice(0, 2).map((row) => row.allocatedTxFeeLamports), ['1250', '3751']);
  assert.equal(allocated[0].allocatedFuel + allocated[1].allocatedFuel, daily[0].burnedFuel);
  assert.equal(BigInt(allocated[0].allocatedTxFeeLamports) + BigInt(allocated[1].allocatedTxFeeLamports), 5001n);
  assert.equal(allocated[2].allocatedFuel, 7);
});

test('missing fleet scope is explicit unallocated accounting and never falls back to metadata', () => {
  const unscoped = projectRawCostEvents([
    fuel({ fleetAccount: '', fleetLabel: 'Mutable Fleet', assignment: 'Transport' }),
    sol({ fleetAccount: '', fleetLabel: 'Mutable Fleet', assignment: 'Transport', eventIdentity: 'sol_fee:unscoped', transactionSignature: 'unscoped' }),
  ]).records;
  const daily = aggregateRawCostsByFleetDay(unscoped);
  assert.equal(daily.length, 2);
  for (const row of daily) {
    assert.equal(row.fleetAccount, '');
    assert.equal(row.fleet, null);
    assert.equal(row.assignment, null);
    assert.equal(row.allocationStatus, 'unallocated');
    assert.equal(row.allocationReason, 'allocation_scope_missing');
    assert.match(row.allocationKey, /^unallocated:v1:MUD:MUD:2026-08-05:(fuel|sol_fee)$/);
  }
  const attemptedLabelMatch = applyRawCostsToCargoAllocations([
    { isoDate: '2026-08-05', fleetAccount: 'Mutable Fleet', fleet: 'Mutable Fleet', cargoVolume: 1, allocatedFuel: 99, allocatedTxCostSol: 99 },
  ], daily);
  assert.equal(attemptedLabelMatch[0].sourceMode, 'raw_missing');
  assert.equal(attemptedLabelMatch[0].allocatedFuel, 0);
  assert.equal(attemptedLabelMatch[0].allocatedTxCostSol, 0);
});

test('mutable metadata cannot change scoped allocation or unallocated results in either order', () => {
  for (const fleetAccount of ['fleet', '']) {
    const base = fuel({ fleetAccount });
    const changed = fuel({ fleetAccount, fleetLabel: 'Renamed', assignment: 'Supply Chain' });
    const forward = aggregateRawCostsByFleetDay(projectRawCostEvents([base, changed]).records);
    const reverse = aggregateRawCostsByFleetDay(projectRawCostEvents([changed, base]).records);
    assert.deepEqual(forward, reverse);
    assert.equal(forward[0].burnedFuelExact, '12.500000000000001');
    assert.equal(forward[0].allocationKey, fleetAccount ? 'fleet:fleet' : 'unallocated:v1:MUD:MUD:2026-08-05:fuel');
  }
});

test('distinct unscoped identities remain canonical, distinct, and conserved without double counting', () => {
  const records = projectRawCostEvents([
    sol({ fleetAccount: '', fleetLabel: 'Same', eventIdentity: 'sol_fee:a', transactionSignature: 'a', txFeeLamports: '7' }),
    sol({ fleetAccount: '', fleetLabel: 'Same', eventIdentity: 'sol_fee:b', transactionSignature: 'b', txFeeLamports: '7' }),
  ]).records;
  const daily = aggregateRawCostsByFleetDay(records);
  assert.equal(records.length, 2);
  assert.equal(daily.length, 1);
  assert.equal(daily[0].sourceIds.length, 2);
  assert.equal(daily[0].txFeeLamports, '14');
  assert.equal(daily[0].allocationStatus, 'unallocated');
  const pool = buildCanonicalRawCostPool(records);
  assert.equal(pool.costs.length, 2);
  assert.equal(pool.references.length, 2);
  assert.equal(pool.pending.length, 0);
  assert.ok(pool.costs.every((cost) => cost.fleet === null && cost.allocationStatus === 'unallocated' && cost.allocationReason === 'allocation_scope_missing'));
  assert.ok(pool.references.every((reference) => !Object.hasOwn(reference, 'assignment')));
});

test('post-seed missing price remains incomplete and null, never zero', async () => {
  const [valued] = await valueCanonicalRawCosts(projectRawCostEvents([fuel()]).records, { resolveFuelPrice: async () => ({ status: 'incomplete', priceATL: null }) });
  assert.equal(valued.valuation.status, 'incomplete');
  assert.equal(valued.valuation.amountATL, null);
  assert.equal(valued.valuation.effectiveUtcDate, '2026-08-05');
});

test('malformed identity is quality failure and raw query has no aggregation or cadence', () => {
  const bad = projectRawCostEvents([fuel({ eventIdentity: '' })]);
  assert.equal(bad.rejected[0].reason, 'source_identity_missing');
  const query = buildRawCostFluxQuery('slya');
  assert.match(query, /cargo_cost_source_event_v1/); assert.match(query, /range\(start: -31d\)/); assert.match(query, /pivot/);
  assert.doesNotMatch(query, /aggregateWindow|sum\(|mean\(|http|price|timer|poll/);
});
