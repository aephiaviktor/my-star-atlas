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

test('Crafting removes the redundant standalone Cost per Unit presentation', () => {
  const columns = renderer.slice(
    renderer.indexOf('const craftingEarningsOptionalColumns'),
    renderer.indexOf('const upgradingEarningsOptionalColumns'),
  );
  assert.doesNotMatch(columns, /id: 'costsPerUnit'/);
  assert.doesNotMatch(renderer, /crafting: new Set\(\[[^\]]*'costsPerUnit'/);
  assert.doesNotMatch(html, /<th scope="col">Cost per Unit<\/th>/);
  assert.match(html, /<td colspan="14">No crafting data loaded<\/td>/);
});
