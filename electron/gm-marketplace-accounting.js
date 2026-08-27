'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function unique(values) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeFaction(value) {
  const faction = String(value || '').trim().toUpperCase();
  return faction === 'UST' ? 'USTUR' : faction;
}

function buildGmWalletUniverse({ gmTradingWallets = [], profileWalletsByFaction = {} } = {}) {
  const gmWallets = unique(gmTradingWallets);
  const normalizedProfiles = {};
  for (const faction of ['MUD', 'ONI', 'USTUR']) {
    normalizedProfiles[faction] = unique(profileWalletsByFaction[faction] || profileWalletsByFaction[faction === 'USTUR' ? 'UST' : faction]);
  }
  const allWallets = unique([...gmWallets, ...Object.values(normalizedProfiles).flat()]);
  const memberships = new Map(allWallets.map((wallet) => [wallet, {
    gm: gmWallets.includes(wallet),
    factions: Object.entries(normalizedProfiles).filter(([, wallets]) => wallets.includes(wallet)).map(([faction]) => faction),
  }]));
  return { gmWallets, profileWalletsByFaction: normalizedProfiles, allWallets, memberships };
}

function createStarbasePoolKey({ faction, starbase, asset } = {}) {
  const parts = [normalizeFaction(faction), starbase, asset].map((value) => String(value || '').trim());
  return parts.every(Boolean) ? parts.join('\n') : '';
}

function calculateForwardStockpileAverage(observations, { from, now = new Date().toISOString(), days = 7 } = {}) {
  const startMs = Date.parse(from);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs) || !(days > 0)) return null;
  const targetEndMs = startMs + days * DAY_MS;
  const endMs = Math.min(targetEndMs, nowMs);
  if (!(endMs > startMs)) return null;
  const rows = (observations || []).map((row) => ({
    timestampMs: Date.parse(row?.timestamp),
    knownQuantity: Number(row?.knownQuantity),
    knownInventoryValueAtlas: Number(row?.knownInventoryValueAtlas),
  })).filter((row) => Number.isFinite(row.timestampMs) && row.timestampMs <= endMs
    && row.knownQuantity > 0 && row.knownInventoryValueAtlas >= 0)
    .sort((left, right) => left.timestampMs - right.timestampMs);
  let current = null;
  let cursorMs = startMs;
  let quantityMs = 0;
  let valueMs = 0;
  for (const row of rows) {
    if (row.timestampMs <= startMs) {
      current = row;
      continue;
    }
    if (row.timestampMs > endMs) break;
    if (current) {
      const durationMs = row.timestampMs - cursorMs;
      quantityMs += current.knownQuantity * durationMs;
      valueMs += current.knownInventoryValueAtlas * durationMs;
    }
    current = row;
    cursorMs = row.timestampMs;
  }
  if (current && endMs > cursorMs) {
    const durationMs = endMs - cursorMs;
    quantityMs += current.knownQuantity * durationMs;
    valueMs += current.knownInventoryValueAtlas * durationMs;
  }
  if (!(quantityMs > 0)) return null;
  return {
    unitCostAtlas: valueMs / quantityMs,
    provisional: endMs < targetEndMs,
    provenance: 'imputed_forward_7d_stockpile_average',
    windowStart: new Date(startMs).toISOString(),
    windowEnd: new Date(endMs).toISOString(),
  };
}

