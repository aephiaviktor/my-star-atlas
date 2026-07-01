const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { Connection, PublicKey } = require('@solana/web3.js');
const { BorshAccountsCoder } = require('@staratlas/anchor');
const bs58Module = require('bs58');
const { resolvePaths: resolveRpcLimiterPaths } = require('rpc_limiter');
const { readState: readRpcLimiterState } = require('rpc_limiter/dist/state');
const packageJson = require('../package.json');

const bs58 = bs58Module.default || bs58Module;

function sanitizeProfileName(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getProfileName() {
  const args = process.argv.slice(1);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--profile' || arg === '--instance') {
      return sanitizeProfileName(args[i + 1]);
    }
    if (arg.startsWith('--profile=')) {
      return sanitizeProfileName(arg.slice('--profile='.length));
    }
    if (arg.startsWith('--instance=')) {
      return sanitizeProfileName(arg.slice('--instance='.length));
    }
  }
  return 'USTUR';
}

const profileName = getProfileName();
const baseUserData = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'my-star-atlas');
const appIconPath = path.join(__dirname, 'assets', 'aephia-logo.png');

app.setPath('userData', path.join(baseUserData, 'profiles', profileName));
app.setName(`My Star Atlas - ${profileName}`);
if (typeof app.setDesktopName === 'function') {
  app.setDesktopName(`my-star-atlas-${profileName}.desktop`);
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const defaultSettings = Object.freeze({
  aephiaApiKey: '',
  playerProfile: '',
  playerProfiles: Object.freeze({
    MUD: '',
    ONI: '',
    USTUR: '',
  }),
  faction: 'USTUR',
  influxUrl: '',
  influxAuthToken: '',
  influxBucket: '',
  useRpcLimiter: false,
  rpcUrl: '',
  rpcRequestsPerSecond: '5',
});

let mainWindow = null;
const INFLUX_ORG = '67793e21353b170';
const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';
const SAGE_PROGRAM_ID = new PublicKey('SAGE2HAwep459SNq61LHvjxPk4pLPEJLoMETef7f7EE');
const SAGE_GAME_ID = new PublicKey('GAMEzqJehF8yAnKiTARUuhZMvLvkZVAsCVri5vSfemLr');
const SRSLY_PROGRAM_ID = new PublicKey('SRSLY1fq9TJqCk1gNSE7VZL2bztvTn9wm4VR8u8jMKT');
const DEFAULT_PUBLIC_KEY = PublicKey.default.toBase58();
const FLEET_ACCOUNT_DISCRIMINATOR = bs58.encode(BorshAccountsCoder.accountDiscriminator('fleet'));
const factionInfluxAliases = Object.freeze({
  MUD: {
    faction: ['MUD'],
    instance: ['MUD'],
  },
  ONI: {
    faction: ['ONI'],
    instance: ['ONI'],
  },
  USTUR: {
    faction: ['UST', 'USTUR'],
    instance: ['USTUR', 'USTUR2'],
  },
});

const fleetFieldOffsets = Object.freeze({
  gameId: 9,
  ownerProfile: 41,
  fleetShips: 73,
  subProfile: 105,
  faction: 169,
  fleetLabel: 170,
  shipCounts: 202,
  state: 439,
});

const srslyFieldOffsets = Object.freeze({
  contractCurrentRentalState: 99,
  rentalEndTime: 153,
  rentalCancelled: 161,
});

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function normalizeFaction(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'MUD' || normalized === 'ONI' || normalized === 'USTUR') {
    return normalized;
  }
  return 'USTUR';
}

function normalizePlayerProfiles(payload = {}, faction = 'USTUR') {
  const profiles = payload.playerProfiles && typeof payload.playerProfiles === 'object' ? payload.playerProfiles : {};
  const normalizedProfiles = {
    MUD: String(profiles.MUD ?? payload.mudPlayerProfile ?? ''),
    ONI: String(profiles.ONI ?? payload.oniPlayerProfile ?? ''),
    USTUR: String(profiles.USTUR ?? payload.usturPlayerProfile ?? ''),
  };
  const legacyProfile = String(payload.playerProfile ?? '').trim();
  if (legacyProfile && !normalizedProfiles[faction]) {
    normalizedProfiles[faction] = legacyProfile;
  }
  return normalizedProfiles;
}

function getSelectedPlayerProfile(settings) {
  const faction = normalizeFaction(settings.faction);
  return String(settings.playerProfiles?.[faction] || settings.playerProfile || '').trim();
}

