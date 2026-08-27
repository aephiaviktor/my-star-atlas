'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCostLedgerResult } = require('../electron/production-ledger-events');
const { buildCraftingBasisByDay, enrichCraftingEarningsRows } = require('../electron/crafting-cost-basis');

const DAY = '2026-08-08';
const STARBASE = 'SHARED-STARBASE';
const scopes = [
  { name: 'MUD', faction: 'MUD', profile: 'mud-profile-a', multiplier: 1 },
  { name: 'ONI', faction: 'ONI', profile: 'oni-profile-a', multiplier: 2 },
  { name: 'USTUR', faction: 'USTUR', profile: 'ustur-profile-a', multiplier: 3 },
];
const recipes = [
  { output: 'Framework', ingredient: 'Carbon', quantity: 10, crafted: 2, price: 40 },
  { output: 'Electronics', ingredient: 'Copper Ore', quantity: 4, crafted: 5, price: 20 },
];

function rowsFor(scope, { uncosted = false, zero = false, duplicate = false } = {}) {
  const miningRows = uncosted ? [] : recipes.map((recipe, index) => ({
    isoDate: '2026-08-07', starbase: STARBASE, rawMaterial: recipe.ingredient,
    mined: recipe.quantity, totalCostsAtlas: zero ? 0 : (index + 1) * 10 * scope.multiplier,
  }));
  const openingInventoryRows = uncosted ? recipes.map((recipe) => ({
    timestamp: '2026-08-07T00:00:00.000Z', starbase: STARBASE,
    asset: recipe.ingredient, quantity: recipe.quantity,
  })) : [];
  const craftingRows = recipes.map((recipe, index) => ({
    isoDate: DAY, timestamp: `${DAY}T1${index}:00:00.000Z`, starbase: STARBASE,
    output: recipe.output, crafted: recipe.crafted,
    ingredients: [{ input: recipe.ingredient, amount: recipe.quantity }],
    feeAmount: zero ? 0 : 1, feeCostsAtlas: zero ? 0 : 1,
    txCostSol: zero ? 0 : 0.02, txsCostsAtlas: zero ? 0 : 2,
    crew: index + 2, txsDaily: 1,
  }));
  const ledgerRows = duplicate ? [...craftingRows, ...craftingRows] : craftingRows;
  const result = buildCostLedgerResult({ openingInventoryRows, miningRows, craftingRows: ledgerRows });
  return { craftingRows, result };
}
function enrich(scope, options = {}) {
  const { craftingRows, result } = rowsFor(scope, options);
  const basis = buildCraftingBasisByDay(result.appliedEventResults);
  const prices = Object.fromEntries(recipes.map((recipe) => [recipe.output, recipe.price]));
  return {
    rows: enrichCraftingEarningsRows({
      craftingRows, craftingBasisByDay: basis,
      resolvePrice: (asset) => prices[asset] ?? 5,
      atlasPerSol: 100,
    }),
    basis,
  };
}

for (const scope of scopes) {
  test(`${scope.name}: two recipe identities calculate from only the scoped ledger and replay is idempotent`, () => {
    const once = enrich(scope);
    const replay = enrich(scope, { duplicate: true });
    assert.equal(once.rows.length, 2);
    assert.equal(once.basis.size, 2);
    assert.deepEqual([...replay.basis.entries()], [...once.basis.entries()]);

    for (const [index, row] of once.rows.entries()) {
      const recipe = recipes[index];
      const ingredient = (index + 1) * 10 * scope.multiplier;
      const revenue = recipe.crafted * recipe.price;
      const total = ingredient + 1 + 2;
      const net = revenue - total;
      assert.deepEqual({
        output: row.output,
        ingredient: row.ingCostsAtlas,
        total: row.totalCostsAtlas,
        net: row.netProfitAtlas,
        perCrew: row.netProfitPerCrew,
        perUnit: row.costsPerUnitAtlas,
        margin: row.profitMarginPercent,
      }, {
        output: recipe.output,
        ingredient,
        total,
        net,
        perCrew: net / (index + 2),
        perUnit: total / recipe.crafted,
        margin: net / revenue * 100,
      });
    }
  });

  test(`${scope.name}: missing basis remains unavailable and observed zero remains numeric zero`, () => {
    for (const row of enrich(scope, { uncosted: true }).rows) {
      for (const field of ['ingCostsAtlas', 'totalCostsAtlas', 'netProfitAtlas', 'netProfitPerCrew', 'costsPerUnitAtlas', 'profitMarginPercent']) assert.equal(row[field], null);
    }
    for (const row of enrich(scope, { zero: true }).rows) {
      assert.equal(row.ingCostsAtlas, 0);
      assert.equal(row.totalCostsAtlas, 0);
      assert.equal(row.netProfitAtlas, row.revenueAtlasPerDay);
      assert.equal(row.profitMarginPercent, 100);
    }
  });
}

test('overlapping day, starbase, symbols, and recipes stay isolated by faction/profile snapshot', () => {
  const matrices = scopes.map((scope) => ({ scope, ...enrich(scope) }));
  assert.deepEqual(matrices.map(({ rows }) => rows[0].ingCostsAtlas), [10, 20, 30]);
  assert.deepEqual(matrices.map(({ rows }) => rows[1].ingCostsAtlas), [20, 40, 60]);

  const profileA = enrich({ name: 'MUD', faction: 'MUD', profile: 'mud-profile-a', multiplier: 4 });
  const profileB = enrich({ name: 'MUD', faction: 'MUD', profile: 'mud-profile-b', multiplier: 7 });
  assert.deepEqual(profileA.rows.map((row) => row.ingCostsAtlas), [40, 80]);
  assert.deepEqual(profileB.rows.map((row) => row.ingCostsAtlas), [70, 140]);
});

test('automatic prefetch, profile-scoped checkpoint, IPC, renderer, and other Earnings paths remain bounded', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  const basisSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'crafting-cost-basis.js'), 'utf8');
  assert.match(renderer, /api\.getEarningsSnapshot\(\{ \.\.\.settings, earningsSubtab: 'crafting' \}\)/);
  assert.match(main, /needsInventoryLedger = \['breakeven', 'crafting', 'upgrading'\]\.includes\(snapshotScope\)/);
  assert.match(main, /app\.setPath\('userData', path\.join\(baseUserData, 'profiles', profileName\)\)/);
  assert.match(main, /ledgerCheckpointPath\(ledgerFaction\)/);
  assert.match(main, /loadLedgerCheckpoint\(checkpointPath, \{ faction: ledgerFaction, profile: profileName \}\)/);
  assert.match(main, /buildCurrentInventoryCraftingBasisByDay\(\{ craftingRows, inventoryRows: inventoryCostLedgerRows \}\)/);
  assert.match(main, /enrichCraftingEarningsRows\(\{/);
  assert.match(renderer, /renderEarningsCrafting\(result\)/);
  assert.match(renderer, /profitMarginPercent == null \? '--'/);
  assert.doesNotMatch(basisSource, /Connection\(|getAccountInfo|fetch\(|RPC|setInterval|setTimeout/i);
  assert.match(renderer, /\{ key: 'scanning'[^]*\{ key: 'mining'[^]*\{ key: 'crafting'[^]*\{ key: 'earnings'/);
});
