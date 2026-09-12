'use strict';

function utcDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function aggregateMiningTransactionEvents(rows, { includedDays = null } = {}) {
  const events = new Map();

  for (const row of rows || []) {
    const field = String(row?._field || '').trim();
    if (field !== 'txCostSol' && field !== 'txCount') continue;
    const fleet = String(row?.fleet || '').trim();
    const starbase = String(row?.starbase || '').trim();
    const rawMaterial = String(row?.rss || '').trim();
    const timestamp = String(row?._time || '').trim();
    const isoDate = utcDateKey(timestamp);
    const value = Number(row?._value);
    if (!fleet || !starbase || !rawMaterial || !timestamp || !isoDate || !Number.isFinite(value) || value < 0) continue;
    if (field === 'txCount' && !Number.isSafeInteger(value)) continue;
    if (includedDays && !includedDays.has(isoDate)) continue;

    const eventKey = `${timestamp}\n${fleet}\n${starbase}\n${rawMaterial}`;
    if (!events.has(eventKey)) events.set(eventKey, {
      isoDate,
      fleet,
      starbase,
      rawMaterial,
      txCostSol: 0,
      txsDaily: 0,
      observedFeePoint: false,
      explicitCount: false,
    });
    const event = events.get(eventKey);
    if (field === 'txCostSol') {
      event.txCostSol += value;
      event.observedFeePoint = true;
    } else {
      event.txsDaily += value;
      event.explicitCount = true;
    }
  }

  const daily = new Map();
  for (const event of events.values()) {
    if (!event.observedFeePoint && !event.explicitCount) continue;
    const key = `${event.isoDate}\n${event.fleet}\n${event.starbase}\n${event.rawMaterial}`;
    if (!daily.has(key)) daily.set(key, {
      isoDate: event.isoDate,
      fleet: event.fleet,
      starbase: event.starbase,
      rawMaterial: event.rawMaterial,
      txCostSol: 0,
      txsDaily: 0,
    });
    const target = daily.get(key);
    target.txCostSol += event.txCostSol;
    target.txsDaily += event.explicitCount ? event.txsDaily : 1;
  }

  return Array.from(daily.values());
}

module.exports = { aggregateMiningTransactionEvents };
