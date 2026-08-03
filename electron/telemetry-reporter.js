'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { COUNTERS, SCHEMA_VERSION, boundaryIso, ensureInstallation, validDay, readJson, writeAtomicDurable, withSharedLock, pruneRetention } = require('./telemetry-ledger');

const INCOMPLETE_REASONS = Object.freeze([
  'MISSING_OR_CORRUPT_SEGMENT', 'COVERAGE_BEFORE_BOUNDARY', 'UNCLEAN_SESSION_OVERLAP',
  'CLOCK_REVERSAL', 'TELEMETRY_WRITE_FAILURE', 'NEGATIVE_LOGICAL_BALANCE',
  'NEGATIVE_WIRE_BALANCE', 'OPEN_LOGICAL_AT_BOUNDARY', 'OPEN_WIRE_AT_BOUNDARY',
  'INSTALLATION_MISMATCH', 'MARKER_INCOMPLETE', 'REVISION_ROLLBACK',
  'BOUNDARY_EVIDENCE_CHANGED', 'BUCKET_CUMULATIVE_MISMATCH',
  'LOGICAL_OUTCOME_MISMATCH', 'WIRE_OUTCOME_MISMATCH', 'UNOBSERVED_INTERVAL',
]);

function parseBoundary(value) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time) || time % 60_000 !== 0) throw new Error('boundary_must_be_exact_utc_minute');
  return time;
}
function zeroCounters() { return Object.fromEntries(COUNTERS.map((key) => [key, 0])); }
function addCounters(target, source) { for (const key of COUNTERS) target[key] = Math.min(Number.MAX_SAFE_INTEGER, target[key] + Number(source?.[key] || 0)); }
function dimensionKey(dimensions) { return [dimensions.profile, dimensions.faction, dimensions.feature, dimensions.suboperation, dimensions.trigger, dimensions.providerRole, dimensions.rpcMethod].join('\u001f'); }
function minuteIso(date, minute) { return `${date}T${minute}:00.000Z`; }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function evidenceDigest(evidence) { return crypto.createHash('sha256').update(canonical(evidence)).digest('hex'); }

async function loadAllDays(root, installationId, boundaryMs = Infinity) {
  const activityRoot = path.join(root, 'rpc-activity-v1');
  const entries = await fs.readdir(activityRoot, { withFileTypes: true }).catch(() => []);
  const days = []; const reasons = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) continue;
    const date = entry.name.slice(0, 10);
    if (Date.parse(`${date}T00:00:00.000Z`) >= boundaryMs + 86_400_000) continue;
    try {
      const day = await readJson(path.join(activityRoot, entry.name));
      if (!validDay(day, installationId, date)) throw new Error('invalid');
      days.push(day);
    } catch (_) { reasons.push('MISSING_OR_CORRUPT_SEGMENT'); }
  }
  return { days, reasons };
}

function aggregate(days, predicate) {
  const totals = zeroCounters(); const groups = new Map(); const minuteSet = new Set();
  for (const day of days) for (const [minute, bucket] of Object.entries(day.minutes || {})) {
    const at = Date.parse(minuteIso(day.utcDate, minute));
    if (!predicate(at)) continue;
    minuteSet.add(at);
    for (const row of bucket.rows || []) {
      addCounters(totals, row.counters);
      const key = dimensionKey(row.dimensions);
      const group = groups.get(key) || { dimensions: row.dimensions, counters: zeroCounters() };
      addCounters(group.counters, row.counters); groups.set(key, group);
    }
  }
  return { totals, groups: [...groups.values()].sort((a, b) => dimensionKey(a.dimensions).localeCompare(dimensionKey(b.dimensions))), observedActivityMinutes: minuteSet.size };
}
function aggregateWindow(days, startMs, endMs) { return aggregate(days, (at) => at >= startMs && at < endMs); }
function cumulativeBefore(days, boundaryMs) { return aggregate(days, (at) => at < boundaryMs); }

