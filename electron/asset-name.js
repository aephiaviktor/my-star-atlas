'use strict';

function canonicalAssetName(value) {
  const asset = String(value ?? '').trim();
  return asset === 'Ammo' ? 'Ammunition' : asset;
}

module.exports = { canonicalAssetName };
