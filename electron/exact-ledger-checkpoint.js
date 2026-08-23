'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const properLockfile = require('proper-lockfile');
const { writeJsonAtomic } = require('./atomic-json');
const arithmetic = require('./exact-arithmetic');

const SCHEMA_VERSION = 2;
const ARITHMETIC_VERSION = 1;
const LEDGER_VERSION = 1;
const EVENT_STORE_VERSION = 1;
const queues = new Map();
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const LOCK_OPTIONS = { stale: 30000, update: 10000, retries: { retries: 30, factor: 1.2, minTimeout: 10, maxTimeout: 100, randomize: false }, realpath: false };

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = (value) => sha(canonical(value));
const clone = (value) => structuredClone(value);
function identifier(value, label) { if (typeof value !== 'string' || !ID.test(value)) throw new Error(label); return value; }
function fingerprint(faction, playerProfile) { return hash({ faction, playerProfile }); }
function iso(value) { if (typeof value !== 'string' || new Date(value).toISOString() !== value) throw new Error('invalid_timestamp'); return value; }
function exact(value, unit, label) { const parsed = arithmetic.parseValue(value); if (parsed.status !== 'ok' || (unit && parsed.value.unit !== unit)) throw new Error(label); return parsed.value; }
function add(left, right) { const result = arithmetic.add(left, right); if (result.status !== 'ok') throw new Error('incompatible_component'); return result.value; }
function total(values, currency) { return values.reduce((sum, value) => add(sum, value), { atoms: '0', decimals: 0, unit: currency }); }

function pathsFor(root, faction, playerProfile) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('invalid_root');
  identifier(faction, 'invalid_faction'); identifier(playerProfile, 'invalid_player_profile');
  const directory = path.join(root, 'exact-ledger-checkpoints', faction, fingerprint(faction, playerProfile));
  return { directory, document: path.join(directory, 'exact-ledger-checkpoint-v2.json'), lock: path.join(directory, '.exact-ledger-checkpoint-v2.lock-target') };
}

function canonicalComponents(input, currency) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_components');
  return Object.fromEntries(Object.keys(input).sort().map((name) => [identifier(name, 'invalid_component'), exact(input[name], currency, 'invalid_component_value')]));
}
function canonicalLot(lot, scope, binding) {
  if (!lot || typeof lot !== 'object' || Array.isArray(lot)) throw new Error('invalid_lot');
  if (lot.scope?.faction !== scope.faction || lot.scope?.profile !== scope.playerProfile) throw new Error('scope-mismatch');
  const currency = identifier(lot.currency, 'invalid_currency');
  const quantity = exact(lot.quantity, null, 'invalid_quantity');
  if (BigInt(quantity.atoms) === 0n) throw new Error('invalid_quantity');
  const base = canonicalComponents(lot.base, currency), cargo = canonicalComponents(lot.cargo, currency);
  const baseTotal = total(Object.values(base), currency), cargoTotal = total(Object.values(cargo), currency), totalCost = add(baseTotal, cargoTotal);
  if (lot.baseTotal && arithmetic.compare(exact(lot.baseTotal, currency, 'invalid_base_total'), baseTotal).value !== 0) throw new Error('conservation_failure');
  if (lot.cargoTotal && arithmetic.compare(exact(lot.cargoTotal, currency, 'invalid_cargo_total'), cargoTotal).value !== 0) throw new Error('conservation_failure');
  if (lot.total && arithmetic.compare(exact(lot.total, currency, 'invalid_total'), totalCost).value !== 0) throw new Error('conservation_failure');
  if (lot.boundaryAt !== binding.forwardBoundary) throw new Error('binding-mismatch');
  if (lot.openingCheckpointId && lot.openingCheckpointId !== binding.openingCheckpointId) throw new Error('binding-mismatch');
  return { lotId: identifier(lot.lotId, 'invalid_lot_id'), sourceEventId: identifier(lot.sourceEventId, 'invalid_source_event_id'), provenance: String(lot.provenance || ''),
    scope: { faction: scope.faction, profile: scope.playerProfile }, location: identifier(lot.location, 'invalid_location'), asset: identifier(lot.asset, 'invalid_asset'),
    quantity, base, cargo, baseTotal, cargoTotal, total: totalCost, currency, status: lot.status === 'Complete' ? 'Complete' : 'Incomplete',
    coverage: lot.coverage === 'Complete' ? 'Complete' : 'Incomplete', openingCheckpointId: lot.openingCheckpointId || null,
    boundaryAt: binding.forwardBoundary, createdAt: iso(lot.createdAt) };
}
function content(document) { const { contentHash, ...rest } = document; return rest; }
function semanticContent(document) { const { contentHash, updatedAt, ...rest } = document; return rest; }
function seal(document) { document.contentHash = hash(content(document)); return document; }

