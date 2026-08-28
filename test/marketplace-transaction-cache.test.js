'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketplaceTransactionCacheConnection } = require('../electron/marketplace-transaction-cache');

test('transaction cache reuses parsed transactions across single and batch callers', async () => {
  const calls = [];
  const connection = {
    async getParsedTransaction(signature) {
      calls.push(['single', signature]);
      return { slot: signature === 'a' ? 1 : 2 };
    },
    async getParsedTransactions(signatures) {
      calls.push(['batch', [...signatures]]);
      return signatures.map((signature) => ({ slot: signature.charCodeAt(0) }));
    },
  };
  const cached = createMarketplaceTransactionCacheConnection(connection);

  const first = await cached.getParsedTransaction('a', { commitment: 'confirmed' });
  const batch = await cached.getParsedTransactions(['a', 'b'], { commitment: 'confirmed' });
  const last = await cached.getParsedTransaction('b', { commitment: 'confirmed' });

  assert.equal(first.slot, 1);
  assert.deepEqual(batch.map((row) => row.slot), [1, 98]);
  assert.equal(last.slot, 98);
  assert.deepEqual(calls, [['single', 'a'], ['batch', ['b']]]);
});

test('transaction cache does not retain null misses or rejected requests', async () => {
  let calls = 0;
  const connection = {
    async getParsedTransaction() {
      calls += 1;
      if (calls === 1) return null;
      if (calls === 2) throw new Error('temporary');
      return { slot: 3 };
    },
  };
  const cached = createMarketplaceTransactionCacheConnection(connection);

  assert.equal(await cached.getParsedTransaction('sig'), null);
  await assert.rejects(() => cached.getParsedTransaction('sig'), /temporary/);
  assert.equal((await cached.getParsedTransaction('sig')).slot, 3);
  assert.equal((await cached.getParsedTransaction('sig')).slot, 3);
  assert.equal(calls, 3);
});

test('Marketplace sync shares one parsed-transaction cache across LM and GM wrappers', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /const cachedConnection = createMarketplaceTransactionCacheConnection\(connection\)/);
  assert.match(main, /wrapMarketplaceConnection\(cachedConnection, \{ instrumentation, operation: 'LM' \}\)/);
  assert.match(main, /wrapMarketplaceConnection\(cachedConnection, \{ instrumentation, operation: 'GM' \}\)/);
});