function normalizeSettings(payload = {}) {
  const faction = normalizeFaction(payload.faction);
  const playerProfiles = normalizePlayerProfiles(payload, faction);
  return {
    ...defaultSettings,
    aephiaApiKey: String(payload.aephiaApiKey ?? ''),
    playerProfile: playerProfiles[faction],
    playerProfiles,
    faction,
    influxUrl: String(payload.influxUrl ?? ''),
    influxAuthToken: String(payload.influxAuthToken ?? ''),
    influxBucket: String(payload.influxBucket ?? ''),
    useRpcLimiter: Boolean(payload.useRpcLimiter),
    rpcUrl: String(payload.rpcUrl ?? ''),
    rpcRequestsPerSecond: String(payload.rpcRequestsPerSecond ?? defaultSettings.rpcRequestsPerSecond),
  };
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error('[MyStarAtlas] Failed to read settings:', error);
    }
    return normalizeSettings(defaultSettings);
  }
}

async function writeSettings(payload) {
  const settings = normalizeSettings(payload);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return settings;
}

function escapeFluxString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function makeFluxStringArray(values) {
  return `[${values.map((value) => `"${escapeFluxString(value)}"`).join(', ')}]`;
}

function getInfluxBaseUrl(rawUrl) {
  const cleanUrl = String(rawUrl || '').trim().split('?')[0].replace(/\/$/, '');
  const hostMatch = cleanUrl.match(/^(https?:\/\/[^/]+)/i);
  if (hostMatch) return hostMatch[1].replace(/\/$/, '');
  return cleanUrl.replace(/\/api\/v3\/write[^/]*$/i, '').replace(/\/orgs\/[^/]+$/i, '').replace(/\/$/, '');
}

function parseInfluxCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim().length);
  let header = null;
  const rows = [];
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const columns = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        columns.push(value);
        value = '';
      } else {
        value += char;
      }
    }
    columns.push(value);
    if (!header) {
      header = columns;
      continue;
    }
    const row = {};
    header.forEach((name, index) => {
      row[name] = columns[index] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

async function queryInfluxFlux(settings, flux) {
  const influxUrl = String(settings.influxUrl || '').trim();
  const token = String(settings.influxAuthToken || '').trim().replace(/^Token\s+/i, '').replace(/^Bearer\s+/i, '');
  const bucket = String(settings.influxBucket || '').trim();
  if (!influxUrl || !token || !bucket) {
    throw new Error('influx_not_configured');
  }

  const url = `${getInfluxBaseUrl(influxUrl)}/api/v2/query?org=${encodeURIComponent(INFLUX_ORG)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/csv',
      'Content-Type': 'application/vnd.flux',
      Authorization: `Token ${token}`,
    },
    body: flux,
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch (_error) {
      detail = '';
    }
    throw new Error(`influx_flux_${response.status}${detail ? `:${detail.slice(0, 300)}` : ''}`);
  }

  return response.text();
}

async function testInfluxConnection(payload) {
  const settings = normalizeSettings(payload);
  const bucket = escapeFluxString(settings.influxBucket);
  const flux = `import "influxdata/influxdb/schema"
schema.measurements(bucket: "${bucket}")`;
  const csv = await queryInfluxFlux(settings, flux);
  const rows = parseInfluxCsv(csv);
  const measurements = Array.from(new Set(rows.map((row) => row._value).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const expectedMeasurements = ['crafting', 'starbase', 'upgrade', 'sdu', 'mining', 'scanning'];
  const availableExpected = expectedMeasurements.filter((name) => measurements.includes(name));

  return {
    ok: true,
    bucket: settings.influxBucket,
    measurementCount: measurements.length,
    measurements: measurements.slice(0, 40),
    availableExpected,
    checkedAt: new Date().toISOString(),
  };
}

function buildInstanceScopeFilter(settings, options = {}) {
  const aliases = factionInfluxAliases[normalizeFaction(settings.faction)] || factionInfluxAliases.USTUR;
  const instanceValues = makeFluxStringArray(aliases.instance);
  const factionValues = makeFluxStringArray(aliases.faction);
  const bucket = String(settings.influxBucket || '').trim().toLowerCase();
  const allowUntaggedFallback = Boolean(options.allowUntaggedFallback) && normalizeFaction(settings.faction) === 'USTUR' && bucket === 'slya';
  const untaggedFleetNames = Array.isArray(options.untaggedFleetNames)
    ? options.untaggedFleetNames.map((fleet) => String(fleet || '').trim()).filter(Boolean)
    : [];
  const untaggedFallback = allowUntaggedFallback
    ? ' or (not exists r.instance and not exists r.faction)'
    : '';
  const untaggedFleetFallback = untaggedFleetNames.length
    ? ` or (not exists r.instance and not exists r.faction and exists r.fleet and contains(value: r.fleet, set: ${makeFluxStringArray(untaggedFleetNames)}))`
    : '';

  return `  |> filter(fn: (r) =>
    (exists r.instance and contains(value: r.instance, set: ${instanceValues})) or
    (exists r.faction and contains(value: r.faction, set: ${factionValues}))${untaggedFallback}${untaggedFleetFallback}
  )`;
}

function getInfluxScopeNote(settings) {
  const faction = normalizeFaction(settings.faction);
  const bucket = String(settings.influxBucket || '').trim().toLowerCase();
  return faction === 'USTUR' && bucket === 'slya' ? 'USTUR tagged + legacy untagged slya fallback' : `${faction} tagged data`;
}

async function measurementHasTag(settings, bucket, measurement, tagName) {
  const flux = `import "influxdata/influxdb/schema"
schema.measurementTagKeys(bucket: "${bucket}", measurement: "${escapeFluxString(measurement)}")`;
  const rows = parseInfluxCsv(await queryInfluxFlux(settings, flux));
  return rows.some((row) => row._value === tagName);
}

function getUtcDateKey(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function formatShortUtcDate(date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}/${day}`;
}

function getLastUtcDays(dayCount) {
  const today = new Date();
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: dayCount }, (_value, index) => {
    const offset = dayCount - 1 - index;
    return new Date(todayStart - offset * 24 * 60 * 60 * 1000);
  });
}

