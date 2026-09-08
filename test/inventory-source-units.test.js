'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InventoryCostLedger } = require('../electron/inventory-cost-ledger');
const { buildCostLedgerResult } = require('../electron/production-ledger-events');
const { projectInventoryCostLedgerRows } = require('../electron/inventory-cost-ledger-view');
const { replayMarketplaceInventoryLedger, projectInventoryCostLedgerDepositEvents } = require('../electron/marketplace-inventory-ledger');
const location = 'MUD-PHANTOM', asset = 'Framework';
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-10, `${a} != ${b}`);
test('remaining purchased and crafted source denominators survive consumption, transfer and snapshot', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({location, asset, quantity: 100, source:'gm', totalCost:0.3});
  ledger.acquire({location, asset, quantity: 100, source:'gm', totalCost:0.4});
  ledger.acquire({location, asset:'Ore', quantity:100, source:'mining', totalCost:0.02});
  ledger.craft({location, outputAsset:asset, outputQuantity:100, ingredients:[{asset:'Ore',quantity:100}], craftingCost:0.01});
  ledger.acquire({location, asset, quantity:1000});
  ledger.consume({location, asset, quantity:1000});
  ledger.consume({location, asset, quantity:30});
  let row = ledger.get(location,asset);
  near(row.sourceQuantities.gm,180);
  near(row.sourceUnitCosts.gm,0.0035);
  near(row.sourceUnitCosts.mining,0.0002);
  near(row.sourceUnitCosts.crafting,0.0001);
  ledger.transfer({origin:location,destination:'MUD-2',asset,quantity:90});
  row = InventoryCostLedger.fromSnapshot(ledger.snapshot()).get('MUD-2',asset);
  near(row.sourceQuantities.gm,60);
  near(row.sourceUnitCosts.gm,0.0035);
  const [view] = projectInventoryCostLedgerRows({ledgerRows:[row]});
  near(view.sourceUnitCosts.gm,0.0035);
  assert.notEqual(view.totalCostPerUnit,view.sourceUnitCosts.gm);
});
test('purchased ingredients do not become GM-purchased output; zeros and unknown origins differ', () => {
  const ledger = new InventoryCostLedger();
  ledger.acquire({location,asset:'Ore',quantity:10,source:'gm',totalCost:1});
  ledger.craft({location,outputAsset:asset,outputQuantity:5,ingredients:[{asset:'Ore',quantity:10}],craftingCost:0});
  const row=ledger.get(location,asset);
  assert.equal(row.sourceUnitCosts.gm,null);
  assert.equal(row.sourceUnitCosts.crafting,0);
  near(row.totalCostPerUnit,0.2);
  ledger.acquireLot({location,asset:'Legacy',quantity:50,costs:{gm:1}});
  assert.equal(ledger.get(location,'Legacy').sourceUnitCosts.gm,null);
});
test('current surplus protects known stock before upgrades and persists in replay checkpoint', () => {
  const base = new InventoryCostLedger();
  base.acquire({location,asset,quantity:1000,source:'gm',totalCost:3});
  const inputs = {initialLedger:base,currentInventoryRows:[{starbase:location,asset,quantity:9900}],upgradingRows:[{timestamp:'2026-09-08T10:00:00Z',starbase:location,asset,installed:100}]};
  const first=buildCostLedgerResult(inputs);
  let row=first.ledger.get(location,asset);
  assert.equal(row.quantity,9900);
  assert.equal(row.uncostedQuantity,8900);
  assert.equal(row.sourceQuantities.gm,1000);
  const second=buildCostLedgerResult({...inputs,initialLedger:InventoryCostLedger.fromSnapshot(first.checkpointLedger.snapshot()),
    eventFingerprintCounts:first.checkpointEventFingerprintCounts,eventResultsByFingerprint:first.checkpointEventResultsByFingerprint,
    currentInventoryRows:[{starbase:location,asset,quantity:9800}],
    upgradingRows:[...inputs.upgradingRows,{timestamp:'2026-09-08T11:00:00Z',starbase:location,asset,installed:100}]});
  row=second.ledger.get(location,asset);
  assert.equal(row.quantity,9800);
  assert.equal(row.uncostedQuantity,8800);
  assert.equal(row.sourceQuantities.gm,1000);
  near(row.costs.gm,3);
  const repeat=buildCostLedgerResult({...inputs,initialLedger:first.checkpointLedger});
  assert.deepEqual(repeat.ledger.snapshot(),first.ledger.snapshot());
});
test('wallet rewards do not dilute the GM purchase price carried into game', () => {
  const common={asset,timestamp:'2026-09-08T01:00:00Z'};
  const result=replayMarketplaceInventoryLedger([
    {...common,movementId:'a',kind:'buy',toWallet:'wallet',quantity:100,principalAtlas:0.3,marketplace:'GM'},
    {...common,movementId:'b',kind:'reward',toWallet:'wallet',quantity:100},
    {...common,movementId:'c',kind:'deposit',fromWallet:'wallet',destination:`MUD:${location}`,faction:'MUD',starbase:location,quantity:200},
  ]);
  const events=projectInventoryCostLedgerDepositEvents(result.rows,{faction:'MUD'});
  assert.equal(events.length,1);
  const ledger=new InventoryCostLedger(); ledger.applyEvent(events[0]);
  const row=ledger.get(location,asset);
  assert.equal(row.sourceQuantities.gm,100);
  near(row.sourceUnitCosts.gm,0.003);
});
test('inferred surplus is placed after an authoritative baseline without changing that observation', () => {
  const options={inventoryReconciliationRows:[{starbase:location,asset,quantity:0,timestamp:'2026-09-08T08:00:00Z'}],
    assetFlowEvents:[{type:'acquire',timestamp:'2026-09-08T08:00:01Z',location,asset,quantity:1000,source:'gm',totalCost:3}],
    currentInventoryRows:[{starbase:location,asset,quantity:9900}],
    upgradingRows:[{timestamp:'2026-09-08T10:00:00Z',starbase:location,asset,installed:100}]};
  const result=buildCostLedgerResult(options);
  const row=result.ledger.get(location,asset);
  assert.equal(row.quantity,9900); assert.equal(row.uncostedQuantity,8900);
  assert.equal(row.sourceQuantities.gm,1000);
  const again=buildCostLedgerResult({...options,initialLedger:result.checkpointLedger,
    eventFingerprintCounts:result.checkpointEventFingerprintCounts,eventResultsByFingerprint:result.checkpointEventResultsByFingerprint});
  assert.deepEqual(again.ledger.snapshot(),result.ledger.snapshot());
  assert.equal(options.inventoryReconciliationRows[0].quantity,0);
});
test('renderer breakdown uses a common denominator, preserves blended total and shows genuine zero', () => {
  const fs=require('node:fs'), vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../electron/renderer.js'),'utf8');
  const context={Intl};
  vm.runInNewContext(source.slice(source.indexOf('const costLedgerBasisFormatter'),source.indexOf('function renderInventoryCostLedger')),context);
  const row={quantity:1000,costs:{gm:2,crafting:1},cargoCost:1,sourceUnitCosts:{gm:0.003,crafting:0},basisStatus:'estimated'};
  const values=context.inventoryLedgerValues(row,true);
  assert.equal(values.gm,0.002); assert.equal(values.crafting,0.001); assert.equal(values.totalBasis,0.004);
  assert.equal(values.mining,0);
  assert.equal(context.formatInventoryLedgerBasisValue(null,true),'--');
  assert.notEqual(context.formatInventoryLedgerBasisValue(0,true),'--');
  assert.equal(context.inventoryLedgerValues(row,false).gm,2);
});

