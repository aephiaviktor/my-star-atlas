'use strict';

function text(value) { return String(value ?? '').trim(); }
function faction(value) {
  const normalized = text(value).toUpperCase();
  return normalized === 'MUD' || normalized === 'ONI' || normalized === 'USTUR' ? normalized : '';
}

function authoritativeMarketplaceProfile(settings, value) {
  const normalizedFaction = faction(value);
  if (!normalizedFaction) return '';
  const profiles = settings?.playerProfiles && typeof settings.playerProfiles === 'object' ? settings.playerProfiles : {};
  const configured = text(profiles[normalizedFaction]);
  if (configured) return configured;
  return faction(settings?.faction) === normalizedFaction ? text(settings?.playerProfile) : '';
}

function marketplacePublicationScopeStatus(settings, { market, faction: value, profileScope } = {}) {
  const normalizedMarket = text(market).toUpperCase();
  const normalizedFaction = faction(value);
  const normalizedProfile = text(profileScope);
  if (normalizedMarket === 'GM') {
    return normalizedFaction === '' && text(value).toUpperCase() === 'GLOBAL' && normalizedProfile === 'GLOBAL'
      ? { authoritative: true, market: 'GM', faction: 'GLOBAL', profileScope: 'GLOBAL', reason: '' }
      : { authoritative: false, market: 'GM', faction: text(value).toUpperCase(), profileScope: normalizedProfile, reason: 'gm_scope_must_be_global' };
  }
  if (normalizedMarket !== 'LM' || !normalizedFaction) {
    return { authoritative: false, market: normalizedMarket, faction: normalizedFaction, profileScope: normalizedProfile, reason: 'invalid_marketplace_scope' };
  }
  const expectedProfile = authoritativeMarketplaceProfile(settings, normalizedFaction);
  if (!expectedProfile) {
    return { authoritative: false, market: 'LM', faction: normalizedFaction, profileScope: normalizedProfile, reason: 'authoritative_profile_unavailable' };
  }
  if (normalizedProfile !== expectedProfile) {
    return { authoritative: false, market: 'LM', faction: normalizedFaction, profileScope: normalizedProfile, expectedProfile, reason: 'profile_scope_conflict' };
  }
  return { authoritative: true, market: 'LM', faction: normalizedFaction, profileScope: normalizedProfile, expectedProfile, reason: '' };
}

function marketplacePublicationCandidateScopeStatus(settings, candidate = {}) {
  const identity = candidate?.record?.identity || {};
  return marketplacePublicationScopeStatus(settings, {
    market: identity.market,
    faction: identity.faction,
    profileScope: identity.profileScope,
  });
}

function marketplacePublicationHoldScopeStatus(settings, hold = {}) {
  const snapshot = hold?.candidateSnapshot || {};
  const market = text(hold.market || snapshot.marketplace).toUpperCase();
  return marketplacePublicationScopeStatus(settings, {
    market,
    faction: snapshot.faction || (market === 'GM' ? 'GLOBAL' : ''),
    profileScope: snapshot.profileScope || (market === 'GM' ? 'GLOBAL' : ''),
  });
}

function partitionMarketplaceRetryHolds(settings, holds = []) {
  const retryable = [];
  const conflicts = [];
  for (const hold of holds) {
    const status = marketplacePublicationHoldScopeStatus(settings, hold);
    (status.authoritative ? retryable : conflicts).push(hold);
  }
  return { retryable, conflicts };
}

module.exports = {
  authoritativeMarketplaceProfile,
  marketplacePublicationScopeStatus,
  marketplacePublicationCandidateScopeStatus,
  marketplacePublicationHoldScopeStatus,
  partitionMarketplaceRetryHolds,
};