function buildDocument(input, now, createdAt = now) {
  const scope = { faction: identifier(input.faction, 'invalid_faction'), playerProfile: identifier(input.playerProfile, 'invalid_player_profile') };
  const binding = { openingCheckpointId: identifier(input.openingCheckpointId, 'invalid_opening_checkpoint_id'), openingCheckpointHash: input.openingCheckpointHash,
    forwardBoundary: iso(input.forwardBoundary), immutableEventStoreVersion: input.immutableEventStoreVersion };
  if (!HEX.test(binding.openingCheckpointHash) || binding.immutableEventStoreVersion !== EVENT_STORE_VERSION) throw new Error('binding-mismatch');
  const appliedEvents = Array.from(input.appliedEvents || []).map((event) => {
    if (!event || !ID.test(event.eventId) || !HEX.test(event.payloadHash)) throw new Error('invalid_applied_event');
    return { eventId: event.eventId, payloadHash: event.payloadHash };
  }).sort((a, b) => a.eventId.localeCompare(b.eventId));
  if (new Set(appliedEvents.map((event) => event.eventId)).size !== appliedEvents.length) throw new Error('duplicate_applied_event');
  const lots = Array.from(input.lots || []).map((lot) => canonicalLot(lot, scope, binding)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.lotId.localeCompare(b.lotId));
  if (new Set(lots.map((lot) => lot.lotId)).size !== lots.length) throw new Error('duplicate_lot');
  const document = { schemaVersion: SCHEMA_VERSION, arithmeticContractVersion: ARITHMETIC_VERSION, ledgerEngineVersion: LEDGER_VERSION,
    faction: scope.faction, playerProfile: scope.playerProfile, profileFingerprint: fingerprint(scope.faction, scope.playerProfile),
    openingCheckpointId: binding.openingCheckpointId, openingCheckpointHash: binding.openingCheckpointHash, forwardBoundary: binding.forwardBoundary,
    immutableEventStoreVersion: binding.immutableEventStoreVersion, eventStoreContentHash: input.eventStoreContentHash,
    appliedEvents, lots, coverage: input.coverage === 'Complete' ? 'Complete' : 'Incomplete', createdAt: iso(createdAt), updatedAt: iso(now), contentHash: '' };
  if (!HEX.test(document.eventStoreContentHash)) throw new Error('invalid_event_store_hash');
  return seal(document);
}
function validateDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('invalid_document');
  if (document.schemaVersion === 1) throw new Error('legacy-approximate');
  if (document.schemaVersion !== SCHEMA_VERSION || document.arithmeticContractVersion !== ARITHMETIC_VERSION || document.ledgerEngineVersion !== LEDGER_VERSION) throw new Error('unsupported_schema');
  if (document.profileFingerprint !== fingerprint(document.faction, document.playerProfile) || document.contentHash !== hash(content(document))) throw new Error('content_hash_mismatch');
  const rebuilt = buildDocument(document, document.updatedAt, document.createdAt);
  if (rebuilt.contentHash !== document.contentHash) throw new Error('content_hash_mismatch');
  return clone(document);
}
async function read(paths) { try { return { status: 'loaded', document: validateDocument(JSON.parse(await fs.readFile(paths.document, 'utf8'))) }; }
  catch (error) { if (error.code === 'ENOENT') return { status: 'missing', document: null }; if (error.message === 'legacy-approximate') return { status: 'legacy-approximate', reason: 'rebuild-required', document: null }; return { status: 'invalid', reason: 'rebuild-required', error: String(error.message || error), document: null }; } }