function calculateGmWalletInventoryBasis(events, { fallbackUnitCost = () => 0 } = {}) {
  const inventory = new Map();
  const outgoingBasis = new Map();
  const stateFor = (wallet, asset) => {
    const key = `${wallet}\n${asset}`;
    if (!inventory.has(key)) inventory.set(key, { quantity: 0, totalCostAtlas: 0 });
    return inventory.get(key);
  };
  const ordered = (events || []).filter((event) => event?.wallet && event?.asset && Number(event?.quantity) > 0)
    .slice().sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  for (const event of ordered) {
    const quantity = Number(event.quantity);
    const state = stateFor(String(event.wallet), String(event.asset));
    const average = state.quantity > 0 ? state.totalCostAtlas / state.quantity : 0;
    if (event.side === 'buy' && Number(event.unitPriceAtlas) >= 0) {
      state.quantity += quantity;
      state.totalCostAtlas += quantity * Number(event.unitPriceAtlas);
      continue;
    }
    if (event.side === 'sell') {
      const knownQuantity = Math.min(quantity, state.quantity);
      state.quantity -= knownQuantity;
      state.totalCostAtlas -= knownQuantity * average;
      if (state.quantity < 1e-9) {
        state.quantity = 0;
        state.totalCostAtlas = 0;
      }
      continue;
    }
    if (event.side !== 'transfer-out') continue;
    const knownQuantity = Math.min(quantity, state.quantity);
    const unknownQuantity = quantity - knownQuantity;
    const fallback = Math.max(0, Number(fallbackUnitCost(event)) || 0);
    const totalCostAtlas = knownQuantity * average + unknownQuantity * fallback;
    state.quantity -= knownQuantity;
    state.totalCostAtlas -= knownQuantity * average;
    if (state.quantity < 1e-9) {
      state.quantity = 0;
      state.totalCostAtlas = 0;
    }
    outgoingBasis.set(String(event.id), {
      quantity,
      unitCostAtlas: totalCostAtlas / quantity,
      totalCostAtlas,
      provenance: unknownQuantity > 0 ? 'imputed_forward_7d_stockpile_average' : 'exact',
      knownQuantity,
      imputedQuantity: unknownQuantity,
    });
  }
  return { inventory, outgoingBasis };
}

function walletFromLocation(value) {
  const match = String(value || '').match(/^wallet:(.+)$/);
  return match ? match[1] : '';
}

function matchGmCustodyFlows(flows, walletUniverse) {
  const gm = new Set(walletUniverse?.gmWallets || []);
  const profile = new Set(Object.values(walletUniverse?.profileWalletsByFaction || {}).flat());
  const queues = new Map();
  const buys = [];
  const sells = [];
  const queueFor = (wallet, asset) => {
    const key = `${wallet}\n${asset}`;
    if (!queues.has(key)) queues.set(key, []);
    return queues.get(key);
  };
  const addLot = (wallet, asset, lot) => queueFor(wallet, asset).push(lot);
  const takeLots = (wallet, asset, quantity, direction) => {
    const queue = queueFor(wallet, asset);
    const taken = [];
    let remaining = quantity;
    for (let index = 0; index < queue.length && remaining > 0; index += 1) {
      const lot = queue[index];
      if (lot.direction !== direction || !(lot.quantity > 0)) continue;
      const amount = Math.min(remaining, lot.quantity);
      taken.push({ ...lot, quantity: amount });
      lot.quantity -= amount;
      remaining -= amount;
    }
    queues.set(`${wallet}\n${asset}`, queue.filter((lot) => lot.quantity > 0));
    return { taken, remaining };
  };
  const ordered = (flows || []).filter((flow) => Number(flow?.quantity) > 0 && flow?.asset)
    .slice().sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  for (const flow of ordered) {
    const originWallet = walletFromLocation(flow.origin);
    const destinationWallet = walletFromLocation(flow.destination);
    const quantity = Number(flow.quantity);
    if (flow.flow === 'css-withdraw' && destinationWallet && profile.has(destinationWallet)) {
      addLot(destinationWallet, flow.asset, {
        direction: 'sell', quantity, withdrawalFlowId: flow.id, withdrawalTimestamp: flow.timestamp,
        faction: normalizeFaction(flow.faction), starbase: flow.origin, rawMint: flow.rawMint,
      });
      continue;
    }
    if (flow.flow === 'css-deposit' && originWallet && profile.has(originWallet)) {
      const { taken, remaining } = takeLots(originWallet, flow.asset, quantity, 'buy');
      for (const lot of taken) buys.push({
        asset: flow.asset, rawMint: flow.rawMint || lot.rawMint, quantity: lot.quantity, faction: normalizeFaction(flow.faction), starbase: flow.destination,
        depositTimestamp: flow.timestamp, depositFlowId: flow.id, sourceWallet: lot.sourceWallet,
        sourceFlowId: lot.sourceFlowId, provenance: 'exact',
      });
      if (remaining > 0) buys.push({
        asset: flow.asset, rawMint: flow.rawMint, quantity: remaining, faction: normalizeFaction(flow.faction), starbase: flow.destination,
        depositTimestamp: flow.timestamp, depositFlowId: flow.id, sourceWallet: '', sourceFlowId: '', provenance: 'imputed_fifo',
      });
      continue;
    }
    if (flow.flow !== 'wallet-transfer' || !originWallet || !destinationWallet) continue;
    if (gm.has(originWallet) && profile.has(destinationWallet)) {
      addLot(destinationWallet, flow.asset, {
        direction: 'buy', quantity, rawMint: flow.rawMint, sourceWallet: originWallet, sourceFlowId: flow.id,
      });
      continue;
    }
    if (profile.has(originWallet) && profile.has(destinationWallet)) {
      const originQueue = queueFor(originWallet, flow.asset);
      let remaining = quantity;
      for (const lot of originQueue) {
        if (!(remaining > 0) || !(lot.quantity > 0)) continue;
        const amount = Math.min(remaining, lot.quantity);
        addLot(destinationWallet, flow.asset, { ...lot, quantity: amount });
        lot.quantity -= amount;
        remaining -= amount;
      }
      queues.set(`${originWallet}\n${flow.asset}`, originQueue.filter((lot) => lot.quantity > 0));
      continue;
    }
    if (profile.has(originWallet) && gm.has(destinationWallet)) {
      const { taken } = takeLots(originWallet, flow.asset, quantity, 'sell');
      for (const lot of taken) sells.push({
        asset: flow.asset, rawMint: flow.rawMint || lot.rawMint, quantity: lot.quantity, faction: lot.faction, starbase: lot.starbase,
        withdrawalTimestamp: lot.withdrawalTimestamp, withdrawalFlowId: lot.withdrawalFlowId,
        arrivalTimestamp: flow.timestamp, destinationWallet, destinationFlowId: flow.id, provenance: 'exact',
      });
    }
  }
  const pending = [];
  for (const lots of queues.values()) {
    for (const lot of lots) if (lot.direction === 'sell') pending.push({ ...lot, provenance: 'imputed_fifo' });
  }
  return { buys, sells, pending };
}

