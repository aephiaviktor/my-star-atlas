'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createMarketplaceOutbox,
  deriveTradeSourceId,
  deriveAssetFlowSourceId,
  deriveOutboxKey,
  OUTBOX_SCHEMA_VERSION,
} = require('../electron/marketplace-outbox');

async function withTemp(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-marketplace-outbox-'));
  try { return await callback(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

function clock(start = Date.parse('2026-07-31T18:00:00.000Z')) {
  let value = start;
  return { now: () => new Date(value).toISOString(), tick: (ms = 1000) => { value += ms; } };
}

function trade(overrides = {}) {
  return {
    eventType: 'trade', market: 'LM', faction: 'MUD',
    signature: 'sig-1', rawMint: 'mint-1', side: 'buy', quantity: 2,
    line: 'marketplace,market=LM quantity=2 1785513600000000000',
    ...overrides,
  };
}

function flow(overrides = {}) {
  return {
    eventType: 'asset_flow', market: 'GM', faction: 'GLOBAL',
    flowId: 'sig-1:3:wallet-transfer',
    line: 'asset_flow,flow=wallet-transfer quantity=2 1785513600000000000',
    ...overrides,
  };
}

test('module exposes isolated schema v1 without touching disk on require', async () => {
  assert.equal(OUTBOX_SCHEMA_VERSION, 1);
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'nested', 'outbox-v1.json');
    createMarketplaceOutbox({ filePath });
    await assert.rejects(fs.stat(path.dirname(filePath)), { code: 'ENOENT' });
  });
});

test('trade identities ignore row and order enrichment while market scopes remain distinct', () => {
  const legacy = deriveTradeSourceId({ signature: 'sig', rawMint: 'mint', side: 'sell', quantity: 1, id: 'legacy' });
  const enriched = deriveTradeSourceId({ signature: 'sig', rawMint: 'mint', side: 'sell', quantity: 1.0, id: 'new', orderId: 'order' });
  assert.equal(legacy, enriched);
  const lmMud = deriveOutboxKey({ market: 'LM', faction: 'MUD', eventType: 'trade', sourceId: legacy });
  const lmOni = deriveOutboxKey({ market: 'LM', faction: 'ONI', eventType: 'trade', sourceId: legacy });
  const gm = deriveOutboxKey({ market: 'GM', faction: 'GLOBAL', eventType: 'trade', sourceId: legacy });
  assert.equal(new Set([lmMud, lmOni, gm]).size, 3);
});

test('asset-flow identity separates events sharing one signature', () => {
  const first = deriveAssetFlowSourceId({ flowId: 'sig:1:deposit' });
  const second = deriveAssetFlowSourceId({ flowId: 'sig:2:withdraw' });
  assert.notEqual(first, second);
  assert.notEqual(
    deriveOutboxKey({ market: 'GM', faction: 'GLOBAL', eventType: 'asset_flow', sourceId: first }),
    deriveOutboxKey({ market: 'GM', faction: 'GLOBAL', eventType: 'trade', sourceId: first }),
  );
});

test('enqueue is durable, idempotent without a second write, and conflicts fail closed', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    let renames = 0;
    const fsAdapter = Object.create(fs);
    fsAdapter.rename = async (...args) => { renames += 1; return fs.rename(...args); };
    const c = clock();
    const store = createMarketplaceOutbox({ filePath, now: c.now, fsAdapter });
    const first = await store.enqueue(trade());
    c.tick();
    const duplicate = await store.enqueue(trade());
    assert.equal(first.status, 'enqueued');
    assert.equal(duplicate.status, 'unchanged');
    assert.equal(duplicate.entry.createdAt, first.entry.createdAt);
    assert.equal(renames, 1);
    await assert.rejects(store.enqueue(trade({ line: 'marketplace,market=LM quantity=3 1785513600000000000' })), { code: 'identity_conflict' });
    assert.equal(renames, 1);
    assert.equal((await store.listPending()).entries.length, 1);
  });
});

