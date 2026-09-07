'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { PublicKey } = require('@solana/web3.js');
const { BN, BorshInstructionCoder } = require('@staratlas/anchor');
const capacity = require('../electron/starbase-upkeep-capacity');
const { syncUpkeepHistory } = require('../electron/starbase-upkeep-sync');
const { observeToolkitClock } = require('../electron/toolkit-clock-observations');
const source = fs.readFileSync('electron/main.js','utf8');
const t = Date.parse('2026-09-07T00:00:00Z')/1000;
const address = new PublicKey('11111111111111111111111111111111');
const anchor = { faction:'MUD',starbase:'MUD-PHANTOM',starbasePublicKey:address.toBase58(),slot:10,observedAt:t,globalTime:t,localTime:t,balance:600,depletionRate:100,reserve:3600,level:6 };
test('production wrapper round-trips scoped replenishment evidence through local and Influx recovery', async () => {
 let saved=null, observationSaved=null, sharedSaved=null, current=anchor, remote=[], remoteClocks=[]; const writes=[];
 const context = { ...capacity, syncUpkeepHistory, observeToolkitClock, crypto, path,
   syncSharedToolkitClocks: args => require('../electron/toolkit-clock-sharing').syncSharedToolkitClocks({...args,now:t+86400}),
   TOOLKIT_CLOCK_MEASUREMENT: require('../electron/toolkit-clock-sharing').MEASUREMENT,
   createToolkitBoundaryScheduler: require('../electron/toolkit-boundary-scheduler').createToolkitBoundaryScheduler,
   phantomUpkeepFlights:new Map(), app:{getPath:()=>'/unused'},
   PHANTOM_STARBASE_COORDINATES:{MUD:{name:'MUD-PHANTOM'}}, phantomStarbaseAddress:()=>address,
   fs:{readFile:async file=>{const value=file.endsWith('.observations')?observationSaved:file.endsWith('.shared')?sharedSaved:saved;if(value)return JSON.stringify(value);throw Object.assign(new Error(),{code:'ENOENT'});}},
   writeJsonAtomic:async(file,value)=>{if(file.endsWith('.observations'))observationSaved=structuredClone(value);else if(file.endsWith('.shared'))sharedSaved=structuredClone(value);else saved=structuredClone(value);},
   getInfluxBaseUrl:()=> 'scope', escapeFluxString:v=>v,
   queryInfluxFlux:async(_,flux)=>flux.includes('starbase_toolkit_clock_v1')?remoteClocks:remote, parseInfluxCsv:v=>v,
   capturePhantomUpkeepState:async()=>current,
   createSolanaConnection:()=>({getSignaturesForAddress:async()=>[{signature:'refill',slot:15},{signature:'old',slot:9}]}),
   decodePhantomUpkeepDeposits:async()=>[{time:new Date((t+1200)*1000).toISOString(),slot:15,signature:'refill',amount:1200,instructionIndex:1,transactionIndex:0}],
   writeUpkeepStateLineToInflux:async(_,lines)=>{ writes.push(lines);if(lines.startsWith('starbase_toolkit_clock_v1')) { for(const line of lines.split('\n')) remoteClocks.push({_value:JSON.parse(line.match(/ record=("(?:\\.|[^"\\])*") /)[1])});return; }const quoted=lines.split('\n')[0].match(/ record=("(?:\\.|[^"\\])*") /)[1];remote.push({_value:JSON.parse(quoted)}); },
 };
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('const toolkitObservationFlights'),source.indexOf('async function fetchUpgradingOptimization')),context);
 const settings={influxBucket:'bucket'};
 let out=await context.fetchPhantomUpkeepCapacity(settings,'MUD');assert.equal(out.status,'baseline_only');
 current={...anchor,slot:20,observedAt:t+3600,globalTime:t+1200,localTime:t+600,balance:1200};
 out=await context.fetchPhantomUpkeepCapacity(settings,'MUD');assert.equal(out.status,'reconciled');assert.equal(out.intervals.length,4);assert.equal(out.clockWindows[0].downtimeSeconds,1800);
 assert.equal(saved.batches[0].events[0].faction,'MUD');assert.equal(saved.batches[0].events[0].starbase,'MUD-PHANTOM');
 assert.match(writes.at(-1),/effectiveCapacitySeconds=1800\.0/);
 saved=null;out=await context.fetchPhantomUpkeepCapacity(settings,'MUD');assert.equal(out.status,'unchanged');assert.equal(out.intervals.length,4);
 saved={version:2,anchor,batches:[{intervals:out.intervals}]};
 out=await context.fetchPhantomUpkeepCapacity(settings,'MUD');assert.equal(out.intervals.length,0);
 assert.equal(out.clockWindows[0].downtimeSeconds,1800);assert.equal(out.diagnostic.stage,'history_read');
 saved=null; remote=[];context.queryInfluxFlux=async()=>{throw new Error('raw URL or secret must never be returned');};
 out=await context.fetchPhantomUpkeepCapacity(settings,'MUD');assert.equal(out.clockWindows[0].downtimeSeconds,1800);
 assert.equal(out.status,'upkeep_sync_unavailable');assert.equal(out.diagnostic.stage,'history_read');
 assert.doesNotMatch(JSON.stringify(out),/raw URL|secret/);
 context.queryInfluxFlux=async()=>[];const originalWriter=context.writeUpkeepStateLineToInflux;context.writeUpkeepStateLineToInflux=async()=>{throw new Error('upkeep_influx_http_401');};
 out=await context.fetchPhantomUpkeepCapacity(settings,'MUD');assert.equal(out.clockWindows[0].downtimeSeconds,1800);
 assert.equal(out.status,'upkeep_influx_http_401');assert.equal(out.diagnostic.stage,'history_publish');
 context.capturePhantomUpkeepState=async()=>{throw new Error('provider unavailable');};
 out=await context.fetchPhantomUpkeepCapacity(settings,'MUD');assert.equal(out.clockWindows[0].downtimeSeconds,1800);
 assert.equal(out.clockStatus,'upkeep_snapshot_unavailable');assert.equal(out.diagnostic.stage,'snapshot');
 // The collector captures accounts and publishes only clock observations, never history.
 const attempted=[];
 context.readSettings=async()=>settings;
 context.capturePhantomUpkeepState=async(_,faction)=>{
   attempted.push(faction); if(faction!=='MUD') throw new Error('offline');
   return {...current,slot:21,observedAt:t+3660};
 };
 const schedulerSource=source.slice(source.indexOf('const toolkitBoundaryScheduler'),source.indexOf('async function fetchPhantomUpkeepCapacity'));
 context.createToolkitBoundaryScheduler=({capture})=>{context.boundaryCapture=capture;return {};};
 vm.runInContext(schedulerSource.replace('const toolkitBoundaryScheduler','const testBoundaryScheduler'),context);
 context.writeUpkeepStateLineToInflux=originalWriter;
 const writeCount=writes.length;
 await context.boundaryCapture();
 assert.deepEqual(attempted,['MUD','ONI','USTUR']);
 assert.equal(observationSaved.latest.slot,21);assert.ok(writes.length>writeCount);assert.ok(writes.slice(writeCount).every(line=>line.startsWith('starbase_toolkit_clock_v1')));
 const file=path.join('/unused','starbase-upkeep-v2',`${context.phantomUpkeepScope(settings,'MUD')}.json`);
 await Promise.all([
   context.recordPhantomToolkitObservation(file,'MUD',address,{...current,slot:22,observedAt:t+3720}),
   context.recordPhantomToolkitObservation(file,'MUD',address,{...current,slot:23,observedAt:t+3780}),
 ]);
 assert.equal(observationSaved.latest.slot,23);
 assert.equal(observationSaved.pairs.at(-2).target.slot,22);
 assert.equal(observationSaved.pairs.at(-1).anchor.slot,22);

});
test('decoder matches the exact Starbase account position and preserves CPI order',()=>{
 const coder=new BorshInstructionCoder(require('../electron/sage2-upkeep-idl.json'));
 const data=coder.encode('depositStarbaseUpkeepResource',{input:{pointsProgramPermissionsKeyIndex:0,sagePermissionsKeyIndex:0,resourceType:3,resourceIndex:0,amount:new BN(12),epochIndex:0}});
 const instruction={programId:'sage',accounts:['funds','sb'],data};
 const transaction={blockTime:t,slot:20,meta:{err:null,innerInstructions:[{index:0,instructions:[instruction]}]},transaction:{message:{instructions:[{...instruction,accounts:['sb','wrong']},instruction]}}};
 const rows=capacity.decodeToolkitDepositsFromTransactions({signatures:[{signature:'tx',transactionIndex:3}],transactions:[transaction],starbasePublicKey:'sb',programId:'sage',coder});
 assert.deepEqual(rows.map(r=>r.instructionIndex),[1,2]);assert.ok(rows.every(r=>r.transactionIndex===3));
 assert.throws(()=>capacity.decodeToolkitDepositsFromTransactions({signatures:[{signature:'tx'}],transactions:[null]}),/transaction_not_observed/);
});
test('overlapping independent captures merge agreement but refuse conflicting clocks',()=>{
 const interval={start:'2026-09-07T00:00:00Z',stop:'2026-09-07T01:00:00Z',multiplier:1};
 assert.equal(capacity.mergeToolkitIntervals([interval,interval]).length,1);
 assert.throws(()=>capacity.mergeToolkitIntervals([interval,{...interval,multiplier:0}]),/history_conflict/);
});
test('public finalized PHANTOM accounts decode coherently with the bundled SAGE2 layout', () => {
  for (const fixture of [require('./fixtures/phantom-upkeep-mainnet-20260907.json'), require('./fixtures/phantom-upkeep-mainnet-20260907-later.json')]) {
  const { BorshAccountsCoder } = require('@staratlas/anchor');
  const coder = new BorshAccountsCoder(require('../electron/sage2-upkeep-idl.json'));
  const data = fixture.raw.value.map(row => Buffer.from(row.data[0], 'base64'));
  assert.equal(Number(data[4].readBigUInt64LE(0)), fixture.raw.context.slot);
  const gs = coder.decode('gameState', data[3]);
  for (let i=0;i<3;i++) {
    const expected = fixture.states[i];
    const actual = capacity.projectDecodedUpkeepState({ faction:expected.faction, starbase:expected.starbase,
      starbasePublicKey:expected.starbasePublicKey, observedSlot:fixture.raw.context.slot,
      observedAt:Number(data[4].readBigInt64LE(32)), decodedStarbase:coder.decode('starbase', data[i]), decodedGameState:gs });
    assert.deepEqual(actual,expected); assert.equal(actual.depletionRate,7700);
  }
  }
});
test('boundary collector publishes a full UTC day that another installation reads despite RPC failure', async () => {
 const sharing=require('../electron/toolkit-clock-sharing');
 const midnight=t+86400, remote=new Map(), queries=[];
 let at=midnight-60, offline=true, captures=0;
 const snapshot=()=>({...anchor,slot:at,observedAt:at,globalTime:midnight-100,localTime:midnight-100,balance:50});
 function installation() {
  const disk=new Map();
  const context={...capacity,observeToolkitClock,syncUpkeepHistory,crypto,path,
   syncSharedToolkitClocks:args=>sharing.syncSharedToolkitClocks({...args,now:at+60}),TOOLKIT_CLOCK_MEASUREMENT:sharing.MEASUREMENT,
   createToolkitBoundaryScheduler:()=>({}),phantomUpkeepFlights:new Map(),app:{getPath:()=>'/isolated'},
   PHANTOM_STARBASE_COORDINATES:{MUD:{name:'MUD-PHANTOM'},ONI:{name:'ONI-PHANTOM'},USTUR:{name:'UST-PHANTOM'}},phantomStarbaseAddress:()=>address,
   fs:{readFile:async file=>{if(disk.has(file))return JSON.stringify(disk.get(file));throw Object.assign(new Error(),{code:'ENOENT'});}},
   writeJsonAtomic:async(file,value)=>disk.set(file,structuredClone(value)),getInfluxBaseUrl:()=> 'scope',escapeFluxString:v=>v,
   readSettings:async()=>({influxBucket:'primary'}),
   capturePhantomUpkeepState:async(_,faction)=>{captures++;if(faction!=='MUD')throw new Error('unavailable');return snapshot();},
   createSolanaConnection:()=>({}),
   queryInfluxFlux:async(_,flux)=>{queries.push(flux);if(flux.includes(sharing.MEASUREMENT))return [...remote.values()].map(value=>({_value:value}));throw new Error('replay unavailable');},parseInfluxCsv:v=>v,
   writeUpkeepStateLineToInflux:async(_,lines)=>{
    if(offline)throw new Error('offline');
    assert.ok(lines.startsWith(sharing.MEASUREMENT));
    for(const line of lines.split('\n')) {
     const record=JSON.parse(line.match(/ record=("(?:\\.|[^"\\])*") /)[1]);
     remote.set(sharing.observationId(JSON.parse(record)),record);
    }
   },
  };
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const toolkitObservationFlights'),source.indexOf('async function fetchUpgradingOptimization')),context);
  return {context,disk};
 }
 const mini=installation();
 await mini.context.collectPhantomToolkitClocks(true);
 at=midnight+60;await mini.context.collectPhantomToolkitClocks(true);
 at=midnight+86400+60;await mini.context.collectPhantomToolkitClocks(true);
 assert.equal(remote.size,0);assert.equal(queries.length,0);
 const before=captures;offline=false;
 await mini.context.collectPhantomToolkitClocks(false);
 assert.equal(captures,before);assert.equal(remote.size,3);assert.equal(queries.length,0);
 const main=installation();
 main.context.capturePhantomUpkeepState=async()=>{throw new Error('main-PC RPC offline');};
 const scope=main.context.phantomUpkeepScope({influxBucket:'primary'},'MUD');
 // A local replay checkpoint must not suppress shared-clock reads.
 const file=path.join('/isolated','starbase-upkeep-v2',scope+'.json');
 main.disk.set(file,{version:2,anchor:snapshot(),batches:[]});
 const out=await main.context.fetchPhantomUpkeepCapacity({influxBucket:'primary'},'MUD');
 const table=require('../electron/toolkit-downtime').summarizeToolkitDowntime({...out,start:new Date(midnight*1000).toISOString(),stop:new Date((midnight+86400)*1000).toISOString()});
 assert.equal(table.rows[0].coveredSeconds,86400);assert.equal(table.rows[0].downtimeSeconds,86400);assert.equal(table.rows[0].unknownSeconds,0);
 assert.equal(out.sharedReadStatus,'shared_read_ok');assert.equal(out.pendingObservations,0);
 assert.ok(queries[0].includes('from(bucket: "primary")'));assert.ok(queries[0].includes('range(start: -35d)'));
 main.disk.set(file+'.observations',{invalid:true});
 const recovered=await main.context.fetchPhantomUpkeepCapacity({influxBucket:'primary'},'MUD');
 assert.deepEqual(recovered.clockWindows,out.clockWindows);
});
