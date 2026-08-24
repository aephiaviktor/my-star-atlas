'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  canonicalDecimalAmount,
  projectCargoDeliveryEvidence,
  stableJson,
} = require('../electron/cargo-delivery-evidence');

const PROGRAM = 'SAGE2HAwep459SNq61LHvjxPk4pLPEJLoMETef7f7EE';
const SIGNATURE = 'S8Z2n6QsVc1DAHuUaVRAFUkoZbyQzp2T1v3yfY9d7rTkMmibQUSMn7feVAk6PEaNDaT7uwzwaegGiZx8o5CAHAm';
const FLEET_ACCOUNT = 'DDdAJk2KZZtJNVa7J1qdRzMW4tgfvJLrjMhU5Ct12uwy';
const PROFILE = '8nCEkbxQ3UYAXWLuFCbYpkiGWkP9pwfDYVGuaJ4NcemT';
const MINT = '11111111111111111111111111111111';

function hash(payload) {
  return crypto.createHash('sha256').update(stableJson(payload)).digest('hex');
}

function evidenceRow(overrides = {}) {
  const row = {
    _time: '2026-08-24T08:43:22.808683504Z',
    faction: 'UST', instance: '', fleet: 'CF-22|01b', rss: 'Field Stabilizer', assignment: 'Supply Chain',
    originStarbase: 'MRZ-21', deliveryStarbase: 'MRZ-22',
    cycleId: `${FLEET_ACCOUNT}:35,16:1784963236893`, allocationIndex: '0',
    amount: '1', cargoVolume: '6', allocatedFuel: '2.5', allocatedTxCostSol: '0.000001', assetMint: MINT,
    deliveryEvidenceSchemaVersion: '1', deliveryMovementType: 'unload', deliverySignature: SIGNATURE,
    deliveryOuterInstructionIndex: '3', deliveryConfirmedSlot: '361234567', deliveryConfirmedBlockTime: '1787561002',
    deliveryRawAmount: '19999000000', deliveryMintDecimals: '6', deliveryDecimalAmount: '19999',
    deliveryProgramId: PROGRAM, deliveryFleetAccount: FLEET_ACCOUNT, deliveryFactionProfile: 'UST',
    deliveryProfileAccount: PROFILE, deliveryRoute: 'MRZ-21→MRZ-22', deliveryAllocationId: 'allocation-0',
    ...overrides,
  };
  row.deliveryEventId = overrides.deliveryEventId || `cargo-delivery:v1:${row.deliveryProgramId}:${row.deliverySignature}:${row.deliveryOuterInstructionIndex}:unload`;
  const payload = {
    schemaVersion: 1, movementType: row.deliveryMovementType, signature: row.deliverySignature,
    outerInstructionIndex: Number(row.deliveryOuterInstructionIndex), programId: row.deliveryProgramId,
    slot: Number(row.deliveryConfirmedSlot), blockTime: Number(row.deliveryConfirmedBlockTime),
    rawAmount: row.deliveryRawAmount, mintDecimals: Number(row.deliveryMintDecimals), decimalAmount: row.deliveryDecimalAmount,
    mint: row.assetMint, fleetAccount: row.deliveryFleetAccount, fleetLabel: row.fleet,
    factionProfile: row.deliveryFactionProfile, profileAccount: row.deliveryProfileAccount,
    route: row.deliveryRoute, cycleId: row.cycleId, allocationId: row.deliveryAllocationId, eventId: row.deliveryEventId,
  };
  row.deliveryEvidencePayloadHash = overrides.deliveryEvidencePayloadHash || hash(payload);
  return row;
}

test('v265 anchor keeps legacy amount one but projects the full exact canonical delivery', () => {
  const row = evidenceRow();
  const result = projectCargoDeliveryEvidence([row]);
  assert.equal(result.allocationRows.length, 1);
  assert.equal(result.allocationRows[0].amount, '1');
  assert.equal(result.logicalDeliveries.length, 1);
  assert.equal(result.logicalDeliveries[0].decimalAmount, '19999');
  assert.equal(result.logicalDeliveries[0].rawAmount, '19999000000');
  assert.equal(result.logicalDeliveries[0].replayCount, 1);
  assert.equal(result.evidenceRows[0].classification, 'authoritative');
});

test('preserved v264 duplicate evidence across split allocations collapses to one logical event', () => {
  const first = evidenceRow({ amount: '1', allocationIndex: '0' });
  const second = { ...first, amount: '19998', allocationIndex: '1' };
  const result = projectCargoDeliveryEvidence([first, second]);
  assert.equal(result.allocationRows.length, 2);
  assert.deepEqual(result.allocationRows.map((row) => row.amount), ['1', '19998']);
  assert.equal(result.logicalDeliveries.length, 1);
  assert.equal(result.logicalDeliveries[0].replayCount, 2);
  assert.deepEqual(result.logicalDeliveries[0].provenance.map((entry) => entry.allocationIndex), ['0', '1']);
  assert.deepEqual(result.evidenceRows.map((row) => row.classification), ['authoritative_replay', 'authoritative_replay']);
});

