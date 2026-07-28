const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const renderer = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const html = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
const breakeven = readFileSync(path.join(__dirname, '..', 'electron', 'ledger-breakeven.js'), 'utf8');

 test('Cargo includes rental costs between fuel and transaction costs and in total costs', () => {
  const columns = renderer.slice(renderer.indexOf('const cargoEarningsOptionalColumns'), renderer.indexOf('const cargoAllocationEarningsOptionalColumns'));
  assert.match(columns, /id: 'fuelCosts'[\s\S]*id: 'rental'[\s\S]*id: 'txsCosts'/);
  assert.match(main, /const costParts = \[fuelCostsAtlas, rentalRateAtlasPerDay, txsCostsAtlas\]/);
  assert.match(renderer, /createCargoEarningsOptionalCell[\s\S]*columnId === 'rental'[\s\S]*rentalRateAtlasPerDay/);
});

test('Crafting and Upgrading expose internal/external cost-basis toggles', () => {
  assert.match(html, /data-earnings-cost-basis="crafting"/);
  assert.match(html, /data-earnings-cost-basis="upgrading"/);
  assert.match(html, /Internal Cost Basis/);
  assert.match(html, /External Cost Basis/);
  assert.match(renderer, /const earningsCostBasisMode = \{\s*crafting: 'internal',\s*upgrading: 'internal'/);
  assert.match(renderer, /Ingredient External Value/);
  assert.match(renderer, /Component External Value/);
});

test('External basis values consumed crafting ingredients and upgrading components at GM prices', () => {
  assert.match(main, /ingredientExternalValueAtlas/);
  assert.match(main, /componentExternalValueAtlas/);
  assert.match(renderer, /applyEarningsCostBasis/);
  assert.match(renderer, /externalTotalCostsAtlas/);
});

test('Breakeven includes inventory external value after GM Price per Unit', () => {
  assert.match(renderer, /id: 'gmPrice'[\s\S]*id: 'inventoryExternalValue'/);
  assert.match(renderer, /entry\.inventoryExternalValue/);
  assert.match(breakeven, /inventoryExternalValue/);
});
