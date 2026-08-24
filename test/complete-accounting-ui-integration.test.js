'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Break-even UI exposes complete accounting period, asset, source, equation, coverage and evidence states', () => {
  const html = read('electron/renderer.html');
  const js = read('electron/renderer.js');
  for (const id of ['earnings-breakeven-period-filter', 'earnings-breakeven-asset-filter', 'earnings-breakeven-source-filter']) assert.match(html, new RegExp(`id="${id}"`));
  for (const label of ['Opening Qty', 'Opening Basis', 'LM In', 'GM In', 'Scanning In', 'Mining / Rental In', 'Crafting Out', 'Upgrading Out', 'Cargo / Transfer In', 'Sales Qty', 'Net Proceeds', 'COGS', 'Realized Profit', 'Expected Closing', 'Remaining Basis', 'Actual Closing', 'Difference', 'Pending', 'Unallocated', 'Uncosted', 'Rejected', 'Quarantined']) assert.match(html, new RegExp(label.replace(/[ /]/g, '[ /]')));
  assert.match(js, /const accounting = result\?\.completeAccounting/);
  assert.match(js, /missing evidence is never treated as zero/);
  assert.match(js, /detail\.eventId/);
  assert.match(js, /settings\.breakevenPeriodDays/);
});

test('main integrates durable exact accounting only into existing Breakeven request path without cadence', () => {
  const main = read('electron/main.js');
  assert.match(main, /const needsCompleteAccounting = snapshotScope === 'breakeven'/);
  assert.match(main, /fetchMarketplaceTradesFromInflux\(settings\)/);
  assert.match(main, /slya_accounting_evidence_v1/);
  assert.match(main, /programId.*operationId/);
  assert.match(main, /loadCompleteAccountingCheckpoint/);
  assert.match(main, /mergeCompleteAccountingEvents/);
  assert.match(main, /saveCompleteAccountingCheckpoint/);
  assert.match(main, /verifiedOpeningCheckpoint/);
  assert.match(main, /verified_opening_checkpoint_required/);
  assert.match(main, /buildProductionCompleteAccounting/);
  const integration = main.slice(main.indexOf("const needsCompleteAccounting = snapshotScope === 'breakeven'"), main.indexOf('// Crafting per-row enrichment'));
  assert.doesNotMatch(integration, /setInterval|setTimeout|scanLocalMarketTrades|syncMarketplace/);
});
