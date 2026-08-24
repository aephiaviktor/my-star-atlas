'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { calculateUpgradingSelectionUtilization } = require('../electron/upgrading-selection-utilization');

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

test('production integration reuses existing acquisition functions and exposes final V1 wording', () => {
  const main = fs.readFileSync('electron/main.js', 'utf8');
  const renderer = fs.readFileSync('electron/renderer.js', 'utf8');
  const html = fs.readFileSync('electron/renderer.html', 'utf8');
  assert.match(main, /calculateUpgradingSelectionUtilization/);
  assert.match(main, /netAtlasDaily\.jobs/);
  assert.match(main, /neutralUpgradingDaily\.hourlyAllocations/);
  for (const wording of ['Component Selection Uplift — Matched Active Capacity', 'UTC-Calendar Crew-State Utilization', 'Claim-Locked Capacity', 'Operational Result vs Configured 24h Neutral']) assert.match(html, new RegExp(wording));
  assert.match(renderer, /This measures selection, not uptime/);
  assert.match(renderer, /Unknown time is shown, never silently assigned/);
  assert.match(renderer, /attempts\/retries\/failures: NOT OBSERVED/);
});
