'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const CACHE_SCHEMA_VERSION = 2;
const DEFAULT_MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const COLLECTION_COUNTS = Object.freeze([
  ['marketplaceRawData', 'marketplaceRawDataCount'],
  ['marketplaceEvents', 'marketplaceEventCount'],
  ['marketplaceTrades', 'marketplaceTradeCount'],
  ['marketplaceGlobalLedgerRows', 'marketplaceGlobalLedgerCount'],
]);
const MARKETPLACE_FACTIONS = Object.freeze(['MUD', 'ONI', 'USTUR']);
const ERROR_FIELDS = Object.freeze([
  'marketplaceRawDataError',
  'marketplaceRawDataCoverageError',
  'marketplaceEventsError',
  'marketplaceBreakevenBasisError',
  'marketplaceInventoryBasisError',
]);

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function normalizedSourceDescriptor(source = {}) {
  const profiles = source.profiles && typeof source.profiles === 'object' && !Array.isArray(source.profiles)
    ? source.profiles : {};
  const gmTradingWallets = (Array.isArray(source.gmTradingWallets)
    ? source.gmTradingWallets : String(source.gmTradingWallets || '').split(/[\s,;]+/))
    .map((value) => String(value || '').trim()).filter(Boolean).sort();
  return {
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    influxBucket: String(source.influxBucket || '').trim(),
    influxOrganization: String(source.influxOrganization || '').trim(),
    influxUrl: String(source.influxUrl || '').trim().replace(/\/$/, ''),
    gmTradingWallets,
    marketplaceHistoryCutoverIso: String(source.marketplaceHistoryCutoverIso || '').trim(),
    profiles: Object.fromEntries(MARKETPLACE_FACTIONS.map((faction) => [
      faction, String(profiles[faction] || '').trim(),
    ])),
    projectionVersion: Number(source.projectionVersion),
    scope: String(source.scope || 'marketplace-complete').trim().toLowerCase(),
  };
}

function buildMarketplaceViewCacheSourceKey(source = {}) {
  return crypto.createHash('sha256').update(stableSerialize(normalizedSourceDescriptor(source))).digest('hex');
}

function isCompleteMarketplaceViewSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.ok !== true) return false;
  const coverage = snapshot.marketplaceRawDataCoverage;
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)
    || !Array.isArray(coverage.sources)
    || !Number.isSafeInteger(coverage.total) || coverage.total < 0
    || !Number.isSafeInteger(coverage.complete) || coverage.complete < 0
    || !Number.isSafeInteger(coverage.pending) || coverage.pending < 0
    || coverage.complete !== coverage.total || coverage.pending !== 0) return false;
  if (typeof snapshot.checkedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.checkedAt))) return false;
  if (ERROR_FIELDS.some((field) => Boolean(snapshot[field]))) return false;
  if (!COLLECTION_COUNTS.every(([collectionField, countField]) => (
    Array.isArray(snapshot[collectionField])
    && Number.isSafeInteger(snapshot[countField])
    && snapshot[countField] >= 0
    && snapshot[countField] === snapshot[collectionField].length
  ))) return false;
  const rowsByFaction = snapshot.marketplaceGameLedgerRowsByFaction;
  const countsByFaction = snapshot.marketplaceGameLedgerCountsByFaction;
  if (!rowsByFaction || typeof rowsByFaction !== 'object' || Array.isArray(rowsByFaction)
    || !countsByFaction || typeof countsByFaction !== 'object' || Array.isArray(countsByFaction)) return false;
  return MARKETPLACE_FACTIONS.every((faction) => Array.isArray(rowsByFaction[faction])
    && Number.isSafeInteger(countsByFaction[faction]) && countsByFaction[faction] >= 0
    && countsByFaction[faction] === rowsByFaction[faction].length);
}

