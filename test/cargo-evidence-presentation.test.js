'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  formatExactCargoQuantity,
  prepareCargoEvidenceRows,
} = require('../electron/cargo-evidence-presentation');

function confirmed(overrides = {}) {
  return {
    betaId: 'cargo-delivery:v1:program:sig:3:unload',
    deliveryEventId: 'cargo-delivery:v1:program:sig:3:unload',
    evidenceAuthority: 'authoritative_v1',
    evidenceStatus: 'Authoritative — delivery evidence v1',
    deliveredQuantity: '19999',
    replayCount: 1,
    confirmedBlockTime: '1787561002',
    confirmedSlot: '361234567',
    timestamp: '2026-08-24T08:43:22.000Z',
    cargoCostPerUnit: '0.000123000000000000',
    ...overrides,
  };
}

test('v265 anchor renders the full authoritative quantity without consulting amount', () => {
  const [row] = prepareCargoEvidenceRows([confirmed({ amount: 1 })]);
  assert.equal(row.displayQuantity, '19,999');
  assert.equal(row.displayStatus, 'Confirmed');
  assert.equal(row.cargoCostPerUnit, '0.000123000000000000');
  assert.equal(prepareCargoEvidenceRows([confirmed({ evidenceStatus: 'Incomplete — Base history missing' })])[0].displayStatus, 'Confirmed · Incomplete — Base history missing');
});

test('v264 replay is one confirmed delivery with unobtrusive replay provenance', () => {
  const event = confirmed({ replayCount: 2 });
  const rows = prepareCargoEvidenceRows([event, { ...event }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].displayStatus, 'Confirmed · replay ×2');
  assert.match(rows[0].statusTitle, /2 identical evidence rows/);
});

test('huge and tiny canonical decimals preserve every digit and never use scientific notation', () => {
  const huge = `${'9'.repeat(62)}.${'0'.repeat(17)}1`;
  assert.equal(formatExactCargoQuantity(huge), `99,${Array(20).fill('999').join(',')}.${'0'.repeat(17)}1`);
  assert.equal(formatExactCargoQuantity('0.000000000000000001'), '0.000000000000000001');
  assert.doesNotMatch(formatExactCargoQuantity(huge), /e[+-]?\d/i);
});

test('distinct instructions remain separate and confirmed block time plus event ID controls order', () => {
  const first = confirmed({ deliveryEventId: 'cargo-delivery:v1:p:s:3:unload', betaId: 'cargo-delivery:v1:p:s:3:unload' });
  const second = confirmed({ deliveryEventId: 'cargo-delivery:v1:p:s:4:unload', betaId: 'cargo-delivery:v1:p:s:4:unload' });
  const newer = confirmed({ deliveryEventId: 'cargo-delivery:v1:p:s:2:unload', betaId: 'cargo-delivery:v1:p:s:2:unload', confirmedBlockTime: '1787561003' });
  assert.deepEqual(prepareCargoEvidenceRows([second, first, newer]).map((row) => row.deliveryEventId), [newer.deliveryEventId, first.deliveryEventId, second.deliveryEventId]);
});

test('legacy stays visibly unverified and invalid or conflict status cannot become confirmed', () => {
  const legacy = { betaId: 'legacy', evidenceAuthority: 'legacy_unverified', evidenceStatus: 'Estimated — legacy evidence', deliveredQuantity: 1200, timestamp: '2026-08-24T09:00:00Z' };
  const conflict = confirmed({ deliveryEventId: 'conflict', betaId: 'conflict', evidenceStatus: 'Quarantined — payload hash conflict' });
  const rows = prepareCargoEvidenceRows([legacy, conflict]);
  assert.equal(rows.find((row) => row.betaId === 'legacy').displayStatus, 'Legacy — unverified estimate');
  assert.equal(rows.find((row) => row.betaId === 'legacy').isConfirmed, false);
  assert.equal(rows.find((row) => row.betaId === 'conflict').isConfirmed, false);
  assert.match(rows.find((row) => row.betaId === 'conflict').displayStatus, /Quarantined/);
});

test('renderer wires exact prepared quantities statuses and confirmed-only summary before the main script', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../electron/renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../electron/renderer.html'), 'utf8');
  assert.match(renderer, /presentation\.prepareCargoEvidenceRows\(rows\)/);
  assert.match(renderer, /entry\.displayQuantity/);
  assert.match(renderer, /entry\.displayStatus/);
  assert.match(renderer, /sortedRows\.filter\(\(row\) => row\.isConfirmed\)/);
  assert.ok(html.indexOf('src="./cargo-evidence-presentation.js"') < html.indexOf('src="./renderer.js"'));
});

test('allocation presentation keeps split mechanics and uses allocation terminology', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../electron/cargo-allocation-renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../electron/renderer.html'), 'utf8');
  assert.match(renderer, /label: 'Allocated Amount'/);
  assert.match(html, /<th scope="col">Allocated Amount<\/th>/);
  assert.doesNotMatch(renderer, /label: 'Cargo Amount'/);
});
