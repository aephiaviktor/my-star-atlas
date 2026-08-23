'use strict';

const arithmetic = require('./exact-arithmetic');

const BASE_SOURCES = Object.freeze(['scanning', 'mining', 'crafting', 'lm', 'gm']);
const CARGO_SOURCES = Object.freeze(['fuel', 'rental', 'tx']);
const COMPLETE = 'Complete';
const INCOMPLETE = 'Incomplete';

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function exact(value, label, { positive = false } = {}) {
  const parsed = arithmetic.parseValue(value);
  if (parsed.status !== 'ok') throw new Error(`${label}: ${parsed.status}`);
  if (positive && BigInt(parsed.value.atoms) === 0n) throw new Error(`${label} must be positive`);
  return { ...parsed.value };
}

function zeroLike(value) {
  return { atoms: '0', decimals: value.decimals, unit: value.unit };
}

function addExact(left, right, label) {
  const result = arithmetic.add(left, right);
  if (result.status !== 'ok') throw new Error(`${label}: ${result.status}`);
  return result.value;
}

function compareExact(left, right, label) {
  const result = arithmetic.compare(left, right);
  if (result.status !== 'ok') throw new Error(`${label}: ${result.status}`);
  return result.value;
}

function sumValues(values, fallback) {
  if (!values.length) return zeroLike(fallback);
  const result = arithmetic.sum(values);
  if (result.status !== 'ok') throw new Error(`sum: ${result.status}`);
  return result.value;
}

function clone(value) {
  return structuredClone(value);
}

function canonicalTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('timestamp is required');
  return new Date(value).toISOString();
}

function validateScope(scope) {
  return Object.freeze({ faction: text(scope?.faction, 'faction'), profile: text(scope?.profile, 'profile') });
}

