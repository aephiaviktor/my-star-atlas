'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { queryCargoRowsWithWindowFallback } = require('../electron/cargo-influx-window-recovery');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

const NOW_MS = Date.parse('2026-08-28T11:00:00.000Z');

function parseCsv(value) {
  return String(value || '').split(',').filter(Boolean).map((id) => ({ id }));
}

test('Cargo core query returns the normal 31-day result without window fan-out', async () => {
  const calls = [];
  const rows = await queryCargoRowsWithWindowFallback({
    query: async (flux) => { calls.push(flux); return 'full'; },
    buildQuery: (range) => `query ${range}`,
    parseCsv,
    nowMs: NOW_MS,
  });
  assert.deepEqual(rows, [{ id: 'full' }]);
  assert.deepEqual(calls, ['query |> range(start: -31d)']);
});

test('Cargo core query recovers an Influx timeout through sequential seven-day windows', async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const rows = await queryCargoRowsWithWindowFallback({
    query: async (flux) => {
      calls.push(flux);
      if (calls.length === 1) throw new Error('influx_timeout_15000ms');
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return `window-${calls.length - 1}`;
    },
    buildQuery: (range) => `query ${range}`,
    parseCsv,
    nowMs: NOW_MS,
  });

  assert.equal(calls.length, 6, 'one full query plus five windows for 31 days');
  assert.equal(maxActive, 1, 'window recovery must not add Influx concurrency');
  assert.deepEqual(rows.map((row) => row.id), ['window-1', 'window-2', 'window-3', 'window-4', 'window-5']);
  assert.match(calls[1], /2026-07-29T00:00:00\.000Z/);
  assert.match(calls.at(-1), /2026-08-29T00:00:00\.000Z/);
});

test('Cargo core query does not hide non-timeout Influx errors', async () => {
  await assert.rejects(
    queryCargoRowsWithWindowFallback({
      query: async () => { throw new Error('influx_http_401'); },
      buildQuery: (range) => range,
      parseCsv,
      nowMs: NOW_MS,
    }),
    /influx_http_401/,
  );
});

test('Cargo Flux path avoids unnecessary server-side sorts and uses timeout recovery only for core rows', () => {
  const cargo = main.slice(main.indexOf('async function fetchCargoEarningsRows'), main.indexOf('async function fetchCargoVolumeEarningsRows'));
  assert.match(cargo, /queryCargoRowsWithWindowFallback\(\{/);
  assert.doesNotMatch(cargo, /\|> sort\(/);
  assert.match(cargo, /const cargoRecords = await queryCargoRowsWithWindowFallback/);
});
