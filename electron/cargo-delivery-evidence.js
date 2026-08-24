'use strict';

const crypto = require('node:crypto');

const EVIDENCE_PREFIX = 'delivery';
const DELIVERY_EVIDENCE_FIELDS = Object.freeze([
  'deliveryEvidenceSchemaVersion', 'deliveryMovementType', 'deliverySignature',
  'deliveryOuterInstructionIndex', 'deliveryConfirmedSlot', 'deliveryConfirmedBlockTime',
  'deliveryRawAmount', 'deliveryMintDecimals', 'deliveryDecimalAmount',
  'deliveryEventId', 'deliveryEvidencePayloadHash', 'deliveryProgramId',
  'deliveryFleetAccount', 'deliveryFactionProfile', 'deliveryProfileAccount',
  'deliveryRoute', 'deliveryAllocationId', 'deliveryIndex', 'cycleDeliveryCount', 'assetMint',
]);
const REQUIRED_V1_FIELDS = Object.freeze([
  'deliveryEvidenceSchemaVersion', 'deliveryMovementType', 'deliverySignature',
  'deliveryOuterInstructionIndex', 'deliveryConfirmedSlot', 'deliveryConfirmedBlockTime',
  'deliveryRawAmount', 'deliveryMintDecimals', 'deliveryDecimalAmount',
  'deliveryEventId', 'deliveryEvidencePayloadHash', 'deliveryProgramId',
  'deliveryFleetAccount', 'deliveryFactionProfile', 'deliveryProfileAccount',
  'deliveryRoute', 'deliveryAllocationId', 'assetMint', 'fleet', 'cycleId',
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clean(value) {
  return String(value ?? '').trim();
}

function unsignedInteger(value, { maximum = null } = {}) {
  const text = clean(value);
  if (!/^(0|[1-9]\d*)$/.test(text)) return null;
  const integer = BigInt(text);
  if (maximum != null && integer > BigInt(maximum)) return null;
  return { text, integer };
}

function canonicalDecimalAmount(rawAmount, mintDecimals) {
  const raw = unsignedInteger(rawAmount);
  const decimals = unsignedInteger(mintDecimals, { maximum: 255 });
  if (!raw || !decimals) return null;
  const scale = Number(decimals.integer);
  if (scale === 0) return raw.integer.toString();
  const digits = raw.integer.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function expectedEventId(row) {
  return `cargo-delivery:v1:${clean(row.deliveryProgramId)}:${clean(row.deliverySignature)}:${clean(row.deliveryOuterInstructionIndex)}:unload`;
}

function payloadForRow(row) {
  return {
    schemaVersion: Number(clean(row.deliveryEvidenceSchemaVersion)),
    movementType: clean(row.deliveryMovementType),
    signature: clean(row.deliverySignature),
    outerInstructionIndex: Number(clean(row.deliveryOuterInstructionIndex)),
    programId: clean(row.deliveryProgramId),
    slot: Number(clean(row.deliveryConfirmedSlot)),
    blockTime: Number(clean(row.deliveryConfirmedBlockTime)),
    rawAmount: clean(row.deliveryRawAmount),
    mintDecimals: Number(clean(row.deliveryMintDecimals)),
    decimalAmount: clean(row.deliveryDecimalAmount),
    mint: clean(row.assetMint),
    fleetAccount: clean(row.deliveryFleetAccount),
    fleetLabel: clean(row.fleet),
    factionProfile: clean(row.deliveryFactionProfile),
    profileAccount: clean(row.deliveryProfileAccount),
    route: clean(row.deliveryRoute),
    cycleId: clean(row.cycleId),
    allocationId: clean(row.deliveryAllocationId),
    eventId: clean(row.deliveryEventId),
  };
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(stableJson(payload)).digest('hex');
}

function hasAnyEvidence(row) {
  return Object.keys(row || {}).some((key) => key.startsWith(EVIDENCE_PREFIX) && clean(row[key]));
}

function validateEvidenceRow(row) {
  if (!hasAnyEvidence(row)) return { classification: 'legacy_unverified', reasons: ['delivery evidence not present'] };
  const reasons = [];
  for (const field of REQUIRED_V1_FIELDS) if (!clean(row[field])) reasons.push(`${field} missing`);
  if (clean(row.deliveryEvidenceSchemaVersion) !== '1') reasons.push('unsupported evidence schema version');
  if (clean(row.deliveryMovementType) !== 'unload') reasons.push('unsupported movement type');
  const instruction = unsignedInteger(row.deliveryOuterInstructionIndex, { maximum: Number.MAX_SAFE_INTEGER });
  const slot = unsignedInteger(row.deliveryConfirmedSlot, { maximum: Number.MAX_SAFE_INTEGER });
  const blockTime = unsignedInteger(row.deliveryConfirmedBlockTime, { maximum: Number.MAX_SAFE_INTEGER });
  const decimals = unsignedInteger(row.deliveryMintDecimals, { maximum: 255 });
  const raw = unsignedInteger(row.deliveryRawAmount);
  if (!instruction) reasons.push('outer instruction index invalid');
  if (!slot) reasons.push('confirmed slot invalid');
  if (!blockTime) reasons.push('confirmed block time invalid');
  if (!raw) reasons.push('raw amount invalid');
  if (!decimals) reasons.push('mint decimals invalid');
  const canonicalAmount = canonicalDecimalAmount(row.deliveryRawAmount, row.deliveryMintDecimals);
  if (canonicalAmount == null || clean(row.deliveryDecimalAmount) !== canonicalAmount) reasons.push('decimal amount is not canonical for raw amount and mint decimals');
  const eventId = expectedEventId(row);
  if (clean(row.deliveryEventId) !== eventId) reasons.push('event ID mismatch');
  const hash = clean(row.deliveryEvidencePayloadHash).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) reasons.push('payload hash invalid');
  else if (payloadHash(payloadForRow(row)) !== hash) reasons.push('payload hash mismatch');
  return reasons.length
    ? { classification: 'evidence_invalid', reasons, canonicalAmount }
    : { classification: 'authoritative', reasons: [], canonicalAmount, eventId, payloadHash: hash };
}

function provenanceForRow(row) {
  return {
    timestamp: clean(row._time), cycleId: clean(row.cycleId), allocationIndex: clean(row.allocationIndex),
    allocationId: clean(row.deliveryAllocationId), fleet: clean(row.fleet), asset: clean(row.rss),
  };
}

function compareProvenance(left, right) {
  return left.timestamp.localeCompare(right.timestamp)
    || left.cycleId.localeCompare(right.cycleId)
    || left.allocationIndex.localeCompare(right.allocationIndex)
    || left.allocationId.localeCompare(right.allocationId);
}

function logicalDelivery(row, validation, provenance) {
  const timestamp = clean(row._time);
  return {
    deliveryEventId: validation.eventId,
    payloadHash: validation.payloadHash,
    schemaVersion: '1',
    movementType: clean(row.deliveryMovementType),
    signature: clean(row.deliverySignature),
    outerInstructionIndex: clean(row.deliveryOuterInstructionIndex),
    programId: clean(row.deliveryProgramId),
    confirmedSlot: clean(row.deliveryConfirmedSlot),
    confirmedBlockTime: clean(row.deliveryConfirmedBlockTime),
    rawAmount: clean(row.deliveryRawAmount),
    mintDecimals: clean(row.deliveryMintDecimals),
    decimalAmount: validation.canonicalAmount,
    assetMint: clean(row.assetMint),
    fleetAccount: clean(row.deliveryFleetAccount),
    fleetLabel: clean(row.fleet),
    factionProfile: clean(row.deliveryFactionProfile),
    profileAccount: clean(row.deliveryProfileAccount),
    route: clean(row.deliveryRoute),
    cycleId: clean(row.cycleId),
    allocationId: clean(row.deliveryAllocationId),
    timestamp,
    isoDate: Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString().slice(0, 10) : '',
    asset: clean(row.rss),
    origin: clean(row.originStarbase),
    destination: clean(row.deliveryStarbase),
    assignment: clean(row.assignment),
    faction: clean(row.faction),
    instance: clean(row.instance),
    replayCount: provenance.length,
    provenance,
  };
}

function exactDecimalSum(values) {
  const parsed = values.map((value) => {
    const match = clean(value).match(/^(\d+)(?:\.(\d+))?$/);
    if (!match) return null;
    const fraction = match[2] || '';
    return { atoms: BigInt(`${match[1]}${fraction}`), decimals: fraction.length };
  });
  if (parsed.some((value) => value == null)) return null;
  const decimals = parsed.reduce((maximum, value) => Math.max(maximum, value.decimals), 0);
  const atoms = parsed.reduce((sum, value) => sum + value.atoms * (10n ** BigInt(decimals - value.decimals)), 0n);
  return canonicalDecimalAmount(atoms.toString(), String(decimals));
}

function projectCargoDeliveryEvidence(allocationRows = []) {
  const rows = Array.from(allocationRows || []);
  const evidenceRows = rows.map((row, index) => ({ row, index, ...validateEvidenceRow(row) }));
  const groups = new Map();
  for (const entry of evidenceRows) {
    const eventId = clean(entry.row.deliveryEventId);
    if (!eventId) continue;
    if (!groups.has(eventId)) groups.set(eventId, []);
    groups.get(eventId).push(entry);
  }
  const logicalDeliveries = [];
  const conflicts = [];
  for (const eventId of Array.from(groups.keys()).sort()) {
    const entries = groups.get(eventId);
    const hashes = new Set(entries.map((entry) => clean(entry.row.deliveryEvidencePayloadHash).toLowerCase()).filter(Boolean));
    if (hashes.size > 1) {
      const provenance = entries.map((entry) => provenanceForRow(entry.row)).sort(compareProvenance);
      for (const entry of entries) Object.assign(entry, { classification: 'evidence_conflict', reasons: ['same delivery event ID has different payload hashes'] });
      conflicts.push({ classification: 'evidence_conflict', deliveryEventId: eventId, payloadHashes: Array.from(hashes).sort(), provenance });
      continue;
    }
    if (entries.some((entry) => entry.classification !== 'authoritative')) continue;
    const provenance = entries.map((entry) => provenanceForRow(entry.row)).sort(compareProvenance);
    const representative = entries.slice().sort((left, right) => compareProvenance(provenanceForRow(left.row), provenanceForRow(right.row)))[0];
    const delivery = logicalDelivery(representative.row, representative, provenance);
    logicalDeliveries.push(delivery);
    if (entries.length > 1) for (const entry of entries) entry.classification = 'authoritative_replay';
  }
  logicalDeliveries.sort((left, right) => left.deliveryEventId.localeCompare(right.deliveryEventId));
  conflicts.sort((left, right) => left.deliveryEventId.localeCompare(right.deliveryEventId));
  return {
    allocationRows: rows,
    logicalDeliveries,
    conflicts,
    evidenceRows: evidenceRows.map(({ row, index, canonicalAmount, eventId, payloadHash: hash, ...entry }) => ({
      allocationIndex: clean(row.allocationIndex),
      deliveryEventId: clean(row.deliveryEventId),
      classification: entry.classification,
      reasons: entry.reasons,
    })),
  };
}

function joinCargoDeliveryAllocations(projection, { limit = Infinity } = {}) {
  const allocationRows = Array.from(projection?.allocationRows || []);
  const logicalDeliveries = Array.from(projection?.logicalDeliveries || []);
  const keyFor = (row) => `${clean(row.cycleId)}\n${clean(row.assetMint)}`;
  const deliveriesByKey = new Map();
  for (const delivery of logicalDeliveries) {
    const key = keyFor(delivery);
    if (!deliveriesByKey.has(key)) deliveriesByKey.set(key, []);
    deliveriesByKey.get(key).push(delivery);
  }
  const joinedDeliveries = [];
  const ambiguous = [];
  const consumedRows = new Set();
  for (const [key, deliveries] of Array.from(deliveriesByKey.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    const candidates = allocationRows.filter((row) => keyFor(row) === key);
    const untagged = candidates.filter((row) => !clean(row.deliveryEventId));
    if (!candidates.length || (deliveries.length > 1 && untagged.length)) {
      for (const delivery of deliveries) ambiguous.push({ deliveryEventId: delivery.deliveryEventId, reason: 'ambiguous_allocation_evidence_join' });
      continue;
    }
    for (const delivery of deliveries) {
      const matched = deliveries.length === 1 ? candidates : candidates.filter((row) => clean(row.deliveryEventId) === delivery.deliveryEventId);
      if (!matched.length) {
        ambiguous.push({ deliveryEventId: delivery.deliveryEventId, reason: 'allocation_evidence_join_missing' });
        continue;
      }
      matched.forEach((row) => consumedRows.add(row));
      const allocatedFuelExact = exactDecimalSum(matched.map((row) => row.allocatedFuel));
      const allocatedTxCostSolExact = exactDecimalSum(matched.map((row) => row.allocatedTxCostSol));
      const cargoVolumeExact = exactDecimalSum(matched.map((row) => row.cargoVolume));
      if (allocatedFuelExact == null || allocatedTxCostSolExact == null || cargoVolumeExact == null) {
        ambiguous.push({ deliveryEventId: delivery.deliveryEventId, reason: 'allocation_cost_evidence_invalid' });
        continue;
      }
      joinedDeliveries.push({ ...delivery, allocationRows: matched, allocatedFuelExact, allocatedTxCostSolExact, cargoVolumeExact });
    }
  }
  joinedDeliveries.sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.deliveryEventId.localeCompare(right.deliveryEventId));
  const boundedLimit = Number.isInteger(limit) && limit >= 0 ? limit : Infinity;
  return {
    allocationRows,
    logicalDeliveryCount: joinedDeliveries.length,
    joinedDeliveries: joinedDeliveries.slice(0, boundedLimit),
    ambiguous: ambiguous.sort((left, right) => left.deliveryEventId.localeCompare(right.deliveryEventId)),
    legacyAllocations: allocationRows.filter((row) => !consumedRows.has(row) && !clean(row.deliveryEventId)),
  };
}

module.exports = {
  DELIVERY_EVIDENCE_FIELDS,
  REQUIRED_V1_FIELDS,
  stableJson,
  canonicalDecimalAmount,
  expectedEventId,
  payloadForRow,
  payloadHash,
  validateEvidenceRow,
  exactDecimalSum,
  projectCargoDeliveryEvidence,
  joinCargoDeliveryAllocations,
};