test('same event ID with different payload hashes is quarantined and fails closed', () => {
  const first = evidenceRow();
  const conflicting = evidenceRow({ allocationIndex: '1', amount: '19998', deliveryEvidencePayloadHash: 'f'.repeat(64) });
  const result = projectCargoDeliveryEvidence([first, conflicting]);
  assert.equal(result.logicalDeliveries.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].classification, 'evidence_conflict');
  assert.deepEqual(result.evidenceRows.map((row) => row.classification), ['evidence_conflict', 'evidence_conflict']);
});

test('multiple outer instruction indexes in one signature remain distinct deliveries', () => {
  const first = evidenceRow();
  const second = evidenceRow({ deliveryOuterInstructionIndex: '4', deliveryAllocationId: 'allocation-1', allocationIndex: '1', rss: 'Electronics', deliveryRawAmount: '103055000000', deliveryDecimalAmount: '103055' });
  const result = projectCargoDeliveryEvidence([second, first]);
  assert.equal(result.logicalDeliveries.length, 2);
  assert.deepEqual(result.logicalDeliveries.map((row) => row.outerInstructionIndex), ['3', '4']);
});

test('huge and tiny raw quantities render exactly without Number conversion', () => {
  assert.equal(canonicalDecimalAmount('123456789012345678901234567890123456789', '18'), '123456789012345678901.234567890123456789');
  assert.equal(canonicalDecimalAmount('1', '18'), '0.000000000000000001');
  assert.equal(canonicalDecimalAmount('1000000000000000000', '18'), '1');
});

test('invalid raw, decimals, decimal amount, event ID, and payload hash remain invalid and non-authoritative', () => {
  const cases = [
    evidenceRow({ deliveryRawAmount: '-1' }),
    evidenceRow({ deliveryMintDecimals: '1.5' }),
    evidenceRow({ deliveryDecimalAmount: '19998' }),
    evidenceRow({ deliveryEventId: 'wrong-event' }),
    evidenceRow({ deliveryEvidencePayloadHash: '0'.repeat(64) }),
  ];
  for (const row of cases) {
    const result = projectCargoDeliveryEvidence([row]);
    assert.equal(result.logicalDeliveries.length, 0);
    assert.equal(result.evidenceRows[0].classification, 'evidence_invalid');
    assert.ok(result.evidenceRows[0].reasons.length > 0);
  }
});

test('legacy rows without delivery evidence remain explicit and preserve quantities and costs', () => {
  const legacy = { _time: '2026-08-24T07:00:00Z', cycleId: 'legacy', allocationIndex: '0', amount: '7', cargoVolume: '9', allocatedFuel: '2.25', allocatedTxCostSol: '0.01' };
  const result = projectCargoDeliveryEvidence([legacy]);
  assert.equal(result.logicalDeliveries.length, 0);
  assert.equal(result.evidenceRows[0].classification, 'legacy_unverified');
  assert.deepEqual(result.allocationRows[0], legacy);
});

test('replay output and provenance ordering are deterministic regardless of input order', () => {
  const first = evidenceRow({ allocationIndex: '9', _time: '2026-08-24T08:43:23Z' });
  const second = { ...first, allocationIndex: '2', _time: '2026-08-24T08:43:22Z' };
  const forward = projectCargoDeliveryEvidence([first, second]);
  const reverse = projectCargoDeliveryEvidence([second, first]);
  assert.deepEqual(forward.logicalDeliveries, reverse.logicalDeliveries);
  assert.deepEqual(forward.logicalDeliveries[0].provenance.map((entry) => entry.allocationIndex), ['2', '9']);
});

test('projection preserves allocation count, amounts, and legacy cost totals unchanged', () => {
  const rows = [
    evidenceRow({ amount: '1', allocatedFuel: '1.25', allocatedTxCostSol: '0.000001' }),
    { ...evidenceRow(), allocationIndex: '1', amount: '19998', allocatedFuel: '2.75', allocatedTxCostSol: '0.000002' },
    { cycleId: 'legacy', allocationIndex: '0', amount: '4', cargoVolume: '8', allocatedFuel: '3', allocatedTxCostSol: '0.5' },
  ];
  const result = projectCargoDeliveryEvidence(rows);
  assert.equal(result.allocationRows.length, rows.length);
  assert.deepEqual(result.allocationRows.map((row) => row.amount), rows.map((row) => row.amount));
  assert.equal(result.allocationRows.reduce((sum, row) => sum + Number(row.allocatedFuel), 0), 7);
  assert.equal(result.allocationRows.reduce((sum, row) => sum + Number(row.allocatedTxCostSol), 0), 0.500003);
});
