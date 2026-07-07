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
  const faction = normalizeFaction(settings.faction);
  const aliases = factionInfluxAliases[faction] || factionInfluxAliases.USTUR;
  const instanceValues = makeFluxStringArray(aliases.instance);
  const factionValues = makeFluxStringArray(aliases.faction);
  const bucket = String(settings.influxBucket || '').trim().toLowerCase();
  const isUsturSlya = faction === 'USTUR' && bucket === 'slya';
  const allowBroadUntaggedFallback = Boolean(options.allowUntaggedFallback) && isUsturSlya;
  const untaggedFleetNames = Array.isArray(options.untaggedFleetNames)
    ? options.untaggedFleetNames.map((fleet) => String(fleet || '').trim()).filter(Boolean)
    : [];
  const fleetSet = makeFluxStringArray(untaggedFleetNames);
  // For MUD/ONI, the fleet list is used as a positive filter on tagged data too,
  // so a fleet rented by MUD but tagged by the MUD bot does not show up in MUD
  // views when the ONI player actually owns it. USTUR keeps the broad tagged
  // path because the broad untagged fallback covers legacy rows.
  const taggedFleetFilter = (!isUsturSlya && untaggedFleetNames.length)
    ? ` and (not exists r.fleet or contains(value: r.fleet, set: ${fleetSet}))`
    : '';
  const untaggedFleetFallback = untaggedFleetNames.length
    ? ` or (not exists r.instance and not exists r.faction and exists r.fleet and contains(value: r.fleet, set: ${fleetSet}))`
    : '';
  const untaggedBroadFallback = allowBroadUntaggedFallback
    ? ' or (not exists r.instance and not exists r.faction)'
    : '';

  return `  |> filter(fn: (r) =>
    ((exists r.instance and contains(value: r.instance, set: ${instanceValues})) or
     (exists r.faction and contains(value: r.faction, set: ${factionValues})))${taggedFleetFilter}${untaggedFleetFallback}${untaggedBroadFallback}
  )`;
}

function getInfluxScopeNote(settings) {
  const faction = normalizeFaction(settings.faction);
  const bucket = String(settings.influxBucket || '').trim().toLowerCase();
  if (faction === 'USTUR' && bucket === 'slya') {
    return 'USTUR tagged + legacy untagged slya fallback';
  }
  return `${faction} tagged + ${faction.toLowerCase()} fleet fallback`;
}

async function measurementHasTag(settings, bucket, measurement, tagName) {
  const flux = `import "influxdata/influxdb/schema"
schema.measurementTagKeys(bucket: "${bucket}", measurement: "${escapeFluxString(measurement)}")`;
  const rows = parseInfluxCsv(await queryInfluxFlux(settings, flux));
  return rows.some((row) => row._value === tagName);
}

async function fetchFactionStarbases(settings) {
  try {
    const bucket = escapeFluxString(settings.influxBucket);
    const hasFactionTag = await measurementHasTag(settings, bucket, 'starbase', 'faction');
    if (!hasFactionTag) return null;
    const aliases = factionInfluxAliases[normalizeFaction(settings.faction)] || factionInfluxAliases.USTUR;
    const factionValues = makeFluxStringArray(aliases.faction);
    const flux = `from(bucket: "${bucket}")
  |> range(start: -7d)
  |> filter(fn: (r) => r._measurement == "starbase")
  |> filter(fn: (r) => exists r.starbase)
  |> filter(fn: (r) => exists r.faction and contains(value: r.faction, set: ${factionValues}))
  |> group(columns: ["starbase"])
  |> last()
  |> group()
  |> keep(columns: ["starbase"])`;
    const rows = parseInfluxCsv(await queryInfluxFlux(settings, flux));
    const set = new Set();
    for (const row of rows) {
      const starbase = String(row.starbase || '').trim();
      if (starbase) set.add(starbase);
    }
    return set.size > 0 ? set : null;
  } catch (_error) {
    return null;
  }
}

// ONI starbases that should be excluded when viewing MUD faction data
const ONI_STARBASE_EXCLUSIONS = Object.freeze([
  'MRZ-13', 'MRZ-14', 'MRZ-18', 'MRZ-19', 'MRZ-20',
  'MRZ-24', 'MRZ-25', 'MRZ-26', 'MRZ-29', 'MRZ-30', 'MRZ-31', 'MRZ-36',
  'ONI-1', 'ONI-2', 'ONI-3', 'ONI-4', 'ONI-5',
  'ONI-PHANTOM'
]);

const STARBASE_COORDINATE_CACHE_TTL_MS = 60 * 60 * 1000;
const starbaseCoordinateCache = {
  bucket: '',
  fetchedAt: 0,
  map: new Map(),
  pending: null,
};

function starbaseCoordinateKey(x, y) {
  if (x === null || x === undefined || y === null || y === undefined) return '';
  return `${x},${y}`;
}

async function fetchStarbaseCoordinateMap(settings) {
  const bucket = escapeFluxString(settings.influxBucket);
  const now = Date.now();
  if (starbaseCoordinateCache.bucket === bucket
      && starbaseCoordinateCache.map.size > 0
      && now - starbaseCoordinateCache.fetchedAt < STARBASE_COORDINATE_CACHE_TTL_MS) {
    return starbaseCoordinateCache.map;
  }
  if (starbaseCoordinateCache.pending && starbaseCoordinateCache.bucket === bucket) {
    return starbaseCoordinateCache.pending;
  }
  starbaseCoordinateCache.bucket = bucket;
  const promise = (async () => {
    const map = new Map();
    try {
      const flux = `from(bucket: "${bucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "starbase")
  |> filter(fn: (r) => exists r.starbase)
  |> filter(fn: (r) => exists r.sectorX and exists r.sectorY)
  |> group(columns: ["starbase", "sectorX", "sectorY"])
  |> last()
  |> group()
  |> keep(columns: ["starbase", "sectorX", "sectorY"])`;
      const rows = parseInfluxCsv(await queryInfluxFlux(settings, flux));
      for (const row of rows) {
        const name = String(row.starbase || '').trim();
        const x = String(row.sectorX || '').trim();
        const y = String(row.sectorY || '').trim();
        if (!name || !x || !y) continue;
        const key = starbaseCoordinateKey(x, y);
        if (!map.has(key)) map.set(key, name);
      }
    } catch (error) {
      console.error('[MyStarAtlas] Failed to build starbase coordinate map:', error);
    }
    starbaseCoordinateCache.map = map;
    starbaseCoordinateCache.fetchedAt = Date.now();
    starbaseCoordinateCache.pending = null;
    return map;
  })();
  starbaseCoordinateCache.pending = promise;
  return promise;
}

