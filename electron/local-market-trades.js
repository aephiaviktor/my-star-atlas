'use strict';

const GM_PROGRAM_ID = 'traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg';
const ATLAS_MINT = 'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx';
const EPSILON = 1e-9;

function accountKeyText(value) {
  return String(value?.pubkey ?? value ?? '');
}

function tokenAmount(balance) {
  const amount = Number(balance?.uiTokenAmount?.uiAmountString ?? balance?.uiTokenAmount?.uiAmount);
  return Number.isFinite(amount) ? amount : 0;
}

function tokenDeltasByOwner(transaction) {
  const deltas = new Map();
  const apply = (balance, sign) => {
    const owner = String(balance?.owner || '');
    const mint = String(balance?.mint || '');
    if (!owner || !mint) return;
    const key = `${owner}\n${mint}`;
    deltas.set(key, (deltas.get(key) || 0) + sign * tokenAmount(balance));
  };
  for (const balance of transaction?.meta?.preTokenBalances || []) apply(balance, -1);
  for (const balance of transaction?.meta?.postTokenBalances || []) apply(balance, 1);
  return deltas;
}

function parseExchangeAmounts(logMessages) {
  let rawPrice = null;
  let rawQuantity = null;
  let rawRoyalty = 0;
  let rawTransfer = null;
  for (const line of logMessages || []) {
    const price = String(line).match(/Original Price:\s*(\d+)/);
    if (price) rawPrice = Number(price[1]);
    const amounts = String(line).match(/purchase_quantity:\s*(\d+),\s*royalty:\s*(\d+),\s*transfer_amount:\s*(\d+)/);
    if (amounts) {
      rawQuantity = Number(amounts[1]);
      rawRoyalty = Number(amounts[2]);
      rawTransfer = Number(amounts[3]);
    }
  }
  if (!(rawPrice >= 0) || !(rawQuantity > 0) || !(rawRoyalty >= 0) || !(rawTransfer >= 0)) return null;
  return {
    quantity: rawQuantity,
    grossAtlas: rawPrice * rawQuantity / 1e8,
    marketplaceFeeAtlas: rawRoyalty / 1e8,
    netAtlas: rawTransfer / 1e8,
  };
}

function decodeLocalMarketTrade(transaction, { trackedWallets = [], marketAssetsByMint = {} } = {}) {
  if (!transaction || transaction.meta?.err) return null;
  const accounts = transaction.transaction?.message?.accountKeys || [];
  if (!accounts.some((key) => accountKeyText(key) === GM_PROGRAM_ID)) return null;
  if (!(transaction.meta?.logMessages || []).some((line) => /Instruction: ProcessExchange|Order exchange successful/.test(String(line)))) return null;
  const timestamp = new Date(Number(transaction.blockTime) * 1000);
  if (!Number.isFinite(timestamp.getTime())) return null;
  const signature = String(transaction.signature || transaction.transaction?.signatures?.[0] || '').trim();
  if (!signature) return null;
  const deltas = tokenDeltasByOwner(transaction);
  const exchange = parseExchangeAmounts(transaction.meta.logMessages);
  if (!exchange) return null;
  const transactionAccounts = new Set(accounts.map(accountKeyText));

  for (const wallet of trackedWallets.map(String)) {
    const atlasDelta = deltas.get(`${wallet}\n${ATLAS_MINT}`) || 0;
    for (const [mint, context] of Object.entries(marketAssetsByMint || {})) {
      if (!transactionAccounts.has(mint)) continue;
      const assetDelta = deltas.get(`${wallet}\n${mint}`) || 0;
      const side = assetDelta > EPSILON ? 'buy'
        : assetDelta < -EPSILON ? 'sell'
          : atlasDelta > EPSILON ? 'sell'
            : atlasDelta < -EPSILON ? 'buy'
              : null;
      if (!side) continue;
      const starbase = String(context?.starbase || '').trim();
      const asset = String(context?.asset || '').trim();
      if (!starbase || !asset) continue;
      const quantity = exchange.quantity;
      const settledAtlas = side === 'buy' ? exchange.grossAtlas : exchange.netAtlas;
      return {
        id: `${signature}:${mint}:${starbase}`,
        signature,
        timestamp: timestamp.toISOString(),
        wallet,
        starbase,
        asset,
        rawMint: String(context?.rawMint || mint),
        certificateMint: mint,
        side,
        quantity,
        settledAtlas,
        grossAtlas: exchange.grossAtlas,
        marketplaceFeeAtlas: exchange.marketplaceFeeAtlas,
        netAtlas: exchange.netAtlas,
        unitPriceAtlas: exchange.grossAtlas / quantity,
      };
    }
  }
  return null;
}

