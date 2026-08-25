'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  authoritativeMarketplaceProfile,
  marketplacePublicationScopeStatus,
  marketplacePublicationCandidateScopeStatus,
  marketplacePublicationHoldScopeStatus,
  partitionMarketplaceRetryHolds,
} = require('../electron/marketplace-publication-scope');

const settings = {
  faction: 'USTUR', playerProfile: 'ust-profile',
  playerProfiles: { MUD: 'mud-profile', ONI: 'oni-profile', USTUR: 'ust-profile' },
};

test('authoritative profile source is faction keyed and never the application profile alias', () => {
  assert.equal(authoritativeMarketplaceProfile(settings, 'MUD'), 'mud-profile');
  assert.equal(authoritativeMarketplaceProfile(settings, 'USTUR'), 'ust-profile');
  assert.equal(marketplacePublicationScopeStatus(settings, { market: 'LM', faction: 'MUD', profileScope: 'USTUR' }).reason, 'profile_scope_conflict');
  assert.equal(marketplacePublicationScopeStatus(settings, { market: 'LM', faction: 'MUD', profileScope: 'mud-profile' }).authoritative, true);
});

test('GM publication identity is global while LM requires exact authoritative faction profile', () => {
  assert.equal(marketplacePublicationScopeStatus(settings, { market: 'GM', faction: 'GLOBAL', profileScope: 'GLOBAL' }).authoritative, true);
  assert.equal(marketplacePublicationScopeStatus(settings, { market: 'GM', faction: 'MUD', profileScope: 'mud-profile' }).authoritative, false);
  assert.equal(marketplacePublicationScopeStatus(settings, { market: 'LM', faction: 'ONI', profileScope: 'ust-profile' }).authoritative, false);
});

test('candidate and held recovery inputs fail closed on conflicting persisted scope without mutation', () => {
  const candidate = { record: { identity: { market: 'LM', faction: 'MUD', profileScope: 'USTUR' } } };
  const hold = { market: 'LM', candidateSnapshot: { faction: 'MUD', profileScope: 'USTUR' } };
  const before = JSON.stringify(hold);
  assert.equal(marketplacePublicationCandidateScopeStatus(settings, candidate).reason, 'profile_scope_conflict');
  assert.equal(marketplacePublicationHoldScopeStatus(settings, hold).reason, 'profile_scope_conflict');
  assert.equal(JSON.stringify(hold), before);
});

test('retry partition excludes scope conflicts without editing or releasing audit evidence', () => {
  const valid = { logicalKeyOrSourceId: 'valid', state: 'held', market: 'LM', inputCursors: { wallet: 'safe' }, failureCode: 'posting_unknown', candidateSnapshot: { faction: 'MUD', profileScope: 'mud-profile', publicationInputs: [{ currentId: 'id-valid' }] } };
  const conflict = { logicalKeyOrSourceId: 'conflict', state: 'held', market: 'LM', inputCursors: { wallet: 'stuck-aug-2' }, failureCode: 'profile_scope_conflict', candidateSnapshot: { faction: 'MUD', profileScope: 'USTUR', publicationInputs: [{ currentId: 'id-conflict' }] } };
  const holds = [valid, conflict];
  const before = JSON.stringify(holds);
  const partitioned = partitionMarketplaceRetryHolds(settings, holds);
  assert.deepEqual(partitioned.retryable, [valid]);
  assert.deepEqual(partitioned.conflicts, [conflict]);
  assert.equal(JSON.stringify(holds), before);
  assert.equal(conflict.state, 'held');
  assert.deepEqual(conflict.inputCursors, { wallet: 'stuck-aug-2' });
  assert.equal(conflict.failureCode, 'profile_scope_conflict');
});

test('production recovery loop has and executes held-scope validation wiring', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const importBlock = source.match(/const \{[\s\S]*?\} = require\('\.\/marketplace-publication-scope'\);/)[0];
  const importedNames = new Set(importBlock.match(/marketplacePublication[A-Za-z]+|partitionMarketplaceRetryHolds/g));
  const start = source.indexOf('async function recoverMarketplacePublication(settings) {');
  assert.ok(start >= 0);
  let depth = 0;
  let end = -1;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) { end = index + 1; break; }
  }
  assert.ok(end > start);

  const conflict = { state: 'held', market: 'LM', candidateSnapshot: { faction: 'MUD', profileScope: 'USTUR' } };
  const loadedHolds = { status: 'loaded', document: { holds: { conflict } } };
  const context = {
    resolveMarketplacePublicationOrganization: async () => null,
    marketplacePublicationSettings: () => ({ baseUrl: '', bucket: '', storageRoot: '/tmp', installationId: 'installation', applicationProfile: 'USTUR' }),
    createMarketplacePublicationCoordinator: () => ({ publishMarketplaceCandidates: async () => ({}) }),
    loadMarketplacePublicationHolds: async () => loadedHolds,
    loadMarketplaceOutboxV2: async () => ({ status: 'loaded', document: { events: {} } }),
    getAppRoot: () => '/tmp',
    partitionMarketplaceRetryHolds,
    ...(importedNames.has('marketplacePublicationHoldScopeStatus') ? { marketplacePublicationHoldScopeStatus } : {}),
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}; this.recoverMarketplacePublication = recoverMarketplacePublication;`, context);
  const result = await context.recoverMarketplacePublication(settings);
  assert.deepEqual({ ...result }, { status: 'recovery_complete', recovered: 0, scopeConflictCount: 1 });
});