const STARBASE_COORDINATE_REGEX = /^-?\d+,-?\d+$/;

function resolveStarbaseName(row, coordinateMap) {
  const direct = String(row.starbase || '').trim();
  if (direct) {
    // Some measurements (e.g. movement/cargo) write a literal "x,y" string into
    // r.starbase when the bot doesn't know the starbase name. Look that up in
    // the coordinate map. Sdu rows are deliberately NOT resolved via
    // r.sectorX/Y because those are scanning coordinates, not starbase
    // coordinates.
    if (STARBASE_COORDINATE_REGEX.test(direct) && coordinateMap) {
      const [x, y] = direct.split(',');
      const mapped = String(coordinateMap.get(starbaseCoordinateKey(x, y)) || '').trim();
      if (mapped) return mapped;
    }
    return direct;
  }
  return '';
}

function isStarbaseIncluded(entryStarbase, factionStarbases, faction) {
  // When no faction tag exists, apply ONI exclusion for MUD
  if (!factionStarbases) {
    if (faction === 'MUD' && ONI_STARBASE_EXCLUSIONS.includes(entryStarbase)) {
      return false;
    }
    return true;
  }
  return factionStarbases.has(entryStarbase);
}

function filterStarbasesByFaction(starbases, factionStarbases, faction) {
  if (!factionStarbases) {
    // When no faction tag exists, filter by faction context
    if (faction === 'MUD') {
      return starbases.filter((s) => !ONI_STARBASE_EXCLUSIONS.includes(s.value));
    }
    return starbases;
  }
  return starbases.filter((s) => factionStarbases.has(s.value));
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

function normalizeComponentFilter(payload) {
  return String(payload?.componentFilter || '').trim();
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
  const untaggedFleetNames = await getProfileFleetLabels(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings, { allowUntaggedFallback: true, untaggedFleetNames });
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
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
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
    const starbase = resolveStarbaseName(row, coordinateMap);
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

  const factionStarbases = await fetchFactionStarbases(settings);
  let starbases = createOptionSummary(starbaseTotals);
  starbases = filterStarbasesByFaction(starbases, factionStarbases, normalizeFaction(settings.faction));
  const selectedStarbase = starbases.some((starbase) => starbase.value === requestedStarbase) ? requestedStarbase : '';
  const recipeTotals = new Map();
  for (const entry of outputEntries) {
    if (selectedStarbase && selectedStarbase !== entry.starbase) continue;
    recipeTotals.set(entry.output, (recipeTotals.get(entry.output) || 0) + entry.value);
  }
  const recipes = createOptionSummary(recipeTotals);
  const selectedRecipe = recipes.some((recipe) => recipe.value === requestedRecipe) ? requestedRecipe : '';
  const scopedOutputs = outputEntries.filter((entry) => !selectedStarbase || entry.starbase === selectedStarbase);

  if (!selectedStarbase && !selectedRecipe) {
    const pieMap = new Map();
    const faction = normalizeFaction(settings.faction);
    for (const entry of scopedOutputs) {
      if (!isStarbaseIncluded(entry.starbase, factionStarbases, faction)) continue;
      const starbase = entry.starbase;
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
      selectedStarbase: '',
      selectedRecipe: '',
      pies,
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  // Detail mode: bar charts per output (starbase-only or recipe-selected)
  const dependencyOutputs = selectedRecipe
    ? getCraftingDependencyOutputs(selectedRecipe, recipeInputs)
    : null;
  const stepMap = new Map();
  for (const entry of scopedOutputs) {
    if (dependencyOutputs && !dependencyOutputs.has(entry.output)) continue;
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
    const inputs = Array.from(recipeInputs.get(output) || []).filter((input) => dependencyOutputs && dependencyOutputs.has(input));
    const depth = inputs.length ? Math.max(...inputs.map(getDepth)) + 1 : 0;
    depths.set(output, depth);
    return depth;
  };

  const steps = Array.from(stepMap.entries())
    .map(([output, days]) => ({
      output,
      label: selectedRecipe ? makeCraftingStepLabel(output, recipeInputs) : output,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
      depth: selectedRecipe ? getDepth(output) : 0,
    }))
    .filter((step) => step.total > 0)
    .sort((a, b) => a.depth - b.depth || a.output.localeCompare(b.output));
  const finalStep = selectedRecipe ? (steps.find((step) => step.output === selectedRecipe) || null) : null;

  return {
    ok: true,
    mode: 'detail',
    total: selectedRecipe ? (finalStep?.total || 0) : steps.reduce((sum, s) => sum + s.total, 0),
    topRecipe: selectedRecipe || steps.slice().sort((a, b) => b.total - a.total)[0]?.output || null,
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
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings, { untaggedFleetNames });
  const requestedFleet = normalizeFleetFilter(payload);
  const requestedStarbase = normalizeStarbaseFilter(payload);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "mining")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.rss)
  |> filter(fn: (r) => exists r.fleet)
  |> filter(fn: (r) => exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "rss", "starbase", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "rss", "starbase", "_time", "_value"])
  |> sort(columns: ["fleet", "rss", "starbase", "_time"])`;
  const csv = await queryInfluxFlux(settings, flux);
  const rows = parseInfluxCsv(csv);
  const dayTemplates = createDayTemplates();
  const fleetTotals = new Map();
  const starbaseTotals = new Map();
  const entries = [];

  for (const row of rows) {
    const fleet = String(row.fleet || '').trim();
    const resource = String(row.rss || '').trim();
    const starbase = resolveStarbaseName(row, coordinateMap);
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || !resource || !starbase || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;

    const key = getUtcDateKey(date);
    if (!dayTemplates.some((day) => day.isoDate === key)) continue;
    fleetTotals.set(fleet, (fleetTotals.get(fleet) || 0) + value);
    starbaseTotals.set(starbase, (starbaseTotals.get(starbase) || 0) + value);
    entries.push({ fleet, resource, starbase, date, value });
  }

  const factionStarbases = await fetchFactionStarbases(settings);
  let starbases = createOptionSummary(starbaseTotals);
  starbases = filterStarbasesByFaction(starbases, factionStarbases, normalizeFaction(settings.faction));
  const selectedStarbase = starbases.some((s) => s.value === requestedStarbase) ? requestedStarbase : '';

  const fleetTotalsScoped = new Map();
  for (const entry of entries) {
    if (selectedStarbase && entry.starbase !== selectedStarbase) continue;
    fleetTotalsScoped.set(entry.fleet, (fleetTotalsScoped.get(entry.fleet) || 0) + entry.value);
  }
  const fleets = summarizeFleetOptions(fleetTotalsScoped);
  const selectedFleet = fleets.some((f) => f.value === requestedFleet) ? requestedFleet : '';

  const isDetail = Boolean(selectedStarbase || selectedFleet);

  if (!isDetail) {
    const pieMap = new Map();
    const faction = normalizeFaction(settings.faction);
    for (const entry of entries) {
      if (!isStarbaseIncluded(entry.starbase, factionStarbases, faction)) continue;
      if (!pieMap.has(entry.starbase)) pieMap.set(entry.starbase, new Map());
      const slices = pieMap.get(entry.starbase);
      slices.set(entry.resource, (slices.get(entry.resource) || 0) + entry.value);
    }

    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        return { starbase, total: slices.reduce((sum, s) => sum + s.total, 0), slices };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      field: 'amount',
      total,
      topMaterial: topSlice?.label || null,
      materialCount: new Set(pies.flatMap((p) => p.slices.map((s) => s.label))).size,
      starbases,
      fleets,
      selectedStarbase: '',
      selectedFleet: '',
      pies,
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const scopedEntries = entries.filter((entry) => {
    if (selectedStarbase && entry.starbase !== selectedStarbase) return false;
    if (selectedFleet && entry.fleet !== selectedFleet) return false;
    return true;
  });

  const resourceMap = new Map();
  for (const entry of scopedEntries) {
    if (!resourceMap.has(entry.resource)) {
      resourceMap.set(entry.resource, dayTemplates.map((day) => ({ ...day })));
    }
    addValueToDay(resourceMap.get(entry.resource), entry.date, entry.value);
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
    mode: 'detail',
    field: 'amount',
    materials,
    materialCount: materials.length,
    total,
    topMaterial: materials[0]?.resource || null,
    starbases,
    fleets,
    selectedStarbase,
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

async function fetchProductionDailyRows(settings, bucket, measurement, tagColumn, starbase, extraFilterFlux = '', scopeOptions = {}) {
  const scopeFilterFlux = buildInstanceScopeFilter(settings, scopeOptions);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "${measurement}")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => r.starbase == "${escapeFluxString(starbase)}")
  |> filter(fn: (r) => exists r.${tagColumn})
${extraFilterFlux}
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["${tagColumn}", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["${tagColumn}", "_time", "_value"])
  |> sort(columns: ["${tagColumn}", "_time"])`;
  return parseInfluxCsv(await queryInfluxFlux(settings, flux));
}

