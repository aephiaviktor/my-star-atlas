'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildMarketplaceActivityV2, buildMarketplaceLedgerEvents, projectMarketplaceEvidenceV2 } = require('../electron/marketplace-activity-v2');
const { buildCompleteBreakEvenAccounting } = require('../electron/complete-break-even-accounting');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'marketplace-activity-v2.json'), 'utf8'));
const decimal = (value) => value?.decimal;

test('Marketplace V2 classifies attributed LM/GM, ambiguous history, whole transfers, and split transfers', () => {
  const result = buildMarketplaceActivityV2(fixture);
  assert.deepEqual(result.activities.map((row) => row.transactionType), [
    'purchase', 'purchase', 'inbound_transfer', 'inbound_transfer', 'inbound_transfer', 'sale',
  ]);
  assert.equal(result.attributed.length, 6);
  assert.equal(result.pendingAllocation.length, 0);
  assert.equal(result.quarantined.length, 0);
  assert.equal(result.globalUnallocated.length, 1);
  assert.deepEqual(result.reconciliation, {
    activityCount: 6,
    attributedCount: 6,
    pendingAllocationCount: 0,
    quarantinedCount: 0,
    globalUnallocatedCount: 1,
    attributedPurchaseQuantity: '15',
    attributedSaleQuantity: '5',
    attributedTransferQuantity: '10',
    pendingQuantity: '0',
  });
  const ambiguous = result.globalUnallocated[0];
  assert.equal(ambiguous.market, 'GM');
  assert.equal(ambiguous.reconciliationState, 'unallocated');
  assert.equal(ambiguous.profile, 'GLOBAL');
});

test('only proven activity mutates the exact ledger; transfers preserve basis and sale reports exact COGS/profit', () => {
  const activity = buildMarketplaceActivityV2(fixture);
  const events = buildMarketplaceLedgerEvents(activity, fixture.scope);
  assert.deepEqual(events.map((event) => event.type), [
    'acquisition', 'acquisition', 'transfer', 'transfer', 'transfer', 'sale',
  ]);
  const accounting = buildCompleteBreakEvenAccounting({
    scope: fixture.scope,
    period: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.999Z', days: 31 },
    events,
    actualClosing: [{ asset: 'Carbon', quantity: '10' }],
  });
  const row = accounting.rows[0];
  assert.equal(decimal(row.acquisitions.lm), '5');
  assert.equal(decimal(row.acquisitions.gm), '10');
  assert.equal(decimal(row.transferIn), '10');
  assert.equal(decimal(row.transferOut), '10');
  assert.equal(decimal(row.salesQuantity), '5');
  assert.equal(decimal(row.cogs), '10');
  assert.equal(decimal(row.salesNetProceeds), '11');
  assert.equal(decimal(row.realizedProfit), '1');
  assert.equal(decimal(row.remainingQuantity), '10');
  assert.equal(decimal(row.remainingCostBasis), '20');
  assert.equal(decimal(row.unallocatedQuantity), '0');
  assert.equal(row.reconciliationStatus, 'reconciled');
});

test('duplicate replay collapses deterministically and restart checkpoint replay cannot double count', () => {
  const activity = buildMarketplaceActivityV2({ ...fixture, trades: [...fixture.trades, fixture.trades[0]] });
  const events = buildMarketplaceLedgerEvents(activity, fixture.scope);
  assert.equal(activity.reconciliation.activityCount, 6);
  const input = {
    scope: fixture.scope,
    period: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.999Z' },
    events,
    actualClosing: [{ asset: 'Carbon', quantity: '10' }],
  };
  const first = buildCompleteBreakEvenAccounting(input);
  const restarted = buildCompleteBreakEvenAccounting({ ...input, checkpoint: first.checkpoint });
  assert.deepEqual(restarted.rows, first.rows);
  assert.deepEqual(restarted.eventCounts, first.eventCounts);
});

test('production projection preserves exact quantities beyond Number range', () => {
  const exactQuantity = '123456789012345678901234567890.000000000000000001';
  const result = projectMarketplaceEvidenceV2({
    scope: fixture.scope,
    trades: [{
      schemaGeneration: 'v2', representationRank: 'enriched', tradeId: 'large-exact',
      timestamp: '2026-08-02T01:00:00.000Z', market: 'LM', side: 'buy', asset: 'Carbon', rawMint: 'carbon-mint',
      quantity: exactQuantity, grossAtlas: '1', marketplaceFeeAtlas: '0', txFeeAtlas: '0', netAtlas: '1',
      wallet: 'handler', starbase: 'UST-1', faction: 'USTUR', profile: 'profile-ustur',
    }],
  });
  assert.equal(result.attributed[0].exactQuantity, exactQuantity);
});

