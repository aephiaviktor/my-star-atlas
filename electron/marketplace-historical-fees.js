'use strict';

function feeAtlas(feeSol, priceEvidence) {
  const sol = Number(feeSol || 0);
  if (!Number.isFinite(sol) || sol < 0) return null;
  if (sol === 0) return 0;
  return priceEvidence?.status === 'complete' && Number.isFinite(Number(priceEvidence.priceATL))
    ? sol * Number(priceEvidence.priceATL) : null;
}

async function revalueMarketplaceScanWithHistoricalSol(scanned, resolvePrice) {
  if (typeof resolvePrice !== 'function') throw new TypeError('resolvePrice is required');
  const ordersById = new Map((scanned?.orders || []).map((order) => [String(order.orderId || ''), order]));
  await Promise.all((scanned?.orders || []).map(async (order) => {
    const price = await resolvePrice('SOL', order.createdAt);
    order.creationTxFeeAtlas = feeAtlas(order.creationTxFeeSol, price);
    order.creationTxFeePrice = price;
  }));
  await Promise.all((scanned?.trades || []).map(async (trade) => {
    const order = ordersById.get(String(trade.orderId || ''));
    const [executionPrice, creationPrice] = await Promise.all([
      resolvePrice('SOL', trade.timestamp),
      resolvePrice('SOL', trade.creationTimestamp || order?.createdAt || trade.timestamp),
    ]);
    const executionFee = feeAtlas(trade.executionTxFeeSol, executionPrice);
    const creationFee = feeAtlas(trade.allocatedCreationTxFeeSol, creationPrice);
    trade.executionTxFeeAtlas = executionFee;
    trade.allocatedCreationTxFeeAtlas = creationFee;
    trade.txFeeAtlas = executionFee != null && creationFee != null ? executionFee + creationFee : null;
    trade.txFeePriceProvenance = { execution: executionPrice, creation: creationPrice };
    if (trade.txFeeAtlas != null) {
      trade.netAtlas = trade.side === 'sell'
        ? Math.max(0, Number(trade.grossAtlas || 0) - Number(trade.marketplaceFeeAtlas || 0) - trade.txFeeAtlas)
        : Number(trade.grossAtlas || 0) + trade.txFeeAtlas;
      trade.settledAtlas = trade.netAtlas;
    }
  }));
  await Promise.all((scanned?.assetFlows || []).map(async (event) => {
    const price = await resolvePrice('SOL', event.timestamp);
    event.txFeeAtlas = feeAtlas(event.txFeeSol, price);
    event.txFeePriceProvenance = price;
  }));
  return scanned;
}

module.exports = { feeAtlas, revalueMarketplaceScanWithHistoricalSol };
