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
    cutoverManifestVersion: Number(source.cutoverManifestVersion),
    faction: String(source.faction || '').trim().toUpperCase(),
    influxBucket: String(source.influxBucket || '').trim(),
    influxOrganization: String(source.influxOrganization || '').trim(),
    influxUrl: String(source.influxUrl || '').trim().replace(/\/$/, ''),
    projectorVersion: Number(source.projectorVersion),
    scopes: source.scopes || [],
    sourceSchemaVersion: String(source.sourceSchemaVersion || '').trim(),
  };
}

function buildRawCostCacheSourceKey(source = {}) {
  return crypto.createHash('sha256').update(stableSerialize(normalizedSourceDescriptor(source))).digest('hex');
}

function normalizeWindow(window) {
  const startMs = Date.parse(String(window?.start || ''));
  const stopMs = Date.parse(String(window?.stop || ''));
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs) || startMs >= stopMs) {
    throw new TypeError('raw_cost_invalid_cache_window');
  }
  return {
    start: new Date(startMs).toISOString(),
    stop: new Date(stopMs).toISOString(),
    startMs,
    stopMs,
  };
}

function createRawCostSqliteCache({ filePath, source, now = Date.now } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('raw_cost_cache_file_path_required');
  if (typeof now !== 'function') throw new TypeError('raw_cost_cache_now_required');
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Best effort on filesystems without POSIX modes. */ }
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE IF NOT EXISTS raw_cost_shards (
      source_key TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      stop_ms INTEGER NOT NULL,
      payload BLOB NOT NULL,
      digest TEXT NOT NULL,
      byte_count INTEGER NOT NULL,
      completed_at_ms INTEGER NOT NULL,
      PRIMARY KEY (source_key, start_ms, stop_ms)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS raw_cost_shards_stop
      ON raw_cost_shards(source_key, stop_ms);
  `);

  const sourceKey = buildRawCostCacheSourceKey(source);
  const selectShard = database.prepare(`
    SELECT payload, digest, byte_count, completed_at_ms
    FROM raw_cost_shards
    WHERE source_key = ? AND start_ms = ? AND stop_ms = ?
  `);
  const upsertShard = database.prepare(`
    INSERT INTO raw_cost_shards (
      source_key, start_ms, stop_ms, payload, digest, byte_count, completed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key, start_ms, stop_ms) DO UPDATE SET
      payload = excluded.payload,
      digest = excluded.digest,
      byte_count = excluded.byte_count,
      completed_at_ms = excluded.completed_at_ms
  `);
  const deleteShard = database.prepare(`
    DELETE FROM raw_cost_shards
    WHERE source_key = ? AND start_ms = ? AND stop_ms = ?
  `);
  const pruneShards = database.prepare(`
    DELETE FROM raw_cost_shards
    WHERE source_key = ? AND stop_ms <= ?
  `);
  let closed = false;

  function requireOpen() {
    if (closed) throw new Error('raw_cost_cache_closed');
  }

  function read(window) {
    requireOpen();
    const normalized = normalizeWindow(window);
    const row = selectShard.get(sourceKey, normalized.startMs, normalized.stopMs);
    if (!row) return null;
    try {
      const csv = zlib.gunzipSync(row.payload).toString('utf8');
      const digest = crypto.createHash('sha256').update(csv).digest('hex');
      if (digest !== row.digest || Buffer.byteLength(csv) !== Number(row.byte_count)) {
        deleteShard.run(sourceKey, normalized.startMs, normalized.stopMs);
        return null;
      }
      return {
        start: normalized.start,
        stop: normalized.stop,
        csv,
        digest,
        byteCount: Number(row.byte_count),
        completedAtMs: Number(row.completed_at_ms),
      };
    } catch (_) {
      deleteShard.run(sourceKey, normalized.startMs, normalized.stopMs);
      return null;
    }
  }

  function write(window, csv) {
    requireOpen();
    const normalized = normalizeWindow(window);
    if (typeof csv !== 'string') throw new TypeError('raw_cost_cache_csv_required');
    const digest = crypto.createHash('sha256').update(csv).digest('hex');
    const byteCount = Buffer.byteLength(csv);
    const payload = zlib.gzipSync(Buffer.from(csv), { level: zlib.constants.Z_BEST_SPEED });
    upsertShard.run(sourceKey, normalized.startMs, normalized.stopMs, payload, digest, byteCount, Math.trunc(now()));
    return { ...normalized, digest, byteCount };
  }

  function pruneBefore(cutoff) {
    requireOpen();
    const cutoffMs = Date.parse(String(cutoff || ''));
    if (!Number.isFinite(cutoffMs)) throw new TypeError('raw_cost_invalid_cache_cutoff');
    return Number(pruneShards.run(sourceKey, cutoffMs).changes || 0);
  }

  function close() {
    if (closed) return;
    closed = true;
    database.close();
  }

  return { sourceKey, read, write, pruneBefore, close };
}

module.exports = {
  RAW_COST_SQLITE_CACHE_SCHEMA_VERSION: CACHE_SCHEMA_VERSION,
  buildRawCostCacheSourceKey,
  createRawCostSqliteCache,
};
