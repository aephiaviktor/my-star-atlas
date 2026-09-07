'use strict';
const { normalizeState, reconcileToolkitHistory } = require('./starbase-upkeep-capacity');
const RETENTION_SECONDS = 35 * 86400;
// Dependencies are injected so tests exercise real cursor and publication transitions without I/O.
async function syncUpkeepHistory({ load, save, capture, signatures, decode, publish, maxPages = 5 }) {
  let journal = await load();
  const latest = normalizeState(await capture());
  if (!latest) throw new Error('upkeep_snapshot_invalid');
  if (!journal) {
    journal = { version: 2, anchor: latest, latest, pending: null, batches: [] };
    // First observation establishes a baseline, never fictitious historical coverage.
    await publish({ anchor: latest, target: latest, intervals: [], events: [] });
    await save(journal);
    return { ...journal, status: 'baseline_only' };
  }
  if (journal.version !== 2 || !normalizeState(journal.anchor) || !Array.isArray(journal.batches)) throw new Error('upkeep_checkpoint_invalid');
  for (const key of ['faction', 'starbasePublicKey']) if (journal.anchor[key] !== latest[key]) throw new Error('upkeep_scope_mismatch');
  journal.latest = latest;
  if (latest.observedAt - journal.anchor.observedAt > RETENTION_SECONDS) {
    await publish({ anchor: latest, target: latest, intervals: [], events: [] });
    journal.anchor = latest; journal.pending = null;
    journal.batches = journal.batches.filter(r => r.target.observedAt >= latest.observedAt - RETENTION_SECONDS);
    await save(journal);
    return { ...journal, status: 'history_gap' };
  }
  if (!journal.pending && latest.slot <= journal.anchor.slot) return { ...journal, status: 'unchanged' };
  if (!journal.pending) journal.pending = { target: latest, before: null, deposits: [], pages: 0, complete: false };
  const pending = journal.pending;
  for (let page = 0; page < maxPages && !pending.complete; page += 1) {
    const batch = await signatures(pending.before);
    if (!Array.isArray(batch) || batch.some(r => !r.signature || !Number.isSafeInteger(r.slot))) throw new Error('upkeep_signature_page_invalid');
    if (batch.length && batch.at(-1).signature === pending.before) throw new Error('upkeep_cursor_stalled');
    // The entire observed slot belongs to the snapshot. Later slots are deferred, never skipped.
    const relevant = batch.filter(r => r.slot > journal.anchor.slot && r.slot <= pending.target.slot && !r.err);
    const deposits = await decode(relevant);
    pending.deposits.push(...deposits);
    pending.before = batch.at(-1)?.signature || pending.before;
    pending.pages += 1;
    pending.complete = batch.some(r => r.slot <= journal.anchor.slot);
    // A short page alone does not prove the old anchor is reachable (provider pruning).
    if (!pending.complete && batch.length < 1000) {
      const oldest = batch.at(-1);
      if (!oldest || oldest.slot > journal.anchor.slot) throw new Error('upkeep_anchor_history_not_observed');
    }
    await save(journal); // durable bounded catch-up even when five full pages are insufficient
  }
  if (!pending.complete) return { ...journal, status: 'catching_up' };
  // RPC signatures are newest first; decoder returns execution-ordered deposits per transaction.
  // Sorting slots is stable. Same-slot multi-transaction ordering is resolved by the decoder.
  const deposits = pending.deposits.sort((a, b) => a.slot - b.slot || a.transactionIndex - b.transactionIndex || a.instructionIndex - b.instructionIndex);
  let evidence;
  try {
    evidence = reconcileToolkitHistory({ anchor: journal.anchor, target: pending.target, deposits });
  } catch (error) {
    // Keep the invalid interval unknown and establish a new baseline, allowing future recovery.
    if (!['upkeep_clock_reconciliation_failed', 'upkeep_configuration_changed'].includes(error.message)) throw error;
    await publish({ anchor: pending.target, target: pending.target, intervals: [], events: [] });
    journal.anchor = pending.target; journal.pending = null;
    await save(journal);
    return { ...journal, status: error.message };
  }
  const record = { anchor: journal.anchor, target: pending.target, ...evidence };
  // Idempotent publication precedes cursor advancement; failures retain the resumable pending window.
  await publish(record);
  journal.batches.push(record);
  journal.anchor = pending.target; journal.pending = null;
  journal.batches = journal.batches.filter(r => r.target.observedAt >= latest.observedAt - RETENTION_SECONDS);
  await save(journal);
  return { ...journal, status: 'reconciled' };
}
module.exports = { syncUpkeepHistory };
