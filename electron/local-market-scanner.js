'use strict';

const crypto = require('crypto');
const bs58Module = require('bs58');
const { decodeLocalMarketTrade } = require('./local-market-trades');
const { isMarketplaceRpcBudgetExhaustedError } = require('./marketplace-rpc-telemetry');
const { recordTelemetryCounter } = require('./telemetry-context');

const bs58 = bs58Module.default || bs58Module;
const DEFAULT_START_ISO = '2026-07-24T00:00:00.000Z';
const MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_REQUESTS_PER_SECOND = 8;
const MAX_SIGNATURE_PAGES = 20;
const GM_PROGRAM_ID = 'traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg';

function resolveLocalMarketStartIso(now = Date.now()) {
  const anchorMs = Date.parse(DEFAULT_START_ISO);
  if (!Number.isFinite(anchorMs)) return DEFAULT_START_ISO;
  const cutoffMs = Number.isFinite(now) ? now - MAX_LOOKBACK_MS : anchorMs;
  return new Date(Math.max(anchorMs, cutoffMs)).toISOString();
}

function createLocalMarketPacer(requestsPerSecond = DEFAULT_REQUESTS_PER_SECOND) {
  const intervalMs = Math.max(1, Math.round(1000 / Math.max(1, requestsPerSecond)));
  let nextReleaseAt = 0;
  return async function pace() {
    const now = Date.now();
    const wait = Math.max(0, nextReleaseAt - now);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    nextReleaseAt = Date.now() + intervalMs;
  };
}

function discriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

const INITIALIZE_BUY = discriminator('process_initialize_buy');
const INITIALIZE_SELL = discriminator('process_initialize_sell');
const EXCHANGE = discriminator('process_exchange');

function keyText(value) {
  return String(value?.pubkey ?? value ?? '');
}

function instructionAccounts(instruction, messageKeys) {
  return (instruction?.accounts || []).map((value) => typeof value === 'number' ? keyText(messageKeys[value]) : keyText(value));
}

function decodeInstructionData(instruction) {
  try {
    return Buffer.from(bs58.decode(String(instruction?.data || '')));
  } catch (_error) {
    return Buffer.alloc(0);
  }
}

function readU64(buffer, offset) {
  return buffer.length >= offset + 8 ? Number(buffer.readBigUInt64LE(offset)) : null;
}

function gmInstructions(transaction) {
  const message = transaction?.transaction?.message || {};
  const keys = message.accountKeys || [];
  return (message.instructions || []).filter((instruction) => keyText(instruction?.programId || keys[instruction?.programIdIndex]) === GM_PROGRAM_ID)
    .map((instruction) => ({ instruction, accounts: instructionAccounts(instruction, keys), data: decodeInstructionData(instruction) }));
}

function decodeLocalMarketOrder(transaction, { trackedWallets = [], marketAssetsByMint = {}, atlasPerSol } = {}) {
  const tracked = new Set(trackedWallets.map(String));
  const signature = String(transaction?.signature || transaction?.transaction?.signatures?.[0] || '');
  const timestamp = new Date(Number(transaction?.blockTime) * 1000);
  if (!signature || Number.isNaN(timestamp.getTime()) || transaction?.meta?.err) return null;
  for (const { accounts, data } of gmInstructions(transaction)) {
    const side = data.subarray(0, 8).equals(INITIALIZE_BUY) ? 'buy' : data.subarray(0, 8).equals(INITIALIZE_SELL) ? 'sell' : '';
    if (!side || accounts.length < 9 || !tracked.has(accounts[0])) continue;
    const certificateMint = side === 'sell' ? accounts[2] : accounts[3];
    const currencyMint = side === 'sell' ? accounts[3] : accounts[2];
    const context = marketAssetsByMint[certificateMint];
    if (!context || (context.marketplace === 'GM' && currencyMint !== context.quoteMint)) continue;
    const priceRaw = readU64(data, 8);
    const originalQuantity = readU64(data, 16);
    if (!(priceRaw >= 0) || !(originalQuantity > 0)) continue;
    const creationTxFeeSol = Number(transaction?.meta?.fee || 0) / 1e9;
    return {
      orderId: accounts[8], side, initializer: accounts[0], certificateMint,
      rawMint: String(context.rawMint || certificateMint), starbase: String(context.starbase || ''), asset: String(context.asset || ''),
      marketplace: String(context.marketplace || 'LM'), quoteMint: currencyMint,
      originalQuantity, priceAtlas: priceRaw / 1e8, createdAt: timestamp.toISOString(), creationSignature: signature,
      creationTxFeeSol: Number.isFinite(creationTxFeeSol) && creationTxFeeSol > 0 ? creationTxFeeSol : 0,
      creationTxFeeAtlas: computeTxFeeAtlas(transaction, atlasPerSol),
    };
  }
  return null;
}

