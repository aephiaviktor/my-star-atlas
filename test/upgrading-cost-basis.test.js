'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { upgradingPoolKey, resolveUpgradingCostsAtlas } = require('../electron/upgrading-cost-basis');

test('exact consumed upgrading basis wins over current inventory basis', () => {
  assert.equal(resolveUpgradingCostsAtlas({
    componentBasis: { basis: 12, uncosted: false },
    installed: 100,
    inventoryBasis: { totalCostPerUnit: 0.5 },
  }), 12);
});

test('current inventory unit basis values upgrading when consumed history was uncosted', () => {
  assert.equal(resolveUpgradingCostsAtlas({
    componentBasis: { basis: 0, uncosted: true },
    installed: 6_001_441,
    inventoryBasis: { totalCostPerUnit: 0.000668 },
  }), 6_001_441 * 0.000668);
});

test('upgrading remains unvalued when neither exact nor inventory basis exists', () => {
  assert.equal(resolveUpgradingCostsAtlas({ installed: 100 }), null);
  assert.equal(resolveUpgradingCostsAtlas({ installed: 100, inventoryBasis: { totalCostPerUnit: null } }), null);
});

test('upgrading pool keys canonicalize legacy asset names', () => {
  assert.equal(upgradingPoolKey(' MUD-PHANTOM ', 'Ammo'), 'MUD-PHANTOM\nAmmunition');
});
