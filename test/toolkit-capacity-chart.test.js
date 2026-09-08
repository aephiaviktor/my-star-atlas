'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { project } = require('../electron/toolkit-capacity-chart');
const row = {date:'2026-09-08', configured_crew_hours:8000, protocol_active_crew_hours:6200, claim_locked_crew_hours:1580, capacity_not_observed_crew_hours:220, protocol_active_percent:77.5};
const evidence = {coveredSeconds:990, periodSeconds:1000, downtimeSeconds:168.3};
test('17% estimate reclassifies yellow without changing productive work and conserves total/net stacks', () => {
  const total=project(row,evidence), net=project(row,evidence,true);
  assert.equal(total.toolkit_downtime_crew_hours,1360);
  assert.equal(total.claim_locked_crew_hours,220);
  assert.equal(total.protocol_active_crew_hours,6200);
  assert.equal(net.protocol_active_crew_hours,6200);
  assert.equal(net.toolkit_downtime_percent,0);
  assert.equal(total.toolkit_downtime_percent,17);
  assert.ok(Math.abs(net.protocol_active_percent+net.claim_locked_percent+net.capacity_not_observed_percent-100)<1e-9);
  assert.equal(row.claim_locked_crew_hours,1580);
});
test('cutover and missing observations preserve original values',()=>{
  assert.equal(project({...row,date:'2026-09-07'},evidence,true).protocol_active_percent,77.5);
  assert.equal(project(row,{coveredSeconds:0},true).claim_locked_crew_hours,1580);
  assert.match(project(row,null).warnings[0],/No Toolkit observations/);
});
test('sparse coverage warns; genuine zero is an adjustment, not missing evidence',()=>{
  assert.match(project(row,{...evidence,periodSeconds:2000}).warnings[0],/uncovered/);
  assert.equal(project(row,{...evidence,downtimeSeconds:0}).adjusted,true);
});
test('downtime consumes grey after yellow, preserves mismatch instead of inflating capacity',()=>{
  const result=project(row,{...evidence,downtimeSeconds:495});
  assert.equal(result.claim_locked_crew_hours,0);
  assert.equal(result.capacity_not_observed_crew_hours,0);
  assert.equal(result.configured_crew_hours,8000);
  assert.equal(result.protocol_active_crew_hours,6200);
  assert.match(result.warnings.join(' '),/exceeds/);
});
test('all downtime and zero net capacity remain finite and visible with warning',()=>{
  const result=project(row,{...evidence,downtimeSeconds:990},true);
  assert.equal(result.net,true);
  assert.equal(result.toolkit_downtime_percent,0);
  assert.ok(Number.isFinite(result.protocol_active_percent));
  assert.match(result.warnings.join(' '),/Zero net capacity/);
});
test('real renderer click toggles axes and red bars; legend survives SVG creation and missing coverage renders',()=>{
  const fs=require('node:fs'), vm=require('node:vm');
  const source=fs.readFileSync('electron/renderer.js','utf8');
  const element=()=>({children:[],style:{setProperty(){}},classList:{toggle(){}},setAttribute(k,v){this[k]=v;},append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},addEventListener(_,fn){this.click=fn;}});
  const container=element(), button=element(); let axis, tips=[];
  const ctx={document:{querySelector:()=>button,createElement:element},ToolkitCapacityChart:{project},hideOptimizationAnalyticsTooltip(){}, getUpgradingV1ChartStartDate:()=> '2026-08-14', optimizationUpgradingSelectionV1:null, optimizationUpgradingUtilizationV1:container, optimizationUpgradingClaimLockV1:null, optimizationUpgradingOperationalV1:null,
  createOptimizationAnalyticsSvg(c){c.replaceChildren();const svg=element();c.append(svg);return svg;},
  renderUpgradingChartAxes(_,a){axis=a;return {x:v=>v*100,y:v=>340-v};},
  appendOptimizationSvg(svg,tag,attrs){const e={tag,...attrs};svg.append(e);return e;}, bindOptimizationAnalyticsTooltip(_,tip){tips.push(tip);}};
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('let upgradingNetCapacity = false;'),source.indexOf('function renderToolkitDowntime(')),ctx);
  const data={selectionUtilizationV1:{utilization:[{...row,identity_complete:true}]},toolkitDowntime:{rows:[{date:row.date,...evidence}]}};
  ctx.renderUpgradingSelectionUtilizationV1(data);
  assert.equal(axis.yLabel,'% of total capacity');
  assert.ok(container.children[0].children.some(e=>e.fill==='#ef4444' && e.height>0));
  assert.ok(container.children.some(e=>e.className==='optimization-v1-legend'));
  assert.ok(tips.some(t=>t.includes('coverage 99%')));
  button.click({currentTarget:button});
  assert.equal(button['aria-pressed'],'true');
  assert.equal(axis.yLabel,'% of net capacity');
  assert.ok(!container.children[0].children.some(e=>e.fill==='#ef4444'));
  ctx.renderUpgradingSelectionUtilizationV1({...data,toolkitDowntime:{rows:[]}});
  assert.ok(container.children[0].children.length>0);
  assert.match(container.children.at(-1).textContent,/No Toolkit observations/);
});
test('hourly configured crew is weighted to elapsed UTC time, not future capacity',()=>{
 const input={...row,configured_crew_hours:300,protocol_active_crew_hours:80,claim_locked_crew_hours:100,capacity_not_observed_crew_hours:120};
 const result=project(input,{coveredSeconds:5400,periodSeconds:5400,downtimeSeconds:540},false,{configuredCrewByHour:{'2026-09-08T00':100,'2026-09-08T01':200},stop:'2026-09-08T01:30:00Z'});
 assert.equal(result.configured_crew_hours,200);
 assert.equal(result.toolkit_downtime_crew_hours,20);
 assert.equal(result.protocol_active_crew_hours,80);
 assert.equal(result.claim_locked_crew_hours,80);
});
