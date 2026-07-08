const api = window.myStarAtlas;

const sectionLabels = {
  production: 'Production/Consumption',
  fleet: 'My Fleet',
  optimization: 'Optimization',
  earnings: 'Earnings',
};

const subtabLabels = {
  scanning: 'Scanning',
  mining: 'Mining',
  crafting: 'Crafting',
  production: 'Production',
  consumption: 'Consumption',
  'pct-charts': 'PCR Charts',
  inventory: 'Inventory',
};

const form = document.querySelector('#settings-form');
const saveStatus = document.querySelector('#save-status');
const settingsStatus = document.querySelector('#settings-status');
const syncDot = document.querySelector('.sync-dot');
const toggleSensitiveButton = document.querySelector('#toggle-sensitive-btn');
const testInfluxButton = document.querySelector('#test-influx-btn');
const fleetSearchInput = document.querySelector('#fleet-search-input');
const openSettingsButton = document.querySelector('#open-settings-btn');
const closeSettingsButton = document.querySelector('#close-settings-btn');
const settingsOverlay = document.querySelector('#settings-overlay');
const sectionEyebrow = document.querySelector('#section-eyebrow');
const sectionTitle = document.querySelector('#section-title');
const profileLabel = document.querySelector('#profile-label');
const versionLabel = document.querySelector('#version-label');
const measurementList = document.querySelector('#measurement-list');
const fleetSyncStatus = document.querySelector('#fleet-sync-status');
const fleetTableBody = document.querySelector('#fleet-table-body');
const sduTotalValue = document.querySelector('#sdu-total-value');
const sduTotalNote = document.querySelector('#sdu-total-note');
const sduAvgValue = document.querySelector('#sdu-avg-value');
const sduAvgNote = document.querySelector('#sdu-avg-note');
const sduChartBars = document.querySelector('#sdu-chart-bars');
const scanningFleetFilter = document.querySelector('#scanning-fleet-filter');
const scanningFleetNote = document.querySelector('#scanning-fleet-note');
const miningTotalValue = document.querySelector('#mining-total-value');
const miningTotalNote = document.querySelector('#mining-total-note');
const miningTopValue = document.querySelector('#mining-top-value');
const miningTopNote = document.querySelector('#mining-top-note');
const miningMaterialCountValue = document.querySelector('#mining-material-count-value');
const miningMaterialCountNote = document.querySelector('#mining-material-count-note');
const miningChartGrid = document.querySelector('#mining-chart-grid');
const miningFleetFilter = document.querySelector('#mining-fleet-filter');
const miningStarbaseFilter = document.querySelector('#mining-starbase-filter');
const miningFleetNote = document.querySelector('#mining-fleet-note');
const craftingStarbaseFilter = document.querySelector('#crafting-starbase-filter');
const craftingRecipeFilter = document.querySelector('#crafting-recipe-filter');
const craftingFilterNote = document.querySelector('#crafting-filter-note');
const craftingTotalValue = document.querySelector('#crafting-total-value');
const craftingTotalNote = document.querySelector('#crafting-total-note');
const craftingTopValue = document.querySelector('#crafting-top-value');
const craftingTopNote = document.querySelector('#crafting-top-note');
const craftingCountValue = document.querySelector('#crafting-count-value');
const craftingCountNote = document.querySelector('#crafting-count-note');
const craftingChartGrid = document.querySelector('#crafting-chart-grid');
const productionFilterNote = document.querySelector('#production-filter-note');
const productionTotalValue = document.querySelector('#production-total-value');
const productionTotalNote = document.querySelector('#production-total-note');
const productionTopValue = document.querySelector('#production-top-value');
const productionTopNote = document.querySelector('#production-top-note');
const productionCountValue = document.querySelector('#production-count-value');
const productionCountNote = document.querySelector('#production-count-note');
const productionChartGrid = document.querySelector('#production-chart-grid');
const productionStarbaseFilter = document.querySelector('#production-starbase-filter');
// Consumption — Mining
const consMiningStarbaseFilter = document.querySelector('#consumption-mining-starbase-filter');
const consMiningFleetFilter = document.querySelector('#consumption-mining-fleet-filter');
const consMiningFilterNote = document.querySelector('#consumption-mining-filter-note');
const consMiningTotalValue = document.querySelector('#consumption-mining-total-value');
const consMiningTotalNote = document.querySelector('#consumption-mining-total-note');
const consMiningTopValue = document.querySelector('#consumption-mining-top-value');
const consMiningTopNote = document.querySelector('#consumption-mining-top-note');
const consMiningAssetCountValue = document.querySelector('#consumption-mining-asset-count-value');
const consMiningAssetCountNote = document.querySelector('#consumption-mining-asset-count-note');
const consMiningChartGrid = document.querySelector('#consumption-mining-chart-grid');
// Consumption — Crafting
const consCraftingStarbaseFilter = document.querySelector('#consumption-crafting-starbase-filter');
const consCraftingRecipeFilter = document.querySelector('#consumption-crafting-recipe-filter');
const consCraftingFilterNote = document.querySelector('#consumption-crafting-filter-note');
const consCraftingTotalValue = document.querySelector('#consumption-crafting-total-value');
const consCraftingTotalNote = document.querySelector('#consumption-crafting-total-note');
const consCraftingTopValue = document.querySelector('#consumption-crafting-top-value');
const consCraftingTopNote = document.querySelector('#consumption-crafting-top-note');
const consCraftingAssetCountValue = document.querySelector('#consumption-crafting-asset-count-value');
const consCraftingAssetCountNote = document.querySelector('#consumption-crafting-asset-count-note');
const consCraftingChartGrid = document.querySelector('#consumption-crafting-chart-grid');
// Consumption — Upgrading
const consUpgradingStarbaseFilter = document.querySelector('#consumption-upgrading-starbase-filter');
const consUpgradingComponentFilter = document.querySelector('#consumption-upgrading-component-filter');
const consUpgradingFilterNote = document.querySelector('#consumption-upgrading-filter-note');
const consUpgradingTotalValue = document.querySelector('#consumption-upgrading-total-value');
const consUpgradingTotalNote = document.querySelector('#consumption-upgrading-total-note');
const consUpgradingTopValue = document.querySelector('#consumption-upgrading-top-value');
const consUpgradingTopNote = document.querySelector('#consumption-upgrading-top-note');
const consUpgradingAssetCountValue = document.querySelector('#consumption-upgrading-asset-count-value');
const consUpgradingAssetCountNote = document.querySelector('#consumption-upgrading-asset-count-note');
const consUpgradingChartGrid = document.querySelector('#consumption-upgrading-chart-grid');

const consScanningStarbaseFilter = document.querySelector('#consumption-scanning-starbase-filter');
const consScanningFleetFilter = document.querySelector('#consumption-scanning-fleet-filter');
const consScanningFilterNote = document.querySelector('#consumption-scanning-filter-note');
const consScanningTotalValue = document.querySelector('#consumption-scanning-total-value');
const consScanningTotalNote = document.querySelector('#consumption-scanning-total-note');
const consScanningTopValue = document.querySelector('#consumption-scanning-top-value');
const consScanningTopNote = document.querySelector('#consumption-scanning-top-note');
const consScanningAssetCountValue = document.querySelector('#consumption-scanning-asset-count-value');
const consScanningAssetCountNote = document.querySelector('#consumption-scanning-asset-count-note');
const consScanningChartGrid = document.querySelector('#consumption-scanning-chart-grid');

const consCargoStarbaseFilter = document.querySelector('#consumption-cargo-starbase-filter');
const consCargoFleetFilter = document.querySelector('#consumption-cargo-fleet-filter');
const consCargoFilterNote = document.querySelector('#consumption-cargo-filter-note');
const consCargoTotalValue = document.querySelector('#consumption-cargo-total-value');
const consCargoTotalNote = document.querySelector('#consumption-cargo-total-note');
const consCargoTopValue = document.querySelector('#consumption-cargo-top-value');
const consCargoTopNote = document.querySelector('#consumption-cargo-top-note');
const consCargoAssetCountValue = document.querySelector('#consumption-cargo-asset-count-value');
const consCargoAssetCountNote = document.querySelector('#consumption-cargo-asset-count-note');
const consCargoChartGrid = document.querySelector('#consumption-cargo-chart-grid');

const consTotalStarbaseFilter = document.querySelector('#consumption-total-starbase-filter');
const consTotalFilterNote = document.querySelector('#consumption-total-filter-note');
const consTotalTotalValue = document.querySelector('#consumption-total-total-value');
const consTotalTotalNote = document.querySelector('#consumption-total-total-note');
const consTotalTopValue = document.querySelector('#consumption-total-top-value');
const consTotalTopNote = document.querySelector('#consumption-total-top-note');
const consTotalAssetCountValue = document.querySelector('#consumption-total-asset-count-value');
const consTotalAssetCountNote = document.querySelector('#consumption-total-asset-count-note');
const consTotalChartGrid = document.querySelector('#consumption-total-chart-grid');
const pcrChartGrid = document.querySelector('#pcr-chart-grid');
const pcrFactionNote = document.querySelector('#pcr-faction-note');
const pcrCategoryRefs = Object.freeze({
  'raw-material': {
    summary: document.querySelector('#pcr-raw-material-summary'),
    svgWrap: document.querySelector('#pcr-raw-material-svg-wrap'),
    legend: document.querySelector('#pcr-raw-material-legend'),
  },
  consumable: {
    summary: document.querySelector('#pcr-consumable-summary'),
    svgWrap: document.querySelector('#pcr-consumable-svg-wrap'),
    legend: document.querySelector('#pcr-consumable-legend'),
  },
  'compound-material': {
    summary: document.querySelector('#pcr-compound-material-summary'),
    svgWrap: document.querySelector('#pcr-compound-material-svg-wrap'),
    legend: document.querySelector('#pcr-compound-material-legend'),
  },
  component: {
    summary: document.querySelector('#pcr-component-summary'),
    svgWrap: document.querySelector('#pcr-component-svg-wrap'),
    legend: document.querySelector('#pcr-component-legend'),
  },
  data: {
    summary: document.querySelector('#pcr-data-summary'),
    svgWrap: document.querySelector('#pcr-data-svg-wrap'),
    legend: document.querySelector('#pcr-data-legend'),
  },
});
const factionButtons = Array.from(document.querySelectorAll('.faction-button'));

let currentSection = 'production';
let currentSubtab = 'scanning';
let latestSettings = null;
let latestFleetResult = null;
let latestSduResult = null;
let latestMiningResult = null;
let latestCraftingResult = null;
let latestProductionResult = null;
let selectedScanningFleet = '';
let selectedMiningFleet = '';
let selectedMiningStarbase = '';
let selectedCraftingStarbase = '';
let selectedCraftingRecipe = '';
let selectedProductionStarbase = '';
let currentConsumptionSubtab = 'scanning';
let latestConsMiningResult = null;
let latestConsCraftingResult = null;
let latestConsUpgradingResult = null;
let latestConsScanningResult = null;
let latestConsCargoResult = null;
let latestConsTotalResult = null;
let latestPcrResult = null;
let selectedConsMiningStarbase = '';
let selectedConsMiningFleet = '';
let selectedConsCraftingStarbase = '';
let selectedConsCraftingRecipe = '';
let selectedConsUpgradingStarbase = '';
let selectedConsUpgradingComponent = '';
let selectedConsScanningStarbase = '';
let selectedConsScanningFleet = '';
let selectedConsCargoStarbase = '';
let selectedConsCargoFleet = '';
let selectedConsTotalStarbase = '';

const factionLabels = Object.freeze({
  MUD: 'MUD',
  ONI: 'ONI',
  USTUR: 'USTUR',
});

const assetChartColors = Object.freeze({
  Aerogel: '#8fb9d8',
  Ammunition: '#b38343',
  Arco: '#9f6a45',
  Biomass: '#7f9b55',
  Carbon: '#77735c',
  Copper: '#b56536',
  'Copper Ore': '#865342',
  'Crystal Lattice': '#78b7ef',
  Electronics: '#3aa8bb',
  'Field Stabilizer': '#7c6b96',
  Food: '#967158',
  Framework: '#ef8b50',
  Fuel: '#d95fcb',
  Hydrocarbon: '#68717d',
  Hydrogen: '#39c6d9',
  Iron: '#687782',
  'Iron Ore': '#9b8d86',
  Lumanite: '#df5a26',
  Nitrogen: '#bd7070',
  Polymer: '#c75286',
  Silica: '#966a52',
  Steel: '#8b939e',
  'Survey Data Unit': '#ab7b72',
  Titanium: '#5f6674',
  'Titanium Ore': '#7f6f66',
  // Additional assets surfaced by PCR Charts (production + consumption sides)
  'Copper Wire': '#a36a3d',
  Diamond: '#9fd8e2',
  Graphene: '#3f5e6e',
  Ink: '#2f2a2c',
  Magner: '#7d8da1',
  Rochinol: '#8d5f9c',
  Toolkits: '#9c7a4f',
  'Energy Substrate': '#5e8b7a',
  Electromagnet: '#a45c4f',
  'Power Source': '#d6a64a',
  'Particle Accelerator': '#6f8da0',
  'Super Conductor': '#4f9ab2',
  'Strange Emitter': '#b65d9a',
});

const PCR_CATEGORIES = Object.freeze([
  Object.freeze({
    id: 'raw-material',
    label: 'Raw Material',
    assets: ['Arco', 'Biomass', 'Carbon', 'Copper Ore', 'Diamond', 'Hydrogen', 'Iron Ore', 'Lumanite', 'Nitrogen', 'Rochinol', 'Silica', 'Titanium Ore'],
    // Production: mining rss. Consumption: crafting input (raw materials are
    // crafting ingredients; they aren't burned by mining or upgrade).
    sources: { production: ['mining'], consumption: ['crafting'] },
  }),
  Object.freeze({
    id: 'consumable',
    label: 'Consumable',
    assets: ['Ammunition', 'Food', 'Fuel', 'Ink', 'Toolkits'],
    // Production: crafting output. Consumption: every source that can
    // burn a consumable (mining ammo/food/fuel, crafting input, upgrade
    // input, sdu food, movement fuel).
    sources: { production: ['crafting'], consumption: ['mining', 'crafting', 'upgrade', 'sdu', 'movement'] },
  }),
  Object.freeze({
    id: 'compound-material',
    label: 'Compound Material',
    assets: ['Aerogel', 'Crystal Lattice', 'Copper Wire', 'Copper', 'Electronics', 'Graphene', 'Hydrocarbon', 'Iron', 'Magner', 'Polymer', 'Steel', 'Titanium'],
    sources: { production: ['crafting'], consumption: ['crafting', 'upgrade'] },
  }),
  Object.freeze({
    id: 'component',
    label: 'Component',
    assets: ['Energy Substrate', 'Electromagnet', 'Framework', 'Field Stabilizer', 'Power Source', 'Particle Accelerator', 'Super Conductor', 'Strange Emitter'],
    sources: { production: ['crafting'], consumption: ['crafting', 'upgrade'] },
  }),
  Object.freeze({
    id: 'data',
    label: 'Data',
    assets: ['Survey Data Unit'],
    sources: { production: ['sdu'], consumption: ['crafting', 'upgrade'] },
  }),
]);

// PCR chart state: which assets are visible per category. Persists across
// sub-tab toggles and faction switches, scoped per faction.
const pcrAssetVisibility = new Map(); // faction -> Map<categoryId, Set<assetName>>
const PCR_MAX_RATIO = 3.0;
const PCR_MAX_INF_RATIO = 3.0; // visual cap for production > 0, consumption == 0
const PCR_RATIO_REFERENCE = 1.0;

// Per-faction caching for instant switching and per-filter caching
const factionCache = new Map();

function getCachedFactionResult(faction, key) {
  const cache = factionCache.get(faction);
  return cache ? cache[key] : null;
}