test('pending entries order by createdAt then key and returned values are defensive', async () => {
  await withTemp(async (directory) => {
    const c = clock();
    const store = createMarketplaceOutbox({ filePath: path.join(directory, 'outbox.json'), now: c.now });
    const b = await store.enqueue(trade({ signature: 'sig-b' }));
    const a = await store.enqueue(trade({ signature: 'sig-a' }));
    c.tick();
    await store.enqueue(flow());
    const listed = await store.listPending({ limit: 2 });
    assert.deepEqual(listed.entries.map((entry) => entry.key), [a.key, b.key].sort());
    listed.entries[0].state = 'published';
    assert.equal((await store.listPending()).entries.length, 3);
  });
});

test('mark-published is idempotent and preserves the first timestamp across restart', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const c = clock();
    const store = createMarketplaceOutbox({ filePath, now: c.now });
    const { key } = await store.enqueue(trade());
    const firstPublishedAt = '2026-07-31T18:01:00.000Z';
    assert.equal((await store.markPublished(key, firstPublishedAt)).status, 'published');
    assert.equal((await store.markPublished(key, '2026-07-31T18:02:00.000Z')).status, 'already_published');
    assert.equal((await store.recordFailedAttempt(key, { failure: 'timeout', attemptedAt: firstPublishedAt, nextAttemptAt: null })).status, 'invalid_state');
    const fresh = createMarketplaceOutbox({ filePath, now: c.now });
    const opened = await fresh.open();
    assert.equal(opened.status, 'loaded');
    assert.equal(opened.document.entries[key].publishedAt, firstPublishedAt);
    assert.deepEqual((await fresh.listPending()).entries, []);
  });
});

test('retry metadata is allowlisted, timestamped, saturating, and rejects raw failure data', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const c = clock();
    const store = createMarketplaceOutbox({ filePath, now: c.now, limits: { maxRetryCount: 1 } });
    const { key } = await store.enqueue(trade());
    const attemptedAt = '2026-07-31T18:01:00.000Z';
    await store.recordFailedAttempt(key, { failure: 'network', attemptedAt, nextAttemptAt: '2026-07-31T18:02:00.000Z' });
    const second = await store.recordFailedAttempt(key, { failure: 'timeout', attemptedAt, nextAttemptAt: null });
    assert.equal(second.entry.retryCount, 1);
    assert.deepEqual(second.entry.retry, { failure: 'timeout', nextAttemptAt: null });
    for (const failure of [new Error('Bearer secret'), 'https://secret.invalid', 'Authorization: token', 'arbitrary response']) {
      await assert.rejects(store.recordFailedAttempt(key, { failure, attemptedAt, nextAttemptAt: null }), { code: 'invalid_failure' });
    }
    await assert.rejects(store.recordFailedAttempt(key, {
      failure: 'unknown', attemptedAt, nextAttemptAt: null, error: new Error('secret stack'),
    }), { code: 'invalid_failure_fields' });
    const text = await fs.readFile(filePath, 'utf8');
    assert.equal(/Bearer|secret\.invalid|Authorization|arbitrary response/.test(text), false);
  });
});

test('strict classification, line, field, timestamp, and capacity validation fails closed', async () => {
  await withTemp(async (directory) => {
    const store = createMarketplaceOutbox({ filePath: path.join(directory, 'outbox.json'), limits: { maxEntries: 1, maxLineBytes: 100 } });
    const invalid = [
      trade({ eventType: 'asset_flow' }), trade({ market: 'GM' }), flow({ faction: 'MUD' }),
      trade({ line: 'asset_flow,x=y quantity=1 1' }), trade({ line: 'marketplace,x=y quantity=1\nsecret' }),
      trade({ line: 'marketplace,x=https://secret.invalid quantity=1 1' }), trade({ line: 'marketplace' }),
      trade({ line: `marketplace,x=${'a'.repeat(101)} quantity=1 1` }), trade({ extra: true }),
    ];
    for (const record of invalid) await assert.rejects(store.enqueue(record));
    await store.enqueue(trade());
    await assert.rejects(store.enqueue(trade({ signature: 'other' })), { code: 'entry_capacity' });
    await assert.rejects(store.markPublished('x', 'not-a-date'));
  });
});