function applyForwardStockpileImputation(unknownRows, observations, options = {}) {
  return (unknownRows || []).map((row) => {
    const poolKey = createStarbasePoolKey(row);
    const poolObservations = (observations || []).filter((observation) => createStarbasePoolKey(observation) === poolKey);
    const estimate = calculateForwardStockpileAverage(poolObservations, { ...options, from: row.timestamp });
    if (!estimate) return { ...row, unitCostAtlas: 0, imputedTotalCostAtlas: 0, provisional: true, provenance: 'imputed_gapless_zero' };
    return { ...row, ...estimate, imputedTotalCostAtlas: Number(row.unknownQuantity || 0) * estimate.unitCostAtlas };
  });
}

function enrichGmTradesWithInventoryBasis(trades, appliedEventResults, { fallbackByTradeId = new Map(), inventoryBasisObservations = [] } = {}) {
  const consumptionByTradeId = new Map((appliedEventResults || []).flatMap((entry) => {
    const event = entry?.event;
    return event?.type === 'consume' && event?.purpose === 'gm-sell' && event?.tradeId
      ? [[String(event.tradeId), entry.result || {}]] : [];
  }));
  return (trades || []).map((trade) => {
    if (String(trade?.marketplace || trade?.market || '').toUpperCase() !== 'GM' || trade?.side !== 'sell') {
      return { ...trade, inventoryCostAtlas: null, netProfitAtlas: null, profitMarginPercent: null, basisProvenance: '' };
    }
    const result = consumptionByTradeId.get(String(trade.id || ''));
    const quantity = Number(trade.quantity) || 0;
    const uncostedQuantity = result ? Math.max(0, Number(result.uncostedQuantity || 0)) : quantity;
    const knownCostAtlas = Object.values(result?.costs || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)
      + (Number(result?.cargoCost) || 0);
    let fallback = fallbackByTradeId instanceof Map
      ? fallbackByTradeId.get(String(trade.id || '')) : fallbackByTradeId?.[String(trade.id || '')];
    if (fallback == null && uncostedQuantity > 0) {
      const poolKey = createStarbasePoolKey(trade);
      fallback = calculateForwardStockpileAverage(
        inventoryBasisObservations.filter((observation) => createStarbasePoolKey(observation) === poolKey),
        { from: trade.timestamp },
      );
    }
    const fallbackUnitCost = Math.max(0, Number(fallback?.unitCostAtlas ?? fallback) || 0);
    const inventoryCostAtlas = knownCostAtlas + uncostedQuantity * fallbackUnitCost;
    const revenueAtlas = Math.max(0, Number(trade.settledAtlas) || 0);
    const netProfitAtlas = revenueAtlas - inventoryCostAtlas;
    return {
      ...trade,
      inventoryCostAtlas,
      netProfitAtlas,
      profitMarginPercent: revenueAtlas > 0 ? (netProfitAtlas / revenueAtlas) * 100 : null,
      basisProvenance: uncostedQuantity > 0
        ? (fallbackUnitCost > 0 ? 'imputed_forward_7d_stockpile_average' : 'imputed_gapless_zero')
        : 'exact',
      imputedQuantity: Math.min(quantity, uncostedQuantity),
    };
  });
}

