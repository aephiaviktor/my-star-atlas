'use strict';

const { pathsFor, saveOpeningInventoryCheckpoint } = require('./opening-inventory-checkpoint');

const UTC_DAY = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function utc(value, code) {
  if (typeof value !== 'string' || !UTC_DAY.test(value) || new Date(value).toISOString() !== value) throw new Error(code);
  return value;
}
function selectNextUtcBoundary(now = new Date()) {
  const ms = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(ms)) throw new Error('invalid_now');
  const date = new Date(ms);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}
function openingInventoryFlux({ bucket, boundary }) {
  utc(boundary, 'invalid_boundary');
  if (typeof bucket !== 'string' || !bucket || /["\r\n]/.test(bucket)) throw new Error('invalid_bucket');
  return `from(bucket: "${bucket}")\n  |> range(start: -30d, stop: time(v: "${boundary}"))\n  |> filter(fn: (r) => r._measurement == "starbase" and r._field == "curAmount")\n  |> filter(fn: (r) => exists r.rss and exists r.starbase)\n  |> group(columns: ["rss", "starbase"])\n  |> last()\n  |> keep(columns: ["rss", "starbase", "_value", "_time"])`;
}
function canonicalQuantity(raw) {
  if (typeof raw !== 'string' || raw !== raw.trim() || !DECIMAL.test(raw)) throw new Error('malformed_quantity');
  const [whole, fraction = ''] = raw.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const result = trimmed ? `${whole}.${trimmed}` : whole;
  if (result === '0') throw new Error('non_positive_quantity');
  return result;
}
function adaptInventoryObservations({ rows, faction, playerProfile, boundary, expectedIdentities, freshness }) {
  utc(boundary, 'invalid_boundary');
  if (!faction || !playerProfile) return { status: 'unavailable', reason: 'missing-scope' };
  if (!freshness || freshness.status !== 'proven' || !Number.isInteger(freshness.maxAgeMs) || freshness.maxAgeMs < 0) return { status: 'unavailable', reason: 'freshness-unproven' };
  if (!Array.isArray(rows)) return { status: 'unavailable', reason: 'query-failed' };
  if (!Array.isArray(expectedIdentities)) return { status: 'unavailable', reason: 'completeness-unproven' };
  try {
    const boundaryMs = Date.parse(boundary);
    const expected = new Set(expectedIdentities);
    const found = new Set();
    const adapted = rows.map((row) => {
      const location = String(row.starbase || '').trim();
      const asset = String(row.rss || '').trim();
      const observedAt = String(row._time || '');
      const observedMs = Date.parse(observedAt);
      const key = `${location}\n${asset}`;
      if (!location || !asset || !expected.has(key) || found.has(key)) throw new Error('partial-or-unknown-identity');
      if (!Number.isFinite(observedMs) || observedAt !== new Date(observedMs).toISOString() || observedMs >= boundaryMs) throw new Error('invalid-observation-time');
      if (boundaryMs - observedMs > freshness.maxAgeMs) throw new Error('stale-observation');
      found.add(key);
      return { location, asset, quantity: canonicalQuantity(row._value), observedAt };
    });
    if (found.size !== expected.size) return { status: 'unavailable', reason: 'partial-results' };
    adapted.sort((a,b) => a.location.localeCompare(b.location) || a.asset.localeCompare(b.asset));
    return { status: 'complete', faction, playerProfile, boundary, rows: adapted };
  } catch (error) { return { status: 'unavailable', reason: String(error.message || error) }; }
}
function filterForwardEvents(events, boundary) {
  utc(boundary, 'invalid_boundary');
  const t = Date.parse(boundary);
  return (events || []).filter((event) => Number.isFinite(Date.parse(event.timestamp)) && Date.parse(event.timestamp) >= t);
}
function classifyLedgerBinding(document, scope) {
  if (!document || document.schemaVersion === 1) return { status: 'legacy-unbound' };
  if (document.schemaVersion !== 2) return { status: 'unavailable', reason: 'unsupported-schema' };
  const required = ['openingCheckpointHash','forwardEventBoundary','faction','playerProfile'];
  if (required.some((key) => typeof document[key] !== 'string' || !document[key])) return { status: 'unavailable', reason: 'binding-incomplete' };
  if (document.openingCheckpointHash !== scope.openingCheckpointHash) return { status: 'rebuild-required', reason: 'opening-hash-mismatch' };
  if (document.forwardEventBoundary !== scope.forwardEventBoundary) return { status: 'rebuild-required', reason: 'boundary-mismatch' };
  if (document.faction !== scope.faction || document.playerProfile !== scope.playerProfile) return { status: 'rebuild-required', reason: 'scope-mismatch' };
  return { status: 'compatible' };
}
function pendingBootstrap({ now = new Date(), faction, playerProfile } = {}) {
  return { status: 'pending', mode: 'shadow', faction, playerProfile, boundary: selectNextUtcBoundary(now) };
}
async function runShadowBootstrap({ enabled = false, pending, now = new Date(), observations, expectedIdentities, freshness, checkpointRoot, checkpointOptions } = {}) {
  if (!enabled) return { status: 'disabled', mode: 'shadow' };
  if (!pending || pending.status !== 'pending') return { status: 'unavailable', reason: 'missing-pending-bootstrap' };
  const boundary = utc(pending.boundary, 'invalid_boundary');
  if (new Date(now).getTime() < Date.parse(boundary)) return pending;
  const adapted = adaptInventoryObservations({ rows: observations, faction: pending.faction, playerProfile: pending.playerProfile, boundary, expectedIdentities, freshness });
  if (adapted.status !== 'complete') return adapted;
  const sourceTimestamp = adapted.rows.reduce((latest, row) => row.observedAt > latest ? row.observedAt : latest, '');
  const input = { root: checkpointRoot, faction: pending.faction, playerProfile: pending.playerProfile, sourceTimestamp, rows: adapted.rows.map(({location,asset,quantity}) => ({location,asset,quantity})) };
  const checkpoint = await saveOpeningInventoryCheckpoint(input, checkpointOptions);
  if (!['created','loaded'].includes(checkpoint.status)) return { status: 'unavailable', reason: checkpoint.status };
  checkpoint.path = pathsFor(checkpointRoot, pending.faction, pending.playerProfile).document;
  return { status: 'ready', mode: 'shadow', boundary, checkpoint, forwardFilter: { field: 'timestamp', operator: '>=', value: boundary } };
}

module.exports = { selectNextUtcBoundary, openingInventoryFlux, canonicalQuantity, adaptInventoryObservations, filterForwardEvents, classifyLedgerBinding, pendingBootstrap, runShadowBootstrap };
