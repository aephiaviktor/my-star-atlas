'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTelemetryLedger } = require('../electron/telemetry-ledger');
const { createSnapshotMarker, generateTelemetryReport } = require('../electron/telemetry-reporter');

async function temporary() { return fs.mkdtemp(path.join(os.tmpdir(), 'msa-report-')); }

async function marker(userDataPath, boundary, now) { return createSnapshotMarker({ userDataPath, boundary, now: () => now }); }

test('snapshot markers do not reset activity and report exact [T0,T1) across UTC dates', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T23:58:00Z');
  const ledger = createTelemetryLedger({ userDataPath, profile: 'USTUR', now: () => now, flushIntervalMs: 0 }); await ledger.start();
  const start = await marker(userDataPath, '2026-08-03T23:59:00.000Z', Date.parse('2026-08-03T23:59:00Z'));
  now = Date.parse('2026-08-03T23:59:30Z');
  ledger.record({ type: 'logical-start', at: now, context: { profile: 'USTUR', faction: 'MUD', feature: 'Fleet discovery', trigger: 'manual', rpcMethod: 'getProgramAccountsV2' } });
  ledger.record({ type: 'logical-complete', at: now + 10, outcome: 'success', durationMs: 10, context: { profile: 'USTUR', faction: 'MUD', feature: 'Fleet discovery', trigger: 'manual', rpcMethod: 'getProgramAccountsV2' } });
  now = Date.parse('2026-08-04T00:00:30Z');
  ledger.record({ type: 'wire-start', at: now, context: { profile: 'USTUR', faction: 'ONI', feature: 'Earnings', trigger: 'background', providerRole: 'main', rpcMethod: 'getAccountInfo' } });
  ledger.record({ type: 'wire-complete', at: now + 5, outcome: 'success', durationMs: 5, context: { profile: 'USTUR', faction: 'ONI', feature: 'Earnings', trigger: 'background', providerRole: 'main', rpcMethod: 'getAccountInfo' } });
  now = Date.parse('2026-08-04T00:01:00Z'); await ledger.flush();
  const beforeFiles = await fs.readdir(path.join(userDataPath, 'telemetry/rpc-activity-v1'));
  const end = await marker(userDataPath, '2026-08-04T00:01:00.000Z', now);
  const afterFiles = await fs.readdir(path.join(userDataPath, 'telemetry/rpc-activity-v1'));
  assert.deepEqual(afterFiles, beforeFiles);
  const report = await generateTelemetryReport({ userDataPath, startMarker: start.snapshotId, endMarker: end.snapshotId });
  assert.equal(report.start, '2026-08-03T23:59:00.000Z'); assert.equal(report.end, '2026-08-04T00:01:00.000Z');
  assert.equal(report.totals.logicalOperations, 1); assert.equal(report.totals.logicalCompletedOperations, 1);
  assert.equal(report.totals.wireAttempts, 1); assert.equal(report.totals.wireCompletedAttempts, 1);
  assert.equal(report.reconciliation.matchesBuckets, true);
  assert.equal(report.thresholdVerdict, report.completeEvidence ? 'not_evaluated' : 'forbidden_incomplete_evidence');
});

test('missing segment, dirty runtime gap and corrupt marker forbid a verdict', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T10:00:00Z');
  const ledger = createTelemetryLedger({ userDataPath, now: () => now, flushIntervalMs: 0 }); await ledger.start();
  const start = await marker(userDataPath, '2026-08-03T10:00:00.000Z', now);
  now += 120_000; await ledger.flush();
  const end = await marker(userDataPath, '2026-08-03T10:02:00.000Z', now);
  await fs.rm(path.join(userDataPath, 'telemetry/rpc-activity-v1/2026-08-03.json'));
  const report = await generateTelemetryReport({ userDataPath, startMarker: start.snapshotId, endMarker: end.snapshotId });
  assert.equal(report.completeEvidence, false); assert.equal(report.thresholdVerdict, 'forbidden_incomplete_evidence');
  assert.ok(report.incompleteReasons.includes('MISSING_OR_CORRUPT_SEGMENT'));
});

test('report generation is read-only for activity and snapshot files', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T10:00:00Z'); const ledger = createTelemetryLedger({ userDataPath, now: () => now, flushIntervalMs: 0 }); await ledger.start();
  const start = await marker(userDataPath, new Date(now).toISOString(), now); now += 60_000; await ledger.flush(); const end = await marker(userDataPath, new Date(now).toISOString(), now);
  const root = path.join(userDataPath, 'telemetry');
  async function digest() { const files = []; async function walk(dir) { for (const e of await fs.readdir(dir, { withFileTypes: true })) { const f=path.join(dir,e.name); if(e.isDirectory()) await walk(f); else files.push([path.relative(root,f), await fs.readFile(f,'utf8')]); } } await walk(root); return files.sort(); }
  const before = await digest(); await generateTelemetryReport({ userDataPath, startMarker: start.snapshotId, endMarker: end.snapshotId }); const after = await digest();
  assert.deepEqual(after, before);
});

