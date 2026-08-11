'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  mergeCargoRowsWithCompletedAllocations,
} = require('../electron/influx-data');
const {
  joinCanonicalCostsWithOperationalRows,
  selectCutoverOwnedCargoRows,
} = require('../electron/cargo-table-projection');
const { calculateCargoEfficiency } = require('../electron/earnings-math');
const { acceptCargoAllocationResponse } = require('../electron/cargo-allocation-renderer');

const DAY = '2026-07-20';
const SHARED_LABEL = 'Shared Cargo Label';
const SHARED_ASSIGNMENT = 'Transport';
const factions = [
  { name: 'MUD', faction: 'MUD', instance: 'MUD', accounts: ['1'.repeat(44), '2'.repeat(44)] },
  { name: 'ONI', faction: 'ONI', instance: 'ONI-1', accounts: ['3'.repeat(44), '4'.repeat(44)] },
  { name: 'USTUR', faction: 'UST', instance: 'USTUR2', accounts: ['5'.repeat(44), '6'.repeat(44)] },
];

function cycleId(account, sequence) { return `${account}:10,20:178450000000${sequence}`; }
function cycleEvidence(scope, account, sequence, overrides = {}) {
  const id = cycleId(account, sequence);
  const fleet = scope.name === 'ONI' && sequence === 1 ? 'Big Bois' : SHARED_LABEL;
  return {
    completion: {
      _time: `${DAY}T0${sequence}:00:00.000Z`, _value: '2', cycleId: id,
      faction: scope.faction, instance: scope.instance, fleet, assignment: SHARED_ASSIGNMENT,
    },
    allocation: {
      isoDate: DAY, timestamp: `${DAY}T0${sequence}:00:00.000Z`, cycleId: id,
      faction: scope.faction, instance: scope.instance, fleet,
      assignment: SHARED_ASSIGNMENT, asset: 'Fuel', origin: 'SHARED-A', destination: 'SHARED-B',
      amount: 100, cargoVolume: 400 + sequence, allocatedFuel: 10 + sequence,
      allocatedTxCostSol: 0.001 * sequence, ...overrides,
    },
  };
}
function reconstruct(movementRows, evidence) {
  return mergeCargoRowsWithCompletedAllocations({
    movementRows,
    completionRows: evidence.map((entry) => entry.completion),
    allocationRows: evidence.map((entry) => entry.allocation),
    includedDays: new Set([DAY]),
  });
}
function operational(scope, account, overrides = {}) {
  return {
    isoDate: DAY, faction: scope.faction, instance: scope.instance, fleetAccount: account,
    fleet: SHARED_LABEL, assignment: SHARED_ASSIGNMENT, txsDaily: 4,
    completedCycleIds: [cycleId(account, 1)], cargoCycles: 1, cargoLegs: 2,
    starbases: ['SHARED-A', 'SHARED-B'], travelTimeByMode: { warp: 60, subwarp: 40 },
    cargoVolume: 401, fleetCargoCapacity: 250, ...overrides,
  };
}
function canonicalCost(scope, account, overrides = {}) {
  return {
    isoDate: DAY, faction: scope.faction, instance: scope.instance, fleetAccount: account,
    fleet: SHARED_LABEL, allocationKey: `fleet:${account}`, allocationStatus: 'scoped', sourceMode: 'canonical_raw',
    burnedFuelExact: '11', burnedFuel: 11, txFeeLamports: '1000000', txCostSolExact: '0.001', txCostSol: 0.001,
    txsDaily: 4, fuelValuation: { status: 'complete', amountATLExact: '22', amountATL: 22 },
    solValuation: { status: 'complete', amountATLExact: '3', amountATL: 3 }, sourceIds: [`${scope.faction}-${account}`],
    ...overrides,
  };
}

