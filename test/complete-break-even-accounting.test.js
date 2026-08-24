'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/complete-break-even-accounting-v1.json');
const { buildCompleteBreakEvenAccounting } = require('../electron/complete-break-even-accounting');

const row = (result, asset) => result.rows.find((entry) => entry.asset === asset);
const decimal = (value) => value?.decimal ?? null;

test('complete fixture conserves exact quantities and processes immutable replay once', () => {
  const result = buildCompleteBreakEvenAccounting(fixture);
  assert.equal(result.scope.faction, 'USTUR');
  assert.equal(result.eventCounts.applied, 11);
  assert.equal(result.eventCounts.replayed, 1);
  assert.equal(result.eventCounts.quarantined, 1);

  const carbon = row(result, 'Carbon');
  assert.equal(decimal(carbon.openingQuantity), '10');
  assert.equal(decimal(carbon.acquisitions.lm), '5');
  assert.equal(decimal(carbon.acquisitions.mining), '20');
  assert.equal(decimal(carbon.craftingOut), '0');
  assert.equal(decimal(carbon.craftingIn), '10');
  assert.equal(decimal(carbon.transferIn), '7');
  assert.equal(decimal(carbon.transferOut), '7');
  assert.equal(decimal(carbon.salesQuantity), '3');
  assert.equal(decimal(carbon.expectedClosing), '22');
  assert.equal(decimal(carbon.actualClosing), '22');
  assert.equal(decimal(carbon.reconciliationDifference.value), '0');
  assert.equal(carbon.reconciliationStatus, 'reconciled');
});

test('weighted basis, sales, fees and partial coverage remain exact and explicit', () => {
  const result = buildCompleteBreakEvenAccounting(fixture);
  const carbon = row(result, 'Carbon');
  assert.equal(decimal(carbon.salesNetProceeds), '8');
  assert.equal(decimal(carbon.cogs), '8.4');
  assert.equal(decimal(carbon.realizedProfit), '-0.4');
  assert.equal(carbon.salesCoverage.status, 'fully_costed');
  assert.equal(decimal(carbon.remainingQuantity), '22');
  assert.equal(decimal(carbon.remainingCostBasis), '11.6');
  assert.equal(decimal(carbon.uncostedQuantity), '0');

  const framework = row(result, 'Framework');
  assert.equal(decimal(framework.remainingQuantity), '1');
  assert.equal(framework.costCoverage.status, 'uncosted');
  assert.equal(decimal(framework.salesNetProceeds), '9');
  assert.equal(framework.cogs, null);
  assert.equal(framework.realizedProfit, null);
  assert.equal(decimal(framework.uncostedQuantity), '1');
});

test('split GM lineage, Cargo cost, source totals and quarantine are auditable', () => {
  const result = buildCompleteBreakEvenAccounting(fixture);
  const iron = row(result, 'Iron Ore');
  assert.equal(decimal(iron.acquisitions.gm), '10');
  assert.equal(decimal(iron.remainingCostBasis), '21');
  assert.equal(decimal(iron.quarantinedQuantity), '2');
  assert.equal(iron.details.filter((entry) => entry.tradeId === 'gm:buy:1').length, 2);

  const carbon = row(result, 'Carbon');
  assert.equal(decimal(carbon.costsBySource.lm), '12');
  assert.equal(decimal(carbon.costsBySource.mining), '6');
  assert.equal(decimal(carbon.costsBySource.cargo), '2');
  assert.equal(carbon.details.filter((entry) => entry.eventId === 'cargo-delivery:v1:fixture').length, 1);
});

test('same immutable ID with changed payload is quarantined and cannot mutate inventory', () => {
  const changed = structuredClone(fixture);
  const replay = changed.events.findLast((event) => event.eventId === 'cargo-delivery:v1:fixture');
  replay.quantity = '6';
  replay.payloadHash = 'changed';
  const result = buildCompleteBreakEvenAccounting(changed);
  assert.equal(result.eventCounts.replayed, 0);
  assert.equal(result.eventCounts.quarantined, 3);
  assert.equal(result.eventCounts.rejected, 1);
  assert.equal(decimal(row(result, 'Carbon').expectedClosing), '25');
});

test('checkpoint reload preserves replay idempotency and deterministic output', () => {
  const first = buildCompleteBreakEvenAccounting(fixture);
  const second = buildCompleteBreakEvenAccounting({ ...fixture, checkpoint: first.checkpoint });
  assert.deepEqual(second.rows, first.rows);
  assert.deepEqual(second.checkpoint, first.checkpoint);
  assert.equal(second.eventCounts.replayed, fixture.events.length - 1);
});
