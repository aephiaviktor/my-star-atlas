'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { recoverSelectionComponentPrices, calculateUpgradingSelectionUtilization } = require('../electron/upgrading-selection-utilization');

test('cross-midnight September 7 cohort fetches the previous neutral mix at completion-day prices', async () => {
  const input = {
    jobs: [{ component: 'electronics', amount: 3600 / 14, crew: 1, startedAt: '2026-09-06T23:30:00Z', completedAt: '2026-09-07T00:30:00Z' }],
    neutralHours: [
      { time: '2026-09-06T23:00:00Z', component: 'framework', neutral_crew: 1 },
      { time: '2026-09-07T00:00:00Z', component: 'electronics', neutral_crew: 1 },
    ],
    pricesByDate: { '2026-09-06': { framework: 1 }, '2026-09-07': { electronics: 2 } },
    atlasPerLpByDate: { '2026-09-07': .1 },
  };
  assert.equal(calculateUpgradingSelectionUtilization(input).selection[0].evidence_complete, false);
  const calls = [];
  const recovered = await recoverSelectionComponentPrices({ ...input, resolvePrice: async (...args) => { calls.push(args); return { status: 'complete', priceATL: 3 }; } });
  assert.deepEqual(calls, [['framework', '2026-09-07']]);
  assert.equal(input.pricesByDate['2026-09-07'].framework, undefined);
  const row = calculateUpgradingSelectionUtilization({ ...input, pricesByDate: recovered }).selection[0];
  assert.equal(row.evidence_complete, true);
  assert.ok(Number.isFinite(row.selection_uplift_atlas_per_active_crew_day));
  // Recovered result must equal a fully supplied, independently constructed input.
  assert.equal(row.selection_uplift_atlas, calculateUpgradingSelectionUtilization({ ...input, pricesByDate: { '2026-09-07': { electronics: 2, framework: 3 } } }).selection[0].selection_uplift_atlas);
});

test('zero-weight neutral components require neither prices nor supported recipe constants', async () => {
  const input = { jobs: [{ component: 'framework', amount: 300, crew: 1, startedAt: '2026-09-07T00:00:00Z', completedAt: '2026-09-07T01:00:00Z' }], neutralHours: [
    { time: '2026-09-07T00:00:00Z', component: 'framework', neutral_crew: 1 },
    { time: '2026-09-07T00:00:00Z', component: 'unused unknown component', neutral_crew: 0 },
  ], pricesByDate: { '2026-09-07': { framework: 0 } }, atlasPerLpByDate: { '2026-09-07': .1 } };
  const recovered = await recoverSelectionComponentPrices({ ...input, resolvePrice: async () => { throw new Error('No missing used prices'); } });
  assert.equal(calculateUpgradingSelectionUtilization({ ...input, pricesByDate: recovered }).selection[0].selection_uplift_atlas, 0);
});

test('neutral loader retains crew-only evidence without inventing hourly production', async () => {
  const source = fs.readFileSync('electron/main.js', 'utf8');
  const ctx = {
    escapeFluxString: x => x, buildInstanceScopeFilter: () => '',
    queryInfluxFlux: async () => '', parseInfluxCsv: () => [
      { _time: '2026-09-07T00:10:00Z', component: 'framework', neutral_crew: '10' },
      { _time: '2026-09-07T01:10:00Z', component: 'framework', neutral_crew: '20', neutral_upgrading_hour: 'bad' },
    ],
    normalizeShipName: x => x, resolveHistoricalAtlasPrice: async () => ({ status: 'complete', priceATL: 1 }), UPGRADE_LP_BY_COMPONENT: { framework: 68 },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('async function fetchDailyNeutralUpgradingPlan'), source.indexOf('function optimizationNumberQuantile')), ctx);
  const result = await ctx.fetchDailyNeutralUpgradingPlan({ influxUrl: 'unused', influxAuthToken: 'unused', influxBucket: 'test' });
  assert.equal(result.hourlyAllocations.length, 2);
  assert.equal(result.hourlyAllocations[1].neutral_crew, 20);
  assert.equal(result.length, 0);
});
