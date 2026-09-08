'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { calculateManagementImpact: calculate } = require('../electron/upgrading-management-impact');
const { calculateUpgradingSelectionUtilization } = require('../electron/upgrading-selection-utilization');
function fixture() {
  const date = '2026-09-08';
  return { now: Date.parse('2026-09-10T00:00:00Z'), faction:'MUD', profile:'profile-a',
    configuredCrewByHour: Object.fromEntries(Array.from({length:24},(_,i)=>[`${date}T${String(i).padStart(2,'0')}`,100])),
    neutralHours: Array.from({length:24},(_,i)=>({time:`${date}T${String(i).padStart(2,'0')}:00:00Z`, component:'Framework',neutral_crew:100})),
    pricesByDate:{[date]:{framework:1, electronics:1}}, atlasPerLpByDate:{[date]:.1},
    jobs:[{component:'Electronics',amount:3600/14*100,crew:100,startedAt:`${date}T00:00:00Z`,completedAt:`${date}T01:00:00Z`}],
    utilization:[{date,configured_crew_hours:2400,protocol_active_crew_hours:100,claim_locked_crew_hours:300,proven_eligible_idle_crew_hours:50,capacity_not_observed_crew_hours:1950}],
    toolkitDowntime:{rows:[{date,coveredSeconds:86400,periodSeconds:86400,downtimeSeconds:8640}]}
  };
}
test('corrected losses are negative, Toolkit is excluded once, common-denominator sum and uncertainty reconcile',()=>{
  const input=fixture(), before=JSON.stringify(input), result=calculate(input), r=result.rows[0];
  const benchmark=(68*.1-1)*300;
  assert.equal(r.netCrewHours,2160); assert.equal(r.lostCrewHours,110); assert.equal(r.unknownCrewHours,1950);
  assert.equal(r.benchmarkAtlasPerCrewHour,benchmark);
  assert.equal(r.loss,-110*benchmark/90); assert.equal(r.lossLower,-2060*benchmark/90);
  assert.ok(Math.abs(r.combined-(r.selection+r.loss))<1e-8);
  assert.ok(r.combinedLower<=r.combined); assert.equal(result.profile,'profile-a'); assert.equal(JSON.stringify(input),before);
});
test('cross-midnight selection uses calendar work and each day prices, not completion cohort',()=>{
  const input=fixture(), previous='2026-09-07';
  input.jobs[0].startedAt=previous+'T23:30:00Z'; input.jobs[0].completedAt='2026-09-08T00:30:00Z';
  input.configuredCrewByHour[previous+'T23']=100;
  input.neutralHours.push({time:previous+'T23:00:00Z',component:'Framework',neutral_crew:100});
  input.pricesByDate[previous]={framework:2,electronics:3}; input.atlasPerLpByDate[previous]=.2;
  input.utilization=calculateUpgradingSelectionUtilization(input).utilization;
  const rows=calculate(input).rows;
  assert.equal(rows.length,2);
  const expected=(rate,fw,el)=>50*((92*rate-el)*3600/14-(68*rate-fw)*300);
  assert.ok(Math.abs(rows[0].selectionAtlas-expected(.2,2,3))<1e-8);
  assert.ok(Math.abs(rows[1].selectionAtlas-expected(.1,1,1))<1e-8);
});
test('no jobs still shows unknown-capacity scenario; today and future days excluded',()=>{
  const input=fixture();input.jobs=[];input.utilization=[];
  const r=calculate(input).rows[0]; assert.equal(r.selection,0);assert.equal(r.loss,0); assert.ok(r.lossLower<0);
  input.now=Date.parse('2026-09-08T23:59:59Z');assert.equal(calculate(input).rows.length,0);
});
test('missing Toolkit data and sparse neutral hours preserve labelled estimates',()=>{
  const input=fixture(); input.toolkitDowntime={};input.neutralHours=input.neutralHours.slice(0,1);
  const r=calculate(input).rows[0]; assert.equal(r.available,true);assert.equal(r.netCrewHours,2400);assert.equal(r.adjusted,false);
  assert.match(r.warnings.join(' '),/nearest same-day/);assert.match(r.warnings.join(' '),/unadjusted/);
});
test('missing price, foreign-day mix, zero net capacity are unavailable rather than fabricated profit',()=>{
  const input=fixture();input.pricesByDate['2026-09-08'].framework=null;assert.equal(calculate(input).rows[0].loss,null);
  const second=fixture();second.neutralHours=[];assert.equal(calculate(second).rows[0].available,false);
  const third=fixture();third.toolkitDowntime.rows[0].downtimeSeconds=86400;
  const r=calculate(third).rows[0];assert.equal(r.loss,null);assert.match(r.reason,/No positive net/);
});
test('negative neutral contribution is not shown as a positive utilization loss',()=>{
  const input=fixture();input.pricesByDate['2026-09-08'].framework=100;
  const r=calculate(input).rows[0];assert.equal(r.loss,0);assert.match(r.warnings.join(' '),/negative/);
});
test('actual rendering keeps loss below zero, adds ranges, hover details, independent navigation and excludes today',()=>{
  const fs=require('node:fs'),vm=require('node:vm');const source=fs.readFileSync('electron/renderer.js','utf8');
  const element=()=>({children:[],replaceChildren(){this.children=[];},append(...nodes){this.children.push(...nodes);}});
  const containers={'#optimization-upgrading-loss':element(),'#optimization-upgrading-management':element()};let tips=[],nav=[];
  const context={document:{querySelector:id=>containers[id],createElement:element},getUpgradingV1ChartStartDate:()=> '2026-08-14',
    createOptimizationAnalyticsSvg(c){c.replaceChildren();const svg=element();c.append(svg);return svg;},
    renderUpgradingChartAxes(_,a){return {...a,left:60,right:20,top:20,bottom:50,width:760,height:340,x:x=>x*100,y:y=>150-y};},
    appendOptimizationSvg(parent,tag,attrs){const e={...element(),tag,...attrs};parent.append(e);return e;},
    bindOptimizationAnalyticsTooltip(_,tip){tips.push(tip);},bindUpgradingAnalyticsChartNavigation(...args){nav.push(args);}};
  vm.createContext(context); vm.runInContext(source.slice(source.indexOf('const upgradingManagementViews ='),source.indexOf('function renderToolkitDowntime(')),context);
  const input=fixture(); input.now=Date.now()+86400000;
  // Use definitely completed dates even if run on an earlier clock.
  const data=calculate(input); const today=new Date().toISOString().slice(0,10);data.rows[0].date='2026-08-20'; data.rows.push({...data.rows[0],date:today,loss:999999});
  context.renderUpgradingManagementImpact({managementImpact:data});
  const walk=e=>[e,...e.children.flatMap(walk)];
  const dots=walk(containers['#optimization-upgrading-loss']).filter(e=>e.tag==='circle');
  assert.equal(dots.length,1);assert.ok(dots[0].cy>=150);assert.ok(tips.some(t=>t.includes('unclassified')));assert.equal(nav.length,2);assert.notEqual(nav[0][4],nav[1][4]);
  assert.ok(walk(containers['#optimization-upgrading-loss']).some(e=>e.tag==='line'&&e.y2>e.y1));
  context.renderUpgradingManagementImpact({});assert.match(containers['#optimization-upgrading-loss'].textContent,/No completed/);
});
