'use strict';

function normalizeFaction(value) {
  const faction = String(value || '').trim().toUpperCase();
  return faction === 'UST' ? 'USTUR' : faction;
}

function finiteOrNull(value) {
  const number = Number(value);
  return value == null || value === '' || !Number.isFinite(number) ? null : number;
}

function projectDecodedCustodyRows(events = [], { faction = '' } = {}) {
  const selectedFaction = normalizeFaction(faction);
  return (events || []).filter((event) => ['deposit', 'withdraw'].includes(String(event?.eventType || '').toLowerCase()))
    .filter((event) => normalizeFaction(event.faction) === selectedFaction)
    .map((event) => {
      const direction = String(event.eventType).toLowerCase();
      return {
        custodyId: String(event.eventId || ''), timestamp: String(event.timestamp || ''), direction,
        faction: selectedFaction, from: String(event.fromWallet || event.origin || ''),
        to: String(event.toWallet || event.destination || ''), starbase: String(event.starbase || ''),
        asset: String(event.asset || ''), mint: String(event.mint || event.rawMint || ''),
        quantity: finiteOrNull(event.quantity ?? event.quantityRaw),
        transactionFeeAtlas: finiteOrNull(event.transactionFeeAtlas ?? event.txFeeAtlas),
        carriedBasisAtlas: null, finalBasisAtlas: null, costPerUnitAtlas: null,
        signature: String(event.signature || ''), status: 'Unvalued',
      };
    }).sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)) || left.custodyId.localeCompare(right.custodyId));
}

function observationAtOrBefore(observations, event) {
  const eventTime = Date.parse(String(event?.timestamp || ''));
  const faction = normalizeFaction(event?.faction);
  const starbase = String(event?.starbase || '');
  const asset = String(event?.asset || '');
  const candidates = Array.from(observations || []).filter((row) => String(row?.asset || '') === asset && Number.isFinite(Date.parse(String(row?.timestamp || ''))));
  const latestAtOrBefore = (rows) => rows.filter((row) => !Number.isFinite(eventTime) || Date.parse(String(row.timestamp)) <= eventTime)
    .sort((left, right) => Date.parse(String(right.timestamp)) - Date.parse(String(left.timestamp)))[0] || null;
  return latestAtOrBefore(candidates.filter((row) => normalizeFaction(row?.faction) === faction && String(row?.starbase || '') === starbase))
    || latestAtOrBefore(candidates.filter((row) => normalizeFaction(row?.faction) === faction))
    || latestAtOrBefore(candidates)
    || candidates.sort((left, right) => Math.abs(Date.parse(String(left.timestamp)) - eventTime) - Math.abs(Date.parse(String(right.timestamp)) - eventTime))[0]
    || null;
}