test('concurrent operations across instances lose no updates', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const stores = [createMarketplaceOutbox({ filePath }), createMarketplaceOutbox({ filePath })];
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => stores[index % 2].enqueue(trade({
      signature: `sig-${index}`,
      line: `marketplace,market=LM quantity=${index + 1} 1785513600000000000`,
      quantity: index + 1,
    }))));
    assert.equal(new Set(results.map((result) => result.key)).size, 12);
    assert.equal((await stores[0].listPending()).entries.length, 12);
  });
});

test('lock failure is bounded and leaves storage untouched', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const store = createMarketplaceOutbox({ filePath, lockAdapter: { acquire: async () => { throw new Error('secret lock failure'); } } });
    await assert.rejects(store.enqueue(trade()), (error) => error.code === 'lock_failed' && !error.message.includes('secret'));
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
  });
});

test('pre-rename failure preserves the old target and removes its owned temporary file', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const base = createMarketplaceOutbox({ filePath });
    await base.enqueue(trade());
    const before = await fs.readFile(filePath, 'utf8');
    const fsAdapter = Object.create(fs);
    fsAdapter.rename = async () => { const error = new Error('stop'); error.code = 'EIO'; throw error; };
    const failing = createMarketplaceOutbox({ filePath, fsAdapter });
    await assert.rejects(failing.enqueue(trade({ signature: 'second' })), { code: 'atomic_replace_failed' });
    assert.equal(await fs.readFile(filePath, 'utf8'), before);
    assert.equal((await fs.readdir(directory)).some((name) => name.endsWith('.tmp')), false);
  });
});

test('Windows rename retries exactly through the configured transient limit', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const fsAdapter = Object.create(fs);
    let attempts = 0;
    const delays = [];
    fsAdapter.rename = async (...args) => {
      attempts += 1;
      if (attempts <= 2) { const error = new Error('busy'); error.code = attempts === 1 ? 'EPERM' : 'EBUSY'; throw error; }
      return fs.rename(...args);
    };
    const store = createMarketplaceOutbox({ filePath, fsAdapter, retryDelay: async (attempt) => { delays.push(attempt); }, limits: { renameRetries: 2 } });
    assert.equal((await store.enqueue(trade())).durability, 'confirmed');
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1, 2]);
  });
});

test('Windows rename fails after exactly the bounded retry allowance', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const fsAdapter = Object.create(fs);
    let attempts = 0;
    const delays = [];
    fsAdapter.rename = async () => { attempts += 1; const error = new Error('busy'); error.code = 'EACCES'; throw error; };
    const store = createMarketplaceOutbox({ filePath, fsAdapter, retryDelay: async (attempt) => { delays.push(attempt); }, limits: { renameRetries: 2 } });
    await assert.rejects(store.enqueue(trade()), { code: 'atomic_replace_failed' });
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1, 2]);
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
  });
});

test('post-rename directory fsync failure reports committed durability uncertainty', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const fsAdapter = Object.create(fs);
    fsAdapter.open = async (target, ...args) => {
      if (target === directory) return { sync: async () => { const error = new Error('disk'); error.code = 'EIO'; throw error; }, close: async () => {} };
      return fs.open(target, ...args);
    };
    const result = await createMarketplaceOutbox({ filePath, fsAdapter }).enqueue(trade());
    assert.deepEqual({ committed: result.committed, durability: result.durability, code: result.code }, {
      committed: true, durability: 'uncertain', code: 'directory_sync_failed',
    });
    assert.equal((await createMarketplaceOutbox({ filePath }).listPending()).entries.length, 1);
  });
});

test('malformed state is blocked, preserved, quarantined once per hash, and retention is bounded', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const c = clock();
    const store = createMarketplaceOutbox({ filePath, now: c.now, limits: { maxQuarantineCopies: 3 } });
    const contents = ['{broken-one', '{broken-two', '{broken-three', '{broken-four'];
    for (const content of contents) {
      await fs.writeFile(filePath, content, { mode: 0o600 });
      const result = await store.open();
      assert.equal(result.status, 'invalid');
      assert.equal(await fs.readFile(filePath, 'utf8'), content);
      assert.equal(JSON.stringify(result).includes(content), false);
        await store.open();
      c.tick();
    }
    const quarantines = (await fs.readdir(directory)).filter((name) => name.includes('.corrupt.'));
    assert.equal(quarantines.length, 3);
    for (const name of quarantines) assert.equal((await fs.stat(path.join(directory, name))).mode & 0o777, 0o600);
    const blocked = await store.enqueue(trade());
    assert.equal(blocked.status, 'invalid');
    assert.equal(await fs.readFile(filePath, 'utf8'), contents.at(-1));
  });
});

