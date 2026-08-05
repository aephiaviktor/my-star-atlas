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

function exactPositiveDecimal(value) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && !/^0(?:\.0+)?$/.test(text) ? text : '';
}

function incompletePrice(effectiveUtcDate, reason) {
  return { status: 'incomplete', priceATL: null, priceATLExact: null, effectiveUtcDate: effectiveUtcDate || null, priceDay: null, source: null, provenance: null, estimated: null, reason };
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
    if (!key || !effectiveUtcDate) return incompletePrice(effectiveUtcDate, 'valuation_day_invalid');
    const document = await loadDocument(filePath);
    const externalHistorical = historicalByDate?.[effectiveUtcDate]?.[key] ?? historicalByDate?.[effectiveUtcDate]?.[asset];
    const persistedHistorical = document.historical?.[effectiveUtcDate]?.[key];
    const historical = externalHistorical ?? persistedHistorical;
    if (historical != null) {
      const historicalExact = exactPositiveDecimal(historical?.priceATL ?? historical);
      if (!historicalExact) return incompletePrice(effectiveUtcDate, 'historical_price_invalid');
      return {
        status: 'complete', priceATL: Number(historicalExact), priceATLExact: historicalExact,
        effectiveUtcDate, priceDay: effectiveUtcDate,
        source: historical?.source || 'aephia_historical',
        provenance: historical?.provenance || 'Aephia exact UTC-date historical value', estimated: false,
      };
    }
    const seed = document.seeds[key];
    const seedExact = exactPositiveDecimal(seed?.priceATL);
    if (seed && inInitialSeedWindow(effectiveUtcDate)) {
      if (!seedExact) return incompletePrice(effectiveUtcDate, 'seed_price_invalid');
      return { status: 'complete', priceATL: Number(seedExact), priceATLExact: seedExact, effectiveUtcDate, priceDay: effectiveUtcDate, capturedAt: seed.capturedAt, source: seed.source, provenance: seed.provenance, estimated: true };
    }
    if (effectiveUtcDate > INITIAL_SEED_END_UTC) {
      if (!seed || !seedExact) return incompletePrice(effectiveUtcDate, seed ? 'provisional_seed_invalid' : 'provisional_seed_missing');
      return {
        status: 'provisional', priceATL: Number(seedExact), priceATLExact: seedExact,
        effectiveUtcDate, priceDay: INITIAL_SEED_END_UTC, capturedAt: seed.capturedAt,
        source: 'provisional_seed_carry_forward',
        provenance: `Frozen ${INITIAL_SEED_END_UTC} current_price_seed carried forward provisionally`,
        estimated: true,
      };
    }
    return incompletePrice(effectiveUtcDate, 'price_missing');
  }

  return { captureCurrentPriceSeeds, resolveAtlasPrice, load: () => loadDocument(filePath) };
}

module.exports = { PRICE_SEED_SCHEMA_VERSION, INITIAL_SEED_START_UTC, INITIAL_SEED_END_UTC, normalizeUtcDate, createAtlasPriceResolver };
