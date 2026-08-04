const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAtlasPriceResolver, INITIAL_SEED_START_UTC, INITIAL_SEED_END_UTC } = require('../electron/atlas-price-resolver');

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-price-seed-'));
  try { await run(createAtlasPriceResolver({ filePath: path.join(directory, 'prices.json'), now: () => '2026-08-04T07:30:00.000Z' })); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('frozen priceATL seed is captured once and initial UTC boundaries are inclusive', async () => fixture(async (resolver) => {
  await resolver.captureCurrentPriceSeeds({ Fuel: 2.5 });
  await resolver.captureCurrentPriceSeeds({ Fuel: 99 });
  assert.equal((await resolver.resolveAtlasPrice('Fuel', INITIAL_SEED_START_UTC)).priceATL, 2.5);
  assert.equal((await resolver.resolveAtlasPrice('Fuel', INITIAL_SEED_END_UTC)).priceATL, 2.5);
  assert.equal((await resolver.resolveAtlasPrice('Fuel', '2026-07-05')).status, 'incomplete');
  assert.equal((await resolver.resolveAtlasPrice('Fuel', '2026-08-05')).status, 'incomplete');
}));

test('exact historical price overrides seed for its date only and propagates provenance', async () => fixture(async (resolver) => {
  await resolver.captureCurrentPriceSeeds({ Fuel: 2.5 });
  const historicalByDate = { '2026-08-04': { fuel: { priceATL: 3.25, source: 'aephia_historical', provenance: 'server exact date' } } };
  const exact = await resolver.resolveAtlasPrice('Fuel', '2026-08-04T23:59:00Z', { historicalByDate });
  const prior = await resolver.resolveAtlasPrice('Fuel', '2026-08-03', { historicalByDate });
  assert.deepEqual(exact, { status: 'complete', priceATL: 3.25, effectiveUtcDate: '2026-08-04', source: 'aephia_historical', provenance: 'server exact date', estimated: false });
  assert.equal(prior.priceATL, 2.5);
  assert.equal(prior.source, 'current_price_seed');
  assert.equal(prior.estimated, true);
}));

test('missing price is incomplete and never zero', async () => fixture(async (resolver) => {
  const result = await resolver.resolveAtlasPrice('Fuel', '2026-08-04');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.priceATL, null);
}));
