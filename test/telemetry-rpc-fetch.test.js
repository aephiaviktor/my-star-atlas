'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setTelemetryRecorder, runFeature, runLogicalOperation } = require('../electron/telemetry-context');
const { createTelemetryFetch, inspectRpcMethod, rawAttemptHooks } = require('../electron/telemetry-rpc-fetch');

function collector() { const events = []; return { events, record: (event) => events.push(event), flush() {} }; }

test('single logical call records one actual transport start and completion without retaining input', async () => {
  const ledger = collector(); setTelemetryRecorder(ledger);
  const fetchImpl = async () => ({ ok: true });
  const wrapped = createTelemetryFetch(fetchImpl, { providerRole: 'main' });
  const secret = 'https://rpc.invalid/?key=not-persisted';
  await runFeature({ profile: 'USTUR', faction: 'USTUR', feature: 'Earnings', trigger: 'manual' }, () =>
    runLogicalOperation({ rpcMethod: 'getAccountInfo' }, () => wrapped(secret, { body: JSON.stringify({ method: 'getAccountInfo', params: ['wallet-not-persisted'] }) })));
  assert.equal(ledger.events.filter((event) => event.type === 'logical-start').length, 1);
  assert.equal(ledger.events.filter((event) => event.type === 'wire-start').length, 1);
  assert.equal(ledger.events.filter((event) => event.type === 'wire-complete').length, 1);
  const serialized = JSON.stringify(ledger.events);
  assert.equal(serialized.includes('rpc.invalid'), false); assert.equal(serialized.includes('wallet-not-persisted'), false);
  setTelemetryRecorder(null);
});

test('same-provider retry and fallback attempts are disjoint within one logical operation', async () => {
  const ledger = collector(); setTelemetryRecorder(ledger);
  let mainCalls = 0;
  const main = createTelemetryFetch(async () => { mainCalls += 1; if (mainCalls < 3) throw new TypeError('synthetic'); return { ok: true }; }, { providerRole: 'main' });
  const fallback = createTelemetryFetch(async () => ({ ok: true }), { providerRole: 'fallback', fallback: true });
  await runLogicalOperation({ rpcMethod: 'getAccountInfo' }, async () => {
    await assert.rejects(main('', { body: '{"method":"getAccountInfo"}' }));
    await assert.rejects(main('', { body: '{"method":"getAccountInfo"}' }));
    await main('', { body: '{"method":"getAccountInfo"}' });
    await fallback('', { body: '{"method":"getAccountInfo"}' });
  });
  const starts = ledger.events.filter((event) => event.type === 'wire-start');
  assert.deepEqual(starts.map((event) => [event.context.providerRole, event.retry, event.fallback]), [
    ['main', false, false], ['main', true, false], ['main', true, false], ['fallback', false, true],
  ]);
  setTelemetryRecorder(null);
});

test('admission refusal produces no wire attempt and preserves the exact exception', async () => {
  const ledger = collector(); setTelemetryRecorder(ledger);
  const sentinel = Object.assign(new Error('budget'), { name: 'MarketplaceRpcBudgetExhaustedError' });
  const wrapped = createTelemetryFetch(async () => assert.fail('fetch must not run'), { providerRole: 'main', admit: () => { throw sentinel; } });
  await assert.rejects(runLogicalOperation({ rpcMethod: 'getAccountInfo' }, () => wrapped('', { body: '{"method":"getAccountInfo"}' })), (error) => error === sentinel);
  assert.equal(ledger.events.some((event) => event.type === 'wire-start'), false);
  assert.equal(ledger.events.some((event) => event.type === 'counter' && event.counter === 'budgetStops'), true);
  setTelemetryRecorder(null);
});

test('raw retry hooks classify the request body at the transport boundary without changing counters', () => {
  const ledger = collector(); setTelemetryRecorder(ledger);
  const hooks = rawAttemptHooks({ providerRole: 'direct' });
  const init = { body: JSON.stringify({ method: 'getProgramAccountsV2', params: ['secret-not-persisted'] }) };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = hooks.onAttemptStart({ attempt, init });
    hooks.onAttemptFinish({ token, outcome: attempt === 4 ? 'success' : 'failure' });
  }
  const starts = ledger.events.filter((event) => event.type === 'wire-start');
  assert.equal(starts.length, 5);
  assert.equal(starts.filter((event) => event.retry).length, 4);
  assert.equal(starts.filter((event) => event.fallback).length, 0);
  assert.equal(starts.filter((event) => event.context.rpcMethod === 'getProgramAccountsV2').length, 5);
  assert.equal(starts.reduce((sum, event) => sum + Number(event.batchElements || 0), 0), 0);
  assert.equal(JSON.stringify(ledger.events).includes('secret-not-persisted'), false);
  setTelemetryRecorder(null);
});

test('raw retry hooks retain batch classification and fail closed for malformed bodies', () => {
  const ledger = collector(); setTelemetryRecorder(ledger);
  const hooks = rawAttemptHooks({ providerRole: 'fallback', fallback: true });
  hooks.onAttemptStart({ attempt: 0, init: { body: JSON.stringify([{ method: 'getBalance' }, { method: 'getAccountInfo' }]) } });
  hooks.onAttemptStart({ attempt: 1, init: { body: 'not-json' } });
  const starts = ledger.events.filter((event) => event.type === 'wire-start');
  assert.deepEqual(starts.map((event) => [event.context.rpcMethod, event.batchElements, event.retry, event.fallback]), [
    ['batch', 2, false, true],
    ['unknown', 0, true, true],
  ]);
  setTelemetryRecorder(null);
});

test('batched bodies remain one transport attempt with bounded metadata', () => {
  assert.deepEqual(inspectRpcMethod({ body: JSON.stringify([{ method: 'getBalance', params: ['secret'] }, { method: 'getBalance' }]) }), { method: 'batch', batchElements: 2 });
  assert.deepEqual(inspectRpcMethod({ body: 'not-json' }), { method: 'unknown', batchElements: 0 });
});
