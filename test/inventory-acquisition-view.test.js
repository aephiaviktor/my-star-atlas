'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { InventoryCostLedger } = require('../electron/inventory-cost-ledger');
const { projectInventoryCostLedgerRows } = require('../electron/inventory-cost-ledger-view');
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-10, `${a} != ${b}`);
test('landed routes reconcile with blended cost after transfer, excluding uncosted stock from produced share', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({location:'A',asset:'Framework',quantity:800,source:'gm',totalCost:2.24});
  ledger.acquire({location:'A',asset:'Ore',quantity:200,source:'gm',totalCost:0.24});
  ledger.craft({location:'A',outputAsset:'Framework',outputQuantity:200,ingredients:[{asset:'Ore',quantity:200}],craftingCost:0.08});
  ledger.acquire({location:'A',asset:'Framework',quantity:1000});
  ledger.consume({location:'A',asset:'Framework',quantity:1000});
  ledger.transfer({origin:'A',destination:'B',asset:'Framework',quantity:1000,cargoCost:0.1});
  const stock = InventoryCostLedger.fromSnapshot(ledger.snapshot()).get('B','Framework');
  const [row] = projectInventoryCostLedgerRows({ledgerRows:[stock],valuationRows:[{starbase:'B',asset:'Framework',inventory:11000}]});
  near(row.producedPercent,20);
  near(row.acquisition.purchased.quantity,800);
  near(row.acquisition.produced.quantity,200);
  near(row.acquisition.purchased.unitCost,0.0029);
  near(row.acquisition.produced.unitCost,0.0017);
  near(row.totalCostPerUnit,0.00266);
  near((row.acquisition.purchased.cost+row.acquisition.produced.cost)/1000,row.totalCostPerUnit);
  assert.equal(row.unknownOriginQuantity,0);
});
test('unknown costed origins are neither produced nor purchased; missing route differs from free production', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquireLot({location:'A',asset:'SDU',quantity:100,costs:{gm:1}});
  ledger.acquire({location:'A',asset:'SDU',quantity:100,source:'scanning',totalCost:0});
  const [row] = projectInventoryCostLedgerRows({ledgerRows:[ledger.get('A','SDU')]});
  near(row.producedPercent,50);
  assert.equal(row.unknownOriginQuantity,100);
  assert.equal(row.acquisition.purchased.unitCost,null);
  assert.equal(row.acquisition.produced.unitCost,0);
  const [empty]=projectInventoryCostLedgerRows({valuationRows:[{starbase:'A',asset:'Ore',inventory:100}]});
  assert.equal(empty.producedPercent,null);
});
test('renderer switch preserves total and share, swaps additive components for route costs and quantities', () => {
  const source=fs.readFileSync(require.resolve('../electron/renderer.js'),'utf8');
  class Node {
    constructor(){this.children=[];this.dataset={};this.classList={toggle(){}};}
    appendChild(n){this.children.push(n);return n;}
    replaceChildren(...ns){this.children=ns;}
    addEventListener(type,fn){this[type]=fn;}
    setAttribute(){}
    get lastElementChild(){return this.children.at(-1);}
    querySelector(){return null;}
  }
  const buttons=['breakdown','acquisition'].map(mode=>Object.assign(new Node(),{dataset:{inventoryLedgerView:mode}}));
  const head=new Node(), body=new Node();
  const columns=['starbase','asset','quantity','gm','crafting','cargo','totalBasis','status'].map(id=>({id,label:id}));
  const row={location:'A',asset:'Framework',quantity:1000,knownCostQuantity:1000,uncostedQuantity:0,costs:{gm:2.48,crafting:0.08},cargoCost:0.1,basisStatus:'priced',producedPercent:20,unknownOriginQuantity:0,acquisition:{purchased:{quantity:800,cost:2.32,unitCost:0.0029},produced:{quantity:200,cost:0.34,unitCost:0.0017}}};
  const context={Intl,inventoryLedgerView:'breakdown',document:{createElement:()=>new Node(),querySelectorAll:()=>buttons},earningsCostLedgerTableHead:head,earningsCostLedgerTableBody:body,
    earningsSort:{breakeven:{}},earningsFilters:{breakeven:{}},latestBreakevenResult:{inventoryCostLedgerRows:[row]},
    isEarningsPerUnitEnabled:()=>true,getVisibleEarningsColumns:()=>columns,applyEarningsPerUnitButtonState(){},renderEarningsColumnControls(){},
    appendEarningsHeaderCell:(tr,id,label)=>tr.appendChild(Object.assign(new Node(),{id,textContent:label})),
    formatWholeNumber:String,formatPercentNumber:(v)=>String(v)+'%',createTextCell:(v)=>Object.assign(new Node(),{textContent:v})};
  vm.runInNewContext(source.slice(source.indexOf('const costLedgerBasisFormatter'),source.indexOf('function renderEarningsBreakevenEmpty',source.indexOf('const costLedgerBasisFormatter'))),context);
  const listener=source.slice(source.lastIndexOf("for (const button of document.querySelectorAll('[data-inventory-ledger-view]'))"));
  vm.runInNewContext(listener,context);
  context.renderInventoryCostLedger(context.latestBreakevenResult);
  const initial=context.inventoryLedgerValues(row,true);
  assert.equal(head.children[0].children.some(c=>c.id==='gm'),true);
  buttons[1].click();
  assert.equal(head.children[0].children.some(c=>c.id==='gm'),false);
  assert.equal(head.children[0].children.some(c=>c.id==='purchased'),true);
  const headers=head.children[0].children;
  assert.equal(headers[headers.findIndex(c=>c.id==='totalBasis')+1].id,'producedPercent');
  near(context.inventoryLedgerValues(row,true).totalBasis,initial.totalBasis);
  assert.equal(context.inventoryLedgerValues(row,true).producedPercent,initial.producedPercent);
  assert.equal(context.inventoryLedgerValues(row,false).producedPercent,20);
  buttons[0].click();
  assert.equal(head.children[0].children.some(c=>c.id==='gm'),true);
});
