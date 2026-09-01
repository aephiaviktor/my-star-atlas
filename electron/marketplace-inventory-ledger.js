'use strict';

const { resolveBreakevenBasisAtOrBefore } = require('./breakeven-basis-state');

function text(value) { return String(value || '').trim(); }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : null; }
function poolKey(wallet, asset) { return `${text(wallet)}\n${text(asset)}`; }
function ledgerOrder(left, right) {
  const leftSlot = number(left?.slot);
  const rightSlot = number(right?.slot);
  if (leftSlot != null && rightSlot != null && leftSlot !== rightSlot) return leftSlot - rightSlot;
  const timeOrder = Date.parse(left?.timestamp) - Date.parse(right?.timestamp);
  if (timeOrder) return timeOrder;
  for (const field of ['outerIndex', 'innerIndex']) {
    const leftIndex = number(left?.[field]);
    const rightIndex = number(right?.[field]);
    if (leftIndex != null && rightIndex != null && leftIndex !== rightIndex) return leftIndex - rightIndex;
  }
  return text(left?.movementId).localeCompare(text(right?.movementId));
}
function emptyLot(quantity = 0) {
  return { quantity, principalAtlas: 0, marketplaceFeeAtlas: 0, transactionFeeAtlas: 0, gameOrigins: new Map() };
}
function basisAtlas(value) {
  return Number(value.principalAtlas || 0) + Number(value.marketplaceFeeAtlas || 0) + Number(value.transactionFeeAtlas || 0);
}
function copyOrigins(origins) {
  return [...(origins || new Map()).values()].map((origin) => ({ ...origin }))
    .sort((a, b) => text(a.movementId).localeCompare(text(b.movementId)));
}
function copyPool(pool) {
  const basis = basisAtlas(pool);
  return {
    quantity: pool.quantity,
    principalAtlas: pool.principalAtlas,
    marketplaceFeeAtlas: pool.marketplaceFeeAtlas,
    transactionFeeAtlas: pool.transactionFeeAtlas,
    basisAtlas: basis,
    averagePriceAtlas: pool.quantity > 0 ? basis / pool.quantity : null,
    gameOrigins: copyOrigins(pool.gameOrigins),
  };
}
function addOrigin(target, origin) {
  const id = text(origin?.movementId);
  if (!id || !(Number(origin?.quantity) > 0)) return;
  const current = target.get(id) || {
    movementId: id, faction: text(origin.faction), starbase: text(origin.starbase),
    signature: text(origin.signature), quantity: 0, principalAtlas: 0, marketplaceFeeAtlas: 0, transactionFeeAtlas: 0,
  };
  for (const field of ['quantity', 'principalAtlas', 'marketplaceFeeAtlas', 'transactionFeeAtlas']) {
    current[field] += Number(origin[field] || 0);
  }
  target.set(id, current);
}
function addFeeToLot(lot, fee) {
  const value = Math.max(0, number(fee) || 0);
  if (!(value > 0)) return lot;
  lot.transactionFeeAtlas += value;
  if (lot.gameOrigins.size) {
    for (const origin of lot.gameOrigins.values()) origin.transactionFeeAtlas += value * (origin.quantity / lot.quantity);
  }
  return lot;
}

