'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { InventoryCostLedger } = require('../electron/inventory-cost-ledger');
const { buildFactionCustodyLedgerEvents } = require('../electron/cross-faction-basis-handoff');

const sourceCosts = { scanning: 0, mining: 10, crafting: 5, lm: 0, gm: 25 };
const observation = {
  faction: 'MUD', starbase: 'MUD-1', asset: 'Framework', timestamp: '2026-08-28T10:00:00Z',
  quantity: 100, uncostedQuantity: 20, sourceCosts, cargoCost: 10,
};

test('foreign withdrawal seeds an exact weighted wallet lot for the destination faction', () => {
  const withdrawal = {
    id: 'withdraw', flow: 'css-withdraw', faction: 'MUD', timestamp: '2026-08-28T11:00:00Z',
    origin: 'MUD-1', destination: 'wallet:mud-handler', asset: 'Framework', quantity: 40, txFeeAtlas: 2,
  };
  const custody = { id: 'custody', flow: 'wallet-transfer', timestamp: '2026-08-28T11:01:00Z', origin: 'wallet:mud-handler', destination: 'wallet:oni-handler', asset: 'Framework', quantity: 40 };
  const deposit = { id: 'deposit', flow: 'css-deposit', faction: 'ONI', timestamp: '2026-08-28T11:02:00Z', origin: 'wallet:oni-handler', destination: 'ONI-1', asset: 'Framework', quantity: 40, txFeeAtlas: 1 };

  const result = buildFactionCustodyLedgerEvents({ flows: [withdrawal, custody, deposit], observations: [observation], faction: 'ONI' });
  assert.deepEqual(result.rejected, []);
  assert.equal(result.events[0].type, 'acquire-lot');
  assert.deepEqual(result.events[0].costs, { scanning: 0, mining: 5, crafting: 2.5, lm: 0, gm: 12.5 });
  assert.equal(result.events[0].uncostedQuantity, 8);
  assert.equal(result.events[0].cargoCost, 7);

  const ledger = new InventoryCostLedger();
  ledger.applyEvents(result.events);
  assert.deepEqual(ledger.get('ONI-1', 'Framework'), {
    origins: [], sourceQuantities: { scanning: 0, mining: 0, crafting: 0, lm: 0, gm: 0 },
    sourceUnitCosts: { scanning: null, mining: null, crafting: null, lm: null, gm: null },
    location: 'ONI-1', asset: 'Framework', quantity: 40, uncostedQuantity: 8,
    costs: { scanning: 0, mining: 5, crafting: 2.5, lm: 0, gm: 12.5 },
    uncostedCosts: { scanning: 0, mining: 1, crafting: 0.5, lm: 0, gm: 2.5 },
    knownCosts: { scanning: 0, mining: 4, crafting: 2, lm: 0, gm: 10 },
    cargoCost: 8, uncostedCargoCost: 1.6, knownCargoCost: 6.4,
    costPerUnit: { scanning: 0, mining: 0.125, crafting: 0.0625, lm: 0, gm: 0.3125 },
    baseCostPerUnit: 0.5, cargoCostPerUnit: 0.2, totalCostPerUnit: 0.7,
  });
});

test('foreign withdrawal fails closed when no recent source breakdown exists', () => {
  const flow = { id: 'withdraw', flow: 'css-withdraw', faction: 'MUD', timestamp: '2026-08-28T11:00:00Z', origin: 'MUD-1', destination: 'wallet:x', asset: 'Framework', quantity: 40 };
  const stale = { ...observation, timestamp: '2026-08-25T10:00:00Z' };
  const result = buildFactionCustodyLedgerEvents({ flows: [flow], observations: [stale], faction: 'ONI' });
  assert.deepEqual(result.events, []);
  assert.equal(result.rejected[0].reason, 'source_basis_snapshot_unavailable');
});

test('UST cargo delivery seeds ONI with the source basis and new cargo cost', () => {
  const flow = {
    id: 'cargo:cycle:0', flow: 'cargo-transfer', faction: 'USTUR', timestamp: '2026-09-09T12:00:00Z',
    origin: 'UST-1', destination: 'ONI-1', asset: 'Electromagnet', quantity: 50, cargoCost: 3,
  };
  const cargoObservation = {
    faction: 'USTUR', starbase: 'UST-1', asset: 'Electromagnet', timestamp: '2026-09-09T11:00:00Z',
    quantity: 100, uncostedQuantity: 20,
    sourceCosts: { scanning: 0, mining: 20, crafting: 40, lm: 0, gm: 10 }, cargoCost: 5,
  };
  const result = buildFactionCustodyLedgerEvents({ flows: [flow], observations: [cargoObservation], faction: 'ONI' });
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(result.events, [{
    type: 'acquire-lot', timestamp: flow.timestamp, location: 'ONI-1', asset: 'Electromagnet', quantity: 50,
    uncostedQuantity: 10, costs: { scanning: 0, mining: 12.5, crafting: 25, lm: 0, gm: 6.25 },
    cargoCost: 6.125, flowId: flow.id, handoffFromFaction: 'USTUR', handoffFromStarbase: 'UST-1',
  }]);
});

test('foreign cargo without source basis fails closed instead of inventing an ONI cost', () => {
  const flow = { id: 'cargo:missing', flow: 'cargo-transfer', faction: 'USTUR', timestamp: '2026-09-09T12:00:00Z', origin: 'UST-1', destination: 'ONI-PHANTOM', asset: 'Field Stabilizer', quantity: 5, cargoCost: 1 };
  const result = buildFactionCustodyLedgerEvents({ flows: [flow], observations: [], faction: 'ONI' });
  assert.deepEqual(result.events, []);
  assert.equal(result.rejected[0].reason, 'source_basis_snapshot_unavailable');
});

test('earnings reads faction-global cargo allocations and requests their source basis scopes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /async function fetchCrossFactionCargoLedgerRows\(settings\)/);
  assert.match(main, /buildCargoAllocationPivotFlux\(bucket, '', batch\)/);
  assert.match(main, /flow: 'cargo-transfer'/);
  assert.match(main, /inventoryBasisScopesFromAssetFlows\(\[\.\.\.marketplaceAssetFlowEvents, \.\.\.crossFactionCargoFlows\]\)/);
  assert.match(main, /flows: \[\.\.\.marketplaceAssetFlowEvents, \.\.\.crossFactionCargoFlows\]/);
});

test('source unit basis can value a delivery larger than the post-transfer remaining snapshot', () => {
  const flow = { id: 'cargo:large', flow: 'cargo-transfer', faction: 'USTUR', timestamp: '2026-09-09T12:00:00Z', origin: 'UST-1', destination: 'ONI-1', asset: 'Electromagnet', quantity: 50, cargoCost: 2 };
  const postTransferSnapshot = {
    faction: 'USTUR', starbase: 'UST-1', asset: 'Electromagnet', timestamp: '2026-09-09T12:00:00Z',
    quantity: 10, knownQuantity: 10, uncostedQuantity: 0,
    sourceCosts: { scanning: 0, mining: 0, crafting: 10, lm: 0, gm: 0 }, cargoCost: 1,
  };
  const result = buildFactionCustodyLedgerEvents({ flows: [flow], observations: [postTransferSnapshot], faction: 'ONI' });
  assert.equal(result.rejected.length, 0);
  assert.equal(result.events[0].costs.crafting, 50);
  assert.equal(result.events[0].cargoCost, 7);
});