function normalizeComponents(input, allowed, currency, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label} components are required`);
  const result = {};
  for (const [source, value] of Object.entries(input)) {
    if (!allowed.includes(source)) throw new Error(`unsupported ${label} source: ${source}`);
    const parsed = exact(value, `${label}.${source}`);
    if (parsed.unit !== currency) throw new Error(`${label}.${source}: incompatible-unit`);
    result[source] = parsed;
  }
  return result;
}

function componentTotal(components, currency) {
  return sumValues(Object.values(components), { atoms: '0', decimals: 0, unit: currency });
}

function statusOf(lots) {
  return lots.every((lot) => lot.status === COMPLETE && lot.coverage === COMPLETE) ? COMPLETE : INCOMPLETE;
}

function splitValue(value, consumedQuantity, retainedQuantity, consumedId, retainedId) {
  const allocated = arithmetic.allocate(value, [
    { identity: consumedId, weight: consumedQuantity },
    { identity: retainedId, weight: retainedQuantity },
  ]);
  if (allocated.status !== 'ok') throw new Error(`proportional allocation: ${allocated.status}`);
  const byId = Object.fromEntries(allocated.value.map((row) => [row.identity, row.value]));
  return { consumed: byId[consumedId], retained: byId[retainedId] };
}

function mergeComponents(target, source) {
  for (const [name, value] of Object.entries(source)) {
    target[name] = target[name] ? addExact(target[name], value, name) : clone(value);
  }
}

class ExactInventoryCostLedger {
  constructor({ scope, boundary }) {
    this.scope = validateScope(scope);
    this.boundary = Object.freeze({
      checkpointId: text(boundary?.checkpointId, 'checkpointId'),
      boundaryAt: canonicalTime(boundary?.boundaryAt),
      coverage: boundary?.coverage === COMPLETE ? COMPLETE : INCOMPLETE,
    });
    if (this.boundary.coverage !== COMPLETE) throw new Error('rebuild-required');
    this.lots = [];
    this.eventIds = new Set();
  }

  static fromLegacySnapshot() {
    return { status: INCOMPLETE, reason: 'rebuild-required' };
  }

  static fromValidatedCheckpoint(document) {
    if (!document || document.schemaVersion !== 2 || !Array.isArray(document.lots) || !Array.isArray(document.appliedEvents)) throw new Error('invalid exact checkpoint');
    const ledger = new ExactInventoryCostLedger({ scope: { faction: document.faction, profile: document.playerProfile }, boundary: {
      checkpointId: document.openingCheckpointId, boundaryAt: document.forwardBoundary, coverage: COMPLETE,
    } });
    ledger.lots = clone(document.lots);
    ledger.eventIds = new Set(document.appliedEvents.map((event) => event.eventId));
    return ledger;
  }

  assertEvent(event) {
    const eventId = text(event?.eventId, 'eventId');
    if (event?.scope?.faction !== this.scope.faction || event?.scope?.profile !== this.scope.profile) throw new Error('scope-mismatch');
    return { eventId, timestamp: canonicalTime(event.timestamp), provenance: text(event.provenance, 'provenance') };
  }

  atomic(operation) {
    const lots = clone(this.lots);
    const eventIds = new Set(this.eventIds);
    try { return operation(); } catch (error) {
      this.lots = lots;
      this.eventIds = eventIds;
      throw error;
    }
  }

  addLot(event) {
    const identity = this.assertEvent(event);
    if (this.eventIds.has(identity.eventId)) return { status: 'replay', eventId: identity.eventId };
    const quantity = exact(event.quantity, 'quantity', { positive: true });
    const currency = text(event.currency, 'currency');
    const base = normalizeComponents(event.base || {}, BASE_SOURCES, currency, 'base');
    const cargo = normalizeComponents(event.cargo || {}, CARGO_SOURCES, currency, 'cargo');
    const status = event.status === COMPLETE && event.coverage === COMPLETE ? COMPLETE : INCOMPLETE;
    const lot = {
      lotId: text(event.lotId, 'lotId'), sourceEventId: identity.eventId, provenance: identity.provenance,
      scope: { ...this.scope }, location: text(event.location, 'location'), asset: text(event.asset, 'asset'),
      quantity, base, cargo, currency, status, coverage: event.coverage === COMPLETE ? COMPLETE : INCOMPLETE,
      openingCheckpointId: event.openingCheckpointId || null, boundaryAt: this.boundary.boundaryAt,
      createdAt: identity.timestamp,
    };
    if (this.lots.some((candidate) => candidate.lotId === lot.lotId)) throw new Error('duplicate lot identity');
    if (event.kind === 'opening') {
      if (lot.openingCheckpointId !== this.boundary.checkpointId) throw new Error('opening-checkpoint-mismatch');
      lot.base = {}; lot.cargo = {}; lot.status = INCOMPLETE; lot.coverage = INCOMPLETE;
    }
    this.lots.push(lot);
    this.eventIds.add(identity.eventId);
    return clone(lot);
  }

  seedOpening(event) { return this.addLot({ ...event, kind: 'opening' }); }
  acquire(event) { return this.addLot(event); }

  purchase({ execution, custodyFlows }) {
    if (!execution || execution.eligible !== true || execution.coverage !== COMPLETE) return { status: INCOMPLETE, reason: 'ineligible-execution' };
    if (!Array.isArray(custodyFlows) || custodyFlows.length === 0) return { status: INCOMPLETE, reason: 'missing-custody' };
    if (custodyFlows.some((flow) => flow.executionId !== execution.eventId || flow.proven !== true
      || (flow.scope && (flow.scope.faction !== execution.scope?.faction || flow.scope.profile !== execution.scope?.profile)))) {
      return { status: INCOMPLETE, reason: 'ambiguous-custody' };
    }
    if ((execution.fees || []).some((fee) => fee.ownerProven !== true)) return { status: INCOMPLETE, reason: 'ambiguous-fee-owner' };
    return this.atomic(() => {
      const fees = new Map();
      for (const fee of execution.fees || []) {
        const feeId = text(fee.id, 'fee id');
        const value = exact(fee.value, 'fee');
        const serialized = arithmetic.serialize(value).value;
        if (fees.has(feeId) && arithmetic.serialize(fees.get(feeId)).value !== serialized) throw new Error('conflicting fee evidence');
        fees.set(feeId, value);
      }
      const feeAllocations = custodyFlows.map(() => ({}));
      const allocationIndexes = new Map();
      for (const [feeId, value] of fees) {
        const allocation = arithmetic.allocate(value, custodyFlows.map((flow, index) => {
          const identity = `${text(flow.lotId, 'lotId')}:${index}`;
          allocationIndexes.set(identity, index);
          return { identity, weight: exact(flow.quantity, 'quantity', { positive: true }) };
        }));
        if (allocation.status !== 'ok') throw new Error(`fee allocation: ${allocation.status}`);
        allocation.value.forEach((row) => {
          feeAllocations[allocationIndexes.get(row.identity)][feeId] = row.value;
        });
      }
      return custodyFlows.map((flow, index) => {
        const base = { [execution.market]: exact(flow.payment, 'payment') };
        for (const value of Object.values(feeAllocations[index])) base[execution.market] = addExact(base[execution.market], value, 'market fee');
        return this.acquire({ ...flow, eventId: `${execution.eventId}:flow:${index}`, provenance: execution.provenance,
          scope: execution.scope, timestamp: execution.timestamp, base, cargo: {}, currency: execution.currency,
          status: COMPLETE, coverage: COMPLETE });
      });
    });
  }

  orderedLots(location, asset) {
    return this.lots.filter((lot) => lot.location === location && lot.asset === asset && BigInt(lot.quantity.atoms) > 0n)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.lotId.localeCompare(b.lotId));
  }

  consume(event) {
    const identity = this.assertEvent(event);
    if (this.eventIds.has(identity.eventId)) return { status: 'replay', eventId: identity.eventId };
    const requested = exact(event.quantity, 'quantity', { positive: true });
    const candidates = this.orderedLots(text(event.location, 'location'), text(event.asset, 'asset'));
    const available = sumValues(candidates.map((lot) => lot.quantity), requested);
    if (compareExact(requested, available, 'quantity') > 0) throw new Error('insufficient quantity');
    let remaining = requested;
    const portions = [];
    for (const lot of candidates) {
      if (BigInt(remaining.atoms) === 0n) break;
      const whole = compareExact(remaining, lot.quantity, 'quantity') >= 0;
      const movedQuantity = whole ? clone(lot.quantity) : clone(remaining);
      const retainedQuantityResult = arithmetic.subtract(lot.quantity, movedQuantity);
      if (retainedQuantityResult.status !== 'ok') throw new Error(`quantity conservation: ${retainedQuantityResult.status}`);
      const retainedQuantity = retainedQuantityResult.value;
      const moved = { ...clone(lot), lotId: `${lot.lotId}>${identity.eventId}`, sourceEventId: identity.eventId,
        provenance: identity.provenance, quantity: movedQuantity, createdAt: identity.timestamp };
      if (!whole) {
        const retainedId = `${lot.lotId}:retained`;
        for (const group of ['base', 'cargo']) for (const [name, value] of Object.entries(lot[group])) {
          const split = splitValue(value, movedQuantity, retainedQuantity, moved.lotId, retainedId);
          moved[group][name] = split.consumed;
          lot[group][name] = split.retained;
        }
      } else {
        for (const group of ['base', 'cargo']) for (const name of Object.keys(lot[group])) lot[group][name] = zeroLike(lot[group][name]);
      }
      lot.quantity = retainedQuantity;
      portions.push(moved);
      const next = arithmetic.subtract(remaining, movedQuantity);
      if (next.status !== 'ok') throw new Error(`quantity conservation: ${next.status}`);
      remaining = next.value;
    }
    this.eventIds.add(identity.eventId);
    return { status: statusOf(portions), eventId: identity.eventId, quantity: requested, lots: portions,
      base: this.aggregateComponents(portions, 'base'), cargo: this.aggregateComponents(portions, 'cargo') };
  }

  transfer(event) {
    return this.atomic(() => {
      const consumed = this.consume(event);
      if (consumed.status === 'replay') return consumed;
      const cargo = normalizeComponents(event.addedCargo || {}, CARGO_SOURCES, text(event.currency, 'currency'), 'cargo');
      consumed.lots.forEach((lot, index) => {
        lot.location = text(event.destination, 'destination');
        if (index === 0) mergeComponents(lot.cargo, cargo);
        lot.status = lot.status === COMPLETE && event.coverage === COMPLETE ? COMPLETE : INCOMPLETE;
        lot.coverage = lot.coverage === COMPLETE && event.coverage === COMPLETE ? COMPLETE : INCOMPLETE;
        this.lots.push(lot);
      });
      return consumed;
    });
  }

  addAttributableCosts(event) {
    return this.atomic(() => {
      const identity = this.assertEvent(event);
      if (this.eventIds.has(identity.eventId)) return { status: 'replay', eventId: identity.eventId };
      const lot = this.lots.find((candidate) => candidate.lotId === event.lotId && BigInt(candidate.quantity.atoms) > 0n);
      if (!lot) throw new Error('target lot is required');
      const added = normalizeComponents(event.cargo, CARGO_SOURCES, lot.currency, 'cargo');
      mergeComponents(lot.cargo, added);
      lot.status = lot.status === COMPLETE && event.coverage === COMPLETE ? COMPLETE : INCOMPLETE;
      lot.coverage = lot.coverage === COMPLETE && event.coverage === COMPLETE ? COMPLETE : INCOMPLETE;
      this.eventIds.add(identity.eventId);
      return clone(lot);
    });
  }

  craft(event) {
    return this.atomic(() => {
      if (!Array.isArray(event.ingredients) || event.ingredients.length === 0) throw new Error('ingredients are required');
      const consumed = event.ingredients.map((ingredient, index) => this.consume({ ...event, ...ingredient,
        eventId: `${event.eventId}:ingredient:${index}`, provenance: event.provenance }));
      const base = {};
      const cargo = {};
      consumed.forEach((part) => { mergeComponents(base, part.base); mergeComponents(cargo, part.cargo); });
      mergeComponents(base, normalizeComponents({ crafting: event.craftingCost }, BASE_SOURCES, event.currency, 'base'));
      return this.acquire({ ...event, quantity: event.outputQuantity, asset: event.outputAsset, base, cargo,
        status: consumed.every((part) => part.status === COMPLETE) ? event.status : INCOMPLETE });
    });
  }

  upgrade(event) { return this.consume(event); }
  sell(event) { return this.consume(event); }

  aggregateComponents(lots, group) {
    const result = {};
    lots.forEach((lot) => mergeComponents(result, lot[group]));
    return result;
  }

  reconcile(location, asset) {
    const lots = this.orderedLots(location, asset);
    if (!lots.length) return { status: INCOMPLETE, reason: 'missing-exact-history' };
    const quantity = sumValues(lots.map((lot) => lot.quantity), lots[0].quantity);
    const base = this.aggregateComponents(lots, 'base');
    const cargo = this.aggregateComponents(lots, 'cargo');
    const baseTotal = componentTotal(base, lots[0].currency);
    const cargoTotal = componentTotal(cargo, lots[0].currency);
    const total = addExact(baseTotal, cargoTotal, 'total cost');
    const status = statusOf(lots);
    return { status, scope: { ...this.scope }, location, asset, quantity, base, cargo, baseTotal, cargoTotal, total,
      baseCostPerUnit: status === COMPLETE ? arithmetic.ratio(baseTotal, quantity).value : null,
      cargoCostPerUnit: status === COMPLETE ? arithmetic.ratio(cargoTotal, quantity).value : null,
      totalCostPerUnit: status === COMPLETE ? arithmetic.ratio(total, quantity).value : null,
      lots: clone(lots) };
  }

  snapshot() {
    return clone(this.lots).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.lotId.localeCompare(b.lotId));
  }
}

module.exports = { BASE_SOURCES, CARGO_SOURCES, COMPLETE, INCOMPLETE, ExactInventoryCostLedger };
