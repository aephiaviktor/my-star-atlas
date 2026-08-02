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
  return { bridge: exposed.consumptionCraftingCache, exposeCalls, source };
}
const input = (faction='MUD', playerProfile='ProfileA', force=false, starbaseFilter='', recipeFilter='') => ({ faction, playerProfile, starbaseFilter, recipeFilter, force });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve=r; }); return { promise, resolve }; };

test('preload imports frozen modules and extends the existing namespace once with a fixed descriptor', () => {
  const { bridge, exposeCalls, source } = loadBridge();
  assert.equal(exposeCalls, 1);
  assert.match(source, /require\('\.\/earnings-' \+ 'cache-key'\)/);
  assert.match(source, /require\('\.\/earnings-cache-state'\)/);
  assert.equal((source.match(/exposeInMainWorld/g) || []).length, 1);
  assert.equal(bridge.buildKey(input()), 'msa:earnings-cache:{"datasetScope":"crafting-consumption-31d","faction":"MUD","filters":{"recipeFilter":"","starbaseFilter":""},"playerProfile":"ProfileA","schemaVersion":"1","section":"consumption","subtab":"crafting"}');
});

test('bridged ensure is single-flight, clone-safe, force-aware, and identity-isolated', async () => {
  const clock = { now: 0 }; const { bridge } = loadBridge(clock);
  let calls = 0; const pending = deferred();
  const loader = () => { calls++; return pending.promise; };
  const a = bridge.ensure(input(), loader); const b = bridge.ensure(input(), loader);
  await Promise.resolve(); assert.equal(calls, 1);
  pending.resolve({ ok: true, assets: [{ asset: 'A' }] });
  const [ra, rb] = await Promise.all([a,b]);
  assert.deepEqual(ra.entry.value, rb.entry.value); assert.equal(ra.entry.inFlight, false); assert.equal('inFlightPromise' in ra.entry, false);
  assert.doesNotThrow(() => structuredClone(ra));
  assert.notEqual(bridge.buildKey(input('ONI')), ra.key); assert.notEqual(bridge.buildKey(input('MUD','ProfileB')), ra.key);
  assert.notEqual(bridge.buildKey(input('MUD','ProfileA',false,'A','')), ra.key); assert.notEqual(bridge.buildKey(input('MUD','ProfileA',false,'','R')), ra.key);
  const forced = deferred(); let forcedCalls=0;
  const c=bridge.ensure(input('MUD','ProfileA',true),()=>{forcedCalls++;return forced.promise;});
  const d=bridge.ensure(input('MUD','ProfileA',true),()=>{forcedCalls++;return Promise.resolve({});});
  await Promise.resolve(); assert.equal(forcedCalls,1); forced.resolve({ok:true,assets:[{asset:'B'}]}); await Promise.all([c,d]);
});

test('delayed old-profile and old-filter completions cannot populate the active canonical entry', async () => {
  const {bridge}=loadBridge({now:7});
  const oldProfile=deferred(); const oldFilter=deferred();
  const profileA=input('MUD','ProfileA');
  const profileB=input('MUD','ProfileB');
  const filterOld=input('MUD','ProfileB',false,'SB1','OLD');
  const filterNew=input('MUD','ProfileB',false,'SB2','NEW');
  const pendingA=bridge.ensure(profileA,()=>oldProfile.promise);
  const pendingOldFilter=bridge.ensure(filterOld,()=>oldFilter.promise);
  const acceptedB=await bridge.ensure(profileB,()=>Promise.resolve({ok:true,assets:['profile-b']}));
  const acceptedNew=await bridge.ensure(filterNew,()=>Promise.resolve({ok:true,assets:['new-filter']}));
  oldProfile.resolve({ok:true,assets:['profile-a']}); oldFilter.resolve({ok:true,assets:['old-filter']});
  await Promise.all([pendingA,pendingOldFilter]);
  assert.deepEqual(bridge.inspect(profileB).entry.value,acceptedB.entry.value);
  assert.deepEqual(bridge.inspect(filterNew).entry.value,acceptedNew.entry.value);
  assert.deepEqual(bridge.inspect(profileA).entry.value,{ok:true,assets:['profile-a']});
  assert.deepEqual(bridge.inspect(filterOld).entry.value,{ok:true,assets:['old-filter']});
  assert.notEqual(bridge.buildKey(profileA),bridge.buildKey(profileB));
  assert.notEqual(bridge.buildKey(filterOld),bridge.buildKey(filterNew));
});

test('stale last-known-good is inspectable before revalidation completes', async () => {
  const clock={now:0}; const {bridge}=loadBridge(clock);
  await bridge.ensure(input(),()=>Promise.resolve({ok:true,assets:[1]}));
  clock.now=stateModule.CONSUMPTION_CRAFTING_CACHE_FRESHNESS_MS;
  const stale=bridge.inspect(input()); assert.equal(stale.entry.status,'stale'); assert.deepEqual(stale.entry.value,{ok:true,assets:[1]});
  const wait=deferred(); const revalidating=bridge.ensure(input(),()=>wait.promise);
  assert.deepEqual(bridge.inspect(input()).entry.lastGoodValue,{ok:true,assets:[1]}); wait.resolve({ok:true,assets:[2]}); await revalidating;
});

test('bridge exposes no generic invocation, module, Node, or mutation capability', () => {
  const {bridge}=loadBridge();
  assert.deepEqual(Object.keys(bridge).sort(), ['buildKey','ensure','inspect']);
  assert.equal(bridge.invalidate, undefined); assert.equal(bridge.require, undefined); assert.equal(bridge.ipcRenderer, undefined);
  assert.throws(()=>bridge.buildKey({faction:'MUD',playerProfile:'',filters:{}}));
});