function replayMarketplaceInventoryLedger(movements = []) {
  const pools = new Map();
  const gamePools = new Map();
  const rows = [];
  const seen = new Set();
  const ordered = [...movements].sort(ledgerOrder);

  const getPool = (wallet, asset) => {
    const key = poolKey(wallet, asset);
    if (!pools.has(key)) pools.set(key, { wallet: text(wallet), asset: text(asset), ...emptyLot() });
    return pools.get(key);
  };
  const getGamePool = (location, asset) => {
    const key = poolKey(location, asset);
    if (!gamePools.has(key)) gamePools.set(key, { location: text(location), asset: text(asset), ...emptyLot() });
    return gamePools.get(key);
  };
  const consumePool = (pool, quantity) => {
    if (!(quantity > 0) || pool.quantity + 1e-9 < quantity) return null;
    const ratio = pool.quantity > 0 ? quantity / pool.quantity : 0;
    const lot = emptyLot(quantity);
    for (const field of ['principalAtlas', 'marketplaceFeeAtlas', 'transactionFeeAtlas']) {
      lot[field] = pool[field] * ratio;
      pool[field] = Math.max(0, pool[field] - lot[field]);
    }
    for (const origin of pool.gameOrigins.values()) {
      const moved = { ...origin };
      for (const field of ['quantity', 'principalAtlas', 'marketplaceFeeAtlas', 'transactionFeeAtlas']) moved[field] *= ratio;
      addOrigin(lot.gameOrigins, moved);
      for (const field of ['quantity', 'principalAtlas', 'marketplaceFeeAtlas', 'transactionFeeAtlas']) {
        origin[field] = Math.max(0, origin[field] - moved[field]);
      }
      if (origin.quantity <= 1e-9) pool.gameOrigins.delete(origin.movementId);
    }
    pool.quantity = Math.max(0, pool.quantity - quantity);
    if (pool.quantity <= 1e-9) Object.assign(pool, emptyLot());
    return lot;
  };
  const consume = (wallet, asset, quantity) => consumePool(getPool(wallet, asset), quantity);
  const addPool = (pool, lot) => {
    pool.quantity += lot.quantity;
    for (const field of ['principalAtlas', 'marketplaceFeeAtlas', 'transactionFeeAtlas']) pool[field] += Number(lot[field] || 0);
    for (const origin of lot.gameOrigins.values()) addOrigin(pool.gameOrigins, origin);
    return pool;
  };
  const add = (wallet, asset, lot) => addPool(getPool(wallet, asset), lot);
  const consumeGame = (location, asset, quantity) => consumePool(getGamePool(location, asset), quantity);
  const addGame = (location, asset, lot) => addPool(getGamePool(location, asset), lot);
  const lotFields = (lot) => ({
    principalAtlas: lot.principalAtlas,
    marketplaceFeeAtlas: lot.marketplaceFeeAtlas,
    carriedMarketplaceFeeAtlas: lot.marketplaceFeeAtlas,
    transactionFeeAtlas: lot.transactionFeeAtlas,
    basisMovedAtlas: basisAtlas(lot),
    gameOrigins: copyOrigins(lot.gameOrigins),
  });

  for (const movement of ordered) {
    const movementId = text(movement.movementId);
    const kind = text(movement.kind);
    const asset = text(movement.asset);
    const quantity = number(movement.quantity);
    const parsedTimestamp = new Date(movement.timestamp);
    if (!movementId || seen.has(movementId) || !kind || !asset || !(quantity > 0) || Number.isNaN(parsedTimestamp.getTime())) continue;
    seen.add(movementId);
    const common = { movementId, timestamp: parsedTimestamp.toISOString(), slot: number(movement.slot),
      outerIndex: number(movement.outerIndex), innerIndex: number(movement.innerIndex), kind, asset, quantity,
      signature: text(movement.signature), status: 'applied' };
    if (kind === 'buy') {
      const wallet = text(movement.toWallet);
      const principal = number(movement.principalAtlas);
      if (!wallet || principal == null || principal < 0) { rows.push({ ...common, status: 'pending_basis' }); continue; }
      const lot = emptyLot(quantity);
      lot.principalAtlas = principal;
      // Marketplace BUY fees are seller-paid and never enter buyer inventory basis.
      addFeeToLot(lot, movement.transactionFeeAtlas);
      const after = add(wallet, asset, lot);
      rows.push({ ...common, toWallet: wallet, ...lotFields(lot), marketplaceFeeAtlas: 0, after: copyPool(after) });
      continue;
    }
    if (kind === 'withdraw') {
      const wallet = text(movement.toWallet);
      const gameLocation = `${text(movement.faction)}:${text(movement.starbase)}`;
      let lot = consumeGame(gameLocation, asset, quantity);
      let basisSource = lot ? 'game_pool' : text(movement.basisSource);
      if (!lot) {
        const unitBasis = number(movement.unitBasisAtlas);
        if (!wallet || unitBasis == null || unitBasis < 0) { rows.push({ ...common, status: 'pending_basis' }); continue; }
        lot = emptyLot(quantity);
        lot.principalAtlas = quantity * unitBasis;
      }
      addFeeToLot(lot, movement.transactionFeeAtlas);
      lot.gameOrigins = new Map();
      addOrigin(lot.gameOrigins, { movementId, faction: movement.faction, starbase: movement.starbase,
        signature: movement.signature, quantity, principalAtlas: lot.principalAtlas,
        marketplaceFeeAtlas: lot.marketplaceFeeAtlas, transactionFeeAtlas: lot.transactionFeeAtlas });
      const after = add(wallet, asset, lot);
      rows.push({ ...common, toWallet: wallet, ...lotFields(lot),
        unitBasisAtlas: quantity > 0 ? basisAtlas(lot) / quantity : null,
        basisSource, faction: text(movement.faction), starbase: text(movement.starbase), after: copyPool(after) });
      continue;
    }
    if (kind === 'transfer') {
      const fromWallet = text(movement.fromWallet);
      const toWallet = text(movement.toWallet);
      const lot = consume(fromWallet, asset, quantity);
      if (!fromWallet || !toWallet || lot == null) { rows.push({ ...common, fromWallet, toWallet, status: 'pending_inventory' }); continue; }
      const sourceLot = lotFields(lot);
      const payer = text(movement.transactionFeePayer);
      if (payer === fromWallet || payer === toWallet) addFeeToLot(lot, movement.transactionFeeAtlas);
      const after = add(toWallet, asset, lot);
      rows.push({ ...common, fromWallet, toWallet, ...lotFields(lot),
        sourcePrincipalAtlas: sourceLot.principalAtlas,
        sourceMarketplaceFeeAtlas: sourceLot.marketplaceFeeAtlas,
        sourceTransactionFeeAtlas: sourceLot.transactionFeeAtlas,
        sourceBasisMovedAtlas: sourceLot.basisMovedAtlas,
        after: copyPool(after) });
      continue;
    }
    if (kind === 'deposit') {
      const fromWallet = text(movement.fromWallet);
      const lot = consume(fromWallet, asset, quantity);
      if (!fromWallet || lot == null) { rows.push({ ...common, fromWallet, status: 'pending_inventory' }); continue; }
      if (text(movement.transactionFeePayer) === fromWallet) addFeeToLot(lot, movement.transactionFeeAtlas);
      const gameLocation = text(movement.destination) || `${text(movement.faction)}:${text(movement.starbase)}`;
      const gameAfter = addGame(gameLocation, asset, lot);
      rows.push({ ...common, fromWallet, ...lotFields(lot), unitBasisAtlas: basisAtlas(lot) / quantity,
        destination: text(movement.destination), faction: text(movement.faction), starbase: text(movement.starbase),
        basisHandoff: 'game', gameAfter: copyPool(gameAfter) });
      continue;
    }
    if (kind === 'sell') {
      const fromWallet = text(movement.fromWallet);
      const lot = consume(fromWallet, asset, quantity);
      const gross = number(movement.grossAtlas);
      if (!fromWallet || lot == null) { rows.push({ ...common, fromWallet, status: 'pending_inventory' }); continue; }
      if (gross == null || gross < 0) { add(fromWallet, asset, lot); rows.push({ ...common, fromWallet, status: 'pending_proceeds' }); continue; }
      const marketplaceFee = Math.max(0, number(movement.marketplaceFeeAtlas) || 0);
      const transactionFee = Math.max(0, number(movement.transactionFeeAtlas) || 0);
      const netProceedsAtlas = gross - marketplaceFee - transactionFee;
      rows.push({ ...common, fromWallet, ...lotFields(lot), marketplaceFeeAtlas: marketplaceFee,
        saleTransactionFeeAtlas: transactionFee, grossAtlas: gross, netProceedsAtlas,
        realizedProfitAtlas: netProceedsAtlas - basisAtlas(lot), after: copyPool(getPool(fromWallet, asset)) });
    }
  }
  return {
    rows,
    pools: [...pools.values()].map((pool) => ({ wallet: pool.wallet, asset: pool.asset, ...copyPool(pool) }))
      .sort((a, b) => a.wallet.localeCompare(b.wallet) || a.asset.localeCompare(b.asset)),
    gamePools: [...gamePools.values()].map((pool) => ({ location: pool.location, asset: pool.asset, ...copyPool(pool) }))
      .sort((a, b) => a.location.localeCompare(b.location) || a.asset.localeCompare(b.asset)),
  };
}

