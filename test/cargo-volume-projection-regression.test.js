'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCargoVolumeByFleetDay, calculateCargoEfficiency, calculateFleetCargoCapacity } = require('../electron/earnings-math');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const start = main.indexOf('async function fetchEarningsSnapshot');
const end = main.indexOf('\nfunction createWindow', start);
const productionFunctionSource = main.slice(start, end);
const IN_SCOPE = 'A'.repeat(44);
const OUT_OF_SCOPE = 'B'.repeat(44);
const CYCLE = `${IN_SCOPE}:10,20:1786400000000`;
const OTHER_CYCLE = `${OUT_OF_SCOPE}:10,20:1786400000001`;
const DAY = '2026-08-10';

function prices() {
  return { sduPriceAtl: null, ammunitionPriceAtl: null, foodPriceAtl: null, fuelPriceAtl: null, resourcePricesAtlByName: {}, atlasPerSol: null, solPriceAtl: null, atlasPriceAtl: null, atlasPerSolSource: '' };
}

async function executeProductionSnapshot({ rejectCategory = '' } = {}) {
  const categoryCalls = [];
  const categoryResult = (name, value) => {
    categoryCalls.push(name);
    if (rejectCategory === name) throw new Error(`${name.toLowerCase()} fixture unavailable`);
    return value;
  };
  const cargoRow = {
    isoDate: DAY, fleet: 'Scoped Fleet', fleetAccount: IN_SCOPE, assignment: 'Transport',
    completedCycleIds: [CYCLE], cargoCycles: 1, cargoLegs: 2, burnedFuel: 0, txCostSol: 0,
    starbases: ['A', 'B'], sourceMode: 'legacy', costSourceSelection: {},
  };
  const volumeRows = [
    { isoDate: DAY, fleetAccount: IN_SCOPE, cycleId: CYCLE, cargoVolume: 50 },
    { isoDate: DAY, fleetAccount: OUT_OF_SCOPE, cycleId: OTHER_CYCLE, cargoVolume: 900 },
  ];
  class PublicKey { constructor(value) { this.value = value; } toBase58() { return this.value; } }
  const scope = {
    Promise, Array, Object, String, Number, Boolean, BigInt, Date, Map, Set, Math, JSON, Error, PublicKey,
    profileName: 'USTUR', RAW_COST_CUTOVER_MANIFEST_VERSION: 1,
    normalizeSettings: (value) => value,
    readSettings: async () => ({ faction: 'MUD' }),
    fetchProfileFleets: async () => ({ fleets: [{ key: IN_SCOPE, label: 'Scoped Fleet', fleetShips: 'fleet-ships', relationship: 'owned', faction: 1 }] }),
    createSolanaConnection: () => ({ getMultipleAccountsInfo: async (keys) => keys.map(() => ({ data: Buffer.alloc(256) })) }),
    fetchCurrentEarningsPrices: async () => prices(),
    fetchShipStatsSot: async () => ({ source: 'fixture', byName: new Map([['testship', { sduPerScan: 0, requiredCrew: 1, cargoCapacity: 50 }]]) }),
    atlasPriceResolver: { captureCurrentPriceSeeds: async () => {}, resolveAtlasPrice: async () => ({ status: 'complete', priceATL: 0, effectiveUtcDate: DAY }) },
    parseFleetShipsAccount: () => [{ shipAccount: 'ship-account', amount: 1 }],
    parseShipAccount: (_data, key) => ({ key, name: 'TestShip' }),
    normalizeShipName: (value) => String(value).toLowerCase(),
    calculateFleetCargoCapacity,
    deriveRentalContract: () => new PublicKey('rental'), srslyFieldOffsets: { contractRate: 0 }, normalizeAtlasRate: (v) => v,
    normalizeFleetLabel: (value) => String(value || '').trim().toLowerCase(), normalizeFaction: (v) => v === 'UST' ? 'USTUR' : v,
    fetchScanningEarningsRows: async () => categoryResult('Scanning', []),
    fetchMiningEarningsRows: async () => categoryResult('Mining', []),
    fetchCargoEarningsRows: async () => categoryResult('Cargo', [cargoRow]),
    fetchCraftingEarningsRows: async () => { const rows = []; rows.ledgerEvents = []; return categoryResult('Crafting', rows); },
    fetchUpgradingEarningsRows: async () => { const rows = []; rows.ledgerEvents = []; return categoryResult('Upgrading', rows); },
    fetchCanonicalRawCargoCosts: async () => ({ records: [], rejected: [], query: '' }),
    fetchCargoVolumeEarningsRows: async () => ({ rows: volumeRows, durationMs: 1, returnedRecordCount: 2 }),
    exporterForFaction: () => null,
    valueCanonicalRawCosts: async () => [], aggregateRawCostsByFleetDay: () => [], projectCargoTableRow: (row) => row,
    selectCutoverOwnedCargoRows: ({ legacyRows, operationalRows }) => ({ legacyRows, operationalRows }),
    joinCanonicalCostsWithOperationalRows: ({ legacyRows }) => legacyRows,
    getCurrentResourcePriceAtl: () => null,
    requireCargoFuelPrice: (v) => v, requireSameDateCargoPrice: (v) => v,
    projectCargoFleetDateRows: (rows) => rows,
    cargoCostSourceSelectionStats: () => ({}), buildCargoCostPool: () => ({ costs: [], pending: [] }),
    buildCanonicalRawCostPool: () => ({ costs: [], pending: [] }), mergeCargoCostPools: () => ({ costs: [], pending: [] }),
    buildCargoVolumeByFleetDay, calculateCargoEfficiency,
    formatShortUtcDate: (d) => d.toISOString().slice(0, 10),
    fetchMarketplaceAssetFlowsFromInflux: async () => [],
    readInventoryBasisSnapshots: async () => [], queryInfluxFlux: async () => '', parseInfluxCsv: () => [],
    buildFactionCustodyLedgerEvents: () => ({ events: [], rejected: [] }), ledgerCheckpointPath: () => '/unused',
    loadLedgerCheckpoint: async () => ({ status: 'skipped', ledger: null, seenEventFingerprints: [], eventResultByFingerprint: {}, eventFingerprintCounts: {}, eventResultsByFingerprint: {}, savedAt: null }),
    buildCostLedgerResult: () => ({ events: [], appliedEventResults: [], ledger: { snapshot: () => [] }, rejectedEvents: [], seenEventFingerprints: [], eventResultByFingerprint: {}, eventFingerprintCounts: {}, eventResultsByFingerprint: {} }),
    buildCraftingBasisByDay: () => new Map(), buildLedgerBreakevenRows: () => [],
    fetchCurrentPerStarbaseInventory: async () => [], fetchFactionStarbases: async () => [], isStarbaseIncluded: () => true,
    enrichCraftingEarningsRows: ({ rows }) => rows || [], enrichUpgradingEarningsRows: ({ rows }) => rows || [],
    getUtcDateKey: (date) => date.toISOString().slice(0, 10),
  };
  const fallback = () => [];
  const globals = new Proxy(scope, {
    has: (_target, key) => !['scope', 'payload', 'diagnosticContext', 'fn', 'scopedCargoFleetAccounts'].includes(String(key)),
    get(target, key) {
      if (key === Symbol.unscopables) return undefined;
      if (key in target) return target[key];
      return fallback;
    },
  });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const invoke = new AsyncFunction('scope', 'payload', 'diagnosticContext', `with (scope) { const fn = ${productionFunctionSource}; return fn(payload, diagnosticContext); }`);
  const diagnosticContext = { stage: 'preflight', categories: {} };
  const result = await invoke(globals, { faction: 'MUD', earningsScope: 'scanning' }, diagnosticContext);
  return { result, categoryCalls, diagnosticContext };
}

