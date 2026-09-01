'use strict';

function text(value) { return String(value || '').trim(); }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : null; }
function poolKey(wallet, asset) { return `${text(wallet)}\n${text(asset)}`; }
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
  const rows = [];
  const seen = new Set();
  const ordered = [...movements].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    || text(a.movementId).localeCompare(text(b.movementId)));

  const getPool = (wallet, asset) => {
    const key = poolKey(wallet, asset);
    if (!pools.has(key)) pools.set(key, { wallet: text(wallet), asset: text(asset), ...emptyLot() });
    return pools.get(key);
  };
  const consume = (wallet, asset, quantity) => {
    const pool = getPool(wallet, asset);
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
  const add = (wallet, asset, lot) => {
    const pool = getPool(wallet, asset);
    pool.quantity += lot.quantity;
    for (const field of ['principalAtlas', 'marketplaceFeeAtlas', 'transactionFeeAtlas']) pool[field] += Number(lot[field] || 0);
    for (const origin of lot.gameOrigins.values()) addOrigin(pool.gameOrigins, origin);
    return pool;
  };
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
    const common = { movementId, timestamp: parsedTimestamp.toISOString(), kind, asset, quantity,
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
      const unitBasis = number(movement.unitBasisAtlas);
      if (!wallet || unitBasis == null || unitBasis < 0) { rows.push({ ...common, status: 'pending_basis' }); continue; }
      const lot = emptyLot(quantity);
      lot.principalAtlas = quantity * unitBasis;
      addFeeToLot(lot, movement.transactionFeeAtlas);
      addOrigin(lot.gameOrigins, { movementId, faction: movement.faction, starbase: movement.starbase,
        signature: movement.signature, quantity, principalAtlas: quantity * unitBasis,
        transactionFeeAtlas: lot.transactionFeeAtlas });
      const after = add(wallet, asset, lot);
      rows.push({ ...common, toWallet: wallet, ...lotFields(lot), unitBasisAtlas: unitBasis,
        basisSource: text(movement.basisSource), after: copyPool(after) });
      continue;
    }
    if (kind === 'transfer') {
      const fromWallet = text(movement.fromWallet);
      const toWallet = text(movement.toWallet);
      const lot = consume(fromWallet, asset, quantity);
      if (!fromWallet || !toWallet || lot == null) { rows.push({ ...common, fromWallet, toWallet, status: 'pending_inventory' }); continue; }
      const payer = text(movement.transactionFeePayer);
      if (payer === fromWallet || payer === toWallet) addFeeToLot(lot, movement.transactionFeeAtlas);
      const after = add(toWallet, asset, lot);
      rows.push({ ...common, fromWallet, toWallet, ...lotFields(lot), after: copyPool(after) });
      continue;
    }
    if (kind === 'deposit') {
      const fromWallet = text(movement.fromWallet);
      const lot = consume(fromWallet, asset, quantity);
      if (!fromWallet || lot == null) { rows.push({ ...common, fromWallet, status: 'pending_inventory' }); continue; }
      if (text(movement.transactionFeePayer) === fromWallet) addFeeToLot(lot, movement.transactionFeeAtlas);
      rows.push({ ...common, fromWallet, ...lotFields(lot), unitBasisAtlas: basisAtlas(lot) / quantity,
        destination: text(movement.destination), faction: text(movement.faction), starbase: text(movement.starbase),
        basisHandoff: 'game' });
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

function buildMarketplaceInventoryMovements(events = [], { inventoryBasisObservations = [] } = {}) {
  const rows = Array.from(events || []);
  const primarySignatures = new Set(rows.filter((event) => event?.action === 'execution'
      || ['deposit', 'withdraw'].includes(text(event?.eventType).toLowerCase()))
    .map((event) => text(event?.signature)).filter(Boolean));
  return rows.flatMap((event) => {
    const movementId = text(event?.eventId);
    const timestamp = text(event?.timestamp);
    const signature = text(event?.signature);
    const eventType = text(event?.eventType).toLowerCase();
    const quantity = eventQuantity(event);
    const asset = text(event?.asset);
    if (!movementId || !timestamp || !signature || !asset || !(quantity > 0)) return [];
    const common = { movementId, timestamp, signature, asset, quantity };
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
      if (!fromWallet || !toWallet || fromWallet === toWallet) return [];
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
      const unitBasisAtlas = number(observation?.weightedAveragePriceAtlas);
      return [{ ...common, kind: 'withdraw', toWallet, unitBasisAtlas,
        basisSource: observation ? 'inventory_basis_snapshot' : 'unavailable',
        faction: text(event?.faction), starbase: text(event?.starbase),
        transactionFeeAtlas: Math.max(0, number(event?.transactionFeeAtlas) || 0),
        transactionFeePayer: text(event?.transactionFeePayer) }];
    }
    return [];
  }).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
    || left.movementId.localeCompare(right.movementId));
}

function projectGameLedgerRows(ledgerRows = [], { faction = '' } = {}) {
  const selectedFaction = text(faction).toUpperCase().replace(/^UST$/, 'USTUR');
  const rows = [];
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
    for (const origin of row.gameOrigins || []) {
      if (text(origin.faction).toUpperCase().replace(/^UST$/, 'USTUR') !== selectedFaction || !(origin.quantity > 0)) continue;
      const ratio = origin.quantity / row.quantity;
      const carriedBasis = basisAtlas(origin);
      const marketplaceFee = Number(row.marketplaceFeeAtlas || 0) * ratio;
      const saleTransactionFee = Number(row.saleTransactionFeeAtlas || 0) * ratio;
      const finalBasis = carriedBasis + marketplaceFee + saleTransactionFee;
      rows.push({
        gameLedgerId: `${row.movementId}:${origin.movementId}`, direction: 'withdraw', timestamp: row.timestamp,
        physicalWithdrawalTimestamp: '', faction: selectedFaction, starbase: text(origin.starbase), asset: row.asset,
        quantity: origin.quantity, principalAtlas: origin.principalAtlas, carriedBasisAtlas: carriedBasis,
        marketplaceFeeAtlas: marketplaceFee,
        transactionFeeAtlas: Number(origin.transactionFeeAtlas || 0) + saleTransactionFee,
        finalBasisAtlas: finalBasis, costPerUnitAtlas: origin.quantity > 0 ? finalBasis / origin.quantity : null,
        grossAtlas: Number(row.grossAtlas || 0) * ratio, netProceedsAtlas: Number(row.netProceedsAtlas || 0) * ratio,
        signature: row.signature, physicalWithdrawalSignature: text(origin.signature),
        physicalWithdrawalId: text(origin.movementId), status: 'Complete',
      });
    }
  }
  const physicalTimes = new Map((ledgerRows || []).filter((row) => row.kind === 'withdraw')
    .map((row) => [text(row.movementId), text(row.timestamp)]));
  for (const row of rows) {
    if (row.direction === 'withdraw') row.physicalWithdrawalTimestamp = physicalTimes.get(row.physicalWithdrawalId) || '';
  }
  return rows.sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp))
    || left.gameLedgerId.localeCompare(right.gameLedgerId));
}

module.exports = {
  poolKey, buildMarketplaceInventoryMovements, replayMarketplaceInventoryLedger, projectGameLedgerRows,
};
