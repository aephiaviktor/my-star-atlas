'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  createMarketplaceCheckpointSqliteStore,
} = require('../electron/marketplace-checkpoint-sqlite-store');

function temporaryStorePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-marketplace-checkpoint-'));
  return { directory, filePath: path.join(directory, 'marketplace.sqlite') };
}

function checkpoint(savedAt = '2026-09-15T05:00:00.000Z') {
  return {
    schemaVersion: 2,
    custodyBackfillVersion: 4,
    savedAt,
    cursors: {
      wallet: { before: 'signature-a', oldestBlockTime: 1_789_000_000, backfillComplete: false },
    },
    tokenAccounts: [{ owner: 'wallet', address: 'token-account' }],
    tokenAccountOwners: ['wallet'],
    tokenAccountsRefreshedAt: savedAt,
    lastTransferScanAt: savedAt,
  };
}

test('Marketplace checkpoint survives reopen and updates atomically by scope', () => {
  const { directory, filePath } = temporaryStorePath();
  const first = createMarketplaceCheckpointSqliteStore({ filePath, now: () => 1_000 });
  assert.equal(first.read('raw-data'), null);
  assert.equal(first.write('raw-data', checkpoint()).status, 'written');
  first.close();

  const reopened = createMarketplaceCheckpointSqliteStore({ filePath });
  assert.deepEqual(reopened.read('raw-data').document, checkpoint());
  const updated = checkpoint('2026-09-15T06:00:00.000Z');
  updated.cursors.wallet.backfillComplete = true;
  reopened.write('raw-data', updated);
  assert.deepEqual(reopened.read('raw-data').document, updated);
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('Marketplace checkpoint rejects invalid documents before replacing last-good state', () => {
  const { directory, filePath } = temporaryStorePath();
  const store = createMarketplaceCheckpointSqliteStore({ filePath });
  store.write('raw-data', checkpoint());
  assert.throws(() => store.write('raw-data', { schemaVersion: 2, cursors: [] }), /marketplace_checkpoint_invalid_document/);
  assert.deepEqual(store.read('raw-data').document, checkpoint());
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('corrupt Marketplace checkpoint self-deletes instead of advancing a cursor', () => {
  const { directory, filePath } = temporaryStorePath();
  const store = createMarketplaceCheckpointSqliteStore({ filePath });
  store.write('raw-data', checkpoint());
  store.close();

  const database = new DatabaseSync(filePath);
  database.prepare('UPDATE marketplace_sync_checkpoints SET payload = ? WHERE scope = ?')
    .run(Buffer.from('{"schemaVersion":2}'), 'raw-data');
  database.close();

  const reopened = createMarketplaceCheckpointSqliteStore({ filePath });
  assert.equal(reopened.read('raw-data'), null);
  assert.equal(reopened.read('raw-data'), null);
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('main imports legacy raw-data JSON and mirrors SQLite checkpoint writes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /createMarketplaceCheckpointSqliteStore/);
  assert.match(main, /getMarketplaceCheckpointSqliteStore\(\)\.read\('raw-data'\)/);
  assert.match(main, /getMarketplaceCheckpointSqliteStore\(\)\.write\('raw-data', document\)/);
  assert.match(main, /await writeJsonAtomic\(marketplaceRawDataCheckpointPath\(\), document\)/);
  assert.match(main, /const checkpoint = await loadMarketplaceRawDataCheckpoint\(\)/);
  assert.match(main, /await saveMarketplaceRawDataCheckpoint\(\{/);
});
