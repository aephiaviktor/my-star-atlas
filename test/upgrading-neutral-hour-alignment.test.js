'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildNeutralHours, calculateUpgradingSelectionUtilization, recoverSelectionComponentPrices } = require('../electron/upgrading-selection-utilization');
const source = fs.readFileSync('electron/main.js', 'utf8');
async function load(rows) {
  const context = { escapeFluxString: x => x, buildInstanceScopeFilter: () => '', queryInfluxFlux: async (_, flux) => { assert.match(flux, /r\._field == "snapshot_for_hour"/); return ''; }, parseInfluxCsv: () => rows,
    normalizeShipName: x => x.toLowerCase(), resolveHistoricalAtlasPrice: async () => ({ status: 'complete', priceATL: 0 }), UPGRADE_LP_BY_COMPONENT: {} };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function fetchDailyNeutralUpgradingPlan'), source.indexOf('function optimizationNumberQuantile')), context);
  return (await context.fetchDailyNeutralUpgradingPlan({ influxUrl: 'test', influxAuthToken: 'test', influxBucket: 'test' })).hourlyAllocations;
}
test('intended hour crosses UTC midnight; latest recording wins, legacy rows still work', async () => {
  const rows = [
    { _time: '2026-09-07T00:02:00Z', snapshot_for_hour: '2026-09-07T00:00:00Z', component: 'framework', neutral_crew: '20' },
    { _time: '2026-09-06T23:51:00Z', snapshot_for_hour: '2026-09-07T00:00:00Z', component: 'framework', neutral_crew: '10' },
    { _time: '2026-09-07T01:12:00Z', component: 'framework', neutral_crew: '30' },
  ];
  const hours = buildNeutralHours(await load(rows));
  assert.equal(hours.get('2026-09-07T00').get('framework'), 20);
  assert.equal(hours.get('2026-09-07T01').get('framework'), 30);
  assert.equal(hours.has('2026-09-06T23'), false);
});
const job = hour => ({ component: 'framework', amount: 300, crew: 1, startedAt: `2026-09-07T${hour}:00:00Z`, completedAt: `2026-09-07T${String(Number(hour)+1).padStart(2,'0')}:00:00Z` });
const base = { pricesByDate: { '2026-09-07': { framework: 0 } }, atlasPerLpByDate: { '2026-09-07': .1 }, faction: 'MUD', profile: 'a' };
test('one-hour preceding recovery is explicit, scoped, non-chaining and does not replace zero', async () => {
  const neutralHours = [{ time: '2026-09-07T00:00:00Z', component: 'framework', neutral_crew: 1, faction: 'MUD', profile: 'a' },
    { time: '2026-09-07T01:00:00Z', component: 'framework', neutral_crew: 999, faction: 'ONI', profile: 'a' },
    { time: '2026-09-07T01:00:00Z', component: 'framework', neutral_crew: 999, faction: 'MUD', profile: 'b' }];
  const first = calculateUpgradingSelectionUtilization({ ...base, neutralHours, jobs: [job('01')] }).selection[0];
  assert.equal(first.display_available, true); assert.equal(first.evidence_complete, false);
  assert.deepEqual(first.estimated_neutral_hours, [{ hour: '2026-09-07T01', source_hour: '2026-09-07T00' }]);
  assert.equal(calculateUpgradingSelectionUtilization({ ...base, neutralHours, jobs: [job('01'), job('02')] }).selection[0].display_available, false);
  assert.equal(calculateUpgradingSelectionUtilization({ ...base, neutralHours: [...neutralHours, { time: '2026-09-07T01:00:00Z', component: 'framework', neutral_crew: 0 }], jobs: [job('01')] }).selection[0].display_available, false);
  const calls = [];
  await recoverSelectionComponentPrices({ ...base, pricesByDate: {}, neutralHours, jobs: [job('01')], resolvePrice: async (...args) => { calls.push(args); return { status: 'complete', priceATL: 1 }; } });
  assert.deepEqual(calls, [['framework', '2026-09-07']]);
});
test('actual September 7 telemetry through production loader restores all three dots', async () => {
  const expected = { MUD: 1359.63, ONI: 461.41, USTUR: 143.70 };
  for (const fixture of require('./fixtures/selection-sep7-neutral.json')) {
    const neutralHours = await load(fixture.sourceRows);
    const row = calculateUpgradingSelectionUtilization({ ...fixture, neutralHours }).selection.find(r => r.date === '2026-09-07');
    assert.equal(row.display_available, true, fixture.faction);
    assert.ok(Math.abs(row.selection_uplift_atlas - expected[fixture.faction]) < .01, `${fixture.faction}: ${row.selection_uplift_atlas}`);
    assert.equal(row.estimated_neutral_hours.length, fixture.faction === 'MUD' ? 1 : 0);
  }
});
test('estimated September 7 dot renders with source-hour tooltip while today stays excluded', () => {
  const renderer = fs.readFileSync('electron/renderer.js','utf8');
  const element = () => ({ children: [], append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children=[]; } });
  const container=element(), dots=[], tips=[];
  const row=calculateUpgradingSelectionUtilization({ ...base, jobs: [job('01')], neutralHours: [{ time:'2026-09-07T00:00:00Z', component:'framework', neutral_crew:1 }] }).selection[0];
  const context={ Date: class extends Date { static now(){ return Date.parse('2026-09-08T12:00:00Z'); } }, document:{createElement:element}, hideOptimizationAnalyticsTooltip(){}, getUpgradingV1ChartStartDate:()=> '2026-08-14', optimizationUpgradingSelectionV1:container, optimizationUpgradingUtilizationV1:null, upgradingSelectionChartView:{},
    createOptimizationAnalyticsSvg(c){const svg=element();c.append(svg);return svg;}, renderUpgradingChartAxes(){return {left:30,right:10,top:10,bottom:30,width:760,height:340,x:x=>x,y:y=>y};},
    appendOptimizationSvg(parent,tag,attrs){const node=Object.assign(element(),{tag,...attrs});parent.append(node);if(tag==='circle')dots.push(node);return node;}, bindOptimizationAnalyticsTooltip(_,text){tips.push(text);},bindUpgradingAnalyticsChartNavigation(){} };
  vm.createContext(context);
  vm.runInContext(renderer.slice(renderer.indexOf('function renderUpgradingSelectionUtilizationV1('),renderer.indexOf('function renderToolkitDowntime(')),context);
  context.renderUpgradingSelectionUtilizationV1({ selectionUtilizationV1:{ selection:[row,{...row,date:'2026-09-08'}] } });
  assert.equal(dots.length,1); assert.match(tips[0],/Estimated neutral allocation: 2026-09-07T01 UTC from 2026-09-07T00 UTC/);
});