function eventQuantity(event) {
  const raw = number(event?.quantity ?? event?.quantityRaw);
  const decimals = Number(event?.decimals || 0);
  return raw != null && raw > 0 && Number.isInteger(decimals) && decimals > 0 ? raw / (10 ** decimals) : raw;
}

function inventoryBasisAtOrBefore(observations, event) {
  const timestamp = Date.parse(event?.timestamp);
  const faction = text(event?.faction).toUpperCase().replace(/^UST$/, 'USTUR');
  const starbase = text(event?.starbase);
  const asset = text(event?.asset);
  const candidates = (observations || []).filter((row) => text(row?.asset) === asset
    && Number.isFinite(Date.parse(row?.timestamp)) && Date.parse(row.timestamp) <= timestamp);
  const latest = (rows) => [...rows].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0] || null;
  return latest(candidates.filter((row) => text(row?.faction).toUpperCase().replace(/^UST$/, 'USTUR') === faction
      && text(row?.starbase) === starbase))
    || latest(candidates.filter((row) => text(row?.faction).toUpperCase().replace(/^UST$/, 'USTUR') === faction))
    || latest(candidates);
}

function buildMarketplaceInventoryMovements(events = [], {
  inventoryBasisObservations = [], breakevenBasisStates = [],
} = {}) {
  const rows = Array.from(events || []);
  const primarySignatures = new Set(rows.filter((event) => event?.action === 'execution'
      || ['deposit', 'withdraw'].includes(text(event?.eventType).toLowerCase()))
    .map((event) => text(event?.signature)).filter(Boolean));
  const ownedSeeds = new Set(rows.flatMap((event) => {
    if (event?.action === 'execution') return [text(event?.fromWallet)];
    if (text(event?.eventType).toLowerCase() === 'deposit') return [text(event?.fromWallet)];
    if (text(event?.eventType).toLowerCase() === 'withdraw') return [text(event?.toWallet)];
    return [];
  }).filter(Boolean));
  const transferEdges = rows.filter((event) => text(event?.eventType).toLowerCase() === 'transfer'
    && !primarySignatures.has(text(event?.signature)) && text(event?.fromWallet) && text(event?.toWallet)
    && text(event?.fromWallet) !== text(event?.toWallet));
  const neighbors = new Map();
  const connect = (left, right) => {
    if (!neighbors.has(left)) neighbors.set(left, new Set());
    neighbors.get(left).add(right);
  };
  for (const event of transferEdges) {
    const fromWallet = text(event.fromWallet);
    const toWallet = text(event.toWallet);
    connect(fromWallet, toWallet); connect(toWallet, fromWallet);
  }
  const ownedWallets = new Set(neighbors.keys());
  const queue = [...ownedWallets].filter((wallet) => !ownedSeeds.has(wallet) && (neighbors.get(wallet)?.size || 0) <= 1);
  while (queue.length) {
    const wallet = queue.pop();
    if (!ownedWallets.delete(wallet)) continue;
    for (const neighbor of neighbors.get(wallet) || []) {
      neighbors.get(neighbor)?.delete(wallet);
      if (ownedWallets.has(neighbor) && !ownedSeeds.has(neighbor) && (neighbors.get(neighbor)?.size || 0) <= 1) queue.push(neighbor);
    }
  }
  for (const wallet of ownedSeeds) ownedWallets.add(wallet);
  const movements = rows.flatMap((event) => {
    const movementId = text(event?.eventId);
    const timestamp = text(event?.timestamp);
    const signature = text(event?.signature);
    const eventType = text(event?.eventType).toLowerCase();
    const quantity = eventQuantity(event);
    const asset = text(event?.asset);
    if (!movementId || !timestamp || !signature || !asset || !(quantity > 0)) return [];
    const common = { movementId, timestamp, signature, slot: number(event?.slot),
      outerIndex: number(event?.outerIndex), innerIndex: number(event?.innerIndex), asset, quantity };
    if (event?.action === 'execution' && ['gm', 'lm'].includes(eventType)) {
      const wallet = text(event?.fromWallet);
      const transactionFeeAtlas = Math.max(0, number(event?.txFeeAtlas ?? event?.transactionFeeAtlas) || 0);
      if (!wallet) return [];
      if (event?.side === 'sell') return [{ ...common, kind: 'sell', fromWallet: wallet,
        grossAtlas: number(event?.grossAtlas), marketplaceFeeAtlas: Math.max(0, number(event?.marketplaceFeeAtlas) || 0),
        transactionFeeAtlas, marketplace: text(event?.market || eventType).toUpperCase(), faction: text(event?.faction) }];
      return [{ ...common, kind: 'buy', toWallet: wallet, principalAtlas: number(event?.grossAtlas),
        marketplaceFeeAtlas: 0, transactionFeeAtlas,
        marketplace: text(event?.market || eventType).toUpperCase(), faction: text(event?.faction) }];
    }
    if (eventType === 'transfer') {
      if (primarySignatures.has(signature)) return [];
      const fromWallet = text(event?.fromWallet);
      const toWallet = text(event?.toWallet);
      if (!fromWallet || !toWallet || fromWallet === toWallet || !ownedWallets.has(fromWallet) || !ownedWallets.has(toWallet)) return [];
      return [{ ...common, kind: 'transfer', fromWallet, toWallet,
        transactionFeeAtlas: Math.max(0, number(event?.transactionFeeAtlas) || 0),
        transactionFeePayer: text(event?.transactionFeePayer) }];
    }
    if (eventType === 'deposit') {
      const fromWallet = text(event?.fromWallet);
      if (!fromWallet) return [];
      return [{ ...common, kind: 'deposit', fromWallet, destination: `${text(event?.faction)}:${text(event?.starbase)}`,
        faction: text(event?.faction), starbase: text(event?.starbase),
        transactionFeeAtlas: Math.max(0, number(event?.transactionFeeAtlas) || 0),
        transactionFeePayer: text(event?.transactionFeePayer) }];
    }
    if (eventType === 'withdraw') {
      const toWallet = text(event?.toWallet);
      if (!toWallet) return [];
      const observation = inventoryBasisAtOrBefore(inventoryBasisObservations, event);
      const observationBasis = number(observation?.weightedAveragePriceAtlas);
      const historicalBasis = resolveBreakevenBasisAtOrBefore(breakevenBasisStates, event);
      const historicalUnitBasis = number(historicalBasis?.landedCostPerUnit);
      const unitBasisAtlas = observationBasis > 0 ? observationBasis : historicalUnitBasis;
      return [{ ...common, kind: 'withdraw', toWallet, unitBasisAtlas,
        basisSource: observationBasis > 0 ? 'inventory_basis_snapshot'
          : historicalUnitBasis != null ? 'breakeven_basis_state' : 'unavailable',
        faction: text(event?.faction), starbase: text(event?.starbase),
        transactionFeeAtlas: Math.max(0, number(event?.transactionFeeAtlas) || 0),
        transactionFeePayer: text(event?.transactionFeePayer) }];
    }
    return [];
  }).sort(ledgerOrder);
  const feeGroups = new Map();
  for (const movement of movements.filter((row) => ['transfer', 'deposit', 'withdraw'].includes(row.kind))) {
    if (!feeGroups.has(movement.signature)) feeGroups.set(movement.signature, []);
    feeGroups.get(movement.signature).push(movement);
  }
  for (const group of feeGroups.values()) {
    if (group.length <= 1) continue;
    const totalTransactionFee = Math.max(...group.map((movement) => Number(movement.transactionFeeAtlas || 0)));
    for (const movement of group) movement.transactionFeeAtlas = totalTransactionFee / group.length;
  }
  return movements;
}