function setCachedFactionResult(faction, key, value) {
  if (!factionCache.has(faction)) {
    factionCache.set(faction, {});
  }
  factionCache.get(faction)[key] = value;
}

// Per-filter cache: stores results keyed by faction + filter combination
function getFilterCacheKey(faction, section, ...filters) {
  return `${faction}:${section}:${filters.join('|')}`;
}

function getCachedFilterResult(faction, section, ...filters) {
  return getCachedFactionResult(faction, getFilterCacheKey(faction, section, ...filters));
}

function setCachedFilterResult(faction, section, value, ...filters) {
  setCachedFactionResult(faction, getFilterCacheKey(faction, section, ...filters), value);
}

function recordFactionFilterState(faction) {
  setCachedFactionResult(faction, 'selectedScanningFleet', selectedScanningFleet);
  setCachedFactionResult(faction, 'selectedMiningFleet', selectedMiningFleet);
  setCachedFactionResult(faction, 'selectedMiningStarbase', selectedMiningStarbase);
  setCachedFactionResult(faction, 'selectedCraftingStarbase', selectedCraftingStarbase);
  setCachedFactionResult(faction, 'selectedCraftingRecipe', selectedCraftingRecipe);
  setCachedFactionResult(faction, 'selectedProductionStarbase', selectedProductionStarbase);
  setCachedFactionResult(faction, 'selectedConsMiningStarbase', selectedConsMiningStarbase);
  setCachedFactionResult(faction, 'selectedConsMiningFleet', selectedConsMiningFleet);
  setCachedFactionResult(faction, 'selectedConsCraftingStarbase', selectedConsCraftingStarbase);
  setCachedFactionResult(faction, 'selectedConsCraftingRecipe', selectedConsCraftingRecipe);
  setCachedFactionResult(faction, 'selectedConsUpgradingStarbase', selectedConsUpgradingStarbase);
  setCachedFactionResult(faction, 'selectedConsUpgradingComponent', selectedConsUpgradingComponent);
  setCachedFactionResult(faction, 'selectedConsScanningStarbase', selectedConsScanningStarbase);
  setCachedFactionResult(faction, 'selectedConsScanningFleet', selectedConsScanningFleet);
  setCachedFactionResult(faction, 'selectedConsCargoStarbase', selectedConsCargoStarbase);
  setCachedFactionResult(faction, 'selectedConsCargoFleet', selectedConsCargoFleet);
  setCachedFactionResult(faction, 'selectedConsTotalStarbase', selectedConsTotalStarbase);
  setCachedFactionResult(faction, 'selectedInvStarbase', invSelectedStarbase);
}

function restoreFactionFilterState(faction) {
  selectedScanningFleet = getCachedFactionResult(faction, 'selectedScanningFleet') || '';
  selectedMiningFleet = getCachedFactionResult(faction, 'selectedMiningFleet') || '';
  selectedMiningStarbase = getCachedFactionResult(faction, 'selectedMiningStarbase') || '';
  selectedCraftingStarbase = getCachedFactionResult(faction, 'selectedCraftingStarbase') || '';
  selectedCraftingRecipe = getCachedFactionResult(faction, 'selectedCraftingRecipe') || '';
  selectedProductionStarbase = getCachedFactionResult(faction, 'selectedProductionStarbase') || '';
  selectedConsMiningStarbase = getCachedFactionResult(faction, 'selectedConsMiningStarbase') || '';
  selectedConsMiningFleet = getCachedFactionResult(faction, 'selectedConsMiningFleet') || '';
  selectedConsCraftingStarbase = getCachedFactionResult(faction, 'selectedConsCraftingStarbase') || '';
  selectedConsCraftingRecipe = getCachedFactionResult(faction, 'selectedConsCraftingRecipe') || '';
  selectedConsUpgradingStarbase = getCachedFactionResult(faction, 'selectedConsUpgradingStarbase') || '';
  selectedConsUpgradingComponent = getCachedFactionResult(faction, 'selectedConsUpgradingComponent') || '';
  selectedConsScanningStarbase = getCachedFactionResult(faction, 'selectedConsScanningStarbase') || '';
  selectedConsScanningFleet = getCachedFactionResult(faction, 'selectedConsScanningFleet') || '';
  selectedConsCargoStarbase = getCachedFactionResult(faction, 'selectedConsCargoStarbase') || '';
  selectedConsCargoFleet = getCachedFactionResult(faction, 'selectedConsCargoFleet') || '';
  selectedConsTotalStarbase = getCachedFactionResult(faction, 'selectedConsTotalStarbase') || '';
  invSelectedStarbase = getCachedFactionResult(faction, 'selectedInvStarbase') || '__all__';
}

