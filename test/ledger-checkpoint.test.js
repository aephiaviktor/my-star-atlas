const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { InventoryCostLedger } = require('../electron/inventory-cost-ledger');
const { loadLedgerCheckpoint, saveLedgerCheckpoint, validateVerifiedOpeningCheckpoint } = require('../electron/ledger-checkpoint');

test('ledger checkpoint round-trips basis and event fingerprints atomically', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-ledger-checkpoint-'));
  const filePath = path.join(directory, 'MUD.json');
  try {
    const ledger = new InventoryCostLedger();
    ledger.acquire({ location: 'MUD-1', asset: 'Carbon', quantity: 5, source: 'mining', totalCost: 2 });
    await saveLedgerCheckpoint(filePath, {
      faction: 'MUD', profile: 'MUD', ledger, seenEventFingerprints: ['abc', 'def'],
      eventResultByFingerprint: { abc: { quantity: 1, uncostedQuantity: 1, costs: {}, cargoCost: 0 } },
    });
    const loaded = await loadLedgerCheckpoint(filePath, { faction: 'MUD', profile: 'MUD' });
    assert.equal(loaded.status, 'loaded');
    assert.deepEqual(loaded.ledger.snapshot(), ledger.snapshot());
    assert.deepEqual(loaded.seenEventFingerprints, ['abc', 'def']);
    assert.equal(loaded.eventResultByFingerprint.abc.quantity, 1);
    assert.equal(loaded.eventFingerprintCounts.abc, 1);
    assert.deepEqual(loaded.eventResultsByFingerprint.abc[0], { quantity: 1, uncostedQuantity: 1, costs: {}, cargoCost: 0 });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('verified opening checkpoint is explicit, scope-bound, and round-trips without being inferred', async () => {
  const marker = { status: 'verified', coverage: 'Complete', checkpointId: 'opening-1', checkpointHash: 'a'.repeat(64), boundaryAt: '2026-08-01T00:00:00.000Z', faction: 'MUD', profile: 'MUD' };
  assert.deepEqual(validateVerifiedOpeningCheckpoint(marker, { faction: 'MUD', profile: 'MUD' }), marker);
  assert.equal(validateVerifiedOpeningCheckpoint({ ...marker, checkpointHash: 'bad' }, { faction: 'MUD', profile: 'MUD' }), null);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-ledger-checkpoint-'));
  const filePath = path.join(directory, 'MUD.json');
  try {
    const ledger = new InventoryCostLedger();
    await saveLedgerCheckpoint(filePath, { faction: 'MUD', profile: 'MUD', ledger, seenEventFingerprints: [], verifiedOpeningCheckpoint: marker });
    const loaded = await loadLedgerCheckpoint(filePath, { faction: 'MUD', profile: 'MUD' });
    assert.deepEqual(loaded.verifiedOpeningCheckpoint, marker);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
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

    await fs.writeFile(filePath, JSON.stringify({ schemaVersion: 1, faction: 'MUD', profile: 'MUD', ledgerRows: [], seenEventFingerprints: [] }));
    const mismatch = await loadLedgerCheckpoint(filePath, { faction: 'USTUR', profile: 'USTUR' });
    assert.equal(mismatch.status, 'invalid');
    assert.match(mismatch.error, /faction/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
