'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const fixture=require('./fixtures/cargo-b3.9-2e-a-real-cycle.json');
const {buildCargoAllocationRecords,mergeCargoRowsWithCompletedAllocations,groupCargoAllocationRows}=require('../electron/influx-data');
const {filterCargoAllocationsToCompletedCycles}=require('../electron/earnings-math');
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
test('production orchestration merges completion evidence for any allocation-bearing result and keeps query availability separate',()=>{
 assert.match(main,/if \(cargoAllocationRows\.length\)[^]*fetchCargoCompletionEvidenceRows[^]*mergeCargoRowsWithCompletedAllocations/);
 assert.match(main,/const cargoAllocationAvailable = cargoAllocationResult\.status === 'fulfilled'/);
 assert.match(main,/cargoAllocationError,/);
});
test('faction/profile scope is applied independently to movement, completion, and allocation queries',()=>{
 const cargo=main.slice(main.indexOf('async function fetchCargoEarningsRows'),main.indexOf('async function fetchCargoAllocationEarningsRows'));
 const allocation=main.slice(main.indexOf('async function fetchCargoAllocationEarningsRows'),main.indexOf('async function fetchCargoCompletionEvidenceRows'));
 const completion=main.slice(main.indexOf('async function fetchCargoCompletionEvidenceRows'),main.indexOf('async function fetchCanonicalRawCargoCosts'));
 for(const source of [cargo,allocation,completion]) assert.match(source,/buildInstanceScopeFilter\(settings\)[^]*\$\{scopeFilterFlux\}/);
});
test('automatic prefetch reaches earnings IPC and renderer preserves successful allocation availability',()=>{
 assert.match(renderer,/async function runFactionBackgroundPrefetch[^]*refreshEarnings/);
 assert.match(renderer,/api\.getEarningsSnapshot\(settings\)/);
 assert.match(renderer,/renderEarningsCargo\(result\)/);
 assert.match(renderer,/renderEarningsCargoAllocations\(result\)/);
 const success=`${0} allocation rows at now${'' ? ' · Influx allocation rows unavailable' : ''}`;
 assert.doesNotMatch(success,/unavailable/);
 assert.match(renderer,/cargoAllocationAvailability === 'unavailable'/);
});

test('allocation renderer distinguishes available-empty from unavailable without a false empty state',()=>{
 assert.match(main,/cargoAllocationAvailability,/);
 assert.match(renderer,/cargoAllocationAvailability === 'unavailable'/);
 assert.match(renderer,/Cargo allocation data unavailable/);
 assert.match(renderer,/cargoAllocationAvailability === 'empty'/);
});

test('production applies explicit cutover ownership before joining Cargo rows',()=>{
 assert.match(main,/selectCutoverOwnedCargoRows\(\{/);
 assert.match(main,/cutover: cutoverSelection\.cutover/);
 assert.match(main,/legacyRows: cutoverOwnedCargoRows\.legacyRows/);
 assert.match(main,/operationalRows: cutoverOwnedCargoRows\.operationalRows/);
});
