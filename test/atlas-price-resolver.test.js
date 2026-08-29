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
  const provisional = await resolver.resolveAtlasPrice('Fuel', '2026-08-05');
  assert.equal(provisional.status, 'provisional');
  assert.equal(provisional.priceDay, '2026-08-04');
  assert.equal(provisional.source, 'provisional_seed_carry_forward');
}));

test('exact historical price overrides seed for its date only and propagates provenance', async () => fixture(async (resolver) => {
  await resolver.captureCurrentPriceSeeds({ Fuel: 2.5 });
  const historicalByDate = { '2026-08-04': { fuel: { priceATL: 3.25, source: 'aephia_historical', provenance: 'server exact date' } } };
  const exact = await resolver.resolveAtlasPrice('Fuel', '2026-08-04T23:59:00Z', { historicalByDate });
  const prior = await resolver.resolveAtlasPrice('Fuel', '2026-08-03', { historicalByDate });
  assert.deepEqual(exact, { status: 'complete', priceATL: 3.25, priceATLExact: '3.25', effectiveUtcDate: '2026-08-04', priceDay: '2026-08-04', source: 'aephia_historical', provenance: 'server exact date', estimated: false });
  assert.equal(prior.priceATL, 3.25);
  assert.equal(prior.source, 'aephia_historical');
  assert.equal(prior.estimated, true);
}));

test('historical gaps carry earlier prices forward and dates before coverage use the oldest price', async () => fixture(async (resolver) => {
  const historicalByDate = {
    '2026-08-10': { fuel: { priceATL: 3, observedAt: '2026-08-10T00:05:00Z' } },
    '2026-08-12': { fuel: { priceATL: 5, observedAt: '2026-08-12T00:01:00Z' } },
  };
  const before = await resolver.resolveAtlasPrice('Fuel', '2026-08-01', { historicalByDate });
  const gap = await resolver.resolveAtlasPrice('Fuel', '2026-08-11', { historicalByDate });
  const after = await resolver.resolveAtlasPrice('Fuel', '2026-08-20', { historicalByDate });
  assert.deepEqual([before.priceATL, gap.priceATL, after.priceATL], [3, 3, 5]);
  assert.deepEqual([before.source, gap.source, after.source], [
    'aephia_series_backfilled_oldest', 'aephia_series_carried_forward', 'aephia_series_carried_forward',
  ]);
  assert.deepEqual([before.estimated, gap.estimated, after.estimated], [true, true, true]);
}));

test('missing price is incomplete and never zero', async () => fixture(async (resolver) => {
  const result = await resolver.resolveAtlasPrice('Fuel', '2026-08-04');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.priceATL, null);
}));
