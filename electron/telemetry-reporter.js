'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { COUNTERS, SCHEMA_VERSION, boundaryIso, ensureInstallation, validDay, readJson, writeAtomicDurable, withSharedLock, pruneRetention } = require('./telemetry-ledger');

function parseBoundary(value) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time) || time % 60_000 !== 0) throw new Error('boundary_must_be_exact_utc_minute');
  return time;
}
function dateRange(startMs, endMs) {
  const dates = [];
  let cursor = new Date(startMs); cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() < endMs) { dates.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return dates;
}
function zeroCounters() { return Object.fromEntries(COUNTERS.map((key) => [key, 0])); }
function addCounters(target, source) { for (const key of COUNTERS) target[key] = Math.min(Number.MAX_SAFE_INTEGER, target[key] + Number(source?.[key] || 0)); }
function groupKey(dimensions) { return [dimensions.profile, dimensions.faction, dimensions.feature, dimensions.rpcMethod, dimensions.providerRole, dimensions.trigger].join('\u001f'); }
function minuteIso(date, minute) { return `${date}T${minute}:00.000Z`; }

async function loadDays(root, installationId, startMs, endMs) {
  const activityRoot = path.join(root, 'rpc-activity-v1');
  const days = [];
  const issues = [];
  for (const date of dateRange(startMs, endMs)) {
    const filePath = path.join(activityRoot, `${date}.json`);
    try {
      const day = await readJson(filePath);
      if (!validDay(day, installationId, date)) throw new Error('invalid_schema_or_installation');
      days.push(day);
    } catch (error) { issues.push(`missing_or_corrupt_segment:${date}`); }
  }
  return { days, issues };
}

function aggregateWindow(days, startMs, endMs) {
  const totals = zeroCounters(); const groups = new Map(); const minuteSet = new Set();
  for (const day of days) for (const [minute, bucket] of Object.entries(day.minutes || {})) {
    const at = Date.parse(minuteIso(day.utcDate, minute));
    if (!(at >= startMs && at < endMs)) continue;
    minuteSet.add(at);
    for (const row of bucket.rows || []) {
      addCounters(totals, row.counters);
      const key = groupKey(row.dimensions); const group = groups.get(key) || { dimensions: row.dimensions, counters: zeroCounters() };
      addCounters(group.counters, row.counters); groups.set(key, group);
    }
  }
  return { totals, groups: Array.from(groups.values()).sort((a, b) => groupKey(a.dimensions).localeCompare(groupKey(b.dimensions))), observedActivityMinutes: minuteSet.size };
}

function cumulativeBefore(days, boundaryMs) {
  const totals = zeroCounters();
  for (const day of days) for (const [minute, bucket] of Object.entries(day.minutes || {})) {
    if (Date.parse(minuteIso(day.utcDate, minute)) >= boundaryMs) continue;
    for (const row of bucket.rows || []) addCounters(totals, row.counters);
  }
  return totals;
}

function runtimeEvidence(days, startMs, endMs) {
  const issues = []; const covered = new Set(); let stoppedMinutes = 0;
  for (const day of days) for (const session of day.runtime || []) {
    if (session.clockReversal) issues.push(`clock_reversal:${session.sessionId}`);
    const start = Math.max(startMs, Math.ceil(Date.parse(session.startedAt) / 60_000) * 60_000);
    const progress = Math.min(endMs, Math.floor(Date.parse(session.progressAt) / 60_000) * 60_000);
    for (let at = start; at < progress; at += 60_000) covered.add(at);
  }
  const expected = Math.max(0, (endMs - startMs) / 60_000);
  stoppedMinutes = Math.max(0, expected - covered.size);
  if (stoppedMinutes) issues.push(`unobserved_or_stopped_minutes:${stoppedMinutes}`);
  return { coveredMinutes: covered.size, unobservedOrStoppedMinutes: stoppedMinutes, issues };
}

