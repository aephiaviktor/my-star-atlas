'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const properLockfile = require('proper-lockfile');
const { writeJsonAtomic } = require('./atomic-json');

const SCHEMA_VERSION = 1;
const SOURCE_TYPE = 'current-inventory-snapshot';
const QUANTITY = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const queues = new Map();
const LOCK_OPTIONS = Object.freeze({ stale: 30000, update: 10000, retries: { retries: 30, factor: 1.2, minTimeout: 10, maxTimeout: 100, randomize: false }, realpath: false });

function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function hash(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
function iso(value) { if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('invalid_timestamp'); return value; }
function identifier(value, code) { if (typeof value !== 'string' || !ID.test(value)) throw new Error(code); return value; }
function label(value, code) { if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value) || /https?:\/\//i.test(value)) throw new Error(code); return value; }
function quantity(value) { if (typeof value !== 'string' || !QUANTITY.test(value) || /^0(?:\.0+)?$/.test(value)) throw new Error('invalid_quantity'); return value; }
function canonicalRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('invalid_rows');
  const seen = new Set();
  const result = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('invalid_row');
    const location = label(row.location, 'invalid_location');
    const asset = label(row.asset, 'invalid_asset');
    const key = `${location}\n${asset}`;
    if (seen.has(key)) throw new Error('duplicate_inventory_identity');
    seen.add(key);
    return { location, asset, quantity: quantity(row.quantity), costCoverage: 'uncosted', status: 'Incomplete' };
  });
  return result.sort((a, b) => compare(a.location, b.location) || compare(a.asset, b.asset));
}
function contentFor({ faction, playerProfile, sourceTimestamp, rows }) {
  return { schemaVersion: SCHEMA_VERSION, faction: identifier(faction, 'invalid_faction'), playerProfile: identifier(playerProfile, 'invalid_player_profile'), sourceTimestamp: iso(sourceTimestamp), eventBoundaryTimestamp: sourceTimestamp, sourceType: SOURCE_TYPE, rows: canonicalRows(rows) };
}
function contentHash(content) { return hash(JSON.stringify(content)); }
function buildDocument(input, createdAt) { const content = contentFor(input); return { ...content, contentHash: contentHash(content), createdAt: iso(createdAt) }; }
function validateDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('invalid_document');
  if (document.schemaVersion !== SCHEMA_VERSION) throw new Error('unsupported_schema');
  const expected = ['schemaVersion','faction','playerProfile','sourceTimestamp','eventBoundaryTimestamp','sourceType','rows','contentHash','createdAt'].sort();
  if (Object.keys(document).sort().join('\n') !== expected.join('\n')) throw new Error('invalid_document');
  if (document.sourceType !== SOURCE_TYPE || document.eventBoundaryTimestamp !== document.sourceTimestamp) throw new Error('invalid_boundary');
  const content = contentFor(document);
  if (!/^[a-f0-9]{64}$/.test(document.contentHash) || document.contentHash !== contentHash(content)) throw new Error('content_hash_mismatch');
  iso(document.createdAt);
  return { ...content, contentHash: document.contentHash, createdAt: document.createdAt };
}
function pathsFor(root, faction, playerProfile) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('invalid_root');
  identifier(faction, 'invalid_faction'); identifier(playerProfile, 'invalid_player_profile');
  const directory = path.join(root, 'opening-inventory', faction, hash(playerProfile).slice(0, 24));
  return { directory, document: path.join(directory, 'opening-inventory-v1.json'), lock: path.join(directory, '.opening-inventory-v1.lock-target') };
}
function queue(key, work) { const prior = queues.get(key) || Promise.resolve(); const next = prior.catch(() => {}).then(work); const tracked = next.finally(() => { if (queues.get(key) === tracked) queues.delete(key); }); tracked.catch(() => {}); queues.set(key, tracked); return next; }
async function acquire(paths, options) { await fs.mkdir(paths.directory, { recursive: true }); const h = await fs.open(paths.lock, 'a', 0o600); await h.close(); return properLockfile.lock(paths.lock, { ...LOCK_OPTIONS, ...(options.lockOptions || {}) }); }
async function read(paths) { try { const text = await fs.readFile(paths.document, 'utf8'); return { status: 'loaded', document: validateDocument(JSON.parse(text)) }; } catch (error) { if (error?.code === 'ENOENT') return { status: 'missing', document: null }; return { status: 'invalid', document: null, error: String(error?.message || error) }; } }
async function loadOpeningInventoryCheckpoint({ root, faction, playerProfile }) {
  let paths; try { paths = pathsFor(root, faction, playerProfile); } catch (error) { return { status: 'invalid', document: null, error: error.message }; }
  const result = await read(paths);
  if (result.status === 'loaded' && (result.document.faction !== faction || result.document.playerProfile !== playerProfile)) return { status: 'scope-mismatch', document: null };
  return result;
}
async function saveOpeningInventoryCheckpoint(input, options = {}) {
  let paths, document; try { paths = pathsFor(input.root, input.faction, input.playerProfile); document = buildDocument(input, typeof options.now === 'function' ? options.now() : (options.now || new Date().toISOString())); } catch (error) { return { status: 'invalid', document: null, error: error.message }; }
  return queue(paths.document, async () => {
    let release;
    try {
      release = await acquire(paths, options);
      const existing = await read(paths);
      if (existing.status === 'invalid') return existing;
      if (existing.status === 'loaded' && (existing.document.faction !== input.faction || existing.document.playerProfile !== input.playerProfile)) return { status: 'scope-mismatch', document: null };
      if (existing.status === 'loaded' && existing.document.contentHash === document.contentHash) return { status: 'loaded', document: existing.document, written: false };
      await writeJsonAtomic(paths.document, document, options.writeHooks || {});
      return { status: 'created', document, written: true };
    } catch (error) { return { status: 'save-failed', document: null, error: String(error?.message || error), written: false }; }
    finally { if (release) try { await release(); } catch (_) {} }
  });
}

module.exports = { SCHEMA_VERSION, SOURCE_TYPE, pathsFor, contentHash, loadOpeningInventoryCheckpoint, saveOpeningInventoryCheckpoint };
