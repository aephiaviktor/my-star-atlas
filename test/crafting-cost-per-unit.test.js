const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const renderer = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const html = readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');

test('Crafting calculates Costs per Unit as Total Costs divided by Crafted output', () => {
  assert.match(
    main,
    /const costsPerUnitAtlas = Number\.isFinite\(totalCostsAtlas\) && craftingRow\.crafted > 0\s*\? totalCostsAtlas \/ craftingRow\.crafted\s*:\s*null;/,
  );
  assert.match(main, /totalCostsAtlas,\s+costsPerUnitAtlas,\s+netProfitAtlas,/);
});

test('Crafting shows Costs per Unit after Profit Margin and enables it by default', () => {
  const columns = renderer.slice(
    renderer.indexOf('const craftingEarningsOptionalColumns'),
    renderer.indexOf('const upgradingEarningsOptionalColumns'),
  );
  assert.match(columns, /id: 'profitMargin'[\s\S]*id: 'costsPerUnit'/);
  assert.match(renderer, /crafting: new Set\(\[[^\]]*'profitMargin', 'costsPerUnit'\]\)/);
  assert.match(renderer, /createCraftingEarningsOptionalCell[\s\S]*columnId === 'costsPerUnit'[\s\S]*entry\.costsPerUnitAtlas/);
  assert.match(renderer, /crafting: Object\.freeze\(\{[\s\S]*costsPerUnit: \[[^\]]*Total Costs ÷ Crafted/);
});

test('Crafting fallback table header includes Costs per Unit after Profit Margin', () => {
  assert.match(html, /<th scope="col">Profit Margin<\/th>\s*<th scope="col">Costs per Unit<\/th>/);
  assert.match(html, /<td colspan="15">No crafting data loaded<\/td>/);
});
