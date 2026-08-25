'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