test('unsupported and oversized sources remain untouched and are not quarantined', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const future = JSON.stringify({ schemaVersion: 2, updatedAt: '2026-07-31T18:00:00.000Z', entries: {} });
    await fs.writeFile(filePath, future);
    const store = createMarketplaceOutbox({ filePath, limits: { maxFileBytes: 128 } });
    const unsupported = await store.open();
    assert.equal(unsupported.status, 'unsupported_version');
    assert.equal(await fs.readFile(filePath, 'utf8'), future);
    assert.equal((await fs.readdir(directory)).some((name) => name.includes('.corrupt.')), false);
    const oversized = 'x'.repeat(129);
    await fs.writeFile(filePath, oversized);
    const blocked = await store.open();
    assert.equal(blocked.status, 'invalid');
    assert.equal(blocked.diagnostic.code, 'file_too_large');
    assert.equal(await fs.readFile(filePath, 'utf8'), oversized);
    assert.equal((await fs.readdir(directory)).some((name) => name.includes('.corrupt.')), false);
  });
});

test('cleanup removes only strictly owned temporary files', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const owned = `.outbox.json.${process.pid}.123e4567-e89b-12d3-a456-426614174000.tmp`;
    const unrelated = '.outbox.json.not-owned.tmp';
    await fs.writeFile(path.join(directory, owned), 'old temp');
    await fs.writeFile(path.join(directory, unrelated), 'keep');
    await createMarketplaceOutbox({ filePath }).enqueue(trade());
    const names = await fs.readdir(directory);
    assert.equal(names.includes(owned), false);
    assert.equal(names.includes(unrelated), true);
  });
});

test('strict persisted schema rejects unknown fields and embedded-key mismatch without mutation', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const store = createMarketplaceOutbox({ filePath });
    const first = await store.enqueue(trade());
    const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
    document.entries[first.key].unknown = true;
    let corrupt = `${JSON.stringify(document)}\n`;
    await fs.writeFile(filePath, corrupt);
    assert.equal((await store.open()).status, 'invalid');
    assert.equal(await fs.readFile(filePath, 'utf8'), corrupt);

    delete document.entries[first.key].unknown;
    document.entries[first.key].key = '0'.repeat(64);
    corrupt = `${JSON.stringify(document)}\n`;
    await fs.writeFile(filePath, corrupt);
    assert.equal((await store.open()).status, 'invalid');
    assert.equal(await fs.readFile(filePath, 'utf8'), corrupt);
  });
});

test('outbox remains unreferenced by all existing production files', async () => {
  const electronDirectory = path.join(__dirname, '..', 'electron');
  const names = (await fs.readdir(electronDirectory)).filter((name) => name.endsWith('.js') && name !== 'marketplace-outbox.js');
  for (const name of names) {
    assert.equal((await fs.readFile(path.join(electronDirectory, name), 'utf8')).includes('marketplace-outbox'), false, name);
  }
});

test('malformed schema versions are quarantined with bounded nonleaking diagnostics', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const credential = 'Bearer synthetic-secret-response-body';
    const malformedVersions = [{ authorization: credential }, credential, [credential], null, 1.5];
    for (const schemaVersion of malformedVersions) {
      const source = Buffer.from(JSON.stringify({ schemaVersion, updatedAt: '2026-07-31T18:00:00.000Z', entries: {} }));
      await fs.writeFile(filePath, source);
      const result = await createMarketplaceOutbox({ filePath }).open();
      assert.equal(result.status, 'invalid');
      assert.equal(result.diagnostic.schemaVersion, null);
      assert.equal(JSON.stringify(result).includes(credential), false);
      assert.deepEqual(await fs.readFile(filePath), source);
    }
    const future = Buffer.from(JSON.stringify({ schemaVersion: 2, updatedAt: '2026-07-31T18:00:00.000Z', entries: {} }));
    await fs.writeFile(filePath, future);
    const result = await createMarketplaceOutbox({ filePath }).open();
    assert.equal(result.status, 'unsupported_version');
    assert.equal(result.diagnostic.schemaVersion, 2);
  });
});