function quantitiesDescribeSamePhysicalLot(left, right) {
  const leftQuantity = Number(left);
  const rightQuantity = Number(right);
  if (!(leftQuantity > 0) || !(rightQuantity > 0)) return false;
  return Math.abs(leftQuantity - rightQuantity) <= Math.max(1, Math.max(leftQuantity, rightQuantity) * 1e-9);
}

function directPhysicalWithdrawalsForSale(ledgerRows, sale, selectedFaction) {
  const ordered = [...(ledgerRows || [])].sort(ledgerOrder);
  let cursor = ordered.indexOf(sale);
  let wallet = text(sale?.fromWallet);
  let quantity = Number(sale?.quantity);
  for (let depth = 0; cursor > 0 && wallet && quantity > 0 && depth < 16; depth += 1) {
    let inbound = null;
    for (let index = cursor - 1; index >= 0; index -= 1) {
      const candidate = ordered[index];
      if (text(candidate?.asset) !== text(sale?.asset) || !quantitiesDescribeSamePhysicalLot(candidate?.quantity, quantity)) continue;
      const destination = candidate?.kind === 'buy' || candidate?.kind === 'withdraw'
        ? text(candidate?.toWallet) : candidate?.kind === 'transfer' ? text(candidate?.toWallet) : '';
      if (destination !== wallet) continue;
      inbound = { candidate, index };
      break;
    }
    if (!inbound) break;
    const { candidate, index } = inbound;
    if (candidate.kind === 'withdraw'
      && text(candidate.faction).toUpperCase().replace(/^UST$/, 'USTUR') === selectedFaction) {
      return [{ movementId: text(candidate.movementId), signature: text(candidate.signature),
        timestamp: text(candidate.timestamp), quantity: Number(candidate.quantity) }];
    }
    if (candidate.kind !== 'transfer') break;
    wallet = text(candidate.fromWallet);
    quantity = Number(candidate.quantity);
    cursor = index;
  }
  const origins = sale?.gameOrigins || [];
  const ids = [...new Set(origins.map((origin) => text(origin.movementId)).filter(Boolean))];
  if (ids.length !== 1) return [];
  const withdrawal = ordered.find((row) => row.kind === 'withdraw' && text(row.movementId) === ids[0]);
  return withdrawal ? [{ movementId: text(withdrawal.movementId), signature: text(withdrawal.signature),
    timestamp: text(withdrawal.timestamp), quantity: Number(withdrawal.quantity) }] : [];
}

