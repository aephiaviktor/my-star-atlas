'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharing = require('../electron/toolkit-clock-sharing');
const t = Date.parse('2026-09-07T00:00:00Z') / 1000;
const state = { faction:'MUD',starbase:'MUD-PHANTOM',starbasePublicKey:'public-address',slot:10,observedAt:t,globalTime:t,localTime:t,balance:600,depletionRate:100,reserve:3600,level:6 };
const target = {...state,slot:20,observedAt:t+3600};
test('shared raw observations deduplicate across installations and reject foreign scope', () => {
 const rows=sharing.mergeClockObservations([state,{...state,privateSetting:'discard'},target,{...target,faction:'ONI'},{...target,starbasePublicKey:'foreign'}],state,t+3600);
 assert.equal(rows.length,2);
 assert.equal(sharing.sharedClockWindows(rows)[0].downtimeSeconds,3000);
 assert.equal(sharing.formatClockObservation(rows[0]),sharing.formatClockObservation(sharing.canonicalObservation({...state,privateSetting:'discard'},state)));
 assert.doesNotMatch(sharing.formatClockObservation(rows[0]),/privateSetting/);
});
test('conflicting finalized slot prevents arbitrary history selection but later windows recover', () => {
 const rows=sharing.mergeClockObservations([state,{...state,balance:300},target,{...target,slot:30,observedAt:t+7200}],state,t+7200);
 const windows=sharing.sharedClockWindows(rows);
 assert.equal(windows.length,1);assert.equal(windows[0].start,new Date((t+3600)*1000).toISOString());
 assert.equal(windows[0].downtimeSeconds,3600);
});
test('mini-PC queues offline observations, retries on restart, and main PC derives same downtime', async () => {
 let disk=null, remote=[], fail=true; const writes=[];
 const deps={scope:state,now:t+3600,load:async()=>structuredClone(disk),save:async value=>{disk=structuredClone(value);},publish:async lines=>{writes.push(lines);if(fail)throw new Error('private transport detail');remote.push(...lines.split('\n').map(line=>JSON.parse(JSON.parse(line.match(/ record=("(?:\\.|[^"\\])*") /)[1]))));}};
 let out=await sharing.syncSharedToolkitClocks({...deps,local:[state,target]});
 assert.equal(out.pendingObservations,2);assert.equal(out.clockWindows[0].downtimeSeconds,3000);
 assert.equal(out.sharedWriteStatus,'upkeep_shared_publish_failed');assert.doesNotMatch(JSON.stringify(out),/private transport/);
 fail=false;out=await sharing.syncSharedToolkitClocks(deps);assert.equal(out.pendingObservations,0);assert.equal(writes[0],writes[1]);
 await sharing.syncSharedToolkitClocks({...deps,local:[state,target]});assert.equal(writes.length,2);
 let mainDisk=null;
 const main={...deps,load:async()=>mainDisk,save:async value=>{mainDisk=structuredClone(value);},readRemote:async()=>[...remote,...remote],publish:async()=>{throw new Error('must not republish imported data');}};
 out=await sharing.syncSharedToolkitClocks(main);assert.equal(out.clockWindows[0].downtimeSeconds,3000);assert.equal(out.sharedObservationCount,2);assert.equal(out.pendingObservations,0);
 out=await sharing.syncSharedToolkitClocks({...main,readRemote:async()=>{throw new Error('offline');}});
 assert.equal(out.clockWindows[0].downtimeSeconds,3000);assert.equal(out.sharedReadStatus,'upkeep_shared_read_failed');
});
test('failed durable save prevents publication and retention excludes expired/future observations',async()=>{
 let writes=0;
 const out=await sharing.syncSharedToolkitClocks({scope:state,local:[state,target],now:t+3600,load:async()=>null,save:async()=>{throw new Error('disk');},publish:async()=>{writes++;}});
 assert.equal(writes,0);assert.equal(out.pendingObservations,2);assert.equal(out.sharedWriteStatus,'upkeep_shared_save_failed');
 assert.equal(sharing.mergeClockObservations([state,{...target,observedAt:t+36*86400}],state,t+35*86400+1).length,0);
});