test('overdraft recovery converges before consumption is committed, including checkpoint rollover', () => {
  const base = new InventoryCostLedger();
  base.acquire({location,asset,quantity:1000,source:'gm',totalCost:3});
  const upgrade = (installed, timestamp='2026-09-08T10:00:00Z') => ({timestamp,starbase:location,asset,installed});
  const run = (extra={}) => buildCostLedgerResult({initialLedger:base,
    currentInventoryRows:[{starbase:location,asset,quantity:9900}],
    upgradingRows:[upgrade(9500)], ...extra});
  const first = run();
  const check = (result, quantity) => {
    const row=result.ledger.get(location,asset);
    assert.equal(result.rejectedEvents.length,0);
    assert.equal(row.quantity,quantity, 'replay must reach endpoint before final reconciliation');
    assert.equal(row.quantity-row.uncostedQuantity,1000);
    assert.equal(row.sourceQuantities.gm,1000);
    near(row.sourceUnitCosts.gm,0.003);
  };
  check(first,9900);
  const replay = {initialLedger:InventoryCostLedger.fromSnapshot(first.checkpointLedger.snapshot()),
    eventFingerprintCounts:first.checkpointEventFingerprintCounts,
    eventResultsByFingerprint:first.checkpointEventResultsByFingerprint};
  check(run({...replay, currentInventoryRows:[{starbase:location,asset,quantity:9800}],
    upgradingRows:[upgrade(9500),upgrade(100,'2026-09-08T11:00:00Z')]}),9800);
  const next=run({...replay,currentInventoryRows:[{starbase:location,asset,quantity:9700}],
    upgradingRows:[upgrade(9500),upgrade(200,'2026-09-09T10:00:00Z')]});
  check(next,9700);
  check(run({initialLedger:next.checkpointLedger,eventFingerprintCounts:next.checkpointEventFingerprintCounts,
    eventResultsByFingerprint:next.checkpointEventResultsByFingerprint,
    currentInventoryRows:[{starbase:location,asset,quantity:9700}],
    upgradingRows:[upgrade(9500),upgrade(200,'2026-09-09T10:00:00Z')]}),9700);
  assert.equal(base.get(location,asset).quantity,1000);
});

test('overdraft recovery after dated baseline preserves known purchases and the observed baseline', () => {
  const baseline={starbase:location,asset,quantity:0,timestamp:'2026-09-08T08:00:00Z'};
  const result=buildCostLedgerResult({inventoryReconciliationRows:[baseline],
    assetFlowEvents:[{type:'acquire',timestamp:'2026-09-08T08:00:01Z',location,asset,quantity:1000,source:'gm',totalCost:3}],
    currentInventoryRows:[{starbase:location,asset,quantity:9900}],
    upgradingRows:[{timestamp:'2026-09-08T10:00:00Z',starbase:location,asset,installed:9500}]});
  const row=result.ledger.get(location,asset);
  assert.equal(row.quantity,9900);
  assert.equal(row.quantity-row.uncostedQuantity,1000);
  assert.equal(baseline.quantity,0);
});
