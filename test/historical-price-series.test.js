'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAephiaPriceSeries,
  valuationTimestampMs,
  resolveAssetAtlasPriceAtOrBefore,
  resolveSolAtlasPriceAtOrBefore,
} = require('../electron/historical-price-series');

test('historical resolver never looks ahead and preserves asset quote provenance', () => {
  const asset = parseAephiaPriceSeries({
    kind: 'asset', currency: 'ATLAS', mint: 'mint',
    columns: ['ts', 'price', 'bestBid', 'bestAsk'],
    rows: [[1000, 2, 1, 3], [3000, 6, 5, 7]],
  });
  assert.equal(resolveAssetAtlasPriceAtOrBefore(asset, 999), null);
  assert.deepEqual(resolveAssetAtlasPriceAtOrBefore(asset, 2500), {
    status: 'complete', priceATL: 2, priceATLExact: '2', effectiveTimestamp: new Date(2500).toISOString(),
    observedAt: new Date(1000).toISOString(), source: 'Aephia asset price series', currency: 'ATLAS',
    quoteField: 'price', bestBid: 1, bestAsk: 3, estimated: false,
  });
});

test('SOL to ATLAS independently forward-fills token series at or before the target timestamp', () => {
  const sol = parseAephiaPriceSeries({ kind: 'token', token: 'sol', columns: ['ts', 'price'], rows: [[1000, 100], [4000, 999]] });
  const atlas = parseAephiaPriceSeries({ kind: 'token', token: 'atlas', columns: ['ts', 'price'], rows: [[500, 0.2], [2000, 0.25], [4000, 9]] });
  const price = resolveSolAtlasPriceAtOrBefore(sol, atlas, 3000);
  assert.equal(price.priceATL, 400);
  assert.equal(price.solUsdObservedAt, new Date(1000).toISOString());
  assert.equal(price.atlasUsdObservedAt, new Date(2000).toISOString());
  assert.equal(price.source, 'Aephia SOL/USD and ATLAS/USD token series');
});

test('USDC-quoted assets convert through the latest prior ATLAS/USD token price', () => {
  const asset = parseAephiaPriceSeries({ kind: 'asset', currency: 'USDC', mint: 'mint', columns: ['ts', 'price'], rows: [[2000, 4]] });
  const atlas = parseAephiaPriceSeries({ kind: 'token', token: 'atlas', columns: ['ts', 'price'], rows: [[1000, 0.2], [3000, 99]] });
  const price = resolveAssetAtlasPriceAtOrBefore(asset, 2500, { atlasUsdSeries: atlas });
  assert.equal(price.priceATL, 20);
  assert.equal(price.atlasUsdObservedAt, new Date(1000).toISOString());
  assert.equal(price.currency, 'USDC');
});

test('date-only valuations use the latest observation at or before UTC day start', () => {
  assert.equal(valuationTimestampMs('2026-08-30'), Date.parse('2026-08-30T00:00:00.000Z'));
  assert.equal(valuationTimestampMs('2026-08-30T12:34:56Z'), Date.parse('2026-08-30T12:34:56Z'));
});
