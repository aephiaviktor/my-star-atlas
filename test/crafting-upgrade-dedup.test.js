'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { removeUpgradeMirroredCraftingEvents } = require('../electron/crafting-upgrade-dedup');

function event(craftingId, timestamp, crafted, ingredientAmount = crafted * 2) {
  return { craftingId, timestamp, starbase: 'ONI-PHANTOM', output: 'Framework', crafted, feeAmount: 1, txCostSol: 0.01, crew: 3, ingredients: [{ input: 'Iron', amount: ingredientAmount }] };
}
function job(craftingId, startedAt, amount) {
  return { craftingId, startedAt, amount, starbase: 'ONI-PHANTOM', component: 'Framework' };
}

test('actual Aug 15 and Aug 20 upgrade mirrors are removed by lifecycle start correlation', () => {
  const mirrors = [
    event('161903537566389', '2026-08-15T21:42:00.953Z', 73222, 146444),
    event('68786125235232', '2026-08-20T12:02:37.757Z', 4, 8),
    event('134433316723373', '2026-08-20T12:05:06.203Z', 4, 8),
    event('41267518769215', '2026-08-20T12:09:10.113Z', 2, 4),
    event('81247364035428', '2026-08-20T12:11:37.589Z', 2, 4),
    event('254513409941932', '2026-08-20T12:14:07.662Z', 2, 4),
    event('40633328653166', '2026-08-20T12:16:35.206Z', 2, 4),
  ];
  const jobs = [
    job('265045561520672', 1786830130491, 73222),
    job('4799269928909', 1787227358716, 4),
    job('192516182986921', 1787227507061, 4),
    job('74723861537001', 1787227749105, 2),
    job('121314375937800', 1787227896422, 2),
    job('221719118969485', 1787228046314, 2),
    job('44789810328452', 1787228193966, 2),
  ];
  const rows = [
    { starbase: 'ONI-PHANTOM', output: 'Framework', isoDate: '2026-08-15', label: 'Aug 15', crafted: 73222, txsDaily: 1, feeAmount: 1, txCostSol: 0.01, crew: 3, ingredients: [{ input: 'Iron', amount: 146444 }] },
    { starbase: 'ONI-PHANTOM', output: 'Framework', isoDate: '2026-08-20', label: 'Aug 20', crafted: 16, txsDaily: 6, feeAmount: 6, txCostSol: 0.06, crew: 18, ingredients: [{ input: 'Iron', amount: 32 }] },
  ];
  rows.ledgerEvents = mirrors;

  const result = removeUpgradeMirroredCraftingEvents(rows, jobs);
  assert.deepEqual(result.map((row) => row.isoDate), []);
  assert.deepEqual(result.ledgerEvents, []);
  assert.deepEqual(result.mirroredUpgradeCraftingIds, mirrors.map((row) => row.craftingId).sort());
});

test('genuine Framework craft is retained when no matching upgrade starts within tolerance', () => {
  const genuine = event('real-craft', '2026-08-20T10:00:00.000Z', 100, 200);
  const rows = [{ starbase: genuine.starbase, output: genuine.output, isoDate: '2026-08-20', label: 'Aug 20', crafted: 100, txsDaily: 1, feeAmount: 1, txCostSol: 0.01, crew: 3, ingredients: genuine.ingredients }];
  rows.ledgerEvents = [genuine];
  const result = removeUpgradeMirroredCraftingEvents(rows, [job('upgrade', Date.parse('2026-08-20T10:01:00Z'), 100)]);
  assert.equal(result.length, 1);
  assert.deepEqual(result.ledgerEvents, [genuine]);
  assert.deepEqual(result.mirroredUpgradeCraftingIds, []);
});
