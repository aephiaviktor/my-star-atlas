'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createToolkitBoundaryScheduler } = require('../electron/toolkit-boundary-scheduler');
const { observeToolkitClock, splitToolkitClockWindow } = require('../electron/toolkit-clock-observations');
const { summarizeToolkitDowntime } = require('../electron/toolkit-downtime');
const day = 86400, midnight = Date.parse('2026-09-08T00:00:00Z') / 1000;
const state = (at, overrides = {}) => ({ faction: 'MUD', starbase: 'PHANTOM', starbasePublicKey: 'test',
  slot: at, observedAt: at, globalTime: midnight-100, localTime: midnight-100,
  balance: 50, depletionRate: 100, reserve: 1000000, level: 1, ...overrides });
test('post-midnight unchanged upkeep state allocates outage at the exact UTC boundary', () => {
  const windows = splitToolkitClockWindow({ anchor: state(midnight-60), target: state(midnight+60) });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].stop, '2026-09-08T00:00:00.000Z');
  assert.deepEqual(windows.map(w=>w.downtimeSeconds), [50,60]);
  const unknown = splitToolkitClockWindow({ anchor: state(midnight-60), target: state(midnight+60, {
    globalTime: midnight+10, localTime: midnight-50, balance: 50,
  }) });
  assert.equal(unknown.length, 1); // A later update prevents guessing the midnight split.
});
test('saved raw observations recover a complete UTC day without proration on restart', async () => {
  let saved;
  const deps = { load: async()=>structuredClone(saved), save:async value=>{saved=structuredClone(value);} };
  await observeToolkitClock({...deps,latest:state(midnight-60)});
  await observeToolkitClock({...deps,latest:state(midnight+60)});
  await observeToolkitClock({...deps,latest:state(midnight+day+60)});
  const result = await observeToolkitClock({...deps});
  const table = summarizeToolkitDowntime({...result,start:new Date(midnight*1000).toISOString(),stop:new Date((midnight+day)*1000).toISOString()});
  assert.equal(table.rows[0].coveredSeconds,day);
  assert.equal(table.rows[0].downtimeSeconds,day);
  assert.equal(table.rows[0].unknownSeconds,0);
  assert.equal(table.rows[0].estimatedDowntimeSeconds,null);
});
test('scheduler captures startup, both sides of midnight, and suspension recovery without recapturing between scheduled observations', async () => {
  let at=(midnight-3600)*1000, callback, calls=0, cleared=false;
  const scheduler=createToolkitBoundaryScheduler({now:()=>at,capture:async()=>{calls++;},
    setTimer:fn=>{callback=fn;return 1;},clearTimer:()=>{cleared=true;}});
  await scheduler.start(); assert.equal(calls,1);
  at+=30000; await callback(); assert.equal(calls,1);
  at=(midnight-300)*1000; await callback(); assert.equal(calls,2);
  at+=30000; await callback(); assert.equal(calls,3);
  at=(midnight+30)*1000; await callback(); assert.equal(calls,4);
  at=(midnight+7200)*1000; await callback(); assert.equal(calls,5);
  at+=30000; await callback(); assert.equal(calls,5);
  scheduler.stop(); await callback(); assert.equal(calls,5); assert.equal(cleared,true);
});
test('scheduler retries failures and shutdown during capture does not re-arm', async () => {
  let callback, arms=0, attempts=0, release;
  const scheduler=createToolkitBoundaryScheduler({now:()=>midnight*1000,capture:async()=>{
    if (++attempts===1) throw new Error('offline'); await new Promise(resolve=>{release=resolve;});
  },setTimer:fn=>{callback=fn;arms++;},clearTimer:()=>{}});
  await scheduler.start(); assert.equal(arms,1);
  const pending=callback(); await Promise.resolve(); scheduler.stop(); release(); await pending;
  assert.equal(attempts,2); assert.equal(arms,1);
});
test('daytime publication retries every five minutes without recapturing accounts', async () => {
 let at=(midnight+7200)*1000, callback, captures=0, retries=0;
 const scheduler=createToolkitBoundaryScheduler({now:()=>at,capture:async()=>{captures++;},retry:async()=>{retries++;},setTimer:fn=>{callback=fn;},clearTimer:()=>{}});
 await scheduler.start();
 for(let i=0;i<20;i++){at+=30000;await callback();}
 assert.equal(captures,1);assert.equal(retries,2);scheduler.stop();
});

test('hourly captures follow UTC hour changes without a second midnight pass', async () => {
  let at = Date.parse('2026-09-07T20:59:45Z'), callback;
  const captures = [], retries = [];
  const scheduler = createToolkitBoundaryScheduler({ now: () => at,
    capture: async () => { captures.push(at); }, retry: async () => { retries.push(at); },
    setTimer: fn => { callback = fn; }, clearTimer: () => {} });
  await scheduler.start();
  // Continuous ticks: hour captures must not depend on suspension recovery.
  while (at < Date.parse('2026-09-08T00:11:15Z')) { at += 30000; await callback(); }
  const iso = captures.map(value => new Date(value).toISOString());
  assert.deepEqual(iso.filter(value => value < '2026-09-07T23:55'), [
    '2026-09-07T20:59:45.000Z', '2026-09-07T21:00:15.000Z',
    '2026-09-07T22:00:15.000Z', '2026-09-07T23:00:15.000Z',
  ]);
  assert.equal(iso.filter(value => value === '2026-09-08T00:00:15.000Z').length, 1);
  assert.equal(iso.filter(value => value >= '2026-09-07T23:55' && value < '2026-09-08T00:10').length, 30);
  assert.equal(iso.filter(value => value >= '2026-09-08T00:10').length, 0);
  assert.ok(retries.length > 0);
  scheduler.stop();
});
