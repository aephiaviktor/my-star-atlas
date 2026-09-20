(function initCargoAllocationRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CargoAllocationRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const normalize = (value) => String(value || '').trim();
  const scopeKey = ({ faction, playerProfile } = {}) => `${normalize(faction).toUpperCase()}|${normalize(playerProfile)}`;
  function acceptCargoAllocationResponse(response, requestScope, currentScope) {
    if (scopeKey(requestScope) !== scopeKey(currentScope)) return { accepted: false, reason: 'stale_scope' };
    const rows = Array.isArray(response?.rows) ? response.rows : [];
    return { accepted: true, state: { ok: response?.ok !== false, cargoAllocationAvailability: response?.availability || 'unavailable', cargoAllocationRows: rows, cargoAllocationError: response?.error || '', cargoAllocationDiagnostics: response?.diagnostics || {}, checkedAt: response?.checkedAt } };
  }
  function filterCargoAllocationRows(rows, { date = '', fleet = '', asset = '' } = {}) {
    return (Array.isArray(rows) ? rows : []).filter((row) =>
      (!normalize(date) || normalize(row.isoDate) === normalize(date))
      && (!normalize(fleet) || normalize(row.fleetName || row.fleet) === normalize(fleet))
      && (!normalize(asset) || normalize(row.asset) === normalize(asset)));
  }
  function formatAllocationNumber(value, { significantDigits = 8, scientificThreshold = 1e-6, maximumFractionDigits = null } = {}) {
    if (value == null || value === '') return '--';
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    if (Object.is(number, 0) || Object.is(number, -0)) return '0';
    if (maximumFractionDigits != null) {
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits,
        useGrouping: true,
      }).format(number);
    }
    const absolute = Math.abs(number);
    if (absolute < scientificThreshold) {
      return number.toExponential(Math.max(0, significantDigits - 1)).replace(/\.0+(?=e)|(?<=\.\d*?)0+(?=e)/, '').replace(/\.e/, 'e');
    }
    return new Intl.NumberFormat(undefined, {
      maximumSignificantDigits: significantDigits,
      useGrouping: true,
    }).format(number);
  }
  const renderedColumnContract = Object.freeze([
    Object.freeze({ id: 'amount', label: 'Cargo Amount', field: 'amount' }),
    Object.freeze({ id: 'cargoVolume', label: 'Cargo Volume', field: 'cargoVolume' }),
    Object.freeze({ id: 'allocatedFuel', label: 'Allocated Fuel', field: 'allocatedFuel' }),
    Object.freeze({ id: 'fuelCosts', label: 'Fuel Cost', field: 'fuelCostsAtlas' }),
    Object.freeze({ id: 'rentalCosts', label: 'Rental Cost', field: 'rentalCostsAtlas' }),
    Object.freeze({ id: 'txsCosts', label: 'TXS Cost', field: 'txsCostsAtlas' }),
    Object.freeze({ id: 'totalCosts', label: 'Total Cargo Costs', field: 'totalCostsAtlas' }),
  ]);
  function getCargoAllocationVisibleColumns(columns = [], selected = new Set()) {
    return columns.filter((column) => selected.has(column.id));
  }
  function buildCargoAllocationRenderedColumns(row = {}, { perUnit = false } = {}) {
    const costIds = new Set(['fuelCosts', 'rentalCosts', 'txsCosts', 'totalCosts']);
    const amount = Number(row.amount);
    return renderedColumnContract.map(({ id, label, field }) => {
      const rawValue = perUnit && costIds.has(id)
        ? (Number.isFinite(amount) && amount > 0 && row[field] != null && Number.isFinite(Number(row[field])) ? Number(row[field]) / amount : null)
        : row[field];
      return Object.freeze({
        id,
        label,
        text: perUnit && costIds.has(id)
          ? formatAllocationNumber(rawValue, { maximumFractionDigits: 6 })
          : ['allocatedFuel', 'fuelCosts', 'rentalCosts', 'txsCosts', 'totalCosts'].includes(id)
            ? formatAllocationNumber(rawValue, { maximumFractionDigits: 0 })
            : formatAllocationNumber(rawValue),
      });
    });
  }
  // Presentation-only join: use the already enriched, faction/profile-scoped
  // Cargo snapshot, never raw movement rows or mutable fleet labels.
  function enrichCargoAllocationFleetDetails(rows = [], cargoRows = []) {
    const key = (row) => normalize(row.fleetAccount) && normalize(row.isoDate)
      ? JSON.stringify([normalize(row.fleetAccount), normalize(row.isoDate)]) : '';
    const byFleetDay = new Map();
    for (const row of cargoRows) {
      const identity = key(row);
      if (identity) byFleetDay.set(identity, byFleetDay.has(identity) ? null : row);
    }
    return rows.map((row) => {
      const metadata = byFleetDay.get(key(row));
      if (!metadata) return row;
      return {
        ...row,
        ships: metadata.ships || [],
        shipTypes: metadata.shipTypes || 0,
        totalRequiredCrew: metadata.totalRequiredCrew ?? null,
        ownership: metadata.ownership || '',
        relationship: metadata.relationship || '',
      };
    });
  }
  function sortCargoAllocationRowsNewestFirst(rows = []) {
    return (Array.isArray(rows) ? rows : []).slice().sort((left, right) => normalize(right?.isoDate).localeCompare(normalize(left?.isoDate)));
  }
  return { enrichCargoAllocationFleetDetails, scopeKey, acceptCargoAllocationResponse, filterCargoAllocationRows, formatAllocationNumber, renderedColumnContract, getCargoAllocationVisibleColumns, buildCargoAllocationRenderedColumns, sortCargoAllocationRowsNewestFirst };
});
