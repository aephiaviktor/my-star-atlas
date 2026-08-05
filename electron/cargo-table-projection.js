'use strict';

function projectCargoTableRow(row, { formatDate } = {}) {
  const isoDate = String(row?.isoDate || '').trim();
  const label = isoDate && typeof formatDate === 'function' ? formatDate(isoDate) : (row?.label || isoDate);
  return { ...row, isoDate, label };
}

function provisionalValuationTooltip(row) {
  const valuations = [row?.fuelValuation, row?.solValuation].filter((value) => value?.status === 'provisional');
  if (!valuations.length) return '';
  const pairs = Array.from(new Set(valuations.map((value) => `${value.eventDay} priced with ${value.priceDay}`)));
  return `Provisional: ${pairs.join('; ')} (frozen seed carry-forward)`;
}

module.exports = { projectCargoTableRow, provisionalValuationTooltip };
