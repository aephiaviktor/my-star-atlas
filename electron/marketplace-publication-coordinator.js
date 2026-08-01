'use strict';

const outbox = require(['./marketplace', 'outbox-v2'].join('-'));

const MAX_BATCH_ENTRIES = 250;
const MAX_BATCH_BYTES = 1048576;
const MAX_BATCHES = 64;
const MAX_PENDING = 16000;
const STAGE_OK = new Set(['staged', 'staged_superseding', 'pending_unattempted', 'pending_retryable', 'posting_in_progress', 'older_representation_suppressed']);
const PUBLISHED = new Set(['published_current', 'published_superseded_revision', 'already_published', 'reconciled_published_current', 'reconciled_published_superseded']);
function cleanToken(value) { return typeof value === 'string' ? value.trim().replace(/^(?:Token|Bearer)\s+/i, '').trim() : ''; }
function storageOptions(settings, now) { return { storageRoot: settings?.storageRoot, installationId: settings?.installationId, applicationProfile: settings?.applicationProfile, now }; }
function safeDetail(value) { return typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : 'unknown'; }
function candidateResult(outcome, detailCode) { return { outcome, detailCode: safeDetail(detailCode) }; }
function keyOf(value) { return `${value.generationId}:${value.eventId}:${value.revisionId}`; }
function classifyPublicationOutcome(value) {
  const status = Number(value?.status);
  if (!Number.isInteger(status)) return 'ambiguous';
  if (status >= 200 && status <= 299) return 'confirmed';
  if (status >= 400 && status <= 499 && status !== 408) return 'definite_failure';
  return 'ambiguous';
}
function buildPublicationBatches(revisions, limits = {}) {
  const maxEntries = limits.maximumEntries ?? MAX_BATCH_ENTRIES;
  const maxBytes = limits.maximumBodyBytes ?? MAX_BATCH_BYTES;
  const maxBatches = limits.maximumBatches ?? MAX_BATCHES;
  const batches = []; let current = []; let bytes = 0;
  for (const revision of revisions || []) {
    if (batches.length >= maxBatches) break;
    const line = revision?.payload?.line;
    if (typeof line !== 'string') continue;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    const added = lineBytes + (current.length ? 1 : 0);
    if (current.length && (current.length >= maxEntries || bytes + added > maxBytes)) {
      batches.push({ revisions: current, body: current.map((row) => row.payload.line).join('\n'), bodyBytes: bytes });
      if (batches.length >= maxBatches) break;
      current = []; bytes = 0;
    }
    if (lineBytes > maxBytes) continue;
    current.push(revision); bytes += lineBytes + (current.length > 1 ? 1 : 0);
  }
  if (current.length && batches.length < maxBatches) batches.push({ revisions: current, body: current.map((row) => row.payload.line).join('\n'), bodyBytes: bytes });
  return batches;
}
async function establishDestination(settings, now, api = outbox) {
  const base = storageOptions(settings, now); const token = cleanToken(settings?.token);
  const loaded = await api.loadMarketplaceOutboxV2(base);
  if (loaded.status === 'missing') {
    if (!settings?.baseUrl || !settings?.bucket || !token) return { status: 'not_configured', stage: false, post: false };
    const configured = await api.configureMarketplaceOutboxV2Destination({ ...base, baseUrl: settings.baseUrl, bucket: settings.bucket,
      organization: settings.organization || undefined, authConfigured: true });
    if (!['configured_provisional', 'configured_finalized'].includes(configured.status)) return { status: configured.status, stage: false, post: false };
    const generation = configured.document.generations[configured.document.activeGenerationId];
    return { status: configured.status, stage: true, post: generation.destination.state === 'finalized' && Boolean(token),
      generation, destination: generation.destination, token };
  }
  if (loaded.status !== 'loaded') return { status: loaded.status, stage: false, post: false };
  let verified = await api.verifyMarketplaceOutboxV2Destination({ ...base, baseUrl: settings?.baseUrl, bucket: settings?.bucket,
    organization: settings?.organization || undefined, authConfigured: true });
  if (verified.status === 'finalization_required') {
    if (token && settings?.organization) {
      const finalized = await api.finalizeMarketplaceOutboxV2Organization({ ...base, baseUrl: settings.baseUrl, bucket: settings.bucket,
        organization: settings.organization, authConfigured: true });
      if (!['organization_finalized', 'organization_already_finalized'].includes(finalized.status)) return { status: finalized.status, stage: false, post: false };
      verified = { status: 'finalized_match' };
    } else verified = { status: 'provisional_match' };
  }
  if (!['provisional_match', 'finalized_match'].includes(verified.status)) return { status: verified.status, stage: false, post: false };
  const refreshed = await api.loadMarketplaceOutboxV2(base); const generation = refreshed.document?.generations[refreshed.document.activeGenerationId];
  return { status: verified.status, stage: true, post: verified.status === 'finalized_match' && Boolean(token), generation,
    destination: generation?.destination, token };
}
async function stageCandidates({ settings, candidates, now, api = outbox, destination }) {
  const base = storageOptions(settings, now); const results = []; const refs = new Map(); let hardFailure = !destination?.stage;
  for (let index = 0; index < (candidates || []).length; index += 1) {
    const candidate = candidates[index]; const record = candidate?.record; let staged;
    if (!destination?.stage) staged = { status: destination?.status || 'not_configured' };
    else if (record?.eventType === 'trade' && ['fallback', 'enriched'].includes(candidate?.representationRank)) {
      const { eventType: _eventType, ...trade } = record;
      staged = await api.stageMarketplaceOutboxV2TradeRevision({ ...base, ...trade, revisionKind: candidate.representationRank });
    } else if (record?.eventType === 'asset_flow' && candidate?.representationRank === undefined) {
      const { eventType: _eventType, ...event } = record;
      staged = await api.stageMarketplaceOutboxV2AssetFlow({ ...base, event });
    } else staged = { status: 'invalid_candidate' };
    let result;
    if (staged.status === 'already_published') result = candidateResult('already_published', staged.status);
    else if (STAGE_OK.has(staged.status)) result = candidateResult('pending_unattempted', staged.status);
    else { result = candidateResult('stage_failed', staged.status); hardFailure = true; }
    results.push(result);
    if (staged.generationId && staged.eventId && staged.revisionId) refs.set(keyOf(staged), index);
  }
  return { results, refs, hardFailure };
}
async function reconcilePostingRevision({ settings, posting, resolveExactPoint, now, api = outbox }) {
  if (typeof resolveExactPoint !== 'function') return { status: 'reconciliation_indeterminate', changed: false };
  const base = storageOptions(settings, now); const loaded = await api.loadMarketplaceOutboxV2(base);
  const generation = loaded.document?.generations?.[posting.generationId]; const event = generation?.events?.[posting.eventId]; const revision = event?.revisions?.[posting.revisionId];
  if (!revision || revision.state !== 'posting') return { status: 'revision_missing', changed: false };
  const exact = { generationId: posting.generationId, eventId: posting.eventId, revisionId: posting.revisionId,
    attemptId: revision.activeAttempt.attemptId, attemptSequence: revision.activeAttempt.attemptSequence,
    pointTimestampNs: event.pointTimestampNs, payloadHash: revision.payloadHash };
  let resolved;
  try { resolved = await resolveExactPoint(exact); } catch (_error) { resolved = { outcome: 'indeterminate' }; }
  let outcome = ['matched', 'absent', 'mismatch', 'indeterminate'].includes(resolved?.outcome) ? resolved.outcome : 'indeterminate';
  if (outcome === 'matched' && resolved?.payloadHash !== revision.payloadHash) outcome = 'mismatch';
  return api.reconcileMarketplaceOutboxV2Revision({ ...base, ...exact, outcome });
}
async function inspectAfterMark(settings, reference, now, api) {
  const loaded = await api.loadMarketplaceOutboxV2(storageOptions(settings, now));
  const revision = loaded.document?.generations?.[reference.generationId]?.events?.[reference.eventId]?.revisions?.[reference.revisionId];
  if (revision && ['published', 'superseded_published'].includes(revision.state)) return 'published_confirmed';
  if (revision?.state === 'posting') return 'published_mark_failed';
  return 'published_mark_uncertain';
}
async function drainPending({ settings, fetchImpl, resolveExactPoint, now, api = outbox, candidateRefs = new Map(), results = [] }) {
  const base = storageOptions(settings, now); const outcomes = new Map();
  const posting = await api.inspectMarketplaceOutboxV2Posting(base);
  if (posting.status === 'posting_listed' && typeof resolveExactPoint === 'function') {
    for (const row of posting.revisions) {
      const reconciled = await reconcilePostingRevision({ settings, posting: row, resolveExactPoint, now, api });
      if (PUBLISHED.has(reconciled.status)) outcomes.set(keyOf(row), 'published_confirmed');
    }
  }
  for (const [key, index] of candidateRefs) if (outcomes.has(key)) results[index] = candidateResult(outcomes.get(key), outcomes.get(key));
  if (typeof fetchImpl !== 'function') return { outcomes, attemptedBatches: 0 };
  const listed = await api.listMarketplaceOutboxV2Pending({ ...base, limit: MAX_PENDING });
  if (listed.status !== 'pending_listed') return { outcomes, attemptedBatches: 0 };
  const batches = buildPublicationBatches(listed.revisions); let attemptedBatches = 0;
  const token = cleanToken(settings?.token);
  const destination = api.canonicalizeMarketplaceDestination({ baseUrl: settings.baseUrl, bucket: settings.bucket, organization: settings.organization });
  const endpoint = `${destination.baseUrl}/api/v2/write?org=${encodeURIComponent(String(settings.organization).trim())}&bucket=${encodeURIComponent(destination.bucket)}&precision=ns`;
  for (const batch of batches) {
    const claimed = [];
    for (const row of batch.revisions) {
      const claim = await api.claimMarketplaceOutboxV2Revision({ ...base, generationId: row.generationId, eventId: row.eventId, revisionId: row.revisionId });
      if (claim.status === 'posting_claimed') claimed.push({ ...row, attemptId: claim.attemptId, attemptSequence: claim.attemptSequence });
    }
    if (!claimed.length) continue;
    const body = claimed.map((row) => row.payload.line).join('\n'); attemptedBatches += 1; let response; let classification;
    try {
      response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Token ${token}`, 'Content-Type': 'text/plain; charset=utf-8' },
        body, redirect: 'manual', timeout: 15000 });
      classification = classifyPublicationOutcome(response);
    } catch (_error) { classification = 'ambiguous'; }
    for (const row of claimed) {
      const exact = { ...base, generationId: row.generationId, eventId: row.eventId, revisionId: row.revisionId,
        payloadHash: row.payloadHash, attemptId: row.attemptId };
      let outcome;
      if (classification === 'confirmed') {
        const marked = await api.markMarketplaceOutboxV2Published(exact);
        if (PUBLISHED.has(marked.status)) outcome = 'published_confirmed';
        else if (marked.status === 'atomic_replace_failed') outcome = 'published_mark_failed';
        else outcome = await inspectAfterMark(settings, row, now, api);
      } else if (classification === 'definite_failure') {
        await api.recordMarketplaceOutboxV2FailedAttempt({ ...exact, failureCode: `http_${response.status}`, httpStatus: response.status });
        outcome = 'publication_failed';
      } else outcome = 'publication_ambiguous';
      outcomes.set(keyOf(row), outcome);
    }
  }
  for (const [key, index] of candidateRefs) if (outcomes.has(key)) results[index] = candidateResult(outcomes.get(key), outcomes.get(key));
  return { outcomes, attemptedBatches };
}
function createMarketplacePublicationCoordinator({ fetchImpl, resolveExactPoint, now = () => new Date().toISOString(), api = outbox } = {}) {
  return {
    async publishMarketplaceCandidates({ settings, candidates = [] } = {}) {
      const list = Array.isArray(candidates) ? candidates : [];
      const destination = await establishDestination(settings, now, api);
      const staged = await stageCandidates({ settings, candidates: list, now, api, destination });
      const confirmed = [];
      for (let index = 0; index < staged.results.length; index += 1) if (staged.results[index].outcome === 'already_published' && list[index]?.currentId !== undefined) confirmed.push(list[index].currentId);
      if (!staged.hardFailure && destination.stage && (destination.post ? (fetchImpl || resolveExactPoint) : resolveExactPoint)) {
        await drainPending({ settings, fetchImpl: destination.post ? fetchImpl : undefined, resolveExactPoint, now, api,
          candidateRefs: staged.refs, results: staged.results });
      }
      for (let index = 0; index < staged.results.length; index += 1) {
        if (['published_confirmed', 'published_mark_uncertain', 'published_mark_failed'].includes(staged.results[index].outcome)
          && list[index]?.currentId !== undefined) confirmed.push(list[index].currentId);
      }
      return { results: staged.results, confirmedCurrentIds: [...new Set(confirmed)] };
    },
  };
}

module.exports = { createMarketplacePublicationCoordinator, stageCandidates, drainPending, buildPublicationBatches, classifyPublicationOutcome, reconcilePostingRevision };