function openSettings() {
  settingsOverlay.classList.remove('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'false');
  closeSettingsButton.focus();
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'true');
  openSettingsButton.focus();
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function normalizeFaction(value) {
  const faction = String(value || '').trim().toUpperCase();
  return factionLabels[faction] ? faction : 'USTUR';
}

function getPlayerProfilesFromSettings(settings = {}) {
  const profiles = settings.playerProfiles && typeof settings.playerProfiles === 'object' ? settings.playerProfiles : {};
  const faction = normalizeFaction(settings.faction);
  const nextProfiles = {
    MUD: String(profiles.MUD || settings.mudPlayerProfile || ''),
    ONI: String(profiles.ONI || settings.oniPlayerProfile || ''),
    USTUR: String(profiles.USTUR || settings.usturPlayerProfile || ''),
  };
  if (settings.playerProfile && !nextProfiles[faction]) {
    nextProfiles[faction] = String(settings.playerProfile || '');
  }
  return nextProfiles;
}

function getActivePlayerProfile(settings = latestSettings || getFormPayload()) {
  const faction = normalizeFaction(settings?.faction);
  return String(settings?.playerProfiles?.[faction] || '').trim();
}

function getFormPayload() {
  const data = new FormData(form);
  const faction = normalizeFaction(latestSettings?.faction || 'USTUR');
  const playerProfiles = {
    MUD: String(data.get('mudPlayerProfile') || ''),
    ONI: String(data.get('oniPlayerProfile') || ''),
    USTUR: String(data.get('usturPlayerProfile') || ''),
  };
  return {
    aephiaApiKey: String(data.get('aephiaApiKey') || ''),
    playerProfile: playerProfiles[faction],
    playerProfiles,
    faction,
    influxUrl: String(data.get('influxUrl') || ''),
    influxAuthToken: String(data.get('influxAuthToken') || ''),
    influxBucket: String(data.get('influxBucket') || ''),
    useRpcLimiter: Boolean(data.get('useRpcLimiter')),
    rpcUrl: String(data.get('rpcUrl') || ''),
    rpcRequestsPerSecond: String(data.get('rpcRequestsPerSecond') || ''),
  };
}

function setFormValues(settings) {
  const playerProfiles = getPlayerProfilesFromSettings(settings);
  const formValues = {
    ...settings,
    mudPlayerProfile: playerProfiles.MUD,
    oniPlayerProfile: playerProfiles.ONI,
    usturPlayerProfile: playerProfiles.USTUR,
  };
  for (const [key, value] of Object.entries(formValues)) {
    const field = form.elements[key];
    if (!field) continue;
    if (field.type === 'checkbox') {
      field.checked = Boolean(value);
    } else {
      field.value = value ?? '';
    }
  }
}

function hasRequiredSettings(settings) {
  return Boolean(
    getActivePlayerProfile(settings) &&
      settings.influxUrl &&
      settings.influxAuthToken &&
      settings.influxBucket
  );
}

function hasInfluxSettings(settings) {
  return Boolean(settings?.influxUrl && settings?.influxAuthToken && settings?.influxBucket);
}

function updateSettingsStatus(settings) {
  const ready = hasRequiredSettings(settings);
  setText(settingsStatus, ready ? 'Settings ready' : 'Settings incomplete');
  syncDot.classList.toggle('ready', ready);
  syncDot.classList.toggle('muted', !ready);
  setText(profileLabel, normalizeFaction(settings?.faction));
}

function updateFactionButtons(settings = latestSettings || getFormPayload()) {
  const faction = normalizeFaction(settings?.faction);
  const profiles = getPlayerProfilesFromSettings(settings);
  for (const button of factionButtons) {
    const buttonFaction = normalizeFaction(button.dataset.faction);
    const active = buttonFaction === faction;
    const configured = Boolean(String(profiles[buttonFaction] || '').trim());
    button.classList.toggle('active', active);
    button.classList.toggle('not-configured', !configured);
    button.setAttribute('aria-pressed', String(active));
    button.title = configured ? `${buttonFaction} selected profile available` : `${buttonFaction} player profile not configured`;
  }
}

function mergeSettingsFromForm(overrides = {}) {
  const formPayload = getFormPayload();
  return {
    ...formPayload,
    ...overrides,
    playerProfiles: {
      ...formPayload.playerProfiles,
      ...(overrides.playerProfiles || {}),
    },
  };
}

function resetFactionScopedState() {
  latestFleetResult = null;
  latestSduResult = null;
  latestMiningResult = null;
  latestCraftingResult = null;
  latestProductionResult = null;
  latestConsMiningResult = null;
  latestConsCraftingResult = null;
  latestConsUpgradingResult = null;
  latestConsScanningResult = null;
  latestConsCargoResult = null;
  latestConsTotalResult = null;
  latestPcrResult = null;
  // Inventory is also faction-scoped: the starbase dropdown and the
  // per-asset visibility are keyed by faction, so wipe the cached
  // result and force a fresh fetch on the next render.
  latestInventoryResult = null;
  invSelectedStarbase = '__all__';
}

function updateTitle() {
  const section = sectionLabels[currentSection] || '';
  const title = currentSection === 'production' ? subtabLabels[currentSubtab] : section;
  setText(sectionEyebrow, section);
  setText(sectionTitle, title);
}

function updateInfluxResult(result) {
  if (!result?.ok) {
    measurementList.textContent = 'No measurements loaded';
    return;
  }

  const measurements = Array.isArray(result.measurements) ? result.measurements : [];

  measurementList.textContent = '';
  const visible = measurements.length ? measurements : ['No measurements found'];
  for (const measurement of visible) {
    const chip = document.createElement('span');
    chip.className = 'measurement-chip';
    chip.textContent = measurement;
    measurementList.appendChild(chip);
  }
}

function formatCheckedAt(value) {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatWholeNumber(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatCompactNumber(value) {
  const n = Number(value) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function createYAxis(maxValue) {
  const axis = document.createElement('div');
  axis.className = 'chart-yaxis';
  const ticks = [maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0];
  for (const tick of ticks) {
    const label = document.createElement('span');
    label.textContent = formatCompactNumber(tick);
    axis.appendChild(label);
  }
  return axis;
}

function getUtcTodayKey() {
  const now = new Date();
  return [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function getHashColor(value) {
  let hash = 0;
  for (const char of String(value || '')) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 64% 56%)`;
}

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '');
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function mixHex(hex, targetHex, amount) {
  const base = hexToRgb(hex);
  const target = hexToRgb(targetHex);
  if (!base || !target) return hex;
  const mix = (a, b) => Math.round(a + (b - a) * amount);
  return `rgb(${mix(base.r, target.r)}, ${mix(base.g, target.g)}, ${mix(base.b, target.b)})`;
}

function getAssetChartColor(assetName, fallbackIndex = 0) {
  return assetChartColors[assetName] || getPieColor(fallbackIndex, '');
}

function getAssetChartFill(assetName, fallbackIndex = 0) {
  const color = getAssetChartColor(assetName, fallbackIndex);
  if (!String(color).startsWith('#')) return color;
  return `linear-gradient(180deg, ${mixHex(color, '#ffffff', 0.18)}, ${color} 58%, ${mixHex(color, '#000000', 0.28)})`;
}

function resetActivityFleetFilter(select, note, message) {
  if (!select) return;
  select.textContent = '';
  const option = document.createElement('option');
  option.value = '';
  option.textContent = 'All Fleets';
  select.appendChild(option);
  select.value = '';
  select.disabled = true;
  if (note) note.textContent = message;
}

function updateActivityFleetFilter(select, note, fleets, selectedFleet) {
  if (!select) return '';
  const options = Array.isArray(fleets) ? fleets : [];
  const nextSelected = options.some((fleet) => fleet.value === selectedFleet) ? selectedFleet : '';

  select.textContent = '';
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All Fleets';
  select.appendChild(allOption);

  for (const fleet of options) {
    const option = document.createElement('option');
    option.value = fleet.value;
    option.textContent = fleet.label || fleet.value;
    option.title = `${fleet.label || fleet.value}: ${formatWholeNumber(fleet.total)} over 14 days`;
    select.appendChild(option);
  }

  select.value = nextSelected;
  select.disabled = options.length === 0;
  if (note) {
    note.textContent = options.length
      ? `${options.length} active ${options.length === 1 ? 'fleet' : 'fleets'} in last 14 days`
      : 'No fleet activity in last 14 days';
  }
  return nextSelected;
}

function resetSelectWithAllOption(select, allLabel) {
  if (!select) return;
  select.textContent = '';
  const option = document.createElement('option');
  option.value = '';
  option.textContent = allLabel;
  select.appendChild(option);
  select.value = '';
  select.disabled = true;
}

function updateSelectOptions(select, options, selectedValue, allLabel) {
  if (!select) return '';
  const list = Array.isArray(options) ? options : [];
  const nextSelected = list.some((option) => option.value === selectedValue) ? selectedValue : '';

  select.textContent = '';
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = allLabel;
  select.appendChild(allOption);

  for (const item of list) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label || item.value;
    option.title = `${item.label || item.value}: ${formatWholeNumber(item.total)} over 14 days`;
    select.appendChild(option);
  }

  select.value = nextSelected;
  select.disabled = list.length === 0;
  return nextSelected;
}

function renderSduEmpty(message) {
  latestSduResult = null;
  setText(sduTotalValue, '--');
  setText(sduTotalNote, message);
  setText(sduAvgValue, '--');
  setText(sduAvgNote, message);
  if (!String(message).startsWith('Loading')) {
    resetActivityFleetFilter(scanningFleetFilter, scanningFleetNote, message);
  }
  sduChartBars.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  sduChartBars.appendChild(empty);
}

function renderSduChart(result) {
  latestSduResult = result;
  if (!result?.ok) {
    renderSduEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'sdu', result);
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'sdu', result, selectedScanningFleet);

  selectedScanningFleet = updateActivityFleetFilter(
    scanningFleetFilter,
    scanningFleetNote,
    result.fleets,
    result.selectedFleet || selectedScanningFleet
  );

  const days = Array.isArray(result.days) ? result.days : [];
  if (!days.length) {
    renderSduEmpty('No SDU data found');
    return;
  }

  const maxValue = Math.max(...days.map((day) => Number(day.value) || 0), 1);
  setText(sduTotalValue, formatWholeNumber(result.total));
  setText(sduTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);

  const todayKey = getUtcTodayKey();
  const completedDays = days.filter((day) => day.isoDate !== todayKey);
  const activeDays = completedDays.filter((day) => (Number(day.value) || 0) > 0);
  if (activeDays.length > 0) {
    const avg = activeDays.reduce((sum, day) => sum + (Number(day.value) || 0), 0) / activeDays.length;
    setText(sduAvgValue, formatWholeNumber(avg));
    setText(sduAvgNote, `Across ${activeDays.length} of ${completedDays.length} completed days`);
  } else {
    setText(sduAvgValue, '0');
    setText(sduAvgNote, 'No completed days with SDU');
  }
  sduChartBars.textContent = '';
  sduChartBars.appendChild(createYAxis(maxValue));

  for (const day of days) {
    const value = Number(day.value) || 0;
    const height = Math.max(3, Math.round((value / maxValue) * 75));
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.title = `${day.label}: ${formatWholeNumber(value)} SDU`;

    const track = document.createElement('div');
    track.className = 'chart-bar-track';
    const fill = document.createElement('span');
    fill.className = 'chart-bar-fill';
    fill.style.height = `${height}%`;
    fill.style.background = getAssetChartFill('Survey Data Unit');
    track.appendChild(fill);

    const valueLabel = document.createElement('span');
    valueLabel.className = 'chart-bar-value';
    valueLabel.textContent = formatWholeNumber(value);

    const dateLabel = document.createElement('span');
    dateLabel.className = 'chart-bar-label';
    dateLabel.textContent = day.label;

    bar.appendChild(track);
    bar.appendChild(valueLabel);
    bar.appendChild(dateLabel);
    sduChartBars.appendChild(bar);
  }
}

function renderMiningEmpty(message) {
  latestMiningResult = null;
  setText(miningTotalValue, '--');
  setText(miningTotalNote, message);
  setText(miningTopValue, '--');
  setText(miningTopNote, message);
  setText(miningMaterialCountValue, '--');
  setText(miningMaterialCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(miningStarbaseFilter, 'All starbases');
    resetActivityFleetFilter(miningFleetFilter, miningFleetNote, message);
  }
  miningChartGrid.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  miningChartGrid.appendChild(empty);
}

function renderMiningCharts(result) {
  latestMiningResult = result;
  if (!result?.ok) {
    renderMiningEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'mining', result);
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'mining', result, selectedMiningStarbase, selectedMiningFleet);

  selectedMiningStarbase = updateSelectOptions(
    miningStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedMiningStarbase,
    'All starbases'
  );
  selectedMiningFleet = updateActivityFleetFilter(
    miningFleetFilter,
    miningFleetNote,
    result.fleets,
    result.selectedFleet || selectedMiningFleet
  );

  const total = result.total || 0;
  setText(miningTotalValue, formatWholeNumber(total));
  setText(miningTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(miningTopValue, result.topMaterial || '--');
  setText(miningTopNote, result.mode === 'detail' ? 'Largest material' : 'Largest output share');
  setText(miningMaterialCountValue, formatWholeNumber(result.materialCount || 0));
  setText(miningMaterialCountNote, 'Raw materials');
  miningChartGrid.textContent = '';

  if (result.mode === 'overview') {
    const pies = Array.isArray(result.pies) ? result.pies : [];
    if (!pies.length) {
      renderMiningEmpty('No mining data found');
      return;
    }
    miningChartGrid.classList.toggle('crafting-chart-grid-detail', false);
    for (const pie of pies) {
      miningChartGrid.appendChild(createCraftingPieCard(pie));
    }
    return;
  }

  const materials = Array.isArray(result.materials) ? result.materials : [];
  if (!materials.length) {
    renderMiningEmpty('No mining data found');
    return;
  }
  miningChartGrid.classList.toggle('crafting-chart-grid-detail', true);
  for (const [materialIndex, material] of materials.entries()) {
    const maxValue = Math.max(...material.days.map((day) => Number(day.value) || 0), 1);
    const card = document.createElement('section');
    card.className = 'resource-card';

    const header = document.createElement('div');
    header.className = 'resource-card-header';
    const title = document.createElement('h3');
    title.className = 'resource-card-title';
    title.textContent = material.resource;
    const totalEl = document.createElement('span');
    totalEl.className = 'resource-card-total';
    totalEl.textContent = formatWholeNumber(material.total);
    header.appendChild(title);
    header.appendChild(totalEl);

    const bars = document.createElement('div');
    bars.className = 'resource-chart-bars';
    bars.setAttribute('aria-label', `${material.resource} mined over the last 14 days`);
    bars.appendChild(createYAxis(maxValue));
    for (const day of material.days) {
      const value = Number(day.value) || 0;
      const height = Math.max(3, Math.round((value / maxValue) * 75));
      const bar = document.createElement('div');
      bar.className = 'resource-chart-bar';
      bar.title = `${day.label}: ${formatWholeNumber(value)}`;
      const fill = document.createElement('span');
      fill.className = 'resource-chart-fill';
      fill.style.height = `${height}%`;
      fill.style.background = getAssetChartFill(material.resource, materialIndex);
      bar.appendChild(fill);
      bars.appendChild(bar);
    }

    card.appendChild(header);
    card.appendChild(bars);
    miningChartGrid.appendChild(card);
  }
}

function renderCraftingEmpty(message) {
  latestCraftingResult = null;
  setText(craftingTotalValue, '--');
  setText(craftingTotalNote, message);
  setText(craftingTopValue, '--');
  setText(craftingTopNote, message);
  setText(craftingCountValue, '--');
  setText(craftingCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(craftingStarbaseFilter, 'All starbases');
    resetSelectWithAllOption(craftingRecipeFilter, 'All recipes');
    setText(craftingFilterNote, message);
  }
  craftingChartGrid.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  craftingChartGrid.appendChild(empty);
}

function getPieColor(index, assetName) {
  if (assetName && assetChartColors[assetName]) return assetChartColors[assetName];
  const colors = ['#45d6c1', '#f59e0b', '#78d381', '#8ab4ff', '#f87171', '#c084fc', '#facc15', '#38bdf8'];
  return colors[index % colors.length];
}

function getPiePoint(angleDegrees, radius) {
  const angle = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: 50 + radius * Math.cos(angle),
    y: 50 + radius * Math.sin(angle),
  };
}

function createPieSlicePath(startAngle, endAngle) {
  const start = getPiePoint(startAngle, 48);
  const end = getPiePoint(endAngle, 48);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M 50 50 L ${start.x} ${start.y} A 48 48 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function createCraftingBarCard(step, index) {
  const maxValue = Math.max(...step.days.map((day) => Number(day.value) || 0), 1);
  const card = document.createElement('section');
  card.className = 'resource-card';

  const header = document.createElement('div');
  header.className = 'resource-card-header';
  const title = document.createElement('h3');
  title.className = 'resource-card-title';
  title.textContent = step.label;
  title.title = step.label;
  const total = document.createElement('span');
  total.className = 'resource-card-total';
  total.textContent = formatWholeNumber(step.total);
  header.appendChild(title);
  header.appendChild(total);

  const bars = document.createElement('div');
  bars.className = 'resource-chart-bars';
  bars.setAttribute('aria-label', `${step.label} crafted over the last 14 days`);
  bars.appendChild(createYAxis(maxValue));
  for (const day of step.days) {
    const value = Number(day.value) || 0;
    const height = Math.max(3, Math.round((value / maxValue) * 75));
    const bar = document.createElement('div');
    bar.className = 'resource-chart-bar';
    bar.title = `${day.label}: ${formatWholeNumber(value)}`;
    const fill = document.createElement('span');
    fill.className = 'resource-chart-fill';
    fill.style.height = `${height}%`;
    fill.style.background = getAssetChartFill(step.output, index);
    bar.appendChild(fill);
    bars.appendChild(bar);
  }

  card.appendChild(header);
  card.appendChild(bars);
  return card;
}

function createCraftingPieCard(pie) {
  const card = document.createElement('section');
  card.className = 'crafting-pie-card';

  const header = document.createElement('div');
  header.className = 'resource-card-header';
  const title = document.createElement('h3');
  title.className = 'resource-card-title';
  title.textContent = pie.starbase;
  header.appendChild(title);

  const pieGraphic = document.createElement('div');
  pieGraphic.className = 'crafting-pie';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'crafting-pie-svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${pie.starbase} crafted output share`);
  let offset = -90;
  pie.slices.forEach((slice, index) => {
    const share = pie.total > 0 ? (Number(slice.total) || 0) / pie.total : 0;
    const start = offset;
    const end = offset + share * 360;
    const visibleEnd = share >= 0.999 ? end - 0.01 : end;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', createPieSlicePath(start, visibleEnd));
    path.setAttribute('fill', getPieColor(index, slice.label));
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${slice.label}: ${formatWholeNumber(slice.total)}`;
    path.appendChild(title);
    svg.appendChild(path);

    const percent = Math.round(share * 100);
    if (percent > 0) {
      const labelPoint = getPiePoint(start + (end - start) / 2, 28);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'crafting-pie-label');
      label.setAttribute('x', String(labelPoint.x));
      label.setAttribute('y', String(labelPoint.y));
      label.textContent = `${percent}%`;
      svg.appendChild(label);
    }
    offset = end;
  });
  pieGraphic.appendChild(svg);

  const legend = document.createElement('div');
  legend.className = 'crafting-pie-legend';
  pie.slices.slice(0, 8).forEach((slice, index) => {
    const item = document.createElement('div');
    item.className = 'crafting-pie-legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'crafting-pie-swatch';
    swatch.style.background = getPieColor(index, slice.label);
    const label = document.createElement('span');
    const percent = pie.total > 0 ? Math.round((slice.total / pie.total) * 100) : 0;
    label.textContent = `${slice.label} ${percent}%`;
    item.title = `${slice.label}: ${formatWholeNumber(slice.total)}`;
    item.appendChild(swatch);
    item.appendChild(label);
    legend.appendChild(item);
  });

  card.appendChild(header);
  card.appendChild(pieGraphic);
  card.appendChild(legend);
  return card;
}

function renderCraftingCharts(result) {
  latestCraftingResult = result;
  if (!result?.ok) {
    renderCraftingEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'crafting', result);
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'crafting', result, selectedCraftingStarbase, selectedCraftingRecipe);

  selectedCraftingStarbase = updateSelectOptions(
    craftingStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedCraftingStarbase,
    'All starbases'
  );
  selectedCraftingRecipe = updateSelectOptions(
    craftingRecipeFilter,
    result.recipes,
    result.selectedRecipe || selectedCraftingRecipe,
    'All recipes'
  );

  const itemCount = result.mode === 'detail' ? Number(result.stepCount || 0) : Number(result.outputCount || 0);
  setText(craftingTotalValue, formatWholeNumber(result.total));
  setText(craftingTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(craftingTopValue, result.topRecipe || '--');
  setText(craftingTopNote, result.mode === 'detail' ? (result.selectedRecipe ? 'Selected output' : 'Largest output') : 'Largest output share');
  setText(craftingCountValue, formatWholeNumber(itemCount));
  setText(craftingCountNote, result.mode === 'detail' ? 'Crafting steps' : 'Crafted outputs');
  setText(
    craftingFilterNote,
    `${result.starbases?.length || 0} active ${(result.starbases?.length || 0) === 1 ? 'starbase' : 'starbases'} / ${result.recipes?.length || 0} ${(result.recipes?.length || 0) === 1 ? 'recipe' : 'recipes'}`
  );

  craftingChartGrid.textContent = '';
  if (result.mode === 'overview') {
    const pies = Array.isArray(result.pies) ? result.pies : [];
    if (!pies.length) {
      renderCraftingEmpty('No crafting data found');
      return;
    }
    craftingChartGrid.classList.toggle('crafting-chart-grid-detail', false);
    for (const pie of pies) {
      craftingChartGrid.appendChild(createCraftingPieCard(pie));
    }
    return;
  }

  const steps = Array.isArray(result.steps) ? result.steps : [];
  if (!steps.length) {
    renderCraftingEmpty('No crafting data found');
    return;
  }
  craftingChartGrid.classList.toggle('crafting-chart-grid-detail', true);
  for (const [index, step] of steps.entries()) {
    craftingChartGrid.appendChild(createCraftingBarCard(step, index));
  }
}

function renderProductionEmpty(message) {
  latestProductionResult = null;
  setText(productionTotalValue, '--');
  setText(productionTotalNote, message);
  setText(productionTopValue, '--');
  setText(productionTopNote, message);
  setText(productionCountValue, '--');
  setText(productionCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(productionStarbaseFilter, 'All starbases');
  }
  setText(productionFilterNote, message);
  productionChartGrid.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  productionChartGrid.appendChild(empty);
}

function renderProductionCharts(result) {
  latestProductionResult = result;
  if (!result?.ok) {
    renderProductionEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'production', result);
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'production', result, selectedProductionStarbase);

  selectedProductionStarbase = updateSelectOptions(
    productionStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedProductionStarbase,
    'All starbases'
  );

  setText(productionTotalValue, formatWholeNumber(result.total));
  setText(productionTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(productionTopValue, result.topProduct || '--');
  setText(productionTopNote, result.mode === 'detail' ? 'Largest product' : 'Largest output share');
  setText(productionCountValue, formatWholeNumber(result.productCount || 0));
  setText(productionCountNote, 'Produced outputs');
  setText(
    productionFilterNote,
    `${result.starbaseCount || 0} active ${(result.starbaseCount || 0) === 1 ? 'starbase' : 'starbases'} in last 14 days${
      result.sduStarbaseTagged === false ? ' · SDU starbase tag missing' : ''
    }`
  );

  productionChartGrid.textContent = '';
  if (result.mode === 'overview') {
    const pies = Array.isArray(result.pies) ? result.pies : [];
    if (!pies.length) {
      renderProductionEmpty('No production data found');
      return;
    }
    productionChartGrid.classList.toggle('crafting-chart-grid-detail', false);
    for (const pie of pies) {
      productionChartGrid.appendChild(createCraftingPieCard(pie));
    }
    return;
  }

  const assets = Array.isArray(result.assets) ? result.assets : [];
  if (!assets.length) {
    renderProductionEmpty('No production data found');
    return;
  }
  productionChartGrid.classList.toggle('crafting-chart-grid-detail', true);
  for (const [index, asset] of assets.entries()) {
    productionChartGrid.appendChild(createConsumptionBarCard(asset, index));
  }
}

/* ---- Consumption: Mining ---- */

function renderConsMiningEmpty(message) {
  latestConsMiningResult = null;
  setText(consMiningTotalValue, '--');
  setText(consMiningTotalNote, message);
  setText(consMiningTopValue, '--');
  setText(consMiningTopNote, message);
  setText(consMiningAssetCountValue, '--');
  setText(consMiningAssetCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(consMiningStarbaseFilter, 'All starbases');
    resetSelectWithAllOption(consMiningFleetFilter, 'All Fleets');
    setText(consMiningFilterNote, message);
  }
  consMiningChartGrid.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  consMiningChartGrid.appendChild(empty);
}

function renderConsMining(result) {
  latestConsMiningResult = result;
  if (!result?.ok) {
    renderConsMiningEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'consMining', result);
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'consMining', result, selectedConsMiningStarbase, selectedConsMiningFleet);

  selectedConsMiningStarbase = updateSelectOptions(
    consMiningStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedConsMiningStarbase,
    'All starbases'
  );
  selectedConsMiningFleet = updateSelectOptions(
    consMiningFleetFilter,
    result.fleets,
    result.selectedFleet || selectedConsMiningFleet,
    'All Fleets'
  );

  setText(consMiningTotalValue, formatWholeNumber(result.total));
  setText(consMiningTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(consMiningTopValue, result.topAsset || '--');
  setText(consMiningTopNote, result.mode === 'detail' ? 'Largest consumed' : 'Largest consumed asset');
  setText(consMiningAssetCountValue, formatWholeNumber(result.assetCount || 0));
  setText(consMiningAssetCountNote, 'Consumed assets');
  setText(
    consMiningFilterNote,
    `${result.starbases?.length || 0} active ${(result.starbases?.length || 0) === 1 ? 'starbase' : 'starbases'} / ${result.fleets?.length || 0} ${(result.fleets?.length || 0) === 1 ? 'fleet' : 'fleets'}`
  );

  consMiningChartGrid.textContent = '';
  if (result.mode === 'overview') {
    const pies = Array.isArray(result.pies) ? result.pies : [];
    if (!pies.length) {
      renderConsMiningEmpty('No mining consumption data found');
      return;
    }
    consMiningChartGrid.classList.toggle('crafting-chart-grid-detail', false);
    for (const pie of pies) {
      consMiningChartGrid.appendChild(createCraftingPieCard(pie));
    }
    return;
  }

  const assets = Array.isArray(result.assets) ? result.assets : [];
  if (!assets.length) {
    renderConsMiningEmpty('No mining consumption data found');
    return;
  }
  consMiningChartGrid.classList.toggle('crafting-chart-grid-detail', true);
  for (const [index, asset] of assets.entries()) {
    consMiningChartGrid.appendChild(createConsumptionBarCard(asset, index));
  }
}

async function refreshConsMining() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderConsMiningEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFilterResult(faction, 'consMining', selectedConsMiningStarbase, selectedConsMiningFleet);
  if (cached) {
    renderConsMining(cached);
  } else {
    renderConsMiningEmpty('Loading mining consumption...');
  }
  try {
    const result = await api.getDailyConsumptionMining({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: selectedConsMiningStarbase,
      fleetFilter: selectedConsMiningFleet,
    });
    renderConsMining(result);
  } catch (error) {
    console.error(error);
    if (!cached) renderConsMiningEmpty('Influx unavailable');
  }
}

/* ---- Consumption: Crafting ---- */

function renderConsCraftingEmpty(message) {
  latestConsCraftingResult = null;
  setText(consCraftingTotalValue, '--');
  setText(consCraftingTotalNote, message);
  setText(consCraftingTopValue, '--');
  setText(consCraftingTopNote, message);
  setText(consCraftingAssetCountValue, '--');
  setText(consCraftingAssetCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(consCraftingStarbaseFilter, 'All starbases');
    resetSelectWithAllOption(consCraftingRecipeFilter, 'All recipes');
    setText(consCraftingFilterNote, message);
  }
  consCraftingChartGrid.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  consCraftingChartGrid.appendChild(empty);
}

function renderConsCrafting(result) {
  latestConsCraftingResult = result;
  if (!result?.ok) {
    renderConsCraftingEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'consCrafting', result);
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'consCrafting', result, selectedConsCraftingStarbase, selectedConsCraftingRecipe);

  selectedConsCraftingStarbase = updateSelectOptions(
    consCraftingStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedConsCraftingStarbase,
    'All starbases'
  );
  selectedConsCraftingRecipe = updateSelectOptions(
    consCraftingRecipeFilter,
    result.recipes,
    result.selectedRecipe || selectedConsCraftingRecipe,
    'All recipes'
  );

  setText(consCraftingTotalValue, formatWholeNumber(result.total));
  setText(consCraftingTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(consCraftingTopValue, result.topAsset || '--');
  setText(consCraftingTopNote, 'Largest consumed ingredient');
  setText(consCraftingAssetCountValue, formatWholeNumber(result.assetCount || 0));
  setText(consCraftingAssetCountNote, 'Consumed ingredients');
  setText(
    consCraftingFilterNote,
    `${result.starbases?.length || 0} active ${(result.starbases?.length || 0) === 1 ? 'starbase' : 'starbases'} / ${result.recipes?.length || 0} ${(result.recipes?.length || 0) === 1 ? 'recipe' : 'recipes'}`
  );

  consCraftingChartGrid.textContent = '';
  if (result.mode === 'overview') {
    const pies = Array.isArray(result.pies) ? result.pies : [];
    if (!pies.length) {
      renderConsCraftingEmpty('No crafting consumption data found');
      return;
    }
    consCraftingChartGrid.classList.toggle('crafting-chart-grid-detail', false);
    for (const pie of pies) {
      consCraftingChartGrid.appendChild(createCraftingPieCard(pie));
    }
    return;
  }

  const assets = Array.isArray(result.assets) ? result.assets : [];
  if (!assets.length) {
    renderConsCraftingEmpty('No crafting consumption data found');
    return;
  }
  consCraftingChartGrid.classList.toggle('crafting-chart-grid-detail', true);
  for (const [index, asset] of assets.entries()) {
    consCraftingChartGrid.appendChild(createConsumptionBarCard(asset, index));
  }
}

async function refreshConsCrafting() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderConsCraftingEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFilterResult(faction, 'consCrafting', selectedConsCraftingStarbase, selectedConsCraftingRecipe);
  if (cached) {
    renderConsCrafting(cached);
  } else {
    renderConsCraftingEmpty('Loading crafting consumption...');
  }
  try {
    const result = await api.getDailyConsumptionCrafting({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: selectedConsCraftingStarbase,
      recipeFilter: selectedConsCraftingRecipe,
    });
    renderConsCrafting(result);
  } catch (error) {
    console.error(error);
    if (!cached) renderConsCraftingEmpty('Influx unavailable');
  }
}

/* ---- Consumption: Upgrading ---- */

function renderConsUpgradingEmpty(message) {
  latestConsUpgradingResult = null;
  setText(consUpgradingTotalValue, '--');
  setText(consUpgradingTotalNote, message);
  setText(consUpgradingTopValue, '--');
  setText(consUpgradingTopNote, message);
  setText(consUpgradingAssetCountValue, '--');
  setText(consUpgradingAssetCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(consUpgradingStarbaseFilter, 'All starbases');
    resetSelectWithAllOption(consUpgradingComponentFilter, 'All components');
    setText(consUpgradingFilterNote, message);
  }
  consUpgradingChartGrid.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  consUpgradingChartGrid.appendChild(empty);
}

function renderConsUpgrading(result) {
  latestConsUpgradingResult = result;
  if (!result?.ok) {
    renderConsUpgradingEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'consUpgrading', result);
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'consUpgrading', result, selectedConsUpgradingStarbase, selectedConsUpgradingComponent);

  selectedConsUpgradingStarbase = updateSelectOptions(
    consUpgradingStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedConsUpgradingStarbase,
    'All starbases'
  );
  selectedConsUpgradingComponent = updateSelectOptions(
    consUpgradingComponentFilter,
    result.components,
    result.selectedComponent || selectedConsUpgradingComponent,
    'All components'
  );

  setText(consUpgradingTotalValue, formatWholeNumber(result.total));
  setText(consUpgradingTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(consUpgradingTopValue, result.topAsset || '--');
  setText(consUpgradingTopNote, 'Largest consumed component');
  setText(consUpgradingAssetCountValue, formatWholeNumber(result.assetCount || 0));
  setText(consUpgradingAssetCountNote, 'Consumed components');
  setText(
    consUpgradingFilterNote,
    `${result.starbases?.length || 0} active ${(result.starbases?.length || 0) === 1 ? 'starbase' : 'starbases'} / ${result.components?.length || 0} ${(result.components?.length || 0) === 1 ? 'component' : 'components'}`
  );

  consUpgradingChartGrid.textContent = '';
  if (result.mode === 'overview') {
    const pies = Array.isArray(result.pies) ? result.pies : [];
    if (!pies.length) {
      renderConsUpgradingEmpty('No upgrading consumption data found');
      return;
    }
    consUpgradingChartGrid.classList.toggle('crafting-chart-grid-detail', false);
    for (const pie of pies) {
      consUpgradingChartGrid.appendChild(createCraftingPieCard(pie));
    }
    return;
  }

  const assets = Array.isArray(result.assets) ? result.assets : [];
  if (!assets.length) {
    renderConsUpgradingEmpty('No upgrading consumption data found');
    return;
  }
  consUpgradingChartGrid.classList.toggle('crafting-chart-grid-detail', true);
  for (const [index, asset] of assets.entries()) {
    consUpgradingChartGrid.appendChild(createConsumptionBarCard(asset, index));
  }
}

async function refreshConsUpgrading() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderConsUpgradingEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFilterResult(faction, 'consUpgrading', selectedConsUpgradingStarbase, selectedConsUpgradingComponent);
  if (cached) {
    renderConsUpgrading(cached);
  } else {
    renderConsUpgradingEmpty('Loading upgrading consumption...');
  }
  try {
    const result = await api.getDailyConsumptionUpgrading({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: selectedConsUpgradingStarbase,
      componentFilter: selectedConsUpgradingComponent,
    });
    renderConsUpgrading(result);
  } catch (error) {
    console.error(error);
    if (!cached) renderConsUpgradingEmpty('Influx unavailable');
  }
}

/* ---- Consumption: Scanning ---- */

function renderConsScanningEmpty(message) {
  latestConsScanningResult = null;
  setText(consScanningTotalValue, '--');
  setText(consScanningTotalNote, message);
  setText(consScanningTopValue, '--');
  setText(consScanningTopNote, message);
  setText(consScanningAssetCountValue, '--');
  setText(consScanningAssetCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(consScanningStarbaseFilter, 'All starbases');
    resetSelectWithAllOption(consScanningFleetFilter, 'All Fleets');
    setText(consScanningFilterNote, message);
  }
  consScanningChartGrid.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  consScanningChartGrid.appendChild(empty);
}

function renderConsScanning(result) {
  latestConsScanningResult = result;
  if (!result?.ok) {
    renderConsScanningEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'consScanning', result);
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'consScanning', result, selectedConsScanningStarbase, selectedConsScanningFleet);

  selectedConsScanningStarbase = updateSelectOptions(
    consScanningStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedConsScanningStarbase,
    'All starbases'
  );
  selectedConsScanningFleet = updateSelectOptions(
    consScanningFleetFilter,
    result.fleets,
    result.selectedFleet || selectedConsScanningFleet,
    'All Fleets'
  );

  setText(consScanningTotalValue, formatWholeNumber(result.total));
  setText(consScanningTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(consScanningTopValue, result.topAsset || '--');
  setText(consScanningTopNote, result.mode === 'detail' ? 'Largest consumed' : 'Largest consumed asset');
  setText(consScanningAssetCountValue, formatWholeNumber(result.assetCount || 0));
  setText(consScanningAssetCountNote, 'Consumed assets');
  setText(
    consScanningFilterNote,
    `${result.starbases?.length || 0} active ${(result.starbases?.length || 0) === 1 ? 'starbase' : 'starbases'} / ${result.fleets?.length || 0} ${(result.fleets?.length || 0) === 1 ? 'fleet' : 'fleets'}`
  );

  consScanningChartGrid.textContent = '';
  if (result.mode === 'overview') {
    const pies = Array.isArray(result.pies) ? result.pies : [];
    if (!pies.length) {
      renderConsScanningEmpty('No scanning consumption data found');
      return;
    }
    consScanningChartGrid.classList.toggle('crafting-chart-grid-detail', false);
    for (const pie of pies) {
      consScanningChartGrid.appendChild(createCraftingPieCard(pie));
    }
    return;
  }

  const assets = Array.isArray(result.assets) ? result.assets : [];
  if (!assets.length) {
    renderConsScanningEmpty('No scanning consumption data found');
    return;
  }
  consScanningChartGrid.classList.toggle('crafting-chart-grid-detail', true);
  for (const [index, asset] of assets.entries()) {
    consScanningChartGrid.appendChild(createConsumptionBarCard(asset, index));
  }
}

async function refreshConsScanning() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderConsScanningEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFilterResult(faction, 'consScanning', selectedConsScanningStarbase, selectedConsScanningFleet);
  if (cached) {
    renderConsScanning(cached);
  } else {
    renderConsScanningEmpty('Loading scanning consumption...');
  }
  try {
    const result = await api.getDailyConsumptionScanning({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: selectedConsScanningStarbase,
      fleetFilter: selectedConsScanningFleet,
    });
    renderConsScanning(result);
  } catch (error) {
    console.error(error);
    if (!cached) renderConsScanningEmpty('Influx unavailable');
  }
}

/* ---- Consumption: Cargo ---- */

function renderConsCargoEmpty(message) {
  latestConsCargoResult = null;
  setText(consCargoTotalValue, '--');
  setText(consCargoTotalNote, message);
  setText(consCargoTopValue, '--');
  setText(consCargoTopNote, message);
  setText(consCargoAssetCountValue, '--');
  setText(consCargoAssetCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(consCargoStarbaseFilter, 'All starbases');
    resetSelectWithAllOption(consCargoFleetFilter, 'All Fleets');
    setText(consCargoFilterNote, message);
  }
  consCargoChartGrid.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  consCargoChartGrid.appendChild(empty);
}

function renderConsCargo(result) {
  latestConsCargoResult = result;
  if (!result?.ok) {
    renderConsCargoEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'consCargo', result);
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'consCargo', result, selectedConsCargoStarbase, selectedConsCargoFleet);

  selectedConsCargoStarbase = updateSelectOptions(
    consCargoStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedConsCargoStarbase,
    'All starbases'
  );
  selectedConsCargoFleet = updateSelectOptions(
    consCargoFleetFilter,
    result.fleets,
    result.selectedFleet || selectedConsCargoFleet,
    'All Fleets'
  );

  setText(consCargoTotalValue, formatWholeNumber(result.total));
  setText(consCargoTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(consCargoTopValue, result.topAsset || '--');
  setText(consCargoTopNote, result.mode === 'detail' ? 'Largest consumed' : 'Largest consumed asset');
  setText(consCargoAssetCountValue, formatWholeNumber(result.assetCount || 0));
  setText(consCargoAssetCountNote, 'Consumed assets');
  setText(
    consCargoFilterNote,
    `${result.starbases?.length || 0} active ${(result.starbases?.length || 0) === 1 ? 'starbase' : 'starbases'} / ${result.fleets?.length || 0} ${(result.fleets?.length || 0) === 1 ? 'fleet' : 'fleets'}`
  );

  consCargoChartGrid.textContent = '';
  if (result.mode === 'overview') {
    const pies = Array.isArray(result.pies) ? result.pies : [];
    if (!pies.length) {
      renderConsCargoEmpty('No cargo consumption data found');
      return;
    }
    consCargoChartGrid.classList.toggle('crafting-chart-grid-detail', false);
    for (const pie of pies) {
      consCargoChartGrid.appendChild(createCraftingPieCard(pie));
    }
    return;
  }

  const assets = Array.isArray(result.assets) ? result.assets : [];
  if (!assets.length) {
    renderConsCargoEmpty('No cargo consumption data found');
    return;
  }
  consCargoChartGrid.classList.toggle('crafting-chart-grid-detail', true);
  for (const [index, asset] of assets.entries()) {
    consCargoChartGrid.appendChild(createConsumptionBarCard(asset, index));
  }
}

async function refreshConsCargo() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderConsCargoEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFilterResult(faction, 'consCargo', selectedConsCargoStarbase, selectedConsCargoFleet);
  if (cached) {
    renderConsCargo(cached);
  } else {
    renderConsCargoEmpty('Loading cargo consumption...');
  }
  try {
    const result = await api.getDailyConsumptionCargo({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: selectedConsCargoStarbase,
      fleetFilter: selectedConsCargoFleet,
    });
    renderConsCargo(result);
  } catch (error) {
    console.error(error);
    if (!cached) renderConsCargoEmpty('Influx unavailable');
  }
}

/* ---- Consumption: Total ---- */

function renderConsTotalEmpty(message) {
  latestConsTotalResult = null;
  setText(consTotalTotalValue, '--');
  setText(consTotalTotalNote, message);
  setText(consTotalTopValue, '--');
  setText(consTotalTopNote, message);
  setText(consTotalAssetCountValue, '--');
  setText(consTotalAssetCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(consTotalStarbaseFilter, 'All starbases');
    setText(consTotalFilterNote, message);
  }
  consTotalChartGrid.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  consTotalChartGrid.appendChild(empty);
}

function renderConsTotal(result) {
  latestConsTotalResult = result;
  if (!result?.ok) {
    renderConsTotalEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'consTotal', result);
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'consTotal', result, selectedConsTotalStarbase, '');

  selectedConsTotalStarbase = updateSelectOptions(
    consTotalStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedConsTotalStarbase,
    'All starbases'
  );

  setText(consTotalTotalValue, formatWholeNumber(result.total));
  setText(consTotalTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(consTotalTopValue, result.topAsset || '--');
  setText(consTotalTopNote, result.mode === 'detail' ? 'Largest asset' : 'Top asset');
  setText(consTotalAssetCountValue, formatWholeNumber(result.assetCount || 0));
  setText(consTotalAssetCountNote, 'Assets');
  setText(
    consTotalFilterNote,
    `${result.starbases?.length || 0} active ${(result.starbases?.length || 0) === 1 ? 'starbase' : 'starbases'}`
  );

  consTotalChartGrid.textContent = '';
  if (result.mode === 'overview') {
    const pies = Array.isArray(result.pies) ? result.pies : [];
    if (!pies.length) {
      renderConsTotalEmpty('No total consumption data found');
      return;
    }
    consTotalChartGrid.classList.toggle('crafting-chart-grid-detail', false);
    for (const pie of pies) {
      consTotalChartGrid.appendChild(createCraftingPieCard(pie));
    }
    return;
  }

  const assets = Array.isArray(result.assets) ? result.assets : [];
  if (!assets.length) {
    renderConsTotalEmpty('No total consumption data found');
    return;
  }
  consTotalChartGrid.classList.toggle('crafting-chart-grid-detail', true);
  for (const [index, asset] of assets.entries()) {
    consTotalChartGrid.appendChild(createConsumptionBarCard(asset, index));
  }
}

async function refreshConsTotal() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderConsTotalEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFilterResult(faction, 'consTotal', selectedConsTotalStarbase, '');
  if (cached) {
    renderConsTotal(cached);
  } else {
    renderConsTotalEmpty('Loading total consumption...');
  }
  try {
    const result = await api.getDailyConsumptionTotal({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: selectedConsTotalStarbase,
    });
    renderConsTotal(result);
  } catch (error) {
    console.error(error);
    if (!cached) renderConsTotalEmpty('Influx unavailable');
  }
}

/* ---- PCR Charts ---- */

function pcrGetCategoryVisibility(faction, categoryId) {
  if (!pcrAssetVisibility.has(faction)) pcrAssetVisibility.set(faction, new Map());
  const factionMap = pcrAssetVisibility.get(faction);
  if (!factionMap.has(categoryId)) factionMap.set(categoryId, new Set());
  return factionMap.get(categoryId);
}

function pcrToggleAsset(categoryId, assetName) {
  const faction = normalizeFaction(latestSettings?.faction);
  const set = pcrGetCategoryVisibility(faction, categoryId);
  if (set.has(assetName)) set.delete(assetName);
  else set.add(assetName);
  if (latestPcrResult && latestPcrResult.faction === faction) {
    renderPcrCharts(latestPcrResult);
  }
}

function pcrBucketAssetsByCategory(result) {
  const buckets = new Map();
  for (const category of PCR_CATEGORIES) {
    buckets.set(category.id, { category, assets: [] });
  }
  const assets = Array.isArray(result?.assets) ? result.assets : [];
  const assetsByLabel = new Map(assets.map((asset) => [asset.label, asset]));
  for (const category of PCR_CATEGORIES) {
    const bucket = buckets.get(category.id);
    for (const assetName of category.assets) {
      const asset = assetsByLabel.get(assetName);
      if (!asset) continue;
      bucket.assets.push(asset);
    }
  }
  return buckets;
}

function pcrRatioValue(asset, day) {
  if (day.ratio === null) {
    if (day.production > 0 && day.consumption === 0) {
      return { ratio: PCR_MAX_INF_RATIO, clipped: true };
    }
    return null; // both zero → skip
  }
  if (day.ratio > PCR_MAX_RATIO) {
    return { ratio: PCR_MAX_RATIO, clipped: true };
  }
  return { ratio: day.ratio, clipped: false };
}

function pcrFormatRatio(ratio) {
  if (!Number.isFinite(ratio)) return '∞';
  if (ratio >= PCR_MAX_RATIO - 1e-6) return '∞';
  if (ratio === 0) return '0.00';
  if (ratio >= 10) return ratio.toFixed(1);
  if (ratio >= 1) return ratio.toFixed(2);
  return ratio.toFixed(2);
}

function pcrFormatInteger(value) {
  const n = Number(value) || 0;
  if (!Number.isFinite(n)) return '--';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

function pcrCategorySummary(bucket) {
  const visible = bucket.assets;
  if (!visible.length) return 'No assets in this category yet';
  const totalProd = visible.reduce((sum, asset) => sum + asset.productionTotal, 0);
  const totalCons = visible.reduce((sum, asset) => sum + asset.consumptionTotal, 0);
  if (totalProd === 0 && totalCons === 0) {
    return `${visible.length} asset${visible.length === 1 ? '' : 's'} · no activity`;
  }
  let ratioLabel;
  if (totalProd > 0 && totalCons === 0) ratioLabel = '∞';
  else if (totalCons === 0) ratioLabel = '--';
  else ratioLabel = (totalProd / totalCons).toFixed(2);
  return `${visible.length} asset${visible.length === 1 ? '' : 's'} · P/C ${ratioLabel} (${pcrFormatInteger(totalProd)} / ${pcrFormatInteger(totalCons)})`;
}

// Compute the first "complete" day for a category's chart: the first
// day in the window where every relevant production + consumption
// source has started reporting. If the latest first-day across sources
// is the window's first day (all sources have been collecting for the
// full 14 days), we return null to mean "no trimming needed" and show
// the full window. If a source started mid-window, we trim to the day
// after its first day (so we only show days where every source has
// full coverage, not the partial first day).
function pcrComputeFirstDay(category, days, sourceFirstDays) {
  if (!days.length) return null;
  const sources = category.sources || {};
  const prodSources = sources.production || [];
  const consSources = sources.consumption || [];
  if (!prodSources.length && !consSources.length) return null;
  const windowFirstDay = days[0].isoDate;
  let latestFirstDay = null;
  for (const source of prodSources) {
    const first = sourceFirstDays?.production?.[source];
    if (first && (!latestFirstDay || first > latestFirstDay)) latestFirstDay = first;
  }
  for (const source of consSources) {
    const first = sourceFirstDays?.consumption?.[source];
    if (first && (!latestFirstDay || first > latestFirstDay)) latestFirstDay = first;
  }
  if (!latestFirstDay) return null;
  if (latestFirstDay <= windowFirstDay) return null;
  // Add one day so the chart's first day is the first day where every
  // source has been reporting for a full window, not the partial day
  // the latest source actually started.
  const next = new Date(`${latestFirstDay}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function pcrCreateLineChart(category, days, assets) {
  const wrap = pcrCategoryRefs[category.id]?.svgWrap;
  if (!wrap) return;

  wrap.textContent = '';
  if (!assets.length) {
    const empty = document.createElement('div');
    empty.className = 'pcr-empty-state';
    empty.textContent = 'No activity for this player profile';
    wrap.appendChild(empty);
    return;
  }

  const padding = { top: 14, right: 14, bottom: 26, left: 40 };

  // Trim the days array to start from the first "complete" day for this
  // category. Some categories (Raw Material, Consumable) are dominated
  // by data sources that started mid-window (e.g. mining with the new
  // faction tag) — showing the early days as a flat line with no
  // consumption would be misleading. The first complete day is the day
  // after the latest "first day with any data" across the category's
  // production + consumption sources.
  if (days.length && category.sources && latestPcrResult?.sourceFirstDays) {
    const firstDay = pcrComputeFirstDay(category, days, latestPcrResult.sourceFirstDays);
    if (firstDay) {
      const trimmed = days.filter((d) => d.isoDate >= firstDay);
      if (!trimmed.length) {
        const empty = document.createElement('div');
        empty.className = 'pcr-empty-state';
        empty.textContent = 'No complete days yet for this category';
        wrap.appendChild(empty);
        return;
      }
      days = trimmed;
    }
  }

  const dayCount = days.length;

  // Measure available space; default to 600x320 if the wrap hasn't been
  // laid out yet.
  const width = Math.max(wrap.clientWidth, 320);
  const height = Math.max(wrap.clientHeight, 280);
  const innerWidth = Math.max(width - padding.left - padding.right, 1);
  const innerHeight = Math.max(height - padding.top - padding.bottom, 1);
  const xStep = dayCount > 1 ? innerWidth / (dayCount - 1) : 0;

  // Grid + balance line. Rendered as positioned divs so text stays at
  // consistent CSS pixel size regardless of the wrap width.
  const grid = document.createElement('div');
  grid.className = 'pcr-chart-grid-overlay';
  grid.style.position = 'absolute';
  grid.style.left = '0';
  grid.style.top = '0';
  grid.style.right = '0';
  grid.style.bottom = '0';
  grid.style.pointerEvents = 'none';

  const yTicks = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  for (const tick of yTicks) {
    const y = padding.top + innerHeight - (tick / PCR_MAX_RATIO) * innerHeight;
    const line = document.createElement('div');
    line.className = `pcr-grid-line${Math.abs(tick - 1) < 1e-6 ? ' pcr-grid-balance' : ''}`;
    line.style.position = 'absolute';
    line.style.left = `${padding.left}px`;
    line.style.right = `${padding.right}px`;
    line.style.top = `${y}px`;
    line.style.height = '1px';
    line.style.background = 'rgba(143, 168, 178, 0.18)';
    if (Math.abs(tick - 1) >= 1e-6) grid.appendChild(line);

    const label = document.createElement('div');
    label.className = 'pcr-axis-label';
    label.textContent = String(tick);
    label.style.position = 'absolute';
    label.style.right = `${width - padding.left + 6}px`;
    label.style.top = `${y - 6}px`;
    label.style.color = 'var(--muted)';
    label.style.fontSize = '10px';
    label.style.lineHeight = '12px';
    label.style.fontVariantNumeric = 'tabular-nums';
    grid.appendChild(label);
  }

  // y-axis caption
  const yCaption = document.createElement('div');
  yCaption.className = 'pcr-y-caption';
  yCaption.textContent = 'P/C ratio';
  yCaption.style.position = 'absolute';
  yCaption.style.left = `${padding.left}px`;
  yCaption.style.top = '0px';
  yCaption.style.color = 'var(--muted)';
  yCaption.style.fontSize = '10px';
  yCaption.style.lineHeight = '12px';
  grid.appendChild(yCaption);

  // x-axis day labels (every other day, plus first and last)
  for (let i = 0; i < days.length; i += 1) {
    if (i !== 0 && i !== days.length - 1 && i % 2 !== 0) continue;
    const day = days[i];
    const x = padding.left + (dayCount > 1 ? i * xStep : innerWidth / 2);
    const label = document.createElement('div');
    label.className = 'pcr-day-label';
    label.textContent = day.label;
    label.style.position = 'absolute';
    label.style.left = `${x}px`;
    label.style.top = `${padding.top + innerHeight + 4}px`;
    label.style.transform = 'translateX(-50%)';
    label.style.color = 'var(--muted)';
    label.style.fontSize = '9px';
    label.style.lineHeight = '12px';
    label.style.fontVariantNumeric = 'tabular-nums';
    grid.appendChild(label);
  }

  wrap.appendChild(grid);

  // SVG layer for the lines and points. Uses 1:1 viewBox so the lines
  // stay 1:1 with the CSS pixel grid above.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pcr-chart-svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${category.label} production to consumption ratio over the last 14 days`);

  // Balance line as part of the SVG so it stays anchored to the data
  // (CSS pixel lines would jitter on resize; the SVG is laid out once
  // per render).
  const balanceY = padding.top + innerHeight - (1 / PCR_MAX_RATIO) * innerHeight;
  const balance = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  balance.setAttribute('x1', String(padding.left));
  balance.setAttribute('x2', String(padding.left + innerWidth));
  balance.setAttribute('y1', String(balanceY));
  balance.setAttribute('y2', String(balanceY));
  balance.setAttribute('class', 'pcr-balance-line');
  svg.appendChild(balance);

  const faction = normalizeFaction(latestSettings?.faction);
  const visibilitySet = pcrGetCategoryVisibility(faction, category.id);
  const hiddenAssets = new Set();
  for (const asset of assets) {
    if (visibilitySet.has(asset.label)) hiddenAssets.add(asset.label);
  }

  const segments = [];
  for (const asset of assets) {
    const color = getAssetChartColor(asset.label);
    const isHidden = hiddenAssets.has(asset.label);
    const points = [];
    for (let i = 0; i < asset.days.length; i += 1) {
      const day = asset.days[i];
      const resolved = pcrRatioValue(asset, day);
      if (!resolved) continue;
      const x = padding.left + (dayCount > 1 ? i * xStep : innerWidth / 2);
      const y = padding.top + innerHeight - (resolved.ratio / PCR_MAX_RATIO) * innerHeight;
      points.push({ x, y, day, resolved, asset });
    }
    if (points.length < 1) continue;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    path.setAttribute('d', d);
    path.setAttribute('class', `pcr-line${isHidden ? ' muted' : ''}`);
    path.setAttribute('stroke', isHidden ? 'rgba(143, 168, 178, 0.4)' : color);
    path.dataset.asset = asset.label;
    svg.appendChild(path);
    segments.push({ asset, color, points, isHidden });

    for (const p of points) {
      if (p.resolved.clipped) {
        const tri = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const size = 4;
        const dTri = `M ${p.x} ${p.y - size} L ${p.x - size} ${p.y + size / 2} L ${p.x + size} ${p.y + size / 2} Z`;
        tri.setAttribute('d', dTri);
        tri.setAttribute('class', `pcr-clipped-point${isHidden ? ' muted' : ''}`);
        tri.setAttribute('fill', isHidden ? 'rgba(143, 168, 178, 0.4)' : color);
        tri.setAttribute('stroke', isHidden ? 'rgba(143, 168, 178, 0.4)' : color);
        svg.appendChild(tri);
      } else {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(p.x.toFixed(2)));
        dot.setAttribute('cy', String(p.y.toFixed(2)));
        dot.setAttribute('r', '2.4');
        dot.setAttribute('class', `pcr-point${isHidden ? ' muted' : ''}`);
        dot.setAttribute('fill', isHidden ? 'rgba(143, 168, 178, 0.4)' : color);
        svg.appendChild(dot);
      }
    }
  }

  // Tooltip layer
  const tooltip = document.createElement('div');
  tooltip.className = 'pcr-tooltip';
  tooltip.style.display = 'none';
  wrap.appendChild(svg);
  wrap.appendChild(tooltip);

  const pxPerUnitX = () => wrap.clientWidth / width;
  const pxPerUnitY = () => wrap.clientHeight / height;

  const onMove = (event) => {
    if (!segments.length) return;
    const rect = svg.getBoundingClientRect();
    const xPx = event.clientX - rect.left;
    const xCss = (xPx / rect.width) * width;
    if (xCss < padding.left - 4 || xCss > padding.left + innerWidth + 4) {
      tooltip.style.display = 'none';
      return;
    }
    let dayIndex;
    if (dayCount === 1) dayIndex = 0;
    else {
      dayIndex = Math.round((xCss - padding.left) / xStep);
      dayIndex = Math.max(0, Math.min(dayCount - 1, dayIndex));
    }
    const day = days[dayIndex];
    const visibleSegments = segments.filter((s) => !s.isHidden);
    if (!visibleSegments.length) {
      tooltip.style.display = 'none';
      return;
    }
    const rows = visibleSegments
      .map((seg) => {
        const assetDay = seg.asset.days[dayIndex];
        const resolved = pcrRatioValue(seg.asset, assetDay);
        const ratioText = !resolved
          ? 'no data'
          : resolved.clipped
            ? '∞'
            : pcrFormatRatio(resolved.ratio);
        const prod = pcrFormatInteger(assetDay.production);
        const cons = pcrFormatInteger(assetDay.consumption);
        return `<div class="pcr-tooltip-row"><span class="pcr-tooltip-swatch" style="background:${seg.color}"></span><span>${seg.asset.label}</span><span style="color:var(--muted)">${prod} / ${cons}</span><span style="margin-left:6px">${ratioText}</span></div>`;
      })
      .join('');
    tooltip.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${day.label}</div>${rows}`;
    tooltip.style.display = 'block';
    const left = padding.left + dayIndex * xStep;
    const tipRect = tooltip.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    let tx = left * pxPerUnitX() - tipRect.width / 2;
    tx = Math.max(4, Math.min(wrapRect.width - tipRect.width - 4, tx));
    const ty = padding.top * pxPerUnitY() + 4;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${ty}px`;
  };
  const onLeave = () => {
    tooltip.style.display = 'none';
  };
  svg.addEventListener('mousemove', onMove);
  svg.addEventListener('mouseleave', onLeave);
}

function pcrRenderLegend(category, assets) {
  const legend = pcrCategoryRefs[category.id]?.legend;
  if (!legend) return;
  legend.textContent = '';
  if (!assets.length) return;
  const faction = normalizeFaction(latestSettings?.faction);
  const visibilitySet = pcrGetCategoryVisibility(faction, category.id);
  for (const asset of assets) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pcr-legend-chip';
    const isHidden = visibilitySet.has(asset.label);
    if (isHidden) chip.classList.add('muted');
    const color = getAssetChartColor(asset.label);
    const swatch = document.createElement('span');
    swatch.className = 'pcr-legend-swatch';
    swatch.style.background = color;
    chip.appendChild(swatch);
    const label = document.createElement('span');
    label.textContent = asset.label;
    chip.appendChild(label);
    const count = document.createElement('span');
    count.className = 'pcr-legend-count';
    count.textContent = `${pcrFormatInteger(asset.productionTotal)}/${pcrFormatInteger(asset.consumptionTotal)}`;
    chip.appendChild(count);
    chip.title = isHidden
      ? `Click to show ${asset.label}`
      : `Click to hide ${asset.label}`;
    chip.addEventListener('click', () => pcrToggleAsset(category.id, asset.label));
    legend.appendChild(chip);
  }
}

function pcrRenderCategory(category, assets) {
  const refs = pcrCategoryRefs[category.id];
  if (!refs) return;
  if (refs.summary) {
    refs.summary.textContent = pcrCategorySummary({ assets });
  }
  pcrCreateLineChart(category, latestPcrResult?.days || [], assets);
  pcrRenderLegend(category, assets);
}

function pcrRenderEmpty(message) {
  if (pcrFactionNote) pcrFactionNote.textContent = `Last 14 days · production ÷ consumption · ${message}`;
  for (const category of PCR_CATEGORIES) {
    const refs = pcrCategoryRefs[category.id];
    if (!refs) continue;
    if (refs.summary) refs.summary.textContent = '--';
    if (refs.svgWrap) {
      refs.svgWrap.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = message;
      refs.svgWrap.appendChild(empty);
    }
    if (refs.legend) refs.legend.textContent = '';
  }
}

function renderPcrCharts(result) {
  if (!pcrChartGrid) return;
  latestPcrResult = result;
  if (!result || !result.ok) {
    pcrRenderEmpty('Influx unavailable');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'pcr', result);

  if (pcrFactionNote) {
    const faction = normalizeFaction(latestSettings?.faction);
    const parts = ['Last 14 days', `Faction ${faction}`, 'production ÷ consumption'];
    if (result.productionError) parts.push(`production: ${result.productionError}`);
    if (result.consumptionError) parts.push(`consumption: ${result.consumptionError}`);
    pcrFactionNote.textContent = parts.join(' · ');
  }

  const buckets = pcrBucketAssetsByCategory(result);
  for (const category of PCR_CATEGORIES) {
    const bucket = buckets.get(category.id);
    pcrRenderCategory(category, bucket.assets);
  }
}

async function refreshPcrCharts() {
  if (!pcrChartGrid) return;
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    pcrRenderEmpty('Awaiting Influx connection');
    return;
  }
  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFactionResult(faction, 'pcr');
  if (cached) {
    renderPcrCharts(cached);
  } else {
    pcrRenderEmpty('Loading PCR data...');
  }
  try {
    const result = await api.getPcrCharts(latestSettings || getFormPayload());
    renderPcrCharts(result);
  } catch (error) {
    console.error(error);
    if (!cached) pcrRenderEmpty('Influx unavailable');
  }
}

/* ---- Inventory ---- */

const INV_CONSUMABLE_ASSETS = Object.freeze(['Ammunition', 'Food', 'Fuel']);
const INV_SMALL_CARD_IDS = Object.freeze(['ammunition', 'food', 'fuel']);
const INV_WIDE_CARD_ID = 'all-assets';
const INV_DEFAULT_METHOD = 'regression'; // two-point vs linear-regression slope
const invAssetVisibility = new Map(); // faction -> Map<starbase, Set<assetLabel>>

const invRefs = {
  starbaseSelect: null,
  factionNote: null,
  smallCards: {}, // id -> { wrap, summary }
  wideCard: { wrap: null, summary: null, legend: null },
  bars: { consumables: null, other: null },
};
let latestInventoryResult = null;
let invSelectedStarbase = '__all__';
let invMethod = INV_DEFAULT_METHOD;

// Per-faction per-starbase Set of hidden asset labels. An empty
// Set means "show every asset" — that's the default on first open
// and on every starbase/faction switch.
function invGetVisibility(faction, starbase) {
  if (!invAssetVisibility.has(faction)) invAssetVisibility.set(faction, new Map());
  const factionMap = invAssetVisibility.get(faction);
  if (!factionMap.has(starbase)) factionMap.set(starbase, new Set());
  return factionMap.get(starbase);
}

function invGetBucketAssets(result, predicate) {
  if (!result?.ok) return [];
  return (Array.isArray(result.assets) ? result.assets : []).filter(predicate);
}

function invSetStarbaseOptions(starbases, current) {
  const select = invRefs.starbaseSelect;
  if (!select) return;
  select.textContent = '';
  const optAll = document.createElement('option');
  optAll.value = '__all__';
  optAll.textContent = 'All Starbases';
  select.appendChild(optAll);
  for (const sb of starbases) {
    const opt = document.createElement('option');
    opt.value = sb;
    opt.textContent = sb;
    select.appendChild(opt);
  }
  select.value = starbases.includes(current) || current === '__all__' ? current : '__all__';
  invSelectedStarbase = select.value;
}

function invFormatInteger(n) {
  if (!Number.isFinite(n)) return '--';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function invFormatAverage(n) {
  if (!Number.isFinite(n)) return '--';
  const sign = n > 0 ? '+' : n < 0 ? '' : '';
  return `${sign}${invFormatInteger(Math.abs(n) === 0 ? 0 : n)}`;
}

// Compute the per-day average change for a single asset across the
// window. Two modes:
//   - 'two-point':  (lastValue - firstValue) / (numDays - 1)
//   - 'regression': least-squares slope of value vs day index
//     (N*sum(xy) - sum(x)*sum(y)) / (N*sum(x*x) - sum(x)^2)
function invComputeAverage(asset, method) {
  const points = asset.days
    .map((d, i) => ({ x: i, y: d.value, has: d.value > 0 }))
    .filter((p) => p.has);
  if (points.length < 2) return null;
  const firstX = points[0].x;
  const lastX = points[points.length - 1].x;
  const firstY = points[0].y;
  const lastY = points[points.length - 1].y;
  if (method === 'two-point') {
    const span = Math.max(1, lastX - firstX);
    return (lastY - firstY) / span;
  }
  // linear regression: use the per-day index as x, value as y
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

function invRenderEmpty(message) {
  for (const id of INV_SMALL_CARD_IDS) {
    const card = invRefs.smallCards[id];
    if (!card) continue;
    if (card.wrap) {
      card.wrap.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'pcr-empty-state';
      empty.textContent = message;
      card.wrap.appendChild(empty);
    }
    if (card.summary) card.summary.textContent = '--';
  }
  if (invRefs.wideCard.wrap) {
    invRefs.wideCard.wrap.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'pcr-empty-state';
    empty.textContent = message;
    invRefs.wideCard.wrap.appendChild(empty);
  }
  if (invRefs.wideCard.summary) invRefs.wideCard.summary.textContent = '--';
  if (invRefs.wideCard.legend) invRefs.wideCard.legend.textContent = '';
  if (invRefs.bars.consumables) invRefs.bars.consumables.textContent = '';
  if (invRefs.bars.other) invRefs.bars.other.textContent = '';
  if (invRefs.factionNote) invRefs.factionNote.textContent = `Last 14 days · inventory at starbase · ${message}`;
}

function invRenderSmallCard(category, asset) {
  const card = invRefs.smallCards[category];
  if (!card || !card.wrap) return;
  card.wrap.textContent = '';
  if (!asset) {
    const empty = document.createElement('div');
    empty.className = 'pcr-empty-state';
    empty.textContent = 'No data';
    card.wrap.appendChild(empty);
    if (card.summary) card.summary.textContent = 'No data';
    return;
  }
  invRenderLineChart(card.wrap, asset, { strokeWidth: 3, showAxis: true, color: getAssetChartColor(asset.label) });
  if (card.summary) {
    const last = asset.days.findLast ? asset.days.findLast((d) => d.value > 0) : [...asset.days].reverse().find((d) => d.value > 0);
    card.summary.textContent = last ? `${invFormatInteger(last.value)} (last)` : 'No data';
  }
}

function invRenderWideCard(assets) {
  const wrap = invRefs.wideCard.wrap;
  if (!wrap) {
    console.warn('[inventory] wide card wrap not found');
    return;
  }
  // Debug: log the wrap dimensions and asset count so we can see
  // whether the chart is being created with proper dimensions.
  console.log('[inventory] invRenderWideCard', {
    assets: assets.length,
    wrapWidth: wrap.clientWidth,
    wrapHeight: wrap.clientHeight,
    visibility: Array.from(invGetVisibility(normalizeFaction(latestSettings?.faction), invSelectedStarbase)),
  });
  // If the wrap hasn't been laid out yet (0×0), wait for the next
  // animation frame and re-measure. This is the most likely cause of
  // the "wide card is empty" bug when the panel is first shown.
  if (wrap.clientWidth === 0 || wrap.clientHeight === 0) {
    console.log('[inventory] wide card wrap has 0 dimensions, deferring to next frame');
    requestAnimationFrame(() => {
      if (wrap.clientWidth > 0 && wrap.clientHeight > 0) {
        invRenderWideCard(assets);
      } else {
        // Still 0 — try once more on the next frame.
        requestAnimationFrame(() => invRenderWideCard(assets));
      }
    });
    return;
  }
  wrap.textContent = '';
  if (!assets.length) {
    const empty = document.createElement('div');
    empty.className = 'pcr-empty-state';
    empty.textContent = 'No inventory data';
    wrap.appendChild(empty);
    if (invRefs.wideCard.summary) invRefs.wideCard.summary.textContent = 'No assets';
    if (invRefs.wideCard.legend) invRefs.wideCard.legend.textContent = '';
    return;
  }
  invRenderLineChart(wrap, null, { strokeWidth: 3, showAxis: false, color: '#fff' }, assets);
  if (invRefs.wideCard.summary) {
    invRefs.wideCard.summary.textContent = `${assets.length} asset${assets.length === 1 ? '' : 's'}`;
  }
  invRenderWideLegend(assets);
}

function invRenderLineChart(wrap, singleAsset, opts, multiAssets) {
  const assets = multiAssets || (singleAsset ? [singleAsset] : []);
  if (!assets.length) return;
  // If the wrap hasn't been laid out yet (0×0), wait for the next
  // animation frame and re-render. This handles the case where the
  // panel was just shown and the flex layout hasn't settled.
  if (wrap.clientWidth === 0 || wrap.clientHeight === 0) {
    requestAnimationFrame(() => invRenderLineChart(wrap, singleAsset, opts, multiAssets));
    return;
  }
  const padding = { top: 8, right: 10, bottom: 18, left: 38 };
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // Determine common X axis (day index 0..13) and Y range across all assets.
  // The Y axis is always anchored at zero on the bottom and at the global
  // max value on the top, so small changes stay visible and the line never
  // auto-zooms away from zero.
  const numDays = assets[0].days.length;
  const xStep = numDays > 1 ? innerWidth / (numDays - 1) : 0;
  let maxY = 0;
  for (const a of assets) {
    for (const d of a.days) {
      if (d.value > maxY) maxY = d.value;
    }
  }
  if (maxY === 0) maxY = 1;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'inv-chart-svg');
  svg.setAttribute('preserveAspectRatio', 'none');
  wrap.appendChild(svg);

  // Y axis labels (3 ticks: 0 at the bottom, 50%, then maxY on top).
  // The bottom tick is always zero, the top tick is always the data
  // maximum, so the y-axis never starts above zero.
  if (opts.showAxis) {
    for (let i = 0; i < 3; i += 1) {
      // i=0 (top) -> maxY, i=1 (mid) -> maxY/2, i=2 (bot) -> 0
      const v = (maxY * (2 - i)) / 2;
      const y = padding.top + (innerHeight * i) / 2;
      const label = document.createElement('div');
      label.className = 'inv-axis-label';
      label.textContent = invFormatInteger(v);
      label.style.position = 'absolute';
      label.style.right = `${width - padding.left + 6}px`;
      label.style.top = `${y - 7}px`;
      label.style.fontSize = '10px';
      label.style.color = 'var(--muted)';
      wrap.appendChild(label);
    }
    for (let i = 0; i < 3; i += 1) {
      const y = padding.top + (innerHeight * i) / 2;
      const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      grid.setAttribute('x1', String(padding.left));
      grid.setAttribute('x2', String(padding.left + innerWidth));
      grid.setAttribute('y1', String(y));
      grid.setAttribute('y2', String(y));
      grid.setAttribute('stroke', 'rgba(143, 168, 178, 0.15)');
      grid.setAttribute('stroke-dasharray', '2 4');
      svg.appendChild(grid);
    }
  }

  // X axis day labels (every other day)
  for (let i = 0; i < numDays; i += 1) {
    if (i !== 0 && i !== numDays - 1 && i % 2 !== 0) continue;
    const x = padding.left + (numDays > 1 ? i * xStep : innerWidth / 2);
    const label = document.createElement('div');
    label.className = 'inv-axis-label';
    label.textContent = assets[0].days[i].label;
    label.style.position = 'absolute';
    label.style.left = `${x - 14}px`;
    label.style.bottom = '2px';
    label.style.fontSize = '10px';
    label.style.color = 'var(--muted)';
    label.style.width = '28px';
    label.style.textAlign = 'center';
    wrap.appendChild(label);
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const visibility = invGetVisibility(faction, invSelectedStarbase);

  for (const asset of assets) {
    const isHidden = visibility.has(asset.label);
    if (isHidden) continue;
    const color = getAssetChartColor(asset.label);
    const points = [];
    for (let i = 0; i < asset.days.length; i += 1) {
      const d = asset.days[i];
      if (d.value <= 0) continue;
      const x = padding.left + (numDays > 1 ? i * xStep : innerWidth / 2);
      const y = padding.top + innerHeight - (d.value / maxY) * innerHeight;
      points.push({ x, y, day: d, asset });
    }
    if (points.length < 1) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(opts.strokeWidth || 3));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', '0.9');
    svg.appendChild(path);
  }
}

function invRenderWideLegend(assets) {
  const legend = invRefs.wideCard.legend;
  if (!legend) return;
  legend.textContent = '';
  const faction = normalizeFaction(latestSettings?.faction);
  const visibility = invGetVisibility(faction, invSelectedStarbase);
  for (const asset of assets) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'inv-legend-chip';
    const isHidden = visibility.has(asset.label);
    if (isHidden) chip.classList.add('muted');
    const swatch = document.createElement('span');
    swatch.className = 'inv-legend-swatch';
    swatch.style.background = getAssetChartColor(asset.label);
    chip.appendChild(swatch);
    const label = document.createElement('span');
    label.textContent = asset.label;
    chip.appendChild(label);
    chip.title = isHidden ? `Click to show ${asset.label}` : `Click to hide ${asset.label}`;
    chip.addEventListener('click', () => {
      const set = invGetVisibility(faction, invSelectedStarbase);
      if (set.has(asset.label)) set.delete(asset.label);
      else set.add(asset.label);
      if (latestInventoryResult) renderInventory(latestInventoryResult);
    });
    legend.appendChild(chip);
  }
}

function invRenderBars(assets) {
  const consumables = invRefs.bars.consumables;
  const other = invRefs.bars.other;
  if (!consumables || !other) return;
  consumables.textContent = '';
  other.textContent = '';

  const consumableAssets = assets.filter((a) => INV_CONSUMABLE_ASSETS.includes(a.label));
  const otherAssets = assets.filter((a) => !INV_CONSUMABLE_ASSETS.includes(a.label));

  // Build per-asset rows. Every asset is included, even those that
  // don't yet have two data points — we just render them in a muted
  // "no average" state so the user always sees the full asset list.
  const rows = assets.map((a) => {
    const avg = invComputeAverage(a, invMethod);
    return { label: a.label, avg, asset: a };
  });
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'inv-bar-empty';
    empty.textContent = 'Not enough data for averages yet';
    consumables.appendChild(empty.cloneNode(true));
    other.appendChild(empty);
    return;
  }

  // Find the global max absolute value among the rows that DO have an
  // average, so the bar scale stays consistent even when some assets
  // are in the no-average state.
  const avgRows = rows.filter((r) => r.avg !== null);
  const maxAbs = Math.max(1, ...avgRows.map((r) => Math.abs(r.avg)));

  const drawColumn = (container, list) => {
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-bar-empty';
      empty.textContent = 'No assets in this column';
      container.appendChild(empty);
      return;
    }
    // Sort: rows with an average go first (largest positive to largest
    // negative), then no-average rows in alphabetical order. This keeps
    // the meaningful chart on top and the "—" rows tucked below.
    const sorted = [...list].sort((a, b) => {
      const aHas = a.avg !== null;
      const bHas = b.avg !== null;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas) return b.avg - a.avg;
      return a.label.localeCompare(b.label);
    });
    for (const row of sorted) {
      const hasAvg = row.avg !== null;
      const rowEl = document.createElement('div');
      rowEl.className = 'inv-bar-row';
      if (!hasAvg) rowEl.classList.add('inv-bar-row-noavg');
      const labelEl = document.createElement('div');
      labelEl.className = 'inv-bar-label';
      labelEl.textContent = row.label;
      labelEl.title = row.label;
      const track = document.createElement('div');
      track.className = 'inv-bar-track';
      if (hasAvg) {
        const zero = document.createElement('div');
        zero.className = 'inv-bar-zero';
        track.appendChild(zero);
        const fill = document.createElement('div');
        fill.className = `inv-bar-fill ${row.avg >= 0 ? 'positive' : 'negative'}`;
        const widthPct = (Math.abs(row.avg) / maxAbs) * 50; // 50% = full bar in either direction
        fill.style.width = `${widthPct}%`;
        track.appendChild(fill);
      }
      const valueEl = document.createElement('div');
      valueEl.className = 'inv-bar-value';
      if (hasAvg) {
        const sign = row.avg > 0 ? '+' : '';
        valueEl.textContent = `${sign}${invFormatInteger(row.avg)}/d`;
        valueEl.title = `${sign}${row.avg.toFixed(2)}/day`;
      } else {
        valueEl.textContent = '—';
        valueEl.title = 'Not enough data for an average yet (need 2+ data points in the window)';
      }
      rowEl.appendChild(labelEl);
      rowEl.appendChild(track);
      rowEl.appendChild(valueEl);
      container.appendChild(rowEl);
    }
  };

  drawColumn(consumables, consumableAssets.map((a) => rows.find((r) => r.label === a.label)).filter(Boolean));
  drawColumn(other, otherAssets.map((a) => rows.find((r) => r.label === a.label)).filter(Boolean));
}

function renderInventory(result) {
  latestInventoryResult = result;
  if (!result) {
    invRenderEmpty('No data');
    return;
  }
  if (!result.ok) {
    invRenderEmpty(result.error || 'Influx unavailable');
    return;
  }

  // Populate the starbase selector.
  if (Array.isArray(result.starbases)) {
    invSetStarbaseOptions(result.starbases, invSelectedStarbase);
  }
  if (invRefs.factionNote) {
    const viewLabel = result.isAggregate
      ? `${result.faction} · all starbases`
      : `${result.faction} · ${result.starbase}`;
    invRefs.factionNote.textContent = `Last 14 days · ${viewLabel}`;
  }

  // Filter to the selected starbase if the user picked one.
  let assets = Array.isArray(result.assets) ? result.assets : [];
  if (invSelectedStarbase !== '__all__') {
    // Single-starbase view: just show the result (the query already
    // filtered down). The result.assets is per-day per-rss for the
    // one starbase.
    assets = assets;
  }

  // Small cards: Ammunition, Food, Fuel
  for (const id of INV_SMALL_CARD_IDS) {
    const label = id.charAt(0).toUpperCase() + id.slice(1);
    const asset = assets.find((a) => a.label === label);
    invRenderSmallCard(id, asset);
  }

  // Wide card: all assets except the 3 consumables (which already have
  // their own cards).
  const wideAssets = assets.filter((a) => !INV_CONSUMABLE_ASSETS.includes(a.label));
  invRenderWideCard(wideAssets);

  // Bar charts.
  invRenderBars(assets);

  invSyncMethodToggle();
}

function invSyncMethodToggle() {
  for (const button of document.querySelectorAll('.inv-method-button')) {
    const isActive = button.dataset.invMethod === invMethod;
    button.classList.toggle('active', isActive);
  }
}

async function refreshInventory() {
  if (!invRefs.starbaseSelect) return;
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    invRenderEmpty('Awaiting Influx connection');
    return;
  }
  const faction = normalizeFaction(latestSettings?.faction);
  const cacheKey = `inventory::${invSelectedStarbase}`;
  const cached = getCachedFactionResult(faction, cacheKey);
  if (cached) renderInventory(cached);
  else invRenderEmpty('Loading inventory data...');
  try {
    const result = await api.getInventory({
      ...(latestSettings || getFormPayload()),
      starbase: invSelectedStarbase === '__all__' ? '' : invSelectedStarbase,
    });
    setCachedFactionResult(faction, cacheKey, result);
    renderInventory(result);
  } catch (error) {
    console.error(error);
    if (!cached) invRenderEmpty('Influx unavailable');
  }
}

