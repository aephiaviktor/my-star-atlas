const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const craftingBasis = readFileSync(path.join(__dirname, '..', 'electron', 'crafting-cost-basis.js'), 'utf8');
const renderer = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const html = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');

test('Crafting calculates Cost per Unit as Total Costs divided by Crafted output', () => {
  assert.match(
    craftingBasis,
    /const costsPerUnitAtlas = totalCostsAtlas != null && crafted > 0 \? totalCostsAtlas \/ crafted : null;/,
  );
  assert.match(craftingBasis, /feeCostsAtlas, txsCostsAtlas, totalCostsAtlas, costsPerUnitAtlas, netProfitAtlas/);
});

test('Crafting shows Cost per Unit after Profit Margin and enables it by default', () => {
  const columns = renderer.slice(
    renderer.indexOf('const craftingEarningsOptionalColumns'),
    renderer.indexOf('const upgradingEarningsOptionalColumns'),
  );
  assert.match(columns, /id: 'profitMargin'[\s\S]*id: 'costsPerUnit'/);
  assert.match(renderer, /crafting: new Set\(\[[^\]]*'profitMargin', 'costsPerUnit'\]\)/);
  assert.match(renderer, /createCraftingEarningsOptionalCell[\s\S]*columnId === 'costsPerUnit'[\s\S]*entry\.costsPerUnitAtlas/);
  assert.match(renderer, /crafting: Object\.freeze\(\{[\s\S]*costsPerUnit: \[[^\]]*Total Costs ÷ Crafted/);
});

test('Crafting fallback table header includes Cost per Unit after Profit Margin', () => {
  assert.match(html, /<th scope="col">Profit Margin<\/th>\s*<th scope="col">Cost per Unit<\/th>/);
  assert.match(html, /<td colspan="15">No crafting data loaded<\/td>/);
});
