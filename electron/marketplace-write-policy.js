'use strict';

const LEGACY_MARKETPLACE_MEASUREMENTS = Object.freeze(new Set([
  'asset_flow',
  'marketplace',
  'marketplace_faction_v2',
  'marketplace_reconciliation_test_v1',
  'marketplace_v2',
]));

function lineMeasurement(line) {
  return String(line || '').trimStart().split(/[ ,]/, 1)[0];
}

function filterLegacyMarketplaceInfluxLines(lines) {
  return String(lines || '').split('\n')
    .filter((line) => line && !LEGACY_MARKETPLACE_MEASUREMENTS.has(lineMeasurement(line)))
    .join('\n');
}

module.exports = { LEGACY_MARKETPLACE_MEASUREMENTS, filterLegacyMarketplaceInfluxLines };
