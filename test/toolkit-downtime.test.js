'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeToolkitDowntime } = require('../electron/toolkit-downtime');
const options = { faction:'MUD', starbase:'MUD-PHANTOM', start:'2026-09-06T00:00:00Z', stop:'2026-09-07T00:00:00Z' };
const interval = (start,stop,multiplier) => ({start:`2026-09-06T${start}:00Z`,stop:`2026-09-06T${stop}:00Z`,multiplier});
test('partial coverage preserves known downtime and separately estimates the unknown period', () => {
 const [r] = summarizeToolkitDowntime({...options, intervals:[interval('00:00','01:00',1),interval('01:00','02:00',0)]}).rows;
 assert.equal(r.coveredSeconds,7200); assert.equal(r.downtimeSeconds,3600); assert.equal(r.unknownSeconds,79200);
 assert.equal(r.estimatedDowntimeSeconds,43200); assert.equal(r.evidenceStatus,'Partial · estimate');
});
test('missing history is unknown, not zero downtime or an invented estimate', () => {
 const [r] = summarizeToolkitDowntime(options).rows;
 assert.equal(r.unknownSeconds,86400); assert.equal(r.downtimeSeconds,null); assert.equal(r.estimatedDowntimeSeconds,null);
});
test('duplicate windows are deduplicated and conflicts affect only overlapping time', () => {
 const active=interval('00:00','04:00',1);
 const [r] = summarizeToolkitDowntime({...options, intervals:[active,active,interval('01:00','02:00',0)]}).rows;
 assert.equal(r.coveredSeconds,10800); assert.equal(r.downtimeSeconds,0); assert.equal(r.unknownSeconds,75600);
});
test('UTC day boundaries and partial current day never count future time', () => {
 const rows=summarizeToolkitDowntime({...options,start:'2026-09-06T23:00:00Z',stop:'2026-09-07T01:00:00Z', intervals:[{start:'2026-09-06T23:30:00Z',stop:'2026-09-07T02:00:00Z',multiplier:0}]}).rows;
 assert.equal(rows.length,2); assert.equal(rows[0].periodSeconds,3600); assert.equal(rows[0].downtimeSeconds,3600);
 assert.equal(rows[0].unknownSeconds,0); assert.equal(rows[0].estimatedDowntimeSeconds,null); assert.equal(rows[1].downtimeSeconds,1800);
});

test('table renders unknown versus observed zero and clears stale rows on refresh', () => {
 const fs=require('node:fs'), vm=require('node:vm');
 const source=fs.readFileSync('electron/renderer.js','utf8');
 const element=()=>({children:[],append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];}});
 const body=element(), status=element();
 const context={document:{querySelector:selector=>selector.endsWith('-body')?body:status,createElement:element}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function renderToolkitDowntime('),source.indexOf('function renderUpgradingOptimizationAnalytics()')),context);
 context.renderToolkitDowntime({toolkitDowntime:summarizeToolkitDowntime(options)});
 assert.equal(body.children[0].children[3].textContent,'--');
 assert.equal(body.children[0].children[4].textContent,'24h 0m 0s');
 context.renderToolkitDowntime({toolkitDowntime:summarizeToolkitDowntime({...options,intervals:[interval('00:00','01:00',1)]})});
 assert.equal(body.children.length,1);assert.equal(body.children[0].children[3].textContent,'0h 0m 0s');
 assert.equal(body.children[0].children[5].textContent,'~0h 0m 0s');
 context.renderToolkitDowntime({});assert.equal(body.children.length,1);assert.equal(body.children[0].children[0].colSpan,7);
});

test('Toolkit evidence is returned separately and is not passed into chart calculations', () => {
 const fs=require('node:fs'); const main=fs.readFileSync('electron/main.js','utf8');
 const call=main.match(/const selectionUtilizationV1 = calculateUpgradingSelectionUtilization\(([^\n]+)\);/)[1];
 assert.doesNotMatch(call,/upkeep|capacityIntervals|capacityEvidenceRequired|toolkit/i);
 assert.match(main,/selectionUtilizationV1, toolkitDowntime, playerProfile/);
 assert.match(main,/fetchPhantomUpkeepCapacity\(settings, aephiaFaction\)\.catch/);
});
