'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { averageRecordedCrew } = require('../electron/crafting-crew-average');

test('repeated crafting transactions preserve assigned crew instead of multiplying it', () => {
  assert.equal(averageRecordedCrew([94, 94]), 94);
  assert.equal(averageRecordedCrew([63, 63, 63, 63]), 63);
});

test('crafting crew is the average of valid positive observations', () => {
  assert.equal(averageRecordedCrew([63, 94]), 78.5);
  assert.equal(averageRecordedCrew([94, 0, -1, NaN, null]), 94);
  assert.equal(averageRecordedCrew([]), 0);
});
