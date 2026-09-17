'use strict';

function canonicalAssetName(value) {
  const asset = String(value ?? '').trim();
  if (asset === 'Ammo') return 'Ammunition';
  if (asset === 'Toolkits') return 'Toolkit';
  return asset;
}

module.exports = { canonicalAssetName };
