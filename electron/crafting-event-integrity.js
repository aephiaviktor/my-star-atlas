'use strict';

function normalizeAsset(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function craftingEventKey(row) {
  const craftingId = String(row?.craftingID || '').trim();
  if (craftingId) return `id:${craftingId}`;
  return `fallback:${String(row?._time || '')}\n${String(row?.starbase || '')}\n${String(row?.output || '')}`;
}

function excludeSelfReferentialCraftingEvents(rows = []) {
  const invalidKeys = new Set();
  for (const row of rows || []) {
    if (row?._field !== 'amount' || row?.type !== 'Input') continue;
    const input = normalizeAsset(row.input);
    const output = normalizeAsset(row.output);
    if (input && output && input === output) invalidKeys.add(craftingEventKey(row));
  }
  return Array.from(rows || []).filter((row) => !invalidKeys.has(craftingEventKey(row)));
}

module.exports = { excludeSelfReferentialCraftingEvents };