function parseExchangeAmounts(logMessages) {
  let quantity = null;
  let marketplaceFeeAtlas = 0;
  let transferAtlas = null;
  for (const line of logMessages || []) {
    const values = String(line).match(/purchase_quantity:\s*(\d+),\s*royalty:\s*(\d+),\s*transfer_amount:\s*(\d+)/);
    if (values) {
      quantity = Number(values[1]);
      marketplaceFeeAtlas = Number(values[2]) / 1e8;
      transferAtlas = Number(values[3]) / 1e8;
    }
  }
  return { quantity, marketplaceFeeAtlas, transferAtlas };
}

function computeTxFeeAtlas(transaction, atlasPerSol) {
  const lamports = Number(transaction?.meta?.fee);
  if (!Number.isFinite(lamports) || lamports <= 0) return 0;
  if (!Number.isFinite(atlasPerSol) || atlasPerSol <= 0) return 0;
  return (lamports / 1e9) * atlasPerSol;
}

function decodeOrderExecution(transaction, ordersById, trackedWallets = [], { atlasPerSol } = {}) {
  const signature = String(transaction?.signature || transaction?.transaction?.signatures?.[0] || '');
  const timestamp = new Date(Number(transaction?.blockTime) * 1000);
  if (!signature || Number.isNaN(timestamp.getTime()) || transaction?.meta?.err) return null;
  const tracked = new Set(trackedWallets.map(String));
  for (const { accounts, data } of gmInstructions(transaction)) {
    if (!data.subarray(0, 8).equals(EXCHANGE) || accounts.length < 11) continue;
    const order = ordersById.get(accounts[10]);
    if (!order) continue;
    const instructionQuantity = readU64(data, 8);
    const expectedPriceRaw = readU64(data, 16);
    const logAmounts = parseExchangeAmounts(transaction.meta?.logMessages);
    const quantity = logAmounts.quantity > 0 ? logAmounts.quantity : instructionQuantity;
    const unitPriceAtlas = expectedPriceRaw >= 0 ? expectedPriceRaw / 1e8 : Number(order.priceAtlas);
    if (!(quantity > 0) || !(unitPriceAtlas >= 0)) continue;
    const grossAtlas = quantity * unitPriceAtlas;
    const marketplaceFeeAtlas = Number(logAmounts.marketplaceFeeAtlas || 0);
    const feePayer = keyText(transaction.transaction?.message?.accountKeys?.[0]);
    const executionTxFeeAtlas = tracked.has(feePayer) ? computeTxFeeAtlas(transaction, atlasPerSol) : 0;
    const originalQuantity = Number(order.originalQuantity);
    const allocatedCreationTxFeeAtlas = Number.isFinite(originalQuantity) && originalQuantity > 0
      ? Number(order.creationTxFeeAtlas || 0) * Math.min(1, quantity / originalQuantity)
      : Number(order.creationTxFeeAtlas || 0);
    const txFeeAtlas = executionTxFeeAtlas + allocatedCreationTxFeeAtlas;
    const netAtlas = order.side === 'sell'
      ? Math.max(0, logAmounts.transferAtlas ?? (grossAtlas - marketplaceFeeAtlas)) - txFeeAtlas
      : grossAtlas + marketplaceFeeAtlas + txFeeAtlas;
    return {
      id: `${signature}:${order.orderId}`, signature, timestamp: timestamp.toISOString(), marketplace: String(order.marketplace || 'LM'),
      side: order.side, orderId: order.orderId, wallet: order.initializer, starbase: order.starbase, asset: order.asset,
      rawMint: order.rawMint, certificateMint: order.certificateMint, quantity, settledAtlas: netAtlas,
      grossAtlas, marketplaceFeeAtlas, txFeeAtlas, executionTxFeeAtlas, allocatedCreationTxFeeAtlas,
      creationSignature: order.creationSignature || '', netAtlas, unitPriceAtlas,
    };
  }
  return null;
}

