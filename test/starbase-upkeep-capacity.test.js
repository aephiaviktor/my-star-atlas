'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BN } = require('@staratlas/anchor');
const { calculateCurrentResourceTimeStop } = require('@staratlas/sage/dist/src/starbase');
const { projectClock, reconcileToolkitHistory, normalizeState, splitCapacityIntervalsByUtcHour } = require('../electron/starbase-upkeep-capacity');
const t = Date.parse('2026-09-07T00:00:00Z') / 1000;
const base = () => ({ faction: 'MUD', starbase: 'MUD-PHANTOM', starbasePublicKey: 'sb', slot: 10, observedAt: t, globalTime: t, localTime: t - 100, balance: 600, depletionRate: 100, reserve: 3600, level: 6 });
test('integer stop clock matches SDK before, at, and after depletion with residual balances', () => {
  for (const rate of [100, 300, 10000]) for (const balance of [0, 1, 599, 600, 601]) for (const elapsed of [0, 1, 60, 600, 3600]) {
    const s = { ...base(), balance, depletionRate: rate };
    const actual = projectClock(s, t + elapsed);
    const sdk = calculateCurrentResourceTimeStop(new BN(t + elapsed), new BN(s.localTime), new BN(t), new BN(balance), rate / 100);
    assert.equal(actual.localTime, sdk.localTime.toNumber());
    assert.equal(actual.balance, sdk.newBalance.toNumber());
  }
});
test('shortage and refill reconcile both clock and balance and preserve identity', () => {
  const anchor = base();
  const deposits = [{ time: new Date((t + 1200) * 1000).toISOString(), slot: 15, signature: 'refill', amount: 1200 }];
  const target = { ...anchor, slot: 20, observedAt: t + 3600, globalTime: t + 1200, localTime: anchor.localTime + 600, balance: 1200 };
  const { intervals, events } = reconcileToolkitHistory({ anchor, target, deposits });
  assert.deepEqual(intervals.map(x => x.multiplier), [1, 0, 1, 0]);
  assert.equal(events[0].faction, 'MUD');
  assert.equal(events[0].starbase, anchor.starbase);
  const hour = splitCapacityIntervalsByUtcHour(intervals)[0];
  assert.equal(hour.effectiveCapacitySeconds, 1800);
  assert.equal(hour.toolkitEmptySeconds, 1800);
  assert.throws(() => reconcileToolkitHistory({ anchor, target, deposits: [] }), /clock_reconciliation/);
});
test('equal final empty balances cannot hide missing deposits or cross-scope/config changes', () => {
  const anchor = base(), target = { ...base(), slot: 20, observedAt: t + 3600, globalTime: t + 3600, balance: 0, localTime: base().localTime + 1200 };
  assert.throws(() => reconcileToolkitHistory({ anchor, target }), /clock_reconciliation/);
  assert.throws(() => reconcileToolkitHistory({ anchor, target: { ...target, faction: 'ONI' } }), /configuration_changed/);
  assert.equal(normalizeState({ ...anchor, depletionRate: 101 }), null);
  assert.equal(normalizeState({ ...anchor, localTime: null }), null);
});
test('disabled upkeep retains full speed even without Toolkits', () => {
  const s = { ...base(), reserve: 0, depletionRate: 0 };
  assert.equal(projectClock(s, t + 300).localTime, t + 300);
});