function initInventory() {
  invRefs.starbaseSelect = document.getElementById('inv-starbase-select');
  invRefs.factionNote = document.getElementById('inv-faction-note');
  for (const id of INV_SMALL_CARD_IDS) {
    invRefs.smallCards[id] = {
      wrap: document.getElementById(`inv-${id}-svg-wrap`),
      summary: document.getElementById(`inv-${id}-summary`),
    };
  }
  invRefs.wideCard = {
    wrap: document.getElementById(`${INV_WIDE_CARD_ID}-svg-wrap`),
    summary: document.getElementById(`${INV_WIDE_CARD_ID}-summary`),
    legend: document.getElementById(`${INV_WIDE_CARD_ID}-legend`),
  };
  invRefs.bars.consumables = document.getElementById('inv-bars-consumables');
  invRefs.bars.other = document.getElementById('inv-bars-other');
  if (invRefs.starbaseSelect) {
    invRefs.starbaseSelect.addEventListener('change', () => {
      invSelectedStarbase = invRefs.starbaseSelect.value || '__all__';
      refreshInventory();
    });
  }
  for (const button of document.querySelectorAll('.inv-method-button')) {
    button.addEventListener('click', () => {
      const next = button.dataset.invMethod;
      if (next !== 'regression' && next !== 'two-point') return;
      if (invMethod === next) return;
      invMethod = next;
      if (latestInventoryResult) renderInventory(latestInventoryResult);
    });
  }
}

