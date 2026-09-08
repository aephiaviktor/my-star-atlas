'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {readToolkitEvidence}=require('../electron/toolkit-evidence-reader');
const t=Date.parse('2026-09-07T00:00:00Z')/1000;
const scope={faction:'MUD',starbase:'MUD-PHANTOM',starbasePublicKey:'address'};
const a={...scope,slot:10,observedAt:t,globalTime:t,localTime:t,balance:600,depletionRate:100,reserve:3600,level:6};
const b={...a,slot:20,observedAt:t+3600};
test('shared evidence merges with legacy unuploaded observations without mutating or draining queues',async()=>{
 const old={latest:a,pairs:[]}, shared={observations:[b],localIds:['pending'],publishedIds:[]}; const before=JSON.stringify([old,shared]); let saved;
 const readLocal=async key=>key==='.observations'?old:key==='.shared'?shared:null;
 const output=await readToolkitEvidence({...scope,readLocal,readRemote:async()=>[],saveCache:async v=>saved=v,now:t+3600});
 assert.equal(output.clockWindows[0].downtimeSeconds,3000);assert.equal(JSON.stringify([old,shared]),before);
 assert.equal(saved.observations.length,2);assert.equal(output.pendingObservations,undefined);
});
test('reader preserves cached windows during remote errors and rejects foreign or malformed evidence',async()=>{
 const out=await readToolkitEvidence({...scope,now:t+3600,readLocal:async key=>key==='.reader'?{observations:[a,b,{...b,faction:'ONI'}],batches:[{anchor:a}]}:null,readRemote:async()=>{throw Error('private error');},saveCache:async()=>{throw Error('disk');}});
 assert.equal(out.clockWindows[0].downtimeSeconds,3000);assert.equal(out.sharedReadStatus,'upkeep_shared_read_failed');assert.deepEqual(out.intervals,[]);assert.doesNotMatch(JSON.stringify(out),/private/);
});
test('legacy replenishment records still replay read-only and malformed batches do not erase good ones',async()=>{
 const target={...a,slot:20,observedAt:t+3600,globalTime:t+1200,localTime:t+600,balance:1200};
 const good={anchor:a,target,events:[{time:new Date((t+1200)*1000).toISOString(),slot:15,amount:1200}]};
 const out=await readToolkitEvidence({...scope,now:t+3600,readLocal:async()=>null,readRemote:async m=>m==='starbase_upkeep_state'?[good,{anchor:a}]:[],saveCache:async()=>{}});
 assert.equal(out.intervals.length,4);assert.equal(out.intervals.filter(x=>x.multiplier===0).reduce((n,x)=>n+(Date.parse(x.stop)-Date.parse(x.start))/1000,0),1800);
});
test('production refresh exposes only reads/cache writes and has no background Toolkit collection',async()=>{
 const source=fs.readFileSync('electron/main.js','utf8');
 assert.doesNotMatch(source,/toolkitBoundaryScheduler|collectPhantomToolkitClocks|capturePhantomUpkeepState|writeUpkeepStateLineToInflux|syncUpkeepHistory/);
 const queries=[],files=new Map();
 const context={crypto,path,readToolkitEvidence:opts=>readToolkitEvidence({...opts,now:t+3600}),app:{getPath:()=>'/unused'},getInfluxBaseUrl:()=> 'base',phantomStarbaseAddress:()=>({toBase58:()=>scope.starbasePublicKey}),PHANTOM_STARBASE_COORDINATES:{MUD:{name:scope.starbase}},escapeFluxString:x=>x,
 fs:{readFile:async file=>{if(files.has(file))return JSON.stringify(files.get(file));throw Error('absent');}},writeJsonAtomic:async(file,value)=>{assert.ok(file.endsWith('.reader'));files.set(file,value);},queryInfluxFlux:async(_,q)=>{queries.push(q);return q.includes('starbase_toolkit_clock_v1')?[{_value:JSON.stringify(a)},{_value:JSON.stringify(b)}]:[];},parseInfluxCsv:x=>x};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function phantomUpkeepScope'),source.indexOf('async function fetchUpgradingOptimization')),context);
 const out=await context.fetchPhantomUpkeepCapacity({influxBucket:'primary'},'MUD');assert.equal(out.clockWindows[0].downtimeSeconds,3000);assert.equal(queries.length,2);assert.ok(queries.every(q=>q.includes('from(bucket: "primary")')));
});
