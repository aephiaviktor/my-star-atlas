'use strict';

function assessSnapshotCycle({ rows, expectedIdentities, snapshotId, snapshotAt, complete, expectedRowCount } = {}) {
  if (!snapshotId || !snapshotAt || complete !== true || !Number.isInteger(expectedRowCount)) return { status: 'unavailable', reason: 'missing-cycle-proof' };
  if (!Array.isArray(rows) || !Array.isArray(expectedIdentities)) return { status: 'unavailable', reason: 'missing-manifest' };
  const expected = new Set(expectedIdentities); const seen = new Set();
  for (const row of rows) {
    const key = `${row.location}\n${row.asset}`;
    if (!expected.has(key)) return { status: 'unavailable', reason: 'unknown-identity' };
    if (seen.has(key)) return { status: 'unavailable', reason: 'duplicate-identity' };
    if (row.snapshotId !== snapshotId || row.snapshotAt !== snapshotAt) return { status: 'unavailable', reason: 'mixed-cycle' };
    if (typeof row.quantity !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(row.quantity)) return { status: 'unavailable', reason: 'malformed-quantity' };
    seen.add(key);
  }
  if (expectedRowCount !== expected.size || seen.size !== expected.size) return { status: 'unavailable', reason: 'partial-snapshot' };
  return { status: 'complete', snapshotId, snapshotAt, rows };
}
function assessForwardEvent(event) {
  if (!event || typeof event.identity !== 'string' || !event.identity || typeof event.timestamp !== 'string') return { status: 'unavailable', reason: 'missing-immutable-evidence' };
  if (event.mutableDailyAggregate === true) return { status: 'unavailable', reason: 'mutable-daily-aggregate' };
  return { status: 'immutable', identity: event.identity, timestamp: event.timestamp };
}
function boundaryReplay(events, boundary) {
  const t=Date.parse(boundary); return (events||[]).filter(e=>assessForwardEvent(e).status==='immutable' && Date.parse(e.timestamp)>=t);
}
module.exports={assessSnapshotCycle,assessForwardEvent,boundaryReplay};
