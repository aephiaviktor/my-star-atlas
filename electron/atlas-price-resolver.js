'use strict';

const fs = require('node:fs/promises');
const { writeJsonAtomic } = require('./atomic-json');

const PRICE_SEED_SCHEMA_VERSION = 1;
const INITIAL_SEED_START_UTC = '2026-07-06';
const INITIAL_SEED_END_UTC = '2026-08-04';

function normalizeUtcDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function inInitialSeedWindow(date) {
  return date >= INITIAL_SEED_START_UTC && date <= INITIAL_SEED_END_UTC;
}

function normalizeAsset(value) {
  return String(value || '').trim().toLowerCase();
}

function emptyDocument() {
  return { schemaVersion: PRICE_SEED_SCHEMA_VERSION, seeds: {}, historical: {} };
}

async function loadDocument(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (value?.schemaVersion !== PRICE_SEED_SCHEMA_VERSION || typeof value.seeds !== 'object' || typeof value.historical !== 'object') {
      throw new Error('price seed document is incompatible');
    }
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyDocument();
    throw error;
  }
}

function createAtlasPriceResolver({ filePath, now = () => new Date().toISOString() }) {
  if (!filePath) throw new TypeError('filePath is required');

  async function captureCurrentPriceSeeds(currentPrices = {}) {
    const document = await loadDocument(filePath);
    let changed = false;
    const capturedAt = now();
    for (const [asset, rawPrice] of Object.entries(currentPrices || {})) {
      const key = normalizeAsset(asset);
      const priceATL = Number(rawPrice);
      if (!key || !Number.isFinite(priceATL) || priceATL <= 0 || document.seeds[key]) continue;
      document.seeds[key] = {
        asset: String(asset).trim(),
        effectiveUtcStart: INITIAL_SEED_START_UTC,
        effectiveUtcEnd: INITIAL_SEED_END_UTC,
        capturedAt,
        priceATL,
        source: 'current_price_seed',
        provenance: 'Aephia /gm/resource pricingATL.priceATL captured from already-loaded current prices',
        estimated: true,
      };
      changed = true;
    }
    if (changed) await writeJsonAtomic(filePath, document);
    return document;
  }

  async function resolveAtlasPrice(asset, valuationUtcDate, { historicalByDate = null } = {}) {
    const key = normalizeAsset(asset);
    const effectiveUtcDate = normalizeUtcDate(valuationUtcDate);
    if (!key || !effectiveUtcDate) return { status: 'incomplete', priceATL: null, effectiveUtcDate: effectiveUtcDate || null, source: null, provenance: null, estimated: null };
    const document = await loadDocument(filePath);
    const externalHistorical = historicalByDate?.[effectiveUtcDate]?.[key] ?? historicalByDate?.[effectiveUtcDate]?.[asset];
    const persistedHistorical = document.historical?.[effectiveUtcDate]?.[key];
    const historical = externalHistorical ?? persistedHistorical;
    const historicalPrice = Number(historical?.priceATL ?? historical);
    if (Number.isFinite(historicalPrice) && historicalPrice > 0) {
      return {
        status: 'complete', priceATL: historicalPrice, effectiveUtcDate,
        source: historical?.source || 'aephia_historical',
        provenance: historical?.provenance || 'Aephia exact UTC-date historical value', estimated: false,
      };
    }
    const seed = document.seeds[key];
    if (seed && inInitialSeedWindow(effectiveUtcDate)) {
      return { status: 'complete', priceATL: seed.priceATL, effectiveUtcDate, capturedAt: seed.capturedAt, source: seed.source, provenance: seed.provenance, estimated: true };
    }
    return { status: 'incomplete', priceATL: null, effectiveUtcDate, source: null, provenance: null, estimated: null };
  }

  return { captureCurrentPriceSeeds, resolveAtlasPrice, load: () => loadDocument(filePath) };
}

module.exports = { PRICE_SEED_SCHEMA_VERSION, INITIAL_SEED_START_UTC, INITIAL_SEED_END_UTC, normalizeUtcDate, createAtlasPriceResolver };
