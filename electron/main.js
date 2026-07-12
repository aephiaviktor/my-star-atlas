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
const AEPHIA_RESOURCE_URL = 'https://get-ship-data.aephia.workers.dev/gm/resource';
const JUPITER_PRICE_URL = 'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112,ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const ATLAS_MINT = 'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx';
const SES_SHIP_STATS_URL = 'https://ses.staratlas.com/tools/ship-stats/engine/data/sot.js';
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
  contractRate: 10,
  contractCurrentRentalState: 99,
  rentalEndTime: 153,
  rentalCancelled: 161,
});

const fleetShipsOffsets = Object.freeze({
  version: 8,
  fleet: 9,
  count: 41,
  bump: 45,
  entries: 46,
  entrySize: 48,
});

const shipFieldOffsets = Object.freeze({
  version: 8,
  gameId: 9,
  mint: 41,
  name: 73,
  nameLength: 64,
  sizeClass: 137,
});

let aephiaResourceCache = null;
let tokenPriceCache = null;
let shipStatsCache = null;

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

function buildInstanceScopeFilter(settings) {
  // Every measurement written by SLYA / the bots now carries either
  // r.instance (sdu) or r.faction (mining, movement, crafting, upgrade) and
  // r.starbase. The legacy "untagged fleet fallback" and USTUR "broad
  // untagged" branch are no longer needed: historical rows that lacked
  // faction tags are now the minority and are simply out of scope.
  const faction = normalizeFaction(settings.faction);
  const aliases = factionInfluxAliases[faction] || factionInfluxAliases.USTUR;
  const instanceValues = makeFluxStringArray(aliases.instance);
  const factionValues = makeFluxStringArray(aliases.faction);

  return `  |> filter(fn: (r) =>
    ((exists r.instance and contains(value: r.instance, set: ${instanceValues})) or
     (exists r.faction and contains(value: r.faction, set: ${factionValues})))
  )`;
}

