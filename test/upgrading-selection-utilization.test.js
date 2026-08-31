'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { calculateUpgradingSelectionUtilization } = require('../electron/upgrading-selection-utilization');
const acceptedFixture = require('./fixtures/upgrading-analytics-v1-accepted-10-days.json');

function input() {
  return {
    faction: 'UST', profile: 'ustur-profile', priceSnapshotAt: '2026-08-24T10:00:00Z',
    prices: { framework: 2, electronics: 3 }, atlasPerLpByDate: { '2026-08-16': 0.1 },
    jobs: [{ component: 'Electronics', amount: 100 * 3600 / 14, crew: 100, startedAt: '2026-08-15T23:30:00Z', completedAt: '2026-08-16T00:45:00Z' }],
    neutralHours: [
      { time: '2026-08-15T23:10:00Z', component: 'Framework', neutral_crew: 100 },
      { time: '2026-08-16T00:10:00Z', component: 'Framework', neutral_crew: 100 },
    ],
    configuredCrewByHour: { '2026-08-15T23': 100, '2026-08-16T00': 100 },
  };
}

test('matched selection uses completion cohort, equal active crew-time, and active crew-day denominator', () => {
  const result = calculateUpgradingSelectionUtilization(input());
  const row = result.selection[0];
  assert.equal(row.time_basis, 'completion_cohort');
  assert.equal(row.completed_job_count, 1);
  assert.equal(row.completion_cohort_active_crew_hours, 100);
  assert.equal(row.active_crew_days, 100 / 24);
  assert.equal(row.selection_uplift_lp_per_active_crew_day, row.selection_uplift_lp / (100 / 24));
  assert.equal(row.evidence_complete, true);
  assert.equal(result.price_warning, 'Indicative reconstruction — valued at current component prices');
});

test('historical component prices are selected by completion date without a current-price warning', () => {
  const value = input();
  value.prices = { framework: 999, electronics: 999 };
  value.pricesByDate = { '2026-08-16': { framework: 2, electronics: 3 } };
  const result = calculateUpgradingSelectionUtilization(value);
  assert.equal(result.price_basis, 'historical_at_or_before');
  assert.equal(result.selection[0].price_basis, 'historical_at_or_before');
  assert.equal(result.price_warning, null);
  assert.deepEqual(result.component_prices_used, value.pricesByDate);
});

test('cross-midnight active intervals stay cohort-scoped while utilization is UTC-calendar scoped', () => {
  const result = calculateUpgradingSelectionUtilization(input());
  assert.deepEqual(result.utilization.map((row) => row.date), ['2026-08-15', '2026-08-16']);
  assert.equal(result.selection[0].date, '2026-08-16');
  assert.equal(result.utilization[0].protocol_active_crew_hours, 50);
  assert.equal(result.utilization[1].protocol_active_crew_hours, 50);
  assert.equal(result.utilization[1].claim_locked_crew_hours, 25);
  assert.equal(result.utilization[1].capacity_not_observed_crew_hours, 25);
});

test('five-state identity is exhaustive and claim locked is not active or idle', () => {
  const result = calculateUpgradingSelectionUtilization(input());
  for (const row of result.utilization) {
    const sum = row.protocol_active_crew_hours + row.claim_locked_crew_hours + row.proven_eligible_idle_crew_hours + row.proven_hard_unavailable_crew_hours + row.capacity_not_observed_crew_hours;
    assert.equal(sum, row.configured_crew_hours);
    assert.equal(row.proven_eligible_idle_crew_hours, 0);
    assert.equal(row.identity_complete, true);
  }
  assert.equal(result.claim_lock.attempt_count, null);
  assert.match(result.claim_lock.evidence_completeness, /NOT OBSERVED/);
});

test('missing neutral allocation fails closed without legacy fallback', () => {
  const value = input(); value.neutralHours = value.neutralHours.slice(0, 1);
  const row = calculateUpgradingSelectionUtilization(value).selection[0];
  assert.equal(row.evidence_complete, false);
  assert.equal(row.selection_uplift_atlas, null);
  assert.match(row.incomplete_reason, /Hourly neutral allocation missing/);
});

test('faction/profile provenance and feasible-neutral bounds are explicit', () => {
  const result = calculateUpgradingSelectionUtilization(input());
  assert.equal(result.faction, 'UST'); assert.equal(result.profile, 'ustur-profile');
  const row = result.utilization[1];
  assert.equal(row.feasible_neutral_lower_crew_hours, 50);
  assert.equal(row.feasible_neutral_upper_crew_hours, 75);
});

