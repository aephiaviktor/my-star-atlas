const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestGuard } = require('../electron/request-guard');

test('a superseded response cannot commit after a newer request starts', () => {
  const guard = createRequestGuard();
  const oldRequest = guard.begin('production', { faction: 'MUD', starbase: '' });
  const newRequest = guard.begin('production', { faction: 'USTUR', starbase: '' });

  assert.equal(guard.isCurrent(oldRequest, { faction: 'MUD', starbase: '' }), false);
  assert.equal(guard.isCurrent(newRequest, { faction: 'USTUR', starbase: '' }), true);
});

test('a response cannot commit when its faction or filter context changed', () => {
  const guard = createRequestGuard();
  const request = guard.begin('crafting', { faction: 'MUD', starbase: 'MRZ-1', recipe: 'Fuel' });

  assert.equal(guard.isCurrent(request, { faction: 'ONI', starbase: 'MRZ-1', recipe: 'Fuel' }), false);
  assert.equal(guard.isCurrent(request, { faction: 'MUD', starbase: 'MRZ-2', recipe: 'Fuel' }), false);
});
