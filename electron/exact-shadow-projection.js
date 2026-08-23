'use strict';

const arithmetic = require('./exact-arithmetic');
const { ExactInventoryCostLedger, COMPLETE, INCOMPLETE } = require('./exact-inventory-cost-ledger');
const checkpoint = require('./exact-ledger-checkpoint');

const SOURCE_MATRIX = Object.freeze({
  scanning: 'unsupported', mining: 'unsupported', crafting: 'provisional', cargo: 'provisional', upgrading: 'provisional', lm: 'conditional', gm: 'conditional',
});
const GATES = Object.freeze(['openingSnapshot','forwardBoundary','identitySupport','backfillCoverage','relevantConflicts','correctionsResolved','executionCustody','currencyUnits','checkpointCurrent','reconciliation','deterministicReplay','noLegacyMixing']);
const clone = (value) => structuredClone(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function openingContent(opening) {
  return { checkpointId: opening.checkpointId, faction: opening.faction, playerProfile: opening.playerProfile, boundaryAt: opening.boundaryAt, lots: opening.lots };
}
function validateOpening(opening, faction, playerProfile) {
  if (!opening || opening.faction !== faction || opening.playerProfile !== playerProfile) throw new Error('scope-mismatch');
  if (typeof opening.boundaryAt !== 'string' || new Date(opening.boundaryAt).toISOString() !== opening.boundaryAt) throw new Error('invalid-boundary');
  if (opening.contentHash !== checkpoint.hash(openingContent(opening))) throw new Error('opening-hash-mismatch');
  if (!Array.isArray(opening.lots)) throw new Error('invalid-opening');
  return opening;
}
function resolveEffectiveEvents(eventStore, faction, playerProfile) {
  if (!eventStore || eventStore.schemaVersion !== 1 || !Array.isArray(eventStore.events)) throw new Error('invalid-event-store');
  if (eventStore.events.some((row) => row.event?.faction !== faction || row.event?.playerProfile !== playerProfile)) throw new Error('scope-mismatch');
  const scoped = eventStore.events.filter((row) => row.event?.faction === faction && row.event?.playerProfile === playerProfile);
  const byId = new Map(scoped.map((row) => [row.event.eventId, row]));
  const superseded = new Set(scoped.map((row) => row.event.supersedes).filter(Boolean));
  const effective = scoped.filter((row) => !superseded.has(row.event.eventId));
  for (const row of effective) {
    const seen = new Set(); let cursor = row;
    while (cursor?.event.supersedes) { if (seen.has(cursor.event.eventId)) throw new Error('correction-cycle'); seen.add(cursor.event.eventId); cursor = byId.get(cursor.event.supersedes); if (!cursor) throw new Error('missing-correction-target'); }
  }
  return effective;
}
function sourceState(row) {
  const source = String(row.event.accounting?.source || row.event.sourceSystem || '').toLowerCase();
  return { source, support: SOURCE_MATRIX[source] || 'unsupported' };
}
function applyAccountingEvent(ledger, row) {
  const event = row.event, accounting = event.accounting;
  if (!accounting || typeof accounting !== 'object') return { applied: false, reason: 'unsupported-source' };
  const base = { ...accounting, eventId: event.eventId, provenance: event.sourceSystem || accounting.source, scope: { faction: event.faction, profile: event.playerProfile },
    timestamp: event.eventTimestamp, status: row.eligibility === COMPLETE ? COMPLETE : INCOMPLETE, coverage: row.eligibility === COMPLETE ? COMPLETE : INCOMPLETE };
  switch (accounting.type) {
    case 'acquire': ledger.acquire(base); break;
    case 'transfer': ledger.transfer(base); break;
    case 'consume': ledger.consume(base); break;
    case 'craft': ledger.craft(base); break;
    case 'upgrade': ledger.upgrade(base); break;
    case 'sale': ledger.sell(base); break;
    default: return { applied: false, reason: 'unsupported-source' };
  }
  return { applied: true };
}
function seedLedger(opening) {
  const ledger = new ExactInventoryCostLedger({ scope: { faction: opening.faction, profile: opening.playerProfile }, boundary: {
    checkpointId: opening.checkpointId, boundaryAt: opening.boundaryAt, coverage: COMPLETE,
  } });
  opening.lots.forEach((lot, index) => ledger.seedOpening({ eventId: `opening:${opening.checkpointId}:${index}`, lotId: lot.lotId,
    provenance: 'exact-opening-checkpoint', scope: { faction: opening.faction, profile: opening.playerProfile }, timestamp: opening.boundaryAt,
    location: lot.location, asset: lot.asset, quantity: lot.quantity, base: {}, cargo: {}, currency: lot.currency,
    status: INCOMPLETE, coverage: INCOMPLETE, openingCheckpointId: opening.checkpointId }));
  return ledger;
}
function relevantConflicts(eventStore, eventIds) {
  const ids = new Set(eventIds); return (eventStore.conflicts || []).filter((conflict) => ids.has(conflict.eventId));
}
function projectionCoverage(events, eventStore, unsupported) {
  if (unsupported.length || events.some((row) => row.eligibility !== COMPLETE)) return INCOMPLETE;
  if ((eventStore.coverage || []).some((row) => row.record?.status === INCOMPLETE)) return INCOMPLETE;
  return COMPLETE;
}
function checkpointInput(input, ledger, applied, coverage) {
  return { root: input.root, faction: input.faction, playerProfile: input.playerProfile, openingCheckpointId: input.opening.checkpointId,
    openingCheckpointHash: input.opening.contentHash, forwardBoundary: input.opening.boundaryAt, immutableEventStoreVersion: 1,
    eventStoreContentHash: input.eventStore.contentHash, appliedEvents: applied.map((row) => {
      const event = row.event || row;
      return { eventId: event.eventId, payloadHash: event.payloadHash };
    }),
    lots: ledger.snapshot(), coverage, eventStore: input.eventStore };
}
async function coldProject(input, options = {}) {
  let opening; try { opening = validateOpening(input.opening, input.faction, input.playerProfile); } catch (error) { return { status: 'rebuild-required', reason: error.message }; }
  const all = resolveEffectiveEvents(input.eventStore, input.faction, input.playerProfile)
    .filter((row) => compare(row.event.eventTimestamp, opening.boundaryAt) >= 0)
    .sort((a, b) => compare(a.event.eventTimestamp, b.event.eventTimestamp) || compare(a.event.eventId, b.event.eventId));
  const ledger = seedLedger(opening), applied = [], unsupported = [];
  try { for (const row of all) { const state = sourceState(row); if (state.support === 'unsupported') { unsupported.push(row.event.eventId); continue; }
    const result = applyAccountingEvent(ledger, row); if (result.applied) applied.push(row); else unsupported.push(row.event.eventId); } }
  catch (error) { return { status: 'rebuild-required', reason: `event-apply:${error.message}` }; }
  const conflicts = relevantConflicts(input.eventStore, all.map((row) => row.event.eventId));
  const coverage = conflicts.length ? INCOMPLETE : projectionCoverage(all, input.eventStore, unsupported);
  const saved = await checkpoint.saveExactLedgerCheckpoint(checkpointInput(input, ledger, applied, coverage), options);
  return { status: saved.status, projectionStatus: coverage, ledger, appliedEventIds: applied.map((row) => row.event.eventId), unsupportedEventIds: unsupported,
    conflicts: { relevant: conflicts, unrelated: (input.eventStore.conflicts || []).filter((conflict) => !conflicts.includes(conflict)) }, checkpoint: saved.document };
}
async function projectShadow(input, options = {}) {
  let opening; try { opening = validateOpening(input.opening, input.faction, input.playerProfile); } catch (error) { return { status: 'rebuild-required', reason: error.message }; }
  const loadInput = { ...checkpointInput(input, { snapshot: () => [] }, [], INCOMPLETE), eventStore: input.eventStore };
  const loaded = await checkpoint.loadExactLedgerCheckpoint(loadInput);
  if (loaded.status === 'missing') return coldProject(input, options);
  if (loaded.status === 'loaded') return { status: 'no-change', projectionStatus: loaded.readiness, checkpoint: loaded.document, written: false };
  if (loaded.status !== 'advance-required') return { status: loaded.status, reason: loaded.reason, checkpoint: loaded.document || null };
  const effective = resolveEffectiveEvents(input.eventStore, input.faction, input.playerProfile);
  const appended = effective.filter((row) => loaded.appendedEventIds.includes(row.event.eventId))
    .sort((a, b) => compare(a.event.eventTimestamp, b.event.eventTimestamp) || compare(a.event.eventId, b.event.eventId));
  const ledger = ExactInventoryCostLedger.fromValidatedCheckpoint(loaded.document), applied = [...loaded.document.appliedEvents];
  let coverage = loaded.document.coverage;
  try { for (const row of appended) { const state = sourceState(row); if (state.support === 'unsupported' || !applyAccountingEvent(ledger, row).applied) { coverage = INCOMPLETE; continue; }
    applied.push({ event: { eventId: row.event.eventId, payloadHash: row.event.payloadHash } }); if (row.eligibility !== COMPLETE) coverage = INCOMPLETE; } }
  catch (error) { return { status: 'rebuild-required', reason: `advance-apply:${error.message}` }; }
  const saveInput = { ...checkpointInput(input, ledger, applied, coverage), appliedEvents: applied.map((row) => row.event || row) };
  const saved = await checkpoint.saveExactLedgerCheckpoint(saveInput, options);
  return { status: saved.status, projectionStatus: coverage, advancedEventIds: appended.map((row) => row.event.eventId), checkpoint: saved.document };
}

function decimalFromLegacy(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const text = String(value); if (/e/i.test(text)) return null;
  const [whole, fraction = ''] = text.split('.'); return { atoms: `${whole}${fraction}`.replace(/^0+(?=\d)/, ''), decimals: fraction.length };
}
function compareField(exactValue, legacyValue) {
  if (exactValue === null && legacyValue === null) return true;
  if (!exactValue || legacyValue === null || legacyValue === undefined) return false;
  const legacy = decimalFromLegacy(legacyValue); if (!legacy) return false;
  if (exactValue.numerator && exactValue.denominator) {
    const renderedExact = arithmetic.renderRatio(exactValue);
    const renderedLegacy = arithmetic.renderRatio(arithmetic.ratio({ ...legacy, unit: exactValue.numerator.unit }, { atoms: '1', decimals: 0, unit: 'legacy-unit' }).value);
    return renderedExact.status === 'ok' && renderedLegacy.status === 'ok' && renderedExact.value === renderedLegacy.value;
  }
  const result = arithmetic.compare(exactValue, { ...legacy, unit: exactValue.unit }); return result.status === 'ok' && result.value === 0;
}
function compareLegacyExact(exactRows, legacyRows) {
  const legacy = new Map((legacyRows || []).map((row) => [`${row.faction}\n${row.profile}\n${row.location}\n${row.asset}`, row]));
  return (exactRows || []).map((row) => {
    const key = `${row.scope.faction}\n${row.scope.profile}\n${row.location}\n${row.asset}`, other = legacy.get(key);
    if (!other || Object.values(other).some((value) => typeof value === 'number' && !Number.isFinite(value))) return { key, classification: 'BLOCK — INVARIANT DIFFERENCE', reason: 'missing-or-non-finite-legacy-row' };
    const fields = ['quantity','baseTotal','cargoTotal','total','baseCostPerUnit','cargoCostPerUnit','totalCostPerUnit','cogsBase','cogsCargo','cogsTotal','endingBasis']
      .filter((field) => row[field] !== undefined || other[field] !== undefined);
    const mismatches = fields.filter((field) => !compareField(row[field], other[field]));
    if (!mismatches.length && row.status === other.status) return { key, classification: 'PASS', fields };
    if (other.differenceProof === 'binary-fraction-vs-atom-allocation') return { key, classification: 'REVIEW — EXPECTED EXACTNESS DIFFERENCE', fields: mismatches };
    if (row.status === INCOMPLETE && other.status === INCOMPLETE && other.coverageDifference === true) return { key, classification: 'REVIEW — COVERAGE DIFFERENCE', fields: mismatches };
    return { key, classification: 'BLOCK — INVARIANT DIFFERENCE', fields: mismatches, reason: 'unexplained-accounting-difference' };
  });
}
function readinessMatrix(evidence = {}) {
  const gates = {
    openingSnapshot: evidence.openingSnapshot === true ? 'PASS' : 'BLOCK', forwardBoundary: evidence.forwardBoundary === true ? 'PASS' : 'BLOCK',
    identitySupport: evidence.identitySupport === true ? 'PASS' : evidence.identitySupport === 'partial' ? 'REVIEW' : 'BLOCK',
    backfillCoverage: evidence.backfillCoverage === true ? 'PASS' : 'BLOCK', relevantConflicts: evidence.relevantConflicts === 0 ? 'PASS' : 'BLOCK',
    correctionsResolved: evidence.correctionsResolved === true ? 'PASS' : 'BLOCK', executionCustody: evidence.executionCustody === true ? 'PASS' : evidence.executionCustody === 'partial' ? 'REVIEW' : 'BLOCK',
    currencyUnits: evidence.currencyUnits === true ? 'PASS' : 'BLOCK', checkpointCurrent: evidence.checkpointCurrent === true ? 'PASS' : 'BLOCK',
    reconciliation: evidence.reconciliation === true ? 'PASS' : 'BLOCK', deterministicReplay: evidence.deterministicReplay === true ? 'PASS' : 'BLOCK',
    noLegacyMixing: evidence.noLegacyMixing === false ? 'BLOCK' : 'PASS',
  };
  return { gates, allGatesPresent: GATES.every((gate) => gate in gates), sourceMatrix: clone(SOURCE_MATRIX), overall: Object.values(gates).every((gate) => gate === 'PASS') ? 'READY' : 'NOT READY' };
}

module.exports = { SOURCE_MATRIX, GATES, openingContent, validateOpening, resolveEffectiveEvents, coldProject, projectShadow, compareLegacyExact, readinessMatrix };