test('invalid UTF-8 quarantine and diagnostics preserve exact source bytes and full-hash identity', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const source = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]);
    const expectedHash = require('node:crypto').createHash('sha256').update(source).digest('hex');
    await fs.writeFile(filePath, source);
    const store = createMarketplaceOutbox({ filePath });
    const first = await store.open();
    assert.equal(first.status, 'invalid');
    assert.equal(first.diagnostic.byteCount, source.length);
    assert.equal(first.diagnostic.contentHash, expectedHash.slice(0, 16));
    assert.deepEqual(await fs.readFile(filePath), source);
    let copies = (await fs.readdir(directory)).filter((name) => name.includes('.corrupt.'));
    assert.equal(copies.length, 1);
    assert.deepEqual(await fs.readFile(path.join(directory, copies[0])), source);
    await store.open();
    copies = (await fs.readdir(directory)).filter((name) => name.includes('.corrupt.'));
    assert.equal(copies.length, 1);
  });
});

test('quarantine retention is enforced even when the current full hash already exists', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const c = clock();
    const store = createMarketplaceOutbox({ filePath, now: c.now, limits: { maxQuarantineCopies: 2 } });
    for (const source of [Buffer.from('{one'), Buffer.from('{two'), Buffer.from('{three')]) {
      await fs.writeFile(filePath, source); await store.open(); c.tick();
    }
    const current = Buffer.from('{three');
    await fs.writeFile(filePath, current);
    await store.open();
    const copies = (await fs.readdir(directory)).filter((name) => name.includes('.corrupt.'));
    assert.equal(copies.length, 2);
    assert.equal((await Promise.all(copies.map((name) => fs.readFile(path.join(directory, name))))).some((value) => value.equals(current)), true);
  });
});

test('line validation accepts rpc inside identifiers and rejects credential keys and empty fields', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const store = createMarketplaceOutbox({ filePath });
    await store.enqueue(trade({
      signature: 'ArpcB123', rawMint: 'MintArpcB',
      line: 'marketplace,wallet=ArpcB123,asset=MintArpcB quantity=1,signature="ArpcB123" 1785513600000000000',
      quantity: 1,
    }));
    await store.enqueue(flow({
      flowId: 'ArpcB:2:wallet-transfer',
      line: 'asset_flow,origin=wallet\\ ArpcB,destination=CSS quantity=1,signature="ArpcB" 1785513600000000000',
    }));
    await store.enqueue(trade({
      signature: 'benign-rpc-count', rawMint: 'MintArpcBCount',
      line: 'marketplace,wallet=ArpcB123,rpc_count=2 quantity=1,rpc_count=3i,signature="ArpcB123" 1785513600000000000',
      quantity: 1,
    }));
    const sensitiveKeys = [
      'authorization', 'bearer', 'x-api-key', 'helius_api_key', 'proxy_authorization',
      'session_token', 'client_password', 'client_secret', 'set_cookie', 'request_headers',
      'primary_rpc_url', 'backup_influx_url',
    ];
    for (let index = 0; index < sensitiveKeys.length; index += 1) {
      const key = sensitiveKeys[index];
      await assert.rejects(store.enqueue(trade({
        signature: `sensitive-field-${index}`,
        line: `marketplace,x=y quantity=1,${key}="redacted" 1785513600000000000`,
        quantity: 1,
      })), { code: 'sensitive_line' });
      await assert.rejects(store.enqueue(trade({
        signature: `sensitive-tag-${index}`,
        line: `marketplace,x=y,${key}=redacted quantity=1 1785513600000000000`,
        quantity: 1,
      })), { code: 'sensitive_line' });
    }
    await assert.rejects(store.enqueue(trade({
      signature: 'bearer-value',
      line: 'marketplace,x=y quantity=1,note="Bearer redacted" 1785513600000000000',
      quantity: 1,
    })), { code: 'sensitive_line' });
    await assert.rejects(store.enqueue(trade({
      signature: 'url-value',
      line: 'marketplace,x=y quantity=1,endpoint="https://example.invalid" 1785513600000000000',
      quantity: 1,
    })), { code: 'sensitive_line' });
    await assert.rejects(store.enqueue(trade({ signature: 'empty-fields', line: 'marketplace 1785513600000000000' })), { code: 'invalid_line' });
  });
});