test('actual shared Earnings Cargo-volume projection scopes fleet/cycle without invoking Allocation', async () => {
  const { result, categoryCalls, diagnosticContext } = await executeProductionSnapshot();
  assert.equal(result.ok, true);
  assert.deepEqual(categoryCalls.sort(), ['Cargo', 'Crafting', 'Mining', 'Scanning', 'Upgrading']);
  assert.deepEqual(Object.values(diagnosticContext.categories).map((entry) => entry.status), Array(5).fill('fulfilled'));
  assert.equal(result.cargoRows.length, 1);
  assert.equal(result.cargoRows[0].cargoVolume, 50);
  assert.equal(result.cargoRows[0].cargoCapacity, 100);
  assert.equal(result.cargoRows[0].cargoEfficiencyPercent, 50);
  assert.equal(result.cargoFetchDiagnostics.volume.completedCycleMatches, 1);
  assert.equal(Object.hasOwn(result, 'cargoAllocationRows'), false);
  assert.equal(Object.hasOwn(result, 'cargoAllocationError'), false);
});

test('actual snapshot keeps existing partial-result semantics when one category rejects', async () => {
  const { result, diagnosticContext } = await executeProductionSnapshot({ rejectCategory: 'Mining' });
  assert.equal(result.ok, true);
  assert.match(result.miningError, /mining fixture unavailable/);
  assert.equal(result.cargoRows[0].cargoVolume, 50);
  assert.equal(diagnosticContext.categories.Mining.status, 'rejected');
  for (const name of ['Scanning', 'Cargo', 'Crafting', 'Upgrading']) {
    assert.equal(diagnosticContext.categories[name].status, 'fulfilled');
  }
  assert.equal(Object.hasOwn(result, 'cargoAllocationRows'), false);
});