for (const scope of factions) {
  test(`${scope.name}: fulfilled-empty and rejected movement reconstruct both authoritative fleet identities`, () => {
    const evidence = scope.accounts.map((account, index) => cycleEvidence(scope, account, index + 1));
    for (const movementState of ['fulfilled-empty', 'rejected']) {
      const rows = reconstruct([], evidence);
      assert.equal(rows.length, 2, movementState);
      assert.deepEqual(rows.map((row) => row.fleetAccount).sort(), [...scope.accounts].sort());
      assert.equal(rows.reduce((sum, row) => sum + row.cargoVolume, 0), 803);
    }
  });

  test(`${scope.name}: partial reconstruction fills only the missing cycle and healthy evidence is conserved`, () => {
    const evidence = scope.accounts.map((account, index) => cycleEvidence(scope, account, index + 1));
    const healthy = {
      ...operational(scope, scope.accounts[0]), burnedFuel: 11, txCostSol: 0.001, cargoVolume: 401,
      movementCycleIds: [evidence[0].completion.cycleId], completedCycleIds: [evidence[0].completion.cycleId],
    };
    const rows = reconstruct([healthy], evidence);
    assert.equal(rows.length, 2);
    const preserved = rows.find((row) => row.fleetAccount === scope.accounts[0]);
    const recovered = rows.find((row) => row.fleetAccount === scope.accounts[1]);
    assert.deepEqual({ fuel: preserved.burnedFuel, tx: preserved.txCostSol, volume: preserved.cargoVolume, cycles: preserved.cargoCycles }, { fuel: 11, tx: 0.001, volume: 401, cycles: 1 });
    assert.deepEqual({ fuel: recovered.burnedFuel, tx: recovered.txCostSol, volume: recovered.cargoVolume, cycles: recovered.cargoCycles }, { fuel: 12, tx: 0.002, volume: 402, cycles: 1 });
  });

  test(`${scope.name}: cutover, availability, zero, and derived Cargo metrics remain exact`, () => {
    const account = scope.accounts[0];
    const legacy = { ...operational(scope, account), burnedFuel: 99, txCostSol: 99 };
    const operation = operational(scope, account);
    const available = canonicalCost(scope, account);
    const owned = selectCutoverOwnedCargoRows({ legacyRows: [legacy], operationalRows: [operation], cutover: `${DAY}T00:00:00.000Z` });
    const [row] = joinCanonicalCostsWithOperationalRows({ legacyRows: owned.legacyRows, costRows: [available], operationalRows: owned.operationalRows });
    assert.equal(joinCanonicalCostsWithOperationalRows({ legacyRows: owned.legacyRows, costRows: [available], operationalRows: owned.operationalRows }).length, 1);
    assert.deepEqual({ fuel: row.burnedFuel, tx: row.txCostSol, volume: row.cargoVolume }, { fuel: 11, tx: 0.001, volume: 401 });
    const totalCosts = row.fuelValuation.amountATL + row.solValuation.amountATL;
    assert.equal(row.solValuation.amountATL / totalCosts * 100, 12);
    assert.equal(calculateCargoEfficiency(row).cargoEfficiencyPercent, 80.2);

    const [missing] = joinCanonicalCostsWithOperationalRows({ operationalRows: [operation] });
    assert.equal(missing.costEvidenceStatus, 'legacy_fallback');
    assert.equal(missing.sourceMode, 'legacy');
    assert.equal(missing.burnedFuel, operation.burnedFuel);
    const [zero] = joinCanonicalCostsWithOperationalRows({ costRows: [canonicalCost(scope, account, { burnedFuelExact: '0', burnedFuel: 0, txFeeLamports: '0', txCostSolExact: '0', txCostSol: 0, fuelValuation: { status: 'complete', amountATL: 0 }, solValuation: { status: 'complete', amountATL: 0 } })], operationalRows: [operation] });
    assert.equal(zero.costEvidenceStatus, 'available');
    assert.equal(zero.burnedFuel, 0);
    assert.equal(zero.txCostSol, 0);
  });
}

test('cross-faction isolation survives overlapping dates, labels, assignments, routes, and assets', () => {
  const evidence = factions.flatMap((scope) => scope.accounts.map((account, index) => cycleEvidence(scope, account, index + 1)));
  const rows = reconstruct([], evidence);
  assert.equal(rows.length, 6);
  for (const scope of factions) {
    const scoped = rows.filter((row) => row.faction === scope.faction && row.instance === scope.instance);
    assert.equal(scoped.length, 2);
    assert.deepEqual(scoped.map((row) => row.fleetAccount).sort(), [...scope.accounts].sort());
  }
});

test('automatic prefetch excludes Allocation and dedicated renderer owns availability', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  const shared = main.slice(main.indexOf('async function fetchEarningsSnapshot'), main.indexOf('function createWindow'));
  assert.match(renderer, /async function runFactionBackgroundPrefetch[^]*refreshEarnings/);
  assert.match(renderer, /api\.getEarningsSnapshot\(settings\)/);
  assert.doesNotMatch(shared, /fetchCargoAllocationSnapshot|cargoAllocationSource|cargoAllocationRows|cargoAllocationError/);
  assert.match(renderer, /async function refreshCargoAllocation/);
  assert.match(renderer, /api\.getCargoAllocation\(settings\)/);
  assert.match(renderer, /cargoAllocationAvailability === 'unavailable'/);
  assert.match(renderer, /cargoAllocationAvailability === 'empty'/);
  const response = { ok: true, availability: 'available', rows: [{ asset: 'Fuel' }] };
  const requested = { faction: 'MUD', playerProfile: 'mud-profile' };
  assert.equal(acceptCargoAllocationResponse(response, requested, requested).accepted, true);
  assert.deepEqual(acceptCargoAllocationResponse(response, requested, { ...requested, faction: 'ONI' }), { accepted: false, reason: 'stale_scope' });
  assert.deepEqual(acceptCargoAllocationResponse(response, requested, { ...requested, playerProfile: 'other-profile' }), { accepted: false, reason: 'stale_scope' });
});
