'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTelemetryRecorder, runFeature, runWithTelemetryContext, runLogicalOperation, getTelemetryContext, normalizeContext } = require('../electron/telemetry-context');

function collector() { const events = []; return { events, record: (event) => events.push(event), flush() {} }; }

test('concurrent Marketplace LM and GM contexts remain isolated', async () => {
  const ledger = collector(); setTelemetryRecorder(ledger); let release; const gate = new Promise((resolve) => { release = resolve; });
  const lm = runFeature({ profile: 'USTUR', faction: 'MUD', feature: 'Marketplace LM', trigger: 'background' }, async () => { await gate; return runLogicalOperation({ rpcMethod: 'getAccountInfo' }, async () => getTelemetryContext()); });
  const gm = runFeature({ profile: 'USTUR', faction: 'ONI', feature: 'Marketplace GM', trigger: 'manual' }, () => runLogicalOperation({ rpcMethod: 'getSignaturesForAddress' }, async () => getTelemetryContext()));
  release(); const [lmContext, gmContext] = await Promise.all([lm, gm]);
  assert.equal(lmContext.feature, 'Marketplace LM'); assert.equal(lmContext.faction, 'MUD'); assert.equal(lmContext.trigger, 'background');
  assert.equal(gmContext.feature, 'Marketplace GM'); assert.equal(gmContext.faction, 'ONI'); assert.equal(gmContext.trigger, 'manual');
  setTelemetryRecorder(null);
});

test('Earnings remains primary while Fleet and Rental are bounded suboperations', async () => {
  const seen = await runFeature({ profile: 'USTUR', faction: 'USTUR', feature: 'Earnings', trigger: 'navigation' }, () =>
    runWithTelemetryContext({ suboperation: 'fleet-discovery' }, () => runLogicalOperation({ rpcMethod: 'getProgramAccountsV2' }, () => getTelemetryContext())));
  assert.equal(seen.feature, 'Earnings'); assert.equal(seen.suboperation, 'fleet-discovery');
  const rental = await runFeature({ feature: 'Earnings' }, () => runWithTelemetryContext({ suboperation: 'rental-data' }, () => getTelemetryContext()));
  assert.equal(rental.feature, 'Earnings'); assert.equal(rental.suboperation, 'rental-data');
});

test('menu tab attribution survives nested implementation suboperations', async () => {
  const seen = await runFeature({ feature: 'EA', suboperation: 'scanning' }, () =>
    runWithTelemetryContext({ suboperation: 'fleet-discovery' }, () => getTelemetryContext()));
  assert.equal(seen.feature, 'EA');
  assert.equal(seen.suboperation, 'scanning');
});

test('Mining counts feature itself performs zero Solana work', async () => {
  const ledger = collector(); setTelemetryRecorder(ledger);
  await runFeature({ feature: 'Mining counts', trigger: 'background' }, async () => 'influx-only');
  assert.equal(ledger.events.some((event) => event.type === 'logical-start' || event.type === 'wire-start'), false);
  setTelemetryRecorder(null);
});

test('strict trigger and provider allowlists default malformed or missing values to unknown', () => {
  assert.equal(normalizeContext({ trigger: 'manual', providerRole: 'fallback' }).trigger, 'manual');
  assert.equal(normalizeContext({ trigger: 'not-valid', providerRole: 'https://secret.invalid' }).trigger, 'unknown');
  assert.equal(normalizeContext({}).providerRole, 'unknown');
});

test('current production anchors preserve raw pagination, unsupported V2 transition, Fleet cache and Earnings primary feature', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  assert.match(source, /runLogicalOperation\(\{ rpcMethod: 'getProgramAccountsV2' \}/);
  assert.match(source, /recordTelemetryCounter\('paginationPages'\)/);
  assert.match(source, /return connection\.getProgramAccounts\(programId, config\)/);
  assert.match(source, /recordTelemetryCounter\('cacheHits'.*suboperation: 'fleet-discovery'/);
  assert.match(source, /recordTelemetryCounter\('cacheMisses'.*suboperation: 'fleet-discovery'/);
  assert.match(source, /recordTelemetryCounter\('inFlightCoalesced'.*suboperation: 'fleet-discovery'/);
  assert.match(source, /runTelemetryFeature\(payload, 'Earnings'/);
  assert.match(source, /suboperation: 'rental-data'/);
});

test('renderer attaches truthful bounded trigger metadata without adding an IPC channel', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/renderer.js'), 'utf8');
  assert.match(source, /TELEMETRY_TRIGGERS = new Set\(\['startup', 'background', 'navigation', 'manual', 'settings', 'unknown'\]\)/);
  assert.match(source, /setNextRendererTelemetryTrigger\('startup'\);\s*void loadVisibleThenPrefetch\(refreshVisibleFactionViews\)\.then\(runMarketplaceBackgroundSync\)/);
  assert.match(source, /setInterval\(runMarketplaceBackgroundSync, MARKETPLACE_SYNC_INTERVAL_MS\)/);
  assert.match(source, /setNextRendererTelemetryTrigger\('navigation'\); setActiveEarningsSubtab/);
  assert.match(source, /setNextRendererTelemetryTrigger\('manual'\);\s*await refreshCurrentVisibleData\(\)/);
  assert.match(source, /setNextRendererTelemetryTrigger\('settings'\);\s*await refreshVisibleIdentity\(\{ force \}\)/);
  assert.match(source, /setNextRendererTelemetryTrigger\('settings'\);\s*void refreshConsMining\(\{ settings: nextSettings \}\)/);
  assert.doesNotMatch(source, /telemetry.*(?:rpcUrl|apiKey|authToken|playerProfile)/i);
});
