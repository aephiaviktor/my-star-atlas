const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeVersion, detectVersionDrift } = require('../scripts/version-drift');

test('normalizeVersion strips an optional leading v and surrounding whitespace', () => {
  assert.equal(normalizeVersion('v0.6.305'), '0.6.305');
  assert.equal(normalizeVersion('0.6.305'), '0.6.305');
  assert.equal(normalizeVersion('  v0.6.305  '), '0.6.305');
  assert.equal(normalizeVersion(null), '');
});

test('detectVersionDrift is null when the tag matches package.json version', () => {
  assert.equal(detectVersionDrift('v0.6.305', '0.6.305'), null);
  assert.equal(detectVersionDrift('0.6.305', '0.6.305'), null);
});

test('detectVersionDrift reports a reason when the tag and package.json version disagree', () => {
  const drift = detectVersionDrift('v0.6.305', '0.6.304');
  assert.match(drift, /0\.6\.305/);
  assert.match(drift, /0\.6\.304/);
});

test('detectVersionDrift reports a reason for an unparseable tag or missing package version', () => {
  assert.match(detectVersionDrift('', '0.6.305'), /Could not parse/);
  assert.match(detectVersionDrift('v0.6.305', ''), /no usable version/);
});
