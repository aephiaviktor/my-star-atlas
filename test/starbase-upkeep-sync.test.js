'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { syncUpkeepHistory } = require('../electron/starbase-upkeep-sync');
const t = Date.parse('2026-09-07T00:00:00Z') / 1000;
const anchor = { faction: 'MUD', starbase: 'MUD-PHANTOM', starbasePublicKey: 'sb', slot: 10, observedAt: t, globalTime: t, localTime: t, balance: 3600, depletionRate: 100, reserve: 7200, level: 6 };
function setup() {
 let data = { version: 2, anchor, pending: null, batches: [] }, publications = [];
 return { get: () => structuredClone(data), publications,
 load: async () => structuredClone(data), save: async v => { data = structuredClone(v); }, capture: async () => ({ ...anchor, slot: 20, observedAt: t + 600 }),
 signatures: async () => [{ signature: 'future', slot: 30 }, { signature: 'covered', slot: 15 }, { signature: 'old', slot: 9 }],
 decode: async rows => { assert.deepEqual(rows.map(r => r.signature), ['covered']); return []; }, publish: async r => { publications.push(r); } };
}
test('snapshot slot bounds decode and published cursor; fresh reads do not advance pending target', async () => {
 const s = setup(); const out = await syncUpkeepHistory(s);
 assert.equal(out.anchor.slot, 20); assert.equal(out.batches[0].intervals.length, 1);
 assert.equal(s.publications[0].target.slot, 20);
});
test('publication failure preserves pending replay and retry is idempotent', async () => {
 const s = setup(); const publish = s.publish;
 s.publish = async () => { throw new Error('write_failed'); };
 await assert.rejects(syncUpkeepHistory(s), /write_failed/);
 assert.equal(s.get().anchor.slot, 10); assert.equal(s.get().pending.complete, true);
 s.publish = publish; s.signatures = async () => { throw new Error('must_not_rescan'); };
 const out = await syncUpkeepHistory(s); assert.equal(out.anchor.slot, 20);
});
test('bounded scans resume before persisted page while keeping original target', async () => {
 const s = setup(); s.decode = async () => [];
 s.signatures = async before => before ? [{ signature: 'old', slot: 9 }] : Array.from({ length: 1000 }, (_, i) => ({ signature: `s${i}`, slot: 15 }));
 let out = await syncUpkeepHistory({ ...s, maxPages: 1 });
 assert.equal(out.status, 'catching_up'); assert.equal(out.pending.before, 's999');
 s.capture = async () => ({ ...anchor, slot: 40, observedAt: t + 900 });
 out = await syncUpkeepHistory(s); assert.equal(out.anchor.slot, 20); assert.equal(out.latest.slot, 40);
});
test('first observation cannot invent past capacity', async () => {
 const s = setup(); s.load = async () => null;
 const out = await syncUpkeepHistory(s); assert.equal(out.status, 'baseline_only'); assert.deepEqual(out.batches, []);
});
test('missing transaction evidence preserves cursor for retry', async () => {
 const s = setup(); s.decode = async () => { throw new Error('transaction_missing'); };
 await assert.rejects(syncUpkeepHistory(s), /transaction_missing/); assert.equal(s.get().anchor.slot, 10);
});
