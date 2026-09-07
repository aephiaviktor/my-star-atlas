'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { compareToolkitClocks, observeToolkitClock } = require('../electron/toolkit-clock-observations');
const first = require('./fixtures/phantom-upkeep-mainnet-20260907.json');
const second = require('./fixtures/phantom-upkeep-mainnet-20260907-later.json');
const { calculateCurrentResourceTimeStop } = require('@staratlas/sage');
const { BN } = require('@staratlas/anchor');
test('two finalized public captures measure MUD stopped time and agree with SDK stop clock', () => {
  const expected = [3427, 0, 0];
  for (let i=0;i<3;i++) {
    const a=first.states[i], b=second.states[i];
    const project=s=>calculateCurrentResourceTimeStop(new BN(s.observedAt),new BN(s.localTime),new BN(s.globalTime),new BN(s.balance),s.depletionRate / 100).localTime.toNumber();
    assert.equal(project(b)-project(a),23004-expected[i]);
    assert.equal(compareToolkitClocks(a,b).downtimeSeconds,expected[i]);
  }
});
test('observations survive restart, deduplicate refresh and recover after a bad pair', async () => {
  let saved=null; const deps={load:async()=>structuredClone(saved),save:async x=>{saved=structuredClone(x);}};
  const a=first.states[0], b=second.states[0];
  assert.equal((await observeToolkitClock({...deps,latest:a})).clockStatus,'baseline_only');
  assert.equal((await observeToolkitClock({...deps,latest:b})).clockWindows[0].downtimeSeconds,3427);
  assert.equal((await observeToolkitClock({...deps,latest:b})).clockWindows.length,1);
  const invalid={...b,slot:b.slot+1,observedAt:b.observedAt+1,localTime:0};
  assert.equal((await observeToolkitClock({...deps,latest:invalid})).clockStatus,'upkeep_clock_reconciliation_failed');
  const next={...invalid,slot:invalid.slot+1,observedAt:invalid.observedAt+1};
  assert.equal((await observeToolkitClock({...deps,latest:next})).clockWindows.length,2);
  await assert.rejects(observeToolkitClock({...deps,latest:{...next,faction:'ONI'}}),/scope_mismatch/);
});
