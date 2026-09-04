const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { InventoryCostLedger } = require('../electron/inventory-cost-ledger');
const { loadLedgerCheckpoint, saveLedgerCheckpoint } = require('../electron/ledger-checkpoint');
const { createInventoryBasisSnapshot } = require('../electron/inventory-basis-snapshot');

test('ledger checkpoint round-trips basis and event fingerprints atomically', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-ledger-checkpoint-'));
  const filePath = path.join(directory, 'MUD.json');
  try {
    const ledger = new InventoryCostLedger();
    ledger.acquire({ location: 'MUD-1', asset: 'Carbon', quantity: 5, source: 'mining', totalCost: 2 });
    const pendingInventoryBasisSnapshots = [createInventoryBasisSnapshot({
      faction: 'MUD', starbase: 'MUD-1', asset: 'Carbon', timestamp: '2026-08-01T00:00:00Z', eventId: 'abc:1',
      quantity: 5, uncostedQuantity: 0, costs: { mining: 2 }, cargoCost: 0,
    })];
    await saveLedgerCheckpoint(filePath, {
      faction: 'MUD', profile: 'MUD', ledger, seenEventFingerprints: ['abc', 'def'],
      eventResultByFingerprint: { abc: { quantity: 1, uncostedQuantity: 1, costs: {}, cargoCost: 0 } },
      pendingInventoryBasisSnapshots,
    });
    const loaded = await loadLedgerCheckpoint(filePath, { faction: 'MUD', profile: 'MUD' });
    assert.equal(loaded.status, 'loaded');
    assert.deepEqual(loaded.ledger.snapshot(), ledger.snapshot());
    assert.deepEqual(loaded.seenEventFingerprints, ['abc', 'def']);
    assert.equal(loaded.eventResultByFingerprint.abc.quantity, 1);
    assert.equal(loaded.eventFingerprintCounts.abc, 1);
    assert.deepEqual(loaded.eventResultsByFingerprint.abc[0], { quantity: 1, uncostedQuantity: 1, costs: {}, cargoCost: 0 });
    assert.deepEqual(loaded.pendingInventoryBasisSnapshots, pendingInventoryBasisSnapshots);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('missing checkpoint requests a fresh baseline', async () => {
  const loaded = await loadLedgerCheckpoint('/tmp/msa-does-not-exist/checkpoint.json', { faction: 'ONI', profile: 'ONI' });
  assert.equal(loaded.status, 'missing');
  assert.deepEqual(loaded.seenEventFingerprints, []);
});

test('corrupt or mismatched checkpoint fails safely without loading basis', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-ledger-checkpoint-'));
  const filePath = path.join(directory, 'USTUR.json');
  try {
    await fs.writeFile(filePath, '{broken');
    const corrupt = await loadLedgerCheckpoint(filePath, { faction: 'USTUR', profile: 'USTUR' });
    assert.equal(corrupt.status, 'invalid');
    assert.match(corrupt.error, /JSON|Unexpected|property name/i);

    await fs.writeFile(filePath, JSON.stringify({ schemaVersion: 13, faction: 'MUD', profile: 'MUD', ledgerRows: [], seenEventFingerprints: [] }));
    const mismatch = await loadLedgerCheckpoint(filePath, { faction: 'USTUR', profile: 'USTUR' });
    assert.equal(mismatch.status, 'invalid');
    assert.match(mismatch.error, /faction/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('legacy checkpoint is invalidated so corrected provenance is replayed', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-ledger-checkpoint-'));
  const filePath = path.join(directory, 'ONI.json');
  try {
    await fs.writeFile(filePath, JSON.stringify({ schemaVersion: 9, faction: 'ONI', profile: 'USTUR', ledgerRows: [], seenEventFingerprints: [] }));
    const loaded = await loadLedgerCheckpoint(filePath, { faction: 'ONI', profile: 'USTUR' });
    assert.equal(loaded.status, 'invalid');
    assert.match(loaded.error, /schemaVersion/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