function buildLocalMarketLedgerEvents(trades) {
  return Array.from(trades || []).flatMap((trade) => {
    const timestamp = new Date(trade?.timestamp);
    const location = String(trade?.starbase || '').trim();
    const asset = String(trade?.asset || '').trim();
    const quantity = Number(trade?.quantity);
    const settledAtlas = Number(trade?.settledAtlas);
    if (Number.isNaN(timestamp.getTime()) || !location || !asset || !(quantity > 0) || !(settledAtlas >= 0)) return [];
    const common = { timestamp: timestamp.toISOString(), location, asset, quantity };
    if (trade.side === 'buy') return [{ type: 'acquire', ...common, source: 'lm', totalCost: settledAtlas, tradeId: String(trade.id || '') }];
    if (trade.side === 'sell') return [{ type: 'consume', ...common, purpose: 'lm-sell', tradeId: String(trade.id || '') }];
    return [];
  });
}

function escapeTag(value) {
  return String(value ?? '').replace(/([ ,=])/g, '\\$1');
}

function escapeFieldString(value) {
  return `"${String(value ?? '').replace(/(["\\])/g, '\\$1')}"`;
}

function formatLocalMarketInfluxLine(trade, { faction, profile, market = 'LM' } = {}) {
  const timestamp = new Date(trade?.timestamp);
  if (Number.isNaN(timestamp.getTime())) return '';
  const tags = {
    faction, profile, market,
    starbase: trade.starbase, asset: trade.asset, side: trade.side,
    wallet: trade.wallet, tradeId: trade.id, orderId: trade.orderId,
  };
  const tagText = Object.entries(tags).filter(([, value]) => String(value || '').trim()).map(([key, value]) => `${key}=${escapeTag(value)}`).join(',');
  const quantity = Number(trade.quantity);
  const settledAtlas = Number(trade.settledAtlas);
  const unitPriceAtlas = Number(trade.unitPriceAtlas);
  if (!(quantity > 0) || !(settledAtlas >= 0) || !(unitPriceAtlas >= 0)) return '';
  const grossAtlas = Number(trade.grossAtlas ?? settledAtlas);
  const marketplaceFeeAtlas = Number(trade.marketplaceFeeAtlas ?? 0);
  const txFeeAtlas = Number(trade.txFeeAtlas ?? 0);
  const netAtlas = Number(trade.netAtlas ?? settledAtlas);
  const fields = `quantity=${quantity},settledAtlas=${settledAtlas},grossAtlas=${grossAtlas},marketplaceFeeAtlas=${marketplaceFeeAtlas},txFeeAtlas=${txFeeAtlas},netAtlas=${netAtlas},unitPriceAtlas=${unitPriceAtlas},signature=${escapeFieldString(trade.signature)},creationSignature=${escapeFieldString(trade.creationSignature)},rawMint=${escapeFieldString(trade.rawMint)},certificateMint=${escapeFieldString(trade.certificateMint)}`;
  return `marketplace${tagText ? `,${tagText}` : ''} ${fields} ${BigInt(timestamp.getTime()) * 1000000n}`;
}

module.exports = {
  GM_PROGRAM_ID,
  ATLAS_MINT,
  decodeLocalMarketTrade,
  buildLocalMarketLedgerEvents,
  formatLocalMarketInfluxLine,
};
