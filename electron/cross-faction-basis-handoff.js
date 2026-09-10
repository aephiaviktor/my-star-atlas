'use strict';

const MAX_HANDOFF_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
const SOURCE_COST_KEYS = Object.freeze(['scanning', 'mining', 'crafting', 'lm', 'gm']);

function normalizeFaction(value) {
  const faction = String(value || '').trim().toUpperCase();
  return faction === 'UST' ? 'USTUR' : faction;
}

function inferStarbaseFaction(starbase) {
  const prefix = String(starbase || '').trim().toUpperCase().split('-')[0];
  return prefix === 'UST' ? 'USTUR' : ['MUD', 'ONI'].includes(prefix) ? prefix : '';
}

function latestSourceObservation(observations, flow, lookbackMs) {
  const flowTime = Date.parse(flow.timestamp);
  if (!Number.isFinite(flowTime)) return null;
  return (observations || [])
    .filter((row) => normalizeFaction(row?.faction) === normalizeFaction(flow.faction || inferStarbaseFaction(flow.origin))
      && String(row?.starbase || '') === String(flow.origin || '')
      && String(row?.asset || '') === String(flow.asset || '')
      && row?.sourceCosts
      && SOURCE_COST_KEYS.every((key) => Number.isFinite(Number(row.sourceCosts[key])) && Number(row.sourceCosts[key]) >= 0)
      && Number.isFinite(Number(row.cargoCost)) && Number(row.cargoCost) >= 0
      && Date.parse(row.timestamp) <= flowTime
      && flowTime - Date.parse(row.timestamp) <= lookbackMs)
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0] || null;
}

function transferEvent(flow) {
  return {
    type: 'transfer', timestamp: flow.timestamp, origin: flow.origin, destination: flow.destination,
    asset: flow.asset, quantity: Number(flow.quantity), cargoCost: Number(flow.txFeeAtlas || flow.cargoCost || 0), flowId: flow.id,
  };
}

function buildFactionCustodyLedgerEvents({ flows = [], observations = [], faction, maxLookbackMs = MAX_HANDOFF_LOOKBACK_MS } = {}) {
  const selectedFaction = normalizeFaction(faction);
  const events = [];
  const rejected = [];
  for (const flow of flows || []) {
    const handoffFlow = flow?.flow === 'css-withdraw' || flow?.flow === 'cargo-transfer';
    const sourceFaction = normalizeFaction(flow?.faction || (handoffFlow ? inferStarbaseFaction(flow.origin) : ''));
    if (!handoffFlow || !sourceFaction || sourceFaction === selectedFaction) {
      events.push(transferEvent(flow));
      continue;
    }
    const observation = latestSourceObservation(observations, flow, maxLookbackMs);
    const snapshotQuantity = Number(observation?.quantity);
    const snapshotKnownQuantity = Number(observation?.knownQuantity ?? (snapshotQuantity - Number(observation?.uncostedQuantity || 0)));
    const quantity = Number(flow.quantity);
    if (!observation || !(snapshotQuantity > 0) || !(snapshotKnownQuantity > 0) || !(quantity > 0)) {
      rejected.push({ flow, reason: observation ? 'source_basis_snapshot_unpriced' : 'source_basis_snapshot_unavailable' });
      continue;
    }
    const knownCostRatio = quantity / snapshotKnownQuantity;
    const uncostedRatio = Math.min(1, Number(observation.uncostedQuantity || 0) / snapshotQuantity);
    events.push({
      type: 'acquire-lot', timestamp: flow.timestamp, location: flow.destination, asset: flow.asset, quantity,
      uncostedQuantity: quantity * uncostedRatio,
      costs: Object.fromEntries(SOURCE_COST_KEYS.map((key) => [key, Number(observation.sourceCosts[key]) * knownCostRatio])),
      cargoCost: Number(observation.cargoCost || 0) * knownCostRatio + Number(flow.txFeeAtlas || flow.cargoCost || 0),
      flowId: flow.id, handoffFromFaction: sourceFaction, handoffFromStarbase: flow.origin,
    });
  }
  return { events, rejected };
}

module.exports = { MAX_HANDOFF_LOOKBACK_MS, buildFactionCustodyLedgerEvents };
