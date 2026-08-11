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
  return { scopeKey, acceptCargoAllocationResponse, filterCargoAllocationRows };
});
