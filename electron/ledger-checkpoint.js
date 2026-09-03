'use strict';

const fs = require('node:fs/promises');
const { writeJsonAtomic } = require('./atomic-json');
const { InventoryCostLedger } = require('./inventory-cost-ledger');
const { projectInventoryBasisSnapshotRows } = require('./inventory-basis-snapshot');

// Version 10 reconciles authoritative game inventory immediately before valued deposits.
const LEDGER_CHECKPOINT_SCHEMA_VERSION = 10;

function emptyResult(status, error = '') {
  return {
    status,
    error,
    ledger: new InventoryCostLedger(),
    seenEventFingerprints: [],
    eventResultByFingerprint: {},
    eventFingerprintCounts: {},
    eventResultsByFingerprint: {},
    pendingInventoryBasisSnapshots: [],
    savedAt: null,
  };
}

async function loadLedgerCheckpoint(filePath, { faction, profile }) {
  let document;
  try {
    document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyResult('missing');
    return emptyResult('invalid', String(error?.message || error));
  }
  try {
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('checkpoint document must be an object');
    if (document.schemaVersion !== LEDGER_CHECKPOINT_SCHEMA_VERSION) throw new Error('checkpoint schemaVersion is incompatible');
    if (document.faction !== faction) throw new Error('checkpoint faction does not match');
    if (document.profile !== profile) throw new Error('checkpoint profile does not match');
    if (!Array.isArray(document.seenEventFingerprints)
      || document.seenEventFingerprints.some((value) => typeof value !== 'string' || !value)) {
      throw new Error('checkpoint event fingerprints are invalid');
    }
    const eventFingerprintCounts = document.eventFingerprintCounts && typeof document.eventFingerprintCounts === 'object'
      && !Array.isArray(document.eventFingerprintCounts) ? document.eventFingerprintCounts : {};
    for (const [fingerprint, count] of Object.entries(eventFingerprintCounts)) {
      if (!fingerprint || !Number.isInteger(count) || count <= 0) throw new Error('checkpoint event fingerprint counts are invalid');
    }
    const eventResultsByFingerprint = document.eventResultsByFingerprint && typeof document.eventResultsByFingerprint === 'object'
      && !Array.isArray(document.eventResultsByFingerprint) ? document.eventResultsByFingerprint : {};
    for (const [fingerprint, results] of Object.entries(eventResultsByFingerprint)) {
      if (!fingerprint || !Array.isArray(results)) throw new Error('checkpoint event results are invalid');
      for (const result of results) {
        InventoryCostLedger.fromSnapshot([{ location: 'checkpoint', asset: fingerprint, ...result }]);
      }
    }
    const pendingInventoryBasisSnapshots = document.pendingInventoryBasisSnapshots ?? [];
    if (!Array.isArray(pendingInventoryBasisSnapshots)) throw new Error('checkpoint pending inventory basis snapshots are invalid');
    const validatedPending = pendingInventoryBasisSnapshots.map((snapshot) => {
      const [projected] = projectInventoryBasisSnapshotRows([{ ...snapshot, _time: snapshot?.timestamp }]);
      if (!projected || JSON.stringify(projected) !== JSON.stringify(snapshot)) {
        throw new Error('checkpoint pending inventory basis snapshot is invalid');
      }
      return projected;
    });
    if (new Set(validatedPending.map((snapshot) => snapshot.snapshotId)).size !== validatedPending.length) {
      throw new Error('checkpoint pending inventory basis snapshot IDs are duplicated');
    }
    return {
      status: 'loaded',
      error: '',
      ledger: InventoryCostLedger.fromSnapshot(document.ledgerRows),
      seenEventFingerprints: Array.from(new Set(document.seenEventFingerprints)).sort(),
      eventResultByFingerprint: document.eventResultByFingerprint && typeof document.eventResultByFingerprint === 'object'
        && !Array.isArray(document.eventResultByFingerprint) ? document.eventResultByFingerprint : {},
      eventFingerprintCounts,
      eventResultsByFingerprint,
      pendingInventoryBasisSnapshots: validatedPending,
      savedAt: typeof document.savedAt === 'string' ? document.savedAt : null,
    };
  } catch (error) {
    return emptyResult('invalid', String(error?.message || error));
  }
}

async function saveLedgerCheckpoint(filePath, { faction, profile, ledger, seenEventFingerprints, eventResultByFingerprint = {}, eventFingerprintCounts = {}, eventResultsByFingerprint = {}, pendingInventoryBasisSnapshots = [] }) {
  if (!(ledger instanceof InventoryCostLedger)) throw new Error('ledger is required');
  const normalizedResults = eventResultsByFingerprint && Object.keys(eventResultsByFingerprint).length > 0
    ? eventResultsByFingerprint
    : Object.fromEntries(Object.entries(eventResultByFingerprint || {}).map(([fingerprint, result]) => [fingerprint, [result]]));
  const normalizedCounts = eventFingerprintCounts && Object.keys(eventFingerprintCounts).length > 0
    ? eventFingerprintCounts
    : Object.fromEntries(Object.entries(normalizedResults).map(([fingerprint, results]) => [fingerprint, results.length]));
  const normalizedPending = (pendingInventoryBasisSnapshots || []).map((snapshot) => {
    const [projected] = projectInventoryBasisSnapshotRows([{ ...snapshot, _time: snapshot?.timestamp }]);
    if (!projected || JSON.stringify(projected) !== JSON.stringify(snapshot)) throw new Error('pending inventory basis snapshot is invalid');
    return projected;
  });
  if (new Set(normalizedPending.map((snapshot) => snapshot.snapshotId)).size !== normalizedPending.length) {
    throw new Error('pending inventory basis snapshot IDs are duplicated');
  }
  await writeJsonAtomic(filePath, {
    schemaVersion: LEDGER_CHECKPOINT_SCHEMA_VERSION,
    faction,
    profile,
    savedAt: new Date().toISOString(),
    ledgerRows: ledger.snapshot(),
    seenEventFingerprints: Array.from(new Set(seenEventFingerprints || [])).sort(),
    eventResultByFingerprint: Object.fromEntries(Object.entries(normalizedResults).map(([fingerprint, results]) => [fingerprint, results[0]])),
    eventFingerprintCounts: normalizedCounts,
    eventResultsByFingerprint: normalizedResults,
    pendingInventoryBasisSnapshots: normalizedPending,
  });
}

module.exports = {
  LEDGER_CHECKPOINT_SCHEMA_VERSION,
  loadLedgerCheckpoint,
  saveLedgerCheckpoint,
};
