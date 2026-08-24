'use strict';

const crypto = require('node:crypto');
const arithmetic = require('./exact-arithmetic');

const MONEY_UNIT = 'ATLAS';
const SOURCES = Object.freeze(['lm', 'gm', 'scanning', 'mining', 'crafting', 'cargo']);
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const digest = (value) => crypto.createHash('sha256').update(stable(value)).digest('hex');
const assetUnit = (asset) => `asset:${String(asset || '').trim()}`;

function exactDecimal(value, unit) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) throw new Error(`invalid exact decimal: ${text}`);
  const [whole, fraction = ''] = text.split('.');
  const decimals = unit === MONEY_UNIT ? Math.max(18, fraction.length) : fraction.length;
  const parsed = arithmetic.parseValue({ atoms: `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, ''), decimals, unit });
  if (parsed.status !== 'ok') throw new Error(`invalid exact value: ${parsed.status}`);
  return parsed.value;
}
function zero(unit) { return exactDecimal('0', unit); }
function add(a, b) { const r = arithmetic.add(a, b); if (r.status !== 'ok') throw new Error(r.status); return r.value; }
function subtract(a, b) { const r = arithmetic.subtract(a, b); if (r.status !== 'ok') throw new Error(r.status); return r.value; }
function compare(a, b) { const r = arithmetic.compare(a, b); if (r.status !== 'ok') throw new Error(r.status); return r.value; }
function allocate(value, weights, identities) {
  const r = arithmetic.allocate(value, weights.map((weight, index) => ({ identity: identities[index], weight })));
  if (r.status !== 'ok') throw new Error(r.status);
  const map = Object.fromEntries(r.value.map((entry) => [entry.identity, entry.value]));
  return identities.map((identity) => map[identity]);
}
function rendered(value, sign = 1) {
  if (!value) return null;
  let text = arithmetic.renderRatio({ numerator: value, denominator: { atoms: '1', decimals: 0, unit: 'scalar' } }, value.decimals);
  if (text.status !== 'ok') throw new Error(text.status);
  text = text.value.replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, '').replace(/\.$/, '') || '0';
  if (sign < 0 && BigInt(value.atoms) !== 0n) text = `-${text}`;
  return { ...value, decimal: text };
}
function signedDifference(left, right) {
  const direction = compare(left, right);
  return direction >= 0 ? { sign: direction, value: subtract(left, right) } : { sign: -1, value: subtract(right, left) };
}
function sum(values, unit) { return values.reduce((total, value) => add(total, value), zero(unit)); }
function clone(value) { return structuredClone(value); }

class AccountingEngine {
  constructor(input) {
    this.scope = Object.freeze({ faction: String(input.scope?.faction || '').trim(), profile: String(input.scope?.profile || '').trim() });
    if (!this.scope.faction || !this.scope.profile) throw new Error('scope is required');
    this.period = clone(input.period);
    this.currency = input.currency || MONEY_UNIT;
    this.lots = [];
    this.rows = new Map();
    this.details = [];
    this.counts = { applied: 0, replayed: 0, pending: 0, unallocated: 0, rejected: 0, quarantined: 0 };
  }
  row(asset) {
    const name = String(asset || '').trim(); if (!name) throw new Error('asset is required');
    if (!this.rows.has(name)) {
      const unit = assetUnit(name); const quantities = ['openingQuantity', 'craftingIn', 'craftingOut', 'transferIn', 'transferOut', 'consumptionQuantity', 'salesQuantity', 'pendingQuantity', 'unallocatedQuantity', 'rejectedQuantity', 'quarantinedQuantity'];
      const row = { asset: name, unit, acquisitions: {}, costsBySource: {}, details: [] };
      quantities.forEach((key) => { row[key] = zero(unit); });
      SOURCES.forEach((source) => { row.acquisitions[source] = zero(unit); row.costsBySource[source] = zero(this.currency); });
      row.openingBasisKnown = zero(this.currency); row.salesNetProceeds = zero(this.currency); row.salesCogsKnown = zero(this.currency);
      row.salesKnownQuantity = zero(unit);
      this.rows.set(name, row);
    }
    return this.rows.get(name);
  }
  detail(event, status, extra = {}) {
    const item = { eventId: event.eventId, timestamp: event.timestamp, type: event.type, source: event.source || null, asset: event.asset || event.outputAsset || null, status, tradeId: event.tradeId || null, originWallet: event.originWallet || null, lineageStatus: event.lineageStatus || null, ...extra };
    this.details.push(item); if (item.asset) this.row(item.asset).details.push(item);
  }
  addLot({ event, location, asset, quantity, knownQuantity, cost, sourceCosts = {}, uncosted = false }) {
    this.lots.push({ lotId: `${event.eventId}:lot`, createdAt: event.timestamp, location, asset, quantity, knownQuantity, cost, sourceCosts: clone(sourceCosts), uncosted });
  }
  candidates(location, asset) { return this.lots.filter((lot) => lot.location === location && lot.asset === asset && BigInt(lot.quantity.atoms) > 0n).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.lotId.localeCompare(b.lotId)); }
  consume(event, quantity) {
    const candidates = this.candidates(event.location, event.asset); const available = sum(candidates.map((lot) => lot.quantity), quantity.unit);
    if (compare(available, quantity) < 0) throw new Error('insufficient quantity');
    let remaining = quantity; const moved = [];
    for (const lot of candidates) {
      if (BigInt(remaining.atoms) === 0n) break;
      const take = compare(lot.quantity, remaining) <= 0 ? lot.quantity : remaining;
      const keep = subtract(lot.quantity, take); const ids = ['moved', 'retained'];
      const [movedKnown, retainedKnown] = allocate(lot.knownQuantity, [take, keep], ids);
      const [movedCost, retainedCost] = allocate(lot.cost, [take, keep], ids);
      const movedSources = {}, retainedSources = {};
      for (const [source, value] of Object.entries(lot.sourceCosts)) [movedSources[source], retainedSources[source]] = allocate(value, [take, keep], ids);
      moved.push({ quantity: take, knownQuantity: movedKnown, cost: movedCost, sourceCosts: movedSources, uncosted: lot.uncosted || compare(movedKnown, take) < 0 });
      lot.quantity = keep; lot.knownQuantity = retainedKnown; lot.cost = retainedCost; lot.sourceCosts = retainedSources;
      remaining = subtract(remaining, take);
    }
    return { quantity, knownQuantity: sum(moved.map((part) => part.knownQuantity), quantity.unit), cost: sum(moved.map((part) => part.cost), this.currency), sourceCosts: SOURCES.reduce((out, source) => ({ ...out, [source]: sum(moved.map((part) => part.sourceCosts[source] || zero(this.currency)), this.currency) }), {}), fullyCosted: moved.every((part) => !part.uncosted) };
  }
  apply(event) {
    const row = event.asset ? this.row(event.asset) : null;
    if (event.type === 'quarantined') { const quantity = exactDecimal(event.quantity, row.unit); row.quarantinedQuantity = add(row.quarantinedQuantity, quantity); this.counts.quarantined += 1; this.detail(event, 'quarantined', { reason: event.reason }); return; }
    if (event.type === 'pending' || event.type === 'unallocated') { const quantity = exactDecimal(event.quantity, row.unit); const key = `${event.type}Quantity`; row[key] = add(row[key], quantity); this.counts[event.type] += 1; this.detail(event, event.type); return; }
    if (event.type === 'opening' || event.type === 'acquisition') {
      const quantity = exactDecimal(event.quantity, row.unit); const known = event.basis === null ? zero(row.unit) : quantity;
      let cost = event.basis === null ? zero(this.currency) : exactDecimal(event.basis ?? event.cost ?? '0', this.currency);
      for (const key of ['fees', 'rentalCost']) if (event[key] != null) cost = add(cost, exactDecimal(event[key], this.currency));
      const source = event.type === 'opening' ? null : event.source;
      if (event.type === 'opening') { row.openingQuantity = add(row.openingQuantity, quantity); row.openingBasisKnown = add(row.openingBasisKnown, cost); }
      else { if (!SOURCES.includes(source)) throw new Error('unsupported acquisition source'); row.acquisitions[source] = add(row.acquisitions[source], quantity); row.costsBySource[source] = add(row.costsBySource[source], cost); }
      this.addLot({ event, location: event.location, asset: event.asset, quantity, knownQuantity: known, cost, sourceCosts: source ? { [source]: cost } : {}, uncosted: compare(known, quantity) < 0 });
      this.counts.applied += 1; this.detail(event, event.basis === null ? 'uncosted' : 'applied'); return;
    }
    if (event.type === 'transfer') {
      const quantity = exactDecimal(event.quantity, row.unit); const consumed = this.consume(event, quantity); const cargoCost = exactDecimal(event.cargoCost || '0', this.currency);
      consumed.cost = add(consumed.cost, cargoCost); consumed.sourceCosts.cargo = add(consumed.sourceCosts.cargo || zero(this.currency), cargoCost);
      row.transferOut = add(row.transferOut, quantity); row.transferIn = add(row.transferIn, quantity); row.costsBySource.cargo = add(row.costsBySource.cargo, cargoCost);
      this.addLot({ event, location: event.destination, asset: event.asset, quantity, knownQuantity: consumed.knownQuantity, cost: consumed.cost, sourceCosts: consumed.sourceCosts, uncosted: !consumed.fullyCosted });
      this.counts.applied += 1; this.detail(event, 'applied', { destination: event.destination, payloadHash: event.payloadHash || null }); return;
    }
    if (event.type === 'craft') {
      const outputRow = this.row(event.asset); const consumed = event.ingredients.map((ingredient, index) => this.consume({ ...event, eventId: `${event.eventId}:ingredient:${index}`, asset: ingredient.asset }, exactDecimal(ingredient.quantity, assetUnit(ingredient.asset))));
      consumed.forEach((part, index) => { const ingredientRow = this.row(event.ingredients[index].asset); ingredientRow.craftingIn = add(ingredientRow.craftingIn, part.quantity); });
      const outputQuantity = exactDecimal(event.quantity, outputRow.unit); outputRow.craftingOut = add(outputRow.craftingOut, outputQuantity); outputRow.acquisitions.crafting = add(outputRow.acquisitions.crafting, outputQuantity);
      let cost = sum(consumed.map((part) => part.cost), this.currency); const direct = add(exactDecimal(event.directCost || '0', this.currency), exactDecimal(event.transactionCost || '0', this.currency)); cost = add(cost, direct);
      const sourceCosts = SOURCES.reduce((out, source) => ({ ...out, [source]: sum(consumed.map((part) => part.sourceCosts[source] || zero(this.currency)), this.currency) }), {}); sourceCosts.crafting = add(sourceCosts.crafting, direct); outputRow.costsBySource.crafting = add(outputRow.costsBySource.crafting, direct);
      const fully = consumed.every((part) => part.fullyCosted); this.addLot({ event, location: event.location, asset: event.asset, quantity: outputQuantity, knownQuantity: fully ? outputQuantity : zero(outputRow.unit), cost, sourceCosts, uncosted: !fully });
      this.counts.applied += 1; this.detail(event, fully ? 'applied' : 'uncosted'); return;
    }
    if (event.type === 'sale' || event.type === 'consume') {
      const quantity = exactDecimal(event.quantity, row.unit); const consumed = this.consume(event, quantity);
      if (event.type === 'sale') {
        row.salesQuantity = add(row.salesQuantity, quantity); row.salesKnownQuantity = add(row.salesKnownQuantity, consumed.knownQuantity); row.salesCogsKnown = add(row.salesCogsKnown, consumed.cost);
        const net = subtract(exactDecimal(event.grossProceeds, this.currency), exactDecimal(event.fees || '0', this.currency)); row.salesNetProceeds = add(row.salesNetProceeds, net);
      } else row.consumptionQuantity = add(row.consumptionQuantity, quantity);
      this.counts.applied += 1; this.detail(event, consumed.fullyCosted ? 'applied' : 'uncosted'); return;
    }
    throw new Error(`unsupported event type: ${event.type}`);
  }
  finish(actualClosing = []) {
    const actual = new Map(actualClosing.map((entry) => [entry.asset, entry.quantity]));
    for (const entry of actualClosing) this.row(entry.asset);
    const rows = [...this.rows.values()].map((row) => {
      const lots = this.lots.filter((lot) => lot.asset === row.asset && BigInt(lot.quantity.atoms) > 0n);
      const remaining = sum(lots.map((lot) => lot.quantity), row.unit); const known = sum(lots.map((lot) => lot.knownQuantity), row.unit); const basis = sum(lots.map((lot) => lot.cost), this.currency); const uncosted = subtract(remaining, known);
      const acquisitionTotal = Object.values(row.acquisitions).reduce((total, value) => add(total, value), zero(row.unit));
      const expected = subtract(add(add(add(row.openingQuantity, acquisitionTotal), row.transferIn), row.craftingOut), add(add(add(row.craftingIn, row.transferOut), row.consumptionQuantity), row.salesQuantity));
      const actualValue = actual.has(row.asset) ? exactDecimal(actual.get(row.asset), row.unit) : null; const difference = actualValue ? signedDifference(actualValue, expected) : null;
      const fullyCosted = compare(uncosted, zero(row.unit)) === 0; const salesFully = compare(row.salesKnownQuantity, row.salesQuantity) === 0;
      const salesDifference = salesFully ? signedDifference(row.salesNetProceeds, row.salesCogsKnown) : null;
      const result = { asset: row.asset, openingQuantity: rendered(row.openingQuantity), openingBasis: compare(row.openingQuantity, zero(row.unit)) === 0 ? rendered(row.openingBasisKnown) : compare(row.openingBasisKnown, zero(this.currency)) === 0 ? null : rendered(row.openingBasisKnown), acquisitions: Object.fromEntries(Object.entries(row.acquisitions).map(([key, value]) => [key, rendered(value)])), craftingIn: rendered(row.craftingIn), craftingOut: rendered(row.craftingOut), transferIn: rendered(row.transferIn), transferOut: rendered(row.transferOut), consumptionQuantity: rendered(row.consumptionQuantity), salesQuantity: rendered(row.salesQuantity), salesNetProceeds: rendered(row.salesNetProceeds), cogs: salesFully ? rendered(row.salesCogsKnown) : null, realizedProfit: salesDifference ? rendered(salesDifference.value, salesDifference.sign) : null, salesCoverage: { status: salesFully ? 'fully_costed' : compare(row.salesKnownQuantity, zero(row.unit)) === 0 ? 'uncosted' : 'partially_costed', knownQuantity: rendered(row.salesKnownQuantity), totalQuantity: rendered(row.salesQuantity) }, remainingQuantity: rendered(remaining), remainingCostBasis: fullyCosted ? rendered(basis) : null, knownRemainingCostBasis: rendered(basis), averageCostPerUnit: fullyCosted && BigInt(remaining.atoms) > 0n ? arithmetic.renderRatio(arithmetic.ratio(basis, remaining).value, 18).value : null, actualClosing: actualValue ? rendered(actualValue) : null, expectedClosing: rendered(expected), reconciliationDifference: difference ? { direction: difference.sign > 0 ? 'surplus' : difference.sign < 0 ? 'shortfall' : 'zero', value: rendered(difference.value) } : null, reconciliationStatus: !difference ? 'unavailable' : difference.sign === 0 ? 'reconciled' : 'quantity_mismatch', costCoverage: { status: fullyCosted ? 'fully_costed' : compare(known, zero(row.unit)) === 0 ? 'uncosted' : 'partially_costed', knownQuantity: rendered(known), totalQuantity: rendered(remaining) }, pendingQuantity: rendered(row.pendingQuantity), unallocatedQuantity: rendered(row.unallocatedQuantity), uncostedQuantity: rendered(uncosted), rejectedQuantity: rendered(row.rejectedQuantity), quarantinedQuantity: rendered(row.quarantinedQuantity), costsBySource: Object.fromEntries(Object.entries(row.costsBySource).map(([key, value]) => [key, rendered(value)])), details: row.details };
      return result;
    }).sort((a, b) => a.asset.localeCompare(b.asset));
    return rows;
  }
}

function buildCompleteBreakEvenAccounting(input = {}) {
  if (input.checkpoint && input.checkpoint.inputDigest === digest({ scope: input.scope, period: input.period, currency: input.currency, events: input.events, actualClosing: input.actualClosing })) {
    return { scope: clone(input.scope), period: clone(input.period), rows: clone(input.checkpoint.rows), eventCounts: { ...input.checkpoint.eventCounts, replayed: Math.max(0, (input.events || []).length - 1) }, checkpoint: clone(input.checkpoint) };
  }
  const engine = new AccountingEngine(input); const events = [...(input.events || [])].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.eventId).localeCompare(String(b.eventId)));
  const byId = new Map();
  for (const event of events) { if (!event.eventId || !Number.isFinite(Date.parse(event.timestamp))) throw new Error('immutable event identity and timestamp are required'); const hash = digest(event); const list = byId.get(event.eventId) || []; list.push({ event, hash }); byId.set(event.eventId, list); }
  const process = [];
  for (const list of byId.values()) {
    const hashes = new Set(list.map((entry) => entry.hash));
    if (hashes.size > 1) { for (const { event } of list) { const row = engine.row(event.asset || event.outputAsset); const quantity = exactDecimal(event.quantity || '0', row.unit); row.quarantinedQuantity = add(row.quarantinedQuantity, quantity); engine.counts.quarantined += 1; engine.detail(event, 'quarantined', { reason: 'immutable-event-conflict' }); } continue; }
    process.push(list[0].event); engine.counts.replayed += list.length - 1;
  }
  process.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId));
  for (const event of process) { try { engine.apply(event); } catch (error) { const row = engine.row(event.asset || event.outputAsset); if (event.quantity != null) row.rejectedQuantity = add(row.rejectedQuantity, exactDecimal(event.quantity, row.unit)); engine.counts.rejected += 1; engine.detail(event, 'rejected', { reason: String(error.message || error) }); } }
  const rows = engine.finish(input.actualClosing || []); const inputDigest = digest({ scope: input.scope, period: input.period, currency: input.currency, events: input.events, actualClosing: input.actualClosing });
  const checkpoint = { schemaVersion: 1, scope: clone(engine.scope), period: clone(engine.period), inputDigest, rows: clone(rows), eventCounts: clone(engine.counts) };
  return { scope: clone(engine.scope), period: clone(engine.period), rows, eventCounts: clone(engine.counts), checkpoint };
}

module.exports = { SOURCES, buildCompleteBreakEvenAccounting, exactDecimal };