function getInfluxScopeNote(settings) {
  const faction = normalizeFaction(settings.faction);
  return `${faction} tagged`;
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

// Throttle "unmapped coord" warnings so a single bad row doesn't spam stderr.
let lastUnmappedCoordWarnAt = 0;
let unmappedCoordWarnCount = 0;

function resolveStarbaseName(row, coordinateMap) {
  const direct = String(row.starbase || '').trim();
  if (!direct) return '';
  // The r.starbase tag is written in two formats across the bucket:
  //   1. A literal starbase name (e.g. "MRZ-22", "MUD-PHANTOM"). SLYA has
  //      always written this. The movement bot is also switching to this
  //      format (the "old" coord-string format below only survives in
  //      historical rows).
  //   2. A coordinate string (e.g. "35,16"). Written by older versions of
  //      the movement bot when the starbase name wasn't known. We resolve
  //      these via the coordinate map built from the "starbase" measurement.
  // Sdu rows are deliberately NOT resolved via r.sectorX/Y because those are
  // scanning coordinates, not starbase coordinates.
  if (STARBASE_COORDINATE_REGEX.test(direct)) {
    if (coordinateMap) {
      const [x, y] = direct.split(',');
      const mapped = String(coordinateMap.get(starbaseCoordinateKey(x, y)) || '').trim();
      if (mapped) return mapped;
    }
    // Coord string but no map entry. Likely old data from before the map was
    // built, or a sector the panel hasn't seen. Log once per minute so we
    // notice without spamming stderr.
    unmappedCoordWarnCount += 1;
    const now = Date.now();
    if (now - lastUnmappedCoordWarnAt > 60000) {
      console.warn(
        `[MyStarAtlas] ${unmappedCoordWarnCount} movement row(s) had r.starbase="${direct}" with no coordinate-map entry; passing through as-is.`,
      );
      lastUnmappedCoordWarnAt = now;
      unmappedCoordWarnCount = 0;
    }
    return direct;
  }
  return direct;
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

function normalizeAssetFilter(payload) {
  return String(payload?.assetFilter || '').trim();
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

// Panel-wide active days: number of unique dates in `entries` with value > 0.
function computeActiveDays(entries) {
  const days = new Set();
  for (const entry of entries) {
    const date = entry.date;
    const value = Number(entry.value || 0);
    if (!date || Number.isNaN(date.getTime()) || !Number.isFinite(value) || value <= 0) continue;
    days.add(getUtcDateKey(date));
  }
  return days.size;
}

// Per-starbase active days: Map<starbase, Set<dateKey>>.
function computeStarbaseActiveDays(entries) {
  const map = new Map();
  for (const entry of entries) {
    const starbase = entry.starbase;
    const date = entry.date;
    const value = Number(entry.value || 0);
    if (!starbase || !date || Number.isNaN(date.getTime()) || !Number.isFinite(value) || value <= 0) continue;
    if (!map.has(starbase)) map.set(starbase, new Set());
    map.get(starbase).add(getUtcDateKey(date));
  }
  return map;
}

async function fetchDailySdu(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
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

    const starbaseDays = computeStarbaseActiveDays(scopedOutputs);
    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        const total = slices.reduce((sum, slice) => sum + slice.total, 0);
        const activeDays = starbaseDays.get(starbase)?.size || 0;
        const divisor = activeDays > 0 ? activeDays : 1;
        return {
          starbase,
          total,
          activeDays,
          dailyAverage: total / divisor,
          slices: slices.map((s) => ({ ...s, dailyAverage: s.total / divisor })),
        };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((pie) => pie.slices).sort((a, b) => b.total - a.total)[0] || null;
    const activeDays = computeActiveDays(scopedOutputs);
    const dailyAverage = activeDays > 0 ? total / activeDays : 0;

    return {
      ok: true,
      mode: 'overview',
      total,
      dailyAverage,
      activeDays,
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
  const scopedActiveDays = computeActiveDays(scopedOutputs);
  const detailTotal = selectedRecipe ? (finalStep?.total || 0) : steps.reduce((sum, s) => sum + s.total, 0);
  const detailDailyAverage = scopedActiveDays > 0 ? detailTotal / scopedActiveDays : 0;

  return {
    ok: true,
    mode: 'detail',
    total: detailTotal,
    dailyAverage: detailDailyAverage,
    activeDays: scopedActiveDays,
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
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
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

    const starbaseDays = computeStarbaseActiveDays(entries);
    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        const total = slices.reduce((sum, s) => sum + s.total, 0);
        const activeDays = starbaseDays.get(starbase)?.size || 0;
        const divisor = activeDays > 0 ? activeDays : 1;
        return {
          starbase,
          total,
          activeDays,
          dailyAverage: total / divisor,
          slices: slices.map((s) => ({ ...s, dailyAverage: s.total / divisor })),
        };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;
    const activeDays = computeActiveDays(entries);
    const dailyAverage = activeDays > 0 ? total / activeDays : 0;

    return {
      ok: true,
      mode: 'overview',
      field: 'amount',
      total,
      dailyAverage,
      activeDays,
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
  const scopedActiveDays = computeActiveDays(scopedEntries);
  const dailyAverage = scopedActiveDays > 0 ? total / scopedActiveDays : 0;

  return {
    ok: true,
    mode: 'detail',
    field: 'amount',
    materials,
    materialCount: materials.length,
    total,
    dailyAverage,
    activeDays: scopedActiveDays,
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

async function fetchProductionRows(settings, bucket, measurement, tagColumn, extraFilterFlux = '') {
  const groupColumns = tagColumn === 'starbase' ? '"starbase"' : `"starbase", "${tagColumn}"`;
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
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

async function fetchProductionDailyRows(settings, bucket, measurement, tagColumn, starbase, extraFilterFlux = '') {
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
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

async function fetchSduProductionRowsByFleet(settings, bucket) {
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
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

async function fetchSduProductionDailyByFleet(settings, bucket, fleet) {
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
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

// Daily production totals per starbase (sdu + mining + crafting combined).
// Used to compute "active days" for the pie chart's daily average.
async function fetchProductionDailyByStarbaseRows(settings, bucket) {
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._field == "amount")
  |> filter(fn: (r) =>
    (r._measurement == "mining" and exists r.rss) or
    (r._measurement == "crafting" and (exists r.type) and r.type == "Output" and exists r.output) or
    (r._measurement == "sdu" and exists r.fleet and exists r.starbase)
  )
${scopeFilterFlux}
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["starbase", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["starbase", "_time", "_value"])
  |> sort(columns: ["starbase", "_time"])`;
  return parseInfluxCsv(await queryInfluxFlux(settings, flux));
}

async function fetchSduProductionDailyAll(settings, bucket) {
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
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
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const requestedStarbase = normalizeStarbaseFilter(payload);
  // SLYA started writing r.starbase on sdu rows; older rows are still missing
  // the tag, so we only include sdu when the schema reports the column. The
  // legacy "SLYA does not yet write..." comment is stale and the gate will
  // flip to true for buckets that have the new tag.
  const includeSdu = canGroupSduByStarbase;
  const requestedAsset = normalizeAssetFilter(payload);

  const [sduRows, miningRows, craftingRows, dailyByStarbaseRows] = await Promise.all([
    includeSdu
      ? fetchProductionRows(settings, bucket, 'sdu', 'starbase')
      : Promise.resolve([]),
    fetchProductionRows(settings, bucket, 'mining', 'rss'),
    fetchProductionRows(settings, bucket, 'crafting', 'output', '  |> filter(fn: (r) => (exists r.type) and r.type == "Output")'),
    fetchProductionDailyByStarbaseRows(settings, bucket),
  ]);

  // Per-starbase active day set (any source: sdu/mining/crafting)
  const starbaseDays = new Map();
  for (const row of dailyByStarbaseRows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    if (!starbase) continue;
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(value) || value <= 0) continue;
    if (!starbaseDays.has(starbase)) starbaseDays.set(starbase, new Set());
    starbaseDays.get(starbase).add(getUtcDateKey(date));
  }
  // Panel-wide active day set (deduped across all starbases)
  const panelActiveDays = new Set();
  for (const daySet of starbaseDays.values()) {
    for (const key of daySet) panelActiveDays.add(key);
  }

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
      const total = slices.reduce((sum, slice) => sum + slice.total, 0);
      const activeDays = starbaseDays.get(starbase)?.size || 0;
      const divisor = activeDays > 0 ? activeDays : 1;
      return {
        starbase,
        total,
        activeDays,
        dailyAverage: total / divisor,
        slices: slices.map((s) => ({ ...s, dailyAverage: s.total / divisor })),
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

  // Asset list: union of all produced assets (Scanning, Mining, Crafting)
  const productTotals = new Map();
  for (const pie of allPies) {
    for (const slice of pie.slices) {
      productTotals.set(slice.label, (productTotals.get(slice.label) || 0) + slice.total);
    }
  }
  const products = createOptionSummary(productTotals).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const assets = createOptionSummary(productTotals).sort((a, b) => a.label.localeCompare(b.label));

  const selectedAsset = assets.some((a) => a.value === requestedAsset) ? requestedAsset : '';

  // If an asset is selected, only keep starbases that produce that asset.
  const starbasesForAsset = selectedAsset
    ? allPies.filter((pie) => pie.slices.some((s) => s.label === requestedAsset))
    : allPies;
  const starbases = starbasesForAsset.map((pie) => ({ value: pie.starbase, label: pie.starbase, total: pie.total }));
  const selectedStarbase = starbases.some((s) => s.value === requestedStarbase) ? requestedStarbase : '';

  // Build the pies that the renderer will show (filtered by selectedAsset if any)
  const visiblePies = selectedAsset
    ? starbasesForAsset.map((pie) => ({
        ...pie,
        slices: pie.slices.filter((s) => s.label === requestedAsset),
        total: pie.slices
          .filter((s) => s.label === requestedAsset)
          .reduce((sum, slice) => sum + slice.total, 0),
        dailyAverage: pie.slices
          .filter((s) => s.label === requestedAsset)
          .reduce((sum, slice) => sum + (Number(slice.dailyAverage) || 0), 0),
      }))
    : starbasesForAsset;

  const panelTotal = visiblePies.reduce((sum, pie) => sum + pie.total, 0);
  const panelDailyAverage = visiblePies.reduce((sum, pie) => sum + (Number(pie.dailyAverage) || 0), 0);

  if (!selectedStarbase) {
    return {
      ok: true,
      mode: 'overview',
      total: panelTotal,
      dailyAverage: panelDailyAverage,
      activeDays: panelActiveDays.size,
      topProduct: selectedAsset || products[0]?.label || null,
      productCount: selectedAsset ? 1 : products.length,
      starbaseCount: starbasesForAsset.length,
      starbases,
      selectedStarbase: '',
      selectedAsset,
      sduStarbaseTagged: canGroupSduByStarbase,
      productOptions: assets,
      pies: visiblePies,
      faction: normalizeFaction(settings.faction),
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const dayTemplates = createDayTemplates();
  const assetMap = new Map();

  const [sduDailyRows, miningDailyRows, craftingDailyRows] = await Promise.all([
    includeSdu
      ? fetchProductionDailyRows(settings, bucket, 'sdu', 'starbase', selectedStarbase)
      : Promise.resolve([]),
    fetchProductionDailyRows(settings, bucket, 'mining', 'rss', selectedStarbase),
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

  let detailAssets = Array.from(assetMap.entries())
    .map(([label, days]) => ({
      label,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
    }))
    .filter((asset) => asset.total > 0)
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  if (selectedAsset) {
    detailAssets = detailAssets.filter((asset) => asset.label === selectedAsset);
  }
  const detailActiveDays = (starbaseDays.get(selectedStarbase)?.size) || 0;
  const detailTotal = detailAssets.reduce((sum, asset) => sum + asset.total, 0);
  const detailDailyAverage = detailActiveDays > 0 ? detailTotal / detailActiveDays : 0;

  return {
    ok: true,
    mode: 'detail',
    total: detailTotal,
    dailyAverage: detailDailyAverage,
    activeDays: detailActiveDays,
    topProduct: detailAssets[0]?.label || null,
    productCount: detailAssets.length,
    starbaseCount: 1,
    starbases,
    selectedStarbase,
    selectedAsset,
    sduStarbaseTagged: canGroupSduByStarbase,
    productOptions: assets,
    assets: detailAssets,
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
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
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

    const starbaseDays = computeStarbaseActiveDays(entries);
    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        const total = slices.reduce((sum, s) => sum + s.total, 0);
        const activeDays = starbaseDays.get(starbase)?.size || 0;
        const divisor = activeDays > 0 ? activeDays : 1;
        return {
          starbase,
          total,
          activeDays,
          dailyAverage: total / divisor,
          slices: slices.map((s) => ({ ...s, dailyAverage: s.total / divisor })),
        };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;
    const activeDays = computeActiveDays(entries);
    const dailyAverage = activeDays > 0 ? total / activeDays : 0;

    return {
      ok: true,
      mode: 'overview',
      total,
      dailyAverage,
      activeDays,
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
  const scopedActiveDays = computeActiveDays(scopedEntries);
  const dailyAverage = scopedActiveDays > 0 ? total / scopedActiveDays : 0;

  return {
    ok: true,
    mode: 'detail',
    total,
    dailyAverage,
    activeDays: scopedActiveDays,
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
  const selectedRecipe = recipes.some((r) => r.value === requestedRecipe) ? requestedRecipe : '';
  // If a recipe is selected, only show starbases that actually consume it.
  // This prevents the "starbase has no data for this recipe" empty state
  // and stops the dropdowns from getting stuck.
  if (selectedRecipe) {
    const starbaseTotalsForRecipe = new Map();
    for (const entry of entries) {
      if (entry.output !== selectedRecipe) continue;
      starbaseTotalsForRecipe.set(entry.starbase, (starbaseTotalsForRecipe.get(entry.starbase) || 0) + entry.value);
    }
    let starbasesForRecipe = createOptionSummary(starbaseTotalsForRecipe);
    starbasesForRecipe = filterStarbasesByFaction(starbasesForRecipe, factionStarbases_, normalizeFaction(settings.faction));
    starbases = starbasesForRecipe;
  }
  const selectedStarbase = starbases.some((s) => s.value === requestedStarbase) ? requestedStarbase : '';
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

    const starbaseDays = computeStarbaseActiveDays(entries);
    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        const total = slices.reduce((sum, s) => sum + s.total, 0);
        const activeDays = starbaseDays.get(starbase)?.size || 0;
        const divisor = activeDays > 0 ? activeDays : 1;
        return {
          starbase,
          total,
          activeDays,
          dailyAverage: total / divisor,
          slices: slices.map((s) => ({ ...s, dailyAverage: s.total / divisor })),
        };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;
    const activeDays = computeActiveDays(entries);
    const dailyAverage = activeDays > 0 ? total / activeDays : 0;

    return {
      ok: true,
      mode: 'overview',
      total,
      dailyAverage,
      activeDays,
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
  const assetStarbases = new Map();
  for (const entry of scopedEntries) {
    if (!assetMap.has(entry.input)) {
      assetMap.set(entry.input, dayTemplates.map((day) => ({ ...day })));
    }
    addValueToDay(assetMap.get(entry.input), entry.date, entry.value);
    if (!assetStarbases.has(entry.input)) assetStarbases.set(entry.input, new Set());
    assetStarbases.get(entry.input).add(entry.starbase);
  }

  const assets = Array.from(assetMap.entries())
    .map(([label, days]) => ({
      label,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
      starbases: Array.from(assetStarbases.get(label) || []).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const total = assets.reduce((sum, asset) => sum + asset.total, 0);
  const scopedActiveDays = computeActiveDays(scopedEntries);
  const dailyAverage = scopedActiveDays > 0 ? total / scopedActiveDays : 0;

  return {
    ok: true,
    mode: 'detail',
    total,
    dailyAverage,
    activeDays: scopedActiveDays,
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
  const selectedComponent = components.some((c) => c.value === requestedComponent) ? requestedComponent : '';
  // If a component is selected, only show starbases that actually consume it.
  // (Same UX pattern as the Crafting consumption fix: avoid the empty-state
  // trap where the user picks a starbase that doesn't consume the selected
  // component and the dropdowns lock up.)
  if (selectedComponent) {
    const starbaseTotalsForComponent = new Map();
    for (const entry of entries) {
      if (entry.input !== selectedComponent) continue;
      starbaseTotalsForComponent.set(entry.starbase, (starbaseTotalsForComponent.get(entry.starbase) || 0) + entry.value);
    }
    let starbasesForComponent = createOptionSummary(starbaseTotalsForComponent);
    starbasesForComponent = filterStarbasesByFaction(starbasesForComponent, factionStarbases__, normalizeFaction(settings.faction));
    starbases = starbasesForComponent;
  }
  const selectedStarbase = starbases.some((s) => s.value === requestedStarbase) ? requestedStarbase : '';
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

    const starbaseDays = computeStarbaseActiveDays(entries);
    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        const total = slices.reduce((sum, s) => sum + s.total, 0);
        const activeDays = starbaseDays.get(starbase)?.size || 0;
        const divisor = activeDays > 0 ? activeDays : 1;
        return {
          starbase,
          total,
          activeDays,
          dailyAverage: total / divisor,
          slices: slices.map((s) => ({ ...s, dailyAverage: s.total / divisor })),
        };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;
    const activeDays = computeActiveDays(entries);
    const dailyAverage = activeDays > 0 ? total / activeDays : 0;

    return {
      ok: true,
      mode: 'overview',
      total,
      dailyAverage,
      activeDays,
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
  const assetStarbases = new Map();
  for (const entry of scopedEntries) {
    if (!assetMap.has(entry.input)) {
      assetMap.set(entry.input, dayTemplates.map((day) => ({ ...day })));
    }
    addValueToDay(assetMap.get(entry.input), entry.date, entry.value);
    if (!assetStarbases.has(entry.input)) assetStarbases.set(entry.input, new Set());
    assetStarbases.get(entry.input).add(entry.starbase);
  }

  const assets = Array.from(assetMap.entries())
    .map(([label, days]) => ({
      label,
      days,
      total: days.reduce((sum, day) => sum + day.value, 0),
      starbases: Array.from(assetStarbases.get(label) || []).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const total = assets.reduce((sum, asset) => sum + asset.total, 0);
  const scopedActiveDays = computeActiveDays(scopedEntries);
  const dailyAverage = scopedActiveDays > 0 ? total / scopedActiveDays : 0;

  return {
    ok: true,
    mode: 'detail',
    total,
    dailyAverage,
    activeDays: scopedActiveDays,
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
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
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

    const starbaseActiveDays = computeStarbaseActiveDays(entries);
    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        const total = slices.reduce((sum, s) => sum + s.total, 0);
        const activeDays = starbaseActiveDays.get(starbase)?.size || 0;
        const divisor = activeDays > 0 ? activeDays : 1;
        return {
          starbase,
          total,
          activeDays,
          dailyAverage: total / divisor,
          slices: slices.map((s) => ({ ...s, dailyAverage: s.total / divisor })),
        };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const activeDays = computeActiveDays(entries);
    const dailyAverage = activeDays > 0 ? total / activeDays : 0;
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      total,
      dailyAverage,
      activeDays,
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
  const scopedActiveDays = computeActiveDays(scopedEntries);
  const dailyAverage = scopedActiveDays > 0 ? total / scopedActiveDays : 0;

  return {
    ok: true,
    mode: 'detail',
    total,
    dailyAverage,
    activeDays: scopedActiveDays,
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
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
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

    const starbaseActiveDays = computeStarbaseActiveDays(entries);
    const pies = Array.from(pieMap.entries())
      .map(([starbase, sliceMap]) => {
        const slices = createOptionSummary(sliceMap).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
        const total = slices.reduce((sum, s) => sum + s.total, 0);
        const activeDays = starbaseActiveDays.get(starbase)?.size || 0;
        const divisor = activeDays > 0 ? activeDays : 1;
        return {
          starbase,
          total,
          activeDays,
          dailyAverage: total / divisor,
          slices: slices.map((s) => ({ ...s, dailyAverage: s.total / divisor })),
        };
      })
      .filter((pie) => pie.total > 0)
      .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));
    const total = pies.reduce((sum, pie) => sum + pie.total, 0);
    const activeDays = computeActiveDays(entries);
    const dailyAverage = activeDays > 0 ? total / activeDays : 0;
    const topSlice = pies.flatMap((p) => p.slices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      total,
      dailyAverage,
      activeDays,
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
  const scopedActiveDays = computeActiveDays(scopedEntries);
  const dailyAverage = scopedActiveDays > 0 ? total / scopedActiveDays : 0;

  return {
    ok: true,
    mode: 'detail',
    total,
    dailyAverage,
    activeDays: scopedActiveDays,
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
  const coordinateMap = await fetchStarbaseCoordinateMap(settings);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const requestedStarbase = normalizeStarbaseFilter(payload);
  const requestedAsset = normalizeAssetFilter(payload);

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
  |> group(columns: ["_field", "starbase", "sectorX", "sectorY", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["_field", "starbase", "sectorX", "sectorY", "_time", "_value"])`;

  const craftingFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "crafting")
  |> filter(fn: (r) => r._field == "amount")
  |> filter(fn: (r) => exists r.type and r.type == "Input")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["input", "starbase", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["input", "starbase", "_time", "_value"])`;

  const upgradeFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "upgrade")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["input", "starbase", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["input", "starbase", "_time", "_value"])`;

  const [sduCsv, movementScanCsv, movementTransportCsv, miningCsv, craftingCsv, upgradeCsv] = await Promise.all([
    queryInfluxFlux(settings, sduFlux),
    queryInfluxFlux(settings, movementScanFlux),
    queryInfluxFlux(settings, movementTransportFlux),
    queryInfluxFlux(settings, miningFlux),
    queryInfluxFlux(settings, craftingFlux),
    queryInfluxFlux(settings, upgradeFlux),
  ]);

  const dayTemplates = createDayTemplates();
  const starbaseEntries = new Map();
  const dayBuckets = new Map();
  for (const day of dayTemplates) {
    dayBuckets.set(day.isoDate, day);
  }

  // Aggregate by asset name so the Total view matches the per-sub-tab views
  // (Food, Fuel, Ammunition, plus the various crafting/upgrade inputs). The
  // renderer colors slices by asset name via assetChartColors, so the same
  // asset gets the same color in every sub-tab and in Total.
  const csvSets = [
    { csv: sduCsv, resolveAsset: () => 'Food' },
    { csv: movementScanCsv, resolveAsset: () => 'Fuel' },
    { csv: movementTransportCsv, resolveAsset: () => 'Fuel' },
    {
      csv: miningCsv,
      resolveAsset: (row) => {
        if (row._field === 'burnedFuel') return 'Fuel';
        if (row._field === 'burnedFood') return 'Food';
        if (row._field === 'burnedAmmo') return 'Ammunition';
        return null;
      },
    },
    {
      csv: craftingCsv,
      resolveAsset: (row) => String(row.input || '').trim() || null,
    },
    {
      csv: upgradeCsv,
      resolveAsset: (row) => String(row.input || '').trim() || null,
    },
  ];

  for (const { csv, resolveAsset } of csvSets) {
    const rows = parseInfluxCsv(csv);
    for (const row of rows) {
      const starbase = resolveStarbaseName(row, coordinateMap) || '__untagged__';
      const date = new Date(row._time);
      const value = Number(row._value || 0);
      if (Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
      const key = getUtcDateKey(date);
      if (!dayBuckets.has(key)) continue;
      const asset = resolveAsset(row);
      if (!asset) continue;
      if (!starbaseEntries.has(starbase)) {
        starbaseEntries.set(starbase, {
          starbase,
          days: dayTemplates.map((day) => ({ ...day })),
          assets: new Map(),
          assetDays: new Map(),
          total: 0,
        });
      }
      const entry = starbaseEntries.get(starbase);
      addValueToDay(entry.days, date, value);
      entry.assets.set(asset, (entry.assets.get(asset) || 0) + value);
      if (!entry.assetDays.has(asset)) {
        entry.assetDays.set(asset, dayTemplates.map((day) => ({ ...day })));
      }
      addValueToDay(entry.assetDays.get(asset), date, value);
      entry.total += value;
    }
  }

  const factionStarbases = await fetchFactionStarbases(settings);
  const faction = normalizeFaction(settings.faction);
  const allStarbases = Array.from(starbaseEntries.values())
    .filter((entry) => isStarbaseIncluded(entry.starbase, factionStarbases, faction))
    .map((entry) => {
      const slices = createOptionSummary(entry.assets).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
      const activeDays = entry.days.filter((day) => (Number(day.value) || 0) > 0).length;
      const divisor = activeDays > 0 ? activeDays : 1;
      return {
        starbase: entry.starbase,
        total: entry.total,
        activeDays,
        dailyAverage: entry.total / divisor,
        slices: slices.map((slice) => ({ ...slice, dailyAverage: slice.total / divisor })),
        entry,
      };
    })
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase));

  const assetTotals = new Map();
  for (const sb of allStarbases) {
    for (const slice of sb.slices) {
      assetTotals.set(slice.label, (assetTotals.get(slice.label) || 0) + slice.total);
    }
  }
  const assetOptions = createOptionSummary(assetTotals);
  const selectedAsset = assetOptions.some((asset) => asset.value === requestedAsset) ? requestedAsset : '';
  const starbases = selectedAsset
    ? allStarbases
        .map((sb) => {
          const selectedTotal = sb.entry.assets.get(selectedAsset) || 0;
          if (selectedTotal <= 0) return null;
          const selectedDays = sb.entry.assetDays.get(selectedAsset) || dayTemplates.map((day) => ({ ...day }));
          const activeDays = selectedDays.filter((day) => (Number(day.value) || 0) > 0).length;
          const divisor = activeDays > 0 ? activeDays : 1;
          return {
            ...sb,
            total: selectedTotal,
            activeDays,
            dailyAverage: selectedTotal / divisor,
            slices: [{ value: selectedAsset, label: selectedAsset, total: selectedTotal, dailyAverage: selectedTotal / divisor }],
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.total - a.total || a.starbase.localeCompare(b.starbase))
    : allStarbases;
  const selectedStarbase = starbases.some((s) => s.starbase === requestedStarbase) ? requestedStarbase : '';
  const isDetail = Boolean(selectedStarbase);

  if (!isDetail) {
    const total = starbases.reduce((sum, sb) => sum + sb.total, 0);
    const activeDayKeys = new Set();
    const allSlices = new Map();
    for (const sb of starbases) {
      const activeSourceDays = selectedAsset
        ? (sb.entry.assetDays.get(selectedAsset) || [])
        : sb.entry.days;
      for (const day of activeSourceDays) {
        if ((Number(day.value) || 0) > 0) activeDayKeys.add(day.isoDate);
      }
      for (const slice of sb.slices) {
        allSlices.set(slice.label, (allSlices.get(slice.label) || 0) + slice.total);
      }
    }
    const activeDays = activeDayKeys.size;
    const dailyAverage = activeDays > 0 ? total / activeDays : 0;
    const topSlice = createOptionSummary(allSlices).sort((a, b) => b.total - a.total)[0] || null;

    return {
      ok: true,
      mode: 'overview',
      total,
      dailyAverage,
      activeDays,
      topAsset: topSlice?.label || null,
      assetCount: allSlices.size,
      starbases: starbases.map((sb) => ({ value: sb.starbase, label: sb.starbase, total: sb.total })),
      assetOptions,
      selectedStarbase: '',
      selectedAsset,
      pies: starbases.map((sb) => ({
        starbase: sb.starbase,
        total: sb.total,
        activeDays: sb.activeDays,
        dailyAverage: sb.dailyAverage,
        slices: sb.slices,
      })),
      faction,
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }

  const selected = starbases.find((sb) => sb.starbase === selectedStarbase);
  if (!selected) {
    // Defensive: the dropdown only shows values from starbases, so this should
    // not be reachable, but return an empty detail rather than throwing.
    return {
      ok: true,
      mode: 'detail',
      total: 0,
      dailyAverage: 0,
      activeDays: 0,
      topAsset: null,
      assetCount: 0,
      starbases: starbases.map((sb) => ({ value: sb.starbase, label: sb.starbase, total: sb.total })),
      assetOptions,
      selectedStarbase,
      selectedAsset,
      assets: [],
      faction,
      scopeNote: getInfluxScopeNote(settings),
      checkedAt: new Date().toISOString(),
    };
  }
  const assets = createOptionSummary(selected.entry.assets)
    .map((slice) => ({
      label: slice.label,
      total: slice.total,
      days: selected.entry.assetDays.get(slice.label) || dayTemplates.map((d) => ({ ...d })),
    }))
    .filter((asset) => !selectedAsset || asset.label === selectedAsset)
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const total = assets.reduce((sum, asset) => sum + asset.total, 0);
  const activeSourceDays = selectedAsset
    ? (selected.entry.assetDays.get(selectedAsset) || [])
    : selected.entry.days;
  const activeDays = activeSourceDays.filter((day) => (Number(day.value) || 0) > 0).length;
  const dailyAverage = activeDays > 0 ? total / activeDays : 0;

  return {
    ok: true,
    mode: 'detail',
    total,
    dailyAverage,
    activeDays,
    topAsset: assets[0]?.label || null,
    assetCount: assets.length,
    starbases: starbases.map((sb) => ({ value: sb.starbase, label: sb.starbase, total: sb.total })),
    assetOptions,
    selectedStarbase,
    selectedAsset,
    assets,
    faction,
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

// PCR = Production / Consumption. One production query, three consumption
// queries (the InfluxDB optimizer can only push a single _field filter down
// per measurement, so consumption has to be split when the field names
// differ). The renderer buckets the resulting series into the 5 categories
// and draws the line charts.
async function fetchPcrCharts(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);

  // Production sources:
  //   - mining  : _field == "amount"      → asset = r.rss
  //   - crafting: _field == "amount" AND r.type == "Output" → asset = r.output
  //   - sdu     : _field == "amount"      → asset = "Survey Data Unit"
  // sdu rows may or may not carry r.starbase, so we don't require it for sdu.
  const productionFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._field == "amount")
  |> filter(fn: (r) =>
    (r._measurement == "mining" and exists r.rss) or
    (r._measurement == "crafting" and (exists r.type) and r.type == "Output" and exists r.output) or
    (r._measurement == "sdu" and exists r.fleet)
  )
${scopeFilterFlux}
  |> filter(fn: (r) => r._measurement == "sdu" or exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["_measurement", "rss", "output", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["_measurement", "rss", "output", "_time", "_value"])
  |> sort(columns: ["_measurement", "rss", "output", "_time"])`;

  // Consumption has to be split because mining, sdu, movement use different
  // _field names than crafting/upgrade. The InfluxDB planner only pushes a
  // single _field filter per query, so we run three narrower queries and
  // merge the per-day totals on the JS side.
  const miningConsumptionFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "mining")
  |> filter(fn: (r) => r._field == "burnedFuel" or r._field == "burnedFood" or r._field == "burnedAmmo")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["_field", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["_field", "_time", "_value"])
  |> sort(columns: ["_field", "_time"])`;

  const craftUpgradeConsumptionFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._field == "amount")
  |> filter(fn: (r) =>
    (r._measurement == "crafting" and (exists r.type) and r.type == "Input" and exists r.input) or
    (r._measurement == "upgrade" and exists r.input)
  )
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["_measurement", "input", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["_measurement", "input", "_time", "_value"])
  |> sort(columns: ["_measurement", "input", "_time"])`;

  const sduMovementConsumptionFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) =>
    (r._measurement == "sdu" and r._field == "burnedFood") or
    (r._measurement == "movement" and r._field == "burnedFuel")
  )
${scopeFilterFlux}
  |> filter(fn: (r) => r._measurement == "sdu" or exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["_measurement", "_field", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["_measurement", "_field", "_time", "_value"])
  |> sort(columns: ["_measurement", "_field", "_time"])`;

  let productionError = null;
  let miningConsumptionError = null;
  let craftUpgradeConsumptionError = null;
  let sduMovementConsumptionError = null;
  const [productionCsv, miningConsumptionCsv, craftUpgradeConsumptionCsv, sduMovementConsumptionCsv] = await Promise.all([
    queryInfluxFlux(settings, productionFlux).catch((error) => { productionError = error; return ''; }),
    queryInfluxFlux(settings, miningConsumptionFlux).catch((error) => { miningConsumptionError = error; return ''; }),
    queryInfluxFlux(settings, craftUpgradeConsumptionFlux).catch((error) => { craftUpgradeConsumptionError = error; return ''; }),
    queryInfluxFlux(settings, sduMovementConsumptionFlux).catch((error) => { sduMovementConsumptionError = error; return ''; }),
  ]);
  if (productionError && miningConsumptionError && craftUpgradeConsumptionError && sduMovementConsumptionError) {
    throw productionError;
  }

  const dayTemplates = createDayTemplates();
  const dayKeySet = new Set(dayTemplates.map((day) => day.isoDate));

  // Track the first day (in the 14-day window) where each data source
  // has any data. The renderer uses this to find the first "complete
  // day" per category — i.e. the first day where every relevant
  // production + consumption source has at least started reporting.
  // Some sources (e.g. mining with the new faction tag) were added
  // mid-window, so categories dominated by them need a later start day.
  const sourceFirstDays = {
    production: { mining: null, crafting: null, sdu: null },
    consumption: { mining: null, crafting: null, upgrade: null, sdu: null, movement: null },
  };
  const recordSourceFirstDay = (side, source, isoDate) => {
    if (!source) return;
    const current = sourceFirstDays[side][source];
    if (!current || isoDate < current) sourceFirstDays[side][source] = isoDate;
  };

  // Map<assetName, Map<isoDate, number>>
  const productionTotals = new Map();
  if (!productionError) {
    const rows = parseInfluxCsv(productionCsv);
    for (const row of rows) {
      const measurement = String(row._measurement || '').trim();
      const date = new Date(row._time);
      if (Number.isNaN(date.getTime())) continue;
      const key = getUtcDateKey(date);
      if (!dayKeySet.has(key)) continue;
      const value = Number(row._value || 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      let asset = '';
      if (measurement === 'mining') asset = String(row.rss || '').trim();
      else if (measurement === 'crafting') asset = String(row.output || '').trim();
      else if (measurement === 'sdu') asset = 'Survey Data Unit';
      if (!asset) continue;
      if (!productionTotals.has(asset)) productionTotals.set(asset, new Map());
      const dayMap = productionTotals.get(asset);
      dayMap.set(key, (dayMap.get(key) || 0) + value);
      recordSourceFirstDay('production', measurement, key);
    }
  }

  const consumptionTotals = new Map();
  const addConsumption = (asset, dateKey, value) => {
    if (!asset) return;
    if (!consumptionTotals.has(asset)) consumptionTotals.set(asset, new Map());
    const dayMap = consumptionTotals.get(asset);
    dayMap.set(dateKey, (dayMap.get(dateKey) || 0) + value);
  };

  if (!miningConsumptionError) {
    const rows = parseInfluxCsv(miningConsumptionCsv);
    for (const row of rows) {
      const field = String(row._field || '').trim();
      const date = new Date(row._time);
      if (Number.isNaN(date.getTime())) continue;
      const key = getUtcDateKey(date);
      if (!dayKeySet.has(key)) continue;
      const value = Number(row._value || 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      let asset = '';
      if (field === 'burnedFuel') asset = 'Fuel';
      else if (field === 'burnedFood') asset = 'Food';
      else if (field === 'burnedAmmo') asset = 'Ammunition';
      addConsumption(asset, key, value);
      recordSourceFirstDay('consumption', 'mining', key);
    }
  }

  if (!craftUpgradeConsumptionError) {
    const rows = parseInfluxCsv(craftUpgradeConsumptionCsv);
    for (const row of rows) {
      const measurement = String(row._measurement || '').trim();
      const input = String(row.input || '').trim();
      const date = new Date(row._time);
      if (Number.isNaN(date.getTime())) continue;
      const key = getUtcDateKey(date);
      if (!dayKeySet.has(key)) continue;
      const value = Number(row._value || 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      addConsumption(input, key, value);
      if (measurement === 'crafting' || measurement === 'upgrade') {
        recordSourceFirstDay('consumption', measurement, key);
      }
    }
  }

  if (!sduMovementConsumptionError) {
    const rows = parseInfluxCsv(sduMovementConsumptionCsv);
    for (const row of rows) {
      const measurement = String(row._measurement || '').trim();
      const field = String(row._field || '').trim();
      const date = new Date(row._time);
      if (Number.isNaN(date.getTime())) continue;
      const key = getUtcDateKey(date);
      if (!dayKeySet.has(key)) continue;
      const value = Number(row._value || 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      let asset = '';
      if (measurement === 'sdu' && field === 'burnedFood') asset = 'Food';
      else if (measurement === 'movement' && field === 'burnedFuel') asset = 'Fuel';
      addConsumption(asset, key, value);
      if (measurement === 'sdu' || measurement === 'movement') {
        recordSourceFirstDay('consumption', measurement, key);
      }
    }
  }

  const assetsSet = new Set([...productionTotals.keys(), ...consumptionTotals.keys()]);
  const assets = Array.from(assetsSet)
    .map((label) => {
      const productionMap = productionTotals.get(label) || new Map();
      const consumptionMap = consumptionTotals.get(label) || new Map();
      const days = dayTemplates.map((day) => {
        const production = productionMap.get(day.isoDate) || 0;
        const consumption = consumptionMap.get(day.isoDate) || 0;
        let ratio = null;
        if (production > 0 && consumption > 0) {
          ratio = production / consumption;
        } else if (production > 0 && consumption === 0) {
          ratio = null; // infinity → renderer clips to y-max
        } else if (production === 0 && consumption > 0) {
          ratio = 0;
        } else {
          ratio = null; // both zero → omit
        }
        return {
          isoDate: day.isoDate,
          label: day.label,
          production,
          consumption,
          ratio,
        };
      });
      return {
        label,
        days,
        productionTotal: days.reduce((sum, day) => sum + day.production, 0),
        consumptionTotal: days.reduce((sum, day) => sum + day.consumption, 0),
      };
    })
    .filter((asset) => asset.productionTotal > 0 || asset.consumptionTotal > 0)
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    ok: true,
    days: dayTemplates.map((day) => ({ isoDate: day.isoDate, label: day.label })),
    assets,
    sourceFirstDays,
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    productionError: productionError ? String(productionError?.message || productionError) : null,
    consumptionError:
      miningConsumptionError || craftUpgradeConsumptionError || sduMovementConsumptionError
        ? String(
            (miningConsumptionError || craftUpgradeConsumptionError || sduMovementConsumptionError).message ||
              miningConsumptionError ||
              craftUpgradeConsumptionError ||
              sduMovementConsumptionError
          )
        : null,
    checkedAt: new Date().toISOString(),
  };
}

async function fetchInventory(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const faction = normalizeFaction(settings.faction);
  const requestedStarbase = String(payload?.starbase || '').trim();

  // For per-starbase view, just that starbase. For aggregate, the
  // list of starbases that belong to the active faction. The starbase
  // measurement has no faction tag, so we have to derive the list
  // from the starbase names. MUD starbases are MUD-* (excluding the
  // ONI-owned ones in the same sector). USTUR covers the rest
  // (UST-*, UST-PHANTOM, and MRZ-*). ONI is ONI-* + ONI-PHANTOM.
  const starbases = await listFactionStarbasesForInventory(settings, faction);
  if (!starbases.length) {
    return {
      ok: false,
      error: 'no_starbases',
      faction,
      starbase: requestedStarbase || '__all__',
      days: createDayTemplates().map((day) => ({ isoDate: day.isoDate, label: day.label })),
      assets: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const targetStarbases = requestedStarbase
    ? starbases.includes(requestedStarbase)
      ? [requestedStarbase]
      : []
    : starbases;

  if (!targetStarbases.length) {
    return {
      ok: false,
      error: 'starbase_not_in_faction',
      faction,
      starbase: requestedStarbase,
      starbases,
      days: createDayTemplates().map((day) => ({ isoDate: day.isoDate, label: day.label })),
      assets: [],
      checkedAt: new Date().toISOString(),
    };
  }

  // Same per-day per-asset value for a single starbase or the sum
  // across multiple starbases in the aggregate view. We aggregate with
  // `last` so a starbase that doesn't report every day still has a
  // value, and we sum across starbases for the aggregate.
  const starbaseOrClause = targetStarbases
    .map((name) => `r.starbase == "${escapeFluxString(name)}"`)
    .join(' or ');
  const flux = `from(bucket: "${bucket}")
  |> range(start: -15d)
  |> filter(fn: (r) => r._measurement == "starbase")
  |> filter(fn: (r) => r._field == "curAmount")
  |> filter(fn: (r) => ${starbaseOrClause})
  |> filter(fn: (r) => exists r.rss and r._value > 0)
  |> aggregateWindow(every: 1d, fn: last, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["rss", "starbase", "_time"])
  |> last()
  |> group()
  |> keep(columns: ["rss", "starbase", "_time", "_value"])
  |> sort(columns: ["rss", "starbase", "_time"])`;

  let queryError = null;
  const csv = await queryInfluxFlux(settings, flux).catch((error) => {
    queryError = error;
    return '';
  });
  if (queryError) {
    return {
      ok: false,
      error: String(queryError.message || queryError),
      faction,
      starbase: requestedStarbase || '__all__',
      starbases,
      days: createDayTemplates().map((day) => ({ isoDate: day.isoDate, label: day.label })),
      assets: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const dayTemplates = createDayTemplates();
  const dayKeySet = new Set(dayTemplates.map((day) => day.isoDate));

  // Map<assetName, Map<isoDate, sum>>
  const assetDayTotals = new Map();
  const rows = parseInfluxCsv(csv);
  for (const row of rows) {
    const rss = String(row.rss || '').trim();
    if (!rss) continue;
    const date = new Date(row._time);
    if (Number.isNaN(date.getTime())) continue;
    const key = getUtcDateKey(date);
    if (!dayKeySet.has(key)) continue;
    const value = Number(row._value || 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!assetDayTotals.has(rss)) assetDayTotals.set(rss, new Map());
    const dayMap = assetDayTotals.get(rss);
    dayMap.set(key, (dayMap.get(key) || 0) + value);
  }

  // For the aggregate view, also track the first day each asset
  // shows up at ANY of the starbases. The renderer uses this to
  // hide days where a particular asset hasn't been seen yet for
  // the aggregate. (For a single starbase the data is naturally
  // sparse so we just plot what's there.)
  const sourceFirstDays = { byAsset: {} };
  for (const [rss, dayMap] of assetDayTotals.entries()) {
    const keys = Array.from(dayMap.keys()).sort();
    if (keys.length) sourceFirstDays.byAsset[rss] = keys[0];
  }

  const assets = Array.from(assetDayTotals.entries())
    .map(([label, dayMap]) => {
      const days = dayTemplates.map((day) => {
        const value = dayMap.get(day.isoDate) || 0;
        return { isoDate: day.isoDate, label: day.label, value };
      });
      const firstValue = days.find((d) => d.value > 0);
      const lastValue = [...days].reverse().find((d) => d.value > 0);
      return {
        label,
        days,
        firstDay: firstValue ? firstValue.isoDate : null,
        lastDay: lastValue ? lastValue.isoDate : null,
        firstValue: firstValue ? firstValue.value : null,
        lastValue: lastValue ? lastValue.value : null,
      };
    })
    .filter((asset) => asset.days.some((d) => d.value > 0))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    ok: true,
    faction,
    starbase: requestedStarbase || '__all__',
    starbases,
    isAggregate: !requestedStarbase,
    days: dayTemplates.map((day) => ({ isoDate: day.isoDate, label: day.label })),
    assets,
    sourceFirstDays,
    checkedAt: new Date().toISOString(),
  };
}

// Map a faction to the list of starbases that belong to it. The
// starbase measurement has no faction tag, so we derive this from
// the starbase name. MUD-*, ONI-*, and UST-* are obvious. The MRZ-*
// sector is shared between MUD and USTUR; the MUD list is the MRZ
// starbases NOT in ONI_STARBASE_EXCLUSIONS, and the USTUR list is
// the rest.
// Explicit per-faction starbase membership. The starbase measurement
// in InfluxDB has no faction tag, so we derive the faction from the
// starbase name. The mapping is NOT by prefix — MRZ-* starbases are
// split across all three factions, so we have to enumerate them.
// Must stay in sync with INV_FACTION_STARBASES in renderer.js.
const FACTION_STARBASES = Object.freeze({
  MUD: [
    'MUD-1', 'MUD-2', 'MUD-3', 'MUD-4', 'MUD-5', 'MUD-PHANTOM',
    'MRZ-1', 'MRZ-2', 'MRZ-3', 'MRZ-4', 'MRZ-5', 'MRZ-6', 'MRZ-7',
    'MRZ-8', 'MRZ-9', 'MRZ-10', 'MRZ-11', 'MRZ-12',
  ],
  ONI: [
    'ONI-1', 'ONI-2', 'ONI-3', 'ONI-4', 'ONI-5', 'ONI-PHANTOM',
    'MRZ-13', 'MRZ-14', 'MRZ-18', 'MRZ-19', 'MRZ-20',
    'MRZ-24', 'MRZ-25', 'MRZ-26', 'MRZ-29', 'MRZ-30', 'MRZ-31', 'MRZ-36',
  ],
  USTUR: [
    'UST-1', 'UST-2', 'UST-3', 'UST-4', 'UST-5', 'UST-PHANTOM',
    'MRZ-15', 'MRZ-16', 'MRZ-17', 'MRZ-21', 'MRZ-22', 'MRZ-23',
    'MRZ-27', 'MRZ-28', 'MRZ-32', 'MRZ-33', 'MRZ-34', 'MRZ-35',
  ],
});

async function listFactionStarbasesForInventory(settings, faction) {
  const bucket = escapeFluxString(settings.influxBucket);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -7d)
  |> filter(fn: (r) => r._measurement == "starbase")
  |> filter(fn: (r) => r._field == "curAmount")
  |> group(columns: ["starbase"])
  |> last()
  |> keep(columns: ["starbase"])
  |> limit(n: 200)`;
  const csv = await queryInfluxFlux(settings, flux).catch(() => '');
  const rows = parseInfluxCsv(csv);
  const all = Array.from(new Set(rows.map((r) => String(r.starbase || '').trim()).filter(Boolean))).sort();
  if (!all.length) return [];
  // Filter the active starbases down to those that belong to the
  // active faction AND have actual inventory data. The membership
  // map is explicit (FACTION_STARBASES) because MRZ-* starbases are
  // split across all three factions.
  const membership = FACTION_STARBASES[faction];
  if (!membership) return all;
  const set = new Set(membership);
  return all.filter((s) => set.has(s));
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

function readFixedString(data, offset, length) {
  return data
    .subarray(offset, offset + length)
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

function normalizeAtlasRate(raw) {
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > 1_000_000 ? value / 10 ** 8 : value;
}

function normalizeShipName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFleetLabel(value) {
  return String(value || '').trim().toLowerCase();
}

function parseFleetShipsAccount(data) {
  if (!data || data.length < fleetShipsOffsets.entries) return [];
  const count = data.readUInt32LE(fleetShipsOffsets.count);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = fleetShipsOffsets.entries + index * fleetShipsOffsets.entrySize;
    if (offset + fleetShipsOffsets.entrySize > data.length) break;
    const amount = Number(data.readBigUInt64LE(offset + 32));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    entries.push({
      shipAccount: readPublicKey(data, offset),
      amount,
      updateId: Number(data.readBigUInt64LE(offset + 40)),
    });
  }
  return entries;
}

function parseShipAccount(data, key) {
  if (!data || data.length < shipFieldOffsets.sizeClass + 1) {
    return { key, name: key, mint: '', sizeClass: null };
  }
  return {
    key,
    version: data[shipFieldOffsets.version],
    gameId: readPublicKey(data, shipFieldOffsets.gameId),
    mint: readPublicKey(data, shipFieldOffsets.mint),
    name: readFixedString(data, shipFieldOffsets.name, shipFieldOffsets.nameLength) || key,
    sizeClass: data[shipFieldOffsets.sizeClass],
  };
}

function extractExportedJsonObject(source, exportName) {
  const marker = `export const ${exportName} = `;
  const start = String(source || '').indexOf(marker);
  if (start < 0) return null;
  const objectStart = String(source).indexOf('{', start + marker.length);
  if (objectStart < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = quoted;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(objectStart, index + 1);
      }
    }
  }
  return null;
}

async function fetchAephiaResourceData() {
  const now = Date.now();
  if (aephiaResourceCache && aephiaResourceCache.expiresAt > now) return aephiaResourceCache.data;
  const response = await fetch(AEPHIA_RESOURCE_URL);
  if (!response.ok) throw new Error(`aephia_resource_${response.status}`);
  const data = await response.json();
  aephiaResourceCache = { data: Array.isArray(data) ? data : [], expiresAt: now + 5 * 60 * 1000 };
  return aephiaResourceCache.data;
}

async function fetchAtlasPerSol() {
  const now = Date.now();
  if (tokenPriceCache && tokenPriceCache.expiresAt > now) return tokenPriceCache.data;
  const response = await fetch(JUPITER_PRICE_URL);
  if (!response.ok) throw new Error(`jupiter_price_${response.status}`);
  const data = await response.json();
  const solUsd = Number(data?.[SOL_MINT]?.usdPrice);
  const atlasUsd = Number(data?.[ATLAS_MINT]?.usdPrice);
  const atlasPerSol = Number.isFinite(solUsd) && Number.isFinite(atlasUsd) && atlasUsd > 0
    ? solUsd / atlasUsd
    : null;
  const result = {
    atlasPerSol,
    solPriceAtl: atlasPerSol,
    atlasPriceAtl: Number.isFinite(atlasUsd) ? 1 : null,
    solUsdPrice: Number.isFinite(solUsd) ? solUsd : null,
    atlasUsdPrice: Number.isFinite(atlasUsd) ? atlasUsd : null,
    source: 'Jupiter price v3',
  };
  tokenPriceCache = { data: result, expiresAt: now + 2 * 60 * 1000 };
  return result;
}

async function fetchSduPriceAtl() {
  const resources = await fetchAephiaResourceData();
  const sdu = resources.find((item) => normalizeShipName(item?.name) === 'survey data unit');
  const price = Number(sdu?.pricingATL?.priceATL);
  return Number.isFinite(price) ? price : null;
}

async function fetchCurrentEarningsPrices() {
  const resources = await fetchAephiaResourceData();
  const tokenPrices = await fetchAtlasPerSol().catch(() => ({
    atlasPerSol: null,
    solPriceAtl: null,
    atlasPriceAtl: null,
    solUsdPrice: null,
    atlasUsdPrice: null,
    source: '',
  }));
  const findResource = (name) => resources.find((item) => normalizeShipName(item?.name) === normalizeShipName(name));
  const getPriceAtl = (name) => {
    const price = Number(findResource(name)?.pricingATL?.priceATL);
    return Number.isFinite(price) ? price : null;
  };
  const resourcePricesAtlByName = {};
  for (const resource of resources) {
    const name = String(resource?.name || '').trim();
    const price = Number(resource?.pricingATL?.priceATL);
    if (name && Number.isFinite(price)) resourcePricesAtlByName[normalizeShipName(name)] = price;
  }

  return {
    sduPriceAtl: getPriceAtl('Survey Data Unit'),
    ammunitionPriceAtl: getPriceAtl('Ammunition'),
    foodPriceAtl: getPriceAtl('Food'),
    fuelPriceAtl: getPriceAtl('Fuel'),
    resourcePricesAtlByName,
    atlasPerSol: tokenPrices.atlasPerSol,
    solPriceAtl: tokenPrices.solPriceAtl,
    atlasPriceAtl: tokenPrices.atlasPriceAtl,
    solUsdPrice: tokenPrices.solUsdPrice,
    atlasUsdPrice: tokenPrices.atlasUsdPrice,
    atlasPerSolSource: tokenPrices.source,
  };
}

function getCurrentResourcePriceAtl(prices, resourceName) {
  const key = normalizeShipName(resourceName);
  const price = Number(prices?.resourcePricesAtlByName?.[key]);
  return Number.isFinite(price) ? price : null;
}

async function fetchShipStatsSot() {
  const now = Date.now();
  if (shipStatsCache && shipStatsCache.expiresAt > now) return shipStatsCache.data;
  const response = await fetch(SES_SHIP_STATS_URL);
  if (!response.ok) throw new Error(`ses_ship_stats_${response.status}`);
  const source = await response.text();
  const sourceMatch = source.match(/export const SOT_SOURCE = "([^"]+)"/);
  const json = extractExportedJsonObject(source, 'SOT_BY_MODEL');
  if (!json) throw new Error('ses_ship_stats_parse_failed');
  const byKey = JSON.parse(json);
  const byName = new Map();
  for (const [key, row] of Object.entries(byKey)) {
    const names = [key, row?.sotName, row?.['Ship Name']].filter(Boolean);
    for (const name of names) byName.set(normalizeShipName(name), { key, ...row });
  }
  const data = {
    source: sourceMatch ? sourceMatch[1] : 'SES SoT',
    byKey,
    byName,
  };
  shipStatsCache = { data, expiresAt: now + 60 * 60 * 1000 };
  return data;
}

async function readRentalRate(connection, fleetKey) {
  const contract = deriveRentalContract(new PublicKey(fleetKey));
  const contractInfo = await connection.getAccountInfo(contract, 'confirmed');
  if (!contractInfo || contractInfo.data.length < srslyFieldOffsets.contractRate + 8) {
    return { contract: contract.toBase58(), rateAtlasPerDay: null };
  }
  return {
    contract: contract.toBase58(),
    rateAtlasPerDay: normalizeAtlasRate(Number(contractInfo.data.readBigUInt64LE(srslyFieldOffsets.contractRate))),
  };
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

async function fetchScanningEarningsRows(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) {
    return [];
  }

  const includedDays = new Set(getLastUtcDays(14).map((date) => getUtcDateKey(date)));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const costsFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
${scopeFilterFlux}
  |> filter(fn: (r) =>
    (r._measurement == "sdu" and (r._field == "amount" or r._field == "burnedFood" or r._field == "txCostSol")) or
    (r._measurement == "movement" and r._field == "burnedFuel" and exists r.assignment and r.assignment == "Scan")
  )
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "_measurement", "_field", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "_measurement", "_field", "_time", "_value"])
  |> sort(columns: ["_time", "fleet"])`;

  const scanStatsFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
${scopeFilterFlux}
  |> filter(fn: (r) => r._measurement == "sdu" and (r._field == "amount" or r._field == "chance"))
  |> filter(fn: (r) => exists r.fleet)
  |> keep(columns: ["fleet", "_field", "_time", "_value"])
  |> sort(columns: ["_time", "fleet"])`;

  const rowsByDayFleet = new Map();
  const ensureRow = (isoDate, fleet, date) => {
    const key = `${isoDate}\n${fleet}`;
    if (!rowsByDayFleet.has(key)) {
      rowsByDayFleet.set(key, {
        fleet,
        isoDate,
        label: formatShortUtcDate(date),
        sduFound: 0,
        burnedFood: 0,
        burnedFuel: 0,
        txCostSol: 0,
        scanAttempts: 0,
        successfulScans: 0,
        chanceSumPercent: 0,
      });
    }
    return rowsByDayFleet.get(key);
  };

  const [costsCsv, scanStatsCsv] = await Promise.all([
    queryInfluxFlux(settings, costsFlux),
    queryInfluxFlux(settings, scanStatsFlux),
  ]);

  for (const row of parseInfluxCsv(costsCsv)) {
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, fleet, date);
    if (row._measurement === 'sdu' && row._field === 'amount') entry.sduFound += value;
    if (row._measurement === 'sdu' && row._field === 'burnedFood') entry.burnedFood += value;
    if (row._measurement === 'sdu' && row._field === 'txCostSol') entry.txCostSol += value;
    if (row._measurement === 'movement' && row._field === 'burnedFuel') entry.burnedFuel += value;
  }

  for (const row of parseInfluxCsv(scanStatsCsv)) {
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, fleet, date);
    if (row._field === 'chance') {
      entry.scanAttempts += 1;
      entry.chanceSumPercent += value <= 1 ? value * 100 : value;
    } else if (row._field === 'amount' && value > 0) {
      entry.successfulScans += 1;
    }
  }

  return Array.from(rowsByDayFleet.values())
    .filter((row) => row.scanAttempts > 0 || row.sduFound > 0 || row.burnedFood > 0 || row.burnedFuel > 0 || row.txCostSol > 0)
    .map((row) => ({
      ...row,
      scanSuccessRatePercent: row.scanAttempts > 0 ? (row.successfulScans / row.scanAttempts) * 100 : null,
      averageChancePercent: row.scanAttempts > 0 ? row.chanceSumPercent / row.scanAttempts : null,
    }));
}

async function fetchMiningEarningsRows(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) {
    return [];
  }

  const includedDays = new Set(getLastUtcDays(14).map((date) => getUtcDateKey(date)));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings).catch(() => new Map());
  const totalsFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
${scopeFilterFlux}
  |> filter(fn: (r) => r._measurement == "mining")
  |> filter(fn: (r) => r._field == "amount" or r._field == "burnedAmmo" or r._field == "burnedFood" or r._field == "burnedFuel" or r._field == "txCostSol")
  |> filter(fn: (r) => exists r.fleet)
  |> filter(fn: (r) => exists r.rss)
  |> filter(fn: (r) => exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "starbase", "rss", "_field", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "starbase", "rss", "_field", "_time", "_value"])
  |> sort(columns: ["_time", "fleet", "starbase", "rss"])`;
  const txDailyFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
${scopeFilterFlux}
  |> filter(fn: (r) => r._field == "txCostSol")
  |> filter(fn: (r) => exists r.fleet)
  |> keep(columns: ["fleet", "_time", "_value"])
  |> sort(columns: ["_time", "fleet"])`;

  const rowsByKey = new Map();
  const txDailyByDayFleet = new Map();
  const ensureRow = (isoDate, fleet, starbase, rawMaterial, date) => {
    const key = `${isoDate}\n${fleet}\n${starbase}\n${rawMaterial}`;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        fleet,
        starbase,
        rawMaterial,
        isoDate,
        label: formatShortUtcDate(date),
        mined: 0,
        burnedAmmo: 0,
        burnedFood: 0,
        burnedFuel: 0,
        txCostSol: 0,
        txsDaily: 0,
      });
    }
    return rowsByKey.get(key);
  };

  const [totalsCsv, txDailyCsv] = await Promise.all([
    queryInfluxFlux(settings, totalsFlux),
    queryInfluxFlux(settings, txDailyFlux),
  ]);

  for (const row of parseInfluxCsv(txDailyCsv)) {
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const key = `${isoDate}\n${fleet}`;
    const current = txDailyByDayFleet.get(key) || { txCostSol: 0 };
    current.txCostSol += value;
    txDailyByDayFleet.set(key, current);
  }

  for (const row of parseInfluxCsv(totalsCsv)) {
    const fleet = String(row.fleet || '').trim();
    const rawMaterial = String(row.rss || '').trim();
    const starbase = resolveStarbaseName(row, coordinateMap);
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || !rawMaterial || !starbase || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, fleet, starbase, rawMaterial, date);
    if (row._field === 'amount') entry.mined += value;
    if (row._field === 'burnedAmmo') entry.burnedAmmo += value;
    if (row._field === 'burnedFood') entry.burnedFood += value;
    if (row._field === 'burnedFuel') entry.burnedFuel += value;
    if (row._field === 'txCostSol') entry.txCostSol += value;
  }

  for (const row of rowsByKey.values()) {
    const txDaily = txDailyByDayFleet.get(`${row.isoDate}\n${row.fleet}`) || { txCostSol: 0 };
    row.txCostSol = txDaily.txCostSol;
  }

  return Array.from(rowsByKey.values())
    .filter((row) => row.mined > 0 || row.burnedAmmo > 0 || row.burnedFood > 0 || row.burnedFuel > 0 || row.txCostSol > 0 || row.txsDaily > 0);
}

async function fetchCargoEarningsRows(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) {
    return [];
  }

  const includedDays = new Set(getLastUtcDays(14).map((date) => getUtcDateKey(date)));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings).catch(() => new Map());
  const cargoFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
${scopeFilterFlux}
  |> filter(fn: (r) => r._measurement == "movement")
  |> filter(fn: (r) => r._field == "burnedFuel")
  |> filter(fn: (r) => exists r.assignment and (r.assignment == "Transport" or r.assignment == "Supply Chain"))
  |> filter(fn: (r) => exists r.fleet)
  |> filter(fn: (r) => exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "assignment", "starbase", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "assignment", "starbase", "_time", "_value"])
  |> sort(columns: ["_time", "fleet", "assignment", "starbase"])`;
  const typeFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
${scopeFilterFlux}
  |> filter(fn: (r) => r._measurement == "movement")
  |> filter(fn: (r) => r._field == "type")
  |> filter(fn: (r) => exists r.assignment and (r.assignment == "Transport" or r.assignment == "Supply Chain"))
  |> filter(fn: (r) => exists r.fleet)
  |> keep(columns: ["fleet", "assignment", "_time", "_value"])
  |> sort(columns: ["_time", "fleet", "assignment"])`;
  const txDailyFlux = `from(bucket: "${bucket}")
  |> range(start: -15d)
${scopeFilterFlux}
  |> filter(fn: (r) => r._field == "txCostSol")
  |> filter(fn: (r) => exists r.fleet)
  |> keep(columns: ["fleet", "_time", "_value"])
  |> sort(columns: ["_time", "fleet"])`;

  const rowsByKey = new Map();
  const txDailyByDayFleet = new Map();
  const ensureRow = (isoDate, fleet, assignment, date) => {
    const key = `${isoDate}\n${fleet}\n${assignment}`;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        fleet,
        assignment,
        isoDate,
        label: formatShortUtcDate(date),
        starbases: new Set(),
        cargoTypes: new Map(),
        burnedFuel: 0,
        txCostSol: 0,
        txsDaily: 0,
      });
    }
    return rowsByKey.get(key);
  };

  const [cargoCsv, typeCsv, txDailyCsv] = await Promise.all([
    queryInfluxFlux(settings, cargoFlux),
    queryInfluxFlux(settings, typeFlux),
    queryInfluxFlux(settings, txDailyFlux),
  ]);

  for (const row of parseInfluxCsv(txDailyCsv)) {
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const key = `${isoDate}\n${fleet}`;
    const current = txDailyByDayFleet.get(key) || { txCostSol: 0 };
    current.txCostSol += value;
    txDailyByDayFleet.set(key, current);
  }

  for (const row of parseInfluxCsv(cargoCsv)) {
    const fleet = String(row.fleet || '').trim();
    const assignment = String(row.assignment || '').trim();
    const starbase = resolveStarbaseName(row, coordinateMap);
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || !assignment || !starbase || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, fleet, assignment, date);
    entry.burnedFuel += value;
    entry.starbases.add(starbase);
  }

  for (const row of parseInfluxCsv(typeCsv)) {
    const fleet = String(row.fleet || '').trim();
    const assignment = String(row.assignment || '').trim();
    const cargoType = String(row._value || '').trim();
    const date = new Date(row._time);
    if (!fleet || !assignment || !cargoType || Number.isNaN(date.getTime())) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, fleet, assignment, date);
    entry.cargoTypes.set(cargoType, (entry.cargoTypes.get(cargoType) || 0) + 1);
  }

  for (const row of rowsByKey.values()) {
    const txDaily = txDailyByDayFleet.get(`${row.isoDate}\n${row.fleet}`) || { txCostSol: 0 };
    row.txCostSol = txDaily.txCostSol;
  }

  return Array.from(rowsByKey.values())
    .map((row) => ({
      ...row,
      starbases: Array.from(row.starbases).sort((a, b) => a.localeCompare(b)),
      preferredCargoType: Array.from(row.cargoTypes.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '',
    }))
    .filter((row) => row.burnedFuel > 0 || row.txCostSol > 0 || row.txsDaily > 0);
}

async function fetchFleetSignatureDailyCounts(connection, fleetKeys, includedDays) {
  const uniqueFleetKeys = Array.from(new Set(fleetKeys.filter(Boolean)));
  if (!uniqueFleetKeys.length) return new Map();

  const oldestIsoDate = Array.from(includedDays).sort()[0];
  const oldestStartMs = Date.parse(`${oldestIsoDate}T00:00:00.000Z`);
  const counts = new Map();

  for (const fleetKey of uniqueFleetKeys) {
    let publicKey;
    try {
      publicKey = new PublicKey(fleetKey);
    } catch (_error) {
      continue;
    }

    let before;
    for (let page = 0; page < 6; page += 1) {
      const options = before ? { limit: 1000, before } : { limit: 1000 };
      const signatures = await connection.getSignaturesForAddress(publicKey, options, 'confirmed');
      if (!signatures.length) break;

      let reachedOlderThanWindow = false;
      for (const signature of signatures) {
        if (!signature.blockTime) continue;
        const blockMs = signature.blockTime * 1000;
        if (blockMs < oldestStartMs) {
          reachedOlderThanWindow = true;
          continue;
        }
        const isoDate = getUtcDateKey(new Date(blockMs));
        if (!includedDays.has(isoDate)) continue;
        const key = `${isoDate}\n${fleetKey}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }

      if (reachedOlderThanWindow || signatures.length < 1000) break;
      before = signatures[signatures.length - 1]?.signature;
      if (!before) break;
    }
  }

  return counts;
}

async function fetchEarningsSnapshot(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const fleetResult = await fetchProfileFleets(settings);
  const fleets = Array.isArray(fleetResult.fleets) ? fleetResult.fleets : [];
  const connection = new Connection(getRpcUrl(settings), {
    commitment: 'confirmed',
    disableRetryOnRateLimit: false,
  });

  const [prices, sot] = await Promise.all([
    fetchCurrentEarningsPrices().catch(() => ({
      sduPriceAtl: null,
      ammunitionPriceAtl: null,
      foodPriceAtl: null,
      fuelPriceAtl: null,
      resourcePricesAtlByName: {},
      atlasPerSol: null,
      solPriceAtl: null,
      atlasPriceAtl: null,
      atlasPerSolSource: '',
    })),
    fetchShipStatsSot(),
  ]);
  const { sduPriceAtl, ammunitionPriceAtl, foodPriceAtl, fuelPriceAtl, atlasPerSol } = prices;

  const fleetShipsKeys = fleets
    .map((fleet) => {
      try {
        return new PublicKey(fleet.fleetShips);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean);
  const fleetShipsInfos = fleetShipsKeys.length
    ? await connection.getMultipleAccountsInfo(fleetShipsKeys, 'confirmed')
    : [];

  const compositionByFleet = new Map();
  const shipAccountSet = new Set();
  fleets.forEach((fleet, index) => {
    const info = fleetShipsInfos[index];
    const composition = parseFleetShipsAccount(info?.data);
    compositionByFleet.set(fleet.key, composition);
    for (const entry of composition) shipAccountSet.add(entry.shipAccount);
  });

  const shipAccountKeys = Array.from(shipAccountSet);
  const shipInfos = shipAccountKeys.length
    ? await connection.getMultipleAccountsInfo(shipAccountKeys.map((key) => new PublicKey(key)), 'confirmed')
    : [];
  const shipByAccount = new Map();
  shipAccountKeys.forEach((key, index) => {
    shipByAccount.set(key, parseShipAccount(shipInfos[index]?.data, key));
  });

  const rentalFleetKeys = fleets
    .filter((fleet) => fleet.relationship === 'managed' || fleet.relationship === 'owned-managed')
    .map((fleet) => fleet.key);
  const rentalRates = new Map();
  await Promise.all(rentalFleetKeys.map(async (fleetKey) => {
    try {
      rentalRates.set(fleetKey, await readRentalRate(connection, fleetKey));
    } catch (_error) {
      rentalRates.set(fleetKey, { contract: deriveRentalContract(new PublicKey(fleetKey)).toBase58(), rateAtlasPerDay: null });
    }
  }));

  let mappedShipTypeCount = 0;
  let unmappedShipTypeCount = 0;
  const fleetRows = fleets.map((fleet) => {
    const composition = compositionByFleet.get(fleet.key) || [];
    let expectedSduPerScan = 0;
    let totalRequiredCrew = 0;
    const ships = composition.map((entry) => {
      const ship = shipByAccount.get(entry.shipAccount) || { key: entry.shipAccount, name: entry.shipAccount };
      const sotRow = sot.byName.get(normalizeShipName(ship.name));
      const sduPerScan = Number(sotRow?.sduPerScan);
      const mapped = Number.isFinite(sduPerScan);
      const requiredCrewRaw = Number(sotRow?.requiredCrew);
      const crewMapped = Number.isFinite(requiredCrewRaw);
      if (mapped) {
        mappedShipTypeCount += 1;
        expectedSduPerScan += entry.amount * sduPerScan;
      } else {
        unmappedShipTypeCount += 1;
      }
      if (crewMapped) {
        totalRequiredCrew += entry.amount * requiredCrewRaw;
      }
      return {
        shipAccount: entry.shipAccount,
        mint: ship.mint || '',
        name: ship.name || entry.shipAccount,
        amount: entry.amount,
        sduPerScan: mapped ? sduPerScan : null,
        expectedSduPerScan: mapped ? entry.amount * sduPerScan : null,
        requiredCrew: crewMapped ? requiredCrewRaw : null,
        mapped,
      };
    });
    const rental = rentalRates.get(fleet.key) || { contract: null, rateAtlasPerDay: null };
    const rentalRate = Number(rental.rateAtlasPerDay);
    return {
      ...fleet,
      rentalContract: rental.contract,
      rentalRateAtlasPerDay: Number.isFinite(rentalRate) ? rentalRate : null,
      expectedSduPerScan,
      expectedSduValueAtl: sduPriceAtl != null ? expectedSduPerScan * sduPriceAtl : null,
      totalRequiredCrew: totalRequiredCrew > 0 ? totalRequiredCrew : null,
      shipTypes: ships.length,
      ships,
    };
  });

  fleetRows.sort((a, b) => (Number(b.expectedSduPerScan) || 0) - (Number(a.expectedSduPerScan) || 0));

  const fleetByLabel = new Map();
  for (const fleet of fleetRows) {
    const key = normalizeFleetLabel(fleet.label);
    if (key && !fleetByLabel.has(key)) fleetByLabel.set(key, fleet);
  }

  let scanningRows = [];
  let scanningError = '';
  let miningRows = [];
  let miningError = '';
  let cargoRows = [];
  let cargoError = '';
  try {
    scanningRows = await fetchScanningEarningsRows(settings);
  } catch (error) {
    scanningError = String(error?.message || error || 'scan_rows_unavailable');
  }
  try {
    miningRows = await fetchMiningEarningsRows(settings);
  } catch (error) {
    miningError = String(error?.message || error || 'mining_rows_unavailable');
  }
  try {
    cargoRows = await fetchCargoEarningsRows(settings);
  } catch (error) {
    cargoError = String(error?.message || error || 'cargo_rows_unavailable');
  }

  const activeFleetKeys = new Set();
  const activeMappedFleetKeys = new Set();
  let totalSduFound = 0;
  const rows = scanningRows.map((scanRow) => {
    const fleet = fleetByLabel.get(normalizeFleetLabel(scanRow.fleet));
    const activeKey = fleet?.key || normalizeFleetLabel(scanRow.fleet);
    activeFleetKeys.add(activeKey);
    totalSduFound += scanRow.sduFound;
    if (fleet) activeMappedFleetKeys.add(fleet.key);
    const foodCostsAtlas = foodPriceAtl != null ? scanRow.burnedFood * foodPriceAtl : null;
    const fuelCostsAtlas = fuelPriceAtl != null ? scanRow.burnedFuel * fuelPriceAtl : null;
    const txsCostsAtlas = atlasPerSol != null ? scanRow.txCostSol * atlasPerSol : null;
    const rentalRateAtlasPerDay = fleet?.rentalRateAtlasPerDay ?? null;
    const costParts = [foodCostsAtlas, fuelCostsAtlas, rentalRateAtlasPerDay, txsCostsAtlas].filter((value) => Number.isFinite(value));
    const totalCostsAtlas = costParts.length ? costParts.reduce((sum, value) => sum + value, 0) : null;
    const revenueAtlasPerDay = sduPriceAtl != null ? scanRow.sduFound * sduPriceAtl : null;
    const netProfitAtlas = Number.isFinite(revenueAtlasPerDay) && Number.isFinite(totalCostsAtlas)
      ? revenueAtlasPerDay - totalCostsAtlas
      : null;
    return {
      ...scanRow,
      fleetName: scanRow.fleet,
      fleetAccount: fleet?.key || '',
      rented: fleet?.relationship === 'managed' || fleet?.relationship === 'owned-managed',
      ownership: fleet?.ownership || '',
      relationship: fleet?.relationship || '',
      activity: fleet?.activity || '',
      ships: fleet?.ships || [],
      shipTypes: fleet?.shipTypes || 0,
      expectedSduPerScan: fleet?.expectedSduPerScan ?? null,
      expectedSduValueAtl: fleet?.expectedSduValueAtl ?? null,
      totalRequiredCrew: fleet?.totalRequiredCrew ?? null,
      revenueAtlasPerDay,
      foodCostsAtlas,
      fuelCostsAtlas,
      txsCostsAtlas,
      totalCostsAtlas,
      netProfitAtlas,
      netProfitPerCrew: Number.isFinite(netProfitAtlas) && Number.isFinite(fleet?.totalRequiredCrew) && fleet.totalRequiredCrew > 0
        ? netProfitAtlas / fleet.totalRequiredCrew
        : null,
      profitMarginPercent: Number.isFinite(netProfitAtlas) && Number.isFinite(revenueAtlasPerDay) && revenueAtlasPerDay !== 0
        ? (netProfitAtlas / revenueAtlasPerDay) * 100
        : null,
      rentalContract: fleet?.rentalContract || null,
      rentalRateAtlasPerDay,
    };
  });

  const activeMiningFleetKeys = new Set();
  const activeMappedMiningFleetKeys = new Set();
  let totalMined = 0;
  let totalMiningRevenueAtlas = 0;
  let totalMiningRevenueCount = 0;
  const mining = miningRows.map((miningRow) => {
    const fleet = fleetByLabel.get(normalizeFleetLabel(miningRow.fleet));
    const activeKey = fleet?.key || normalizeFleetLabel(miningRow.fleet);
    activeMiningFleetKeys.add(activeKey);
    if (fleet) activeMappedMiningFleetKeys.add(fleet.key);
    totalMined += miningRow.mined;
    const rawMaterialPriceAtl = getCurrentResourcePriceAtl(prices, miningRow.rawMaterial);
    const revenueAtlasPerDay = rawMaterialPriceAtl != null ? miningRow.mined * rawMaterialPriceAtl : null;
    const ammoCostsAtlas = ammunitionPriceAtl != null ? miningRow.burnedAmmo * ammunitionPriceAtl : null;
    const foodCostsAtlas = foodPriceAtl != null ? miningRow.burnedFood * foodPriceAtl : null;
    const fuelCostsAtlas = fuelPriceAtl != null ? miningRow.burnedFuel * fuelPriceAtl : null;
    const txsCostsAtlas = atlasPerSol != null ? miningRow.txCostSol * atlasPerSol : null;
    const rentalRateAtlasPerDay = fleet?.rentalRateAtlasPerDay ?? null;
    const costParts = [ammoCostsAtlas, foodCostsAtlas, fuelCostsAtlas, rentalRateAtlasPerDay, txsCostsAtlas].filter((value) => Number.isFinite(value));
    const totalCostsAtlas = costParts.length ? costParts.reduce((sum, value) => sum + value, 0) : null;
    const netProfitAtlas = Number.isFinite(revenueAtlasPerDay) && Number.isFinite(totalCostsAtlas)
      ? revenueAtlasPerDay - totalCostsAtlas
      : null;
    if (Number.isFinite(revenueAtlasPerDay)) {
      totalMiningRevenueAtlas += revenueAtlasPerDay;
      totalMiningRevenueCount += 1;
    }
    return {
      ...miningRow,
      fleetName: miningRow.fleet,
      fleetAccount: fleet?.key || '',
      rented: fleet?.relationship === 'managed' || fleet?.relationship === 'owned-managed',
      ownership: fleet?.ownership || '',
      relationship: fleet?.relationship || '',
      activity: fleet?.activity || '',
      ships: fleet?.ships || [],
      shipTypes: fleet?.shipTypes || 0,
      totalRequiredCrew: fleet?.totalRequiredCrew ?? null,
      rawMaterialPriceAtl,
      revenueAtlasPerDay,
      ammoCostsAtlas,
      foodCostsAtlas,
      fuelCostsAtlas,
      txsCostsAtlas,
      totalCostsAtlas,
      netProfitAtlas,
      netProfitPerCrew: Number.isFinite(netProfitAtlas) && Number.isFinite(fleet?.totalRequiredCrew) && fleet.totalRequiredCrew > 0
        ? netProfitAtlas / fleet.totalRequiredCrew
        : null,
      profitMarginPercent: Number.isFinite(netProfitAtlas) && Number.isFinite(revenueAtlasPerDay) && revenueAtlasPerDay !== 0
        ? (netProfitAtlas / revenueAtlasPerDay) * 100
        : null,
      rentalContract: fleet?.rentalContract || null,
      rentalRateAtlasPerDay,
    };
  });
  const miningSignatureCounts = await fetchFleetSignatureDailyCounts(
    connection,
    mining.map((row) => row.fleetAccount).filter(Boolean),
    new Set(getLastUtcDays(14).map((date) => getUtcDateKey(date)))
  );
  for (const row of mining) {
    if (!row.fleetAccount || !row.isoDate) continue;
    row.txsDaily = miningSignatureCounts.get(`${row.isoDate}\n${row.fleetAccount}`) || 0;
  }

  const activeCargoFleetKeys = new Set();
  const activeMappedCargoFleetKeys = new Set();
  const cargo = cargoRows.map((cargoRow) => {
    const fleet = fleetByLabel.get(normalizeFleetLabel(cargoRow.fleet));
    const activeKey = fleet?.key || normalizeFleetLabel(cargoRow.fleet);
    activeCargoFleetKeys.add(activeKey);
    if (fleet) activeMappedCargoFleetKeys.add(fleet.key);
    const fuelCostsAtlas = fuelPriceAtl != null ? cargoRow.burnedFuel * fuelPriceAtl : null;
    const txsCostsAtlas = atlasPerSol != null ? cargoRow.txCostSol * atlasPerSol : null;
    const costParts = [fuelCostsAtlas, txsCostsAtlas].filter((value) => Number.isFinite(value));
    const totalCostsAtlas = costParts.length ? costParts.reduce((sum, value) => sum + value, 0) : null;
    const netProfitAtlas = Number.isFinite(totalCostsAtlas) ? -totalCostsAtlas : null;
    return {
      ...cargoRow,
      fleetName: cargoRow.fleet,
      fleetAccount: fleet?.key || '',
      rented: fleet?.relationship === 'managed' || fleet?.relationship === 'owned-managed',
      ownership: fleet?.ownership || '',
      relationship: fleet?.relationship || '',
      activity: fleet?.activity || '',
      ships: fleet?.ships || [],
      shipTypes: fleet?.shipTypes || 0,
      totalRequiredCrew: fleet?.totalRequiredCrew ?? null,
      starbaseLabel: Array.isArray(cargoRow.starbases) && cargoRow.starbases.length ? cargoRow.starbases.join(', ') : '--',
      fuelCostsAtlas,
      txsCostsAtlas,
      totalCostsAtlas,
      netProfitAtlas,
      txsCostsPercent: Number.isFinite(txsCostsAtlas) && Number.isFinite(totalCostsAtlas) && totalCostsAtlas > 0
        ? (txsCostsAtlas / totalCostsAtlas) * 100
        : null,
    };
  });
  const cargoSignatureCounts = await fetchFleetSignatureDailyCounts(
    connection,
    cargo.map((row) => row.fleetAccount).filter(Boolean),
    new Set(getLastUtcDays(14).map((date) => getUtcDateKey(date)))
  );
  for (const row of cargo) {
    if (!row.fleetAccount || !row.isoDate) continue;
    row.txsDaily = cargoSignatureCounts.get(`${row.isoDate}\n${row.fleetAccount}`) || 0;
  }

  rows.sort((a, b) => {
    const dateSort = String(b.isoDate || '').localeCompare(String(a.isoDate || ''));
    return dateSort || String(a.fleetName || '').localeCompare(String(b.fleetName || ''));
  });
  mining.sort((a, b) => {
    const dateSort = String(b.isoDate || '').localeCompare(String(a.isoDate || ''));
    if (dateSort) return dateSort;
    const fleetSort = String(a.fleetName || '').localeCompare(String(b.fleetName || ''));
    if (fleetSort) return fleetSort;
    const starbaseSort = String(a.starbase || '').localeCompare(String(b.starbase || ''));
    return starbaseSort || String(a.rawMaterial || '').localeCompare(String(b.rawMaterial || ''));
  });
  cargo.sort((a, b) => {
    const dateSort = String(b.isoDate || '').localeCompare(String(a.isoDate || ''));
    if (dateSort) return dateSort;
    const fleetSort = String(a.fleetName || '').localeCompare(String(b.fleetName || ''));
    return fleetSort || String(a.assignment || '').localeCompare(String(b.assignment || ''));
  });

  const activeFleetRows = fleetRows.filter((fleet) => activeMappedFleetKeys.has(fleet.key));
  const totalExpectedSduPerScan = activeFleetRows.reduce((sum, fleet) => sum + (Number(fleet.expectedSduPerScan) || 0), 0);
  const rentalAtlasPerDay = activeFleetRows.reduce((sum, fleet) => sum + (Number(fleet.rentalRateAtlasPerDay) || 0), 0);
  const todayIsoDate = getUtcDateKey(new Date());
  const totalsByDay = new Map();
  for (const row of rows) {
    const day = row.isoDate;
    if (!day) continue;
    if (!totalsByDay.has(day)) {
      totalsByDay.set(day, { sduFound: 0, revenueAtlas: 0, revenueCount: 0 });
    }
    const total = totalsByDay.get(day);
    total.sduFound += Number(row.sduFound) || 0;
    if (Number.isFinite(Number(row.revenueAtlasPerDay))) {
      total.revenueAtlas += Number(row.revenueAtlasPerDay);
      total.revenueCount += 1;
    }
  }
  const dayTotals = Array.from(totalsByDay.values());
  const todayTotals = totalsByDay.get(todayIsoDate) || { sduFound: 0, revenueAtlas: 0, revenueCount: 0 };
  const averageSduFoundPerDay = dayTotals.length
    ? dayTotals.reduce((sum, day) => sum + day.sduFound, 0) / dayTotals.length
    : 0;
  const revenueDayTotals = dayTotals.filter((day) => day.revenueCount > 0);
  const averageRevenueAtlasPerDay = revenueDayTotals.length
    ? revenueDayTotals.reduce((sum, day) => sum + day.revenueAtlas, 0) / revenueDayTotals.length
    : null;
  const miningTotalsByDay = new Map();
  const todayMiningNetProfitByFleet = new Map();
  for (const row of mining) {
    const day = row.isoDate;
    if (!day) continue;
    if (!miningTotalsByDay.has(day)) {
      miningTotalsByDay.set(day, { mined: 0, revenueAtlas: 0, revenueCount: 0 });
    }
    const total = miningTotalsByDay.get(day);
    total.mined += Number(row.mined) || 0;
    if (Number.isFinite(Number(row.revenueAtlasPerDay))) {
      total.revenueAtlas += Number(row.revenueAtlasPerDay);
      total.revenueCount += 1;
    }
    if (day === todayIsoDate && Number.isFinite(Number(row.netProfitAtlas))) {
      const fleetName = row.fleetName || row.fleet || 'Unnamed fleet';
      todayMiningNetProfitByFleet.set(fleetName, (todayMiningNetProfitByFleet.get(fleetName) || 0) + Number(row.netProfitAtlas));
    }
  }
  const miningDayTotals = Array.from(miningTotalsByDay.values());
  const todayMiningTotals = miningTotalsByDay.get(todayIsoDate) || { mined: 0, revenueAtlas: 0, revenueCount: 0 };
  const averageMinedPerDay = miningDayTotals.length
    ? miningDayTotals.reduce((sum, day) => sum + day.mined, 0) / miningDayTotals.length
    : 0;
  const miningRevenueDayTotals = miningDayTotals.filter((day) => day.revenueCount > 0);
  const averageMiningRevenueAtlasPerDay = miningRevenueDayTotals.length
    ? miningRevenueDayTotals.reduce((sum, day) => sum + day.revenueAtlas, 0) / miningRevenueDayTotals.length
    : null;
  const topMiningNetProfitFleetToday = Array.from(todayMiningNetProfitByFleet.entries())
    .map(([fleetName, netProfitAtlas]) => ({ fleetName, netProfitAtlas }))
    .sort((a, b) => b.netProfitAtlas - a.netProfitAtlas || a.fleetName.localeCompare(b.fleetName))[0] || null;

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    sduPriceAtl,
    ammunitionPriceAtl,
    foodPriceAtl,
    fuelPriceAtl,
    atlasPerSol,
    solPriceAtl: prices.solPriceAtl,
    atlasPriceAtl: prices.atlasPriceAtl,
    solUsdPrice: prices.solUsdPrice,
    atlasUsdPrice: prices.atlasUsdPrice,
    atlasPerSolSource: prices.atlasPerSolSource,
    sduPriceSource: 'Aephia /gm/resource pricingATL.priceATL',
    miningPriceSource: 'Aephia /gm/resource pricingATL.priceATL',
    sduPriceHistoryAvailable: false,
    shipStatsSource: sot.source,
    fleetCount: fleetRows.length,
    activeScanningFleetCount: activeFleetKeys.size,
    activeMappedFleetCount: activeMappedFleetKeys.size,
    scanRowCount: rows.length,
    totalSduFound,
    todaySduFound: todayTotals.sduFound,
    averageSduFoundPerDay,
    todayRevenueAtlas: todayTotals.revenueCount > 0 ? todayTotals.revenueAtlas : null,
    averageRevenueAtlasPerDay,
    mappedShipTypeCount,
    unmappedShipTypeCount,
    totalExpectedSduPerScan,
    totalExpectedSduValueAtl: sduPriceAtl != null ? totalExpectedSduPerScan * sduPriceAtl : null,
    rentalAtlasPerDay,
    scanningError,
    miningError,
    cargoError,
    activeMiningFleetCount: activeMiningFleetKeys.size,
    activeMappedMiningFleetCount: activeMappedMiningFleetKeys.size,
    miningRowCount: mining.length,
    activeCargoFleetCount: activeCargoFleetKeys.size,
    activeMappedCargoFleetCount: activeMappedCargoFleetKeys.size,
    cargoRowCount: cargo.length,
    totalMined,
    totalMiningRevenueAtlas: totalMiningRevenueCount > 0 ? totalMiningRevenueAtlas : null,
    todayMined: todayMiningTotals.mined,
    averageMinedPerDay,
    todayMiningRevenueAtlas: todayMiningTotals.revenueCount > 0 ? todayMiningTotals.revenueAtlas : null,
    averageMiningRevenueAtlasPerDay,
    topMiningNetProfitFleetToday,
    fleets: fleetRows,
    rows,
    miningRows: mining,
    cargoRows: cargo,
  };
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
ipcMain.handle('earnings:snapshot', async (_event, payload) => {
  try {
    return await fetchEarningsSnapshot(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'earnings_snapshot_failed'),
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
ipcMain.handle('pcr:daily', async (_event, payload) => {
  try {
    return await fetchPcrCharts(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'pcr_daily_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});

ipcMain.handle('inventory:daily', async (_event, payload) => {
  try {
    return await fetchInventory(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'inventory_daily_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});

app.whenReady().then(async () => {
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
