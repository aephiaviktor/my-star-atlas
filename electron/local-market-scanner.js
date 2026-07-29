'use strict';

const { decodeLocalMarketTrade } = require('./local-market-trades');

const DEFAULT_START_ISO = '2026-07-24T00:00:00.000Z';
const MAX_SIGNATURE_PAGES = 20;

async function scanLocalMarketTrades(connection, {
  trackedWallets = [],
  marketAssetsByMint = {},
  startIso = DEFAULT_START_ISO,
  addressFactory = (value) => value,
  maxPages = MAX_SIGNATURE_PAGES,
} = {}) {
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) throw new Error('local market startIso is invalid');
  const signatures = new Map();
  for (const wallet of Array.from(new Set(trackedWallets.map(String).filter(Boolean)))) {
    let before;
    for (let page = 0; page < maxPages; page += 1) {
      const options = { limit: 1000, ...(before ? { before } : {}) };
      const rows = await connection.getSignaturesForAddress(addressFactory(wallet), options, 'confirmed');
      let reachedStart = false;
      for (const row of rows || []) {
        const timestampMs = Number(row.blockTime) * 1000;
        if (Number.isFinite(timestampMs) && timestampMs < startMs) {
          reachedStart = true;
          continue;
        }
        if (!row.err && row.signature) signatures.set(row.signature, row);
      }
      if (reachedStart || !rows?.length || rows.length < 1000) break;
      before = rows[rows.length - 1]?.signature;
      if (!before) break;
    }
  }

  const ordered = Array.from(signatures.values()).sort((a, b) => Number(a.blockTime || 0) - Number(b.blockTime || 0));
  const trades = [];
  for (let offset = 0; offset < ordered.length; offset += 100) {
    const batch = ordered.slice(offset, offset + 100);
    const transactions = typeof connection.getParsedTransactions === 'function'
      ? await connection.getParsedTransactions(batch.map((row) => row.signature), { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      : await Promise.all(batch.map((row) => connection.getParsedTransaction(row.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })));
    transactions.forEach((transaction, index) => {
      if (!transaction) return;
      const row = batch[index];
      const normalized = { ...transaction, signature: row.signature, blockTime: transaction.blockTime ?? row.blockTime };
      const trade = decodeLocalMarketTrade(normalized, { trackedWallets, marketAssetsByMint });
      if (trade) trades.push(trade);
    });
  }
  return trades.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}

module.exports = { DEFAULT_START_ISO, scanLocalMarketTrades };