function projectGameLedgerRows(ledgerRows = [], { faction = '' } = {}) {
  const selectedFaction = text(faction).toUpperCase().replace(/^UST$/, 'USTUR');
  const rows = [];
  const saleGroups = new Map();
  for (const row of ledgerRows || []) {
    if (row?.status !== 'applied') continue;
    if (row.kind === 'deposit' && text(row.faction).toUpperCase().replace(/^UST$/, 'USTUR') === selectedFaction) {
      rows.push({
        gameLedgerId: row.movementId, direction: 'deposit', timestamp: row.timestamp,
        physicalTimestamp: row.timestamp, faction: selectedFaction, starbase: text(row.starbase), asset: row.asset,
        quantity: row.quantity, principalAtlas: row.principalAtlas, carriedBasisAtlas: row.basisMovedAtlas,
        marketplaceFeeAtlas: row.marketplaceFeeAtlas, transactionFeeAtlas: row.transactionFeeAtlas,
        finalBasisAtlas: row.basisMovedAtlas, costPerUnitAtlas: row.quantity > 0 ? row.basisMovedAtlas / row.quantity : null,
        signature: row.signature, physicalSignature: row.signature, status: 'Complete',
      });
      continue;
    }
    if (row.kind !== 'sell' || !(row.quantity > 0)) continue;
    const origins = (row.gameOrigins || []).filter((origin) =>
      text(origin.faction).toUpperCase().replace(/^UST$/, 'USTUR') === selectedFaction && Number(origin.quantity) > 0);
    const originQuantity = origins.reduce((sum, origin) => sum + Number(origin.quantity || 0), 0);
    if (!(originQuantity > 0)) continue;
    const tolerance = Math.max(1e-6, Number(row.quantity) * 1e-12);
    const quantity = Math.abs(originQuantity - Number(row.quantity)) <= tolerance ? Number(row.quantity) : originQuantity;
    const ratio = quantity / Number(row.quantity);
    const signature = text(row.signature);
    const key = `${signature || text(row.movementId)}\n${text(row.asset)}\n${selectedFaction}`;
    if (!saleGroups.has(key)) saleGroups.set(key, {
      gameLedgerId: `${signature || text(row.movementId)}:${text(row.asset)}:${selectedFaction}`,
      direction: 'withdraw', timestamp: row.timestamp, faction: selectedFaction,
      starbase: text(origins[0]?.starbase), asset: row.asset, quantity: 0,
      principalAtlas: 0, carriedBasisAtlas: 0, marketplaceFeeAtlas: 0, transactionFeeAtlas: 0,
      grossAtlas: 0, netProceedsAtlas: 0, signature, status: 'Complete', physicalWithdrawals: new Map(),
    });
    const group = saleGroups.get(key);
    if (String(row.timestamp) > String(group.timestamp)) group.timestamp = row.timestamp;
    const carriedBasis = Number(row.basisMovedAtlas || 0) * ratio;
    group.quantity += quantity;
    // A completed weighted wallet lot becomes the Game principal. Historical
    // withdrawal origins remain provenance only and must not fragment economics.
    group.principalAtlas += carriedBasis;
    group.carriedBasisAtlas += carriedBasis;
    group.marketplaceFeeAtlas += Number(row.marketplaceFeeAtlas || 0) * ratio;
    group.transactionFeeAtlas += Number(row.saleTransactionFeeAtlas || 0) * ratio;
    group.grossAtlas += Number(row.grossAtlas || 0) * ratio;
    group.netProceedsAtlas += Number(row.netProceedsAtlas || 0) * ratio;
    for (const physical of directPhysicalWithdrawalsForSale(ledgerRows, row, selectedFaction)) {
      group.physicalWithdrawals.set(physical.movementId, physical);
    }
  }
  for (const group of saleGroups.values()) {
    group.finalBasisAtlas = group.principalAtlas + group.marketplaceFeeAtlas + group.transactionFeeAtlas;
    group.costPerUnitAtlas = group.quantity > 0 ? group.finalBasisAtlas / group.quantity : null;
    group.receivedPerUnitAtlas = group.quantity > 0 ? group.netProceedsAtlas / group.quantity : null;
    group.netProfitPerUnitAtlas = group.quantity > 0
      ? (group.netProceedsAtlas - group.finalBasisAtlas) / group.quantity : null;
    group.physicalWithdrawals = [...group.physicalWithdrawals.values()]
      .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp))
        || left.movementId.localeCompare(right.movementId));
    if (group.physicalWithdrawals.length === 1) {
      const [physical] = group.physicalWithdrawals;
      group.physicalWithdrawalId = physical.movementId;
      group.physicalWithdrawalSignature = physical.signature;
      group.physicalWithdrawalTimestamp = physical.timestamp;
    }
    rows.push(group);
  }
  return rows.sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp))
    || left.gameLedgerId.localeCompare(right.gameLedgerId));
}

