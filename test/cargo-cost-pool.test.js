const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCargoCostPool, mergeCargoCostPools } = require('../electron/cargo-cost-pool');

const rental = { kind: 'rental', daily: true, contractId: 'contract-1', amount: 12, currency: 'ATLAS', timestamp: '2026-08-04T00:00:00Z' };
const tx = (signature, instructionIndex = 0) => ({ kind: 'transaction', transactionSignature: signature, instructionIndex, amount: 0.01, currency: 'SOL', timestamp: '2026-08-04T10:00:00Z' });

test('one fleet with multiple assignments references one fleet-day cost', () => {
  const result = buildCargoCostPool([
    { fleetAccount: 'fleet-1', isoDate: '2026-08-04', assignment: 'A', costSources: [rental] },
    { fleetAccount: 'fleet-1', isoDate: '2026-08-04', assignment: 'B', costSources: [rental] },
  ]);
  assert.equal(result.costs.length, 1);
  assert.equal(result.references.length, 2);
});

test('repeated resource rows reference rather than duplicate a shared cost', () => {
  const result = buildCargoCostPool([
    { fleetAccount: 'fleet-1', isoDate: '2026-08-04', resourceMint: 'food', costSources: [tx('sig-1')] },
    { fleetAccount: 'fleet-1', isoDate: '2026-08-04', resourceMint: 'fuel', costSources: [tx('sig-1')] },
  ]);
  assert.equal(result.costs.length, 1);
  assert.equal(result.references.length, 2);
});

test('same fleet on two UTC days creates one cost per day', () => {
  const result = buildCargoCostPool([
    { fleetAccount: 'fleet-1', isoDate: '2026-08-03', costSources: [{ ...rental, timestamp: '2026-08-03T00:00:00Z' }] },
    { fleetAccount: 'fleet-1', isoDate: '2026-08-04', costSources: [rental] },
  ]);
  assert.equal(result.costs.length, 2);
});

test('separate legitimate source costs remain separate despite equal amount and timestamp', () => {
  const first = tx('sig-1', 0);
  const second = { ...tx('sig-1', 1), timestamp: first.timestamp };
  const result = buildCargoCostPool([{ fleetAccount: 'fleet-1', isoDate: '2026-08-04', costSources: [first, second] }]);
  assert.equal(result.costs.length, 2);
});

test('incremental replay equals full rebuild and repeated processing is idempotent', () => {
  const rows = [
    { fleetAccount: 'fleet-1', isoDate: '2026-08-04', costSources: [rental] },
    { fleetAccount: 'fleet-1', isoDate: '2026-08-04', costSources: [tx('sig-1')] },
  ];
  const full = buildCargoCostPool(rows);
  const incremental = mergeCargoCostPools(buildCargoCostPool(rows.slice(0, 1)), buildCargoCostPool(rows));
  assert.deepEqual(incremental.costs, full.costs);
  assert.deepEqual(mergeCargoCostPools(full, full).costs, full.costs);
});

test('ambiguous source identity is pending rather than guessed', () => {
  const result = buildCargoCostPool([{ fleetAccount: 'fleet-1', isoDate: '2026-08-04', costSources: [
    { kind: 'priority', amount: 1, currency: 'ATLAS', timestamp: '2026-08-04T10:00:00Z' },
    { kind: 'rental', daily: true, amount: 12, currency: 'ATLAS', timestamp: '2026-08-04T00:00:00Z' },
  ] }]);
  assert.equal(result.costs.length, 0);
  assert.equal(result.pending.length, 2);
  assert.ok(result.pending.every((entry) => entry.reason === 'ambiguous_source_identity'));
});

test('conflicting replay of one source identity is needs-review rather than silently replaced', () => {
  const result = buildCargoCostPool([{ fleetAccount: 'fleet-1', isoDate: '2026-08-04', costSources: [
    tx('sig-1'), { ...tx('sig-1'), amount: 0.02 },
  ] }]);
  assert.equal(result.costs.length, 1);
  assert.equal(result.pending[0].reason, 'conflicting_source_replay');
});
