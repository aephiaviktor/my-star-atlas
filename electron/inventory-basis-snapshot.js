'use strict';

const crypto = require('node:crypto');

function text(value) { return String(value || '').trim(); }
function factionText(value) {
  const faction = text(value).toUpperCase();
  return faction === 'UST' ? 'USTUR' : faction;
}
function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function escapeTag(value) { return String(value).replace(/([ ,=])/g, '\\$1'); }
function escapeField(value) { return `"${String(value).replace(/(["\\])/g, '\\$1')}"`; }

function createInventoryBasisSnapshot(input = {}) {
  const faction = factionText(input.faction);
  const starbase = text(input.starbase);
  const asset = text(input.asset);
  const eventId = text(input.eventId);
  const date = new Date(input.timestamp);
  const quantity = finiteNonNegative(input.quantity);
  const uncostedQuantity = finiteNonNegative(input.uncostedQuantity ?? 0);
  if (!faction || !starbase || !asset || !eventId || Number.isNaN(date.getTime())
    || quantity === null || !(quantity > 0) || uncostedQuantity === null || uncostedQuantity > quantity) return null;
  const knownQuantity = quantity - uncostedQuantity;
  if (!(knownQuantity > 0)) return null;
  const costs = input.costs && typeof input.costs === 'object' ? Object.values(input.costs) : [];
  let knownInventoryValueAtlas = 0;
  for (const value of costs) {
    const cost = finiteNonNegative(value);
    if (cost === null) return null;
    knownInventoryValueAtlas += cost;
  }
  const cargoCost = finiteNonNegative(input.cargoCost ?? 0);
  if (cargoCost === null) return null;
  knownInventoryValueAtlas += cargoCost;
  const timestamp = date.toISOString();
  const identity = [faction, starbase, asset, timestamp, eventId].join('\n');
  return {
    snapshotId: crypto.createHash('sha256').update(identity).digest('hex'),
    faction, starbase, asset, timestamp, eventId,
    quantity, knownQuantity, uncostedQuantity, knownInventoryValueAtlas,
    weightedAveragePriceAtlas: knownInventoryValueAtlas / knownQuantity,
  };
}

function formatInventoryBasisSnapshotInfluxLine(snapshot) {
  const [canonical] = projectInventoryBasisSnapshotRows([{ ...snapshot, _time: snapshot?.timestamp }]);
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(snapshot)) return '';
  const tags = [
    ['snapshotId', canonical.snapshotId], ['faction', canonical.faction], ['starbase', canonical.starbase], ['asset', canonical.asset],
  ].map(([key, value]) => `${key}=${escapeTag(value)}`).join(',');
  const fields = [
    `quantity=${canonical.quantity}`,
    `knownQuantity=${canonical.knownQuantity}`,
    `uncostedQuantity=${canonical.uncostedQuantity}`,
    `knownInventoryValueAtlas=${canonical.knownInventoryValueAtlas}`,
    `weightedAveragePriceAtlas=${canonical.weightedAveragePriceAtlas}`,
    `eventId=${escapeField(canonical.eventId)}`,
  ].join(',');
  return `inventory_basis_snapshot,${tags} ${fields} ${BigInt(Date.parse(canonical.timestamp)) * 1000000n}`;
}

function projectInventoryBasisSnapshotRows(rows) {
  return (rows || []).flatMap((row) => {
    const snapshot = createInventoryBasisSnapshot({
      faction: row?.faction, starbase: row?.starbase, asset: row?.asset, timestamp: row?._time,
      eventId: row?.eventId, quantity: row?.quantity, uncostedQuantity: row?.uncostedQuantity,
      costs: { basis: row?.knownInventoryValueAtlas }, cargoCost: 0,
    });
    if (!snapshot || snapshot.snapshotId !== text(row?.snapshotId)) return [];
    const knownQuantity = finiteNonNegative(row?.knownQuantity);
    const weightedAveragePriceAtlas = finiteNonNegative(row?.weightedAveragePriceAtlas);
    if (knownQuantity === null || Math.abs(knownQuantity - snapshot.knownQuantity) > 1e-9
      || weightedAveragePriceAtlas === null || Math.abs(weightedAveragePriceAtlas - snapshot.weightedAveragePriceAtlas) > 1e-9) return [];
    return [snapshot];
  });
}

module.exports = {
  createInventoryBasisSnapshot,
  formatInventoryBasisSnapshotInfluxLine,
  projectInventoryBasisSnapshotRows,
};
