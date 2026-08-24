'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { exactText, marketplaceEvents, authoritativeSlyaAccountingEvents, buildProductionCompleteAccounting } = require('../electron/complete-accounting-production-adapter');

const decimal = (value) => value?.decimal;
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const hash = (value) => require('node:crypto').createHash('sha256').update(stable(value)).digest('hex');
function slyaRow({ evidenceType, eventId, signature, outerInstructionIndex, slot = 178583, blockTime = 1785830000, faction = 'UST', profile = 'p', fleetAccount = 'fleet', fleetLabel = 'Fleet', inputs, outputs, directFees, transactionCosts, lineage = { starbase: 'S1' }, sourceProvenance = 'confirmed_transaction' }) {
  const payload = { schemaVersion: 1, evidenceType, eventId, signature, outerInstructionIndex, programId: 'SAGE_PROGRAM', operationId: '', slot, blockTime, faction, profile, fleetAccount, fleetLabel, inputs, outputs, directFees, transactionCosts, lineage, sourceProvenance };
  return { _time: new Date(blockTime * 1000).toISOString(), ...payload, payloadHash: hash(payload), programId: 'SAGE_PROGRAM' };
}

test('production adapter preserves exact decimals and authoritative marketplace identities', () => {
  assert.equal(exactText({ atoms: '1234500', decimals: 4, unit: 'asset:x' }), '123.45');
  assert.equal(exactText(1e-7), '0.0000001');
  const events = marketplaceEvents([{ id: 'trade-1', timestamp: '2026-01-02T00:00:00Z', marketplace: 'GM', side: 'sell', asset: 'Ore', starbase: 'S1', quantity: '2.5', grossAtlas: '10.00', netAtlas: '9.75', wallet: 'w' }]);
  assert.deepEqual(events, [{
    eventId: 'market:gm:trade-1', timestamp: '2026-01-02T00:00:00.000Z', type: 'sale', source: 'gm', location: 'S1', asset: 'Ore', quantity: '2.5', grossProceeds: '10.00', fees: '0.25', marketplaceFee: '0.25', transactionFee: '0', tradeId: 'trade-1', originWallet: 'w', lineageStatus: 'allocated',
  }]);
  const unallocated = marketplaceEvents([{ id: 'trade-2', timestamp: '2026-01-02T00:00:00Z', marketplace: 'GM', side: 'buy', asset: 'Ore', wallet: 'w', quantity: '4', settledAtlas: '3' }], { faction: 'USTUR', profile: 'p' });
  assert.equal(unallocated[0].type, 'unallocated');
  assert.equal(unallocated[0].lineageStatus, 'wallet-unallocated');
});

test('production shape produces visible equation, COGS, coverage, quarantine and reconciliation', () => {
  const result = buildProductionCompleteAccounting({
    scope: { faction: 'USTUR', profile: 'profile-1' },
    period: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z', days: 30 },
    ledgerEvents: [
      { type: 'acquire', timestamp: '2026-01-01T00:00:00Z', location: 'S1', asset: 'Ore', quantity: '10', totalCost: null },
      { type: 'acquire', timestamp: '2026-01-02T00:00:00Z', location: 'S1', asset: 'Ore', quantity: '10', source: 'mining', totalCost: '5' },
    ],
    marketplaceTrades: [
      { id: 'buy-1', timestamp: '2026-01-03T00:00:00Z', marketplace: 'LM', side: 'buy', asset: 'Ore', starbase: 'S1', quantity: '5', totalCostAtlas: '4' },
      { id: 'sell-1', timestamp: '2026-01-04T00:00:00Z', marketplace: 'LM', side: 'sell', asset: 'Ore', starbase: 'S1', quantity: '10', grossAtlas: '12', netAtlas: '11.5' },
      { id: 'ambiguous-1', timestamp: '2026-01-05T00:00:00Z', marketplace: 'GM', side: 'buy', asset: 'Ore', wallet: 'w', quantity: '2', totalCostAtlas: '1', lineageStatus: 'ambiguous' },
    ],
    actualClosing: [{ asset: 'Ore', curAmount: '15' }],
  });
  const row = result.rows[0];
  assert.equal(decimal(row.openingQuantity), '10');
  assert.equal(decimal(row.acquisitions.mining), '10');
  assert.equal(decimal(row.acquisitions.lm), '5');
  assert.equal(decimal(row.salesQuantity), '10');
  assert.equal(decimal(row.salesNetProceeds), '11.5');
  assert.equal(row.salesCoverage.status, 'uncosted');
  assert.equal(row.cogs, null);
  assert.equal(row.realizedProfit, null);
  assert.equal(decimal(row.remainingQuantity), '15');
  assert.equal(decimal(row.actualClosing), '15');
  assert.equal(row.reconciliationStatus, 'reconciled');
  assert.equal(decimal(row.quarantinedQuantity), '2');
  assert.equal(result.eventCounts.quarantined, 1);
  assert.equal(result.inputEventCount, 5);
});

