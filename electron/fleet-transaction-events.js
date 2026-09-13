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
    });
    const group = groups.get(key);
    group.txFeeLamports += lamports;
    group.txsDaily += 1;
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
    transactionCostSource: 'canonical_signature_stream',
  };
}

module.exports = {
  aggregateFleetTransactionEvents,
  applyFleetTransactionTotals,
  unambiguousFleetDayKeys,
};
