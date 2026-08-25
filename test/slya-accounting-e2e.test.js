'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./fixtures/slya-accounting-evidence-v1.json');
const { authoritativeSlyaAccountingEvents, buildProductionCompleteAccounting } = require('../electron/complete-accounting-production-adapter');

const decimal = (value) => value?.decimal ?? null;
const row = (result, asset) => result.rows.find((entry) => entry.asset === asset);

test('legacy generic SLYA-shaped rows remain visible but cannot mutate authoritative inventory', () => {
  const events = authoritativeSlyaAccountingEvents(fixture.rows, fixture.scope);
  assert.deepEqual(events.map((event) => event.source), ['scanning', 'mining', 'crafting', 'upgrading']);
  assert.deepEqual(events.map((event) => event.type), ['quarantined', 'quarantined', 'pending', 'pending']);
  const result = buildProductionCompleteAccounting({
    scope: fixture.scope,
    period: fixture.period,
    ledgerEvents: fixture.opening,
    authoritativeSlyaEvidence: fixture.rows,
    actualClosing: fixture.actualClosing,
    sourceAvailability: { scanning: 'available', mining: 'available', crafting: 'available', upgrading: 'available' },
  });
  assert.equal(decimal(row(result, 'Ore').actualClosing), '11');
  assert.equal(row(result, 'Ore').reconciliationStatus, 'quantity_mismatch');
  assert.equal(decimal(row(result, 'Plate').acquisitions.crafting), '0');
  assert.equal(decimal(row(result, 'Module').acquisitions.upgrading), '0');
  assert.equal(row(result, 'Module').details.some((detail) => detail.source === 'upgrading' && detail.status === 'pending'), true);
  assert.equal(result.sourceFreshness.upgrading, 'available');
});

test('UI exposes upgrading output and unavailable/quarantine states for the same result contract', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'electron/renderer.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron/renderer.js'), 'utf8');
  assert.match(html, /Upgrading Out/);
  assert.match(html, /value="upgrading"/);
  assert.match(renderer, /freshness\.upgrading/);
  assert.match(renderer, /quarantined/);
  assert.match(renderer, /missing evidence is never treated as zero/);
});
