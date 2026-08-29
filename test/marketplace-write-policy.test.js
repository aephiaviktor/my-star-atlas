'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { filterLegacyMarketplaceInfluxLines, LEGACY_MARKETPLACE_MEASUREMENTS } = require('../electron/marketplace-write-policy');

test('legacy Marketplace measurements are removed from every outgoing Influx line batch', () => {
  assert.deepEqual([...LEGACY_MARKETPLACE_MEASUREMENTS].sort(), [
    'asset_flow', 'marketplace', 'marketplace_faction_v2', 'marketplace_reconciliation_test_v1', 'marketplace_v2',
  ]);
  const input = [
    'marketplace_rawdata,record=transaction payload="{}" 1',
    'asset_flow,flow=css-deposit quantity=1 2',
    'marketplace,market=LM quantity=1 3',
    'marketplace_faction_v2,faction=MUD quantity=1 4',
    'marketplace_reconciliation_test_v1,test=yes quantity=1 5',
    'marketplace_v2,market=GM quantity=1 6',
    'inventory_basis,faction=MUD quantity=1 7',
  ].join('\n');
  assert.equal(filterLegacyMarketplaceInfluxLines(input), [
    'marketplace_rawdata,record=transaction payload="{}" 1',
    'inventory_basis,faction=MUD quantity=1 7',
  ].join('\n'));
});

test('measurement matching is exact and empty batches stay empty', () => {
  assert.equal(filterLegacyMarketplaceInfluxLines(''), '');
  assert.equal(filterLegacyMarketplaceInfluxLines('marketplace_rawdata value=1 1'), 'marketplace_rawdata value=1 1');
  assert.equal(filterLegacyMarketplaceInfluxLines('marketplace_extra value=1 1'), 'marketplace_extra value=1 1');
});
