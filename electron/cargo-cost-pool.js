'use strict';

const crypto = require('node:crypto');

function utcDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function clean(value) { return String(value || '').trim(); }
function stableId(parts) { return crypto.createHash('sha256').update(parts.join('\n')).digest('hex'); }

function sourceIdentity(source) {
  const explicit = clean(source.sourceEventId || source.eventId || source.costId);
  if (explicit) return `event:${explicit}`;
  const signature = clean(source.transactionSignature || source.signature || source.txSignature);
  const position = source.instructionIndex ?? source.eventIndex ?? source.logIndex;
  if (signature && Number.isInteger(Number(position)) && Number(position) >= 0) return `tx:${signature}:${Number(position)}`;
  if (signature && source.kind === 'transaction_fee') return `tx-fee:${signature}`;
  return '';
}

function buildCargoCostPool(rows = []) {
  const costs = new Map();
  const references = [];
  const pending = [];
  for (const row of rows || []) {
    const fleet = clean(row.fleetAccount || row.fleetKey || row.fleet);
    const eventDate = utcDate(row.timestamp || row.eventTimestamp || `${row.isoDate || ''}T00:00:00.000Z`);
    const sources = Array.isArray(row.costSources) ? row.costSources : [];
    for (const source of sources) {
      const kind = clean(source.kind);
      const amount = Number(source.amount);
      const currency = clean(source.currency);
      const timestamp = new Date(source.timestamp || row.timestamp || `${eventDate}T00:00:00.000Z`);
      let identity = sourceIdentity(source);
      const rentalContract = clean(source.contractId || row.rentalContract);
      if (!identity && kind === 'rental' && source.daily === true && rentalContract) identity = `rental-day:${rentalContract}`;
      if (!fleet || !eventDate || !kind || !Number.isFinite(amount) || amount < 0 || !currency || Number.isNaN(timestamp.getTime()) || !identity) {
        pending.push({ status: 'needs_review', reason: !identity ? 'ambiguous_source_identity' : 'invalid_cost_source', fleet: fleet || null, utcDate: eventDate || null, source });
        continue;
      }
      const id = stableId([fleet, eventDate, kind, identity]);
      const canonical = {
        id, fleet, utcDate: eventDate, kind, sourceIdentity: identity,
        amount, currency, timestamp: timestamp.toISOString(), sourceId: source.sourceEventId || source.eventId || source.costId || null,
        transactionSignature: source.transactionSignature || source.signature || source.txSignature || null,
        instructionIndex: source.instructionIndex ?? source.eventIndex ?? source.logIndex ?? null,
        valuation: source.valuation || null,
      };
      const existing = costs.get(id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(canonical)) {
        pending.push({ status: 'needs_review', reason: 'conflicting_source_replay', fleet, utcDate: eventDate, source });
        continue;
      }
      if (!existing) costs.set(id, canonical);
      references.push({ costId: id, assignment: row.assignment || null, resourceMint: row.resourceMint || row.asset || null, destination: row.destination || null });
    }
  }
  return { costs: Array.from(costs.values()), references, pending };
}

function mergeCargoCostPools(...pools) {
  const costs = new Map();
  const references = [];
  const pending = [];
  for (const pool of pools.flat()) {
    for (const cost of pool?.costs || []) costs.set(cost.id, cost);
    references.push(...(pool?.references || []));
    pending.push(...(pool?.pending || []));
  }
  return { costs: Array.from(costs.values()), references, pending };
}

module.exports = { sourceIdentity, buildCargoCostPool, mergeCargoCostPools };