function uniqueSessions(days) {
  const sessions = new Map();
  for (const day of days) for (const session of day.runtime || []) {
    const prior = sessions.get(session.sessionId);
    if (!prior || Date.parse(session.progressAt) > Date.parse(prior.progressAt)) sessions.set(session.sessionId, session);
  }
  return [...sessions.values()];
}
function boundaryRuntimeEvidence(days, boundaryMs) {
  const reasons = []; let coveredThrough = null;
  const relevant = uniqueSessions(days).filter((session) => Date.parse(session.startedAt) <= boundaryMs);
  for (const session of relevant) {
    if (session.clockReversal) reasons.push('CLOCK_REVERSAL');
    if (Number(session.telemetryWriteFailures || 0) > 0) reasons.push('TELEMETRY_WRITE_FAILURE');
    const covered = Date.parse(session.coveredThrough);
    const cleanStop = session.cleanStopAt == null ? NaN : Date.parse(session.cleanStopAt);
    if (!coveredThrough || covered > Date.parse(coveredThrough)) coveredThrough = session.coveredThrough;
    if (!(Number.isFinite(cleanStop) && cleanStop <= boundaryMs) && covered < boundaryMs) {
      reasons.push('COVERAGE_BEFORE_BOUNDARY');
      if (session.cleanStopAt == null) reasons.push('UNCLEAN_SESSION_OVERLAP');
    }
  }
  if (!relevant.length || !relevant.some((session) => {
    const cleanStop = session.cleanStopAt == null ? NaN : Date.parse(session.cleanStopAt);
    return (Number.isFinite(cleanStop) && cleanStop <= boundaryMs) || Date.parse(session.coveredThrough) >= boundaryMs;
  })) reasons.push('COVERAGE_BEFORE_BOUNDARY');
  return { coveredThrough, reasons: [...new Set(reasons)] };
}
function boundaryEvidence(days, boundaryMs) {
  const cumulative = cumulativeBefore(days, boundaryMs);
  const openLogicalAtBoundary = cumulative.totals.logicalOperations - cumulative.totals.logicalCompletedOperations;
  const openWireAtBoundary = cumulative.totals.wireAttempts - cumulative.totals.wireCompletedAttempts;
  const reasons = [];
  if (openLogicalAtBoundary < 0) reasons.push('NEGATIVE_LOGICAL_BALANCE');
  else if (openLogicalAtBoundary > 0) reasons.push('OPEN_LOGICAL_AT_BOUNDARY');
  if (openWireAtBoundary < 0) reasons.push('NEGATIVE_WIRE_BALANCE');
  else if (openWireAtBoundary > 0) reasons.push('OPEN_WIRE_AT_BOUNDARY');
  return { cumulative: { totals: cumulative.totals, groups: cumulative.groups }, openLogicalAtBoundary, openWireAtBoundary, reasons };
}

async function createSnapshotMarker({ userDataPath, boundary = boundaryIso(), now = Date.now } = {}) {
  const root = path.join(userDataPath, 'telemetry'); const snapshotsRoot = path.join(root, 'snapshots-v1');
  const boundaryMs = parseBoundary(boundary); if (boundaryMs > now()) throw new Error('snapshot_boundary_in_future');
  const installation = await ensureInstallation(root, now);
  const loaded = await loadAllDays(root, installation.installationId, boundaryMs);
  const historical = boundaryEvidence(loaded.days, boundaryMs);
  const runtime = boundaryRuntimeEvidence(loaded.days, boundaryMs);
  const incompleteReasons = [...new Set([...loaded.reasons, ...historical.reasons, ...runtime.reasons])].filter((reason) => INCOMPLETE_REASONS.includes(reason)).sort();
  const evidence = { boundary, cumulative: historical.cumulative, runtime: { coveredThrough: runtime.coveredThrough }, openLogicalAtBoundary: historical.openLogicalAtBoundary, openWireAtBoundary: historical.openWireAtBoundary };
  const marker = {
    schemaVersion: SCHEMA_VERSION, snapshotId: `${boundary.replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(6).toString('hex')}`,
    installationId: installation.installationId, boundary, createdAt: new Date(now()).toISOString(),
    coveredThrough: runtime.coveredThrough, openLogicalAtBoundary: historical.openLogicalAtBoundary,
    openWireAtBoundary: historical.openWireAtBoundary, completeEvidence: incompleteReasons.length === 0,
    incompleteReasons, evidence, evidenceDigest: evidenceDigest(evidence),
    segmentRevisions: Object.fromEntries(loaded.days.map((day) => [day.utcDate, day.revision])),
  };
  await withSharedLock(root, async () => { await fs.mkdir(snapshotsRoot, { recursive: true }); await writeAtomicDurable(path.join(snapshotsRoot, `${marker.snapshotId}.json`), marker); });
  await pruneRetention({ root, activityRoot: path.join(root, 'rpc-activity-v1'), snapshotsRoot, now: now() });
  return marker;
}

