'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const fixture=require('./fixtures/cargo-b3.9-2e-a-real-cycle.json');
const {buildCargoAllocationRecords,mergeCargoRowsWithCompletedAllocations,groupCargoAllocationRows}=require('../electron/influx-data');
const {filterCargoAllocationsToCompletedCycles}=require('../electron/earnings-math');
const {CARGO_ALLOCATION_CHANNEL,registerCargoAllocationIpc}=require('../electron/cargo-allocation-ipc');
const {acceptCargoAllocationResponse}=require('../electron/cargo-allocation-renderer');
const main=fs.readFileSync(path.join(__dirname,'..','electron','main.js'),'utf8');
const renderer=fs.readFileSync(path.join(__dirname,'..','electron','renderer.js'),'utf8');
const includedDays=new Set(['2026-07-25']);
function snapshot(movementStatus){
 const allocations=buildCargoAllocationRecords(fixture.allocationRows,includedDays);
 const movementRows=movementStatus==='fulfilled-healthy'?[{fleet:'CF-22|01b',fleetAccount:fixture.completionRows[0].cycleId.split(':')[0],assignment:'Supply Chain',timestamp:'2026-07-25T03:00:00Z',burnedFuel:17835.494841372823,txCostSol:0.000003750409485994295,cargoVolume:93888,cargoCycles:1,cargoLegs:3,completedCycleIds:[fixture.completionRows[0].cycleId],movementCycleIds:[fixture.completionRows[0].cycleId]}]:[];
 const cargoRows=mergeCargoRowsWithCompletedAllocations({movementRows,completionRows:fixture.completionRows,allocationRows:allocations,includedDays});
 const cargoAllocationRows=groupCargoAllocationRows(filterCargoAllocationsToCompletedCycles(allocations,cargoRows));
 return {cargoRows,cargoAllocationRows,cargoAllocationError:''};
}
test('real automatic payload recovers 1 Cargo row and 5 allocation rows for fulfilled-empty movement',()=>{
 const result=snapshot('fulfilled-empty'); assert.equal(result.cargoRows.length,1); assert.equal(result.cargoAllocationRows.length,5);
});
test('real automatic payload recovers the same 1/5 result for rejected movement',()=>{
 const result=snapshot('rejected'); assert.equal(result.cargoRows.length,1); assert.equal(result.cargoAllocationRows.length,5);
});
test('healthy movement does not duplicate real costs, cycles, legs, volume, or allocations',()=>{
 const result=snapshot('fulfilled-healthy'); const row=result.cargoRows[0];
 assert.equal(result.cargoRows.length,1); assert.equal(result.cargoAllocationRows.length,5);
 assert.equal(row.burnedFuel,17835.494841372823); assert.equal(row.txCostSol,0.000003750409485994295); assert.equal(row.cargoVolume,93888); assert.equal(row.cargoCycles,1); assert.equal(row.cargoLegs,3);
});
test('shared Earnings never starts, awaits, or returns Allocation',()=>{
 const shared=main.slice(main.indexOf('async function fetchEarningsSnapshot'),main.indexOf('function createWindow'));
 assert.doesNotMatch(shared,/fetchCargoAllocation|cargoAllocationSource|cargoAllocationResult|cargoAllocationRows|cargoAllocationError/);
 let registered;
 registerCargoAllocationIpc((channel,handler)=>{registered={channel,handler};},{runTelemetry:async(p,n,fn)=>fn(),loadAllocation:async()=>({ok:true})});
 assert.equal(registered.channel,CARGO_ALLOCATION_CHANNEL);
});
test('faction/profile scope is applied independently to movement, completion, and allocation queries',()=>{
 const cargo=main.slice(main.indexOf('async function fetchCargoEarningsRows'),main.indexOf('async function fetchCargoVolumeEarningsRows'));
 const allocation=main.slice(main.indexOf('const cargoAllocationSource'),main.indexOf('async function fetchCargoAllocationSnapshot'));
 const completion=main.slice(main.indexOf('async function fetchCargoCompletionEvidenceRows'),main.indexOf('const cargoAllocationSource'));
 for(const source of [cargo,completion]) assert.match(source,/buildInstanceScopeFilter\(settings\)[^]*\$\{scopeFilterFlux\}/);
 assert.match(allocation,/buildInstanceScopeFilter\(settings\)/);
});
test('automatic prefetch reaches only shared Earnings while Allocation is on demand',()=>{
 assert.match(renderer,/async function runFactionBackgroundPrefetch[^]*refreshEarnings/);
 assert.match(renderer,/api\.getEarningsSnapshot\(settings\)/);
 assert.match(renderer,/activeCargoTable === 'allocation'\) refreshCargoAllocation\(\)/);
});
test('allocation renderer distinguishes empty, loading, and unavailable states',()=>{
 const scope={faction:'MUD',playerProfile:'player'};
 assert.equal(acceptCargoAllocationResponse({ok:true,availability:'empty',rows:[]},scope,scope).state.cargoAllocationAvailability,'empty');
 assert.equal(acceptCargoAllocationResponse({ok:false},scope,scope).state.cargoAllocationAvailability,'unavailable');
 assert.match(renderer,/cargoAllocationAvailability === 'unavailable'/);
 assert.match(renderer,/cargoAllocationAvailability === 'empty'/);
 assert.match(renderer,/cargoAllocationAvailability: 'loading'/);
});

test('production applies explicit cutover ownership before joining Cargo rows',()=>{
 assert.match(main,/selectCutoverOwnedCargoRows\(\{/);
 assert.match(main,/cutover: cutoverSelection\.cutover/);
 assert.match(main,/legacyRows: cutoverOwnedCargoRows\.legacyRows/);
 assert.match(main,/operationalRows: cutoverOwnedCargoRows\.operationalRows/);
});
