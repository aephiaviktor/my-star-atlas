'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createBreakevenBasisState, formatBreakevenBasisStateInfluxLine, projectBreakevenBasisStateRows,
  diffBreakevenBasisStates, buildLatestBreakevenBasisStateFlux,
} = require('../electron/breakeven-basis-state');

function row(overrides = {}) {
  return {
    faction: 'USTUR', starbase: 'CSS', asset: 'Iron Ore', timestamp: '2026-08-30T16:00:00.000Z',
    inventory: 1000, knownCostQuantity: 1000, uncostedQuantity: 0, ledgerQuantity: 1000,
    quantityVariance: 0, estimatedPercent: 0, miningCostPerUnit: 0.5, cargoCostPerUnit: 0.1,
    baseCostPerUnit: 0.5, landedCostPerUnit: 0.6, fullyTracked: true, reconciliationStatus: 'reconciled',
    ...overrides,
  };
}

test('Breakeven basis state persists complete current cost provenance and explicit zero balances', () => {
  const current = createBreakevenBasisState(row());
  const line = formatBreakevenBasisStateInfluxLine(current);
  assert.match(line, /^breakeven_basis_state,faction=USTUR,starbase=CSS,asset=Iron\\ Ore /);
  assert.match(line, /inventory=1000/);
  assert.match(line, /miningCostPerUnit=0.5/);
  assert.match(line, /cargoCostPerUnit=0.1/);
  assert.match(line, /landedCostPerUnit=0.6/);
  assert.match(formatBreakevenBasisStateInfluxLine(row({ inventory: 0 })), /inventory=0/);
});

test('Breakeven state diff writes only changes and tombstones disappeared inventory', () => {
  const priorIron = createBreakevenBasisState(row({ timestamp: '2026-08-30T15:00:00.000Z' }));
  const priorCopper = createBreakevenBasisState(row({ asset: 'Copper Ore', inventory: 20, timestamp: '2026-08-30T15:00:00.000Z' }));
  const unchanged = diffBreakevenBasisStates([row()], [priorIron], { faction: 'USTUR', timestamp: '2026-08-30T16:00:00.000Z' });
  assert.deepEqual(unchanged, []);
  const changes = diffBreakevenBasisStates([row({ inventory: 900 })], [priorIron, priorCopper], {
    faction: 'USTUR', timestamp: '2026-08-30T16:00:00.000Z',
  });
  assert.equal(changes.length, 2);
  assert.equal(changes.find((entry) => entry.asset === 'Iron Ore').inventory, 900);
  assert.equal(changes.find((entry) => entry.asset === 'Copper Ore').inventory, 0);
});

test('latest Breakeven query holds state indefinitely and projected rows require a valid hash', () => {
  const flux = buildLatestBreakevenBasisStateFlux('slya');
  assert.match(flux, /range\(start: 0\)/);
  assert.match(flux, /group\(columns: \["faction", "starbase", "asset", "_field"\]\)/);
  const current = createBreakevenBasisState(row());
  assert.deepEqual(projectBreakevenBasisStateRows([{ ...current, _time: current.timestamp }]), [current]);
  assert.deepEqual(projectBreakevenBasisStateRows([{ ...current, stateHash: 'wrong', _time: current.timestamp }]), []);
});