test('unavailable production sources remain explicit instead of rendering authoritative zero', () => {
  const result = buildProductionCompleteAccounting({
    scope: { faction: 'ONI', profile: 'p' },
    period: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' },
    ledgerEvents: [{ type: 'acquire', timestamp: '2026-01-01T00:00:00Z', location: 'S1', asset: 'Ore', quantity: '1', totalCost: null }],
    actualClosing: [{ asset: 'Ore', quantity: '1' }],
    sourceAvailability: { marketplace: 'unavailable', cargo: 'unavailable', mining: 'unavailable' },
  });
  assert.deepEqual(result.unavailableSources.sort(), ['cargo', 'marketplace', 'mining', 'upgrading']);
  assert.equal(result.rows[0].acquisitions.lm, null);
  assert.equal(result.rows[0].acquisitions.gm, null);
  assert.equal(result.rows[0].acquisitions.mining, null);
  assert.equal(result.rows[0].costsBySource.cargo, null);
});

test('SLYA confirmed evidence is consumed exactly and incomplete lineage is quarantined', () => {
  const rows = authoritativeSlyaAccountingEvents([
    slyaRow({ evidenceType: 'mining', eventId: 'slya-accounting:v1:mining:sig:0', signature: 'sig', outerInstructionIndex: 0, inputs: [], outputs: [{ asset: 'Ore', quantity: '2', location: 'S1' }], directFees: '0', transactionCosts: { solLamports: '5' } }),
    slyaRow({ evidenceType: 'crafting', eventId: 'slya-accounting:v1:crafting:sig:1', signature: 'sig', outerInstructionIndex: 1, inputs: [{ asset: 'Ore', quantity: '1' }], outputs: [{ asset: 'Plate', quantity: '1', location: 'S1' }], directFees: '1', transactionCosts: { solLamports: '5' }, lineage: {} }),
  ], { faction: 'USTUR', profile: 'p' });
  assert.equal(rows[0].type, 'acquisition');
  assert.equal(rows[0].basis, null);
  assert.equal(rows[1].type, 'quarantined');
  assert.equal(rows[1].reason, 'slya-transaction-cost-atlas-unavailable');
  const result = buildProductionCompleteAccounting({
    scope: { faction: 'USTUR', profile: 'p' }, period: { start: '2026-08-01T00:00:00Z', end: '2026-09-01T00:00:00Z' },
    authoritativeSlyaEvidence: [slyaRow({ evidenceType: 'mining', eventId: 'slya-accounting:v1:mining:sig:0', signature: 'sig', outerInstructionIndex: 0, inputs: [], outputs: [{ asset: 'Ore', quantity: '2', location: 'S1' }], directFees: '0', transactionCosts: { solLamports: '5' } })],
    actualClosing: [{ asset: 'Ore', quantity: '2' }], sourceAvailability: { upgrading: 'unavailable' },
  });
  assert.equal(result.rows[0].acquisitions.mining.decimal, '2');
  assert.equal(result.rows[0].costCoverage.status, 'uncosted');
  assert.equal(result.unavailableSources.includes('upgrading'), true);
});

test('SLYA payload hash, block time, and scope are independently verified before accounting', () => {
  const valid = slyaRow({ evidenceType: 'mining', eventId: 'slya-accounting:v1:mining:verify:0', signature: 'verify', outerInstructionIndex: 0, inputs: [], outputs: [{ asset: 'Ore', quantity: '2', location: 'S1' }], directFees: '0', transactionCosts: { solLamports: '5' } });
  assert.equal(authoritativeSlyaAccountingEvents([{ ...valid, payloadHash: 'a'.repeat(64) }], { faction: 'USTUR', profile: 'p' })[0].reason, 'slya-payload-hash-mismatch');
  assert.equal(authoritativeSlyaAccountingEvents([{ ...valid, faction: 'ONI' }], { faction: 'USTUR', profile: 'p' })[0].reason, 'slya-scope-mismatch');
  assert.equal(authoritativeSlyaAccountingEvents([{ ...valid, _time: '2026-08-04T07:53:21.000Z' }], { faction: 'USTUR', profile: 'p' })[0].reason, 'slya-block-time-mismatch');
});