async function collectSignatures(connection, addresses, startMs, addressFactory, maxPages, pacer, stats, cursors = {}) {
  const signatures = new Map();
  const nextCursors = { ...cursors };
  for (const address of Array.from(new Set(addresses.map(String).filter(Boolean)))) {
    let before;
    const until = String(cursors[address] || '');
    if (until) recordTelemetryCounter('cursorResumes');
    let newestSignature = '';
    for (let page = 0; page < maxPages; page += 1) {
      if (pacer) await pacer();
      let rows;
      try {
        rows = await connection.getSignaturesForAddress(addressFactory(address), {
          limit: 1000,
          ...(before ? { before } : {}),
          ...(until ? { until } : {}),
        }, 'confirmed');
      } catch (error) {
        if (!isMarketplaceRpcBudgetExhaustedError(error)) throw error;
        return { signatures, cursors: { ...cursors }, exhaustion: error };
      }
      if (stats) stats.signatureRequests += 1;
      if (!newestSignature && rows?.[0]?.signature) newestSignature = String(rows[0].signature);
      let reachedStart = false;
      for (const row of rows || []) {
        const timestampMs = Number(row.blockTime) * 1000;
        if (Number.isFinite(timestampMs) && timestampMs < startMs) { reachedStart = true; continue; }
        if (!row.err && row.signature) {
          if (signatures.has(row.signature)) recordTelemetryCounter('preventedDuplicates');
          signatures.set(row.signature, row);
        }
      }
      if (reachedStart || !rows?.length || rows.length < 1000) break;
      before = rows[rows.length - 1]?.signature;
      if (!before) break;
    }
    if (newestSignature) nextCursors[address] = newestSignature;
  }
  return { signatures, cursors: nextCursors };
}

async function fetchTransactions(connection, rows, pacer, stats, batchSize = 1) {
  const ordered = Array.from(rows.values()).sort((a, b) => Number(a.blockTime || 0) - Number(b.blockTime || 0));
  const transactions = [];
  const resolvedBatchSize = Math.max(1, Math.min(10, Math.floor(Number(batchSize) || 1)));
  if (resolvedBatchSize > 1 && typeof connection.getParsedTransactions === 'function') {
    for (let offset = 0; offset < ordered.length; offset += resolvedBatchSize) {
      const chunk = ordered.slice(offset, offset + resolvedBatchSize);
      if (pacer) await pacer();
      let decoded;
      try {
        decoded = await connection.getParsedTransactions(chunk.map((row) => String(row.signature)), {
          commitment: 'confirmed', maxSupportedTransactionVersion: 0,
        });
      } catch (error) {
        if (isMarketplaceRpcBudgetExhaustedError(error)) { transactions.exhaustion = error; break; }
        decoded = null; // Provider rejected the micro-batch; retry this chunk safely as singles.
      }
      if (decoded) {
        if (stats) stats.transactionRequests += 1;
        for (let index = 0; index < chunk.length; index += 1) {
          const transaction = decoded[index];
          if (transaction) transactions.push({ ...transaction, signature: String(chunk[index].signature), blockTime: transaction.blockTime ?? chunk[index].blockTime });
          else { if (stats) stats.transactionMisses += 1; recordTelemetryCounter('transactionMisses'); }
        }
        continue;
      }
      const fallback = await fetchTransactions(connection, new Map(chunk.map((row) => [row.signature, row])), pacer, stats, 1);
      transactions.push(...fallback);
      if (fallback.exhaustion) { transactions.exhaustion = fallback.exhaustion; break; }
    }
    return transactions;
  }
  for (const row of ordered) {
    if (pacer) await pacer();
    const signature = String(row.signature);
    let transaction;
    try {
      transaction = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    } catch (error) {
      if (!isMarketplaceRpcBudgetExhaustedError(error)) throw error;
      transactions.exhaustion = error;
      break;
    }
    if (stats) stats.transactionRequests += 1;
    if (transaction) transactions.push({ ...transaction, signature, blockTime: transaction.blockTime ?? row.blockTime });
    else {
      if (stats) stats.transactionMisses += 1;
      recordTelemetryCounter('transactionMisses');
    }
  }
  return transactions;
}

