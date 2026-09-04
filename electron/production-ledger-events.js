'use strict';

const crypto = require('node:crypto');
const { canonicalAssetName } = require('./asset-name');
const { InventoryCostLedger } = require('./inventory-cost-ledger');
const { buildLocalMarketLedgerEvents } = require('./local-market-trades');
const { createInventoryBasisSnapshot } = require('./inventory-basis-snapshot');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function eventFingerprint(event) {
  return crypto.createHash('sha256').update(stableJson(event)).digest('hex');
}

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
      asset: canonicalAssetName(row.asset),
      quantity: row.quantity,
      source: null,
      totalCost: null,
    });
    if (event) events.push(event);
  }
  return events;
}

function completeOpeningInventoryRows(openingInventoryRows = [], currentInventoryRows = []) {
  const completed = (openingInventoryRows || []).map((row) => ({
    ...row,
    asset: canonicalAssetName(row?.asset),
  }));
  const existingPools = new Set(completed.map((row) => (
    `${String(row?.starbase || '').trim()}\n${canonicalAssetName(row?.asset)}`
  )));
  for (const row of currentInventoryRows || []) {
    const starbase = String(row?.starbase || '').trim();
    const asset = canonicalAssetName(row?.asset);
    const quantity = Number(row?.quantity);
    const poolKey = `${starbase}\n${asset}`;
    if (!starbase || !asset || !(quantity > 0) || existingPools.has(poolKey)) continue;
    completed.push({ starbase, asset, quantity, timestamp: '1970-01-01T00:00:00.000Z' });
    existingPools.add(poolKey);
  }
  return completed;
}