test('exact-boundary race cannot become complete before coverage or after spanning work settles', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T12:00:20Z');
  const ledger = createTelemetryLedger({ userDataPath, now: () => now, flushIntervalMs: 0 }); await ledger.start();
  now = Date.parse('2026-08-03T12:00:55Z');
  ledger.record({ type: 'logical-start', at: now, context: { feature: 'Earnings', rpcMethod: 'getAccountInfo' } });
  ledger.record({ type: 'wire-start', at: now, context: { feature: 'Earnings', rpcMethod: 'getAccountInfo' } });
  now = Date.parse('2026-08-03T12:01:00Z');
  const early = await marker(userDataPath, '2026-08-03T12:01:00.000Z', now);
  assert.equal(early.completeEvidence, false); assert.ok(early.incompleteReasons.includes('COVERAGE_BEFORE_BOUNDARY'));
  now = Date.parse('2026-08-03T12:01:05Z');
  ledger.record({ type: 'logical-complete', at: now, outcome: 'success', context: { feature: 'Earnings', rpcMethod: 'getAccountInfo' } });
  ledger.record({ type: 'wire-complete', at: now, outcome: 'success', context: { feature: 'Earnings', rpcMethod: 'getAccountInfo' } });
  now = Date.parse('2026-08-03T12:01:20Z'); await ledger.flush();
  const later = await marker(userDataPath, '2026-08-03T12:01:00.000Z', now);
  assert.equal(later.openLogicalAtBoundary, 1); assert.equal(later.openWireAtBoundary, 1);
  assert.equal(later.completeEvidence, false);
  now = Date.parse('2026-08-03T12:02:20Z'); await ledger.flush();
  const end = await marker(userDataPath, '2026-08-03T12:02:00.000Z', now);
  const report = await generateTelemetryReport({ userDataPath, startMarker: later.snapshotId, endMarker: end.snapshotId });
  assert.equal(report.completeEvidence, false); assert.equal(report.thresholdVerdict, 'forbidden_incomplete_evidence');
});

test('historical balances distinguish work before, after, and spanning a boundary after one later flush', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T11:59:00Z'); const ledger = createTelemetryLedger({ userDataPath, now: () => now, flushIntervalMs: 0 }); await ledger.start();
  const context = { feature: 'Earnings', rpcMethod: 'getAccountInfo' };
  ledger.record({ type: 'logical-start', at: Date.parse('2026-08-03T12:00:10Z'), context });
  ledger.record({ type: 'logical-complete', at: Date.parse('2026-08-03T12:00:20Z'), outcome: 'success', context });
  ledger.record({ type: 'wire-start', at: Date.parse('2026-08-03T12:01:10Z'), context });
  ledger.record({ type: 'wire-complete', at: Date.parse('2026-08-03T12:01:20Z'), outcome: 'success', context });
  now = Date.parse('2026-08-03T12:02:00Z'); await ledger.flush();
  const atBoundary = await marker(userDataPath, '2026-08-03T12:01:00.000Z', now);
  assert.equal(atBoundary.openLogicalAtBoundary, 0); assert.equal(atBoundary.openWireAtBoundary, 0);
  assert.equal(atBoundary.completeEvidence, true);
});

test('unclean pre-boundary session remains visible across same-minute restart', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let firstNow = Date.parse('2026-08-03T12:00:20Z'); const first = createTelemetryLedger({ userDataPath, now: () => firstNow, flushIntervalMs: 0 }); await first.start();
  firstNow = Date.parse('2026-08-03T12:00:55Z'); first.record({ type: 'wire-start', at: firstNow, context: { rpcMethod: 'getAccountInfo' } });
  let secondNow = Date.parse('2026-08-03T12:00:58Z'); const second = createTelemetryLedger({ userDataPath, now: () => secondNow, flushIntervalMs: 0 }); await second.start();
  secondNow = Date.parse('2026-08-03T12:01:20Z'); await second.flush();
  const result = await marker(userDataPath, '2026-08-03T12:01:00.000Z', secondNow);
  assert.equal(result.completeEvidence, false);
  assert.ok(result.incompleteReasons.includes('UNCLEAN_SESSION_OVERLAP'));
});

test('forward post-boundary revisions are accepted but changed pre-boundary evidence and rollback are rejected', async (t) => {
  const userDataPath = await temporary(); t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  let now = Date.parse('2026-08-03T12:00:00Z'); const ledger = createTelemetryLedger({ userDataPath, now: () => now, flushIntervalMs: 0 }); await ledger.start();
  const start = await marker(userDataPath, '2026-08-03T12:00:00.000Z', now);
  now = Date.parse('2026-08-03T12:01:00Z'); await ledger.flush(); const end = await marker(userDataPath, '2026-08-03T12:01:00.000Z', now);
  ledger.record({ type: 'counter', counter: 'cacheHits', at: Date.parse('2026-08-03T12:02:00Z'), context: {} }); now = Date.parse('2026-08-03T12:02:20Z'); await ledger.flush();
  assert.equal((await generateTelemetryReport({ userDataPath, startMarker: start.snapshotId, endMarker: end.snapshotId })).completeEvidence, true);
  ledger.record({ type: 'counter', counter: 'cacheHits', at: Date.parse('2026-08-03T11:59:00Z'), context: {} }); await ledger.flush();
  const changed = await generateTelemetryReport({ userDataPath, startMarker: start.snapshotId, endMarker: end.snapshotId });
  assert.equal(changed.completeEvidence, false); assert.ok(changed.incompleteReasons.includes('BOUNDARY_EVIDENCE_CHANGED'));
  const dayPath = path.join(userDataPath, 'telemetry/rpc-activity-v1/2026-08-03.json'); const day = JSON.parse(await fs.readFile(dayPath)); day.revision = 0; await fs.writeFile(dayPath, JSON.stringify(day));
  const rollback = await generateTelemetryReport({ userDataPath, startMarker: start.snapshotId, endMarker: end.snapshotId });
  assert.ok(rollback.incompleteReasons.includes('REVISION_ROLLBACK'));
});