async function scanLocalMarketTrades(connection, {
  trackedWallets = [], executionWallets = trackedWallets, marketAssetsByMint = {}, knownOrders = [], startIso,
  walletCursors = {}, orderCursors = {}, activeOrderIds = [], archivedOrderIds = [], openOrderIds = [],
  historicalOrderIds = [],
  addressFactory = (value) => value, maxPages = MAX_SIGNATURE_PAGES,
  requestsPerSecond = DEFAULT_REQUESTS_PER_SECOND,
  transactionBatchSize = 1,
  atlasPerSol, decodeAssetFlows,
} = {}) {
  const resolvedStartIso = startIso ?? resolveLocalMarketStartIso();
  const startMs = Date.parse(resolvedStartIso);
  if (!Number.isFinite(startMs)) throw new Error('local market startIso is invalid');
  const pacer = createLocalMarketPacer(requestsPerSecond);
  const stats = { signatureRequests: 0, transactionRequests: 0, transactionMisses: 0 };
  const ordersById = new Map((knownOrders || []).filter((row) => row?.orderId).map((row) => [String(row.orderId), row]));
  const archived = new Set((archivedOrderIds || []).map(String));
  const open = new Set((openOrderIds || []).map(String));
  const partialResult = (transactions, exhaustion) => {
    const tradesById = new Map();
    const assetFlowsById = new Map();
    for (const transaction of transactions || []) {
      const order = decodeLocalMarketOrder(transaction, { trackedWallets: executionWallets, marketAssetsByMint, atlasPerSol });
      if (order) ordersById.set(order.orderId, order);
      const execution = decodeOrderExecution(transaction, ordersById, executionWallets, { atlasPerSol })
        || decodeLocalMarketTrade(transaction, { trackedWallets: executionWallets, marketAssetsByMint });
      if (execution) tradesById.set(execution.id, execution);
      if (decodeAssetFlows) {
        for (const flow of decodeAssetFlows(transaction) || []) if (flow?.id) assetFlowsById.set(flow.id, flow);
      }
    }
    return {
      orders: Array.from(ordersById.values()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.orderId.localeCompare(b.orderId)),
      trades: Array.from(tradesById.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)),
      assetFlows: Array.from(assetFlowsById.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)),
      walletCursors: { ...walletCursors }, orderCursors: { ...orderCursors },
      activeOrderIds: Array.from(activeOrderIds || []), archivedOrderIds: Array.from(archivedOrderIds || []),
      stats: { ...stats, totalRpcRequests: stats.signatureRequests + stats.transactionRequests },
      exhaustion,
    };
  };
  for (const orderId of open) archived.delete(orderId);
  const hasLifecycleCheckpoint = (activeOrderIds || []).length > 0
    || (archivedOrderIds || []).length > 0
    || Object.keys(orderCursors || {}).length > 0;
  if (!hasLifecycleCheckpoint) {
    // Schema-v1 migration: old checkpoints retained every historical order.
    // Their executions are already in `trades`, so archive closed IDs without
    // issuing one final RPC request for every lifetime order.
    for (const orderId of ordersById.keys()) {
      if (!open.has(orderId)) archived.add(orderId);
    }
  }
  // Checkpoints written before creation-fee tracking already contain the
  // initialization signature. Fetch each missing creation tx once, enrich
  // the order, and persist it through the returned orders array.
  for (const order of ordersById.values()) {
    if (order.creationTxFeeAtlas != null || !order.creationSignature) continue;
    if (pacer) await pacer();
    let transaction;
    try {
      transaction = await connection.getParsedTransaction(order.creationSignature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    } catch (error) {
      if (!isMarketplaceRpcBudgetExhaustedError(error)) throw error;
      return partialResult([], error);
    }
    stats.transactionRequests += 1;
    if (!transaction) { stats.transactionMisses += 1; recordTelemetryCounter('transactionMisses'); continue; }
    const enriched = decodeLocalMarketOrder({ ...transaction, signature: order.creationSignature }, { trackedWallets: executionWallets, marketAssetsByMint, atlasPerSol });
    if (enriched) ordersById.set(enriched.orderId, enriched);
  }
  const walletScan = await collectSignatures(connection, trackedWallets, startMs, addressFactory, maxPages, pacer, stats, walletCursors);
  if (walletScan.exhaustion) return partialResult([], walletScan.exhaustion);
  const walletTransactions = await fetchTransactions(connection, walletScan.signatures, pacer, stats, transactionBatchSize);
  if (walletTransactions.exhaustion) return partialResult(walletTransactions, walletTransactions.exhaustion);
  const discoveredOrderIds = new Set();
  for (const transaction of walletTransactions) {
    const order = decodeLocalMarketOrder(transaction, { trackedWallets: executionWallets, marketAssetsByMint, atlasPerSol });
    if (order) {
      ordersById.set(order.orderId, order);
      discoveredOrderIds.add(order.orderId);
      archived.delete(order.orderId);
    }
  }
  const candidateOrderIds = new Set([
    ...(activeOrderIds || []).map(String),
    ...open,
    ...discoveredOrderIds,
    ...(historicalOrderIds || []).map(String),
  ]);
  for (const orderId of archived) candidateOrderIds.delete(orderId);
  const orderScan = await collectSignatures(
    connection, Array.from(candidateOrderIds), startMs, addressFactory, maxPages, pacer, stats, orderCursors,
  );
  if (orderScan.exhaustion) return partialResult(walletTransactions, orderScan.exhaustion);
  const newOrderSignatures = new Map(Array.from(orderScan.signatures).filter(([signature]) => !walletScan.signatures.has(signature)));
  const orderTransactions = await fetchTransactions(connection, newOrderSignatures, pacer, stats, transactionBatchSize);
  const transactions = walletTransactions.concat(orderTransactions);
  if (orderTransactions.exhaustion) return partialResult(transactions, orderTransactions.exhaustion);
  for (const transaction of transactions) {
    const order = decodeLocalMarketOrder(transaction, { trackedWallets: executionWallets, marketAssetsByMint, atlasPerSol });
    if (order) ordersById.set(order.orderId, order);
  }
  const tradesById = new Map();
  const assetFlowsById = new Map();
  for (const transaction of transactions) {
    const execution = decodeOrderExecution(transaction, ordersById, executionWallets, { atlasPerSol })
      || decodeLocalMarketTrade(transaction, { trackedWallets: executionWallets, marketAssetsByMint });
    if (execution) tradesById.set(execution.id, execution);
    if (decodeAssetFlows) {
      for (const flow of decodeAssetFlows(transaction) || []) if (flow?.id) assetFlowsById.set(flow.id, flow);
    }
  }
  const pendingFinalization = new Set();
  for (const orderId of candidateOrderIds) {
    if (!open.has(orderId)) {
      if (stats.transactionMisses > 0) pendingFinalization.add(orderId);
      else archived.add(orderId);
    }
  }
  const active = Array.from(new Set([...open, ...pendingFinalization])).sort();
  const nextOrderCursors = {};
  for (const orderId of active) {
    const cursor = pendingFinalization.has(orderId)
      ? orderCursors[orderId]
      : (orderScan.cursors[orderId] || orderCursors[orderId] || ordersById.get(orderId)?.creationSignature);
    if (cursor) nextOrderCursors[orderId] = cursor;
  }
  return {
    orders: Array.from(ordersById.values()).filter((order) => !archived.has(String(order.orderId)))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.orderId.localeCompare(b.orderId)),
    trades: Array.from(tradesById.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)),
    assetFlows: Array.from(assetFlowsById.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)),
    walletCursors: stats.transactionMisses > 0 ? { ...walletCursors } : walletScan.cursors,
    orderCursors: nextOrderCursors,
    activeOrderIds: active,
    archivedOrderIds: Array.from(archived).sort(),
    stats: { ...stats, totalRpcRequests: stats.signatureRequests + stats.transactionRequests },
  };
}

module.exports = {
  DEFAULT_START_ISO, MAX_LOOKBACK_MS, DEFAULT_REQUESTS_PER_SECOND,
  resolveLocalMarketStartIso, createLocalMarketPacer,
  scanLocalMarketTrades, decodeLocalMarketOrder, decodeOrderExecution, computeTxFeeAtlas, fetchTransactions,
};
