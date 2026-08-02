'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildEarningsCacheKey } = require('../electron/earnings-cache-key');

const base = Object.freeze({
  schemaVersion: '1', faction: 'MUD', playerProfile: 'ProfileABC',
  section: 'earnings', subtab: 'mining', datasetScope: 'lightweight', filters: {},
});
const key = (overrides = {}) => buildEarningsCacheKey({ ...base, ...overrides });

test('prints exact deterministic faction key examples', () => {
  assert.equal(key(), 'msa:earnings-cache:{"datasetScope":"lightweight","faction":"MUD","filters":{},"playerProfile":"ProfileABC","schemaVersion":"1","section":"earnings","subtab":"mining"}');
  assert.equal(key({ faction: 'ONI' }), 'msa:earnings-cache:{"datasetScope":"lightweight","faction":"ONI","filters":{},"playerProfile":"ProfileABC","schemaVersion":"1","section":"earnings","subtab":"mining"}');
  assert.equal(key({ faction: 'USTUR' }), 'msa:earnings-cache:{"datasetScope":"lightweight","faction":"USTUR","filters":{},"playerProfile":"ProfileABC","schemaVersion":"1","section":"earnings","subtab":"mining"}');
});

test('every structural identity dimension independently participates', () => {
  const baseline = key();
  for (const overrides of [
    { faction: 'ONI' }, { faction: 'USTUR' }, { playerProfile: 'Profileabc' },
    { schemaVersion: '2' }, { section: 'breakeven' }, { subtab: 'scanning' },
    { datasetScope: 'complete' }, { filters: { starbase: 'A' } },
  ]) assert.notEqual(key(overrides), baseline);
  assert.notEqual(
    key({ section: 'earnings', subtab: 'overview', datasetScope: 'lightweight' }),
    key({ section: 'breakeven', subtab: 'overview', datasetScope: 'complete' }),
  );
});

test('canonicalizes nested object order while preserving array order and primitive types', () => {
  const a = key({ filters: { starbase: 'A', nested: { z: true, a: null }, route: ['X', 'Y'], count: 0 } });
  const b = key({ filters: { count: 0, route: ['X', 'Y'], nested: { a: null, z: true }, starbase: 'A' } });
  assert.equal(a, b);
  assert.notEqual(a, key({ filters: { count: 0, route: ['Y', 'X'], nested: { a: null, z: true }, starbase: 'A' } }));
  assert.notEqual(key({ filters: { value: 0 } }), key({ filters: { value: '0' } }));
});

test('punctuation and separators cannot create collisions', () => {
  assert.notEqual(key({ playerProfile: 'a|b', filters: { x: 'c' } }), key({ playerProfile: 'a', filters: { x: 'b|c' } }));
  assert.notEqual(key({ filters: { 'a:b': 'c,d' } }), key({ filters: { a: 'b:c,d' } }));
});

test('invalid or incomplete descriptors fail closed', () => {
  for (const field of ['schemaVersion', 'faction', 'playerProfile', 'section', 'subtab', 'datasetScope', 'filters']) {
    const value = { ...base }; delete value[field];
    assert.throws(() => buildEarningsCacheKey(value), /required|must/i);
  }
  for (const faction of ['', 'UST', 'mud', undefined]) assert.throws(() => key({ faction }), /faction/i);
  for (const field of ['playerProfile', 'section', 'subtab', 'datasetScope']) {
    assert.throws(() => key({ [field]: '' }), new RegExp(field, 'i'));
    assert.throws(() => key({ [field]: `  ` }), new RegExp(field, 'i'));
  }
  assert.throws(() => key({ filters: [] }), /plain object/i);
  assert.throws(() => key({ filters: null }), /plain object/i);
});

test('rejects every unsupported or ambiguous filter value including cycles', () => {
  const sparse = []; sparse[1] = 'x';
  const cyclic = {}; cyclic.self = cyclic;
  class Custom { constructor() { this.x = 1; } }
  const symbolKey = { valid: 1 }; symbolKey[Symbol('hidden')] = 2;
  const extraArrayProperty = ['x']; extraArrayProperty.extra = true;
  const accessor = {}; Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
  const invalid = [undefined, () => {}, Symbol('x'), 1n, NaN, Infinity, -Infinity, new Date(), new Custom(), sparse, cyclic, symbolKey, extraArrayProperty, accessor];
  for (const value of invalid) assert.throws(() => key({ filters: { value } }), /unsupported|finite|plain|sparse|cyclic|property/i);
});

test('does not mutate descriptor, nested objects, or arrays', () => {
  const descriptor = {
    ...base,
    filters: { nested: { b: 2, a: 1 }, list: [{ z: 3, a: 1 }, 0] },
  };
  const before = JSON.stringify(descriptor);
  buildEarningsCacheKey(descriptor);
  buildEarningsCacheKey(descriptor);
  assert.equal(JSON.stringify(descriptor), before);
  assert.deepEqual(Object.keys(descriptor.filters.nested), ['b', 'a']);
});

test('module is standalone, synchronous, I/O-free, and unused by production consumers', () => {
  const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'earnings-cache-key.js'), 'utf8');
  assert.doesNotMatch(moduleSource, /require\s*\(|import\s|process\.|Date\b|Math\.random|fetch\s*\(|fs\b|http|rpc|influx|electron/i);
  assert.equal(key() instanceof Promise, false);
  for (const file of ['main.js', 'renderer.js', 'preload.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'electron', file), 'utf8');
    assert.doesNotMatch(source, /earnings-cache-key|buildEarningsCacheKey/);
  }
});
