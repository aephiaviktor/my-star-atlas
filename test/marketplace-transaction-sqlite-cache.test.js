'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  createMarketplaceTransactionSqliteCache,
} = require('../electron/marketplace-transaction-sqlite-cache');
const {
  createMarketplaceTransactionCacheConnection,
} = require('../electron/marketplace-transaction-cache');

function transaction(signature, slot = 42) {
  return {
    slot,
    blockTime: 1_789_000_000,
    meta: { err: null, fee: 5000, logMessages: ['Program log: test'] },
    transaction: {
      signatures: [signature],
      message: { accountKeys: ['wallet-a'], instructions: [] },
    },
  };
}

function temporaryCachePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-marketplace-tx-cache-'));
  return { directory, filePath: path.join(directory, 'transactions.sqlite') };
}

test('successful parsed transactions survive reopen with immutable identity', () => {
  const { directory, filePath } = temporaryCachePath();
  const first = createMarketplaceTransactionSqliteCache({ filePath, now: () => 1_000 });
  const original = transaction('signature-a');
  assert.equal(first.write('signature-a', original).status, 'inserted');
  assert.equal(first.write('signature-a', { ...original }).status, 'unchanged');
  first.close();

  const reopened = createMarketplaceTransactionSqliteCache({ filePath });
  assert.deepEqual(reopened.read('signature-a').transaction, original);
  assert.throws(() => reopened.write('signature-a', transaction('signature-a', 43)), /marketplace_transaction_cache_conflict/);
  assert.deepEqual(reopened.read('signature-a').transaction, original);
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('corrupt transaction payload self-deletes instead of being served', () => {
  const { directory, filePath } = temporaryCachePath();
  const cache = createMarketplaceTransactionSqliteCache({ filePath });
  cache.write('signature-a', transaction('signature-a'));
  cache.close();

  const database = new DatabaseSync(filePath);
  database.prepare('UPDATE marketplace_parsed_transactions SET payload = ? WHERE signature = ?')
    .run(Buffer.from('broken'), 'signature-a');
  database.close();

  const reopened = createMarketplaceTransactionSqliteCache({ filePath });
  assert.equal(reopened.read('signature-a'), null);
  assert.equal(reopened.read('signature-a'), null);
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('connection wrapper reuses persisted transactions after restart and never persists misses', async () => {
  const { directory, filePath } = temporaryCachePath();
  let calls = 0;
  const firstStore = createMarketplaceTransactionSqliteCache({ filePath });
  const first = createMarketplaceTransactionCacheConnection({
    async getParsedTransaction(signature) {
      calls += 1;
      return signature === 'missing' ? null : transaction(signature);
    },
  }, { persistentCache: firstStore });

  assert.equal((await first.getParsedTransaction('signature-a')).slot, 42);
  assert.equal(await first.getParsedTransaction('missing'), null);
  firstStore.close();

  const reopenedStore = createMarketplaceTransactionSqliteCache({ filePath });
  const reopened = createMarketplaceTransactionCacheConnection({
    async getParsedTransaction() {
      calls += 1;
      throw new Error('RPC must not run for a persisted transaction');
    },
  }, { persistentCache: reopenedStore });
  assert.equal((await reopened.getParsedTransaction('signature-a')).slot, 42);
  assert.equal(calls, 2);
  assert.equal(reopenedStore.read('missing'), null);
  reopenedStore.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
