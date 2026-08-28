'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { excludeSelfReferentialCraftingEvents } = require('../electron/crafting-event-integrity');
const { selectFactionAssetFlows } = require('../electron/marketplace-asset-flow');
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

function row(craftingID, type, input, output, field = 'amount', value = 1) {
  return { craftingID, type, input, output, _field: field, _value: value };
}

test('self-referential upgrade duplicates are removed as complete crafting events', () => {
  const rows = [
    row('upgrade-duplicate', 'Output', '', 'Framework', 'amount', 4),
    row('upgrade-duplicate', 'Input', 'Framework', 'Framework', 'amount', 8),
    row('upgrade-duplicate', 'Output', '', 'Framework', 'fee', 0.1),
    row('upgrade-duplicate', 'Output', '', 'Framework', 'txCostSol', 0.00001),
    row('real-craft', 'Output', '', 'Framework', 'amount', 4),
    row('real-craft', 'Input', 'Carbon', 'Framework', 'amount', 8),
    row('real-craft', 'Output', '', 'Framework', 'fee', 0.1),
  ];

  assert.deepEqual(excludeSelfReferentialCraftingEvents(rows), rows.slice(4));
});

test('crafting integrity comparison is normalized and never removes unrelated events', () => {
  const rows = [
    row('bad', 'Input', ' framework ', 'FRAMEWORK', 'amount', 2),
    row('bad', 'Output', '', 'Framework', 'amount', 1),
    row('ammo', 'Input', 'Copper', 'Ammunition', 'amount', 2),
    row('ammo', 'Output', '', 'Ammunition', 'amount', 1),
    { ...row('', 'Input', 'Framework', 'Framework'), _time: '2026-08-20T12:00:00Z' },
  ];

  assert.deepEqual(excludeSelfReferentialCraftingEvents(rows), rows.slice(2, 4));
});

test('production filters invalid crafting events before UI rows and ledger events are built', () => {
  const crafting = main.slice(main.indexOf('async function fetchCraftingEarningsRows'), main.indexOf('async function fetchUpgradingEarningsRows'));
  assert.match(crafting, /excludeSelfReferentialCraftingEvents\(parseInfluxCsv\(await queryInfluxFlux\(settings, craftingFlux\)\)\)/);
  assert.match(crafting, /const outputRows = craftingRows\.filter/);
  assert.match(crafting, /for \(const raw of craftingRows\)/);
});

test('asset-flow ingestion keeps only the selected faction and its required wallet custody path', () => {
  const oniDeposit = { id: 'oni-deposit', faction: '', flow: 'css-deposit', origin: 'wallet:oni-handler', destination: 'ONI-1' };
  const crossFactionCustody = { id: 'cross-faction-custody', faction: '', flow: 'wallet-transfer', origin: 'wallet:mud-handler', destination: 'wallet:oni-handler' };
  const mudWithdraw = { id: 'mud-withdraw', faction: 'MUD', flow: 'css-withdraw', origin: 'MUD-1', destination: 'wallet:mud-handler' };
  const mudDeposit = { id: 'mud-deposit', faction: '', flow: 'css-deposit', origin: 'wallet:other-mud-handler', destination: 'MUD-1' };
  const unrelated = { id: 'unrelated', faction: '', flow: 'wallet-transfer', origin: 'wallet:x', destination: 'wallet:y' };
  assert.deepEqual(
    selectFactionAssetFlows([mudWithdraw, crossFactionCustody, oniDeposit, mudDeposit, unrelated], 'ONI').map((row) => row.id),
    ['mud-withdraw', 'cross-faction-custody', 'oni-deposit'],
  );

  const source = main.slice(main.indexOf('async function fetchMarketplaceAssetFlowsFromInflux'), main.indexOf('async function resolveGmFactionMarketplaceInputs'));
  assert.match(source, /const faction = normalizeFaction\(settings\.faction\)/);
  assert.match(source, /return selectFactionAssetFlows\(flows, faction\)/);
  assert.doesNotMatch(source, /exists r\.faction and r\.faction ==/);
});