function buildInventoryReconciliationEvents(rows) {
  const events = [];
  for (const row of rows || []) {
    const timestamp = normalizeTimestamp(row?.timestamp);
    const location = String(row?.starbase || row?.location || '').trim();
    const asset = canonicalAssetName(row?.asset);
    const quantity = Number(row?.quantity);
    if (!timestamp || !location || !asset || !Number.isFinite(quantity) || quantity < 0) continue;
    events.push({
      type: 'reconcile', timestamp, location, asset, quantity,
      depositFlowId: String(row?.depositFlowId || '').trim(),
    });
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
      carryPoolRate: true,
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

function poolKey(location, asset) {
  return `${String(location || '').trim()}\n${canonicalAssetName(asset)}`;
}

function producedProductionPools(event) {
  if (event?.type === 'craft') return [poolKey(event.location, event.outputAsset)];
  if (event?.type === 'transfer' && event.carryPoolRate) return [poolKey(event.destination, event.asset)];
  return [];
}

function consumedProductionPools(event) {
  if (event?.type === 'craft') return (event.ingredients || []).map((ingredient) => poolKey(event.location, ingredient.asset));
  if (event?.type === 'transfer' && event.carryPoolRate) return [poolKey(event.origin, event.asset)];
  return [];
}

function orderSameDayProductionDependencies(events) {
  const nodes = events.map((event, index) => ({ event, index, outgoing: new Set(), indegree: 0 }));
  const consumedByNode = nodes.map(({ event }) => new Set(consumedProductionPools(event)));
  for (const producer of nodes) {
    for (const producedPool of producedProductionPools(producer.event)) {
      for (const consumer of nodes) {
        if (producer === consumer || !consumedByNode[consumer.index].has(producedPool)
          || producer.outgoing.has(consumer.index)) continue;
        producer.outgoing.add(consumer.index);
        consumer.indegree += 1;
      }
    }
  }
  const ready = nodes.filter((node) => node.indegree === 0);
  const ordered = [];
  while (ready.length) {
    ready.sort((left, right) => left.index - right.index);
    const node = ready.shift();
    ordered.push(node.event);
    for (const targetIndex of node.outgoing) {
      const target = nodes[targetIndex];
      target.indegree -= 1;
      if (target.indegree === 0) ready.push(target);
    }
  }
  if (ordered.length < nodes.length) {
    const orderedEvents = new Set(ordered);
    ordered.push(...nodes.filter((node) => !orderedEvents.has(node.event)).map((node) => node.event));
  }
  return ordered;
}

function buildCostLedgerResult({ initialLedger = null, eventFingerprintCounts = {}, eventResultsByFingerprint = {}, seenEventFingerprints = [], eventResultByFingerprint = {}, openingInventoryRows = [], currentInventoryRows = [], inventoryReconciliationRows = [], scanningRows = [], miningRows = [], cargoRows = [], craftingRows = [], upgradingRows = [], localMarketTrades = [], assetFlowEvents = [], inventoryBasisFaction = '' } = {}) {
  const ledger = initialLedger || new InventoryCostLedger();
  const previousCounts = { ...(eventFingerprintCounts || {}) };
  for (const fingerprint of seenEventFingerprints || []) previousCounts[fingerprint] = Math.max(1, Number(previousCounts[fingerprint] || 0));
  const previousResults = { ...(eventResultsByFingerprint || {}) };
  for (const [fingerprint, result] of Object.entries(eventResultByFingerprint || {})) {
    if (!previousResults[fingerprint]) previousResults[fingerprint] = [result];
  }
  const completedOpeningInventoryRows = initialLedger
    ? openingInventoryRows
    : completeOpeningInventoryRows(openingInventoryRows, currentInventoryRows);
  const events = [
    ...buildOpeningInventoryEvents(completedOpeningInventoryRows),
    ...buildInventoryReconciliationEvents(inventoryReconciliationRows),
    ...buildScanningAcquisitionEvents(scanningRows),
    ...buildMiningAcquisitionEvents(miningRows),
    ...buildCargoTransferEvents(cargoRows),
    ...buildCraftingEvents(craftingRows),
    ...buildUpgradingConsumptionEvents(upgradingRows),
    ...buildLocalMarketLedgerEvents(localMarketTrades),
    ...(assetFlowEvents || []),
  ].map((event, index) => ({ event, index }))
    .sort((left, right) => Date.parse(left.event.timestamp) - Date.parse(right.event.timestamp) || left.index - right.index)
    .map(({ event }) => event);
  const appliedEvents = [];
  const appliedEventResults = [];
  const rejectedEvents = [];
  const skippedDuplicateEvents = [];
  const inventoryBasisSnapshots = [];
  const currentCounts = {};
  const currentResults = {};
  let checkpointLedger = InventoryCostLedger.fromSnapshot(ledger.snapshot());
  let checkpointEventFingerprintCounts = {};
  let checkpointEventResultsByFingerprint = {};
  const attemptEvent = (event) => {
    const fingerprint = eventFingerprint(event);
    const occurrence = (currentCounts[fingerprint] || 0) + 1;
    currentCounts[fingerprint] = occurrence;
    if (occurrence <= Number(previousCounts[fingerprint] || 0)) {
      skippedDuplicateEvents.push(event);
      const storedResult = previousResults[fingerprint]?.[occurrence - 1];
      if (storedResult) {
        if (!currentResults[fingerprint]) currentResults[fingerprint] = [];
        currentResults[fingerprint][occurrence - 1] = storedResult;
        appliedEventResults.push({ event, result: storedResult, fromCheckpoint: true });
      }
      return { status: 'resolved' };
    }
    try {
      const result = ledger.applyEvent(event);
      if (event.type === 'craft' || (event.type === 'consume' && ['upgrading', 'gm-sell'].includes(event.purpose))) {
        if (!currentResults[fingerprint]) currentResults[fingerprint] = [];
        currentResults[fingerprint][occurrence - 1] = result;
      }
      appliedEvents.push(event);
      appliedEventResults.push({ event, result });
      if (inventoryBasisFaction) {
        const pools = [];
        if (event.type === 'acquire' || event.type === 'acquire-lot' || event.type === 'consume') pools.push([event.location, event.asset]);
        if (event.type === 'transfer') pools.push([event.origin, event.asset], [event.destination, event.asset]);
        if (event.type === 'craft') {
          pools.push([event.location, event.outputAsset]);
          for (const ingredient of event.ingredients || []) pools.push([event.location, ingredient.asset]);
        }
        const uniquePools = new Map(pools.map(([location, asset]) => [`${location}\n${asset}`, [location, asset]]));
        for (const [location, asset] of uniquePools.values()) {
          if (!location || String(location).startsWith('wallet:')) continue;
          const row = ledger.get(location, asset);
          const snapshot = createInventoryBasisSnapshot({
            ...row,
            costs: row.knownCosts,
            cargoCost: row.knownCargoCost,
            faction: inventoryBasisFaction,
            starbase: location,
            timestamp: event.timestamp,
            eventId: `${fingerprint}:${occurrence}:${location}:${asset}`,
          });
          if (snapshot) inventoryBasisSnapshots.push(snapshot);
        }
      }
      return { status: 'applied' };
    } catch (error) {
      currentCounts[fingerprint] -= 1;
      if (currentCounts[fingerprint] === 0) delete currentCounts[fingerprint];
      const message = String(error?.message || error);
      return { status: message.startsWith('insufficient inventory for ') ? 'deferred' : 'rejected', error: message };
    }
  };
  const eventsByDay = new Map();
  for (const event of events) {
    const day = String(event.timestamp || '').slice(0, 10);
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day).push(event);
  }
  const activityDays = [...eventsByDay.keys()];
  const replayDay = activityDays.at(-1) || '';
  for (const [day, dayEvents] of eventsByDay.entries()) {
    if (day === replayDay) {
      checkpointLedger = InventoryCostLedger.fromSnapshot(ledger.snapshot());
      checkpointEventFingerprintCounts = { ...currentCounts };
      checkpointEventResultsByFingerprint = Object.fromEntries(Object.entries(currentResults)
        .map(([fingerprint, results]) => [fingerprint, results.map((result) => (
          result == null ? result : JSON.parse(JSON.stringify(result))
        ))]));
    }
    let pending = orderSameDayProductionDependencies(dayEvents).map((event) => ({ event, error: '' }));
    while (pending.length) {
      const deferred = [];
      let appliedInPass = false;
      for (const item of pending) {
        const outcome = attemptEvent(item.event);
        if (outcome.status === 'applied') appliedInPass = true;
        else if (outcome.status === 'deferred') deferred.push({ event: item.event, error: outcome.error });
        else if (outcome.status === 'rejected') rejectedEvents.push({ event: item.event, error: outcome.error });
      }
      if (!deferred.length) break;
      if (!appliedInPass) {
        rejectedEvents.push(...deferred);
        break;
      }
      pending = deferred;
    }
  }
  return {
    ledger,
    checkpointLedger,
    events,
    appliedEvents,
    appliedEventResults,
    rejectedEvents,
    skippedDuplicateEvents,
    inventoryBasisSnapshots,
    checkpointEventFingerprintCounts,
    checkpointEventResultsByFingerprint,
    checkpointSeenEventFingerprints: Object.keys(checkpointEventFingerprintCounts).sort(),
    checkpointEventResultByFingerprint: Object.fromEntries(Object.entries(checkpointEventResultsByFingerprint)
      .map(([fingerprint, results]) => [fingerprint, results[0]])),
    eventFingerprintCounts: currentCounts,
    eventResultsByFingerprint: currentResults,
    seenEventFingerprints: Object.keys(currentCounts).sort(),
    eventResultByFingerprint: Object.fromEntries(Object.entries(currentResults).map(([fingerprint, results]) => [fingerprint, results[0]])),
  };
}

function buildProductionLedger(options = {}) {
  return buildCostLedgerResult(options).ledger;
}

module.exports = {
  eventFingerprint,
  buildOpeningInventoryEvents,
  completeOpeningInventoryRows,
  buildInventoryReconciliationEvents,
  buildScanningAcquisitionEvents,
  buildMiningAcquisitionEvents,
  buildCargoTransferEvents,
  buildCraftingEvents,
  buildUpgradingConsumptionEvents,
  buildCostLedgerResult,
  buildProductionLedger,
};