test('accepted 10-day fixture preserves exact active-capacity results and job counts', () => {
  assert.deepEqual(acceptedFixture.dates.map((row) => row.jobs), [65, 73, 77, 58, 54, 55, 73, 89, 80, 64]);
  const calculated = acceptedFixture.dates.map((row) => row.upliftAtlas / (row.activeCrewHours / 24));
  assert.equal(calculated.length, 10);
  assert.ok(Math.abs(calculated[4] - 1.3166348180) < 1e-10);
  assert.ok(Math.abs(calculated[7] - 0.2796173712) < 1e-10);
  for (const [index, row] of acceptedFixture.dates.entries()) assert.equal(calculated[index], row.upliftAtlas / (row.activeCrewHours / 24));
});

test('accepted UTC-calendar stacks are exhaustive and preserve the two outliers', () => {
  for (const row of acceptedFixture.dates) assert.ok(Math.abs(row.active + row.claimLocked + row.eligibleIdle + row.hardUnavailable + row.notObserved - 96000) < 0.11);
  const aug16 = acceptedFixture.dates.find((row) => row.date === '2026-08-16');
  const aug20 = acceptedFixture.dates.find((row) => row.date === '2026-08-20');
  assert.ok(Math.abs(aug16.active / 960 - 75.416875) < 1e-9);
  assert.ok(Math.abs(aug16.claimLocked / 960 - 24.1040625) < 1e-9);
  assert.equal(aug20.active, 79306.5);
  assert.ok(Math.abs(aug20.claimLocked / 960 - 13.070729166666666) < 1e-9);
});

test('V1 analytics charts sit side by side without chart tooltips', () => {
  const renderer = fs.readFileSync('electron/renderer.js', 'utf8');
  const html = fs.readFileSync('electron/renderer.html', 'utf8');
  const css = fs.readFileSync('electron/renderer.css', 'utf8');
  assert.equal((html.match(/optimization-upgrading-v1-card/g) || []).length, 2);
  assert.match(css, /\.optimization-upgrading-v1-card\s*\{\s*grid-column:\s*span 1/);
  const v1 = renderer.slice(renderer.indexOf('function renderUpgradingSelectionUtilizationV1'), renderer.indexOf('function renderUpgradingOptimizationAnalytics'));
  assert.doesNotMatch(v1, /bindOptimizationAnalyticsTooltip/);
  assert.doesNotMatch(v1, /optimizationUpgrading(?:Selection|Utilization)V1\.title/);
});

test('V1 analytics begin at the later of 2026-08-14 and the rolling 30-day boundary', () => {
  const renderer = fs.readFileSync('electron/renderer.js', 'utf8');
  assert.match(renderer, /const UPGRADING_V1_LOGIC_START_DATE = '2026-08-14';/);
  assert.match(renderer, /function getUpgradingV1ChartStartDate/);
  assert.match(renderer, /filter\(\(row\) => row\.date >= upgradingV1ChartStartDate/);
});

test('V1.1 renderer contains real scatter, trend, zero line, five-state stack, and responsive rules', () => {
  const renderer = fs.readFileSync('electron/renderer.js', 'utf8');
  const css = fs.readFileSync('electron/renderer.css', 'utf8');
  assert.match(renderer, /xLabel:'ATLAS \/ LP'/);
  assert.match(renderer, /yLabel:'Selection uplift ATLAS \/ active crew-day'/);
  assert.match(renderer, /optimization-zero-line/);
  assert.match(renderer, /optimization-trend-line/);
  for (const label of ['Protocol active','Claim locked','Proven eligible idle','Proven hard unavailable','Capacity not observed']) assert.match(renderer, new RegExp(label));
  assert.match(renderer, /filter\(\(row\) => row\.evidence_complete/);
  assert.match(css, /optimization-upgrading-v1-chart svg[^}]+width:\s*100%/s);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test('production integration reuses existing acquisition functions and exposes final V1 wording', () => {
  const main = fs.readFileSync('electron/main.js', 'utf8');
  const renderer = fs.readFileSync('electron/renderer.js', 'utf8');
  const html = fs.readFileSync('electron/renderer.html', 'utf8');
  assert.match(main, /calculateUpgradingSelectionUtilization/);
  assert.match(main, /netAtlasDaily\.jobs/);
  assert.match(main, /neutralUpgradingDaily\.hourlyAllocations/);
  for (const wording of ['Component Selection Uplift — Matched Active Capacity', 'UTC-Calendar Crew-State Utilization', 'Claim-Locked Capacity', 'Operational Result vs Configured 24h Neutral']) assert.match(html, new RegExp(wording));
  assert.doesNotMatch(renderer, /This measures selection, not uptime/);
  assert.doesNotMatch(renderer, /Unknown time is shown, never silently assigned/);
  assert.match(renderer, /attempts\/retries\/failures: NOT OBSERVED/);
});
