'use strict';

function text(value) { return String(value || '').trim(); }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : null; }
function poolKey(wallet, asset) { return `${text(wallet)}\n${text(asset)}`; }
function copyPool(pool) { return { quantity: pool.quantity, basisAtlas: pool.basisAtlas, averagePriceAtlas: pool.quantity > 0 ? pool.basisAtlas / pool.quantity : null }; }

function replayMarketplaceInventoryLedger(movements = []) {
  const pools = new Map();
  const rows = [];
  const seen = new Set();
  const ordered = [...movements].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    || text(a.movementId).localeCompare(text(b.movementId)));

  const getPool = (wallet, asset) => {
    const key = poolKey(wallet, asset);
    if (!pools.has(key)) pools.set(key, { wallet: text(wallet), asset: text(asset), quantity: 0, basisAtlas: 0 });
    return pools.get(key);
  };
  const consume = (wallet, asset, quantity) => {
    const pool = getPool(wallet, asset);
    if (!(quantity > 0) || pool.quantity + 1e-9 < quantity) return null;
    const basisAtlas = pool.quantity > 0 ? pool.basisAtlas * (quantity / pool.quantity) : 0;
    pool.quantity = Math.max(0, pool.quantity - quantity);
    pool.basisAtlas = Math.max(0, pool.basisAtlas - basisAtlas);
    if (pool.quantity <= 1e-9) { pool.quantity = 0; pool.basisAtlas = 0; }
    return basisAtlas;
  };
  const add = (wallet, asset, quantity, basisAtlas) => {
    const pool = getPool(wallet, asset);
    pool.quantity += quantity;
    pool.basisAtlas += basisAtlas;
    return pool;
  };

  for (const movement of ordered) {
    const movementId = text(movement.movementId);
    const kind = text(movement.kind);
    const asset = text(movement.asset);
    const quantity = number(movement.quantity);
    if (!movementId || seen.has(movementId) || !kind || !asset || !(quantity > 0)) continue;
    seen.add(movementId);
    const common = { movementId, timestamp: new Date(movement.timestamp).toISOString(), kind, asset, quantity,
      signature: text(movement.signature), status: 'applied' };
    if (kind === 'buy') {
      const wallet = text(movement.toWallet);
      const principal = number(movement.principalAtlas);
      const transactionFee = Math.max(0, number(movement.transactionFeeAtlas) || 0);
      if (!wallet || principal == null || principal < 0) { rows.push({ ...common, status: 'pending_basis' }); continue; }
      const basisMovedAtlas = principal + transactionFee;
      const after = add(wallet, asset, quantity, basisMovedAtlas);
      rows.push({ ...common, toWallet: wallet, basisMovedAtlas, transactionFeeAtlas: transactionFee, after: copyPool(after) });
      continue;
    }
    if (kind === 'withdraw') {
      const wallet = text(movement.toWallet);
      const unitBasis = number(movement.unitBasisAtlas);
      const transactionFee = Math.max(0, number(movement.transactionFeeAtlas) || 0);
      if (!wallet || unitBasis == null || unitBasis < 0) { rows.push({ ...common, status: 'pending_basis' }); continue; }
      const basisMovedAtlas = quantity * unitBasis + transactionFee;
      const after = add(wallet, asset, quantity, basisMovedAtlas);
      rows.push({ ...common, toWallet: wallet, basisMovedAtlas, unitBasisAtlas: unitBasis,
        basisSource: text(movement.basisSource), transactionFeeAtlas: transactionFee, after: copyPool(after) });
      continue;
    }
    if (kind === 'transfer') {
      const fromWallet = text(movement.fromWallet);
      const toWallet = text(movement.toWallet);
      const transactionFee = Math.max(0, number(movement.transactionFeeAtlas) || 0);
      const basis = consume(fromWallet, asset, quantity);
      if (!fromWallet || !toWallet || basis == null) { rows.push({ ...common, fromWallet, toWallet, status: 'pending_inventory' }); continue; }
      const feeCarried = text(movement.transactionFeePayer) === fromWallet ? transactionFee : 0;
      const after = add(toWallet, asset, quantity, basis + feeCarried);
      rows.push({ ...common, fromWallet, toWallet, basisMovedAtlas: basis + feeCarried,
        transactionFeeAtlas: feeCarried, after: copyPool(after) });
      continue;
    }
    if (kind === 'deposit') {
      const fromWallet = text(movement.fromWallet);
      const basis = consume(fromWallet, asset, quantity);
      if (!fromWallet || basis == null) { rows.push({ ...common, fromWallet, status: 'pending_inventory' }); continue; }
      rows.push({ ...common, fromWallet, basisMovedAtlas: basis, unitBasisAtlas: basis / quantity,
        destination: text(movement.destination), basisHandoff: 'game' });
      continue;
    }
    if (kind === 'sell') {
      const fromWallet = text(movement.fromWallet);
      const basis = consume(fromWallet, asset, quantity);
      const gross = number(movement.grossAtlas);
      if (!fromWallet || basis == null) { rows.push({ ...common, fromWallet, status: 'pending_inventory' }); continue; }
      if (gross == null || gross < 0) { add(fromWallet, asset, quantity, basis); rows.push({ ...common, fromWallet, status: 'pending_proceeds' }); continue; }
      const marketplaceFee = Math.max(0, number(movement.marketplaceFeeAtlas) || 0);
      const transactionFee = Math.max(0, number(movement.transactionFeeAtlas) || 0);
      const netProceedsAtlas = gross - marketplaceFee - transactionFee;
      rows.push({ ...common, fromWallet, basisMovedAtlas: basis, grossAtlas: gross, marketplaceFeeAtlas: marketplaceFee,
        transactionFeeAtlas: transactionFee, netProceedsAtlas, realizedProfitAtlas: netProceedsAtlas - basis,
        after: copyPool(getPool(fromWallet, asset)) });
    }
  }
  return {
    rows,
    pools: [...pools.values()].map((pool) => ({ wallet: pool.wallet, asset: pool.asset, ...copyPool(pool) }))
      .sort((a, b) => a.wallet.localeCompare(b.wallet) || a.asset.localeCompare(b.asset)),
  };
}

module.exports = { poolKey, replayMarketplaceInventoryLedger };