function createMarketplaceViewSqliteCache({
  filePath,
  source,
  now = Date.now,
  maxSnapshotBytes = DEFAULT_MAX_SNAPSHOT_BYTES,
} = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError('marketplace_view_cache_file_path_required');
  }
  if (typeof now !== 'function') throw new TypeError('marketplace_view_cache_now_required');
  if (!Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes <= 0) {
    throw new TypeError('marketplace_view_cache_max_snapshot_bytes_required');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Best effort on filesystems without POSIX modes. */ }
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS marketplace_materialized_views (
      source_key TEXT PRIMARY KEY,
      payload BLOB NOT NULL,
      digest TEXT NOT NULL,
      byte_count INTEGER NOT NULL,
      checked_at TEXT NOT NULL,
      materialized_at_ms INTEGER NOT NULL
    ) WITHOUT ROWID;
  `);

  const sourceKey = buildMarketplaceViewCacheSourceKey(source);
  const selectSnapshot = database.prepare(`
    SELECT payload, digest, byte_count, checked_at, materialized_at_ms
    FROM marketplace_materialized_views
    WHERE source_key = ?
  `);
  const upsertSnapshot = database.prepare(`
    INSERT INTO marketplace_materialized_views (
      source_key, payload, digest, byte_count, checked_at, materialized_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      payload = excluded.payload,
      digest = excluded.digest,
      byte_count = excluded.byte_count,
      checked_at = excluded.checked_at,
      materialized_at_ms = excluded.materialized_at_ms
  `);
  const deleteSnapshot = database.prepare('DELETE FROM marketplace_materialized_views WHERE source_key = ?');
  let closed = false;

  function requireOpen() {
    if (closed) throw new Error('marketplace_view_cache_closed');
  }

  function read() {
    requireOpen();
    const row = selectSnapshot.get(sourceKey);
    if (!row) return null;
    try {
      const json = zlib.gunzipSync(row.payload).toString('utf8');
      const byteCount = Buffer.byteLength(json);
      const digest = crypto.createHash('sha256').update(json).digest('hex');
      if (byteCount !== Number(row.byte_count) || digest !== row.digest) throw new Error('integrity');
      const snapshot = JSON.parse(json);
      if (!isCompleteMarketplaceViewSnapshot(snapshot) || snapshot.checkedAt !== row.checked_at) {
        throw new Error('invalid_snapshot');
      }
      return {
        snapshot,
        digest,
        byteCount,
        checkedAt: row.checked_at,
        materializedAtMs: Number(row.materialized_at_ms),
      };
    } catch (_) {
      deleteSnapshot.run(sourceKey);
      return null;
    }
  }

  function write(snapshot) {
    requireOpen();
    if (!isCompleteMarketplaceViewSnapshot(snapshot)) {
      throw new TypeError('marketplace_view_cache_complete_snapshot_required');
    }
    let json;
    let plain;
    try {
      json = JSON.stringify(snapshot);
      plain = JSON.parse(json);
    } catch (_) {
      throw new TypeError('marketplace_view_cache_snapshot_not_serializable');
    }
    if (!isCompleteMarketplaceViewSnapshot(plain)) {
      throw new TypeError('marketplace_view_cache_complete_snapshot_required');
    }
    const byteCount = Buffer.byteLength(json);
    if (byteCount > maxSnapshotBytes) throw new TypeError('marketplace_view_cache_snapshot_too_large');
    const digest = crypto.createHash('sha256').update(json).digest('hex');
    const payload = zlib.gzipSync(Buffer.from(json), { level: zlib.constants.Z_BEST_SPEED });
    const materializedAtMs = Math.trunc(now());
    upsertSnapshot.run(sourceKey, payload, digest, byteCount, plain.checkedAt, materializedAtMs);
    return { sourceKey, digest, byteCount, materializedAtMs };
  }

  function close() {
    if (closed) return;
    closed = true;
    database.close();
  }

  return { sourceKey, read, write, close };
}

module.exports = {
  MARKETPLACE_VIEW_SQLITE_CACHE_SCHEMA_VERSION: CACHE_SCHEMA_VERSION,
  MARKETPLACE_VIEW_SQLITE_CACHE_MAX_SNAPSHOT_BYTES: DEFAULT_MAX_SNAPSHOT_BYTES,
  buildMarketplaceViewCacheSourceKey,
  createMarketplaceViewSqliteCache,
  isCompleteMarketplaceViewSnapshot,
};
