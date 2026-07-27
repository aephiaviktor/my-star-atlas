'use strict';

const { InventoryCostLedger } = require('./inventory-cost-ledger');

function eventTimestamp(isoDate) {
  const value = String(isoDate || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : '';
}

function acquisition({ timestamp, location, asset, quantity, source, totalCost }) {
  const units = Number(quantity);
  const place = String(location || '').trim();
  const item = String(asset || '').trim();
  if (!timestamp || !place || !item || !Number.isFinite(units) || units <= 0) return null;
  const event = { type: 'acquire', timestamp, location: place, asset: item, quantity: units };
  if (totalCost !== null && totalCost !== undefined && totalCost !== '' && Number.isFinite(Number(totalCost)) && Number(totalCost) >= 0) {
    event.source = source;
    event.totalCost = Number(totalCost);
  }
  return event;
}

function buildOpeningInventoryEvents(rows) {
  const events = [];
  for (const row of rows || []) {
    const event = acquisition({
      timestamp: normalizeTimestamp(row.timestamp),
      location: row.starbase,
      asset: row.asset,
      quantity: row.quantity,
      source: null,
      totalCost: null,
    });
    if (event) events.push(event);
  }
  return events;
}

function buildScanningAcquisitionEvents(rows) {
  const events = [];
  for (const row of rows || []) {
    const timestamp = eventTimestamp(row.isoDate);
    const totalQuantity = Number(row.sduFound);
    const production = Array.isArray(row.productionByStarbase) ? row.productionByStarbase : [];
    const valid = production.filter((entry) => String(entry?.starbase || '').trim() && Number(entry?.quantity) > 0);
    const locatedQuantity = valid.reduce((sum, entry) => sum + Number(entry.quantity), 0);
    if (!timestamp || !(totalQuantity > 0) || !(locatedQuantity > 0)) continue;
    for (const entry of valid) {
      const quantity = Number(entry.quantity);
      const hasTotalCost = row.totalCostsAtlas !== null && row.totalCostsAtlas !== undefined && row.totalCostsAtlas !== ''
        && Number.isFinite(Number(row.totalCostsAtlas));
      const totalCost = hasTotalCost ? Number(row.totalCostsAtlas) * (quantity / totalQuantity) : null;
      const event = acquisition({ timestamp, location: entry.starbase, asset: 'Survey Data Unit', quantity, source: 'scanning', totalCost });
      if (event) events.push(event);
    }
  }
  return events;
}

function buildMiningAcquisitionEvents(rows) {
  const events = [];
  for (const row of rows || []) {
    const event = acquisition({
      timestamp: eventTimestamp(row.isoDate),
      location: row.starbase,
      asset: row.rawMaterial,
      quantity: row.mined,
      source: 'mining',
      totalCost: row.totalCostsAtlas,
    });
    if (event) events.push(event);
  }
  return events;
}

function normalizeTimestamp(value, isoDate) {
  const date = new Date(value || eventTimestamp(isoDate));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function buildCargoTransferEvents(rows) {
  const events = [];
  for (const row of rows || []) {
    const timestamp = normalizeTimestamp(row.timestamp, row.isoDate);
    const origin = String(row.origin || '').trim();
    const destination = String(row.destination || '').trim();
    const asset = String(row.asset || '').trim();
    const quantity = Number(row.amount);
    const hasCargoCost = row.totalCostsAtlas !== null && row.totalCostsAtlas !== undefined && row.totalCostsAtlas !== ''
      && Number.isFinite(Number(row.totalCostsAtlas)) && Number(row.totalCostsAtlas) >= 0;
    if (!timestamp || !origin || origin === '--' || !destination || destination === '--' || origin === destination
      || !asset || !Number.isFinite(quantity) || quantity <= 0 || !hasCargoCost) continue;
    events.push({
      type: 'transfer',
      timestamp,
      origin,
      destination,
      asset,
      quantity,
      cargoCost: Number(row.totalCostsAtlas),
    });
  }
  return events;
}

function buildCraftingEvents(rows) {
  const events = [];
  for (const row of rows || []) {
    const timestamp = normalizeTimestamp(row.timestamp, row.isoDate);
    const location = String(row.starbase || '').trim();
    const outputAsset = String(row.output || '').trim();
    const outputQuantity = Number(row.crafted);
    const ingredients = Array.isArray(row.ingredients) ? row.ingredients.map((ingredient) => ({
      asset: String(ingredient?.input || '').trim(),
      quantity: Number(ingredient?.amount),
    })) : [];
    const fee = Number(row.feeCostsAtlas);
    const txs = Number(row.txsCostsAtlas);
    if (!timestamp || !location || !outputAsset || !Number.isFinite(outputQuantity) || outputQuantity <= 0
      || !ingredients.length || ingredients.some((ingredient) => !ingredient.asset || !Number.isFinite(ingredient.quantity) || ingredient.quantity <= 0)
      || row.feeCostsAtlas == null || row.txsCostsAtlas == null || !Number.isFinite(fee) || fee < 0 || !Number.isFinite(txs) || txs < 0) continue;
    events.push({ type: 'craft', timestamp, location, outputAsset, outputQuantity, ingredients, craftingCost: fee + txs });
  }
  return events;
}

function buildUpgradingConsumptionEvents(rows) {
  const events = [];
  for (const row of rows || []) {
    const timestamp = normalizeTimestamp(row.timestamp, row.isoDate);
    const location = String(row.starbase || '').trim();
    const asset = String(row.asset || '').trim();
    const quantity = Number(row.installed);
    if (!timestamp || !location || !asset || !Number.isFinite(quantity) || quantity <= 0) continue;
    events.push({ type: 'consume', timestamp, location, asset, quantity, purpose: 'upgrading' });
  }
  return events;
}

function buildCostLedgerResult({ openingInventoryRows = [], scanningRows = [], miningRows = [], cargoRows = [], craftingRows = [], upgradingRows = [] } = {}) {
  const ledger = new InventoryCostLedger();
  const events = [
    ...buildOpeningInventoryEvents(openingInventoryRows),
    ...buildScanningAcquisitionEvents(scanningRows),
    ...buildMiningAcquisitionEvents(miningRows),
    ...buildCargoTransferEvents(cargoRows),
    ...buildCraftingEvents(craftingRows),
    ...buildUpgradingConsumptionEvents(upgradingRows),
  ].map((event, index) => ({ event, index }))
    .sort((left, right) => Date.parse(left.event.timestamp) - Date.parse(right.event.timestamp) || left.index - right.index)
    .map(({ event }) => event);
  const appliedEvents = [];
  const appliedEventResults = [];
  const rejectedEvents = [];
  for (const event of events) {
    try {
      const result = ledger.applyEvent(event);
      appliedEvents.push(event);
      appliedEventResults.push({ event, result });
    } catch (error) {
      rejectedEvents.push({ event, error: String(error?.message || error) });
    }
  }
  return { ledger, events, appliedEvents, appliedEventResults, rejectedEvents };
}

function buildProductionLedger(options = {}) {
  return buildCostLedgerResult(options).ledger;
}

module.exports = {
  buildOpeningInventoryEvents,
  buildScanningAcquisitionEvents,
  buildMiningAcquisitionEvents,
  buildCargoTransferEvents,
  buildCraftingEvents,
  buildUpgradingConsumptionEvents,
  buildCostLedgerResult,
  buildProductionLedger,
};
