'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const CACHE_SCHEMA_VERSION = 1;

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function normalizedSourceDescriptor(source = {}) {
  return {
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    faction: String(source.faction || '').trim().toUpperCase(),
    influxBucket: String(source.influxBucket || '').trim(),
    influxOrganization: String(source.influxOrganization || '').trim(),
    influxUrl: String(source.influxUrl || '').trim().replace(/\/$/, ''),
    profile: String(source.profile || '').trim(),
    projectionVersion: Number(source.projectionVersion),
    rpcUrl: String(source.rpcUrl || '').trim().replace(/\/$/, ''),
    scope: normalizeEarningsAggregateScope(source.scope),
  };
}

function normalizeEarningsAggregateScope(scope) {
  const normalized = String(scope || '').trim().toLowerCase();
  if (normalized === 'breakeven' || normalized === 'upgrading') return 'ledger-complete';
  return normalized || 'total';
}

function earningsAggregateReadScopes(scope) {
  const normalized = normalizeEarningsAggregateScope(scope);
  return normalized === 'ledger-complete' ? [normalized] : ['ledger-complete', normalized];
}

function buildEarningsAggregateCacheSourceKey(source = {}) {
  return crypto.createHash('sha256').update(stableSerialize(normalizedSourceDescriptor(source))).digest('hex');
}

function createEarningsAggregateSqliteCache({ filePath, source, now = Date.now } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('earnings_aggregate_cache_file_path_required');
  if (typeof now !== 'function') throw new TypeError('earnings_aggregate_cache_now_required');
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Best effort on filesystems without POSIX modes. */ }
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE IF NOT EXISTS earnings_daily_aggregates (
      source_key TEXT PRIMARY KEY,
      payload BLOB NOT NULL,
      digest TEXT NOT NULL,
      byte_count INTEGER NOT NULL,
      projected_at_ms INTEGER NOT NULL
    ) WITHOUT ROWID;
  `);

  const sourceKey = buildEarningsAggregateCacheSourceKey(source);
  const selectSnapshot = database.prepare(`
    SELECT payload, digest, byte_count, projected_at_ms
    FROM earnings_daily_aggregates
    WHERE source_key = ?
  `);
  const upsertSnapshot = database.prepare(`
    INSERT INTO earnings_daily_aggregates (source_key, payload, digest, byte_count, projected_at_ms)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      payload = excluded.payload,
      digest = excluded.digest,
      byte_count = excluded.byte_count,
      projected_at_ms = excluded.projected_at_ms
  `);
  const deleteSnapshot = database.prepare('DELETE FROM earnings_daily_aggregates WHERE source_key = ?');
  let closed = false;

  function requireOpen() {
    if (closed) throw new Error('earnings_aggregate_cache_closed');
  }

  function read() {
    requireOpen();
    const row = selectSnapshot.get(sourceKey);
    if (!row) return null;
    try {
      const json = zlib.gunzipSync(row.payload).toString('utf8');
      const digest = crypto.createHash('sha256').update(json).digest('hex');
      if (digest !== row.digest || Buffer.byteLength(json) !== Number(row.byte_count)) {
        deleteSnapshot.run(sourceKey);
        return null;
      }
      const snapshot = JSON.parse(json);
      if (!snapshot || snapshot.ok !== true) throw new Error('earnings_aggregate_invalid_snapshot');
      return {
        snapshot,
        digest,
        byteCount: Number(row.byte_count),
        projectedAtMs: Number(row.projected_at_ms),
      };
    } catch (_) {
      deleteSnapshot.run(sourceKey);
      return null;
    }
  }

  function write(snapshot) {
    requireOpen();
    if (!snapshot || snapshot.ok !== true) throw new TypeError('earnings_aggregate_successful_snapshot_required');
    const json = JSON.stringify(snapshot);
    const digest = crypto.createHash('sha256').update(json).digest('hex');
    const byteCount = Buffer.byteLength(json);
    const payload = zlib.gzipSync(Buffer.from(json), { level: zlib.constants.Z_BEST_SPEED });
    const projectedAtMs = Math.trunc(now());
    upsertSnapshot.run(sourceKey, payload, digest, byteCount, projectedAtMs);
    return { sourceKey, digest, byteCount, projectedAtMs };
  }

  function close() {
    if (closed) return;
    closed = true;
    database.close();
  }

  return { sourceKey, read, write, close };
}

module.exports = {
  EARNINGS_AGGREGATE_SQLITE_CACHE_SCHEMA_VERSION: CACHE_SCHEMA_VERSION,
  buildEarningsAggregateCacheSourceKey,
  createEarningsAggregateSqliteCache,
  earningsAggregateReadScopes,
  normalizeEarningsAggregateScope,
};
