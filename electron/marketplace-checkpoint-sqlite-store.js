'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const STORE_SCHEMA_VERSION = 1;
const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;

function normalizeScope(value) {
  const scope = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(scope)) throw new TypeError('marketplace_checkpoint_scope_required');
  return scope;
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function validateDocument(scope, document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || !Number.isSafeInteger(Number(document.schemaVersion)) || Number(document.schemaVersion) < 1) {
    throw new TypeError('marketplace_checkpoint_invalid_document');
  }
  if (scope === 'raw-data' && (!document.cursors || typeof document.cursors !== 'object'
    || Array.isArray(document.cursors) || !Array.isArray(document.tokenAccounts)
    || (document.tokenAccountOwners != null && !Array.isArray(document.tokenAccountOwners)))) {
    throw new TypeError('marketplace_checkpoint_invalid_document');
  }
  return document;
}

function canonicalDocument(scope, document) {
  let plain;
  try {
    plain = JSON.parse(JSON.stringify(document));
  } catch (_error) {
    throw new TypeError('marketplace_checkpoint_invalid_document');
  }
  validateDocument(scope, plain);
  const json = stableSerialize(plain);
  const byteCount = Buffer.byteLength(json);
  if (byteCount > MAX_CHECKPOINT_BYTES) throw new TypeError('marketplace_checkpoint_document_too_large');
  return { plain, json, byteCount };
}

function createMarketplaceCheckpointSqliteStore({ filePath, now = Date.now } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('marketplace_checkpoint_file_path_required');
  if (typeof now !== 'function') throw new TypeError('marketplace_checkpoint_now_required');
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Best effort on filesystems without POSIX modes. */ }
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS marketplace_sync_checkpoints (
      scope TEXT PRIMARY KEY,
      document_schema_version INTEGER NOT NULL,
      payload BLOB NOT NULL,
      digest TEXT NOT NULL,
      byte_count INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    ) WITHOUT ROWID;
  `);

  const selectCheckpoint = database.prepare(`
    SELECT document_schema_version, payload, digest, byte_count, updated_at_ms
    FROM marketplace_sync_checkpoints
    WHERE scope = ?
  `);
  const upsertCheckpoint = database.prepare(`
    INSERT INTO marketplace_sync_checkpoints (
      scope, document_schema_version, payload, digest, byte_count, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      document_schema_version = excluded.document_schema_version,
      payload = excluded.payload,
      digest = excluded.digest,
      byte_count = excluded.byte_count,
      updated_at_ms = excluded.updated_at_ms
  `);
  const deleteCheckpoint = database.prepare('DELETE FROM marketplace_sync_checkpoints WHERE scope = ?');
  let closed = false;

  function requireOpen() {
    if (closed) throw new Error('marketplace_checkpoint_store_closed');
  }

  function read(scopeValue) {
    requireOpen();
    const scope = normalizeScope(scopeValue);
    const row = selectCheckpoint.get(scope);
    if (!row) return null;
    try {
      const json = Buffer.from(row.payload).toString('utf8');
      const byteCount = Buffer.byteLength(json);
      const digest = crypto.createHash('sha256').update(json).digest('hex');
      if (byteCount > MAX_CHECKPOINT_BYTES || byteCount !== Number(row.byte_count) || digest !== row.digest) {
        throw new Error('marketplace_checkpoint_integrity_failed');
      }
      const document = JSON.parse(json);
      validateDocument(scope, document);
      if (Number(document.schemaVersion) !== Number(row.document_schema_version)) {
        throw new Error('marketplace_checkpoint_schema_mismatch');
      }
      return { document, digest, byteCount, updatedAtMs: Number(row.updated_at_ms) };
    } catch (_error) {
      deleteCheckpoint.run(scope);
      return null;
    }
  }

  function write(scopeValue, document) {
    requireOpen();
    const scope = normalizeScope(scopeValue);
    const canonical = canonicalDocument(scope, document);
    const digest = crypto.createHash('sha256').update(canonical.json).digest('hex');
    upsertCheckpoint.run(
      scope,
      Number(canonical.plain.schemaVersion),
      Buffer.from(canonical.json),
      digest,
      canonical.byteCount,
      Math.trunc(now()),
    );
    return { status: 'written', digest, byteCount: canonical.byteCount };
  }

  function close() {
    if (closed) return;
    closed = true;
    database.close();
  }

  return { read, write, close };
}

module.exports = {
  MARKETPLACE_CHECKPOINT_SQLITE_STORE_SCHEMA_VERSION: STORE_SCHEMA_VERSION,
  createMarketplaceCheckpointSqliteStore,
};