function projectGmFactionMarketplaceRows({ trades = [], flows = [], walletUniverse, inventoryBasisObservations = [] } = {}) {
  const gmWallets = new Set(walletUniverse?.gmWallets || []);
  const inventoryEvents = [];
  for (const trade of trades) {
    if (String(trade?.marketplace || trade?.market || '').toUpperCase() !== 'GM' || !gmWallets.has(String(trade.wallet || ''))) continue;
    const quantity = Number(trade.quantity);
    if (!(quantity > 0)) continue;
    if (trade.side === 'buy') inventoryEvents.push({
      id: trade.id, timestamp: trade.timestamp, wallet: trade.wallet, asset: trade.asset,
      side: 'buy', quantity, unitPriceAtlas: Number(trade.settledAtlas) / quantity,
    });
    else if (trade.side === 'sell') inventoryEvents.push({
      id: trade.id, timestamp: trade.timestamp, wallet: trade.wallet, asset: trade.asset, side: 'sell', quantity,
    });
  }
  for (const flow of flows) {
    const wallet = walletFromLocation(flow.origin);
    if (flow.flow === 'wallet-transfer' && gmWallets.has(wallet)) inventoryEvents.push({
      id: flow.id, timestamp: flow.timestamp, wallet, asset: flow.asset, side: 'transfer-out', quantity: flow.quantity,
    });
  }
  const basis = calculateGmWalletInventoryBasis(inventoryEvents);
  const custody = matchGmCustodyFlows(flows, walletUniverse);
  const rows = [];
  for (const deposit of custody.buys) {
    const allocation = basis.outgoingBasis.get(String(deposit.sourceFlowId || ''));
    if (!allocation || deposit.provenance !== 'exact' || !(allocation.unitCostAtlas >= 0)) continue;
    let unitPriceAtlas = allocation.unitCostAtlas;
    let basisAvailable = allocation.imputedQuantity === 0;
    if (!basisAvailable) {
      const poolKey = createStarbasePoolKey({ faction: deposit.faction, starbase: deposit.starbase, asset: deposit.asset });
      const estimate = calculateForwardStockpileAverage(
        inventoryBasisObservations.filter((observation) => createStarbasePoolKey(observation) === poolKey),
        { from: deposit.depositTimestamp },
      );
      if (estimate?.unitCostAtlas > 0) {
        unitPriceAtlas = (allocation.totalCostAtlas + allocation.imputedQuantity * estimate.unitCostAtlas) / allocation.quantity;
        basisAvailable = true;
      }
    }
    rows.push({
      id: `gm-buy:${deposit.depositFlowId}:${deposit.sourceFlowId}`, market: 'GM', side: 'buy',
      faction: deposit.faction, profile: deposit.faction, timestamp: deposit.depositTimestamp,
      asset: deposit.asset, rawMint: deposit.rawMint, starbase: deposit.starbase,
      wallet: deposit.sourceWallet, quantity: deposit.quantity, unitPriceAtlas,
      grossAtlas: deposit.quantity * unitPriceAtlas, marketplaceFeeAtlas: 0,
      netAtlas: deposit.quantity * unitPriceAtlas, settledAtlas: deposit.quantity * unitPriceAtlas,
      basisAvailable,
      custodySignature: deposit.depositFlowId, sourceFlowId: deposit.sourceFlowId,
    });
  }
  const sellQueues = new Map();
  for (const lot of custody.sells) {
    const key = `${lot.destinationWallet}\n${lot.asset}`;
    if (!sellQueues.has(key)) sellQueues.set(key, []);
    sellQueues.get(key).push({ ...lot });
  }
  const sellTrades = trades.filter((trade) => String(trade?.marketplace || trade?.market || '').toUpperCase() === 'GM'
    && trade.side === 'sell' && gmWallets.has(String(trade.wallet || '')))
    .slice().sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || String(left.id).localeCompare(String(right.id)));
  for (const trade of sellTrades) {
    const quantity = Number(trade.quantity);
    const queue = sellQueues.get(`${trade.wallet}\n${trade.asset}`) || [];
    let remaining = quantity;
    for (const lot of queue) {
      if (!(remaining > 0) || !(lot.quantity > 0) || Date.parse(lot.arrivalTimestamp) > Date.parse(trade.timestamp)) continue;
      const allocated = Math.min(remaining, lot.quantity);
      const ratio = quantity > 0 ? allocated / quantity : 0;
      rows.push({
        id: `gm-sell:${lot.withdrawalFlowId}:${trade.id}`, market: 'GM', side: 'sell',
        faction: lot.faction, profile: lot.faction, timestamp: lot.withdrawalTimestamp,
        asset: lot.asset, rawMint: lot.rawMint || trade.rawMint, starbase: lot.starbase,
        wallet: trade.wallet, quantity: allocated, unitPriceAtlas: Number(trade.unitPriceAtlas),
        grossAtlas: Number(trade.grossAtlas || 0) * ratio,
        marketplaceFeeAtlas: Number(trade.marketplaceFeeAtlas || 0) * ratio,
        netAtlas: Number(trade.netAtlas ?? trade.settledAtlas ?? 0) * ratio,
        settledAtlas: Number(trade.settledAtlas ?? trade.netAtlas ?? 0) * ratio,
        custodySignature: lot.withdrawalFlowId,
        executionSignature: String(trade.signature || trade.id), orderId: String(trade.orderId || ''),
      });
      lot.quantity -= allocated;
      remaining -= allocated;
    }
  }
  return rows.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
}

