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
  'pct-charts': 'PCT Charts',
  surplus: 'Surplus',
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
const sduConsumptionValue = document.querySelector('#sdu-consumption-value');
const sduConsumptionNote = document.querySelector('#sdu-consumption-note');
const sduSurplusValue = document.querySelector('#sdu-surplus-value');
const sduSurplusNote = document.querySelector('#sdu-surplus-note');
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
let selectedCraftingStarbase = '';
let selectedCraftingRecipe = '';

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
});

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
  selectedScanningFleet = '';
  selectedMiningFleet = '';
  selectedCraftingStarbase = '';
  selectedCraftingRecipe = '';
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
  setText(sduConsumptionValue, '--');
  setText(sduConsumptionNote, message);
  setText(sduSurplusValue, '--');
  setText(sduSurplusNote, message);
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
  if (selectedScanningFleet) {
    setText(sduConsumptionValue, '--');
    setText(sduConsumptionNote, 'Not fleet-scoped');
    setText(sduSurplusValue, '--');
    setText(sduSurplusNote, 'All Fleets only');
  } else {
    setText(sduConsumptionValue, formatWholeNumber(result.consumption?.total || 0));
    setText(sduConsumptionNote, 'Crafting + upgrading');
    setText(sduSurplusValue, formatWholeNumber(result.surplus || 0));
    setText(sduSurplusNote, 'Found minus consumed');
  }
  sduChartBars.textContent = '';

  for (const day of days) {
    const value = Number(day.value) || 0;
    const height = Math.max(3, Math.round((value / maxValue) * 100));
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

  selectedMiningFleet = updateActivityFleetFilter(
    miningFleetFilter,
    miningFleetNote,
    result.fleets,
    result.selectedFleet || selectedMiningFleet
  );

  const materials = Array.isArray(result.materials) ? result.materials : [];
  if (!materials.length) {
    renderMiningEmpty('No mining data found');
    return;
  }

  const topMaterial = materials[0];
  setText(miningTotalValue, formatWholeNumber(result.total));
  setText(miningTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(miningTopValue, topMaterial.resource);
  setText(miningTopNote, formatWholeNumber(topMaterial.total));
  setText(miningMaterialCountValue, formatWholeNumber(result.materialCount || materials.length));
  setText(miningMaterialCountNote, 'Raw materials');
  miningChartGrid.textContent = '';

  for (const [materialIndex, material] of materials.entries()) {
    const maxValue = Math.max(...material.days.map((day) => Number(day.value) || 0), 1);
    const card = document.createElement('section');
    card.className = 'resource-card';

    const header = document.createElement('div');
    header.className = 'resource-card-header';
    const title = document.createElement('h3');
    title.className = 'resource-card-title';
    title.textContent = material.resource;
    const total = document.createElement('span');
    total.className = 'resource-card-total';
    total.textContent = formatWholeNumber(material.total);
    header.appendChild(title);
    header.appendChild(total);

    const bars = document.createElement('div');
    bars.className = 'resource-chart-bars';
    bars.setAttribute('aria-label', `${material.resource} mined over the last 14 days`);
    for (const day of material.days) {
      const value = Number(day.value) || 0;
      const height = Math.max(3, Math.round((value / maxValue) * 100));
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
  for (const day of step.days) {
    const value = Number(day.value) || 0;
    const height = Math.max(3, Math.round((value / maxValue) * 100));
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
  setText(craftingTopNote, result.mode === 'detail' ? 'Selected output' : 'Largest output share');
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

  const pies = Array.isArray(result.pies) ? result.pies : [];
  if (!pies.length) {
    renderProductionEmpty('No production data found');
    return;
  }

  setText(productionTotalValue, formatWholeNumber(result.total));
  setText(productionTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(productionTopValue, result.topProduct || '--');
  setText(productionTopNote, 'Largest output share');
  setText(productionCountValue, formatWholeNumber(result.productCount || 0));
  setText(productionCountNote, 'Produced outputs');
  setText(
    productionFilterNote,
    `${result.starbaseCount || pies.length} active ${(result.starbaseCount || pies.length) === 1 ? 'starbase' : 'starbases'} in last 14 days${
      result.sduStarbaseTagged === false ? ' · SDU starbase tag missing' : ''
    }`
  );

  productionChartGrid.textContent = '';
  for (const pie of pies) {
    productionChartGrid.appendChild(createCraftingPieCard(pie));
  }
}

async function refreshDailyProduction() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderProductionEmpty('Awaiting Influx connection');
    return;
  }

  renderProductionEmpty('Loading production data...');
  try {
    const result = await api.getDailyProduction(latestSettings || getFormPayload());
    renderProductionCharts(result);
  } catch (error) {
    console.error(error);
    renderProductionEmpty('Influx unavailable');
  }
}

async function refreshDailyCrafting() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderCraftingEmpty('Awaiting Influx connection');
    return;
  }

  renderCraftingEmpty('Loading crafting data...');
  try {
    const result = await api.getDailyCrafting({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: selectedCraftingStarbase,
      recipeFilter: selectedCraftingRecipe,
    });
    renderCraftingCharts(result);
  } catch (error) {
    console.error(error);
    renderCraftingEmpty('Influx unavailable');
  }
}

async function refreshDailyMining() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderMiningEmpty('Awaiting Influx connection');
    return;
  }

  renderMiningEmpty('Loading mining data...');
  try {
    const result = await api.getDailyMining({
      ...(latestSettings || getFormPayload()),
      fleetFilter: selectedMiningFleet,
    });
    renderMiningCharts(result);
  } catch (error) {
    console.error(error);
    renderMiningEmpty('Influx unavailable');
  }
}

async function refreshDailySdu() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderSduEmpty('Awaiting Influx connection');
    return;
  }

  renderSduEmpty('Loading SDU data...');
  try {
    const result = await api.getDailySdu({
      ...(latestSettings || getFormPayload()),
      fleetFilter: selectedScanningFleet,
    });
    renderSduChart(result);
  } catch (error) {
    console.error(error);
    renderSduEmpty('Influx unavailable');
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
  await Promise.all([
    refreshFleets(),
    hasInfluxSettings(latestSettings) ? refreshDailySdu() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshDailyMining() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshDailyCrafting() : Promise.resolve(),
    hasInfluxSettings(latestSettings) ? refreshDailyProduction() : Promise.resolve(),
  ]);
}

factionButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const faction = normalizeFaction(button.dataset.faction);
    if (latestSettings && normalizeFaction(latestSettings.faction) === faction) return;
    const nextSettings = mergeSettingsFromForm({ faction });
    latestSettings = nextSettings;
    updateFactionButtons(nextSettings);
    updateSettingsStatus(nextSettings);
    saveStatus.textContent = `Switching to ${faction}...`;
    try {
      const saved = await api.saveSettings(nextSettings);
      latestSettings = saved;
      setFormValues(saved);
      await refreshFactionScopedViews();
      saveStatus.textContent = `${faction} selected`;
      setTimeout(() => {
        if (saveStatus.textContent === `${faction} selected`) {
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
