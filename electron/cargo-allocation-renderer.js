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
  function formatAllocationNumber(value, { significantDigits = 8, scientificThreshold = 1e-6 } = {}) {
    if (value == null || value === '') return '--';
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    if (Object.is(number, 0) || Object.is(number, -0)) return '0';
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
    Object.freeze({ id: 'fuelCosts', label: 'Fuel Costs', field: 'fuelCostsAtlas' }),
    Object.freeze({ id: 'txsCosts', label: 'TXS Costs', field: 'txsCostsAtlas' }),
    Object.freeze({ id: 'totalCosts', label: 'Total Cargo Costs', field: 'totalCostsAtlas' }),
    Object.freeze({ id: 'costsPerUnit', label: 'Cargo Cost/Unit', field: 'costsPerUnitAtlas' }),
  ]);
  function getCargoAllocationVisibleColumns(columns = [], selected = new Set()) {
    const requiredIds = new Set(renderedColumnContract.map(({ id }) => id));
    return columns.filter((column) => column.id === 'assignment' ? selected.has(column.id) : requiredIds.has(column.id));
  }
  function buildCargoAllocationRenderedColumns(row = {}) {
    return renderedColumnContract.map(({ id, label, field }) => Object.freeze({
      id,
      label,
      text: formatAllocationNumber(row[field]),
    }));
  }
  return { scopeKey, acceptCargoAllocationResponse, filterCargoAllocationRows, formatAllocationNumber, renderedColumnContract, getCargoAllocationVisibleColumns, buildCargoAllocationRenderedColumns };
});
