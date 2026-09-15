'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const CACHE_SCHEMA_VERSION = 1;
const MAX_TRANSACTION_BYTES = 8 * 1024 * 1024;

function normalizeSignature(value) {
  const signature = String(value || '').trim();
  if (!signature || signature.length > 128) throw new TypeError('marketplace_transaction_cache_signature_required');
  return signature;
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function canonicalTransactionJson(signature, transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new TypeError('marketplace_transaction_cache_transaction_required');
  }
  let plain;
  try {
    plain = JSON.parse(JSON.stringify(transaction));
  } catch (_error) {
    throw new TypeError('marketplace_transaction_cache_transaction_not_serializable');
  }
  const embeddedSignature = String(plain?.transaction?.signatures?.[0] || '').trim();
  if (!embeddedSignature || embeddedSignature !== signature) {
    throw new TypeError('marketplace_transaction_cache_signature_mismatch');
  }
  const json = stableSerialize(plain);
  const byteCount = Buffer.byteLength(json);
  if (byteCount > MAX_TRANSACTION_BYTES) throw new TypeError('marketplace_transaction_cache_transaction_too_large');
  return { plain, json, byteCount };
}

function createMarketplaceTransactionSqliteCache({ filePath, now = Date.now } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError('marketplace_transaction_cache_file_path_required');
  }
  if (typeof now !== 'function') throw new TypeError('marketplace_transaction_cache_now_required');
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Best effort on filesystems without POSIX modes. */ }
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS marketplace_parsed_transactions (
      signature TEXT PRIMARY KEY,
      payload BLOB NOT NULL,
      digest TEXT NOT NULL,
      byte_count INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      block_time INTEGER,
      cached_at_ms INTEGER NOT NULL
    ) WITHOUT ROWID;
  `);

  const selectTransaction = database.prepare(`
    SELECT payload, digest, byte_count, slot, block_time, cached_at_ms
    FROM marketplace_parsed_transactions
    WHERE signature = ?
  `);
  const insertTransaction = database.prepare(`
    INSERT OR IGNORE INTO marketplace_parsed_transactions (
      signature, payload, digest, byte_count, slot, block_time, cached_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteTransaction = database.prepare('DELETE FROM marketplace_parsed_transactions WHERE signature = ?');
  let closed = false;

  function requireOpen() {
    if (closed) throw new Error('marketplace_transaction_cache_closed');
  }

  function read(signatureValue) {
    requireOpen();
    const signature = normalizeSignature(signatureValue);
    const row = selectTransaction.get(signature);
    if (!row) return null;
    try {
      const json = zlib.gunzipSync(row.payload).toString('utf8');
      const byteCount = Buffer.byteLength(json);
      const digest = crypto.createHash('sha256').update(json).digest('hex');
      const transaction = JSON.parse(json);
      canonicalTransactionJson(signature, transaction);
      if (byteCount !== Number(row.byte_count) || digest !== row.digest) throw new Error('integrity');
      return {
        transaction,
        digest,
        byteCount,
        slot: Number(row.slot),
        blockTime: row.block_time == null ? null : Number(row.block_time),
        cachedAtMs: Number(row.cached_at_ms),
      };
    } catch (_error) {
      deleteTransaction.run(signature);
      return null;
    }
  }

  function write(signatureValue, transaction) {
    requireOpen();
    const signature = normalizeSignature(signatureValue);
    const canonical = canonicalTransactionJson(signature, transaction);
    const slot = Number(canonical.plain.slot);
    const blockTime = canonical.plain.blockTime == null ? null : Number(canonical.plain.blockTime);
    if (!Number.isSafeInteger(slot) || slot < 0
      || (blockTime != null && (!Number.isSafeInteger(blockTime) || blockTime < 0))) {
      throw new TypeError('marketplace_transaction_cache_invalid_position');
    }
    const digest = crypto.createHash('sha256').update(canonical.json).digest('hex');
    const payload = zlib.gzipSync(Buffer.from(canonical.json), { level: zlib.constants.Z_BEST_SPEED });
    const inserted = Number(insertTransaction.run(
      signature, payload, digest, canonical.byteCount, slot, blockTime, Math.trunc(now()),
    ).changes || 0) > 0;
    if (inserted) return { status: 'inserted', digest, byteCount: canonical.byteCount };
    const existing = selectTransaction.get(signature);
    if (!existing || existing.digest !== digest || Number(existing.byte_count) !== canonical.byteCount) {
      throw new Error('marketplace_transaction_cache_conflict');
    }
    return { status: 'unchanged', digest, byteCount: canonical.byteCount };
  }

  function close() {
    if (closed) return;
    closed = true;
    database.close();
  }

  return { read, write, close };
}

module.exports = {
  MARKETPLACE_TRANSACTION_SQLITE_CACHE_SCHEMA_VERSION: CACHE_SCHEMA_VERSION,
  createMarketplaceTransactionSqliteCache,
};