function createConsumptionBarCard(asset, fallbackIndex) {
  const maxValue = Math.max(...asset.days.map((day) => Number(day.value) || 0), 1);
  const card = document.createElement('section');
  card.className = 'resource-card';

  const header = document.createElement('div');
  header.className = 'resource-card-header';
  const title = document.createElement('h3');
  title.className = 'resource-card-title';
  title.textContent = asset.label;
  const total = document.createElement('span');
  total.className = 'resource-card-total';
  total.textContent = formatWholeNumber(asset.total);
  header.appendChild(title);
  header.appendChild(total);

  const bars = document.createElement('div');
  bars.className = 'resource-chart-bars';
  bars.setAttribute('aria-label', `${asset.label} consumed over the last 14 days`);
  bars.appendChild(createYAxis(maxValue));
  for (const day of asset.days) {
    const value = Number(day.value) || 0;
    const height = Math.max(3, Math.round((value / maxValue) * 75));
    const bar = document.createElement('div');
    bar.className = 'resource-chart-bar';
    bar.title = `${day.label}: ${formatWholeNumber(value)}`;
    const fill = document.createElement('span');
    fill.className = 'resource-chart-fill';
    fill.style.height = `${height}%`;
    fill.style.background = getAssetChartFill(asset.label, fallbackIndex);
    bar.appendChild(fill);
    bars.appendChild(bar);
  }

  card.appendChild(header);
  card.appendChild(bars);
  return card;
}

