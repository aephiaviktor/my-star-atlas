'use strict';

function finiteOrNull(value) {
  const number = Number(value);
  return value == null || value === '' || !Number.isFinite(number) ? null : number;
}

function normalizedFaction(value) {
  return String(value || '').trim().toUpperCase().replace(/^UST$/, 'USTUR');
}

function isMarketplaceExecution(event) {
  return ['lm', 'gm'].includes(String(event?.eventType || '').toLowerCase()) && event?.action === 'execution';
}

function lmPhysicalExecutionKey(event) {
  const signature = String(event?.signature || '').trim();
  const quantity = finiteOrNull(event?.quantity ?? event?.quantityRaw);
  const unitPriceAtlas = finiteOrNull(event?.unitPriceAtlas);
  const grossAtlas = finiteOrNull(event?.grossAtlas)
    ?? (quantity != null && unitPriceAtlas != null ? quantity * unitPriceAtlas : null);
  if (!signature || quantity == null || grossAtlas == null) return '';
  return [signature, normalizedFaction(event?.faction), event?.side === 'sell' ? 'sell' : 'buy',
    String(event?.asset || '').trim(), quantity, grossAtlas].join('\n');
}

function evidenceRank(event) {
  let rank = 0;
  if (String(event?.starbase || '').trim()) rank += 8;
  if (String(event?.orderId || '').trim()) rank += 4;
  if (finiteOrNull(event?.txFeeAtlas ?? event?.transactionFeeAtlas) != null) rank += 2;
  if (event?.side !== 'sell' || finiteOrNull(event?.marketplaceFeeAtlas) != null) rank += 1;
  return rank;
}

function selectCanonicalMarketplaceExecutions(events = []) {
  const executions = (events || []).filter(isMarketplaceExecution);
  const output = [];
  const lmGroups = new Map();
  for (const event of executions) {
    if (String(event?.eventType || '').toLowerCase() !== 'lm') {
      output.push(event);
      continue;
    }
    const key = lmPhysicalExecutionKey(event);
    if (!key) {
      output.push(event);
      continue;
    }
    if (!lmGroups.has(key)) lmGroups.set(key, []);
    lmGroups.get(key).push(event);
  }
  for (const group of lmGroups.values()) {
    const starbases = new Set(group.map((event) => String(event?.starbase || '').trim()).filter(Boolean));
    const orderIds = new Set(group.map((event) => String(event?.orderId || '').trim()).filter(Boolean));
    if (starbases.size > 1 || orderIds.size > 1) {
      output.push(...group);
      continue;
    }
    output.push([...group].sort((left, right) => evidenceRank(right) - evidenceRank(left)
      || String(left?.eventId || '').localeCompare(String(right?.eventId || '')))[0]);
  }
  return output;
}

function projectDecodedMarketplaceTrades(events = []) {
  return selectCanonicalMarketplaceExecutions(events)
    .map((event) => {
      const side = event.side === 'sell' ? 'sell' : 'buy';
      const marketplace = String(event.market || event.eventType || '').toUpperCase();
      const quantity = finiteOrNull(event.quantity ?? event.quantityRaw);
      const unitPriceAtlas = finiteOrNull(event.unitPriceAtlas);
      const grossAtlas = finiteOrNull(event.grossAtlas)
        ?? (quantity != null && unitPriceAtlas != null ? quantity * unitPriceAtlas : null);
      const marketplaceFeeAtlas = finiteOrNull(event.marketplaceFeeAtlas);
      const transactionFeeAtlas = finiteOrNull(event.txFeeAtlas ?? event.transactionFeeAtlas);
      const complete = quantity != null && quantity > 0 && grossAtlas != null
        && transactionFeeAtlas != null && (side === 'buy' || marketplaceFeeAtlas != null);
      const netAtlas = grossAtlas == null || transactionFeeAtlas == null || (side === 'sell' && marketplaceFeeAtlas == null)
        ? null
        : side === 'buy'
          ? grossAtlas + transactionFeeAtlas
          : grossAtlas - marketplaceFeeAtlas - transactionFeeAtlas;
      return {
        tradeId: String(event.eventId || ''), timestamp: String(event.timestamp || ''), side,
        marketplace, faction: marketplace === 'GM' ? 'GLOBAL' : normalizedFaction(event.faction),
        starbase: marketplace === 'GM' ? '-' : String(event.starbase || ''),
        asset: String(event.asset || ''), quantity, unitPriceAtlas, grossAtlas,
        marketplaceFeeAtlas: side === 'buy' ? 0 : marketplaceFeeAtlas,
        transactionFeeAtlas, netAtlas,
        netUnitValueAtlas: netAtlas != null && quantity > 0 ? netAtlas / quantity : null,
        orderId: String(event.orderId || ''), signature: String(event.signature || ''),
        status: complete ? 'Complete' : 'Partial',
      };
    }).sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)) || left.tradeId.localeCompare(right.tradeId));
}

function projectLocalMarketInventoryTrades(events = [], { faction = '' } = {}) {
  const selectedFaction = normalizedFaction(faction);
  return selectCanonicalMarketplaceExecutions(events).flatMap((event) => {
    if (String(event?.eventType || '').toLowerCase() !== 'lm' || normalizedFaction(event?.faction) !== selectedFaction) return [];
    const timestamp = String(event?.timestamp || '');
    const starbase = String(event?.starbase || '').trim();
    const asset = String(event?.asset || '').trim();
    const quantity = finiteOrNull(event?.quantity ?? event?.quantityRaw);
    const unitPriceAtlas = finiteOrNull(event?.unitPriceAtlas);
    const grossAtlas = finiteOrNull(event?.grossAtlas)
      ?? (quantity != null && unitPriceAtlas != null ? quantity * unitPriceAtlas : null);
    const side = event?.side === 'sell' ? 'sell' : 'buy';
    const transactionFeeAtlas = finiteOrNull(event?.txFeeAtlas ?? event?.transactionFeeAtlas);
    const marketplaceFeeAtlas = side === 'sell' ? finiteOrNull(event?.marketplaceFeeAtlas) : 0;
    if (!timestamp || !starbase || !asset || !(quantity > 0) || grossAtlas == null || transactionFeeAtlas == null
      || marketplaceFeeAtlas == null) return [];
    const settledAtlas = side === 'buy' ? grossAtlas + transactionFeeAtlas
      : grossAtlas - marketplaceFeeAtlas - transactionFeeAtlas;
    if (!(settledAtlas >= 0)) return [];
    return [{
      id: String(event?.eventId || ''), timestamp, marketplace: 'LM', faction: selectedFaction,
      starbase, asset, side, quantity, settledAtlas,
    }];
  });
}

module.exports = {
  selectCanonicalMarketplaceExecutions, projectDecodedMarketplaceTrades, projectLocalMarketInventoryTrades,
};