test('conflicting immutable identity fails closed as quarantined and cannot mutate authoritative inventory', () => {
  const conflict = { ...fixture.trades[0], exactQuantity: '6' };
  const result = buildMarketplaceActivityV2({ scope: fixture.scope, trades: [fixture.trades[0], conflict], transfers: [] });
  assert.equal(result.attributed.length, 0);
  assert.equal(result.quarantined.length, 2);
  assert.ok(result.quarantined.every((row) => row.reconciliationState === 'quarantined' && row.reason === 'immutable-event-conflict'));
  const events = buildMarketplaceLedgerEvents(result, fixture.scope);
  const accounting = buildCompleteBreakEvenAccounting({
    scope: fixture.scope,
    period: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.999Z' },
    events,
    actualClosing: [],
  });
  assert.equal(decimal(accounting.rows[0].remainingQuantity), '0');
  assert.equal(decimal(accounting.rows[0].quarantinedQuantity), '11');
  assert.equal(accounting.eventCounts.quarantined, 2);
});

test('MUD ONI and USTUR counts are computed after scope and one global GM row is outside every faction ledger', () => {
  const scopes = [
    ['MUD', 'mud-profile', 'mud-wallet'],
    ['ONI', 'oni-profile', 'oni-wallet'],
    ['USTUR', 'ust-profile', 'ust-wallet'],
  ];
  const trades = scopes.map(([faction, profile, wallet], index) => ({
    schemaGeneration: 'v2', representationRank: 'enriched', tradeId: `lm-${faction}`,
    timestamp: `2026-08-2${index}T01:00:00.000Z`, market: 'LM', side: 'buy', asset: 'Carbon', rawMint: 'carbon-mint',
    quantity: String(index + 1), grossAtlas: String((index + 1) * 2), marketplaceFeeAtlas: '0', txFeeAtlas: '0', netAtlas: String((index + 1) * 2),
    wallet, starbase: `${faction}-1`, faction, profile,
  }));
  trades.push({
    schemaGeneration: 'v2', representationRank: 'enriched', tradeId: 'gm-global', timestamp: '2026-08-24T01:00:00.000Z',
    market: 'GM', side: 'buy', asset: 'Carbon', rawMint: 'carbon-mint', quantity: '4', grossAtlas: '8',
    marketplaceFeeAtlas: '0', txFeeAtlas: '0', netAtlas: '8', wallet: 'ambiguous-wallet',
  });
  for (const [faction, profile, wallet] of scopes) {
    const result = projectMarketplaceEvidenceV2({ trades, scope: { faction, profile } });
    assert.deepEqual(result.attributed.map((row) => row.wallet), [wallet]);
    assert.equal(result.pendingAllocation.length, 0);
    assert.equal(result.globalUnallocated.length, 1);
    assert.equal(result.reconciliation.globalUnallocatedCount, 1);
    assert.equal(buildMarketplaceLedgerEvents(result, { faction, profile }).length, 1);
  }
});

test('transfer lineage survives projection and only exact matching scope becomes authoritative', () => {
  const transfer = {
    schemaVersion: 2, id: 'flow-1', timestamp: '2026-08-24T02:00:00.000Z', asset: 'Carbon', rawMint: 'carbon-mint',
    exactQuantity: '3.000000000000000001', txFeeAtlas: '0', wallet: 'mud-wallet', origin: 'wallet:mud-wallet', destination: 'MUD-1',
    faction: 'MUD', profile: 'mud-profile', lineageStatus: 'proven', provenance: 'sage_css_transfer', signature: 'sig',
  };
  const mud = projectMarketplaceEvidenceV2({ transfers: [transfer], scope: { faction: 'MUD', profile: 'mud-profile' } });
  const oni = projectMarketplaceEvidenceV2({ transfers: [transfer], scope: { faction: 'ONI', profile: 'oni-profile' } });
  assert.equal(mud.attributed[0].exactQuantity, '3.000000000000000001');
  assert.equal(buildMarketplaceLedgerEvents(mud, { faction: 'MUD', profile: 'mud-profile' })[0].type, 'transfer');
  assert.equal(oni.activities.length, 0);
  assert.equal(oni.globalUnallocated.length, 0);
});

test('legacy LM compatibility rows stay visible only as faction-scoped quarantine', () => {
  const legacy = {
    schemaGeneration: 'v1', representationRank: 'fallback', id: 'legacy', timestamp: '2026-08-01T01:00:00.000Z',
    marketplace: 'LM', faction: 'MUD', profile: 'USTUR', side: 'buy', asset: 'Carbon', rawMint: 'carbon-mint',
    quantity: '2', grossAtlas: '4', marketplaceFeeAtlas: '0', txFeeAtlas: '0', netAtlas: '4', wallet: 'mud-wallet', starbase: 'MUD-1',
  };
  const mud = projectMarketplaceEvidenceV2({ trades: [legacy], scope: { faction: 'MUD', profile: 'mud-profile' } });
  const oni = projectMarketplaceEvidenceV2({ trades: [legacy], scope: { faction: 'ONI', profile: 'oni-profile' } });
  assert.equal(mud.quarantined.length, 1);
  assert.equal(mud.quarantined[0].profile, 'mud-profile');
  assert.equal(mud.quarantined[0].provenance, 'legacy_compatibility_read');
  assert.equal(oni.activities.length, 0);
});
