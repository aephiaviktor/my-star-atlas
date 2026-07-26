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

function buildProductionLedger({ scanningRows = [], miningRows = [] } = {}) {
  const ledger = new InventoryCostLedger();
  ledger.applyEvents([
    ...buildScanningAcquisitionEvents(scanningRows),
    ...buildMiningAcquisitionEvents(miningRows),
  ]);
  return ledger;
}

module.exports = { buildScanningAcquisitionEvents, buildMiningAcquisitionEvents, buildProductionLedger };