async function refreshDailyProduction() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderProductionEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFilterResult(faction, 'production', selectedProductionStarbase);
  if (cached) {
    renderProductionCharts(cached);
  } else {
    renderProductionEmpty('Loading production data...');
  }
  try {
    const result = await api.getDailyProduction({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: selectedProductionStarbase,
    });
    renderProductionCharts(result);
  } catch (error) {
    console.error(error);
    if (!cached) renderProductionEmpty('Influx unavailable');
  }
}

async function refreshDailyCrafting() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderCraftingEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFilterResult(faction, 'crafting', selectedCraftingStarbase, selectedCraftingRecipe);
  if (cached) {
    renderCraftingCharts(cached);
  } else {
    renderCraftingEmpty('Loading crafting data...');
  }
  try {
    const result = await api.getDailyCrafting({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: selectedCraftingStarbase,
      recipeFilter: selectedCraftingRecipe,
    });
    renderCraftingCharts(result);
  } catch (error) {
    console.error(error);
    if (!cached) renderCraftingEmpty('Influx unavailable');
  }
}

async function refreshDailyMining() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderMiningEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFilterResult(faction, 'mining', selectedMiningStarbase, selectedMiningFleet);
  if (cached) {
    renderMiningCharts(cached);
  } else {
    renderMiningEmpty('Loading mining data...');
  }
  try {
    const result = await api.getDailyMining({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: selectedMiningStarbase,
      fleetFilter: selectedMiningFleet,
    });
    renderMiningCharts(result);
  } catch (error) {
    console.error(error);
    if (!cached) renderMiningEmpty('Influx unavailable');
  }
}

