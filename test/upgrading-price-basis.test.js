'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const renderer = fs.readFileSync('electron/renderer.js', 'utf8');
const html = fs.readFileSync('electron/renderer.html', 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function loadBasisFunctions() {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    extractFunction(renderer, 'upgradingComponentIdentity'),
    extractFunction(renderer, 'calculateUpgradingProfitability'),
    extractFunction(renderer, 'calculateUpgradingEqualNetRows'),
    extractFunction(renderer, 'applyUpgradingPriceBasis'),
    extractFunction(renderer, 'parseUpgradingCustomPrice'),
    extractFunction(renderer, 'upgradingCustomPriceScopeKey'),
    extractFunction(renderer, 'updateUpgradingCustomPriceOverrides'),
    'this.api={upgradingComponentIdentity,calculateUpgradingProfitability,calculateUpgradingEqualNetRows,applyUpgradingPriceBasis,parseUpgradingCustomPrice,upgradingCustomPriceScopeKey,updateUpgradingCustomPriceOverrides};',
  ].join('\n'), context);
  return context.api;
}

function rows() {
  return [
    { name: 'Framework', gmPrice: 0.0012, durationSeconds: 12, grossAtlasPerSecond: 0.0003, impliedAtlasValue: 0.0036, cargoWeight: 1, netAtlasPerSecond: 0.0002 },
    { name: 'Electronics', gmPrice: 0.0042, durationSeconds: 14, grossAtlasPerSecond: 0.0004, impliedAtlasValue: 0.0056, cargoWeight: 2, netAtlasPerSecond: 0.0001 },
    { name: 'Power Source', gmPrice: 0.01, durationSeconds: 15, grossAtlasPerSecond: 0.0001, impliedAtlasValue: 0.0015, cargoWeight: 2, netAtlasPerSecond: -0.0005666666666666667 },
  ];
}

test('Equal Net fixes the deterministic best External benchmark and reprices every reachable component', () => {
  const { calculateUpgradingEqualNetRows } = loadBasisFunctions();
  const result = calculateUpgradingEqualNetRows(rows());
  assert.equal(result.benchmark.name, 'Framework');
  assert.equal(result.benchmark.price, 0.0012);
  assert.equal(result.benchmark.netAtlasPerSecond, 0.0002);
  assert.equal(result.rows[0].equalNetPrice, 0.0012);
  assert.ok(Math.abs(result.rows[1].equalNetPrice - 0.0028) < 1e-15);
  assert.equal(result.rows[2].equalNetStatus, 'unreachable');
  for (const row of result.rows.filter((entry) => entry.equalNetStatus === 'available')) {
    assert.ok(Math.abs(row.netAtlasPerSecond - result.benchmark.netAtlasPerSecond) < 1e-15);
  }
});

test('Equal Net uses canonical identity as the benchmark tie-breaker and preserves zero/unavailable', () => {
  const { calculateUpgradingEqualNetRows } = loadBasisFunctions();
  const tied = rows().slice(0, 2).map((row) => ({ ...row, netAtlasPerSecond: 0.0002 }));
  tied[1].gmPrice = 0.0028;
  assert.equal(calculateUpgradingEqualNetRows(tied).benchmark.name, 'Electronics');
  const states = calculateUpgradingEqualNetRows([
    { name: 'Alpha', gmPrice: 1, durationSeconds: 10, grossAtlasPerSecond: 0.102, impliedAtlasValue: 1.02, cargoWeight: 1, netAtlasPerSecond: 0.002 },
    { name: 'Zero', gmPrice: 0, durationSeconds: 10, grossAtlasPerSecond: 0.002, impliedAtlasValue: 0.02, cargoWeight: 1, netAtlasPerSecond: 0.002 },
    { name: 'Missing', gmPrice: null, durationSeconds: 10, grossAtlasPerSecond: null, impliedAtlasValue: null, cargoWeight: 1, netAtlasPerSecond: null },
  ]);
  assert.equal(states.rows[1].equalNetPrice, 0);
  assert.equal(states.rows[1].netAtlasPerSecond, 0.002);
  assert.equal(states.rows[2].equalNetStatus, 'unavailable');
  assert.equal(states.rows[2].equalNetPrice, null);
});

test('Custom prices inherit External, accept comma/point and zero, reject invalid, and reset without copying External', () => {
  const { parseUpgradingCustomPrice, applyUpgradingPriceBasis, upgradingCustomPriceScopeKey, updateUpgradingCustomPriceOverrides } = loadBasisFunctions();
  assert.equal(parseUpgradingCustomPrice('1,25').value, 1.25);
  assert.equal(parseUpgradingCustomPrice('0').value, 0);
  assert.equal(parseUpgradingCustomPrice('wat').ok, false);
  const key = upgradingCustomPriceScopeKey('profile-A', 'MUD', 'Framework');
  let overrides = updateUpgradingCustomPriceOverrides({}, key, 0);
  const custom = applyUpgradingPriceBasis(rows().slice(0, 1), 'custom', { customPrices: { Framework: overrides[key] } });
  assert.equal(custom.rows[0].appliedPrice, 0);
  assert.equal(custom.rows[0].customOverridden, true);
  overrides = updateUpgradingCustomPriceOverrides(overrides, key, null);
  assert.equal(Object.hasOwn(overrides, key), false);
  const inherited = applyUpgradingPriceBasis(rows().slice(0, 1), 'custom', { customPrices: {} });
  assert.equal(inherited.rows[0].appliedPrice, 0.0012);
  assert.equal(inherited.rows[0].customOverridden, false);
});

test('Custom override identity is isolated by profile, faction, and authoritative component identity', () => {
  const { upgradingCustomPriceScopeKey } = loadBasisFunctions();
  const keys = new Set([
    upgradingCustomPriceScopeKey('profile-A', 'MUD', 'Framework'),
    upgradingCustomPriceScopeKey('profile-A', 'ONI', 'Framework'),
    upgradingCustomPriceScopeKey('profile-B', 'MUD', 'Framework'),
    upgradingCustomPriceScopeKey('profile-A', 'MUD', 'Electronics'),
  ]);
  assert.equal(keys.size, 4);
});

test('four-basis UI labels, tooltips, chart propagation, and Frontier Limit removal are explicit', () => {
  for (const label of ['External', 'Internal', 'Equal Net', 'Custom']) assert.match(html, new RegExp(`>${label}<`));
  assert.match(renderer, /label: 'External'.*Galactic Marketplace \(GM\) price/);
  assert.match(renderer, /label: 'Internal'.*Production cost from Earnings → Inventory Ledger → Inventory Valuation/);
  assert.match(renderer, /key: 'equalNetPrice', label: 'Equal-Net Price'/);
  assert.match(renderer, /key: 'customPrice', label: 'Custom Price'/);
  assert.match(renderer, /Basis: External · GM Price/);
  assert.match(renderer, /Basis: Internal · Production Cost/);
  assert.match(renderer, /Basis: Equal Net · Benchmark:/);
  assert.match(renderer, /Basis: Custom · .* overrides · remaining prices External/);
  assert.doesNotMatch(html, /id="optimization-upgrading-efficiency-limit"/);
  assert.doesNotMatch(renderer, /upgradingEfficiencyLimitMode|upgradingLimitAnchorByFaction|applyUpgradingLimitPrices/);
  for (const render of ['renderUpgradingNetAtlasChart', 'renderUpgradingMarginChart', 'renderUpgradingEfficiencyChart']) {
    assert.match(extractFunction(renderer, render), /appendUpgradingBasisInfo/);
  }
});