function queue(key, work) { const prior = queues.get(key) || Promise.resolve(); const next = prior.catch(() => {}).then(work); const tracked = next.finally(() => { if (queues.get(key) === tracked) queues.delete(key); }); tracked.catch(() => {}); queues.set(key, tracked); return next; }
async function acquire(paths, options) { await fs.mkdir(paths.directory, { recursive: true }); const handle = await fs.open(paths.lock, 'a', 0o600); await handle.close(); return properLockfile.lock(paths.lock, { ...LOCK_OPTIONS, ...(options.lockOptions || {}) }); }
async function syncCommitted(paths) {
  await fs.chmod(paths.document, 0o600);
  const file = await fs.open(paths.document, 'r'); try { await file.sync(); } finally { await file.close(); }
  const directory = await fs.open(paths.directory, 'r'); try { await directory.sync(); } finally { await directory.close(); }
}

function classifyEventStore(document, eventStore) {
  if (!eventStore || eventStore.schemaVersion !== EVENT_STORE_VERSION) return { status: 'rebuild-required', reason: 'event-store-version' };
  const events = new Map((eventStore.events || []).map((row) => [row.event.eventId, row.event]));
  for (const applied of document.appliedEvents) {
    const current = events.get(applied.eventId);
    if (!current || current.payloadHash !== applied.payloadHash) return { status: 'rebuild-required', reason: current ? 'applied-event-changed' : 'applied-event-missing' };
    if ((eventStore.events || []).some((row) => row.event.supersedes === applied.eventId)) return { status: 'rebuild-required', reason: 'applied-event-corrected' };
  }
  if ((eventStore.coverage || []).some((row) => row.record?.status === 'Complete') && document.coverage !== 'Complete') return { status: 'rebuild-required', reason: 'coverage-improved' };
  if ((eventStore.conflicts || []).length) return { status: 'loaded', readiness: 'Incomplete', reason: 'conflict-appended' };
  const appended = [...events.keys()].filter((eventId) => !document.appliedEvents.some((applied) => applied.eventId === eventId));
  return appended.length ? { status: 'advance-required', appendedEventIds: appended.sort() } : { status: 'loaded', readiness: document.coverage };
}
function validateBindings(document, input) {
  if (document.faction !== input.faction || document.playerProfile !== input.playerProfile) return 'scope-mismatch';
  if (document.openingCheckpointId !== input.openingCheckpointId || document.openingCheckpointHash !== input.openingCheckpointHash || document.forwardBoundary !== input.forwardBoundary) return 'binding-mismatch';
  return null;
}
async function loadExactLedgerCheckpoint(input) {
  let paths; try { paths = pathsFor(input.root, input.faction, input.playerProfile); } catch (error) { return { status: 'invalid', error: error.message }; }
  const loaded = await read(paths); if (loaded.status !== 'loaded') return loaded;
  const mismatch = validateBindings(loaded.document, input); if (mismatch) return { status: mismatch, reason: 'rebuild-required', document: null };
  const classification = classifyEventStore(loaded.document, input.eventStore);
  return { ...classification, document: loaded.document };
}
async function saveExactLedgerCheckpoint(input, options = {}) {
  let paths; try { paths = pathsFor(input.root, input.faction, input.playerProfile); } catch (error) { return { status: 'invalid', error: error.message }; }
  return queue(paths.document, async () => { let release; try {
    release = await acquire(paths, options); const loaded = await read(paths); if (loaded.status === 'invalid' || loaded.status === 'legacy-approximate') return loaded;
    const now = typeof options.now === 'function' ? options.now() : (options.now || new Date().toISOString());
    const document = buildDocument(input, now, loaded.document?.createdAt || now);
    if (loaded.status === 'loaded') {
      const mismatch = validateBindings(loaded.document, input); if (mismatch) return { status: mismatch, reason: 'rebuild-required', written: false };
      if (hash(semanticContent(loaded.document)) === hash(semanticContent(document))) return { status: 'no-change', document: loaded.document, written: false };
    }
    await writeJsonAtomic(paths.document, document, options.writeHooks || {});
    await syncCommitted(paths);
    return { status: loaded.status === 'missing' ? 'created' : 'saved', document, written: true };
  } catch (error) { return { status: 'save-failed', error: String(error.message || error), written: false }; }
  finally { if (release) try { await release(); } catch {} } });
}

module.exports = { SCHEMA_VERSION, ARITHMETIC_VERSION, LEDGER_VERSION, EVENT_STORE_VERSION, pathsFor, fingerprint, hash, validateDocument, classifyEventStore, loadExactLedgerCheckpoint, saveExactLedgerCheckpoint };
