'use strict';

const EPSILON = 1e-9;

function reconcileInventoryLedger({ ledger, inventoryRows = [] } = {}) {
  if (!ledger || typeof ledger.get !== 'function') throw new Error('ledger is required');
  const adjustments = [];
  const rows = [...(inventoryRows || [])].sort((left, right) => (
    String(left?.starbase || '').localeCompare(String(right?.starbase || ''))
      || String(left?.asset || '').localeCompare(String(right?.asset || ''))
  ));
  for (const row of rows) {
    const location = String(row?.starbase || '').trim();
    const asset = String(row?.asset || '').trim();
    const quantity = Number(row?.quantity);
    if (!location || !asset || !Number.isFinite(quantity) || quantity < 0) continue;
    const ledgerQuantity = Number(ledger.get(location, asset).quantity || 0);
    const variance = quantity - ledgerQuantity;
    if (variance > EPSILON) {
      ledger.acquire({ location, asset, quantity: variance });
      adjustments.push({
        type: 'acquire', purpose: 'inventory-reconciliation', location, asset,
        quantity: variance, timestamp: row.lastDate || new Date().toISOString(),
      });
    } else if (variance < -EPSILON) {
      const consumed = ledger.consume({ location, asset, quantity: -variance });
      adjustments.push({
        type: 'consume', purpose: 'inventory-reconciliation', location, asset,
        quantity: -variance, timestamp: row.lastDate || new Date().toISOString(), result: consumed,
      });
    }
  }
  return adjustments;
}

module.exports = { reconcileInventoryLedger };
