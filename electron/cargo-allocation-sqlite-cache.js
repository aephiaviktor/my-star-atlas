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
    playerProfile: String(source.playerProfile || '').trim(),
    projectionVersion: Number(source.projectionVersion),
    sourceSchemaVersion: String(source.sourceSchemaVersion || '').trim(),
  };
}

function buildCargoAllocationCacheSourceKey(source = {}) {
  return crypto.createHash('sha256').update(stableSerialize(normalizedSourceDescriptor(source))).digest('hex');
}

function normalizeDay(value) {
  const day = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) !== day) {
    throw new TypeError('cargo_allocation_cache_invalid_day');
  }
  return day;
}

function createCargoAllocationSqliteCache({ filePath, source, now = Date.now } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('cargo_allocation_cache_file_path_required');
  if (typeof now !== 'function') throw new TypeError('cargo_allocation_cache_now_required');
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Best effort on filesystems without POSIX modes. */ }
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE IF NOT EXISTS cargo_allocation_days (
      source_key TEXT NOT NULL,
      iso_date TEXT NOT NULL,
      payload BLOB NOT NULL,
      digest TEXT NOT NULL,
      byte_count INTEGER NOT NULL,
      completed_at_ms INTEGER NOT NULL,
      PRIMARY KEY (source_key, iso_date)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS cargo_allocation_days_date
      ON cargo_allocation_days(source_key, iso_date);
  `);

  const sourceKey = buildCargoAllocationCacheSourceKey(source);
  const selectDay = database.prepare(`
    SELECT payload, digest, byte_count, completed_at_ms
    FROM cargo_allocation_days
    WHERE source_key = ? AND iso_date = ?
  `);
  const upsertDay = database.prepare(`
    INSERT INTO cargo_allocation_days (
      source_key, iso_date, payload, digest, byte_count, completed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key, iso_date) DO UPDATE SET
      payload = excluded.payload,
      digest = excluded.digest,
      byte_count = excluded.byte_count,
      completed_at_ms = excluded.completed_at_ms
  `);
  const deleteDay = database.prepare(`DELETE FROM cargo_allocation_days WHERE source_key = ? AND iso_date = ?`);
  const pruneDays = database.prepare(`DELETE FROM cargo_allocation_days WHERE source_key = ? AND iso_date < ?`);
  let closed = false;

  function requireOpen() {
    if (closed) throw new Error('cargo_allocation_cache_closed');
  }

  function readDay(value) {
    requireOpen();
    const isoDate = normalizeDay(value);
    const row = selectDay.get(sourceKey, isoDate);
    if (!row) return null;
    try {
      const json = zlib.gunzipSync(row.payload).toString('utf8');
      const digest = crypto.createHash('sha256').update(json).digest('hex');
      if (digest !== row.digest || Buffer.byteLength(json) !== Number(row.byte_count)) throw new Error('integrity');
      const rows = JSON.parse(json);
      if (!Array.isArray(rows) || rows.some((entry) => String(entry?.isoDate || '') !== isoDate)) throw new Error('invalid_rows');
      return { isoDate, rows, digest, byteCount: Number(row.byte_count), completedAtMs: Number(row.completed_at_ms) };
    } catch (_) {
      deleteDay.run(sourceKey, isoDate);
      return null;
    }
  }

  function writeDay(value, rows) {
    requireOpen();
    const isoDate = normalizeDay(value);
    if (!Array.isArray(rows)) throw new TypeError('cargo_allocation_cache_rows_required');
    if (rows.some((row) => String(row?.isoDate || '') !== isoDate)) throw new TypeError('cargo_allocation_cache_row_day_mismatch');
    const json = JSON.stringify(rows);
    const digest = crypto.createHash('sha256').update(json).digest('hex');
    const byteCount = Buffer.byteLength(json);
    const payload = zlib.gzipSync(Buffer.from(json), { level: zlib.constants.Z_BEST_SPEED });
    upsertDay.run(sourceKey, isoDate, payload, digest, byteCount, Math.trunc(now()));
    return { isoDate, digest, byteCount };
  }

  function pruneBefore(value) {
    requireOpen();
    const isoDate = normalizeDay(value);
    return Number(pruneDays.run(sourceKey, isoDate).changes || 0);
  }

  function close() {
    if (closed) return;
    closed = true;
    database.close();
  }

  return { sourceKey, readDay, writeDay, pruneBefore, close };
}

module.exports = {
  CARGO_ALLOCATION_SQLITE_CACHE_SCHEMA_VERSION: CACHE_SCHEMA_VERSION,
  buildCargoAllocationCacheSourceKey,
  createCargoAllocationSqliteCache,
};