function buildValuedCustodyRows(events = [], { faction = '', inventoryBasisObservations = [] } = {}) {
  const selectedFaction = normalizeFaction(faction);
  const pools = new Map();
  const sourcePools = new Map();
  const ensurePool = (wallet, asset) => {
    const key = `${String(wallet || '')}\n${String(asset || '')}`;
    if (!pools.has(key)) pools.set(key, { uncostedQuantity: 0, uncostedBasisAtlas: 0, costedQuantity: 0, costedBasisAtlas: 0 });
    return pools.get(key);
  };
  const addLot = (wallet, asset, lot) => {
    const pool = ensurePool(wallet, asset);
    for (const field of ['uncostedQuantity', 'uncostedBasisAtlas', 'costedQuantity', 'costedBasisAtlas']) pool[field] += Number(lot[field] || 0);
  };
  const takeFromPool = (pool, quantity) => {
    const uncostedQuantity = Math.min(quantity, pool.uncostedQuantity);
    const uncostedRatio = pool.uncostedQuantity > 0 ? uncostedQuantity / pool.uncostedQuantity : 0;
    const uncostedBasisAtlas = pool.uncostedBasisAtlas * uncostedRatio;
    const remaining = quantity - uncostedQuantity;
    const costedQuantity = Math.min(remaining, pool.costedQuantity);
    const costedRatio = pool.costedQuantity > 0 ? costedQuantity / pool.costedQuantity : 0;
    const costedBasisAtlas = pool.costedBasisAtlas * costedRatio;
    const unmatchedQuantity = Math.max(0, remaining - costedQuantity);
    pool.uncostedQuantity -= uncostedQuantity;
    pool.uncostedBasisAtlas -= uncostedBasisAtlas;
    pool.costedQuantity -= costedQuantity;
    pool.costedBasisAtlas -= costedBasisAtlas;
    return { uncostedQuantity: uncostedQuantity + unmatchedQuantity, uncostedBasisAtlas, costedQuantity, costedBasisAtlas, unmatchedQuantity };
  };
  const takeLot = (wallet, asset, quantity) => takeFromPool(ensurePool(wallet, asset), quantity);
  const sourcePool = (event) => {
    const key = `${normalizeFaction(event.faction)}\n${String(event.starbase || '')}\n${String(event.asset || '')}`;
    const observation = observationAtOrBefore(inventoryBasisObservations, event);
    const observedAt = String(observation?.timestamp || '');
    const existing = sourcePools.get(key);
    if (!existing || (observedAt && Date.parse(observedAt) > Date.parse(existing.observedAt || ''))) {
      const knownQuantity = Math.max(0, Number(observation?.knownQuantity || 0));
      const knownUnitBasis = finiteOrNull(observation?.weightedAveragePriceAtlas);
    const observedUncostedQuantity = Math.max(0, Number(observation?.uncostedQuantity || 0));
      sourcePools.set(key, {
        observedAt,
        uncostedQuantity: knownUnitBasis != null ? 0 : observedUncostedQuantity,
        uncostedBasisAtlas: 0,
        costedQuantity: knownUnitBasis != null ? knownQuantity + observedUncostedQuantity : knownQuantity,
        costedBasisAtlas: knownUnitBasis != null ? (knownQuantity + observedUncostedQuantity) * knownUnitBasis : 0,
        observationAvailable: Boolean(observation),
      });
    }
    return sourcePools.get(key);
  };
  const addToSourcePool = (event, lot) => {
    const key = `${normalizeFaction(event.faction)}\n${String(event.starbase || '')}\n${String(event.asset || '')}`;
    if (!sourcePools.has(key)) sourcePools.set(key, { observedAt: '', uncostedQuantity: 0, uncostedBasisAtlas: 0, costedQuantity: 0, costedBasisAtlas: 0, observationAvailable: false });
    const pool = sourcePools.get(key);
    for (const field of ['uncostedQuantity', 'uncostedBasisAtlas', 'costedQuantity', 'costedBasisAtlas']) pool[field] += Number(lot[field] || 0);
    if (!(lot.unmatchedQuantity > 0)) pool.observationAvailable = true;
  };
  const addFee = (lot, fee, quantity) => {
    if (fee == null || !(quantity > 0)) return lot;
    const next = { ...lot };
    next.uncostedBasisAtlas += fee * (next.uncostedQuantity / quantity);
    next.costedBasisAtlas += fee * (next.costedQuantity / quantity);
    return next;
  };
  const estimateUnmatched = (lot, event) => {
    if (!(lot.unmatchedQuantity > 0)) return lot;
    const observation = observationAtOrBefore(inventoryBasisObservations, event);
    const unitBasis = finiteOrNull(observation?.weightedAveragePriceAtlas);
    if (!(unitBasis > 0)) return lot;
    const quantity = lot.unmatchedQuantity;
    return {
      ...lot,
      uncostedQuantity: Math.max(0, lot.uncostedQuantity - quantity),
      costedQuantity: lot.costedQuantity + quantity,
      costedBasisAtlas: lot.costedBasisAtlas + quantity * unitBasis,
      unmatchedQuantity: 0,
      estimated: true,
    };
  };
  const rows = [];
  const ordered = [...(events || [])].sort((left, right) => String(left?.timestamp || '').localeCompare(String(right?.timestamp || '')) || String(left?.eventId || '').localeCompare(String(right?.eventId || '')));
  for (const event of ordered) {
    const direction = String(event?.eventType || '').toLowerCase();
    if (!['deposit', 'withdraw', 'transfer'].includes(direction)) continue;
    const asset = String(event.asset || '');
    const quantity = finiteOrNull(event.quantity ?? event.quantityRaw);
    if (!asset || !(quantity > 0)) continue;
    const from = String(event.fromWallet || event.origin || '');
    const to = String(event.toWallet || event.destination || '');
    const transactionFeeAtlas = finiteOrNull(event.transactionFeeAtlas ?? event.txFeeAtlas);
    let lot;
    if (direction === 'withdraw') {
      const source = sourcePool(event);
      lot = takeFromPool(source, quantity);
      if (!source.observationAvailable) lot.unmatchedQuantity = quantity;
      lot = estimateUnmatched(lot, event);
      lot = addFee(lot, transactionFeeAtlas, quantity);
      addLot(to, asset, lot);
    } else {
      lot = addFee(estimateUnmatched(takeLot(from, asset, quantity), event), transactionFeeAtlas, quantity);
      if (direction === 'transfer') {
        addLot(to, asset, lot);
        continue;
      }
      addToSourcePool(event, lot);
    }
    if (normalizeFaction(event.faction) !== selectedFaction) continue;
    const fee = Number(transactionFeeAtlas || 0);
    const finalBasisAtlas = lot.costedBasisAtlas + lot.uncostedBasisAtlas;
    const carriedBasisAtlas = Math.max(0, finalBasisAtlas - fee);
    const status = lot.estimated
      ? 'Estimated'
      : lot.unmatchedQuantity > 0
      ? 'Estimated'
      : lot.uncostedQuantity > 0
        ? (lot.costedQuantity > 0 ? 'Partial' : 'Unvalued')
        : transactionFeeAtlas == null ? 'Partial' : 'Complete';
    rows.push({
      custodyId: String(event.eventId || ''), timestamp: String(event.timestamp || ''), direction,
      faction: selectedFaction, from, to, starbase: String(event.starbase || ''), asset,
      mint: String(event.mint || event.rawMint || ''), quantity, transactionFeeAtlas,
      costedQuantity: lot.costedQuantity, uncostedQuantity: lot.uncostedQuantity,
      carriedBasisAtlas, finalBasisAtlas,
      costPerUnitAtlas: quantity > 0 ? finalBasisAtlas / quantity : null,
      signature: String(event.signature || ''), status,
    });
  }
  return rows.sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)) || left.custodyId.localeCompare(right.custodyId));
}

module.exports = { normalizeFaction, projectDecodedCustodyRows, buildValuedCustodyRows };