async function refreshDailySdu() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderSduEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const cached = getCachedFilterResult(faction, 'sdu', selectedScanningFleet);
  if (cached) {
    renderSduChart(cached);
  } else {
    renderSduEmpty('Loading SDU data...');
  }
  try {
    const result = await api.getDailySdu({
      ...(latestSettings || getFormPayload()),
      fleetFilter: selectedScanningFleet,
    });
    renderSduChart(result);
  } catch (error) {
    console.error(error);
    if (!cached) renderSduEmpty('Influx unavailable');
  }
}

function setFleetStatus(message) {
  setText(fleetSyncStatus, message);
}

function renderFleetEmpty(message) {
  fleetTableBody.textContent = '';
  const row = document.createElement('tr');
  row.className = 'empty-row';
  const cell = document.createElement('td');
  cell.colSpan = 4;
  cell.textContent = message;
  row.appendChild(cell);
  fleetTableBody.appendChild(row);
}

function createFleetCell(fleet) {
  const cell = document.createElement('td');
  const name = document.createElement('strong');
  name.textContent = fleet.label || 'Unnamed fleet';
  cell.appendChild(name);
  return cell;
}

function createTextCell(value) {
  const cell = document.createElement('td');
  cell.textContent = value || '--';
  return cell;
}

function createAccountCell(value) {
  const cell = document.createElement('td');
  cell.className = 'account-cell';
  cell.textContent = value || '--';
  cell.title = value || '';
  return cell;
}

function getFleetFilterText(fleet) {
  return [fleet.label, fleet.ownership, fleet.activity, fleet.key]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getFilteredFleets(fleets) {
  const query = String(fleetSearchInput?.value || '').trim().toLowerCase();
  if (!query) return fleets;
  return fleets.filter((fleet) => getFleetFilterText(fleet).includes(query));
}

function renderFleetRows(fleets, emptyMessage) {
  if (!fleets.length) {
    renderFleetEmpty(emptyMessage);
    return;
  }

  fleetTableBody.textContent = '';
  for (const fleet of fleets) {
    const row = document.createElement('tr');
    row.appendChild(createFleetCell(fleet));

    const ownershipCell = document.createElement('td');
    const ownership = document.createElement('span');
    ownership.className = fleet.relationship === 'managed' ? 'state-pill warning' : 'state-pill ready';
    ownership.textContent = fleet.ownership || 'Owned';
    ownershipCell.appendChild(ownership);
    row.appendChild(ownershipCell);

    row.appendChild(createTextCell(fleet.activity));
    row.appendChild(createAccountCell(fleet.key));
    fleetTableBody.appendChild(row);
  }
}

function renderFleetSearch() {
  if (!latestFleetResult?.ok) return;
  const fleets = Array.isArray(latestFleetResult.fleets) ? latestFleetResult.fleets : [];
  const filteredFleets = getFilteredFleets(fleets);
  const hasQuery = Boolean(String(fleetSearchInput?.value || '').trim());
  renderFleetRows(filteredFleets, hasQuery ? 'No fleets match this search' : `No ${normalizeFaction(latestSettings?.faction)} fleets found`);

  const ownedCount = Number(latestFleetResult.ownedFleetCount ?? 0);
  const managedCount = Number(latestFleetResult.managedFleetCount ?? 0);
  const filterPrefix = hasQuery ? `${filteredFleets.length} of ${fleets.length}` : `${fleets.length}`;
  setFleetStatus(
    `${filterPrefix} fleets loaded from blockchain at ${formatCheckedAt(latestFleetResult.checkedAt)} (${ownedCount} owned, ${managedCount} managed)`
  );
}

function renderFleets(result) {
  latestFleetResult = result;
  if (!result?.ok) {
    renderFleetEmpty(result?.error || 'Fleet sync failed');
    setFleetStatus('Blockchain sync failed');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'fleet', result);

  const fleets = Array.isArray(result.fleets) ? result.fleets : [];
  if (!fleets.length) {
    renderFleetEmpty(`No ${normalizeFaction(latestSettings?.faction)} fleets found`);
    setFleetStatus(`Blockchain synced at ${formatCheckedAt(result.checkedAt)}`);
    return;
  }

  renderFleetSearch();
}

async function refreshFleets() {
  const settings = latestSettings || getFormPayload();
  if (!getActivePlayerProfile(settings)) {
    latestFleetResult = null;
    renderFleetEmpty(`No ${normalizeFaction(settings.faction)} player profile configured`);
    setFleetStatus('Awaiting player profile');
    return;
  }

  setFleetStatus('Loading fleets from blockchain...');
  try {
    const result = await api.getFleets(settings);
    renderFleets(result);
  } catch (error) {
    console.error(error);
    renderFleetEmpty('Fleet sync failed');
    setFleetStatus('Blockchain sync failed');
  }
}

function setActiveSection(section) {
  currentSection = section;
  document.querySelectorAll('.nav-button').forEach((button) => {
    const active = button.dataset.section === section;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-section-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.sectionPanel === section);
  });
  updateTitle();
}