async function fetchSduProductionRowsByFleet(settings, bucket, scopeOptions = {}) {
  const scopeFilterFlux = buildInstanceScopeFilter(settings, scopeOptions);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "sdu")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> group(columns: ["fleet"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "_value"])
  |> sort(columns: ["fleet"])`;
  return parseInfluxCsv(await queryInfluxFlux(settings, flux));
}

async function fetchSduProductionDailyByFleet(settings, bucket, fleet, scopeOptions = {}) {
  const scopeFilterFlux = buildInstanceScopeFilter(settings, scopeOptions);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "sdu")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => r.fleet == "${escapeFluxString(fleet)}")
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["_time", "_value"])
  |> sort(columns: ["_time"])`;
  return parseInfluxCsv(await queryInfluxFlux(settings, flux));
}

async function fetchSduProductionDailyAll(settings, bucket, scopeOptions = {}) {
  const scopeFilterFlux = buildInstanceScopeFilter(settings, scopeOptions);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "sdu")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["_time", "_value"])
  |> sort(columns: ["_time"])`;
  return parseInfluxCsv(await queryInfluxFlux(settings, flux));
}

async function fetchDailyProduction(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const canGroupSduByStarbase = await measurementHasTag(settings, bucket, 'sdu', 'starbase');
  const untaggedFleetNames = await getProfileFleetLabels(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const requestedStarbase = normalizeStarbaseFilter(payload);
  const scopeOptions = { allowUntaggedFallback: true, untaggedFleetNames };
  // SLYA does not yet write a `r.starbase` tag on the `sdu` measurement, so SDU
  // cannot be attributed to a starbase. Until that lands, SDU is excluded from
  // the per-starbase views and from the starbase filter dropdown entirely.
  const includeSdu = canGroupSduByStarbase;

  const [sduRows, miningRows, craftingRows] = await Promise.all([
    includeSdu
      ? fetchProductionRows(settings, bucket, 'sdu', 'starbase', '', { allowUntaggedFallback: true })
      : Promise.resolve([]),
    fetchProductionRows(settings, bucket, 'mining', 'rss', '', { untaggedFleetNames }),
    fetchProductionRows(settings, bucket, 'crafting', 'output', '  |> filter(fn: (r) => (exists r.type) and r.type == "Output")'),
  ]);

  const pieMap = new Map();
  for (const row of sduRows) {
    addProductionSlice(pieMap, resolveStarbaseName(row, coordinateMap), 'Survey Data Unit', row._value);
  }
  for (const row of miningRows) {
    addProductionSlice(pieMap, resolveStarbaseName(row, coordinateMap), row.rss, row._value);
  }
  for (const row of craftingRows) {
    addProductionSlice(pieMap, resolveStarbaseName(row, coordinateMap), row.output, row._value);
  }

  const factionStarbases = await fetchFactionStarbases(settings);
  let allPies = Array.from(pieMap.entries())
    .map(([starbase, sliceMap]) => {
      const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
      return {
        starbase,
        total: slices.reduce((sum, slice) => sum + slice.total, 0),
        slices,
      };
    })
    .filter((pie) => pie.total > 0);
  if (factionStarbases) {
    allPies = allPies.filter((pie) => factionStarbases.has(pie.starbase));
  } else if (normalizeFaction(settings.faction) === 'MUD') {
    // When no faction tag exists but viewing MUD, exclude ONI starbases
    allPies = allPies.filter((pie) => !ONI_STARBASE_EXCLUSIONS.includes(pie.starbase));
  }
  allPies.sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));

  const starbases = allPies.map((pie) => ({ value: pie.starbase, label: pie.starbase, total: pie.total }));
  const selectedStarbase = starbases.some((s) => s.value === requestedStarbase) ? requestedStarbase : '';

  const allSlices = allPies.flatMap((pie) => pie.slices);
  const productTotals = new Map();
  for (const slice of allSlices) {
    productTotals.set(slice.label, (productTotals.get(slice.label) || 0) + slice.total);
  }
  const products = createOptionSummary(productTotals).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  if (!selectedStarbase) {
    return {
      ok: true,
      mode: 'overview',
      total: allPies.reduce((sum, pie) => sum + pie.total, 0),
      topProduct: products[0]?.label || null,
      productCount: products.length,
      starbaseCount: allPies.length,
      starbases,
      selectedStarbase: '',
      sduStarbaseTagged: canGroupSduByStarbase,
      pies: allPies,
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const scopedPie = allPies.find((pie) => pie.starbase === selectedStarbase) || null;
  const dayTemplates = createDayTemplates();
  const assetMap = new Map();

  const [sduDailyRows, miningDailyRows, craftingDailyRows] = await Promise.all([
    includeSdu
      ? fetchProductionDailyRows(settings, bucket, 'sdu', 'starbase', selectedStarbase, '', scopeOptions)
      : Promise.resolve([]),
    fetchProductionDailyRows(settings, bucket, 'mining', 'rss', selectedStarbase, '', scopeOptions),
    fetchProductionDailyRows(settings, bucket, 'crafting', 'output', selectedStarbase, '  |> filter(fn: (r) => (exists r.type) and r.type == "Output")'),
  ]);

  for (const row of sduDailyRows) {
    const label = 'Survey Data Unit';
    if (!assetMap.has(label)) assetMap.set(label, dayTemplates.map((d) => ({ ...d })));
    addValueToDay(assetMap.get(label), new Date(row._time), Number(row._value || 0));
  }
  for (const row of miningDailyRows) {
    const label = row.rss;
    if (!assetMap.has(label)) assetMap.set(label, dayTemplates.map((d) => ({ ...d })));
    addValueToDay(assetMap.get(label), new Date(row._time), Number(row._value || 0));
  }
  for (const row of craftingDailyRows) {
    const label = row.output;
    if (!assetMap.has(label)) assetMap.set(label, dayTemplates.map((d) => ({ ...d })));
    addValueToDay(assetMap.get(label), new Date(row._time), Number(row._value || 0));
  }

  const assets = Array.from(assetMap.entries())
    .map(([label, days]) => ({
      label,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
    }))
    .filter((asset) => asset.total > 0)
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  return {
    ok: true,
    mode: 'detail',
    total: assets.reduce((sum, asset) => sum + asset.total, 0),
    topProduct: assets[0]?.label || null,
    productCount: assets.length,
    starbaseCount: 1,
    starbases,
    selectedStarbase,
    sduStarbaseTagged: canGroupSduByStarbase,
    assets,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

const MINING_CONSUMPTION_FIELD_NAMES = Object.freeze({
  burnedFuel: 'Fuel',
  burnedFood: 'Food',
  burnedAmmo: 'Ammunition',
});

const SCANNING_CONSUMPTION_FIELD_NAMES = Object.freeze({
  burnedFood: 'Food',
  burnedFuel: 'Fuel',
});

const CARGO_CONSUMPTION_FIELD_NAMES = Object.freeze({
  burnedFuel: 'Fuel',
});

async function fetchConsumptionMining(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const untaggedFleetNames = await getProfileFleetLabels(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings, { untaggedFleetNames });
  const requestedStarbase = normalizeStarbaseFilter(payload);
  const requestedFleet = normalizeFleetFilter(payload);

  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "mining")
  |> filter(fn: (r) => r._field == "burnedFuel" or r._field == "burnedFood" or r._field == "burnedAmmo")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "fleet", "_field", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "fleet", "_field", "_time", "_value"])
  |> sort(columns: ["starbase", "fleet", "_field", "_time"])`;
  const csv = await queryInfluxFlux(settings, flux);
  const rows = parseInfluxCsv(csv);
  const dayTemplates = createDayTemplates();
  const starbaseTotals = new Map();
  const fleetTotals = new Map();
  const entries = [];

  for (const row of rows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    const fleet = String(row.fleet || '').trim();
    const field = String(row._field || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!starbase || !fleet || !field || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;

    const assetName = MINING_CONSUMPTION_FIELD_NAMES[field] || field;
    const key = getUtcDateKey(date);
    if (!dayTemplates.some((day) => day.isoDate === key)) continue;

    starbaseTotals.set(starbase, (starbaseTotals.get(starbase) || 0) + value);
    fleetTotals.set(fleet, (fleetTotals.get(fleet) || 0) + value);
    entries.push({ starbase, fleet, assetName, date, value });
  }

  const factionStarbases = await fetchFactionStarbases(settings);
  let starbases = createOptionSummary(starbaseTotals);
  starbases = filterStarbasesByFaction(starbases, factionStarbases, normalizeFaction(settings.faction));
  const selectedStarbase = starbases.some((s) => s.value === requestedStarbase) ? requestedStarbase : '';
  const fleetTotalsScoped = new Map();
  for (const entry of entries) {
    if (selectedStarbase && entry.starbase !== selectedStarbase) continue;
    fleetTotalsScoped.set(entry.fleet, (fleetTotalsScoped.get(entry.fleet) || 0) + entry.value);
  }
  const fleets = summarizeFleetOptions(fleetTotalsScoped);
  const selectedFleet = fleets.some((f) => f.value === requestedFleet) ? requestedFleet : '';
  const isDetail = Boolean(selectedStarbase || selectedFleet);

  if (!isDetail) {
    const pieMap = new Map();
    const faction = normalizeFaction(settings.faction);
    for (const entry of entries) {
      if (!isStarbaseIncluded(entry.starbase, factionStarbases, faction)) continue;
      if (!pieMap.has(entry.starbase)) pieMap.set(entry.starbase, new Map());
      const slices = pieMap.get(entry.starbase);
      slices.set(entry.assetName, (slices.get(entry.assetName) || 0) + entry.value);
    }

    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        return { starbase, total: slices.reduce((sum, s) => sum + s.total, 0), slices };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      total,
      topAsset: topSlice?.label || null,
      assetCount: new Set(pies.flatMap((p) => p.slices.map((s) => s.label))).size,
      starbases,
      fleets,
      selectedStarbase: '',
      selectedFleet: '',
      pies,
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const scopedEntries = entries.filter((entry) => {
    if (selectedStarbase && entry.starbase !== selectedStarbase) return false;
    if (selectedFleet && entry.fleet !== selectedFleet) return false;
    return true;
  });

  const assetMap = new Map();
  for (const entry of scopedEntries) {
    if (!assetMap.has(entry.assetName)) {
      assetMap.set(entry.assetName, dayTemplates.map((day) => ({ ...day })));
    }
    addValueToDay(assetMap.get(entry.assetName), entry.date, entry.value);
  }

  const assets = Array.from(assetMap.entries())
    .map(([label, days]) => ({
      label,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const total = assets.reduce((sum, asset) => sum + asset.total, 0);

  return {
    ok: true,
    mode: 'detail',
    total,
    topAsset: assets[0]?.label || null,
    assetCount: assets.length,
    starbases,
    fleets,
    selectedStarbase,
    selectedFleet,
    assets,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

async function fetchConsumptionCrafting(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const requestedStarbase = normalizeStarbaseFilter(payload);
  const requestedRecipe = normalizeRecipeFilter(payload);

  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "crafting")
  |> filter(fn: (r) => r._field == "amount")
  |> filter(fn: (r) => exists r.type and r.type == "Input")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.starbase)
  |> filter(fn: (r) => exists r.output)
  |> filter(fn: (r) => exists r.input)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "output", "input", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "output", "input", "_time", "_value"])
  |> sort(columns: ["starbase", "output", "input", "_time"])`;
  const csv = await queryInfluxFlux(settings, flux);
  const rows = parseInfluxCsv(csv);
  const dayTemplates = createDayTemplates();
  const starbaseTotals = new Map();
  const recipeTotals = new Map();
  const entries = [];

  for (const row of rows) {
    const starbase = String(row.starbase || '').trim();
    const output = String(row.output || '').trim();
    const input = String(row.input || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!starbase || !output || !input || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;

    const key = getUtcDateKey(date);
    if (!dayTemplates.some((day) => day.isoDate === key)) continue;

    starbaseTotals.set(starbase, (starbaseTotals.get(starbase) || 0) + value);
    recipeTotals.set(output, (recipeTotals.get(output) || 0) + value);
    entries.push({ starbase, output, input, date, value });
  }

  const factionStarbases_ = await fetchFactionStarbases(settings);
  let starbases = createOptionSummary(starbaseTotals);
  starbases = filterStarbasesByFaction(starbases, factionStarbases_, normalizeFaction(settings.faction));
  const recipes = createOptionSummary(recipeTotals);
  const selectedStarbase = starbases.some((s) => s.value === requestedStarbase) ? requestedStarbase : '';
  const selectedRecipe = recipes.some((r) => r.value === requestedRecipe) ? requestedRecipe : '';
  const isDetail = Boolean(selectedStarbase || selectedRecipe);

  if (!isDetail) {
    const pieMap = new Map();
    const faction = normalizeFaction(settings.faction);
    for (const entry of entries) {
      if (!isStarbaseIncluded(entry.starbase, factionStarbases_, faction)) continue;
      if (!pieMap.has(entry.starbase)) pieMap.set(entry.starbase, new Map());
      const slices = pieMap.get(entry.starbase);
      slices.set(entry.input, (slices.get(entry.input) || 0) + entry.value);
    }

    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        return { starbase, total: slices.reduce((sum, s) => sum + s.total, 0), slices };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      total,
      topAsset: topSlice?.label || null,
      assetCount: new Set(pies.flatMap((p) => p.slices.map((s) => s.label))).size,
      starbases,
      recipes,
      selectedStarbase: '',
      selectedRecipe: '',
      pies,
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const scopedEntries = entries.filter((entry) => {
    if (selectedStarbase && entry.starbase !== selectedStarbase) return false;
    if (selectedRecipe && entry.output !== selectedRecipe) return false;
    return true;
  });

  const assetMap = new Map();
  for (const entry of scopedEntries) {
    if (!assetMap.has(entry.input)) {
      assetMap.set(entry.input, dayTemplates.map((day) => ({ ...day })));
    }
    addValueToDay(assetMap.get(entry.input), entry.date, entry.value);
  }

  const assets = Array.from(assetMap.entries())
    .map(([label, days]) => ({
      label,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const total = assets.reduce((sum, asset) => sum + asset.total, 0);

  return {
    ok: true,
    mode: 'detail',
    total,
    topAsset: assets[0]?.label || null,
    assetCount: assets.length,
    starbases,
    recipes,
    selectedStarbase,
    selectedRecipe,
    assets,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

async function fetchConsumptionUpgrading(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const requestedStarbase = normalizeStarbaseFilter(payload);
  const requestedComponent = normalizeComponentFilter(payload);

  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "upgrade")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.starbase)
  |> filter(fn: (r) => exists r.input)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "input", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "input", "_time", "_value"])
  |> sort(columns: ["starbase", "input", "_time"])`;
  const csv = await queryInfluxFlux(settings, flux);
  const rows = parseInfluxCsv(csv);
  const dayTemplates = createDayTemplates();
  const starbaseTotals = new Map();
  const componentTotals = new Map();
  const entries = [];

  for (const row of rows) {
    const starbase = String(row.starbase || '').trim();
    const input = String(row.input || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!starbase || !input || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;

    const key = getUtcDateKey(date);
    if (!dayTemplates.some((day) => day.isoDate === key)) continue;

    starbaseTotals.set(starbase, (starbaseTotals.get(starbase) || 0) + value);
    componentTotals.set(input, (componentTotals.get(input) || 0) + value);
    entries.push({ starbase, input, date, value });
  }

  const factionStarbases__ = await fetchFactionStarbases(settings);
  let starbases = createOptionSummary(starbaseTotals);
  starbases = filterStarbasesByFaction(starbases, factionStarbases__, normalizeFaction(settings.faction));
  const components = createOptionSummary(componentTotals);
  const selectedStarbase = starbases.some((s) => s.value === requestedStarbase) ? requestedStarbase : '';
  const selectedComponent = components.some((c) => c.value === requestedComponent) ? requestedComponent : '';
  const isDetail = Boolean(selectedStarbase || selectedComponent);

  if (!isDetail) {
    const pieMap = new Map();
    const faction = normalizeFaction(settings.faction);
    for (const entry of entries) {
      if (!isStarbaseIncluded(entry.starbase, factionStarbases__, faction)) continue;
      if (!pieMap.has(entry.starbase)) pieMap.set(entry.starbase, new Map());
      const slices = pieMap.get(entry.starbase);
      slices.set(entry.input, (slices.get(entry.input) || 0) + entry.value);
    }

    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        return { starbase, total: slices.reduce((sum, s) => sum + s.total, 0), slices };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      total,
      topAsset: topSlice?.label || null,
      assetCount: new Set(pies.flatMap((p) => p.slices.map((s) => s.label))).size,
      starbases,
      components,
      selectedStarbase: '',
      selectedComponent: '',
      pies,
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const scopedEntries = entries.filter((entry) => {
    if (selectedStarbase && entry.starbase !== selectedStarbase) return false;
    if (selectedComponent && entry.input !== selectedComponent) return false;
    return true;
  });

  const assetMap = new Map();
  for (const entry of scopedEntries) {
    if (!assetMap.has(entry.input)) {
      assetMap.set(entry.input, dayTemplates.map((day) => ({ ...day })));
    }
    addValueToDay(assetMap.get(entry.input), entry.date, entry.value);
  }

  const assets = Array.from(assetMap.entries())
    .map(([label, days]) => ({
      label,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const total = assets.reduce((sum, asset) => sum + asset.total, 0);

  return {
    ok: true,
    mode: 'detail',
    total,
    topAsset: assets[0]?.label || null,
    assetCount: assets.length,
    starbases,
    components,
    selectedStarbase,
    selectedComponent,
    assets,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

async function fetchConsumptionScanning(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const untaggedFleetNames = await getProfileFleetLabels(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings, { untaggedFleetNames });
  const requestedStarbase = normalizeStarbaseFilter(payload);
  const requestedFleet = normalizeFleetFilter(payload);

  const sduFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "sdu")
  |> filter(fn: (r) => r._field == "burnedFood")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "sectorX", "sectorY", "fleet", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "sectorX", "sectorY", "fleet", "_time", "_value"])`;

  const movementFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "movement")
  |> filter(fn: (r) => r._field == "burnedFuel")
  |> filter(fn: (r) => exists r.assignment and r.assignment == "Scan")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "fleet", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "fleet", "_time", "_value"])`;

  const [sduCsv, movementCsv] = await Promise.all([
    queryInfluxFlux(settings, sduFlux),
    queryInfluxFlux(settings, movementFlux),
  ]);

  const sduRows = parseInfluxCsv(sduCsv);
  const movementRows = parseInfluxCsv(movementCsv);
  const dayTemplates = createDayTemplates();
  const starbaseTotals = new Map();
  const fleetTotals = new Map();
  const entries = [];

  for (const row of sduRows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!starbase || !fleet || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const key = getUtcDateKey(date);
    if (!dayTemplates.some((day) => day.isoDate === key)) continue;
    starbaseTotals.set(starbase, (starbaseTotals.get(starbase) || 0) + value);
    fleetTotals.set(fleet, (fleetTotals.get(fleet) || 0) + value);
    entries.push({ starbase, fleet, assetName: 'Food', date, value });
  }
  for (const row of movementRows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!starbase || !fleet || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const key = getUtcDateKey(date);
    if (!dayTemplates.some((day) => day.isoDate === key)) continue;
    starbaseTotals.set(starbase, (starbaseTotals.get(starbase) || 0) + value);
    fleetTotals.set(fleet, (fleetTotals.get(fleet) || 0) + value);
    entries.push({ starbase, fleet, assetName: 'Fuel', date, value });
  }

  const factionStarbases = await fetchFactionStarbases(settings);
  let starbases = createOptionSummary(starbaseTotals);
  starbases = filterStarbasesByFaction(starbases, factionStarbases, normalizeFaction(settings.faction));
  const fleets = summarizeFleetOptions(fleetTotals);
  const selectedStarbase = starbases.some((s) => s.value === requestedStarbase) ? requestedStarbase : '';
  const selectedFleet = fleets.some((f) => f.value === requestedFleet) ? requestedFleet : '';
  const isDetail = Boolean(selectedStarbase || selectedFleet);

  if (!isDetail) {
    const pieMap = new Map();
    const faction = normalizeFaction(settings.faction);
    for (const entry of entries) {
      if (!isStarbaseIncluded(entry.starbase, factionStarbases, faction)) continue;
      if (!pieMap.has(entry.starbase)) pieMap.set(entry.starbase, new Map());
      const slices = pieMap.get(entry.starbase);
      slices.set(entry.assetName, (slices.get(entry.assetName) || 0) + entry.value);
    }

    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        return { starbase, total: slices.reduce((sum, s) => sum + s.total, 0), slices };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      total,
      topAsset: topSlice?.label || null,
      assetCount: new Set(pies.flatMap((p) => p.slices.map((s) => s.label))).size,
      starbases,
      fleets,
      selectedStarbase: '',
      selectedFleet: '',
      pies,
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const scopedEntries = entries.filter((entry) => {
    if (selectedStarbase && entry.starbase !== selectedStarbase) return false;
    if (selectedFleet && entry.fleet !== selectedFleet) return false;
    return true;
  });

  const assetMap = new Map();
  for (const entry of scopedEntries) {
    if (!assetMap.has(entry.assetName)) {
      assetMap.set(entry.assetName, dayTemplates.map((day) => ({ ...day })));
    }
    addValueToDay(assetMap.get(entry.assetName), entry.date, entry.value);
  }

  const assets = Array.from(assetMap.entries())
    .map(([label, days]) => ({
      label,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const total = assets.reduce((sum, asset) => sum + asset.total, 0);

  return {
    ok: true,
    mode: 'detail',
    total,
    topAsset: assets[0]?.label || null,
    assetCount: assets.length,
    starbases,
    fleets,
    selectedStarbase,
    selectedFleet,
    assets,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

async function fetchConsumptionCargo(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const untaggedFleetNames = await getProfileFleetLabels(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings, { untaggedFleetNames });
  const requestedStarbase = normalizeStarbaseFilter(payload);
  const requestedFleet = normalizeFleetFilter(payload);

  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "movement")
  |> filter(fn: (r) => r._field == "burnedFuel")
  |> filter(fn: (r) => exists r.assignment and r.assignment == "Transport")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "fleet", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "fleet", "_time", "_value"])
  |> sort(columns: ["starbase", "fleet", "_time"])`;
  const csv = await queryInfluxFlux(settings, flux);
  const rows = parseInfluxCsv(csv);
  const dayTemplates = createDayTemplates();
  const starbaseTotals = new Map();
  const fleetTotals = new Map();
  const entries = [];

  for (const row of rows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!starbase || !fleet || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const key = getUtcDateKey(date);
    if (!dayTemplates.some((day) => day.isoDate === key)) continue;
    starbaseTotals.set(starbase, (starbaseTotals.get(starbase) || 0) + value);
    fleetTotals.set(fleet, (fleetTotals.get(fleet) || 0) + value);
    entries.push({ starbase, fleet, assetName: 'Fuel', date, value });
  }

  const factionStarbases = await fetchFactionStarbases(settings);
  let starbases = createOptionSummary(starbaseTotals);
  starbases = filterStarbasesByFaction(starbases, factionStarbases, normalizeFaction(settings.faction));
  const fleets = summarizeFleetOptions(fleetTotals);
  const selectedStarbase = starbases.some((s) => s.value === requestedStarbase) ? requestedStarbase : '';
  const selectedFleet = fleets.some((f) => f.value === requestedFleet) ? requestedFleet : '';
  const isDetail = Boolean(selectedStarbase || selectedFleet);

  if (!isDetail) {
    const pieMap = new Map();
    const faction = normalizeFaction(settings.faction);
    for (const entry of entries) {
      if (!isStarbaseIncluded(entry.starbase, factionStarbases, faction)) continue;
      if (!pieMap.has(entry.starbase)) pieMap.set(entry.starbase, new Map());
      const slices = pieMap.get(entry.starbase);
      slices.set(entry.assetName, (slices.get(entry.assetName) || 0) + entry.value);
    }

    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        return { starbase, total: slices.reduce((sum, s) => sum + s.total, 0), slices };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      total,
      topAsset: topSlice?.label || null,
      assetCount: new Set(pies.flatMap((p) => p.slices.map((s) => s.label))).size,
      starbases,
      fleets,
      selectedStarbase: '',
      selectedFleet: '',
      pies,
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const scopedEntries = entries.filter((entry) => {
    if (selectedStarbase && entry.starbase !== selectedStarbase) return false;
    if (selectedFleet && entry.fleet !== selectedFleet) return false;
    return true;
  });

  const assetMap = new Map();
  for (const entry of scopedEntries) {
    if (!assetMap.has(entry.assetName)) {
      assetMap.set(entry.assetName, dayTemplates.map((day) => ({ ...day })));
    }
    addValueToDay(assetMap.get(entry.assetName), entry.date, entry.value);
  }

  const assets = Array.from(assetMap.entries())
    .map(([label, days]) => ({
      label,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const total = assets.reduce((sum, asset) => sum + asset.total, 0);

  return {
    ok: true,
    mode: 'detail',
    total,
    topAsset: assets[0]?.label || null,
    assetCount: assets.length,
    starbases,
    fleets,
    selectedStarbase,
    selectedFleet,
    assets,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

async function fetchConsumptionTotal(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const untaggedFleetNames = await getProfileFleetLabels(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings, { untaggedFleetNames });
  const requestedStarbase = normalizeStarbaseFilter(payload);

  const sduFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "sdu")
  |> filter(fn: (r) => r._field == "burnedFood")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "sectorX", "sectorY", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "sectorX", "sectorY", "_time", "_value"])`;

  const movementScanFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "movement")
  |> filter(fn: (r) => r._field == "burnedFuel")
  |> filter(fn: (r) => exists r.assignment and r.assignment == "Scan")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "_time", "_value"])`;

  const movementTransportFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "movement")
  |> filter(fn: (r) => r._field == "burnedFuel")
  |> filter(fn: (r) => exists r.assignment and r.assignment == "Transport")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "_time", "_value"])`;

  const miningFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "mining")
  |> filter(fn: (r) => r._field == "burnedFuel" or r._field == "burnedFood" or r._field == "burnedAmmo")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "sectorX", "sectorY", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "sectorX", "sectorY", "_time", "_value"])`;

  const craftingFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "crafting")
  |> filter(fn: (r) => r._field == "amount")
  |> filter(fn: (r) => exists r.type and r.type == "Input")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "_time", "_value"])`;

  const upgradeFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "upgrade")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "_time", "_value"])`;

  const [sduCsv, movementScanCsv, movementTransportCsv, miningCsv, craftingCsv, upgradeCsv] = await Promise.all([
    queryInfluxFlux(settings, sduFlux),
    queryInfluxFlux(settings, movementScanFlux),
    queryInfluxFlux(settings, movementTransportFlux),
    queryInfluxFlux(settings, miningFlux),
    queryInfluxFlux(settings, craftingFlux),
    queryInfluxFlux(settings, upgradeFlux),
  ]);

  const dayTemplates = createDayTemplates();
  const starbaseDayTotals = new Map();
  const dayBuckets = new Map();
  for (const day of dayTemplates) {
    dayBuckets.set(day.isoDate, day);
  }

  const csvSets = [
    { csv: sduCsv, category: 'Scanning' },
    { csv: movementScanCsv, category: 'Scanning' },
    { csv: movementTransportCsv, category: 'Cargo' },
    { csv: miningCsv, category: 'Mining' },
    { csv: craftingCsv, category: 'Crafting' },
    { csv: upgradeCsv, category: 'Upgrading' },
  ];

  for (const { csv, category } of csvSets) {
    const rows = parseInfluxCsv(csv);
    for (const row of rows) {
      const starbase = resolveStarbaseName(row, coordinateMap) || '__untagged__';
      const date = new Date(row._time);
      const value = Number(row._value || 0);
      if (Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
      const key = getUtcDateKey(date);
      if (!dayBuckets.has(key)) continue;
      if (!starbaseDayTotals.has(starbase)) {
        starbaseDayTotals.set(starbase, {
          starbase,
          days: dayTemplates.map((day) => ({ ...day })),
          categories: new Map(),
          total: 0,
        });
      }
      const entry = starbaseDayTotals.get(starbase);
      addValueToDay(entry.days, date, value);
      entry.categories.set(category, (entry.categories.get(category) || 0) + value);
      entry.total += value;
    }
  }

  const factionStarbases = await fetchFactionStarbases(settings);
  const faction = normalizeFaction(settings.faction);
  const starbases = Array.from(starbaseDayTotals.values())
    .filter((entry) => isStarbaseIncluded(entry.starbase, factionStarbases, faction))
    .map((entry) => {
      const slices = createOptionSummary(entry.categories).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
      return { starbase: entry.starbase, total: entry.total, slices, days: entry.days };
    })
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));

  const selectedStarbase = starbases.some((s) => s.starbase === requestedStarbase) ? requestedStarbase : '';
  const isDetail = Boolean(selectedStarbase);

  if (!isDetail) {
    const total = starbases.reduce((sum, sb) => sum + sb.total, 0);
    const allSlices = new Map();
    for (const sb of starbases) {
      for (const slice of sb.slices) {
        allSlices.set(slice.label, (allSlices.get(slice.label) || 0) + slice.total);
      }
    }
    const topSlice = createOptionSummary(allSlices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      total,
      topAsset: topSlice?.label || null,
      assetCount: allSlices.size,
      starbases: starbases.map((sb) => ({ value: sb.starbase, label: sb.starbase, total: sb.total })),
      selectedStarbase: '',
      pies: starbases.map((sb) => ({ starbase: sb.starbase, total: sb.total, slices: sb.slices })),
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const selected = starbases.find((sb) => sb.starbase === selectedStarbase);
  const categoryAssets = Array.from(selected.categories.entries())
    .map(([label, total]) => ({
      label,
      total,
      days: dayTemplates.map((day) => ({ ...day })),
    }));
  const categoryByDate = new Map();
  for (const cat of categoryAssets) {
    for (const day of cat.days) {
      categoryByDate.set(`${cat.label}|${day.isoDate}`, day);
    }
  }

  const reCsv = `from(bucket: "${bucket}")
  |> range(start: -15d)
${scopeFilterFlux}
  |> filter(fn: (r) => r.starbase == "${escapeFluxString(selectedStarbase)}")
  |> filter(fn: (r) =>
    (r._measurement == "sdu" and r._field == "burnedFood") or
    (r._measurement == "movement" and r._field == "burnedFuel" and (r.assignment == "Scan" or r.assignment == "Transport")) or
    (r._measurement == "mining" and (r._field == "burnedFuel" or r._field == "burnedFood" or r._field == "burnedAmmo")) or
    (r._measurement == "crafting" and r._field == "amount" and r.type == "Input") or
    (r._measurement == "upgrade" and r._field == "amount")
  )
  |> filter(fn: (r) => exists r.fleet or r._measurement == "crafting" or r._measurement == "upgrade")
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["_measurement", "_field", "assignment", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["_measurement", "_field", "assignment", "_time", "_value"])
  |> sort(columns: ["_measurement", "_field", "assignment", "_time"])`;

  const detailCsv = await queryInfluxFlux(settings, reCsv);
  const detailRows = parseInfluxCsv(detailCsv);
  const categoryMap = new Map();
  for (const row of detailRows) {
    const measurement = String(row._measurement || '').trim();
    const field = String(row._field || '').trim();
    const assignment = String(row.assignment || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const key = getUtcDateKey(date);
    if (!dayBuckets.has(key)) continue;
    let category = 'Other';
    if (measurement === 'sdu') category = 'Scanning';
    else if (measurement === 'movement' && assignment === 'Scan') category = 'Scanning';
    else if (measurement === 'movement' && assignment === 'Transport') category = 'Cargo';
    else if (measurement === 'mining') category = 'Mining';
    else if (measurement === 'crafting') category = 'Crafting';
    else if (measurement === 'upgrade') category = 'Upgrading';
    if (!categoryMap.has(category)) {
      categoryMap.set(category, {
        label: category,
        total: 0,
        days: dayTemplates.map((day) => ({ ...day })),
      });
    }
    addValueToDay(categoryMap.get(category).days, date, value);
    categoryMap.get(category).total += value;
  }

  const assets = Array.from(categoryMap.values()).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const total = assets.reduce((sum, asset) => sum + asset.total, 0);

  return {
    ok: true,
    mode: 'detail',
    total,
    topAsset: assets[0]?.label || null,
    assetCount: assets.length,
    starbases: starbases.map((sb) => ({ value: sb.starbase, label: sb.starbase, total: sb.total })),
    selectedStarbase,
    assets,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
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
ipcMain.handle('consumption:mining', async (_event, payload) => {
  try {
    return await fetchConsumptionMining(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'consumption_mining_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
ipcMain.handle('consumption:crafting', async (_event, payload) => {
  try {
    return await fetchConsumptionCrafting(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'consumption_crafting_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
ipcMain.handle('consumption:upgrading', async (_event, payload) => {
  try {
    return await fetchConsumptionUpgrading(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'consumption_upgrading_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
ipcMain.handle('consumption:scanning', async (_event, payload) => {
  try {
    return await fetchConsumptionScanning(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'consumption_scanning_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
ipcMain.handle('consumption:cargo', async (_event, payload) => {
  try {
    return await fetchConsumptionCargo(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'consumption_cargo_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
ipcMain.handle('consumption:total', async (_event, payload) => {
  try {
    return await fetchConsumptionTotal(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'consumption_total_failed'),
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