function escapeInfluxTag(value) { return String(value ?? '').replace(/([ ,=])/g, '\\$1'); }
function escapeInfluxString(value) { return `"${String(value ?? '').replace(/(["\\])/g, '\\$1')}"`; }
function formatGmFactionMarketplaceTestLine(row) {
  const timestampMs = Date.parse(row?.timestamp);
  if (!Number.isFinite(timestampMs) || !(Number(row?.quantity) > 0) || !row?.id || !row?.faction) return '';
  const tags = {
    eventId: row.id, market: 'GM', faction: row.faction, profile: row.profile,
    side: row.side, asset: row.asset, rawMint: row.rawMint, starbase: row.starbase,
  };
  const tagText = Object.entries(tags).filter(([, value]) => String(value || '').trim())
    .map(([key, value]) => `${key}=${escapeInfluxTag(value)}`).join(',');
  const fields = [
    `quantity=${Number(row.quantity)}`, `basisAvailable=${row.basisAvailable !== false}`, `unitPriceAtlas=${Number(row.unitPriceAtlas)}`,
    `grossAtlas=${Number(row.grossAtlas || 0)}`, `marketplaceFeeAtlas=${Number(row.marketplaceFeeAtlas || 0)}`,
    `netAtlas=${Number(row.netAtlas || 0)}`, `settledAtlas=${Number(row.settledAtlas || 0)}`,
    `wallet=${escapeInfluxString(row.wallet)}`, `custodySignature=${escapeInfluxString(row.custodySignature)}`,
    `executionSignature=${escapeInfluxString(row.executionSignature || '')}`, `orderId=${escapeInfluxString(row.orderId || '')}`,
  ].join(',');
  return `marketplace_reconciliation_test_v1,${tagText} ${fields} ${BigInt(timestampMs) * 1000000n}`;
}

module.exports = {
  buildGmWalletUniverse,
  createStarbasePoolKey,
  calculateForwardStockpileAverage,
  applyForwardStockpileImputation,
  matchGmCustodyFlows,
  calculateGmWalletInventoryBasis,
  enrichGmTradesWithInventoryBasis,
  projectGmFactionMarketplaceRows,
  formatGmFactionMarketplaceTestLine,
};