function setActiveSubtab(subtab) {
  currentSubtab = subtab;
  document.querySelectorAll('.subtab-button').forEach((button) => {
    const active = button.dataset.subtab === subtab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-production-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.productionPanel === subtab);
  });
  updateTitle();
  if (subtab === 'mining' && !latestMiningResult && hasInfluxSettings(latestSettings || getFormPayload())) {
    refreshDailyMining();
  }
  if (subtab === 'crafting' && !latestCraftingResult && hasInfluxSettings(latestSettings || getFormPayload())) {
    refreshDailyCrafting();
  }
  if (subtab === 'production' && !latestProductionResult && hasInfluxSettings(latestSettings || getFormPayload())) {
    refreshDailyProduction();
  }
  if (subtab === 'consumption') {
    if (!latestConsScanningResult && hasInfluxSettings(latestSettings || getFormPayload())) refreshConsScanning();
    if (!latestConsMiningResult && hasInfluxSettings(latestSettings || getFormPayload())) refreshConsMining();
    if (!latestConsCargoResult && hasInfluxSettings(latestSettings || getFormPayload())) refreshConsCargo();
    if (!latestConsCraftingResult && hasInfluxSettings(latestSettings || getFormPayload())) refreshConsCrafting();
    if (!latestConsUpgradingResult && hasInfluxSettings(latestSettings || getFormPayload())) refreshConsUpgrading();
    if (!latestConsTotalResult && hasInfluxSettings(latestSettings || getFormPayload())) refreshConsTotal();
  }
  if (subtab === 'pct-charts') {
    if (!latestPcrResult && hasInfluxSettings(latestSettings || getFormPayload())) {
      refreshPcrCharts();
    } else if (latestPcrResult) {
      // The initial render may have happened while the panel was hidden
      // (clientWidth was 0). Re-render now that the wrap is laid out so
      // the HTML labels line up with the SVG.
      renderPcrCharts(latestPcrResult);
    }
  }
  if (subtab === 'inventory') {
    if (!latestInventoryResult && hasInfluxSettings(latestSettings || getFormPayload())) {
      refreshInventory();
    } else if (latestInventoryResult) {
      // The initial render may have happened while the panel was hidden
      // (clientWidth was 0). Re-render now that the wrap is laid out so
      // the HTML labels and SVG axes line up. Use a double rAF so the
      // flex layout (especially the 900px line grid) has fully settled
      // before we measure the wide card's wrap.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (latestInventoryResult) renderInventory(latestInventoryResult);
        });
      });
    }
  }
}

async function loadInitialState() {
  const [profileName, version, settings] = await Promise.all([
    api.getProfileName(),
    api.getAppVersion(),
    api.getSettings(),
  ]);

  setText(profileLabel, normalizeFaction(settings.faction) || profileName || 'USTUR');
  setText(versionLabel, version);
  latestSettings = settings;
  setFormValues(settings);
  updateFactionButtons(settings);
  updateSettingsStatus(settings);
  const initialLoads = [];
  if (getActivePlayerProfile(settings)) initialLoads.push(refreshFleets());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshDailySdu());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshDailyMining());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshDailyCrafting());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshDailyProduction());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshConsScanning());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshConsMining());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshConsCargo());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshConsCrafting());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshConsUpgrading());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshConsTotal());
  if (hasInfluxSettings(settings)) initialLoads.push(refreshPcrCharts());
  initInventory();
  if (hasInfluxSettings(settings)) initialLoads.push(refreshInventory());
  await Promise.all(initialLoads);
}

document.querySelectorAll('.nav-button').forEach((button) => {
  button.addEventListener('click', () => setActiveSection(button.dataset.section));
});

document.querySelectorAll('.subtab-button').forEach((button) => {
  button.addEventListener('click', () => setActiveSubtab(button.dataset.subtab));
});

async function refreshFactionScopedViews() {
  resetFactionScopedState();
  updateFactionButtons(latestSettings);
  updateSettingsStatus(latestSettings);
  renderSduEmpty(hasInfluxSettings(latestSettings) ? 'Loading SDU data...' : 'Awaiting Influx connection');
  renderMiningEmpty(hasInfluxSettings(latestSettings) ? 'Loading mining data...' : 'Awaiting Influx connection');
  renderCraftingEmpty(hasInfluxSettings(latestSettings) ? 'Loading crafting data...' : 'Awaiting Influx connection');
  renderProductionEmpty(hasInfluxSettings(latestSettings) ? 'Loading production data...' : 'Awaiting Influx connection');
  renderConsMiningEmpty(hasInfluxSettings(latestSettings) ? 'Loading mining consumption...' : 'Awaiting Influx connection');
  renderConsCraftingEmpty(hasInfluxSettings(latestSettings) ? 'Loading crafting consumption...' : 'Awaiting Influx connection');
  renderConsUpgradingEmpty(hasInfluxSettings(latestSettings) ? 'Loading upgrading consumption...' : 'Awaiting Influx connection');
  renderConsScanningEmpty(hasInfluxSettings(latestSettings) ? 'Loading scanning consumption...' : 'Awaiting Influx connection');
  renderConsCargoEmpty(hasInfluxSettings(latestSettings) ? 'Loading cargo consumption...' : 'Awaiting Influx connection');
  renderConsTotalEmpty(hasInfluxSettings(latestSettings) ? 'Loading total consumption...' : 'Awaiting Influx connection');
  pcrRenderEmpty(hasInfluxSettings(latestSettings) ? 'Loading PCR data...' : 'Awaiting Influx connection');
  invRenderEmpty(hasInfluxSettings(latestSettings) ? 'Loading inventory data...' : 'Awaiting Influx connection');
  await Promise.all([
    refreshFleets(),
    hasInfluxSettings(latestSettings) ? refreshDailySdu() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshDailyMining() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshDailyCrafting() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshDailyProduction() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshConsScanning() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshConsMining() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshConsCargo() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshConsCrafting() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshConsUpgrading() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshConsTotal() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshPcrCharts() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshInventory() : Promise.resolve(),
  ]);
}

factionButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const clickedFaction = normalizeFaction(button.dataset.faction);
    if (latestSettings && normalizeFaction(latestSettings.faction) === clickedFaction) return;

    // Cache current faction's filter state before switching
    const oldFaction = normalizeFaction(latestSettings?.faction);
    recordFactionFilterState(oldFaction);

    const nextSettings = mergeSettingsFromForm({ faction: clickedFaction });
    latestSettings = nextSettings;
    updateFactionButtons(nextSettings);
    updateSettingsStatus(nextSettings);

    // Restore cached filter selections for new faction
    restoreFactionFilterState(clickedFaction);

    // Render cached data immediately if available (per-filter cache)
    const faction = clickedFaction;
    const cachedFleet = getCachedFactionResult(faction, 'fleet');
    if (cachedFleet) renderFleets(cachedFleet);
    const cachedSdu = getCachedFilterResult(faction, 'sdu', selectedScanningFleet);
    if (cachedSdu) renderSduChart(cachedSdu);
    const cachedMining = getCachedFilterResult(faction, 'mining', selectedMiningStarbase, selectedMiningFleet);
    if (cachedMining) renderMiningCharts(cachedMining);
    const cachedCrafting = getCachedFilterResult(faction, 'crafting', selectedCraftingStarbase, selectedCraftingRecipe);
    if (cachedCrafting) renderCraftingCharts(cachedCrafting);
    const cachedProduction = getCachedFilterResult(faction, 'production', selectedProductionStarbase);
    if (cachedProduction) renderProductionCharts(cachedProduction);
    const cachedInventory = getCachedFactionResult(faction, 'inventory::__all__');
    if (cachedInventory) renderInventory(cachedInventory);
    const cachedConsMining = getCachedFilterResult(faction, 'consMining', selectedConsMiningStarbase, selectedConsMiningFleet);
    if (cachedConsMining) renderConsMining(cachedConsMining);
    const cachedConsCrafting = getCachedFilterResult(faction, 'consCrafting', selectedConsCraftingStarbase, selectedConsCraftingRecipe);
    if (cachedConsCrafting) renderConsCrafting(cachedConsCrafting);
    const cachedConsUpgrading = getCachedFilterResult(faction, 'consUpgrading', selectedConsUpgradingStarbase, selectedConsUpgradingComponent);
    if (cachedConsUpgrading) renderConsUpgrading(cachedConsUpgrading);
    const cachedPcr = getCachedFactionResult(faction, 'pcr');
    if (cachedPcr) renderPcrCharts(cachedPcr);

    saveStatus.textContent = `Switching to ${clickedFaction}...`;
    try {
      const saved = await api.saveSettings(nextSettings);
      latestSettings = saved;
      setFormValues(saved);
      await Promise.all([
        refreshFleets(),
        hasInfluxSettings(latestSettings) ? refreshDailySdu() : Promise.resolve(),
        hasInfluxSettings(latestSettings) ? refreshDailyMining() : Promise.resolve(),
        hasInfluxSettings(latestSettings) ? refreshDailyCrafting() : Promise.resolve(),
        hasInfluxSettings(latestSettings) ? refreshDailyProduction() : Promise.resolve(),
        hasInfluxSettings(latestSettings) ? refreshConsScanning() : Promise.resolve(),
        hasInfluxSettings(latestSettings) ? refreshConsMining() : Promise.resolve(),
        hasInfluxSettings(latestSettings) ? refreshConsCargo() : Promise.resolve(),
        hasInfluxSettings(latestSettings) ? refreshConsCrafting() : Promise.resolve(),
        hasInfluxSettings(latestSettings) ? refreshConsUpgrading() : Promise.resolve(),
        hasInfluxSettings(latestSettings) ? refreshConsTotal() : Promise.resolve(),
        hasInfluxSettings(latestSettings) ? refreshPcrCharts() : Promise.resolve(),
        // Inventory re-fetches on faction switch so the starbase
        // dropdown always reflects the new faction's starbases and
        // the per-asset visibility is loaded from the right slot.
        hasInfluxSettings(latestSettings) ? refreshInventory() : Promise.resolve(),
      ]);
      saveStatus.textContent = `${clickedFaction} selected`;
      setTimeout(() => {
        if (saveStatus.textContent === `${clickedFaction} selected`) {
          saveStatus.textContent = '';
        }
      }, 2200);
    } catch (error) {
      console.error(error);
      saveStatus.textContent = 'Faction switch failed';
    }
  });
});

scanningFleetFilter.addEventListener('change', () => {
  selectedScanningFleet = scanningFleetFilter.value;
  refreshDailySdu();
});

miningStarbaseFilter.addEventListener('change', () => {
  selectedMiningStarbase = miningStarbaseFilter.value;
  selectedMiningFleet = '';
  refreshDailyMining();
});

miningFleetFilter.addEventListener('change', () => {
  selectedMiningFleet = miningFleetFilter.value;
  refreshDailyMining();
});

craftingStarbaseFilter.addEventListener('change', () => {
  selectedCraftingStarbase = craftingStarbaseFilter.value;
  selectedCraftingRecipe = '';
  refreshDailyCrafting();
});

craftingRecipeFilter.addEventListener('change', () => {
  selectedCraftingRecipe = craftingRecipeFilter.value;
  refreshDailyCrafting();
});

// Production starbase filter
productionStarbaseFilter.addEventListener('change', () => {
  selectedProductionStarbase = productionStarbaseFilter.value;
  refreshDailyProduction();
});

// Consumption subtab switching
document.querySelectorAll('.consumption-subtab-button').forEach((button) => {
  button.addEventListener('click', () => {
    currentConsumptionSubtab = button.dataset.consumptionSubtab;
    document.querySelectorAll('.consumption-subtab-button').forEach((btn) => {
      const active = btn.dataset.consumptionSubtab === currentConsumptionSubtab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-consumption-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.consumptionPanel === currentConsumptionSubtab);
    });
  });
});

// Consumption — Mining filters
consMiningStarbaseFilter.addEventListener('change', () => {
  selectedConsMiningStarbase = consMiningStarbaseFilter.value;
  selectedConsMiningFleet = '';
  refreshConsMining();
});
consMiningFleetFilter.addEventListener('change', () => {
  selectedConsMiningFleet = consMiningFleetFilter.value;
  refreshConsMining();
});

// Consumption — Crafting filters
consCraftingStarbaseFilter.addEventListener('change', () => {
  selectedConsCraftingStarbase = consCraftingStarbaseFilter.value;
  selectedConsCraftingRecipe = '';
  refreshConsCrafting();
});
consCraftingRecipeFilter.addEventListener('change', () => {
  selectedConsCraftingRecipe = consCraftingRecipeFilter.value;
  refreshConsCrafting();
});

// Consumption — Upgrading filters
consUpgradingStarbaseFilter.addEventListener('change', () => {
  selectedConsUpgradingStarbase = consUpgradingStarbaseFilter.value;
  selectedConsUpgradingComponent = '';
  refreshConsUpgrading();
});
consUpgradingComponentFilter.addEventListener('change', () => {
  selectedConsUpgradingComponent = consUpgradingComponentFilter.value;
  refreshConsUpgrading();
});

// Consumption — Scanning filters
consScanningStarbaseFilter.addEventListener('change', () => {
  selectedConsScanningStarbase = consScanningStarbaseFilter.value;
  selectedConsScanningFleet = '';
  refreshConsScanning();
});
consScanningFleetFilter.addEventListener('change', () => {
  selectedConsScanningFleet = consScanningFleetFilter.value;
  refreshConsScanning();
});

// Consumption — Cargo filters
consCargoStarbaseFilter.addEventListener('change', () => {
  selectedConsCargoStarbase = consCargoStarbaseFilter.value;
  selectedConsCargoFleet = '';
  refreshConsCargo();
});
consCargoFleetFilter.addEventListener('change', () => {
  selectedConsCargoFleet = consCargoFleetFilter.value;
  refreshConsCargo();
});

// Consumption — Total filter
consTotalStarbaseFilter.addEventListener('change', () => {
  selectedConsTotalStarbase = consTotalStarbaseFilter.value;
  refreshConsTotal();
});

openSettingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', closeSettings);

settingsOverlay.addEventListener('click', (event) => {
  if (event.target === settingsOverlay) {
    closeSettings();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) {
    closeSettings();
  }
});

toggleSensitiveButton.addEventListener('click', () => {
  const hidden = form.classList.toggle('sensitive-hidden');
  toggleSensitiveButton.textContent = hidden ? 'Show' : 'Hide';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  saveStatus.textContent = 'Saving...';
  try {
    const saved = await api.saveSettings(getFormPayload());
    latestSettings = saved;
    setFormValues(saved);
    updateFactionButtons(saved);
    updateSettingsStatus(saved);
    resetFactionScopedState();
    refreshFleets();
    refreshDailySdu();
    refreshDailyMining();
    refreshDailyCrafting();
    refreshDailyProduction();
    refreshConsMining();
    refreshConsCrafting();
    refreshConsUpgrading();
    refreshConsScanning();
    refreshConsCargo();
    refreshConsTotal();
    saveStatus.textContent = 'Saved';
    setTimeout(() => {
      if (saveStatus.textContent === 'Saved') {
        saveStatus.textContent = '';
      }
    }, 2200);
  } catch (error) {
    console.error(error);
    saveStatus.textContent = 'Save failed';
  }
});

testInfluxButton.addEventListener('click', async () => {
  testInfluxButton.disabled = true;
  saveStatus.textContent = 'Testing Influx...';
  try {
    const result = await api.testInflux(getFormPayload());
    updateInfluxResult(result);
    saveStatus.textContent = result.ok ? 'Influx connected' : 'Influx failed';
  } catch (error) {
    console.error(error);
    updateInfluxResult({ ok: false, error: 'Test failed' });
    saveStatus.textContent = 'Influx failed';
  } finally {
    testInfluxButton.disabled = false;
  }
});

form.addEventListener('input', () => {
  latestSettings = getFormPayload();
  updateFactionButtons(latestSettings);
  updateSettingsStatus(latestSettings);
});

fleetSearchInput.addEventListener('input', renderFleetSearch);

loadInitialState().catch((error) => {
  console.error(error);
  saveStatus.textContent = 'Load failed';
});
