'use strict';
const SOURCES = ['scanning', 'mining', 'crafting', 'lm', 'gm'];
// Bounded acquisition cohorts. Ingredient GM costs remain in the crafted cohort,
// never masquerading as purchases of the finished asset.
function mergeOrigins(...groups) {
  const map = new Map();
  for (const part of groups.flatMap((group) => group || [])) {
    if (!(part.quantity > 1e-12)) continue;
    const key = `${part.source}:${Boolean(part.uncosted)}`;
    if (!map.has(key)) map.set(key, { source: part.source, uncosted: Boolean(part.uncosted), quantity: 0, costs: Object.fromEntries(SOURCES.map((s) => [s, 0])), cargoCost: 0 });
    const row = map.get(key);
    row.quantity += part.quantity;
    for (const source of SOURCES) row.costs[source] += part.costs?.[source] || 0;
    row.cargoCost += part.cargoCost || 0;
  }
  return [...map.values()];
}
function scaleOrigins(parts, knownRatio, unknownRatio) {
  return mergeOrigins((parts || []).map((part) => {
    const ratio = part.uncosted ? unknownRatio : knownRatio;
    return { ...part, quantity: part.quantity * ratio, costs: Object.fromEntries(SOURCES.map((s) => [s, (part.costs?.[s] || 0) * ratio])), cargoCost: part.cargoCost * ratio };
  }));
}
function validateOrigins(parts = [], quantity, uncostedQuantity) {
  if (!Array.isArray(parts) || parts.length > 10) throw new Error('invalid inventory origins');
  let known = 0, unknown = 0;
  for (const part of parts) {
    if (!SOURCES.includes(part.source) || typeof part.uncosted !== 'boolean') throw new Error('invalid inventory origin');
    for (const value of [part.quantity, part.cargoCost, ...SOURCES.map((s) => part.costs?.[s] ?? 0)]) {
      if (!Number.isFinite(value) || value < 0) throw new Error('invalid inventory origin value');
    }
    if (part.uncosted) unknown += part.quantity; else known += part.quantity;
  }
  const tolerance = 1e-8 * Math.max(1, quantity);
  if (known > quantity - uncostedQuantity + tolerance || unknown > uncostedQuantity + tolerance) throw new Error('inventory origins exceed pool quantity');
  return mergeOrigins(parts);
}
function sourceUnitMetrics(parts = []) {
  const sourceUnitCosts = {}, sourceQuantities = {};
  for (const source of SOURCES) {
    const matching = parts.filter((p) => !p.uncosted && (p.source === source || (source === 'mining' && p.source === 'crafting')));
    const quantity = matching.reduce((sum, p) => sum + p.quantity, 0);
    sourceQuantities[source] = quantity;
    sourceUnitCosts[source] = quantity > 0 ? matching.reduce((sum, p) => sum + (p.costs[source] || 0), 0) / quantity : null;
  }
  return { sourceUnitCosts, sourceQuantities };
}
module.exports = { mergeOrigins, scaleOrigins, validateOrigins, sourceUnitMetrics };
