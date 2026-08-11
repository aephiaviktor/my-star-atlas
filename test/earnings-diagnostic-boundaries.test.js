'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'electron/renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
const start = renderer.indexOf('async function refreshEarnings()');
const end = renderer.indexOf('\nfunction optimizationFilterIso', start);
const refreshSource = renderer.slice(start, end);

function harness({ result = { ok: true, rows: [] }, renderError = null } = {}) {
  const diagnostics = [];
  const statuses = [];
  const context = {
    rendererTelemetryTrigger: 'unknown', TELEMETRY_TRIGGERS: new Set(['unknown']), earningsRefreshInFlight: null,
    latestSettings: { faction: 'MUD', playerProfile: 'profile' }, currentEarningsSubtab: 'scanning',
    getFormPayload: () => ({}), normalizeFaction: (v) => v || 'MUD', getActivePlayerProfile: () => 'profile',
    requestGuard: { begin: () => ({ id: 1 }), isCurrent: () => true }, getRefreshContext: () => ({}),
    getCachedFactionResult: () => null,
    renderEarnings: () => { if (renderError) throw renderError; },
    renderEarningsEmpty: () => {}, renderEarningsMiningEmpty: () => {}, renderEarningsCargoEmpty: () => {},
    renderEarningsMarketplaceLoading: () => {},
    setEarningsStatus: (v) => statuses.push(v), setEarningsMiningStatus: () => {}, setEarningsCargoStatus: () => {},
    api: { getEarningsSnapshot: async () => result, recordEarningsRendererError: async (payload) => { diagnostics.push(payload); return { ok: true }; } },
    console: { error: () => {} }, Promise, Error, Date, Math, Set,
  };
  vm.runInNewContext(`${refreshSource}\nthis.refreshEarnings = refreshEarnings;`, context);
  return { context, diagnostics, statuses };
}

test('successful IPC followed by renderer exception persists renderer evidence and keeps existing failure UI', async () => {
  const h = harness({ renderError: new Error('projection exploded') });
  await h.context.refreshEarnings();
  assert.equal(h.diagnostics.length, 1);
  assert.equal(h.diagnostics[0].stage, 'renderer_processing');
  assert.equal(h.diagnostics[0].error.message, 'projection exploded');
  assert.ok(h.statuses.includes('Earnings sync failed'));
});

test('backend ok:false keeps existing throw/catch UI behavior and persists renderer boundary', async () => {
  const h = harness({ result: { ok: false, error: 'backend failed' } });
  await h.context.refreshEarnings();
  assert.equal(h.diagnostics.length, 1);
  assert.equal(h.diagnostics[0].stage, 'backend_response');
  assert.ok(h.statuses.includes('Earnings sync failed'));
});

test('invalid successful IPC payload preserves render behavior and persists renderer validation evidence', async () => {
  const h = harness({ result: null });
  await h.context.refreshEarnings();
  assert.equal(h.diagnostics.length, 1);
  assert.equal(h.diagnostics[0].stage, 'renderer_validation');
});

test('successful refresh remains unchanged and writes no renderer diagnostic', async () => {
  const h = harness();
  await h.context.refreshEarnings();
  assert.equal(h.diagnostics.length, 0);
  assert.ok(!h.statuses.includes('Earnings sync failed'));
});

test('trusted IPC and telemetry wrapper failures are covered while fetch partial results remain unchanged', () => {
  assert.match(main, /catch \(error\) \{\s*if \(channel === 'earnings:snapshot'\)[\s\S]*stage: context\.stage \|\| 'trusted_ipc_preflight'/);
  assert.match(main, /stage: 'telemetry_wrapper'/);
  assert.match(main, /earningsRowResults\[index\] = \{ status: 'rejected', reason \};[\s\S]*diagnosticContext\.categories/);
  assert.match(main, /return await fetchEarningsSnapshot\(payload, diagnosticContext\);[\s\S]*return \{\s*ok: false/);
  assert.match(preload, /recordEarningsRendererError: \(payload\) => ipcRenderer\.invoke\('diagnostic:earnings-renderer', payload\)/);
  assert.match(main, /latest-earnings-error\.json/);
  assert.match(main, /latest-earnings-renderer-error\.json/);
});
