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
    const sourceFaction = normalizeFaction(flow?.faction || (flow?.flow === 'css-withdraw' ? inferStarbaseFaction(flow.origin) : ''));
    if (flow?.flow !== 'css-withdraw' || !sourceFaction || sourceFaction === selectedFaction) {
      events.push(transferEvent(flow));
      continue;
    }
    const observation = latestSourceObservation(observations, flow, maxLookbackMs);
    const snapshotQuantity = Number(observation?.quantity);
    const quantity = Number(flow.quantity);
    if (!observation || !(snapshotQuantity > 0) || !(quantity > 0) || quantity > snapshotQuantity + 1e-9) {
      rejected.push({ flow, reason: observation ? 'insufficient_source_snapshot_quantity' : 'source_basis_snapshot_unavailable' });
      continue;
    }
    const ratio = quantity / snapshotQuantity;
    events.push({
      type: 'acquire-lot', timestamp: flow.timestamp, location: flow.destination, asset: flow.asset, quantity,
      uncostedQuantity: Number(observation.uncostedQuantity || 0) * ratio,
      costs: Object.fromEntries(SOURCE_COST_KEYS.map((key) => [key, Number(observation.sourceCosts[key]) * ratio])),
      cargoCost: Number(observation.cargoCost || 0) * ratio + Number(flow.txFeeAtlas || flow.cargoCost || 0),
      flowId: flow.id, handoffFromFaction: sourceFaction, handoffFromStarbase: flow.origin,
    });
  }
  return { events, rejected };
}

module.exports = { MAX_HANDOFF_LOOKBACK_MS, buildFactionCustodyLedgerEvents };
