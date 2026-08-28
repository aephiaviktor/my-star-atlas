'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
  assert.deepEqual(result.events[0].costs, { scanning: 0, mining: 4, crafting: 2, lm: 0, gm: 10 });
  assert.equal(result.events[0].uncostedQuantity, 8);
  assert.equal(result.events[0].cargoCost, 6);

  const ledger = new InventoryCostLedger();
  ledger.applyEvents(result.events);
  assert.deepEqual(ledger.get('ONI-1', 'Framework'), {
    location: 'ONI-1', asset: 'Framework', quantity: 40, uncostedQuantity: 8,
    costs: { scanning: 0, mining: 4, crafting: 2, lm: 0, gm: 10 }, cargoCost: 7,
    costPerUnit: { scanning: 0, mining: 0.1, crafting: 0.05, lm: 0, gm: 0.25 },
    baseCostPerUnit: 0.4, cargoCostPerUnit: 0.175, totalCostPerUnit: 0.575,
  });
});

test('foreign withdrawal fails closed when no recent source breakdown exists', () => {
  const flow = { id: 'withdraw', flow: 'css-withdraw', faction: 'MUD', timestamp: '2026-08-28T11:00:00Z', origin: 'MUD-1', destination: 'wallet:x', asset: 'Framework', quantity: 40 };
  const stale = { ...observation, timestamp: '2026-08-25T10:00:00Z' };
  const result = buildFactionCustodyLedgerEvents({ flows: [flow], observations: [stale], faction: 'ONI' });
  assert.deepEqual(result.events, []);
  assert.equal(result.rejected[0].reason, 'source_basis_snapshot_unavailable');
});