async function createSnapshotMarker({ userDataPath, boundary = boundaryIso(), now = Date.now } = {}) {
  const root = path.join(userDataPath, 'telemetry'); const snapshotsRoot = path.join(root, 'snapshots-v1');
  const boundaryMs = parseBoundary(boundary); if (boundaryMs > now()) throw new Error('snapshot_boundary_in_future');
  const installation = await ensureInstallation(root, now);
  const { days, issues } = await loadDays(root, installation.installationId, boundaryMs - 60_000, boundaryMs + 60_000);
  const runtimeRows = days.flatMap((day) => day.runtime || []);
  const relevantRuntime = runtimeRows.filter((entry) => Date.parse(entry.startedAt) <= boundaryMs);
  const unresolved = relevantRuntime.reduce((sum, entry) => sum
    + Number(entry.openLogicalOperations || 0) + Number(entry.openWireAttempts || 0), 0);
  const dirtyRuntime = relevantRuntime.filter((entry) => !entry.cleanStopAt && Date.parse(entry.progressAt) < boundaryMs - 60_000).length;
  const clockReversal = relevantRuntime.some((entry) => entry.clockReversal);
  const telemetryWriteFailures = relevantRuntime.reduce((sum, entry) => sum + Number(entry.telemetryWriteFailures || 0), 0);
  const completenessIssues = [
    ...issues,
    ...(dirtyRuntime ? ['dirty_or_unobserved_runtime_gap'] : []),
    ...(clockReversal ? ['clock_reversal'] : []),
    ...(telemetryWriteFailures ? ['telemetry_write_failure'] : []),
  ];
  const marker = {
    schemaVersion: SCHEMA_VERSION, snapshotId: `${boundary.replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(6).toString('hex')}`,
    installationId: installation.installationId, boundary, createdAt: new Date(now()).toISOString(),
    completeness: {
      issues: completenessIssues, unresolvedAtBoundary: unresolved, dirtyRuntime,
      clockReversal, telemetryWriteFailures,
      complete: completenessIssues.length === 0 && unresolved === 0,
    },
    segmentRevisions: Object.fromEntries(days.map((day) => [day.utcDate, day.revision])),
  };
  await withSharedLock(root, async () => { await fs.mkdir(snapshotsRoot, { recursive: true }); await writeAtomicDurable(path.join(snapshotsRoot, `${marker.snapshotId}.json`), marker); });
  await pruneRetention({ root, activityRoot: path.join(root, 'rpc-activity-v1'), snapshotsRoot, now: now() });
  return marker;
}

async function readMarker(root, value) {
  const filePath = value.endsWith('.json') ? value : path.join(root, 'snapshots-v1', `${value}.json`);
  const marker = await readJson(filePath);
  if (marker?.schemaVersion !== SCHEMA_VERSION || !marker.snapshotId || !marker.boundary) throw new Error('snapshot_marker_invalid');
  return marker;
}

async function generateTelemetryReport({ userDataPath, startMarker, endMarker } = {}) {
  const root = path.join(userDataPath, 'telemetry');
  const [start, end] = await Promise.all([readMarker(root, startMarker), readMarker(root, endMarker)]);
  const startMs = parseBoundary(start.boundary); const endMs = parseBoundary(end.boundary);
  if (endMs <= startMs) throw new Error('report_window_invalid');
  const issues = [];
  if (start.installationId !== end.installationId) issues.push('installation_mismatch');
  if (!start.completeness?.complete) issues.push(...(start.completeness?.issues || ['start_marker_incomplete']));
  if (!end.completeness?.complete) issues.push(...(end.completeness?.issues || ['end_marker_incomplete']));
  const loaded = await loadDays(root, start.installationId, startMs, endMs); issues.push(...loaded.issues);
  for (const day of loaded.days) {
    const baselineRevision = Number(start.segmentRevisions?.[day.utcDate] || 0);
    const finalRevision = Number(end.segmentRevisions?.[day.utcDate] || day.revision);
    if (day.revision < baselineRevision || finalRevision < baselineRevision) issues.push(`revision_rollback:${day.utcDate}`);
  }
  const interval = aggregateWindow(loaded.days, startMs, endMs);
  const beforeStart = cumulativeBefore(loaded.days, startMs); const beforeEnd = cumulativeBefore(loaded.days, endMs);
  const difference = zeroCounters(); for (const key of COUNTERS) difference[key] = Math.max(0, beforeEnd[key] - beforeStart[key]);
  if (JSON.stringify(difference) !== JSON.stringify(interval.totals)) issues.push('bucket_cumulative_reconciliation_failed');
  if (interval.totals.logicalCompletedOperations !== interval.totals.logicalSuccesses + interval.totals.logicalFailures) issues.push('logical_outcome_reconciliation_failed');
  if (interval.totals.wireCompletedAttempts !== interval.totals.wireTransportSuccesses + interval.totals.wireTransportFailures) issues.push('wire_outcome_reconciliation_failed');
  if (interval.totals.telemetryWriteFailures > 0) issues.push('telemetry_write_failure');
  const runtime = runtimeEvidence(loaded.days, startMs, endMs); issues.push(...runtime.issues);
  const completeEvidence = issues.length === 0;
  return {
    schemaVersion: SCHEMA_VERSION, installationId: start.installationId, start: start.boundary, end: end.boundary,
    durationMinutes: (endMs - startMs) / 60_000, completeEvidence, issues: Array.from(new Set(issues)).sort(), runtimeCoverage: runtime,
    totals: interval.totals, groups: interval.groups, reconciliation: { cumulativeDifference: difference, matchesBuckets: JSON.stringify(difference) === JSON.stringify(interval.totals) },
    thresholdVerdict: completeEvidence ? 'not_evaluated' : 'forbidden_incomplete_evidence',
  };
}

module.exports = { parseBoundary, dateRange, aggregateWindow, cumulativeBefore, runtimeEvidence, createSnapshotMarker, generateTelemetryReport };
