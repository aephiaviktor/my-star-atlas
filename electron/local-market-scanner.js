'use strict';

const crypto = require('crypto');
const bs58Module = require('bs58');
const { decodeLocalMarketTrade } = require('./local-market-trades');

const bs58 = bs58Module.default || bs58Module;
const DEFAULT_START_ISO = '2026-07-24T00:00:00.000Z';
const MAX_SIGNATURE_PAGES = 20;
const GM_PROGRAM_ID = 'traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg';

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

function decodeLocalMarketOrder(transaction, { trackedWallets = [], marketAssetsByMint = {} } = {}) {
  const tracked = new Set(trackedWallets.map(String));
  const signature = String(transaction?.signature || transaction?.transaction?.signatures?.[0] || '');
  const timestamp = new Date(Number(transaction?.blockTime) * 1000);
  if (!signature || Number.isNaN(timestamp.getTime()) || transaction?.meta?.err) return null;
  for (const { accounts, data } of gmInstructions(transaction)) {
    const side = data.subarray(0, 8).equals(INITIALIZE_BUY) ? 'buy' : data.subarray(0, 8).equals(INITIALIZE_SELL) ? 'sell' : '';
    if (!side || accounts.length < 9 || !tracked.has(accounts[0])) continue;
    const certificateMint = side === 'sell' ? accounts[2] : accounts[3];
    const context = marketAssetsByMint[certificateMint];
    if (!context) continue;
    const priceRaw = readU64(data, 8);
    const originalQuantity = readU64(data, 16);
    if (!(priceRaw >= 0) || !(originalQuantity > 0)) continue;
    return {
      orderId: accounts[8], side, initializer: accounts[0], certificateMint,
      rawMint: String(context.rawMint || certificateMint), starbase: String(context.starbase || ''), asset: String(context.asset || ''),
      originalQuantity, priceAtlas: priceRaw / 1e8, createdAt: timestamp.toISOString(), creationSignature: signature,
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

function decodeOrderExecution(transaction, ordersById, trackedWallets = []) {
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
    const txFeeAtlas = tracked.has(feePayer) ? Number(transaction.meta?.fee || 0) / 1e9 : 0;
    const netAtlas = order.side === 'sell'
      ? Math.max(0, logAmounts.transferAtlas ?? (grossAtlas - marketplaceFeeAtlas)) - txFeeAtlas
      : grossAtlas + marketplaceFeeAtlas + txFeeAtlas;
    return {
      id: `${signature}:${order.orderId}`, signature, timestamp: timestamp.toISOString(), marketplace: 'LM',
      side: order.side, orderId: order.orderId, wallet: order.initializer, starbase: order.starbase, asset: order.asset,
      rawMint: order.rawMint, certificateMint: order.certificateMint, quantity, settledAtlas: netAtlas,
      grossAtlas, marketplaceFeeAtlas, txFeeAtlas, netAtlas, unitPriceAtlas,
    };
  }
  return null;
}

async function collectSignatures(connection, addresses, startMs, addressFactory, maxPages) {
  const signatures = new Map();
  for (const address of Array.from(new Set(addresses.map(String).filter(Boolean)))) {
    let before;
    for (let page = 0; page < maxPages; page += 1) {
      const rows = await connection.getSignaturesForAddress(addressFactory(address), { limit: 1000, ...(before ? { before } : {}) }, 'confirmed');
      let reachedStart = false;
      for (const row of rows || []) {
        const timestampMs = Number(row.blockTime) * 1000;
        if (Number.isFinite(timestampMs) && timestampMs < startMs) { reachedStart = true; continue; }
        if (!row.err && row.signature) signatures.set(row.signature, row);
      }
      if (reachedStart || !rows?.length || rows.length < 1000) break;
      before = rows[rows.length - 1]?.signature;
      if (!before) break;
    }
  }
  return signatures;
}

async function fetchTransactions(connection, rows) {
  const ordered = Array.from(rows.values()).sort((a, b) => Number(a.blockTime || 0) - Number(b.blockTime || 0));
  const transactions = [];
  for (let offset = 0; offset < ordered.length; offset += 100) {
    const batch = ordered.slice(offset, offset + 100);
    const fetched = typeof connection.getParsedTransactions === 'function'
      ? await connection.getParsedTransactions(batch.map((row) => row.signature), { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      : await Promise.all(batch.map((row) => connection.getParsedTransaction(row.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })));
    fetched.forEach((transaction, index) => {
      if (transaction) transactions.push({ ...transaction, signature: batch[index].signature, blockTime: transaction.blockTime ?? batch[index].blockTime });
    });
  }
  return transactions;
}

async function scanLocalMarketTrades(connection, {
  trackedWallets = [], marketAssetsByMint = {}, knownOrders = [], startIso = DEFAULT_START_ISO,
  addressFactory = (value) => value, maxPages = MAX_SIGNATURE_PAGES,
} = {}) {
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) throw new Error('local market startIso is invalid');
  const ordersById = new Map((knownOrders || []).filter((row) => row?.orderId).map((row) => [String(row.orderId), row]));
  const walletSignatures = await collectSignatures(connection, trackedWallets, startMs, addressFactory, maxPages);
  const walletTransactions = await fetchTransactions(connection, walletSignatures);
  for (const transaction of walletTransactions) {
    const order = decodeLocalMarketOrder(transaction, { trackedWallets, marketAssetsByMint });
    if (order) ordersById.set(order.orderId, order);
  }
  const orderSignatures = await collectSignatures(connection, Array.from(ordersById.keys()), startMs, addressFactory, maxPages);
  const newOrderSignatures = new Map(Array.from(orderSignatures).filter(([signature]) => !walletSignatures.has(signature)));
  const transactions = walletTransactions.concat(await fetchTransactions(connection, newOrderSignatures));
  const tradesById = new Map();
  for (const transaction of transactions) {
    const execution = decodeOrderExecution(transaction, ordersById, trackedWallets)
      || decodeLocalMarketTrade(transaction, { trackedWallets, marketAssetsByMint });
    if (execution) tradesById.set(execution.id, execution);
  }
  return {
    orders: Array.from(ordersById.values()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.orderId.localeCompare(b.orderId)),
    trades: Array.from(tradesById.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)),
  };
}

module.exports = {
  DEFAULT_START_ISO, scanLocalMarketTrades, decodeLocalMarketOrder, decodeOrderExecution,
};
