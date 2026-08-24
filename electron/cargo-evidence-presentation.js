(function initCargoEvidencePresentation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CargoEvidencePresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';

  const EXACT_DECIMAL = /^(0|[1-9]\d*)(?:\.(\d+))?$/;
  const text = (value) => String(value ?? '').trim();

  function formatExactCargoQuantity(value) {
    const canonical = text(value);
    const match = canonical.match(EXACT_DECIMAL);
    if (!match) return '--';
    const [integer, fraction] = canonical.split('.');
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction === undefined ? grouped : `${grouped}.${fraction}`;
  }

  function suppliedInvalidStatus(row) {
    const status = text(row?.evidenceStatus);
    return /invalid|conflict|quarantin/i.test(status) ? status : '';
  }

  function authoritative(row) {
    return row?.evidenceAuthority === 'authoritative_v1'
      && /^cargo-delivery:v1:/.test(text(row.deliveryEventId))
      && /^(0|[1-9]\d*)$/.test(text(row.confirmedBlockTime))
      && Number.isInteger(row.replayCount) && row.replayCount >= 1
      && !suppliedInvalidStatus(row);
  }

  function timeKey(row) {
    if (authoritative(row)) return BigInt(row.confirmedBlockTime) * 1000n;
    const milliseconds = Date.parse(text(row?.timestamp));
    return Number.isFinite(milliseconds) ? BigInt(milliseconds) : -1n;
  }

  function prepareCargoEvidenceRows(inputRows = []) {
    const rows = Array.isArray(inputRows) ? inputRows : [];
    const seenConfirmed = new Set();
    const prepared = [];
    for (const row of rows) {
      const isConfirmed = authoritative(row);
      const eventId = text(row?.deliveryEventId);
      if (isConfirmed && seenConfirmed.has(eventId)) continue;
      if (isConfirmed) seenConfirmed.add(eventId);
      const invalidStatus = suppliedInvalidStatus(row);
      const replayCount = isConfirmed ? row.replayCount : null;
      const suppliedStatus = text(row?.evidenceStatus);
      const confirmedDetail = suppliedStatus && !/^Authoritative\b/i.test(suppliedStatus) ? ` · ${suppliedStatus}` : '';
      const displayStatus = invalidStatus || (isConfirmed
        ? `Confirmed${replayCount > 1 ? ` · replay ×${replayCount}` : ''}${confirmedDetail}`
        : row?.evidenceAuthority === 'legacy_unverified' ? 'Legacy — unverified estimate'
          : suppliedStatus || 'Incomplete — status unavailable');
      prepared.push({
        ...row,
        isConfirmed,
        displayQuantity: formatExactCargoQuantity(row?.deliveredQuantity),
        displayStatus,
        statusTitle: isConfirmed && replayCount > 1
          ? `${replayCount} identical evidence rows collapsed into one delivery`
          : displayStatus,
      });
    }
    return prepared.sort((left, right) => {
      const leftTime = timeKey(left), rightTime = timeKey(right);
      if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1;
      const leftId = left.isConfirmed ? text(left.deliveryEventId) : text(left.betaId);
      const rightId = right.isConfirmed ? text(right.deliveryEventId) : text(right.betaId);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
  }

  return { formatExactCargoQuantity, prepareCargoEvidenceRows };
});
