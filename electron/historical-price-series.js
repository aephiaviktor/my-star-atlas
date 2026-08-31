'use strict';

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function exactNumber(value) {
  const number = positiveNumber(value);
  return number == null ? '' : String(number);
}

function parseAephiaPriceSeries(payload = {}) {
  const columns = Array.isArray(payload.columns) ? payload.columns.map(String) : [];
  const indexes = Object.fromEntries(columns.map((column, index) => [column, index]));
  const points = (Array.isArray(payload.rows) ? payload.rows : []).flatMap((row) => {
    const timestamp = Number(row?.[indexes.ts]);
    const price = positiveNumber(row?.[indexes.price]);
    if (!Number.isFinite(timestamp) || price == null) return [];
    return [{
      timestamp,
      price,
      bestBid: indexes.bestBid == null ? null : positiveNumber(row?.[indexes.bestBid]),
      bestAsk: indexes.bestAsk == null ? null : positiveNumber(row?.[indexes.bestAsk]),
    }];
  }).sort((left, right) => left.timestamp - right.timestamp);
  return {
    kind: String(payload.kind || ''),
    token: String(payload.token || '').toLowerCase(),
    currency: String(payload.currency || '').toUpperCase(),
    mint: String(payload.mint || ''),
    points,
  };
}

function valuationTimestampMs(value) {
  const text = String(value || '').trim();
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function selectAssetSeriesCurrency(resource = {}) {
  if (!String(resource.mint || '').trim()) return '';
  return resource.usdcMarketId && !resource.atlasMarketId ? 'USDC' : 'ATLAS';
}

function latestPointAtOrBefore(series, timestampMs) {
  if (!Number.isFinite(Number(timestampMs))) return null;
  let selected = null;
  for (const point of series?.points || []) {
    if (point.timestamp > Number(timestampMs)) break;
    selected = point;
  }
  return selected;
}

function resolveSolAtlasPriceAtOrBefore(solUsdSeries, atlasUsdSeries, timestampMs) {
  const sol = latestPointAtOrBefore(solUsdSeries, timestampMs);
  const atlas = latestPointAtOrBefore(atlasUsdSeries, timestampMs);
  if (!sol || !atlas || !(atlas.price > 0)) return null;
  const priceATL = sol.price / atlas.price;
  return {
    status: 'complete', priceATL, priceATLExact: exactNumber(priceATL),
    effectiveTimestamp: new Date(Number(timestampMs)).toISOString(),
    effectiveUtcDate: new Date(Number(timestampMs)).toISOString().slice(0, 10),
    observedAt: new Date(Math.max(sol.timestamp, atlas.timestamp)).toISOString(),
    priceDay: new Date(Math.max(sol.timestamp, atlas.timestamp)).toISOString().slice(0, 10),
    solUsdObservedAt: new Date(sol.timestamp).toISOString(),
    atlasUsdObservedAt: new Date(atlas.timestamp).toISOString(),
    solUsdPrice: sol.price, atlasUsdPrice: atlas.price,
    source: 'Aephia SOL/USD and ATLAS/USD token series',
    currency: 'SOL', quoteField: 'price', estimated: false,
  };
}

function resolveAssetAtlasPriceAtOrBefore(assetSeries, timestampMs, { atlasUsdSeries = null } = {}) {
  const asset = latestPointAtOrBefore(assetSeries, timestampMs);
  if (!asset) return null;
  const currency = String(assetSeries?.currency || '').toUpperCase();
  let priceATL = asset.price;
  let atlas = null;
  if (currency === 'USDC') {
    atlas = latestPointAtOrBefore(atlasUsdSeries, asset.timestamp);
    if (!atlas || !(atlas.price > 0)) return null;
    priceATL = asset.price / atlas.price;
  } else if (currency !== 'ATLAS') return null;
  return {
    status: 'complete', priceATL, priceATLExact: exactNumber(priceATL),
    effectiveTimestamp: new Date(Number(timestampMs)).toISOString(),
    effectiveUtcDate: new Date(Number(timestampMs)).toISOString().slice(0, 10),
    observedAt: new Date(asset.timestamp).toISOString(),
    priceDay: new Date(asset.timestamp).toISOString().slice(0, 10),
    source: 'Aephia asset price series', currency, quoteField: 'price',
    bestBid: asset.bestBid, bestAsk: asset.bestAsk, estimated: false,
    ...(atlas ? { atlasUsdPrice: atlas.price, atlasUsdObservedAt: new Date(atlas.timestamp).toISOString() } : {}),
  };
}

module.exports = {
  parseAephiaPriceSeries, valuationTimestampMs, selectAssetSeriesCurrency, latestPointAtOrBefore,
  resolveAssetAtlasPriceAtOrBefore, resolveSolAtlasPriceAtOrBefore,
};