async function readMarker(root, value) {
  const filePath = value.endsWith('.json') ? value : path.join(root, 'snapshots-v1', `${value}.json`);
  const marker = await readJson(filePath);
  if (marker?.schemaVersion !== SCHEMA_VERSION || !marker.snapshotId || !marker.boundary || !marker.evidence || marker.evidenceDigest !== evidenceDigest(marker.evidence)) throw new Error('snapshot_marker_invalid');
  return marker;
}
function subtractEvidence(end, start) {
  const totals = zeroCounters(); let negative = false;
  for (const key of COUNTERS) { totals[key] = Number(end.totals[key]) - Number(start.totals[key]); if (totals[key] < 0) negative = true; }
  const startGroups = new Map(start.groups.map((group) => [dimensionKey(group.dimensions), group]));
  const groups = [];
  for (const endGroup of end.groups) {
    const prior = startGroups.get(dimensionKey(endGroup.dimensions)); const counters = zeroCounters();
    for (const key of COUNTERS) { counters[key] = Number(endGroup.counters[key]) - Number(prior?.counters?.[key] || 0); if (counters[key] < 0) negative = true; }
    if (Object.values(counters).some(Boolean)) groups.push({ dimensions: endGroup.dimensions, counters });
    startGroups.delete(dimensionKey(endGroup.dimensions));
  }
  if (startGroups.size) negative = true;
  return { totals, groups, negative };
}

async function generateTelemetryReport({ userDataPath, startMarker, endMarker } = {}) {
  const root = path.join(userDataPath, 'telemetry');
  const [start, end] = await Promise.all([readMarker(root, startMarker), readMarker(root, endMarker)]);
  const startMs = parseBoundary(start.boundary); const endMs = parseBoundary(end.boundary); if (endMs <= startMs) throw new Error('report_window_invalid');
  const reasons = [];
  if (start.installationId !== end.installationId) reasons.push('INSTALLATION_MISMATCH');
  if (!start.completeEvidence || !end.completeEvidence) reasons.push('MARKER_INCOMPLETE');
  const loaded = await loadAllDays(root, start.installationId, endMs); reasons.push(...loaded.reasons);
  const loadedDates = new Set(loaded.days.map((day) => day.utcDate));
  for (const date of new Set([...Object.keys(start.segmentRevisions || {}), ...Object.keys(end.segmentRevisions || {})])) {
    if (!loadedDates.has(date)) reasons.push('MISSING_OR_CORRUPT_SEGMENT');
  }
  for (const day of loaded.days) {
    const baseline = Number(start.segmentRevisions?.[day.utcDate] || 0); const final = Number(end.segmentRevisions?.[day.utcDate] || day.revision);
    if (day.revision < baseline || final < baseline) reasons.push('REVISION_ROLLBACK');
  }
  for (const marker of [start, end]) {
    const recomputed = boundaryEvidence(loaded.days, parseBoundary(marker.boundary));
    const evidence = { boundary: marker.boundary, cumulative: recomputed.cumulative, runtime: marker.evidence.runtime, openLogicalAtBoundary: recomputed.openLogicalAtBoundary, openWireAtBoundary: recomputed.openWireAtBoundary };
    if (evidenceDigest(evidence) !== marker.evidenceDigest) reasons.push('BOUNDARY_EVIDENCE_CHANGED');
  }
  const immutable = subtractEvidence(end.evidence.cumulative, start.evidence.cumulative);
  const interval = aggregateWindow(loaded.days, startMs, endMs);
  if (immutable.negative || canonical({ totals: immutable.totals, groups: immutable.groups }) !== canonical({ totals: interval.totals, groups: interval.groups })) reasons.push('BUCKET_CUMULATIVE_MISMATCH');
  if (interval.totals.logicalCompletedOperations !== interval.totals.logicalSuccesses + interval.totals.logicalFailures) reasons.push('LOGICAL_OUTCOME_MISMATCH');
  if (interval.totals.wireCompletedAttempts !== interval.totals.wireTransportSuccesses + interval.totals.wireTransportFailures) reasons.push('WIRE_OUTCOME_MISMATCH');
  const incompleteReasons = [...new Set(reasons)].filter((reason) => INCOMPLETE_REASONS.includes(reason)).sort();
  const completeEvidence = incompleteReasons.length === 0;
  return { schemaVersion: SCHEMA_VERSION, installationId: start.installationId, start: start.boundary, end: end.boundary, durationMinutes: (endMs - startMs) / 60_000, completeEvidence, incompleteReasons, totals: interval.totals, groups: interval.groups, reconciliation: { immutableDifference: immutable.totals, matchesBuckets: !incompleteReasons.includes('BUCKET_CUMULATIVE_MISMATCH') }, thresholdVerdict: completeEvidence ? 'not_evaluated' : 'forbidden_incomplete_evidence' };
}

module.exports = { INCOMPLETE_REASONS, parseBoundary, aggregateWindow, cumulativeBefore, boundaryEvidence, boundaryRuntimeEvidence, evidenceDigest, createSnapshotMarker, generateTelemetryReport };