test('limit overrides can only reduce fixed known numeric limits', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    assert.doesNotThrow(() => createMarketplaceOutbox({ filePath, limits: { maxEntries: 50_000, renameRetries: 0 } }));
    for (const limits of [
      { maxEntries: 50_001 }, { maxFileBytes: 64 * 1024 * 1024 + 1 },
      { maxLineBytes: '8192' }, { renameRetries: 1.5 }, { unknown: 1 },
    ]) assert.throws(() => createMarketplaceOutbox({ filePath, limits }), { code: 'invalid_limits' });
  });
});

test('directory fsync permission errors are committed with uncertain durability while unsupported is confirmed', async () => {
  await withTemp(async (directory) => {
    for (const [code, expected] of [['EACCES', 'uncertain'], ['EPERM', 'uncertain'], ['EIO', 'uncertain'], ['EINVAL', 'confirmed']]) {
      const filePath = path.join(directory, `${code}.json`);
      const fsAdapter = Object.create(fs);
      fsAdapter.open = async (target, ...args) => {
        if (target === directory) return { sync: async () => { const error = new Error('dir sync'); error.code = code; throw error; }, close: async () => {} };
        return fs.open(target, ...args);
      };
      const result = await createMarketplaceOutbox({ filePath, fsAdapter }).enqueue(trade({ signature: code }));
      assert.equal(result.committed, true);
      assert.equal(result.durability, expected);
      if (expected === 'uncertain') assert.equal(result.code, 'directory_sync_failed');
    }
  });
});

test('sync and async lock release never replace committed results or mutation errors', async () => {
  await withTemp(async (directory) => {
    const cases = [
      { name: 'sync', release: () => undefined },
      { name: 'async', release: async () => undefined },
      { name: 'sync-throw', release: () => { throw new Error('release secret'); } },
      { name: 'async-reject', release: async () => { throw new Error('release secret'); } },
    ];
    for (const scenario of cases) {
      let releases = 0;
      const filePath = path.join(directory, `${scenario.name}.json`);
      const store = createMarketplaceOutbox({
        filePath,
        lockAdapter: { acquire: async () => () => { releases += 1; return scenario.release(); } },
      });
      const result = await store.enqueue(trade({ signature: scenario.name }));
      assert.equal(result.status, 'enqueued');
      assert.equal(result.committed, true);
      assert.equal(releases, 1);
    }
  });
});

test('release failure cannot replace the original mutation error', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const fsAdapter = Object.create(fs);
    fsAdapter.rename = async () => { const error = new Error('rename failed'); error.code = 'EIO'; throw error; };
    let released = false;
    const store = createMarketplaceOutbox({
      filePath, fsAdapter,
      lockAdapter: { acquire: async () => () => { released = true; throw new Error('release failed'); } },
    });
    await assert.rejects(store.enqueue(trade()), { code: 'atomic_replace_failed' });
    assert.equal(released, true);
  });
});

test('same-timestamp pending and canonical entry ordering uses explicit code-unit order', async () => {
  await withTemp(async (directory) => {
    const filePath = path.join(directory, 'outbox.json');
    const c = clock();
    const store = createMarketplaceOutbox({ filePath, now: c.now });
    await Promise.all(['z', 'A', 'a', '0'].map((signature) => store.enqueue(trade({ signature }))));
    const pending = await store.listPending();
    const expected = pending.entries.map((entry) => entry.key).slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    assert.deepEqual(pending.entries.map((entry) => entry.key), expected);
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(filePath, 'utf8')).entries), expected);
  });
});