function createDayTemplates(dayCount = 14) {
  return getLastUtcDays(dayCount).map((date) => ({
    isoDate: getUtcDateKey(date),
    label: formatShortUtcDate(date),
    value: 0,
  }));
}

function normalizeFleetFilter(payload) {
  return String(payload?.fleetFilter || '').trim();
}

function normalizeStarbaseFilter(payload) {
  return String(payload?.starbaseFilter || '').trim();
}

function normalizeRecipeFilter(payload) {
  return String(payload?.recipeFilter || '').trim();
}

function addValueToDay(days, date, value) {
  const key = getUtcDateKey(date);
  const day = days.find((item) => item.isoDate === key);
  if (day) day.value += value;
}

function summarizeFleetOptions(fleetTotals) {
  return Array.from(fleetTotals.entries())
    .filter(([_fleet, total]) => total > 0)
    .map(([fleet, total]) => ({
      value: fleet,
      label: fleet,
      total,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function createOptionSummary(totals) {
  return Array.from(totals.entries())
    .filter(([_value, total]) => total > 0)
    .map(([value, total]) => ({
      value,
      label: value,
      total,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function fetchDailySdu(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings, { allowUntaggedFallback: true });
  const requestedFleet = normalizeFleetFilter(payload);

  async function queryDailySum(filterFlux) {
    const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
${scopeFilterFlux}
${filterFlux}
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["_time"])
  |> sum(column: "_value")
  |> group()
  |> sort(columns: ["_time"])`;
    const csv = await queryInfluxFlux(settings, flux);
    const rows = parseInfluxCsv(csv);
    const valuesByDay = new Map();

    for (const row of rows) {
      const date = new Date(row._time);
      const value = Number(row._value || 0);
      if (Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
      const key = getUtcDateKey(date);
      valuesByDay.set(key, (valuesByDay.get(key) || 0) + value);
    }

    const days = getLastUtcDays(14).map((date) => {
      const key = getUtcDateKey(date);
      return {
        isoDate: key,
        label: formatShortUtcDate(date),
        value: valuesByDay.get(key) || 0,
      };
    });

    return {
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
    };
  }

  const productionFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "sdu")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "_time", "_value"])
  |> sort(columns: ["fleet", "_time"])`;
  const productionRows = parseInfluxCsv(await queryInfluxFlux(settings, productionFlux));
  const productionDays = createDayTemplates();
  const fleetTotals = new Map();

  for (const row of productionRows) {
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    fleetTotals.set(fleet, (fleetTotals.get(fleet) || 0) + value);
    if (!requestedFleet || requestedFleet === fleet) {
      addValueToDay(productionDays, date, value);
    }
  }

  const fleets = summarizeFleetOptions(fleetTotals);
  const selectedFleet = fleets.some((fleet) => fleet.value === requestedFleet) ? requestedFleet : '';
  if (requestedFleet && !selectedFleet) {
    for (const day of productionDays) day.value = 0;
    for (const row of productionRows) {
      const date = new Date(row._time);
      const value = Number(row._value || 0);
      if (Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
      addValueToDay(productionDays, date, value);
    }
  }

  const production = {
    days: productionDays,
    total: productionDays.reduce((sum, day) => sum + day.value, 0),
  };
  const consumption = await queryDailySum(`  |> filter(fn: (r) => r._field == "amount")
  |> filter(fn: (r) =>
    (r._measurement == "crafting" and exists r.input and r.input == "Survey Data Unit") or
    (r._measurement == "upgrade" and exists r.input and r.input == "Survey Data Unit")
  )`);

  return {
    ok: true,
    field: 'amount',
    days: production.days,
    total: production.total,
    production,
    consumption,
    surplus: selectedFleet ? null : production.total - consumption.total,
    fleets,
    selectedFleet,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

function makeCraftingStepLabel(output, recipeInputs) {
  const inputs = Array.from(recipeInputs.get(output) || []).sort((a, b) => a.localeCompare(b));
  return inputs.length ? `${inputs.join(' + ')} -> ${output}` : output;
}

function getCraftingDependencyOutputs(targetRecipe, recipeInputs) {
  const selectedOutputs = new Set();
  const visit = (output) => {
    if (!output || selectedOutputs.has(output)) return;
    selectedOutputs.add(output);
    for (const input of recipeInputs.get(output) || []) {
      if (recipeInputs.has(input)) visit(input);
    }
  };
  visit(targetRecipe);
  return selectedOutputs;
}

async function fetchDailyCrafting(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const requestedStarbase = normalizeStarbaseFilter(payload);
  const requestedRecipe = normalizeRecipeFilter(payload);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "crafting")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.starbase)
  |> filter(fn: (r) => exists r.output)
  |> filter(fn: (r) => exists r.type)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "output", "input", "type", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "output", "input", "type", "_time", "_value"])
  |> sort(columns: ["starbase", "output", "input", "type", "_time"])`;
  const csv = await queryInfluxFlux(settings, flux);
  const rows = parseInfluxCsv(csv);
  const dayTemplates = createDayTemplates();
  const starbaseTotals = new Map();
  const recipeInputs = new Map();
  const outputEntries = [];

  for (const row of rows) {
    const starbase = String(row.starbase || '').trim();
    const output = String(row.output || '').trim();
    const input = String(row.input || '').trim();
    const type = String(row.type || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!starbase || !output || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const key = getUtcDateKey(date);
    if (!dayTemplates.some((day) => day.isoDate === key)) continue;

    if (type === 'Input' && input) {
      if (!recipeInputs.has(output)) recipeInputs.set(output, new Set());
      recipeInputs.get(output).add(input);
      continue;
    }

    if (type !== 'Output') continue;
    starbaseTotals.set(starbase, (starbaseTotals.get(starbase) || 0) + value);
    outputEntries.push({ starbase, output, date, value });
  }

  const starbases = createOptionSummary(starbaseTotals);
  const selectedStarbase = starbases.some((starbase) => starbase.value === requestedStarbase) ? requestedStarbase : '';
  const recipeTotals = new Map();
  for (const entry of outputEntries) {
    if (selectedStarbase && selectedStarbase !== entry.starbase) continue;
    recipeTotals.set(entry.output, (recipeTotals.get(entry.output) || 0) + entry.value);
  }
  const recipes = createOptionSummary(recipeTotals);
  const selectedRecipe = recipes.some((recipe) => recipe.value === requestedRecipe) ? requestedRecipe : '';
  const scopedOutputs = outputEntries.filter((entry) => !selectedStarbase || entry.starbase === selectedStarbase);

  if (!selectedRecipe) {
    const pieMap = new Map();
    for (const entry of scopedOutputs) {
      const starbase = selectedStarbase || entry.starbase;
      if (!pieMap.has(starbase)) pieMap.set(starbase, new Map());
      const slices = pieMap.get(starbase);
      slices.set(entry.output, (slices.get(entry.output) || 0) + entry.value);
    }

    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        return {
          starbase,
          total: slices.reduce((sum, slice) => sum + slice.total, 0),
          slices,
        };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((pie) => pie.slices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      total,
      topRecipe: topSlice?.label || null,
      outputCount: recipes.length,
      starbases,
      recipes,
      selectedStarbase,
      selectedRecipe: '',
      pies,
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const dependencyOutputs = getCraftingDependencyOutputs(selectedRecipe, recipeInputs);
  const stepMap = new Map();
  for (const entry of scopedOutputs) {
    if (!dependencyOutputs.has(entry.output)) continue;
    if (!stepMap.has(entry.output)) {
      stepMap.set(
        entry.output,
        dayTemplates.map((day) => ({ ...day }))
      );
    }
    addValueToDay(stepMap.get(entry.output), entry.date, entry.value);
  }

  const depths = new Map();
  const getDepth = (output) => {
    if (depths.has(output)) return depths.get(output);
    const inputs = Array.from(recipeInputs.get(output) || []).filter((input) => dependencyOutputs.has(input));
    const depth = inputs.length ? Math.max(...inputs.map(getDepth)) + 1 : 0;
    depths.set(output, depth);
    return depth;
  };

  const steps = Array.from(stepMap.entries())
    .map(([output, days]) => ({
      output,
      label: makeCraftingStepLabel(output, recipeInputs),
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
      depth: getDepth(output),
    }))
    .filter((step) => step.total > 0)
    .sort((a, b) => a.depth - b.depth || a.output.localeCompare(b.output));
  const finalStep = steps.find((step) => step.output === selectedRecipe) || null;

  return {
    ok: true,
    mode: 'detail',
    total: finalStep?.total || 0,
    topRecipe: selectedRecipe,
    outputCount: recipes.length,
    stepCount: steps.length,
    starbases,
    recipes,
    selectedStarbase,
    selectedRecipe,
    steps,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

async function fetchDailyMining(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const untaggedFleetNames = await getProfileFleetLabels(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings, { untaggedFleetNames });
  const requestedFleet = normalizeFleetFilter(payload);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "mining")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.rss)
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "rss", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "rss", "_time", "_value"])
  |> sort(columns: ["fleet", "rss", "_time"])`;
  const csv = await queryInfluxFlux(settings, flux);
  const rows = parseInfluxCsv(csv);
  const dayTemplates = createDayTemplates();
  const fleetTotals = new Map();
  const entries = [];

  for (const row of rows) {
    const fleet = String(row.fleet || '').trim();
    const resource = String(row.rss || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || !resource || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;

    const key = getUtcDateKey(date);
    if (!dayTemplates.some((day) => day.isoDate === key)) continue;
    fleetTotals.set(fleet, (fleetTotals.get(fleet) || 0) + value);
    entries.push({ fleet, resource, date, value });
  }

  const fleets = summarizeFleetOptions(fleetTotals);
  const selectedFleet = fleets.some((fleet) => fleet.value === requestedFleet) ? requestedFleet : '';
  const resourceMap = new Map();

  for (const entry of entries) {
    if (selectedFleet && selectedFleet !== entry.fleet) continue;
    const { resource, date, value } = entry;
    if (!resourceMap.has(resource)) {
      resourceMap.set(
        resource,
        dayTemplates.map((day) => ({ ...day }))
      );
    }
    const days = resourceMap.get(resource);
    addValueToDay(days, date, value);
  }

  const materials = Array.from(resourceMap.entries())
    .map(([resource, days]) => ({
      resource,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
    }))
    .sort((a, b) => b.total - a.total || a.resource.localeCompare(b.resource));
  const total = materials.reduce((sum, material) => sum + material.total, 0);

  return {
    ok: true,
    field: 'amount',
    materials,
    materialCount: materials.length,
    total,
    fleets,
    selectedFleet,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

function addProductionSlice(pieMap, starbase, label, value) {
  const cleanStarbase = String(starbase || '').trim();
  const cleanLabel = String(label || '').trim();
  const amount = Number(value || 0);
  if (!cleanStarbase || !cleanLabel || !Number.isFinite(amount) || amount <= 0) return;
  if (!pieMap.has(cleanStarbase)) pieMap.set(cleanStarbase, new Map());
  const slices = pieMap.get(cleanStarbase);
  slices.set(cleanLabel, (slices.get(cleanLabel) || 0) + amount);
}

async function fetchProductionRows(settings, bucket, measurement, tagColumn, extraFilterFlux = '', scopeOptions = {}) {
  const groupColumns = tagColumn === 'starbase' ? '"starbase"' : `"starbase", "${tagColumn}"`;
  const scopeFilterFlux = buildInstanceScopeFilter(settings, scopeOptions);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "${measurement}")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.starbase)
  |> filter(fn: (r) => exists r.${tagColumn})
${extraFilterFlux}
  |> group(columns: [${groupColumns}])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: [${groupColumns}, "_value"])
  |> sort(columns: [${groupColumns}])`;
  return parseInfluxCsv(await queryInfluxFlux(settings, flux));
}

async function fetchDailyProduction(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const pieMap = new Map();
  const canGroupSduByStarbase = await measurementHasTag(settings, bucket, 'sdu', 'starbase');
  const untaggedFleetNames = await getProfileFleetLabels(settings);

  const [sduRows, miningRows, craftingRows] = await Promise.all([
    canGroupSduByStarbase
      ? fetchProductionRows(settings, bucket, 'sdu', 'starbase', '', { allowUntaggedFallback: true })
      : [],
    fetchProductionRows(settings, bucket, 'mining', 'rss', '', { untaggedFleetNames }),
    fetchProductionRows(settings, bucket, 'crafting', 'output', '  |> filter(fn: (r) => (exists r.type) and r.type == "Output")'),
  ]);

  for (const row of sduRows) {
    addProductionSlice(pieMap, row.starbase, 'Survey Data Unit', row._value);
  }
  for (const row of miningRows) {
    addProductionSlice(pieMap, row.starbase, row.rss, row._value);
  }
  for (const row of craftingRows) {
    addProductionSlice(pieMap, row.starbase, row.output, row._value);
  }

  const pies = Array.from(pieMap.entries())
    .map(([starbase, sliceMap]) => {
      const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
      return {
        starbase,
        total: slices.reduce((sum, slice) => sum + slice.total, 0),
        slices,
      };
    })
    .filter((pie) => pie.total > 0)
    .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
  const allSlices = pies.flatMap((pie) => pie.slices);
  const productTotals = new Map();
  for (const slice of allSlices) {
    productTotals.set(slice.label, (productTotals.get(slice.label) || 0) + slice.total);
  }
  const products = createOptionSummary(productTotals).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  return {
    ok: true,
    total: pies.reduce((sum, pie) => sum + pie.total, 0),
    topProduct: products[0]?.label || null,
    productCount: products.length,
    starbaseCount: pies.length,
    sduStarbaseTagged: canGroupSduByStarbase,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    pies,
    checkedAt: new Date().toISOString(),
  };
}

function buildSharedRpcUrl(rpcBaseUrl, apiKey) {
  const base = String(rpcBaseUrl || '').trim();
  const key = String(apiKey || '').trim();
  if (!base) return '';
  if (!key) return base;
  try {
    const url = new URL(base);
    url.searchParams.set('api-key', key);
    return url.toString();
  } catch (_error) {
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}api-key=${encodeURIComponent(key)}`;
  }
}

function getRpcUrl(settings) {
  if (settings && settings.useRpcLimiter) {
    try {
      const paths = resolveRpcLimiterPaths();
      const state = readRpcLimiterState(paths.stateFile, Date.now());
      const shared = buildSharedRpcUrl(state.rpcBaseUrl, state.apiKey);
      if (shared) return shared;
    } catch (_error) {
      // fall through to the configured rpcUrl
    }
  }
  return String(settings?.rpcUrl || '').trim() || DEFAULT_RPC_URL;
}

function readPublicKey(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function readFleetLabel(data) {
  return data
    .subarray(fleetFieldOffsets.fleetLabel, fleetFieldOffsets.fleetLabel + 32)
    .filter((value) => value !== 0)
    .toString('utf8')
    .trim();
}

function deriveRentalContract(fleetAccount) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rental_contract'), fleetAccount.toBuffer()],
    SRSLY_PROGRAM_ID
  )[0];
}

function formatShortDate(date) {
  if (!date) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

async function readRentalEndDate(connection, fleetKey) {
  const contract = deriveRentalContract(new PublicKey(fleetKey));
  const contractInfo = await connection.getAccountInfo(contract, 'confirmed');
  if (!contractInfo) return null;

  const currentRentalState = readPublicKey(contractInfo.data, srslyFieldOffsets.contractCurrentRentalState);
  if (currentRentalState === DEFAULT_PUBLIC_KEY) return null;

  const rentalInfo = await connection.getAccountInfo(new PublicKey(currentRentalState), 'confirmed');
  if (!rentalInfo || rentalInfo.data[srslyFieldOffsets.rentalCancelled]) return null;

  const endTimeSeconds = Number(rentalInfo.data.readBigInt64LE(srslyFieldOffsets.rentalEndTime));
  if (!Number.isFinite(endTimeSeconds) || endTimeSeconds <= 0) return null;
  return new Date(endTimeSeconds * 1000);
}

function inferFleetActivity(data, label, relationship) {
  const state = data[fleetFieldOffsets.state];
  if (state === 2) return 'Mining';
  if (state === 3 || state === 4) return 'In transit';
  if (state === 5) return 'Respawn';
  if (state === 6) return 'Upgrading';

  const normalizedLabel = String(label || '').trim().toUpperCase();
  if (normalizedLabel.startsWith('SF')) return 'Scanning';
  if (normalizedLabel.startsWith('MF')) return 'Mining';
  if (normalizedLabel.startsWith('CF') || normalizedLabel.startsWith('UF') || relationship === 'managed') return 'Transport';
  if (state === 0) return 'Docked';
  if (state === 1) return 'Idle';
  return 'Unknown';
}

function decodeFleetAccount(account) {
  const data = account.account.data;
  const totalShips = data.readUInt32LE(fleetFieldOffsets.shipCounts);
  const label = readFleetLabel(data);
  const ownerProfile = readPublicKey(data, fleetFieldOffsets.ownerProfile);
  const subProfile = readPublicKey(data, fleetFieldOffsets.subProfile);

  return {
    key: account.pubkey.toBase58(),
    label: label || account.pubkey.toBase58().slice(0, 8),
    relationship: 'owned',
    ownership: 'Owned',
    activity: inferFleetActivity(data, label, 'owned'),
    faction: data[fleetFieldOffsets.faction],
    totalShips,
    ownerProfile,
    subProfile,
    fleetShips: readPublicKey(data, fleetFieldOffsets.fleetShips),
  };
}

async function fetchProfileFleets(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const profile = getSelectedPlayerProfile(settings);
  if (!profile) {
    throw new Error('player_profile_required');
  }

  let ownerProfile;
  try {
    ownerProfile = new PublicKey(profile);
  } catch (_error) {
    throw new Error('invalid_player_profile');
  }

  const connection = new Connection(getRpcUrl(settings), {
    commitment: 'confirmed',
    disableRetryOnRateLimit: false,
  });

  const baseFilters = [
    {
      memcmp: {
        offset: 0,
        bytes: FLEET_ACCOUNT_DISCRIMINATOR,
      },
    },
    {
      memcmp: {
        offset: fleetFieldOffsets.gameId,
        bytes: SAGE_GAME_ID.toBase58(),
      },
    },
  ];

  const [ownedAccounts, managedAccounts] = await Promise.all([
    connection.getProgramAccounts(SAGE_PROGRAM_ID, {
      commitment: 'confirmed',
      filters: [
        ...baseFilters,
        {
          memcmp: {
            offset: fleetFieldOffsets.ownerProfile,
            bytes: ownerProfile.toBase58(),
          },
        },
      ],
    }),
    connection.getProgramAccounts(SAGE_PROGRAM_ID, {
      commitment: 'confirmed',
      filters: [
        ...baseFilters,
        {
          memcmp: {
            offset: fleetFieldOffsets.subProfile,
            bytes: ownerProfile.toBase58(),
          },
        },
      ],
    }),
  ]);

  const fleetMap = new Map();
  for (const account of ownedAccounts) {
    fleetMap.set(account.pubkey.toBase58(), decodeFleetAccount(account));
  }
  for (const account of managedAccounts) {
    const decoded = decodeFleetAccount(account);
    const existing = fleetMap.get(decoded.key);
    const relationship = existing ? 'owned-managed' : 'managed';
    fleetMap.set(decoded.key, {
      ...decoded,
      ...existing,
      relationship,
      ownership: existing ? 'Owned + managed' : 'Rented',
      activity: inferFleetActivity(account.account.data, decoded.label, relationship),
    });
  }

  const fleets = Array.from(fleetMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  await Promise.all(
    fleets
      .filter((fleet) => fleet.relationship === 'managed' || fleet.relationship === 'owned-managed')
      .map(async (fleet) => {
        const rentalEnd = await readRentalEndDate(connection, fleet.key);
        const rentalEndLabel = formatShortDate(rentalEnd);
        fleet.rentalEndsAt = rentalEnd ? rentalEnd.toISOString() : null;
        fleet.ownership = rentalEndLabel ? `Rented until ${rentalEndLabel}` : 'Rented';
      })
  );

  return {
    ok: true,
    fleets,
    fleetCount: fleets.length,
    ownedFleetCount: ownedAccounts.length,
    managedFleetCount: managedAccounts.length,
    checkedAt: new Date().toISOString(),
  };
}

const FLEET_LABELS_CACHE_TTL_MS = 5 * 60 * 1000;
const FLEET_LABELS_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const fleetLabelsCache = new Map();
let fleetLabelsCacheLoaded = false;

function fleetLabelsCachePath() {
  return path.join(app.getPath('userData'), 'fleet-labels-cache.json');
}

async function loadFleetLabelsCache() {
  try {
    const raw = await fs.readFile(fleetLabelsCachePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [profile, entry] of Object.entries(parsed)) {
        if (entry && Array.isArray(entry.labels)) {
          fleetLabelsCache.set(profile, {
            labels: entry.labels.map((label) => String(label || '')).filter(Boolean),
            fetchedAt: Number(entry.fetchedAt) || 0,
          });
        }
      }
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      console.error('[MyStarAtlas] Failed to load fleet labels cache:', error);
    }
  }
  fleetLabelsCacheLoaded = true;
}

async function saveFleetLabelsCache() {
  const obj = {};
  for (const [profile, entry] of fleetLabelsCache.entries()) {
    obj[profile] = { labels: entry.labels, fetchedAt: entry.fetchedAt };
  }
  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(fleetLabelsCachePath(), `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('[MyStarAtlas] Failed to save fleet labels cache:', error);
  }
}

async function getProfileFleetLabels(settings) {
  const profile = getSelectedPlayerProfile(settings);
  if (!profile) return [];
  const cached = fleetLabelsCache.get(profile);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < FLEET_LABELS_CACHE_TTL_MS) {
    return cached.labels;
  }
  try {
    const result = await fetchProfileFleets(settings);
    const labels = Array.from(
      new Set(
        (result.fleets || [])
          .map((fleet) => String(fleet.label || '').trim())
          .filter(Boolean)
      )
    );
    fleetLabelsCache.set(profile, { labels, fetchedAt: now });
    saveFleetLabelsCache().catch(() => {});
    return labels;
  } catch (error) {
    console.error('[MyStarAtlas] Failed to load profile fleet labels for Influx fallback:', error);
    if (cached && now - cached.fetchedAt < FLEET_LABELS_STALE_TTL_MS) {
      return cached.labels;
    }
    return [];
  }
}

async function prewarmFleetLabelsCache() {
  await loadFleetLabelsCache();
  let settings;
  try {
    settings = await readSettings();
  } catch (error) {
    return;
  }
  const profiles = settings?.playerProfiles && typeof settings.playerProfiles === 'object'
    ? settings.playerProfiles
    : {};
  const queue = [];
  for (const profile of Object.values(profiles)) {
    const key = String(profile || '').trim();
    if (!key || fleetLabelsCache.has(key)) continue;
    queue.push(key);
  }
  for (const key of queue) {
    try {
      await getProfileFleetLabels({
        ...settings,
        faction: '',
        playerProfile: key,
        playerProfiles: { ...(settings.playerProfiles || {}), USTUR: key },
      });
    } catch (error) {
      // best effort
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: `My Star Atlas - ${profileName}`,
    icon: appIconPath,
    backgroundColor: '#101316',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

ipcMain.handle('app:get-profile-name', () => profileName);
ipcMain.handle('app:get-version', () => packageJson.version);
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:save', (_event, payload) => writeSettings(payload));
ipcMain.handle('fleet:list', async (_event, payload) => {
  try {
    return await fetchProfileFleets(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'fleet_list_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
ipcMain.handle('influx:test', async (_event, payload) => {
  try {
    return await testInfluxConnection(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'influx_test_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
ipcMain.handle('sdu:daily', async (_event, payload) => {
  try {
    return await fetchDailySdu(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'sdu_daily_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
ipcMain.handle('mining:daily', async (_event, payload) => {
  try {
    return await fetchDailyMining(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'mining_daily_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
ipcMain.handle('crafting:daily', async (_event, payload) => {
  try {
    return await fetchDailyCrafting(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'crafting_daily_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
ipcMain.handle('production:daily', async (_event, payload) => {
  try {
    return await fetchDailyProduction(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'production_daily_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});

app.whenReady().then(async () => {
  prewarmFleetLabelsCache().catch((error) => {
    console.error('[MyStarAtlas] Fleet labels prewarm failed:', error);
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