function projectGlobalLedgerRows(ledgerRows = []) {
  const rows = [];
  const add = (row, direction, wallet, counterparty, values = {}) => {
    if (!text(wallet)) return;
    const principalAtlas = Number(values.principalAtlas ?? row.principalAtlas ?? 0);
    const marketplaceFeeAtlas = Number(values.marketplaceFeeAtlas ?? row.marketplaceFeeAtlas ?? 0);
    const transactionFeeAtlas = Number(values.transactionFeeAtlas ?? row.transactionFeeAtlas ?? 0);
    const finalBasisAtlas = Number(values.finalBasisAtlas ?? row.basisMovedAtlas ?? 0);
    rows.push({
      globalLedgerId: `${row.movementId}:${direction}:${wallet}`, movementId: row.movementId,
      timestamp: row.timestamp, direction, wallet: text(wallet), counterparty: text(counterparty),
      movementType: row.kind, asset: row.asset, quantity: row.quantity,
      principalAtlas, marketplaceFeeAtlas, transactionFeeAtlas, finalBasisAtlas,
      costPerUnitAtlas: row.quantity > 0 ? finalBasisAtlas / row.quantity : null,
      signature: row.signature, status: row.status === 'applied' ? 'Complete' : text(row.status),
    });
  };
  for (const row of ledgerRows || []) {
    if (row.kind === 'buy') add(row, 'deposit', row.toWallet, row.marketplace || 'Market');
    else if (row.kind === 'withdraw') add(row, 'deposit', row.toWallet, `${text(row.faction)}:${text(row.starbase)}`);
    else if (row.kind === 'transfer') {
      add(row, 'withdraw', row.fromWallet, row.toWallet, {
        principalAtlas: row.sourcePrincipalAtlas,
        marketplaceFeeAtlas: row.sourceMarketplaceFeeAtlas,
        transactionFeeAtlas: row.sourceTransactionFeeAtlas,
        finalBasisAtlas: row.sourceBasisMovedAtlas,
      });
      add(row, 'deposit', row.toWallet, row.fromWallet);
    } else if (row.kind === 'deposit') add(row, 'withdraw', row.fromWallet, row.destination);
    else if (row.kind === 'sell') add(row, 'withdraw', row.fromWallet, row.marketplace || 'Market', {
      principalAtlas: row.principalAtlas,
      marketplaceFeeAtlas: row.marketplaceFeeAtlas,
      transactionFeeAtlas: Number(row.transactionFeeAtlas || 0) + Number(row.saleTransactionFeeAtlas || 0),
      finalBasisAtlas: Number(row.basisMovedAtlas || 0) + Number(row.marketplaceFeeAtlas || 0) + Number(row.saleTransactionFeeAtlas || 0),
    });
  }
  return rows.sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp))
    || left.movementId.localeCompare(right.movementId)
    || Number(right.direction === 'withdraw') - Number(left.direction === 'withdraw')
    || left.globalLedgerId.localeCompare(right.globalLedgerId));
}

module.exports = {
  poolKey, buildMarketplaceInventoryMovements, replayMarketplaceInventoryLedger,
  projectGlobalLedgerRows, projectGameLedgerRows,
};
