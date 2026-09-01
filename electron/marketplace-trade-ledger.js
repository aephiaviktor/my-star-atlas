'use strict';

function finiteOrNull(value) {
  const number = Number(value);
  return value == null || value === '' || !Number.isFinite(number) ? null : number;
}

function projectDecodedMarketplaceTrades(events = []) {
  return (events || []).filter((event) => ['lm', 'gm'].includes(String(event?.eventType || '').toLowerCase())
      && event?.action === 'execution')
    .map((event) => {
      const side = event.side === 'sell' ? 'sell' : 'buy';
      const quantity = finiteOrNull(event.quantity ?? event.quantityRaw);
      const unitPriceAtlas = finiteOrNull(event.unitPriceAtlas);
      const grossAtlas = finiteOrNull(event.grossAtlas)
        ?? (quantity != null && unitPriceAtlas != null ? quantity * unitPriceAtlas : null);
      const marketplaceFeeAtlas = finiteOrNull(event.marketplaceFeeAtlas);
      const transactionFeeAtlas = finiteOrNull(event.transactionFeeAtlas ?? event.txFeeAtlas);
      const complete = quantity != null && quantity > 0 && grossAtlas != null
        && transactionFeeAtlas != null && (side === 'buy' || marketplaceFeeAtlas != null);
      const netAtlas = grossAtlas == null || transactionFeeAtlas == null || (side === 'sell' && marketplaceFeeAtlas == null)
        ? null
        : side === 'buy'
          ? grossAtlas + transactionFeeAtlas
          : grossAtlas - marketplaceFeeAtlas - transactionFeeAtlas;
      return {
        tradeId: String(event.eventId || ''), timestamp: String(event.timestamp || ''), side,
        marketplace: String(event.market || event.eventType || '').toUpperCase(), faction: String(event.faction || '').toUpperCase(),
        asset: String(event.asset || ''), quantity, unitPriceAtlas, grossAtlas,
        marketplaceFeeAtlas: side === 'buy' ? 0 : marketplaceFeeAtlas,
        transactionFeeAtlas, netAtlas,
        netUnitValueAtlas: netAtlas != null && quantity > 0 ? netAtlas / quantity : null,
        orderId: String(event.orderId || ''), signature: String(event.signature || ''),
        status: complete ? 'Complete' : 'Partial',
      };
    }).sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)) || left.tradeId.localeCompare(right.tradeId));
}

module.exports = { projectDecodedMarketplaceTrades };
