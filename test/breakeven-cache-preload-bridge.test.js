'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const keyModule = require('../electron/earnings-cache-key');
const stateModule = require('../electron/earnings-cache-state');

function loadBridge(clock = { now: 0 }) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  let exposed = null, exposeCalls = 0;
  const context = {
    require(id) {
      if (id === 'electron') return { contextBridge: { exposeInMainWorld(name, api) { exposeCalls++; assert.equal(name, 'myStarAtlas'); exposed = api; } }, ipcRenderer: { invoke() { throw new Error('IPC not expected'); } } };
      if (id === './earnings-cache-key') return { buildEarningsCacheKey: (descriptor) => keyModule.buildEarningsCacheKey(JSON.parse(JSON.stringify(descriptor))) };
      if (id === './earnings-cache-state') return { ...stateModule, createEarningsCacheState: () => stateModule.createEarningsCacheState({ now: () => clock.now }) };
      throw new Error(`unexpected require ${id}`);
    },
    console,
  };
  vm.runInNewContext(source, context, { filename: 'preload.js' });
  return { bridge: exposed.breakevenCache, exposeCalls, source };
}
const input = (faction='MUD', playerProfile='ProfileA', force=false) => ({ faction, playerProfile, filters: {}, force });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve=r; }); return { promise, resolve }; };

test('preload imports frozen modules and extends the existing namespace once with a fixed descriptor', () => {
  const { bridge, exposeCalls, source } = loadBridge();
  assert.equal(exposeCalls, 1);
  assert.match(source, /require\('\.\/earnings-' \+ 'cache-key'\)/);
  assert.match(source, /require\('\.\/earnings-cache-state'\)/);
  assert.equal((source.match(/exposeInMainWorld/g) || []).length, 1);
  assert.equal(bridge.buildKey(input()), 'msa:earnings-cache:{"datasetScope":"complete","faction":"MUD","filters":{},"playerProfile":"ProfileA","schemaVersion":"1","section":"earnings","subtab":"breakeven"}');
});

test('bridged ensure is single-flight, clone-safe, force-aware, and identity-isolated', async () => {
  const clock = { now: 0 }; const { bridge } = loadBridge(clock);
  let calls = 0; const pending = deferred();
  const loader = () => { calls++; return pending.promise; };
  const a = bridge.ensure(input(), loader); const b = bridge.ensure(input(), loader);
  await Promise.resolve(); assert.equal(calls, 1);
  pending.resolve({ ok: true, breakevenRows: [{ asset: 'A' }] });
  const [ra, rb] = await Promise.all([a,b]);
  assert.deepEqual(ra.entry.value, rb.entry.value); assert.equal(ra.entry.inFlight, false); assert.equal('inFlightPromise' in ra.entry, false);
  assert.doesNotThrow(() => structuredClone(ra));
  assert.notEqual(bridge.buildKey(input('ONI')), ra.key); assert.notEqual(bridge.buildKey(input('MUD','ProfileB')), ra.key);
  const forced = deferred(); let forcedCalls=0;
  const c=bridge.ensure(input('MUD','ProfileA',true),()=>{forcedCalls++;return forced.promise;});
  const d=bridge.ensure(input('MUD','ProfileA',true),()=>{forcedCalls++;return Promise.resolve({});});
  await Promise.resolve(); assert.equal(forcedCalls,1); forced.resolve({ok:true,breakevenRows:[{asset:'B'}]}); await Promise.all([c,d]);
});

test('stale last-known-good is inspectable before revalidation completes', async () => {
  const clock={now:0}; const {bridge}=loadBridge(clock);
  await bridge.ensure(input(),()=>Promise.resolve({ok:true,breakevenRows:[1]}));
  clock.now=stateModule.BREAKEVEN_CACHE_FRESHNESS_MS;
  const stale=bridge.inspect(input()); assert.equal(stale.entry.status,'stale'); assert.deepEqual(stale.entry.value,{ok:true,breakevenRows:[1]});
  const wait=deferred(); const revalidating=bridge.ensure(input(),()=>wait.promise);
  assert.deepEqual(bridge.inspect(input()).entry.lastGoodValue,{ok:true,breakevenRows:[1]}); wait.resolve({ok:true,breakevenRows:[2]}); await revalidating;
});

test('bridge exposes no generic invocation, module, Node, or mutation capability', () => {
  const {bridge}=loadBridge();
  assert.deepEqual(Object.keys(bridge).sort(), ['buildKey','ensure','inspect']);
  assert.equal(bridge.invalidate, undefined); assert.equal(bridge.require, undefined); assert.equal(bridge.ipcRenderer, undefined);
  assert.throws(()=>bridge.buildKey({faction:'MUD',playerProfile:'',filters:{}}));
});
