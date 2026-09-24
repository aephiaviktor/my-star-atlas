'use strict';

function clean(value) {
  return String(value ?? '').trim();
}

function utcDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function positiveInteger(value) {
  const text = clean(value);
  return /^\d+$/.test(text) && BigInt(text) > 0n ? BigInt(text) : null;
}

function lamportsToSolDecimal(lamports) {
  const value = BigInt(lamports);
  const whole = value / 1000000000n;
  const fraction = String(value % 1000000000n).padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const OPERATIONAL_ASSIGNMENTS = new Set(['Mine', 'Scan', 'Transport', 'Supply Chain']);

function recoverFleetTransactionAssignments(records = [], evidenceRows = []) {
  const assignmentsByFleetDay = new Map();
  for (const row of evidenceRows || []) {
    const isoDate = clean(row?.isoDate || utcDay(row?.timestamp));
    const fleetAccount = clean(row?.fleetAccount);
    const assignment = clean(row?.assignment);
    if (!isoDate || !fleetAccount || !OPERATIONAL_ASSIGNMENTS.has(assignment)) continue;
    const key = `${isoDate}\n${fleetAccount}`;
    if (!assignmentsByFleetDay.has(key)) assignmentsByFleetDay.set(key, new Set());
    assignmentsByFleetDay.get(key).add(assignment);
  }

  return (records || []).map((record) => {
    if (clean(record?.eventType) !== 'sol_fee' || clean(record?.assignment)) return record;
    const isoDate = utcDay(record?.timestamp);
    const fleetAccount = clean(record?.fleetAccount);
    const candidates = assignmentsByFleetDay.get(`${isoDate}\n${fleetAccount}`);
    if (!isoDate || !fleetAccount || !candidates || candidates.size !== 1) return record;
    return {
      ...record,
      assignment: Array.from(candidates)[0],
      assignmentProvenance: 'telemetry_fleet_day',
    };
  });
}

function aggregateFleetTransactionEvents(records = [], { assignments = [], faction = '', instance = '' } = {}) {
  const allowedAssignments = new Set(assignments.map(clean).filter(Boolean));
  const expectedFaction = clean(faction);
  const expectedInstance = clean(instance);
  const signatures = new Set();
  const groups = new Map();

  for (const record of records || []) {
    if (clean(record?.eventType) !== 'sol_fee') continue;
    if (!allowedAssignments.has(clean(record?.assignment))) continue;
    if (clean(record?.faction) !== expectedFaction || clean(record?.instance) !== expectedInstance) continue;
    const fleetAccount = clean(record?.fleetAccount);
    const signature = clean(record?.transactionSignature);
    const isoDate = utcDay(record?.timestamp);
    const lamports = positiveInteger(record?.txFeeLamports);
    if (!fleetAccount || !signature || !isoDate || lamports == null) continue;
    const signatureKey = `${expectedFaction}\n${expectedInstance}\n${fleetAccount}\n${signature}`;
    if (signatures.has(signatureKey)) continue;
    signatures.add(signatureKey);

    const key = `${isoDate}\n${fleetAccount}`;
    if (!groups.has(key)) groups.set(key, {
      isoDate,
      fleetAccount,
      fleetLabel: clean(record?.fleetLabel),
      txFeeLamports: 0n,
      txsDaily: 0,
      assignmentRecovered: false,
    });
    const group = groups.get(key);
    group.txFeeLamports += lamports;
    group.txsDaily += 1;
    if (clean(record?.assignmentProvenance) === 'telemetry_fleet_day') group.assignmentRecovered = true;
    const fleetLabel = clean(record?.fleetLabel);
    if (fleetLabel && (!group.fleetLabel || fleetLabel < group.fleetLabel)) group.fleetLabel = fleetLabel;
  }

  return Array.from(groups.values())
    .sort((left, right) => `${left.isoDate}\n${left.fleetAccount}`.localeCompare(`${right.isoDate}\n${right.fleetAccount}`))
    .map((group) => {
      const txFeeLamports = String(group.txFeeLamports);
      const txCostSolExact = lamportsToSolDecimal(txFeeLamports);
      return {
        isoDate: group.isoDate,
        fleetAccount: group.fleetAccount,
        fleetLabel: group.fleetLabel,
        txFeeLamports,
        txCostSolExact,
        txCostSol: Number(txCostSolExact),
        txsDaily: group.txsDaily,
        ...(group.assignmentRecovered ? { assignmentProvenance: 'telemetry_fleet_day' } : {}),
      };
    });
}

function unambiguousFleetDayKeys(rows = [], resolveFleetAccount = () => '') {
  const counts = new Map();
  for (const row of rows) {
    const isoDate = clean(row?.isoDate);
    const fleetAccount = clean(resolveFleetAccount(row));
    if (!isoDate || !fleetAccount) continue;
    const key = `${isoDate}\n${fleetAccount}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set(Array.from(counts.entries()).filter(([, count]) => count === 1).map(([key]) => key));
}

function applyMiningFleetDayTransactionEvidence(row, { fleetAccount = '', unambiguous = false, canonicalRows = [] } = {}) {
  if (!unambiguous) {
    // Multi-material mining day: the canonical signature stream only carries
    // fleet-day totals and cannot be attributed to one raw material. Keep the
    // per-material mining telemetry totals (txCount/txCostSol are tagged with
    // fleet + starbase + rss) when present; otherwise fail closed instead of
    // inventing a split.
    const txsDaily = Number(row?.txsDaily);
    const txCostSol = Number(row?.txCostSol);
    const hasTelemetry = Number.isFinite(txsDaily) && Number.isFinite(txCostSol)
      && (txsDaily > 0 || txCostSol > 0);
    if (!hasTelemetry) {
      return { ...row, txsDaily: null, txCostSol: null, txFeeLamports: null, transactionCostSource: 'unavailable' };
    }
    return { ...row, txFeeLamports: null, transactionCostSource: 'mining_telemetry_per_material' };
  }
  return applyFleetTransactionTotals(row, fleetAccount, canonicalRows);
}

function applyFleetTransactionTotals(row, fleetAccount, canonicalRows = []) {
  const account = clean(fleetAccount);
  const canonical = account ? canonicalRows.find((entry) => clean(entry?.isoDate) === clean(row?.isoDate)
    && clean(entry?.fleetAccount) === account) : null;
  if (!canonical) return {
    ...row,
    txsDaily: null,
    txCostSol: null,
    txFeeLamports: null,
    transactionCostSource: 'unavailable',
  };
  return {
    ...row,
    txsDaily: canonical.txsDaily,
    txCostSol: canonical.txCostSol,
    txFeeLamports: canonical.txFeeLamports,
    transactionCostSource: canonical.assignmentProvenance === 'telemetry_fleet_day'
      ? 'canonical_signature_stream_with_recovered_assignment'
      : 'canonical_signature_stream',
  };
}

module.exports = {
  aggregateFleetTransactionEvents,
  applyFleetTransactionTotals,
  applyMiningFleetDayTransactionEvidence,
  recoverFleetTransactionAssignments,
  unambiguousFleetDayKeys,
};
