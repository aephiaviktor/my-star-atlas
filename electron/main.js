const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { Connection, PublicKey } = require('@solana/web3.js');
const { BorshAccountsCoder } = require('@staratlas/anchor');
const { IDL: SAGE_IDL } = require('@staratlas/sage/dist/src/idl/sage');
const { getOpenOrdersForPlayer } = require('@staratlas/factory');
const bs58Module = require('bs58');
const { RpcLimiter, resolvePaths: resolveRpcLimiterPaths } = require('rpc_limiter');
const {
  readState: readRpcLimiterState,
  writeStateSync: writeRpcLimiterStateSync,
  bumpRevision: bumpRpcLimiterRevision,
} = require('rpc_limiter/dist/state');
const lockfile = require('proper-lockfile');
const packageJson = require('../package.json');
const { createAsyncTtlCache, fetchWithInfluxRetry } = require('./influx-resilience');
const { queryCargoRowsWithWindowFallback } = require('./cargo-influx-window-recovery');
const { excludeSelfReferentialCraftingEvents } = require('./crafting-event-integrity');
const { averageRecordedCrew } = require('./crafting-crew-average');
const { removeUpgradeMirroredCraftingEvents } = require('./crafting-upgrade-dedup');
const { buildFactionCustodyLedgerEvents } = require('./cross-faction-basis-handoff');
const { assertTrustedSender, validateIpcPayload } = require('./ipc-security');
const { writeJsonAtomic } = require('./atomic-json');
const { createEarningsErrorDiagnostic } = require('./earnings-error-diagnostic');
const { createSecureSettingsStore } = require('./secure-settings');
const { createRpcFetcher } = require('./rpc-resilience');
const { calculateUpgradingSelectionUtilization } = require('./upgrading-selection-utilization');
const { createTelemetryLedger } = require('./telemetry-ledger');
const { createRpcUsageReader } = require('./telemetry-day-summary');
const {
  normalizeContext: normalizeTelemetryContext,
  setTelemetryRecorder,
  runFeature,
  runLogicalOperation,
  runWithTelemetryContext,
  recordTelemetryCounter,
} = require('./telemetry-context');
const { createTelemetryFetch, wrapRpcConnection, rawAttemptHooks } = require('./telemetry-rpc-fetch');
const { dependencyInstallRequired } = require('./update-dependencies');
const { parseInfluxCsv, isCargoCycleId, cargoFleetAccountFromCycleId, groupCargoAllocationRows, enrichCargoAllocationRows, buildCargoAllocationRecords, mergeCargoRowsWithCompletedAllocations } = require('./influx-data');
const { buildCargoAllocationPivotFlux, createCargoAllocationSource } = require('./cargo-allocation-source');
const { registerCargoAllocationIpc } = require('./cargo-allocation-ipc');
const { createCargoAllocationProjector } = require('./cargo-allocation-projector');
const { calculateFleetCargoCapacity, calculateCargoEfficiency, cargoVolumeRangeStart, buildCargoVolumeRows, buildCargoVolumeByFleetDay, filterCargoAllocationsToCompletedCycles, calculateTravelModeTime } = require('./earnings-math');
const {
  CURRENT_RENTAL_OFFSETS,
  decodeCurrentContract,
  decodeCurrentRental,
  decodeLegacyContract,
  decodeLegacyRental,
  matchActiveRental,
} = require('./rental-state');
const {
  buildRentalHistoryFluxQuery,
  projectRentalHistoryRows,
  createRentalHistoryIndex,
  resolveHistoricalRental,
  applyVerifiedFleetCrew,
} = require('./rental-history');
const { buildCostLedgerResult } = require('./production-ledger-events');
const { buildCurrentInventoryCraftingBasisByDay, enrichCraftingEarningsRows } = require('./crafting-cost-basis');
const { loadLedgerCheckpoint, saveLedgerCheckpoint } = require('./ledger-checkpoint');
const { publishInventoryBasisSnapshots } = require('./inventory-basis-publication');
const { readInventoryBasisSnapshots } = require('./inventory-basis-read');
const { buildLedgerBreakevenRows } = require('./ledger-breakeven');
const { createAtlasPriceResolver } = require('./atlas-price-resolver');
const { buildCargoCostPool, mergeCargoCostPools } = require('./cargo-cost-pool');
const {
  RAW_COST_CUTOVER_MANIFEST_VERSION, buildRawCostFluxQuery, projectRawCostEvents,
  selectLegacyRawCutover, exporterForFaction, aggregateRawCostsByFleetDay,
  applyRawCostsToCargoAllocations, valueCanonicalRawCosts, buildCanonicalRawCostPool,
  valueNativeCost, requireSameDateCargoPrice, requireCargoFuelPrice,
} = require('./cargo-cost-source');
const { projectCargoTableRow, joinCanonicalCostsWithOperationalRows, selectCutoverOwnedCargoRows, projectCargoFleetDateRows, cargoCostSourceSelectionStats } = require('./cargo-table-projection');
const { scanLocalMarketTrades, decodeLocalMarketOrder, decodeOrderExecution } = require('./local-market-scanner');
const { createMarketplaceTransactionCacheConnection } = require('./marketplace-transaction-cache');
const { decodeMarketplaceAssetFlows, formatAssetFlowInfluxLine, projectAssetFlowInfluxRows, selectFactionAssetFlows } = require('./marketplace-asset-flow');
const {
  CSS_STARBASE_NAMES,
  deriveCssStarbasePlayer,
  discoverPlayerTokenAccounts,
  scanMarketplaceRawData,
  buildLmRawRecords,
  formatRawTransactionInfluxLine,
} = require('./marketplace-rawdata');
const {
  formatMarketplaceEventInfluxLine, deriveCustodyEventsFromRawRows, enrichMarketplaceEventsWithTransactionFees,
} = require('./marketplace-events');
const { filterLegacyMarketplaceInfluxLines } = require('./marketplace-write-policy');
const {
  MARKETPLACE_FACTION_MEASUREMENT,
  MARKETPLACE_HISTORY_CUTOVER_ISO,
  enrichGmTradesWithInventoryBasis,
  buildGmWalletUniverse,
  projectGmFactionMarketplaceRows,
  formatGmFactionMarketplaceV2Line,
} = require('./gm-marketplace-accounting');
const {
  normalizeMarketplaceV2Row,
  deriveMarketplaceUnionKey,
  dedupeMarketplaceRows,
} = require('./marketplace-trade-compat');
const { deriveMarketplaceTradeId } = require('./marketplace-v2-point');
const {
  loadMarketplacePublicationHolds,
  recordMarketplacePublicationHold,
  updateMarketplacePublicationHold,
  resolveMarketplaceDiscoveryCursors,
  completeMarketplacePublicationHold,
} = require('./marketplace-publication-checkpoint');
const { createMarketplacePublicationCoordinator } = require(['./marketplace', 'publication', 'coordinator'].join('-'));
const { loadMarketplaceOutboxV2 } = require(['./marketplace', 'outbox-v2'].join('-'));
const { STARBASE_REGISTRY } = require('./starbase-registry');
const { ASSET_REGISTRY } = require('./asset-registry');
const {
  createMarketplaceRpcTelemetry,
  createMarketplaceRpcInstrumentation,
  wrapMarketplaceConnection,
  createMarketplaceRpcAttemptBudget,
  isMarketplaceRpcBudgetExhaustedError,
  DEFAULT_MARKETPLACE_RPC_ATTEMPT_LIMIT,
} = require('./marketplace-rpc-telemetry');

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
const earningsErrorDiagnostic = createEarningsErrorDiagnostic({
  filePath: path.join(app.getPath('userData'), 'latest-earnings-error.json'),
  appVersion: packageJson.version,
  writeAtomic: writeJsonAtomic,
});
const earningsRendererErrorDiagnostic = createEarningsErrorDiagnostic({
  filePath: path.join(app.getPath('userData'), 'latest-earnings-renderer-error.json'),
  appVersion: packageJson.version,
  writeAtomic: writeJsonAtomic,
});
const earningsDiagnosticContexts = new Map();
const telemetryLedger = createTelemetryLedger({ userDataPath: app.getPath('userData'), profile: profileName });
const getRpcUsageDay = createRpcUsageReader({ ledger: telemetryLedger, userDataPath: app.getPath('userData') });
const atlasPriceResolver = createAtlasPriceResolver({
  filePath: path.join(app.getPath('userData'), 'price-history', 'current-price-seeds-v1.json'),
});
setTelemetryRecorder(telemetryLedger);
app.setName(`My Star Atlas - ${profileName}`);
if (typeof app.setDesktopName === 'function') {
  app.setDesktopName(`my-star-atlas-${profileName}.desktop`);
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

// Disable Chromium background throttling. My Star Atlas is a 24/7
// automation process and must remain responsive even when its window
// is covered, minimized, or otherwise inactive on Windows.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

const defaultSettings = Object.freeze({
  aephiaApiKey: '',
  playerProfile: '',
  playerProfiles: Object.freeze({
    MUD: '',
    ONI: '',
    USTUR: '',
  }),
  gmTradingWallets: '',
  faction: 'USTUR',
  influxUrl: '',
  influxAuthToken: '',
  influxBucket: '',
  influxOptimizationBucket: 'optimization',
  useRpcLimiter: false,
  rpcUrl: '',
  rpcRequestsPerSecond: '5',
});

const SECRET_SETTING_KEYS = Object.freeze(['aephiaApiKey', 'influxAuthToken', 'rpcUrl']);
let secureSettingsStore = null;
let mainWindow = null;
const influxOrgIdCache = new Map();
const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';
const AEPHIA_RESOURCE_URL = 'https://get-ship-data.aephia.workers.dev/gm/resource';
const AEPHIA_TOKEN_SERIES_BASE_URL = 'https://get-ship-data.aephia.workers.dev/series/token';
const AEPHIA_PRICE_SERIES_URL = 'https://get-ship-data.aephia.workers.dev/series';
const AEPHIA_LP_SUMMARY_URL = 'https://store-sage-lp.aephia.workers.dev/summary';
const GITHUB_REPO = 'aephiaviktor/my-star-atlas';
const GITHUB_BRANCH = 'master';
const GITHUB_PACKAGE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/package.json`;
const GITHUB_ARCHIVE_URL = `https://github.com/${GITHUB_REPO}/archive/refs/heads/${GITHUB_BRANCH}.tar.gz`;
const RESTART_TASK_NAME = 'My Star Atlas';
const UPGRADE_ATLAS_POOLS = Object.freeze({ MUD: 1991250, ONI: 2000000, USTUR: 2000000 });
const UPGRADE_LP_BY_COMPONENT = Object.freeze({ framework: 68, electronics: 92, 'power source': 98, electromagnet: 133, 'field stabilizer': 222, 'particle accelerator': 498, 'radiation absorber': 331, 'survey data unit': 1325, sdu: 1325, ink: 100000 });
const POINTS_STORE_PROGRAM_ID = new PublicKey('PsToRxhEPScGt1Bxpm7zNDRzaMk31t8Aox7fyewoVse');
const POINTS_STORE_REDEMPTION_CONFIG_DISCRIMINATOR = Buffer.from([173, 1, 86, 47, 27, 204, 146, 185]);
const POINTS_STORE_REDEMPTION_CONFIG_FACTION_OFFSET = 73;
const POINTS_STORE_FACTION_VALUES = Object.freeze({ MUD: 1, ONI: 2, USTUR: 3 });
const JUPITER_PRICE_URL = 'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112,ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const ATLAS_MINT = 'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx';
const SES_SHIP_STATS_URL = 'https://ses.staratlas.com/tools/ship-stats/engine/data/sot.js';
const SAGE_PROGRAM_ID = new PublicKey('SAGE2HAwep459SNq61LHvjxPk4pLPEJLoMETef7f7EE');
const GM_PROGRAM_ID = new PublicKey('traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg');
const MARKETPLACE_RAWDATA_CUTOVER_ISO = '2026-08-30T12:00:22.000Z';
const MARKETPLACE_RAWDATA_CUTOVER_SLOT = 442873938;
const PLAYER_PROFILE_PROGRAM_ID = new PublicKey('pprofELXjL5Kck7Jn5hCpwAL82DpTkSYBENzahVtbc9');
const SAGE_GAME_ID = new PublicKey('GAMEzqJehF8yAnKiTARUuhZMvLvkZVAsCVri5vSfemLr');
const SRSLY_PROGRAM_ID = new PublicKey('SRSLYxcFnjd5jG2DpJw4as6UEyjwJQK1U4J1TD1hvZH');
const LEGACY_SRSLY_PROGRAM_ID = new PublicKey('SRSLY1fq9TJqCk1gNSE7VZL2bztvTn9wm4VR8u8jMKT');
const DEFAULT_PUBLIC_KEY = PublicKey.default.toBase58();
const FLEET_ACCOUNT_DISCRIMINATOR = bs58.encode(BorshAccountsCoder.accountDiscriminator('fleet'));
const factionInfluxAliases = Object.freeze({
  MUD: {
    faction: ['MUD'],
    instance: ['MUD', 'MUD2'],
  },
  ONI: {
    faction: ['ONI'],
    instance: ['ONI', 'ONI2'],
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
const aephiaPriceSeriesCache = new Map();
let aephiaLpSummaryCache = null;
let tokenPriceCache = null;
const aephiaTokenSeriesCache = new Map();
let shipStatsCache = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function ledgerCheckpointPath(faction) {
  return path.join(app.getPath('userData'), 'inventory-cost-ledger', `${sanitizeProfileName(faction)}.json`);
}

function localMarketCheckpointPath(faction) {
  return path.join(app.getPath('userData'), 'local-market-trades', `${sanitizeProfileName(faction)}.json`);
}

function globalMarketCheckpointPath() {
  return path.join(app.getPath('userData'), 'local-market-trades', 'GLOBAL-GM.json');
}

function marketplaceRawDataCheckpointPath() {
  // Shared by every MSA profile so MUD/ONI/USTUR processes cannot each
  // replay the same GM, CSS, and token-account history.
  return path.join(baseUserData, 'marketplace-rawdata', 'checkpoint.json');
}

function normalizeFaction(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'MUD' || normalized === 'ONI' || normalized === 'USTUR') {
    return normalized;
  }
  return 'USTUR';
}

function getAppRoot() {
  return path.resolve(__dirname, '..');
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return 1;
    if ((left[index] || 0) < (right[index] || 0)) return -1;
  }
  return 0;
}

async function getLatestGithubVersion() {
  const response = await fetch(`${GITHUB_PACKAGE_URL}?t=${Date.now()}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'Cache-Control': 'no-cache',
      'User-Agent': 'my-star-atlas-updater',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`GitHub request failed: HTTP ${response.status}`);
  const remotePackage = await response.json();
  const version = normalizeVersion(remotePackage?.version);
  if (!version) throw new Error(`No package version found on GitHub ${GITHUB_BRANCH}.`);
  return { version, branch: GITHUB_BRANCH, tarballUrl: GITHUB_ARCHIVE_URL };
}

async function checkForUpdates() {
  const currentVersion = normalizeVersion(packageJson.version);
  const latest = await getLatestGithubVersion();
  return {
    currentVersion,
    latestVersion: latest.version,
    updateAvailable: compareVersions(latest.version, currentVersion) > 0,
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || getAppRoot(),
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}: ${output.slice(-2000)}`));
    });
  });
}

async function downloadUpdateAndRestart() {
  const latest = await getLatestGithubVersion();
  const currentVersion = normalizeVersion(packageJson.version);
  if (compareVersions(latest.version, currentVersion) <= 0) {
    return { updated: false, currentVersion, latestVersion: latest.version };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-star-atlas-update-'));
  const archivePath = path.join(tempDir, `${latest.branch}.tar.gz`);
  const response = await fetch(latest.tarballUrl, {
    headers: { 'User-Agent': 'my-star-atlas-updater' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Update download failed: HTTP ${response.status}`);
  await fs.writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  await runCommand('tar', ['-xzf', archivePath, '-C', tempDir], { cwd: tempDir });

  const entries = await fs.readdir(tempDir, { withFileTypes: true });
  const extracted = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('my-star-atlas-'));
  if (!extracted) throw new Error('Downloaded update archive did not contain the expected project folder.');
  const extractedRoot = path.join(tempDir, extracted.name);
  const currentLockText = await fs.readFile(path.join(getAppRoot(), 'package-lock.json'), 'utf8').catch(() => null);
  const nextLockText = await fs.readFile(path.join(extractedRoot, 'package-lock.json'), 'utf8').catch(() => null);
  const shouldInstallDependencies = dependencyInstallRequired(currentLockText, nextLockText);
  await fs.cp(extractedRoot, getAppRoot(), {
    recursive: true,
    force: true,
    filter: (source) => {
      const relative = path.relative(extractedRoot, source);
      return !relative.startsWith('.git') && !relative.startsWith('node_modules') && !relative.startsWith('analysis');
    },
  });
  if (shouldInstallDependencies) {
    await runCommand('npm', ['install'], { cwd: getAppRoot() });
  }

  const restartHelper = spawn(process.execPath, [
    path.join(__dirname, 'restart-helper.js'),
    String(process.pid),
    RESTART_TASK_NAME,
    'My Star Atlas',
    latest.version,
    getAppRoot(),
    path.join(__dirname, 'restart-status.ps1'),
    path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'MyStarAtlas', 'logs', 'supervisor.log'),
  ], {
    cwd: getAppRoot(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  restartHelper.unref();
  app.exit(0);
  return { updated: true, currentVersion, latestVersion: latest.version };
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
    gmTradingWallets: String(payload.gmTradingWallets ?? ''),
    faction,
    influxUrl: String(payload.influxUrl ?? ''),
    influxAuthToken: String(payload.influxAuthToken ?? ''),
    influxBucket: String(payload.influxBucket ?? ''),
    influxOptimizationBucket: String(payload.influxOptimizationBucket ?? 'optimization').trim() || 'optimization',
    useRpcLimiter: Boolean(payload.useRpcLimiter),
    rpcUrl: String(payload.rpcUrl ?? ''),
    rpcRequestsPerSecond: String(payload.rpcRequestsPerSecond ?? defaultSettings.rpcRequestsPerSecond),
  };
}

async function readSettings() {
  let storedSettings = {};
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    storedSettings = JSON.parse(raw);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error('[MyStarAtlas] Failed to read settings:', error);
    }
  }

  const secureStore = getSecureSettingsStore();
  let secureValues = await secureStore.read();
  const plaintextMigration = {};
  for (const key of SECRET_SETTING_KEYS) {
    if (!secureValues[key] && String(storedSettings[key] || '').trim()) {
      plaintextMigration[key] = storedSettings[key];
    }
  }
  if (Object.keys(plaintextMigration).length) {
    secureValues = await secureStore.update(plaintextMigration);
  }

  let scrubbedPlaintext = false;
  for (const key of SECRET_SETTING_KEYS) {
    if (Object.hasOwn(storedSettings, key)) {
      delete storedSettings[key];
      scrubbedPlaintext = true;
    }
  }
  if (scrubbedPlaintext) await writeJsonAtomic(settingsPath(), storedSettings);

  return normalizeSettings({ ...storedSettings, ...secureValues });
}

async function writeSettings(payload) {
  const current = await readSettings();
  const incoming = normalizeSettings({ ...current, ...payload });
  await getSecureSettingsStore().update(Object.fromEntries(
    SECRET_SETTING_KEYS.map((key) => [key, payload?.[key] ?? ''])
  ));
  const publicSettings = { ...incoming };
  for (const key of SECRET_SETTING_KEYS) delete publicSettings[key];
  await writeJsonAtomic(settingsPath(), publicSettings);
  return readSettings();
}

function secureSettingsPath() {
  return path.join(app.getPath('userData'), 'secure-settings.json');
}

function getSecureSettingsStore() {
  if (secureSettingsStore) return secureSettingsStore;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS safe storage is unavailable; sensitive settings were not loaded.');
  }
  secureSettingsStore = createSecureSettingsStore({
    filePath: secureSettingsPath(),
    encryptString: async (value) => safeStorage.encryptString(value),
    decryptString: async (value) => safeStorage.decryptString(value),
  });
  return secureSettingsStore;
}

function redactSettings(settings) {
  const redacted = { ...settings, secureSettingsStatus: {} };
  for (const key of SECRET_SETTING_KEYS) {
    redacted.secureSettingsStatus[key] = Boolean(settings[key]);
    redacted[key] = '';
  }
  return redacted;
}

async function hydrateSecureSettings(payload = {}) {
  const current = await readSettings();
  const hydrated = { ...payload };
  for (const key of SECRET_SETTING_KEYS) {
    if (!String(hydrated[key] || '').trim()) hydrated[key] = current[key];
  }
  return hydrated;
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

async function queryInfluxFlux(settings, flux) {
  const influxUrl = String(settings.influxUrl || '').trim();
  const token = String(settings.influxAuthToken || '').trim().replace(/^Token\s+/i, '').replace(/^Bearer\s+/i, '');
  const bucket = String(settings.influxBucket || '').trim();
  if (!influxUrl || !token || !bucket) {
    throw new Error('influx_not_configured');
  }

  const orgId = await resolveInfluxOrgId(influxUrl, token, bucket);
  const url = `${getInfluxBaseUrl(influxUrl)}/api/v2/query?org=${encodeURIComponent(orgId)}`;
  const response = await fetchWithInfluxRetry(
    ({ signal }) => fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/csv',
        'Content-Type': 'application/vnd.flux',
        Authorization: `Token ${token}`,
      },
      body: flux,
      signal,
    }),
    { timeoutMs: 15_000, retries: 1, retryDelayMs: 250 }
  );

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

function marketplaceScopeFlux(faction, profile) {
  return `r.faction == "${escapeFluxString(faction)}" and (not exists r.profile or r.profile == "${escapeFluxString(profileName)}" or r.profile == "${escapeFluxString(profile)}")`;
}

function parseMarketplaceSignatureList(value, fallback = '') {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return Array.from(new Set(parsed.map(String).filter(Boolean)));
  } catch {}
  return fallback ? [String(fallback)] : [];
}

function normalizeFactionGmMarketplaceRow(row) {
  const quantity = Number(row?.quantity);
  const timestamp = String(row?._time || '');
  const id = String(row?.eventId || '');
  if (!id || !Number.isFinite(Date.parse(timestamp)) || !(quantity > 0)) return null;
  const basisAvailable = String(row?.basisAvailable ?? 'true').toLowerCase() !== 'false';
  return {
    id, timestamp, marketplace: 'GM', market: 'GM', side: String(row.side || '').toLowerCase(),
    faction: String(row.faction || ''), profile: String(row.profile || ''),
    asset: String(row.asset || ''), rawMint: String(row.rawMint || ''), starbase: String(row.starbase || ''),
    wallet: String(row.wallet || ''), quantity,
    basisAvailable, unitPriceAtlas: basisAvailable ? Number(row.unitPriceAtlas || 0) : null,
    grossAtlas: basisAvailable ? Number(row.grossAtlas || 0) : null,
    marketplaceFeeAtlas: Number(row.marketplaceFeeAtlas || 0), txFeeAtlas: Number(row.txFeeAtlas || 0),
    netAtlas: basisAvailable ? Number(row.netAtlas || 0) : null,
    settledAtlas: basisAvailable ? Number(row.settledAtlas || 0) : null,
    custodySignatures: parseMarketplaceSignatureList(row.custodySignatures, row.custodySignature),
    executionSignatures: parseMarketplaceSignatureList(row.executionSignatures, row.executionSignature),
    orderIds: parseMarketplaceSignatureList(row.orderIds, row.orderId),
    signature: String(row.custodySignature || row.executionSignature || ''), orderId: String(row.orderId || ''),
    projectionVersion: Number(row.projectionVersion || 1),
  };
}

async function fetchNewestMarketplaceTradeMs(settings) {
  const bucket = String(settings.influxBucket || '').trim();
  const profile = getSelectedPlayerProfile(settings);
  if (!bucket || !profile) return null;
  const faction = normalizeFaction(settings.faction);
  const scope = marketplaceScopeFlux(faction, profile);
  const flux = `from(bucket: "${escapeFluxString(bucket)}")
  |> range(start: -40d)
  |> filter(fn: (r) => r._measurement == "marketplace_v2" and (r._field == "fallbackQuantity" or r._field == "enrichedQuantity"))
  |> filter(fn: (r) => ${scope})
  |> group()
  |> sort(columns: ["_time"], desc: false)
  |> last(column: "_time")
  |> keep(columns: ["_time"])`;
  const rows = parseInfluxCsv(await queryInfluxFlux(settings, flux));
  let newest = null;
  for (const row of rows) {
    const ms = Date.parse(String(row?._time || ''));
    if (Number.isFinite(ms) && (newest === null || ms > newest)) newest = ms;
  }
  return newest;
}

async function fetchMarketplaceTradesFromInflux(settings) {
  const bucket = String(settings.influxBucket || '').trim();
  const profile = getSelectedPlayerProfile(settings);
  if (!bucket || !profile) return { trades: [], error: profile ? 'influx_not_configured' : 'local_market_profile_not_configured' };
  const faction = normalizeFaction(settings.faction);
  const scope = marketplaceScopeFlux(faction, profile);
  const v2Flux = `from(bucket: "${escapeFluxString(bucket)}")
  |> range(start: time(v: "${MARKETPLACE_HISTORY_CUTOVER_ISO}"))
  |> filter(fn: (r) => r._measurement == "marketplace_v2")
  |> filter(fn: (r) => ${scope})
  |> pivot(rowKey: ["_time", "market", "faction", "profile", "executionSignature", "rawMint", "side", "tradeId"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"], desc: true)`;
  const factionGmFlux = `from(bucket: "${escapeFluxString(bucket)}")
  |> range(start: time(v: "${MARKETPLACE_HISTORY_CUTOVER_ISO}"))
  |> filter(fn: (r) => r._measurement == "${MARKETPLACE_FACTION_MEASUREMENT}")
  |> filter(fn: (r) => r.faction == "${escapeFluxString(faction)}")
  |> pivot(rowKey: ["_time", "eventId", "market", "faction", "profile", "side", "asset", "rawMint", "starbase"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"], desc: true)`;
  try {
    const [v2Result, factionGmResult] = await Promise.all([
      queryInfluxFlux(settings, v2Flux),
      queryInfluxFlux(settings, factionGmFlux),
    ]);
    const context = { applicationProfile: profileName, selectedProfile: profile, faction, scopeProven: true };
    const trades = dedupeMarketplaceRows([
      ...parseInfluxCsv(v2Result).map((row) => normalizeMarketplaceV2Row(row, context)).filter(Boolean),
      ...parseInfluxCsv(factionGmResult).map(normalizeFactionGmMarketplaceRow).filter(Boolean),
    ]);
    trades.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || deriveMarketplaceUnionKey(a).localeCompare(deriveMarketplaceUnionKey(b)));
    return { trades, error: '' };
  } catch (error) {
    return { trades: [], error: String(error?.message || error || 'marketplace_influx_unavailable') };
  }
}

async function fetchMarketplaceAssetFlowsFromInflux(settings) {
  const bucket = String(settings.influxBucket || '').trim();
  if (!bucket) return [];
  const faction = normalizeFaction(settings.faction);
  const flux = `from(bucket: "${escapeFluxString(bucket)}")
  |> range(start: -40d)
  |> filter(fn: (r) => r._measurement == "asset_flow")
  |> pivot(rowKey: ["_time", "flowId"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])`;
  const flows = projectAssetFlowInfluxRows(parseInfluxCsv(await queryInfluxFlux(settings, flux)));
  return selectFactionAssetFlows(flows, faction);
}

async function fetchMarketplaceRawDataFromInflux(settings) {
  const bucket = String(settings.influxBucket || '').trim();
  if (!bucket) return { rows: [], error: '' };
  const flux = `from(bucket: "${escapeFluxString(bucket)}")
  |> range(start: time(v: "${MARKETPLACE_RAWDATA_CUTOVER_ISO}"))
  |> filter(fn: (r) => r._measurement == "marketplace_rawdata")
  |> filter(fn: (r) => r.record == "transaction")
  |> filter(fn: (r) => r.discoverySource == "gm_wallet" or r.discoverySource == "lm_scanner" or r.discoverySource == "css_account" or r.discoverySource == "token_account" or r.discoverySource == "multiple")
  |> filter(fn: (r) => r._field == "slot" or r._field == "success" or r._field == "payloadHash" or r._field == "payload")
  |> pivot(rowKey: ["_time", "record", "signature", "eventId", "discoverySource"], columnKey: ["_field"], valueColumn: "_value")
  |> filter(fn: (r) => exists r.slot and r.slot >= ${MARKETPLACE_RAWDATA_CUTOVER_SLOT})
  |> sort(columns: ["_time"], desc: true)`;
  try {
    const rawRows = parseInfluxCsv(await queryInfluxFlux(settings, flux)).map((row) => {
      let payload = null;
      try { payload = row.payload ? JSON.parse(row.payload) : null; } catch (_error) { payload = null; }
      const signature = String(row.signature || payload?.signature || payload?.transaction?.signatures?.[0] || '');
      return {
        timestamp: String(row._time || ''), discoverySource: String(row.discoverySource || ''), signature,
        slot: Number.isFinite(Number(row.slot)) ? Number(row.slot) : null,
        success: row.success === true || String(row.success).toLowerCase() === 'true',
        discoveredBy: String(row.discoveredBy || ''),
        payloadHash: String(row.payloadHash || '') || (row.payload ? crypto.createHash('sha256').update(String(row.payload)).digest('hex') : ''),
        payload,
      };
    });
    const rows = [];
    const transactionIndex = new Map();
    for (const row of rawRows) {
      const existingIndex = transactionIndex.get(row.signature);
      if (existingIndex != null) {
        if (rows[existingIndex].discoverySource === 'legacy_unknown' && row.discoverySource !== 'legacy_unknown') rows[existingIndex] = row;
        continue;
      }
      transactionIndex.set(row.signature, rows.length);
      rows.push(row);
    }
    return { rows, error: '' };
  } catch (error) {
    return { rows: [], error: String(error?.message || error || 'marketplace_rawdata_influx_unavailable') };
  }
}

async function fetchMarketplaceEventsFromInflux(settings) {
  const bucket = String(settings.influxBucket || '').trim();
  if (!bucket) return { rows: [], error: '' };
  const flux = `from(bucket: "${escapeFluxString(bucket)}")
  |> range(start: time(v: "${MARKETPLACE_RAWDATA_CUTOVER_ISO}"))
  |> filter(fn: (r) => r._measurement == "marketplace_events")
  |> filter(fn: (r) => r.eventType == "deposit" or r.eventType == "withdraw" or r.eventType == "transfer" or r.eventType == "lm" or r.eventType == "gm")
  |> filter(fn: (r) => r._field == "payload" or r._field == "payloadHash")
  |> pivot(rowKey: ["_time", "eventType", "eventId", "signature"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"], desc: true)`;
  try {
    const rows = parseInfluxCsv(await queryInfluxFlux(settings, flux)).map((row) => {
      let payload = null;
      try { payload = JSON.parse(String(row.payload || '')); } catch (_error) { payload = null; }
      return {
        ...(payload && typeof payload === 'object' ? payload : {}),
        timestamp: String(row._time || ''), eventType: String(row.eventType || payload?.eventType || ''),
        eventId: String(row.eventId || payload?.eventId || ''), signature: String(row.signature || payload?.signature || ''),
        payloadHash: String(row.payloadHash || ''),
      };
    }).filter((row) => row.eventId && row.signature);
    return { rows, error: '' };
  } catch (error) {
    return { rows: [], error: marketplacePublicationErrorCode(error?.message, 'marketplace_events_read_failed') };
  }
}

async function resolveInfluxOrgId(influxUrl, token, bucket) {
  const baseUrl = getInfluxBaseUrl(influxUrl);
  const cacheKey = `${baseUrl}\n${token}\n${bucket}`;
  if (influxOrgIdCache.has(cacheKey)) return influxOrgIdCache.get(cacheKey);

  const lookup = (async () => {
    const url = `${baseUrl}/api/v2/buckets?name=${encodeURIComponent(bucket)}`;
    const response = await fetchWithInfluxRetry(
      ({ signal }) => fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Token ${token}`,
        },
        signal,
      }),
      { timeoutMs: 15_000, retries: 1, retryDelayMs: 250 }
    );
    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch (_error) {
        detail = '';
      }
      throw new Error(`influx_bucket_lookup_${response.status}${detail ? `:${detail.slice(0, 300)}` : ''}`);
    }

    const payload = await response.json();
    const matches = (Array.isArray(payload?.buckets) ? payload.buckets : [])
      .filter((entry) => String(entry?.name || '') === bucket && entry?.orgID);
    if (matches.length === 0) throw new Error(`influx_bucket_not_found:${bucket}`);
    const orgIds = Array.from(new Set(matches.map((entry) => String(entry.orgID))));
    if (orgIds.length !== 1) throw new Error(`influx_bucket_ambiguous:${bucket}`);
    return orgIds[0];
  })();

  influxOrgIdCache.set(cacheKey, lookup);
  try {
    return await lookup;
  } catch (error) {
    influxOrgIdCache.delete(cacheKey);
    throw error;
  }
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

const OPTIMIZATION_SCANNING_START = '2026-07-25T08:13:52.240Z';

function normalizeOptimizationFaction(faction) {
  return normalizeFaction(faction) === 'USTUR' ? 'UST' : normalizeFaction(faction);
}

function cleanOptimizationRow(row) {
  const cleaned = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!key || ['result', 'table', '_start', '_stop', '_measurement'].includes(key)) continue;
    cleaned[key === '_time' ? 'time' : key.replace(/^_/, '')] = value;
  }
  return cleaned;
}

async function fetchScanningOptimization(payload = {}) {
  const settings = await readSettings();
  const bucket = String(settings.influxOptimizationBucket || 'optimization').trim();
  const querySettings = { ...settings, influxBucket: bucket };
  const faction = normalizeOptimizationFaction(payload.faction || settings.faction);
  const baselineStartMs = Date.parse(OPTIMIZATION_SCANNING_START);
  const requestedStartMs = Date.parse(String(payload.start || ''));
  const start = new Date(Math.max(baselineStartMs, Number.isFinite(requestedStartMs) ? requestedStartMs : baselineStartMs)).toISOString();
  const requestedStopMs = Date.parse(String(payload.stop || ''));
  const stop = Number.isFinite(requestedStopMs) && requestedStopMs > Date.parse(start) ? new Date(requestedStopMs).toISOString() : '';
  const offset = Math.max(0, Number.parseInt(payload.offset, 10) || 0);
  const pageSizeCap = payload.analytics === true ? 5000 : 500;
  const pageSize = Math.min(pageSizeCap, Math.max(1, Number.parseInt(payload.limit, 10) || 500));
  const filters = [
    `r._measurement == "optimization_event"`,
    `r.optimization_type == "scanning"`,
    `r.faction == "${escapeFluxString(faction)}"`,
  ];
  for (const [field, value] of [['fleet', payload.fleet], ['event_type', payload.eventType], ['operation', payload.operation]]) {
    if (value && value !== '__all__') filters.push(`r.${field} == "${escapeFluxString(value)}"`);
  }
  const experimentFilter = payload.experimentId && payload.experimentId !== '__all__'
    ? `\n  |> filter(fn: (r) => r.experimentId == "${escapeFluxString(payload.experimentId)}")`
    : '';
  const parameterFilter = payload.optimizationParameter && payload.optimizationParameter !== '__all__'
    ? `\n  |> filter(fn: (r) => r.optimizationParameter == "${escapeFluxString(payload.optimizationParameter)}")`
    : '';
  const range = stop ? `range(start: time(v: "${escapeFluxString(start)}"), stop: time(v: "${escapeFluxString(stop)}"))` : `range(start: time(v: "${escapeFluxString(start)}"))`;
  const flux = `from(bucket: "${escapeFluxString(bucket)}")
  |> ${range}
  |> filter(fn: (r) => ${filters.join(' and ')})
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")${experimentFilter}${parameterFilter}
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: ${pageSize + 1}, offset: ${offset})`;
  const parsed = parseInfluxCsv(await queryInfluxFlux(querySettings, flux)).map(cleanOptimizationRow);
  const rows = parsed.slice(0, pageSize);
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const prices = payload.analytics === true
    ? await fetchCurrentEarningsPrices().then((value) => ({
      ...value,
      checkedAt: new Date().toISOString(),
      resourcePriceSource: 'Aephia /gm/resource pricingATL.priceATL',
    })).catch(() => null)
    : null;
  return {
    ok: true,
    rows,
    columns,
    prices,
    hasMore: parsed.length > pageSize,
    offset,
    bucket,
    start,
    checkedAt: new Date().toISOString(),
  };
}

const OPTIMIZATION_UPGRADING_START = '2026-07-25T12:50:00.000Z';
const OPTIMIZATION_UPGRADING_COMPONENT_KEYS = Object.freeze({
  Framework: 'framework', Electronics: 'electronics', 'Power Source': 'power_source',
  Electromagnet: 'electromagnet', 'Field Stabilizer': 'field_stabilizer',
  'Particle Accelerator': 'particle_accelerator', 'Radiation Absorber': 'radiation_absorber',
  'Survey Data Unit': 'survey_data_unit',
});

function mergeUpgradingOptimizationRows(aggregateRows, componentRows) {
  const byTime = new Map((aggregateRows || []).map((row) => [String(row._time || row.time || ''), cleanOptimizationRow(row)]));
  for (const row of (componentRows || [])) {
    const time = String(row._time || row.time || '');
    const target = byTime.get(time);
    const key = OPTIMIZATION_UPGRADING_COMPONENT_KEYS[String(row.component || '')];
    if (!target || !key) continue;
    target[`${key}_installed`] = Number(row.installed_today || 0);
    target[`${key}_installed_lp`] = Number(row.installed_lp_today || 0);
  }
  return [...byTime.values()];
}

// The Points Store RedemptionConfig keeps the exact daily redemption pool:
// total_tokens / total_points is the on-chain ATLAS value of one LP.
// The decoder repository documents this account layout and its remaining
// RedemptionEpoch list; keep the small read-only parser local so the renderer
// receives plain JSON rather than a second decoder dependency.
async function fetchPointsStoreRedemptionRates(settings, faction) {
  const factionValue = POINTS_STORE_FACTION_VALUES[normalizeFaction(faction)];
  if (!factionValue) return [];
  try {
    const connection = createSolanaConnection(settings);
    const accounts = await connection.getProgramAccounts(POINTS_STORE_PROGRAM_ID, {
      commitment: 'confirmed',
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(POINTS_STORE_REDEMPTION_CONFIG_DISCRIMINATOR) } },
        { memcmp: { offset: POINTS_STORE_REDEMPTION_CONFIG_FACTION_OFFSET, bytes: bs58.encode(Buffer.from([factionValue])) } },
      ],
    });
    const data = accounts[0]?.account?.data;
    if (!data || data.length < 112) return [];
    let offset = 108;
    const epochCount = data.readUInt32LE(offset); offset += 4;
    const rates = [];
    for (let index = 0; index < epochCount && offset + 40 <= data.length; index += 1) {
      const totalPoints = data.readBigUInt64LE(offset);
      const redeemedPoints = data.readBigUInt64LE(offset + 8);
      const totalTokens = data.readBigUInt64LE(offset + 16);
      const redeemedTokens = data.readBigUInt64LE(offset + 24);
      const dayIndex = Number(data.readBigInt64LE(offset + 32));
      offset += 40;
      // The epoch's advertised rate is the complete pool ratio. Using the
      // redeemed subset would make a partially claimed epoch look different
      // from the actual redemption price.
      const points = Number(totalPoints);
      const tokens = Number(totalTokens) / 1e8;
      if (!Number.isFinite(dayIndex) || !Number.isFinite(points) || points <= 0 || !Number.isFinite(tokens) || tokens <= 0) continue;
      rates.push({
        date: new Date(dayIndex * 86400000).toISOString().slice(0, 10),
        dayIndex,
        totalPoints: Number(totalPoints),
        redeemedPoints: Number(redeemedPoints),
        redeemedTokens: tokens,
        atlasPerLp: tokens / points,
      });
    }
    return rates;
  } catch (_error) {
    return [];
  }
}

async function fetchDailyUpgradingNetAtlas(settings, redemptionRates) {
  const [rows, resources, atlasPerSol] = await Promise.all([
    fetchUpgradingEarningsRows(settings).catch(() => []),
    fetchAephiaResourceData().catch(() => []),
    fetchAtlasPerSol().then((quote) => quote?.atlasPerSol).catch(() => null),
  ]);
  const ratesByDate = new Map((redemptionRates || []).map((row) => [String(row.date), Number(row.atlasPerLp)]));
  const pricesByAsset = new Map();
  for (const resource of resources) {
    const name = normalizeShipName(resource?.name);
    const price = Number(resource?.pricingATL?.priceATL);
    if (name && Number.isFinite(price) && price > 0) pricesByAsset.set(name, price);
  }
  const daily = new Map();
  for (const row of rows) {
    const date = String(row.isoDate || '');
    const lpPerUnit = UPGRADE_LP_BY_COMPONENT[normalizeShipName(row.asset)];
    const atlasPerLp = ratesByDate.get(date);
    const installed = Number(row.installed);
    const componentPrice = pricesByAsset.get(normalizeShipName(row.asset));
    const txCostSol = Number(row.txCostSol);
    if (!date || !Number.isFinite(lpPerUnit) || !Number.isFinite(atlasPerLp) || atlasPerLp <= 0 || !Number.isFinite(installed) || installed <= 0) continue;
    const lp = installed * lpPerUnit;
    const revenue = lp * atlasPerLp;
    const componentCost = Number.isFinite(componentPrice) ? installed * componentPrice : null;
    const transactionCost = Number.isFinite(atlasPerSol) && Number.isFinite(txCostSol) ? txCostSol * atlasPerSol : null;
    const current = daily.get(date) || { date, revenue: 0, componentCost: 0, transactionCost: 0, complete: true };
    current.lp = (current.lp || 0) + lp;
    current.revenue += revenue;
    if (componentCost == null) current.complete = false;
    else current.componentCost += componentCost;
    if (transactionCost == null && txCostSol > 0) current.complete = false;
    else if (transactionCost != null) current.transactionCost += transactionCost;
    daily.set(date, current);
  }
  const result = [...daily.values()].map((row) => ({
    date: row.date,
    lp: row.lp || 0,
    netAtlas: row.complete ? row.revenue - row.componentCost - row.transactionCost : null,
    revenue: row.revenue,
    componentCost: row.complete ? row.componentCost : null,
    transactionCost: row.transactionCost,
  })).filter((row) => Number.isFinite(row.lp) && row.lp > 0);
  result.jobs = Array.isArray(rows.jobs) ? rows.jobs : [];
  result.priceSnapshotAt = new Date().toISOString();
  return result;
}

async function fetchDailyNeutralUpgradingPlan(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) return [];
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "lp_auto_comp")
${scopeFilterFlux}
  |> filter(fn: (r) => r._field == "neutral_upgrading_hour" or r._field == "neutral_crew")
  |> pivot(rowKey: ["_time", "component"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time", "component", "neutral_upgrading_hour", "neutral_crew"])
  |> sort(columns: ["_time", "component"])`;
  const resources = await fetchAephiaResourceData().catch(() => []);
  const pricesByAsset = new Map();
  for (const resource of resources) {
    const name = normalizeShipName(resource?.name);
    const price = Number(resource?.pricingATL?.priceATL);
    if (name && Number.isFinite(price) && price > 0) pricesByAsset.set(name, price);
  }
  const latestByComponentHour = new Map();
  for (const row of parseInfluxCsv(await queryInfluxFlux({ ...settings, influxBucket: settings.influxBucket }, flux))) {
    const time = String(row._time || '');
    const component = normalizeShipName(row.component);
    const rate = Number(row.neutral_upgrading_hour);
    const neutralCrew = Number(row.neutral_crew);
    const ms = Date.parse(time);
    if (!component || !Number.isFinite(ms) || !Number.isFinite(rate) || rate < 0) continue;
    const key = `${time.slice(0, 13)}|${component}`;
    if (!latestByComponentHour.has(key) || time > latestByComponentHour.get(key).time) latestByComponentHour.set(key, { time, component, rate, neutralCrew });
  }
  const byDay = new Map();
  for (const row of latestByComponentHour.values()) {
    const date = row.time.slice(0, 10);
    const hour = row.time.slice(0, 13);
    if (!byDay.has(date)) byDay.set(date, new Map());
    const day = byDay.get(date);
    if (!day.has(hour)) day.set(hour, []);
    day.get(hour).push(row);
  }
  const result = [...byDay.entries()].map(([date, hours]) => {
    if (hours.size < 24) return null;
    let lp = 0;
    let componentCost = 0;
    for (const rows of hours.values()) for (const row of rows) {
      const lpPerUnit = UPGRADE_LP_BY_COMPONENT[row.component];
      const price = pricesByAsset.get(row.component);
      if (!Number.isFinite(lpPerUnit) || !Number.isFinite(price)) return null;
      lp += row.rate * lpPerUnit;
      componentCost += row.rate * price;
    }
    return { date, lp, componentCost, hours: hours.size, complete: true };
  }).filter(Boolean);
  result.hourlyAllocations = [...latestByComponentHour.values()].map((row) => ({ time: row.time, component: row.component, neutral_crew: row.neutralCrew }));
  return result;
}

function optimizationNumberQuantile(values, fraction) {
  const sorted = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function detectUpgradingRestartGap(values) {
  const sorted = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const first = Math.max(1, Math.floor(sorted.length * 0.2));
  const last = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9));
  let best = null;
  for (let index = first; index <= last; index += 1) {
    const lower = sorted[index - 1];
    const upper = sorted[index];
    const ratio = (upper + 1) / (lower + 1);
    const width = upper - lower;
    if (!best || ratio > best.ratio || (ratio === best.ratio && width > best.width)) best = { index, lower, upper, ratio, width };
  }
  return best ? {
    lowerSeconds: best.lower,
    upperSeconds: best.upper,
    thresholdSeconds: best.lower,
    belowCount: best.index,
    belowPercent: best.index / sorted.length * 100,
  } : null;
}

function summarizeUpgradingProcessHistory(rows) {
  const validRows = (rows || []).filter((row) => row?.process && row?.profile);
  const byProcess = new Map();
  for (const row of validRows) if (!byProcess.has(String(row.process))) byProcess.set(String(row.process), row);
  const processes = [...byProcess.values()];
  const groups = new Map();
  for (const row of processes) {
    const key = [row.profile, row.starbase, row.recipeKey || row.recipe || row.component, Number(row.quantity), Number(row.durationSeconds)].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const restartGaps = [];
  let predecessorLinks = 0;
  let repeatGroups = 0;
  let longestChain = processes.length ? 1 : 0;
  for (const group of groups.values()) {
    group.sort((a, b) => Number(a.startTime) - Number(b.startTime));
    if (group.length > 1) repeatGroups += 1;
    longestChain = Math.max(longestChain, group.length);
    for (let index = 1; index < group.length; index += 1) {
      const gap = Number(group[index].startTime) - Number(group[index - 1].endTime);
      if (!Number.isFinite(gap) || gap < -5) continue;
      predecessorLinks += 1;
      restartGaps.push(gap);
    }
  }
  const times = validRows.map((row) => Date.parse(String(row._time || row.time || ''))).filter(Number.isFinite);
  const automationGap = detectUpgradingRestartGap(restartGaps);
  return {
    snapshotRows: validRows.length,
    uniqueProcesses: processes.length,
    profiles: new Set(processes.map((row) => String(row.profile))).size,
    repeatGroups,
    predecessorLinks,
    longestChain,
    restartGapP25Seconds: optimizationNumberQuantile(restartGaps, 0.25),
    restartGapMedianSeconds: optimizationNumberQuantile(restartGaps, 0.5),
    restartGapP75Seconds: optimizationNumberQuantile(restartGaps, 0.75),
    restartGapP80Seconds: optimizationNumberQuantile(restartGaps, 0.8),
    restartGapP90Seconds: optimizationNumberQuantile(restartGaps, 0.9),
    restartWithin120: restartGaps.filter((gap) => gap <= 120).length,
    restartWithin300: restartGaps.filter((gap) => gap <= 300).length,
    restartWithin120Percent: restartGaps.length ? restartGaps.filter((gap) => gap <= 120).length / restartGaps.length * 100 : null,
    restartWithin300Percent: restartGaps.length ? restartGaps.filter((gap) => gap <= 300).length / restartGaps.length * 100 : null,
    automationGapLowerSeconds: automationGap?.lowerSeconds ?? null,
    automationGapUpperSeconds: automationGap?.upperSeconds ?? null,
    automationThresholdSeconds: automationGap?.thresholdSeconds ?? null,
    probablyAutomatedCount: automationGap?.belowCount ?? 0,
    probablyAutomatedPercent: automationGap?.belowPercent ?? null,
    historyStart: times.length ? new Date(Math.min(...times)).toISOString() : null,
    historyEnd: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}

async function fetchUpgradingOptimization(payload = {}) {
  const settings = await readSettings();
  const bucket = String(settings.influxOptimizationBucket || 'optimization').trim();
  const querySettings = { ...settings, influxBucket: bucket };
  const faction = normalizeOptimizationFaction(payload.faction || settings.faction);
  const aephiaFaction = normalizeFaction(payload.faction || settings.faction);
  const requestedStart = Date.parse(String(payload.start || ''));
  const start = new Date(Math.max(Date.parse(OPTIMIZATION_UPGRADING_START), Number.isFinite(requestedStart) ? requestedStart : Date.parse(OPTIMIZATION_UPGRADING_START))).toISOString();
  const requestedStop = Date.parse(String(payload.stop || ''));
  const stop = Number.isFinite(requestedStop) && requestedStop > Date.parse(start) ? new Date(requestedStop).toISOString() : '';
  const instanceFilter = payload.instance && payload.instance !== '__all__' ? ` and r.instance == "${escapeFluxString(payload.instance)}"` : '';
  const range = stop ? `range(start: time(v: "${escapeFluxString(start)}"), stop: time(v: "${escapeFluxString(stop)}"))` : `range(start: time(v: "${escapeFluxString(start)}"))`;
  const base = (measurement) => `from(bucket: "${escapeFluxString(bucket)}")
  |> ${range}
  |> filter(fn: (r) => r._measurement == "${measurement}" and r.faction == "${escapeFluxString(faction)}"${instanceFilter})
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"], desc: true)`;
  const [aggregateCsv, componentCsv, redeemedLpSummary, resources, redemptionRates] = await Promise.all([
    queryInfluxFlux(querySettings, base('optimization_upgrading')),
    queryInfluxFlux(querySettings, `from(bucket: "${escapeFluxString(bucket)}")
  |> ${range}
  |> filter(fn: (r) => r._measurement == "optimization_upgrading_component" and r.faction == "${escapeFluxString(faction)}"${instanceFilter})
  |> pivot(rowKey: ["_time", "component"], columnKey: ["_field"], valueColumn: "_value")`),
    fetchRedeemedLpSummaryByDate(settings).catch(() => ({ factionDaily: {}, playerDaily: {} })),
    fetchAephiaResourceData().catch(() => []),
    fetchPointsStoreRedemptionRates(settings, aephiaFaction),
  ]);
  const rows = mergeUpgradingOptimizationRows(parseInfluxCsv(aggregateCsv), parseInfluxCsv(componentCsv));
  const playerDaily = Object.entries(redeemedLpSummary.playerDaily?.[aephiaFaction] || {}).map(([date, lp]) => ({ date, lp: Number(lp) })).filter((row) => Number.isFinite(row.lp));
  const factionDaily = Object.entries(redeemedLpSummary.factionDaily?.[aephiaFaction] || {}).map(([date, lp]) => ({ date, lp: Number(lp) })).filter((row) => Number.isFinite(row.lp));
  const componentPricesAtl = {};
  for (const resource of resources) {
    const name = normalizeShipName(resource?.name);
    const price = Number(resource?.pricingATL?.priceATL);
    if (name && Number.isFinite(price) && price > 0) componentPricesAtl[name] = price;
  }
  const factionSettings = { ...settings, faction: aephiaFaction };
  const [netAtlasDaily, neutralUpgradingDaily] = await Promise.all([
    fetchDailyUpgradingNetAtlas(factionSettings, redemptionRates),
    fetchDailyNeutralUpgradingPlan(factionSettings),
  ]);
  const playerProfile = String(settings.playerProfiles?.[aephiaFaction] || settings.playerProfile || '');
  const configuredCrewByHour = {};
  for (const row of rows) {
    const time = String(row.time || row._time || '');
    const crew = Number(row.phantom_crew ?? row.phantomCrew);
    if (Number.isFinite(Date.parse(time)) && Number.isFinite(crew) && crew >= 0) configuredCrewByHour[new Date(time).toISOString().slice(0, 13)] = crew;
  }
  const atlasPerLpByDate = Object.fromEntries(redemptionRates.map((row) => [row.date, row.atlasPerLp]));
  const selectionUtilizationV1 = calculateUpgradingSelectionUtilization({ jobs: netAtlasDaily.jobs, neutralHours: neutralUpgradingDaily.hourlyAllocations, configuredCrewByHour, prices: componentPricesAtl, atlasPerLpByDate, faction, profile: playerProfile, priceSnapshotAt: netAtlasDaily.priceSnapshotAt });
  return { ok: true, rows, playerDaily, factionDaily, redemptionRates, netAtlasDaily, neutralUpgradingDaily, selectionUtilizationV1, playerProfile, componentPricesAtl, atlasPool: UPGRADE_ATLAS_POOLS[aephiaFaction] || null, columns: Array.from(new Set(rows.flatMap((row) => Object.keys(row)))), bucket, start, checkedAt: new Date().toISOString() };
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
  if (!factionStarbases) {
    const fallbackStarbases = new Set(FACTION_STARBASES[faction] || []);
    return fallbackStarbases.has(entryStarbase);
  }
  return factionStarbases.has(entryStarbase);
}

function filterStarbasesByFaction(starbases, factionStarbases, faction) {
  if (!factionStarbases) {
    const fallbackStarbases = new Set(FACTION_STARBASES[faction] || []);
    return starbases.filter((s) => fallbackStarbases.has(s.value));
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

function createDayTemplates(dayCount = 30) {
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

const sduProductionCache = createAsyncTtlCache({ ttlMs: 60_000 });
const sduConsumptionCache = createAsyncTtlCache({ ttlMs: 60_000 });

function getSduCacheKey(settings) {
  return [getInfluxBaseUrl(settings.influxUrl), settings.influxBucket, normalizeFaction(settings.faction)].join('|');
}

async function querySduProduction(settings, bucket, scopeFilterFlux) {
  const productionFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "sdu")
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "_time", "_value"])`;
  const productionRows = parseInfluxCsv(await queryInfluxFlux(settings, productionFlux));
  const allFleetDays = createDayTemplates();
  const fleetDaysByName = new Map();
  const fleetTotals = new Map();

  for (const row of productionRows) {
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    fleetTotals.set(fleet, (fleetTotals.get(fleet) || 0) + value);
    if (!fleetDaysByName.has(fleet)) fleetDaysByName.set(fleet, createDayTemplates());
    addValueToDay(allFleetDays, date, value);
    addValueToDay(fleetDaysByName.get(fleet), date, value);
  }

  return {
    allFleetDays,
    fleetDays: Object.fromEntries(fleetDaysByName),
    fleets: summarizeFleetOptions(fleetTotals),
  };
}

async function querySduConsumption(settings, bucket, scopeFilterFlux) {
  const flux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) =>
    (r._measurement == "crafting" and exists r.input and r.input == "Survey Data Unit") or
    (r._measurement == "upgrade" and exists r.input and r.input == "Survey Data Unit")
  )
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["_time"])
  |> sum(column: "_value")
  |> group()`;
  const rows = parseInfluxCsv(await queryInfluxFlux(settings, flux));
  const valuesByDay = new Map();
  for (const row of rows) {
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const key = getUtcDateKey(date);
    valuesByDay.set(key, (valuesByDay.get(key) || 0) + value);
  }
  const days = getLastUtcDays(30).map((date) => {
    const key = getUtcDateKey(date);
    return { isoDate: key, label: formatShortUtcDate(date), value: valuesByDay.get(key) || 0 };
  });
  return { days, total: days.reduce((sum, day) => sum + day.value, 0) };
}

async function fetchDailySdu(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const requestedFleet = normalizeFleetFilter(payload);
  const startedAt = Date.now();
  const production = await sduProductionCache.get(
    getSduCacheKey(settings),
    () => querySduProduction(settings, bucket, scopeFilterFlux),
  );
  const selectedFleet = production.fleets.some((fleet) => fleet.value === requestedFleet) ? requestedFleet : '';
  const days = selectedFleet ? production.fleetDays[selectedFleet] : production.allFleetDays;
  const total = days.reduce((sum, day) => sum + day.value, 0);

  return {
    ok: true,
    field: 'amount',
    days,
    total,
    production: { days, total },
    consumption: null,
    surplus: null,
    fleets: production.fleets,
    selectedFleet,
    allFleetDays: production.allFleetDays,
    fleetDays: production.fleetDays,
    timings: { productionMs: Date.now() - startedAt },
    faction: normalizeFaction(settings.faction),
    scopeNote: getInfluxScopeNote(settings),
    checkedAt: new Date().toISOString(),
  };
}

async function fetchDailySduConsumption(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const startedAt = Date.now();
  const consumption = await sduConsumptionCache.get(
    getSduCacheKey(settings),
    () => querySduConsumption(settings, bucket, scopeFilterFlux),
  );
  return {
    ok: true,
    consumption,
    timings: { consumptionMs: Date.now() - startedAt },
    faction: normalizeFaction(settings.faction),
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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
  |> range(start: -31d)
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

  // Track the first day (in the 30-day window) where each data source
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
  |> range(start: -31d)
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

function buildProviderUrl(p) {
  const base = String(p?.rpcBaseUrl || '').trim();
  const key = String(p?.apiKey || '').trim();
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

function isUsableSharedRpcUrl(value) {
  try {
    const url = new URL(value);
    const isHelius = url.hostname.toLowerCase().endsWith('helius-rpc.com');
    if (!isHelius) return true;
    return Boolean(String(url.searchParams.get('api-key') || '').trim());
  } catch (_error) {
    return false;
  }
}

function getErrorText(error) {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.trim();
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch (_error) {
    return String(error);
  }
}

function isRpcRateLimitError(error) {
  const text = getErrorText(error).toLowerCase();
  return text.includes('429') || text.includes('too many requests') || text.includes('rate limit');
}

function getRpcLimiterStatus() {
  const paths = resolveRpcLimiterPaths();
  const state = readRpcLimiterState(paths.stateFile, Date.now());
  // Migration: pre-multi-provider state files stored rpcBaseUrl / apiKey
  // at the top level. Copy them into state.providers.main in memory so
  // existing configurations keep working without re-sending settings.
  if (!state.providers || (!state.providers.main?.rpcBaseUrl && !state.providers.fallback?.rpcBaseUrl)) {
    const legacyBase = String(state.rpcBaseUrl || '').trim();
    if (legacyBase) {
      state.providers = {
        main: { rpcBaseUrl: legacyBase, apiKey: String(state.apiKey || '').trim() },
        fallback: {},
      };
    }
  }
  const now = Date.now();
  const providers = state.providers || { main: {}, fallback: {} };
  const inCooldown = (p) => Boolean(p?.cooldownUntilMs && p.cooldownUntilMs > now);
  const available = (p) => Boolean(p?.rpcBaseUrl) && !inCooldown(p);

  const mainAvail = available(providers.main);
  const fallbackAvail = available(providers.fallback);
  let activeProvider = null;
  if (mainAvail && !fallbackAvail) activeProvider = 'main';
  else if (!mainAvail && fallbackAvail) activeProvider = 'fallback';

  return {
    path: paths.stateFile,
    enabled: Boolean(state.enabled),
    providers: {
      main: {
        url: buildProviderUrl(providers.main),
        cooldown: inCooldown(providers.main),
        cooldownUntil: providers.main?.cooldownUntilMs || null,
        failures: providers.main?.failures || 0,
      },
      fallback: {
        url: buildProviderUrl(providers.fallback),
        cooldown: inCooldown(providers.fallback),
        cooldownUntil: providers.fallback?.cooldownUntilMs || null,
        failures: providers.fallback?.failures || 0,
      },
    },
    activeProvider,
    // Legacy field kept for callers that still expect a single URL. Points
    // at main so the bot's primary Connection keeps working unchanged.
    currentRpcUrl: buildProviderUrl(providers.main),
    updatedBy: state.updatedBy || '',
    updatedAt: state.updatedAt || '',
    revision: state.revision ?? 0,
    rpcRequestsPerSecond: state.buckets?.['rpc:shared']?.intervalMs > 0
      ? String(1000 / state.buckets['rpc:shared'].intervalMs)
      : '',
  };
}

function parseRpcUrlForLimiter(rawValue) {
  const url = new URL(String(rawValue || '').trim());
  const apiKey = url.searchParams.get('api-key') || '';
  url.searchParams.delete('api-key');
  const query = url.searchParams.toString();
  const pathname = url.pathname === '/' ? '' : url.pathname;
  return {
    rpcBaseUrl: `${url.origin}${pathname}${query ? `?${query}` : ''}`,
    apiKey,
  };
}

async function sendSettingsToRpcLimiter(payload) {
  const replacementRpcUrl = String(payload.rpcUrl || '').trim();
  // The Main vs Fallback checkbox: unchecked (default) writes to 'main';
  // checked writes to 'fallback'. The user assigns the URL they just
  // pasted to one of the two provider slots.
  const role = payload.providerRole === 'fallback' ? 'fallback' : 'main';
  let parsedProvider = null;
  let requestsPerSecond = null;
  if (replacementRpcUrl) {
    parsedProvider = parseRpcUrlForLimiter(replacementRpcUrl);
    requestsPerSecond = Number(payload.rpcRequestsPerSecond);
    if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) {
      throw new Error('Requests / sec must be a positive number.');
    }
  }
  const paths = resolveRpcLimiterPaths();
  fsSync.mkdirSync(path.dirname(paths.lockfile), { recursive: true });
  if (!fsSync.existsSync(paths.lockfile)) fsSync.writeFileSync(paths.lockfile, '');
  const release = await lockfile.lock(paths.lockfile, {
    stale: 5000,
    retries: { retries: 50, minTimeout: 5, maxTimeout: 50, factor: 1.2 },
    realpath: false,
  });
  try {
    const state = readRpcLimiterState(paths.stateFile, Date.now());
    state.providers = state.providers || { main: {}, fallback: {} };
    if (!replacementRpcUrl) {
      state.providers[role] = {};
      if (role === 'main') {
        delete state.rpcBaseUrl;
        delete state.apiKey;
      }
      state.enabled = Boolean(state.providers.main?.rpcBaseUrl || state.providers.fallback?.rpcBaseUrl);
    } else {
      state.enabled = true;
      state.providers[role] = {
        ...(state.providers[role] || {}),
        ...parsedProvider,
        // Reset health metrics on re-configuration.
        failures: 0,
        cooldownUntilMs: null,
      };
      state.buckets ||= {};
      state.buckets['rpc:shared'] = {
        ...(state.buckets['rpc:shared'] || { nextSlotMs: 0 }),
        intervalMs: Math.max(1, Math.round(1000 / requestsPerSecond)),
      };
    }
    state.updatedBy = 'My Star Atlas';
    state.updatedAt = new Date().toISOString();
    bumpRpcLimiterRevision(state);
    writeRpcLimiterStateSync(paths.stateFile, state);
  } finally {
    await release().catch(() => undefined);
  }
  return getRpcLimiterStatus();
}

function getRpcUrl(settings) {
  if (settings && settings.useRpcLimiter) {
    const status = getRpcLimiterStatus();
    // Prefer main; if main isn't configured, fall back to fallback.
    const mainUrl = status.providers?.main?.url;
    const fallbackUrl = status.providers?.fallback?.url;
    const url = mainUrl || fallbackUrl;
    if (url && isUsableSharedRpcUrl(url)) return url;
    throw new Error('Use RPC Limiter is enabled, but no RPC Limiter URLs are configured. Send settings to RPC Limiter first.');
  }
  return String(settings?.rpcUrl || '').trim() || DEFAULT_RPC_URL;
}

function getRpcFallbackUrl(settings) {
  if (!settings?.useRpcLimiter) return undefined;
  const status = getRpcLimiterStatus();
  // Fallback slot is the per-call failover target. If main is the only one
  // configured, return undefined so the Connection doesn't try to use it.
  const mainUrl = status.providers?.main?.url;
  const fallbackUrl = status.providers?.fallback?.url;
  if (!fallbackUrl) return undefined;
  if (!isUsableSharedRpcUrl(fallbackUrl)) return undefined;
  if (mainUrl && fallbackUrl === mainUrl) return undefined;
  return fallbackUrl;
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

function deriveRentalContract(fleetAccount, programId = SRSLY_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rental_contract'), fleetAccount.toBuffer()],
    programId
  )[0];
}

function normalizeAtlasRate(raw) {
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > 1_000_000 ? value / 10 ** 8 : value;
}

function normalizeAtlasAmount(raw) {
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value / 10 ** 8;
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

async function fetchRedeemedLpSummaryByDate(settings) {
  const now = Date.now();
  if (aephiaLpSummaryCache && aephiaLpSummaryCache.expiresAt > now) return aephiaLpSummaryCache.data;
  const apiKey = String(settings?.aephiaApiKey || '').trim();
  if (!apiKey) throw new Error('aephia_api_key_missing');
  const response = await fetch(AEPHIA_LP_SUMMARY_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`aephia_lp_summary_${response.status}`);
  const payload = await response.json();
  const result = { factionDaily: {}, playerDaily: {} };
  const normalizedProfiles = normalizePlayerProfiles(settings, normalizeFaction(settings.faction));
  const addRows = (factions, getDate) => {
    for (const [name, rows] of Object.entries(factions || {})) {
      const faction = normalizeFaction(name === 'Ustur' ? 'USTUR' : name);
      const playerProfile = String(normalizedProfiles[faction] || '').trim();
      if (!result.factionDaily[faction]) result.factionDaily[faction] = {};
      if (!result.playerDaily[faction]) result.playerDaily[faction] = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        const date = getDate(row);
        const redeemedLp = Number(row?.redeemedLp);
        if (date && Number.isFinite(redeemedLp) && redeemedLp > 0) result.factionDaily[faction][date] = redeemedLp;
        if (!date || !playerProfile) continue;
        const playerRow = (Array.isArray(row?.playerProfiles) ? row.playerProfiles : []).find((profile) => String(profile?.profile || '').trim() === playerProfile);
        const playerLp = Number(playerRow?.contribution);
        if (Number.isFinite(playerLp) && playerLp > 0) result.playerDaily[faction][date] = playerLp;
      }
    }
  };
  // Interval snapshots cover the API's rolling window. Taking the last
  // snapshot for each UTC date gives the daily faction/player redemption;
  // finalized rows are applied afterwards so they remain authoritative.
  addRows(payload?.interval?.factions, (row) => String(row?.dateTime || '').slice(0, 10));
  addRows(payload?.dailyFinal?.factions, (row) => String(row?.date || '').slice(0, 10));
  aephiaLpSummaryCache = { data: result, expiresAt: now + 5 * 60 * 1000 };
  return result;
}

async function fetchFactionRedeemedLpByDate(settings) {
  return (await fetchRedeemedLpSummaryByDate(settings)).factionDaily;
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

function firstDailySeriesPrices(payload) {
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const tsIndex = columns.indexOf('ts');
  const priceIndex = columns.indexOf('price');
  if (tsIndex < 0 || priceIndex < 0) return {};
  const daily = {};
  const rows = (Array.isArray(payload?.rows) ? payload.rows : [])
    .map((row) => ({ row, timestamp: Number(row?.[tsIndex]) }))
    .filter(({ timestamp }) => Number.isFinite(timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  for (const { row, timestamp } of rows) {
    const priceATL = Number(row?.[priceIndex]);
    if (!Number.isFinite(priceATL) || priceATL <= 0) continue;
    const date = new Date(timestamp).toISOString().slice(0, 10);
    if (!daily[date]) daily[date] = { priceATL, observedAt: new Date(timestamp).toISOString() };
  }
  return daily;
}

async function fetchAephiaSeries(pathname) {
  const now = Date.now();
  const cached = aephiaPriceSeriesCache.get(pathname);
  if (cached?.expiresAt > now) return cached.data;
  const response = await fetch(`${AEPHIA_PRICE_SERIES_URL}/${pathname}?days=36`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`aephia_price_series_${response.status}`);
  const data = firstDailySeriesPrices(await response.json());
  aephiaPriceSeriesCache.set(pathname, { data, expiresAt: now + 2 * 60 * 1000 });
  return data;
}

async function fetchHistoricalAtlasPrices(asset) {
  const key = normalizeShipName(asset);
  if (key === 'sol') {
    const [sol, atlas] = await Promise.all([fetchAephiaSeries('token/sol'), fetchAephiaSeries('token/atlas')]);
    const dates = Array.from(new Set([...Object.keys(sol), ...Object.keys(atlas)])).sort();
    const result = {};
    let solPrice = null;
    let atlasPrice = null;
    for (const date of dates) {
      solPrice = sol[date]?.priceATL ?? solPrice;
      atlasPrice = atlas[date]?.priceATL ?? atlasPrice;
      if (solPrice > 0 && atlasPrice > 0) result[date] = { priceATL: solPrice / atlasPrice };
    }
    return result;
  }
  const resources = await fetchAephiaResourceData();
  const resource = resources.find((item) => normalizeShipName(item?.name) === key);
  if (!resource?.mint) return {};
  return fetchAephiaSeries(`ATLAS/${encodeURIComponent(resource.mint)}`);
}

async function resolveHistoricalAtlasPrice(asset, date) {
  const key = normalizeShipName(asset);
  const daily = await fetchHistoricalAtlasPrices(asset).catch(() => ({}));
  if (Object.keys(daily).length === 0) {
    let currentPrice = null;
    if (key === 'sol') currentPrice = await fetchAtlasPerSol().then((value) => value?.atlasPerSol).catch(() => null);
    else {
      const resources = await fetchAephiaResourceData().catch(() => []);
      currentPrice = Number(resources.find((item) => normalizeShipName(item?.name) === key)?.pricingATL?.priceATL);
    }
    if (Number.isFinite(currentPrice) && currentPrice > 0) {
      const today = new Date().toISOString().slice(0, 10);
      daily[today] = {
        priceATL: currentPrice,
        source: 'aephia_current_midpoint_fallback',
        provenance: `Current Aephia midpoint used because no historical series was available on ${today}`,
        estimated: true,
      };
    }
  }
  const historicalByDate = Object.fromEntries(Object.entries(daily).map(([day, value]) => [day, {
    [key]: { source: 'aephia_historical_first_daily', provenance: `First valid Aephia midpoint observation on ${day}`, ...value },
  }]));
  return atlasPriceResolver.resolveAtlasPrice(asset, date, { historicalByDate });
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

async function fetchAephiaTokenPriceSeries(token, fromMs, toMs) {
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  const cacheKey = `${token}:${from}:${to}`;
  const cached = aephiaTokenSeriesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const url = `${AEPHIA_TOKEN_SERIES_BASE_URL}/${encodeURIComponent(token)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`aephia_token_series_${token}_${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload?.rows) ? payload.rows.filter((row) => Array.isArray(row) && row.length >= 2) : [];
  aephiaTokenSeriesCache.set(cacheKey, { rows, expiresAt: Date.now() + 2 * 60 * 1000 });
  return rows;
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

function decodePlayerProfileWallets(accountInfo) {
  if (!accountInfo?.owner?.equals(PLAYER_PROFILE_PROGRAM_ID) || !Buffer.isBuffer(accountInfo.data) || accountInfo.data.length < 30) return [];
  const keyCount = accountInfo.data.readUInt16LE(28);
  const wallets = [];
  for (let index = 0; index < keyCount; index += 1) {
    const offset = 30 + index * 80;
    if (offset + 80 > accountInfo.data.length) break;
    // Keep expired/removed operational keys in the scan set: they may have
    // created valid historical fills after the cost-basis cutoff.
    wallets.push(new PublicKey(accountInfo.data.subarray(offset, offset + 32)).toBase58());
  }
  return Array.from(new Set(wallets));
}

function decodePlayerProfileHandlerWallets(accountInfo) {
  if (!accountInfo?.owner?.equals(PLAYER_PROFILE_PROGRAM_ID) || !Buffer.isBuffer(accountInfo.data) || accountInfo.data.length < 30) return [];
  const keyCount = accountInfo.data.readUInt16LE(28);
  const wallets = [];
  for (let index = 0; index < keyCount; index += 1) {
    const offset = 30 + index * 80;
    if (offset + 80 > accountInfo.data.length) break;
    const permissions = accountInfo.data.readBigUInt64LE(offset + 72);
    if ((permissions & 1n) === 1n) wallets.push(new PublicKey(accountInfo.data.subarray(offset, offset + 32)).toBase58());
  }
  return Array.from(new Set(wallets));
}

function decodePlayerProfileMarketplaceWallets(accountInfo) {
  if (!accountInfo?.owner?.equals(PLAYER_PROFILE_PROGRAM_ID) || !Buffer.isBuffer(accountInfo.data) || accountInfo.data.length < 30) return [];
  const keyCount = accountInfo.data.readUInt16LE(28);
  const wallets = [];
  for (let index = 0; index < keyCount; index += 1) {
    const offset = 30 + index * 80;
    if (offset + 80 > accountInfo.data.length) break;
    const permissions = accountInfo.data.readBigUInt64LE(offset + 72);
    // Profile authority (bit 0) and operational signer (bit 3) are the
    // bounded transaction anchors shared by Marketplace activity.
    if ((permissions & 9n) !== 0n) wallets.push(new PublicKey(accountInfo.data.subarray(offset, offset + 32)).toBase58());
  }
  return Array.from(new Set(wallets));
}

function parseGmTradingWallets(value) {
  const wallets = [];
  for (const candidate of String(value || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)) {
    wallets.push(new PublicKey(candidate).toBase58());
  }
  return Array.from(new Set(wallets));
}

function buildGlobalMarketAssetMap() {
  return Object.fromEntries(ASSET_REGISTRY.map((asset) => [asset.mint, {
    market: 'GM', marketplace: 'GM', starbase: '', asset: asset.name, rawMint: asset.mint, quoteMint: ATLAS_MINT,
  }]));
}

async function buildLocalMarketAssetMap(connection, faction) {
  const starbases = STARBASE_REGISTRY.filter((entry) => entry.faction === faction);
  const infos = starbases.length
    ? await connection.getMultipleAccountsInfo(starbases.map((entry) => new PublicKey(entry.publicKey)), 'confirmed')
    : [];
  const coder = new BorshAccountsCoder(SAGE_IDL);
  const map = {};
  starbases.forEach((starbase, index) => {
    const info = infos[index];
    if (!info) return;
    let decoded;
    try {
      decoded = coder.decode('starbase', info.data);
    } catch (_error) {
      return;
    }
    const seqId = Number(decoded?.seqId);
    if (!Number.isInteger(seqId) || seqId < 0 || seqId > 65535) return;
    const seqIdSeed = Buffer.alloc(2);
    seqIdSeed.writeUInt16LE(seqId);
    for (const asset of ASSET_REGISTRY) {
      try {
        const certificateMint = PublicKey.findProgramAddressSync([
          Buffer.from('CertificateMint'),
          new PublicKey(asset.mint).toBuffer(),
          new PublicKey(starbase.publicKey).toBuffer(),
          seqIdSeed,
        ], SAGE_PROGRAM_ID)[0].toBase58();
        map[certificateMint] = { starbase: starbase.name, asset: asset.name, rawMint: asset.mint };
      } catch (_error) {
        // A malformed registry row must not prevent the remaining market map.
      }
    }
  });
  return map;
}

async function loadLocalMarketTradeCheckpoint(filePath) {
  try {
    const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return {
      orders: Array.isArray(document?.orders) ? document.orders : [],
      trades: Array.isArray(document?.trades) ? document.trades : [],
      assetFlows: Array.isArray(document?.assetFlows) ? document.assetFlows : [],
      publishedTradeIds: new Set(Array.isArray(document?.publishedTradeIds) ? document.publishedTradeIds : []),
      publishedFlowIds: new Set(Array.isArray(document?.publishedFlowIds) ? document.publishedFlowIds : []),
      walletCursors: document?.walletCursors && typeof document.walletCursors === 'object'
        && Object.keys(document.walletCursors).length
        ? document.walletCursors
        : (document?.pendingWalletCursors && typeof document.pendingWalletCursors === 'object'
          ? document.pendingWalletCursors : {}),
      orderCursors: document?.orderCursors && typeof document.orderCursors === 'object' ? document.orderCursors : {},
      activeOrderIds: Array.isArray(document?.activeOrderIds) ? document.activeOrderIds : [],
      archivedOrderIds: Array.isArray(document?.archivedOrderIds) ? document.archivedOrderIds : [],
      marketplaceBackfilled: document?.marketplaceBackfilled === true,
      assetFlowBackfilled: document?.assetFlowBackfilled === true,
      tradeEnrichmentVersion: Number(document?.tradeEnrichmentVersion || 0),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return {
      orders: [], trades: [], assetFlows: [], publishedTradeIds: new Set(), publishedFlowIds: new Set(), walletCursors: {}, orderCursors: {},
      activeOrderIds: [], archivedOrderIds: [], marketplaceBackfilled: false,
      assetFlowBackfilled: false,
      tradeEnrichmentVersion: 0,
    };
    throw error;
  }
}

async function fetchOpenLocalMarketOrderIds(connection, trackedWallets) {
  const ids = new Set();
  const wallets = Array.from(new Set(trackedWallets.map(String).filter(Boolean)));
  for (const wallet of wallets) {
    const rows = await getOpenOrdersForPlayer(connection, new PublicKey(wallet), GM_PROGRAM_ID);
    for (const row of rows || []) {
      const key = row?.publicKey ?? row?.pubkey ?? row?.id;
      if (key) ids.add(String(key));
    }
  }
  return { orderIds: Array.from(ids), requestCount: wallets.length };
}

function resolveMarketplaceCheckpointCursors(checkpoint, scanned) {
  if (scanned.exhaustion) {
    return { walletCursors: checkpoint.walletCursors, orderCursors: checkpoint.orderCursors };
  }
  if (Number(scanned.stats?.transactionMisses || 0) > 0) {
    return { walletCursors: checkpoint.walletCursors, orderCursors: scanned.orderCursors };
  }
  return { walletCursors: scanned.walletCursors, orderCursors: scanned.orderCursors };
}

function marketplaceCursorSnapshot(walletCursors, orderCursors, activeOrderIds, archivedOrderIds) {
  return { walletCursors, orderCursors, activeOrderIds, archivedOrderIds };
}

function loadLocalMarketHistoricalOrderIds(faction, startIso) {
  const profile = faction === 'UST' ? 'USTUR' : faction;
  const filePath = path.join(path.dirname(app.getAppPath()), `lm-market-bot-${profile}`, 'analysis', 'orders-log.jsonl');
  let text;
  try { text = fsSync.readFileSync(filePath, 'utf8'); } catch (_error) { return []; }
  const startMs = Date.parse(startIso);
  const ids = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (event.event === 'FILLED' && Date.parse(event.timestamp) >= startMs && event.orderId) ids.add(String(event.orderId));
    } catch (_error) { /* Ignore a partially-written final JSONL record. */ }
  }
  return Array.from(ids).sort();
}

function marketplaceTradeHoldCandidate(trade, { market, faction, profileScope, cursorInputSnapshot, cursorOutputSnapshot }, publicationInputs = []) {
  const logicalKey = deriveMarketplaceTradeId({
    market, faction, profileScope, executionSignature: trade.signature,
    rawMint: trade.rawMint, side: trade.side, quantity: trade.quantity,
  });
  const currentRank = String(trade.orderId || '').trim() || String(trade.creationSignature || '').trim() || Number(trade.txFeeAtlas || 0) !== 0
    ? 'enriched' : 'fallback';
  const mutableId = String(trade.id || '').trim();
  return {
    market, kind: 'trade', logicalKeyOrSourceId: logicalKey,
    eventId: null, currentRevisionId: null, currentRank,
    currentMutableIds: mutableId ? [mutableId] : [],
    candidateTimestamp: new Date(trade.timestamp).toISOString(),
    candidateSnapshot: {
      id: mutableId, timestamp: trade.timestamp, marketplace: market, faction, profileScope,
      starbase: trade.starbase || '', asset: trade.asset || '', side: trade.side,
      wallet: trade.wallet || '', quantity: trade.quantity, settledAtlas: trade.settledAtlas,
      grossAtlas: trade.grossAtlas ?? trade.settledAtlas, marketplaceFeeAtlas: trade.marketplaceFeeAtlas ?? 0,
      txFeeAtlas: trade.txFeeAtlas ?? 0, netAtlas: trade.netAtlas ?? trade.settledAtlas, unitPriceAtlas: trade.unitPriceAtlas,
      signature: trade.signature, creationSignature: trade.creationSignature || '', rawMint: trade.rawMint,
      certificateMint: trade.certificateMint || '', orderId: trade.orderId || '',
      publicationInputs,
    },
    cursorInputSnapshot, cursorOutputSnapshot,
  };
}

function marketplaceFlowHoldCandidate(event, { cursorInputSnapshot, cursorOutputSnapshot }, publicationInputs = []) {
  return {
    market: 'GM', kind: 'asset_flow', logicalKeyOrSourceId: String(event.id),
    eventId: null, currentRevisionId: null, currentRank: 'asset_flow', currentMutableIds: [],
    observedFlowIds: [String(event.id)], candidateTimestamp: new Date(event.timestamp).toISOString(),
    candidateSnapshot: {
      id: event.id, type: event.type || 'transfer', timestamp: event.timestamp, origin: event.origin || '',
      destination: event.destination || '', asset: event.asset || '', quantity: event.quantity,
      cargoCost: event.cargoCost ?? 0,
      publicationInputs,
    },
    cursorInputSnapshot, cursorOutputSnapshot,
  };
}

const MARKETPLACE_PUBLICATION_SUCCESS = new Set([
  'already_published', 'published_confirmed', 'published_current', 'published_current_uncertain_durability',
]);
const MARKETPLACE_PUBLICATION_PENDING = new Set(['pending_unattempted', 'staged', 'pending_invocation_limit', 'not_configured']);

function marketplacePublicationErrorCode(value, fallback = 'marketplace_publication_failed') {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_.-]{1,64}$/.test(text) ? text : fallback;
}

function marketplacePublicationSettings(settings, organization) {
  const realToken = String(settings.influxAuthToken || '').trim();
  return {
    storageRoot: getAppRoot(),
    installationId: crypto.createHash('sha256').update(`msa-marketplace-installation:v1\n${getAppRoot()}`, 'utf8').digest('hex'),
    applicationProfile: profileName,
    baseUrl: getInfluxBaseUrl(settings.influxUrl),
    bucket: String(settings.influxBucket || '').trim(),
    organization: organization || undefined,
    // The accepted coordinator requires a non-empty value to create a provisional
    // destination. This local sentinel is never persisted or sent and permits
    // lossless staging when credentials are unavailable.
    token: realToken || 'staging-only',
    canPost: Boolean(realToken && organization),
  };
}

async function resolveMarketplacePublicationOrganization(settings) {
  const token = String(settings.influxAuthToken || '').trim().replace(/^(?:Token|Bearer)\s+/i, '');
  if (!settings.influxUrl || !settings.influxBucket || !token) return null;
  try { return await resolveInfluxOrgId(getInfluxBaseUrl(settings.influxUrl), token, settings.influxBucket); }
  catch (_error) { return null; }
}

async function writeInventoryBasisLinesToInflux(settings, lines) {
  const permittedLines = filterLegacyMarketplaceInfluxLines(lines);
  if (!permittedLines) return;
  const token = String(settings.influxAuthToken || '').trim().replace(/^(?:Token|Bearer)\s+/i, '');
  const bucket = String(settings.influxBucket || '').trim();
  const organization = await resolveMarketplacePublicationOrganization(settings);
  if (!settings.influxUrl || !bucket || !organization || !token) throw new Error('inventory_basis_influx_not_configured');
  const url = `${getInfluxBaseUrl(settings.influxUrl)}/api/v2/write?org=${encodeURIComponent(organization)}&bucket=${encodeURIComponent(bucket)}&precision=ns`;
  const response = await fetchWithInfluxRetry(({ signal }) => fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'text/plain; charset=utf-8' },
    body: permittedLines,
    signal,
  }), { timeoutMs: 15_000, retries: 1, retryDelayMs: 250 });
  if (!response.ok) throw new Error(`inventory_basis_influx_http_${response.status}`);
}

async function loadMarketplaceRawDataCheckpoint() {
  try {
    const parsed = JSON.parse(await fs.readFile(marketplaceRawDataCheckpointPath(), 'utf8'));
    if (![1, 2].includes(parsed?.schemaVersion) || !parsed.cursors || typeof parsed.cursors !== 'object'
      || Array.isArray(parsed.cursors) || !Array.isArray(parsed.tokenAccounts)) throw new Error('invalid');
    return {
      ...parsed,
      schemaVersion: 2,
      tokenAccountOwners: Array.isArray(parsed.tokenAccountOwners) ? parsed.tokenAccountOwners : [],
    };
  } catch (_error) {
    return {
      schemaVersion: 2, cursors: {}, tokenAccounts: [], tokenAccountOwners: [],
      tokenAccountsRefreshedAt: '', lastTransferScanAt: '',
    };
  }
}

function rawCursorComplete(cursor) {
  return Boolean(cursor && typeof cursor === 'object' && cursor.backfillComplete === true);
}

async function buildMarketplaceRawDataCoverage(settings) {
  const checkpoint = await loadMarketplaceRawDataCheckpoint();
  let gmWallets = [];
  try { gmWallets = parseGmTradingWallets(settings.gmTradingWallets); } catch (_error) { gmWallets = []; }
  const sources = gmWallets.map((address) => ({
    discoverySource: 'gm_wallet', label: `GM wallet · ${address}`, address, sourceCount: 1,
    backfillComplete: rawCursorComplete(checkpoint.cursors[address]),
  }));
  for (const faction of ['MUD', 'ONI', 'USTUR']) {
    const profile = String(settings.playerProfiles?.[faction] || '').trim();
    const css = STARBASE_REGISTRY.find((entry) => entry.name === CSS_STARBASE_NAMES[faction]);
    if (!profile || !css) continue;
    const address = deriveCssStarbasePlayer({
      sageProgramId: SAGE_PROGRAM_ID.toBase58(), gameId: SAGE_GAME_ID.toBase58(),
      playerProfile: profile, starbase: css.publicKey,
    });
    sources.push({
      discoverySource: 'css_account', label: `${faction} CSS account`, address, sourceCount: 1,
      backfillComplete: rawCursorComplete(checkpoint.cursors[address]),
    });
  }
  const tokenAccountsByOwner = new Map();
  for (const entry of checkpoint.tokenAccounts || []) {
    tokenAccountsByOwner.set(entry.owner, [...(tokenAccountsByOwner.get(entry.owner) || []), entry.address]);
  }
  for (const [owner, addresses] of tokenAccountsByOwner) sources.push({
    discoverySource: 'token_account', label: `Token accounts · ${owner}`, address: owner, sourceCount: addresses.length,
    backfillComplete: addresses.length > 0 && addresses.every((address) => rawCursorComplete(checkpoint.cursors[address])),
  });
  const faction = normalizeFaction(settings.faction);
  const lmCheckpoint = await loadLocalMarketTradeCheckpoint(localMarketCheckpointPath(faction));
  sources.push({
    discoverySource: 'lm_scanner', label: `LM scanner · ${faction}`, address: String(settings.playerProfiles?.[faction] || ''), sourceCount: 1,
    backfillComplete: lmCheckpoint.marketplaceBackfilled === true,
  });
  return {
    sources,
    total: sources.length,
    complete: sources.filter((source) => source.backfillComplete).length,
    pending: sources.filter((source) => !source.backfillComplete).length,
    lastSavedAt: String(checkpoint.savedAt || ''),
  };
}

async function writeMarketplaceRawRecords(settings, records) {
  const lines = [];
  for (const record of records || []) {
    const discoverySource = record.discoverySources?.length === 1 ? record.discoverySources[0]
      : record.discoverySources?.length > 1 ? 'multiple' : 'legacy_unknown';
    lines.push(formatRawTransactionInfluxLine({ transaction: record.transaction, discoverySource }));
  }
  if (lines.length) await writeInventoryBasisLinesToInflux(settings, lines.join('\n'));
  return { transactions: (records || []).length, events: 0 };
}

async function writeMarketplaceEvents(settings, events, transactions = []) {
  const transactionBySignature = new Map((transactions || []).map((transaction) => [
    String(transaction?.signature || transaction?.transaction?.signatures?.[0] || ''), transaction,
  ]).filter(([signature]) => signature));
  const lines = [];
  const seen = new Set();
  for (const event of events || []) {
    if (!event?.eventId || seen.has(event.eventId)) continue;
    const transaction = transactionBySignature.get(String(event.signature || ''));
    if (!transaction || !Number.isSafeInteger(Number(transaction.blockTime))) continue;
    seen.add(event.eventId);
    lines.push(formatMarketplaceEventInfluxLine(event, Number(transaction.blockTime)));
  }
  if (lines.length) await writeInventoryBasisLinesToInflux(settings, lines.join('\n'));
  return { written: lines.length };
}

function projectMarketplaceOrderAndExecutionEvents(scanned, market) {
  const eventType = String(market || '').toLowerCase();
  const events = [];
  for (const order of scanned?.orders || []) {
    const signature = String(order.creationSignature || '');
    if (!signature || !order.orderId) continue;
    events.push({
      eventId: `${signature}:${eventType}:order:${order.orderId}`, signature, eventType,
      action: 'order_created', market: String(market || '').toUpperCase(), orderId: String(order.orderId),
      side: String(order.side || ''), fromWallet: String(order.initializer || ''), asset: String(order.asset || ''),
      mint: String(order.rawMint || order.certificateMint || ''), quantityRaw: String(order.originalQuantity ?? ''),
      unitPriceAtlas: Number(order.priceAtlas),
    });
  }
  for (const trade of scanned?.trades || []) {
    const signature = String(trade.signature || '');
    if (!signature || !trade.id) continue;
    events.push({
      eventId: `${signature}:${eventType}:execution:${trade.id}`, signature, eventType,
      action: 'execution', market: String(market || '').toUpperCase(), orderId: String(trade.orderId || ''),
      side: String(trade.side || ''), fromWallet: String(trade.wallet || ''), asset: String(trade.asset || ''),
      mint: String(trade.rawMint || trade.certificateMint || ''), quantityRaw: String(trade.quantity ?? ''),
      unitPriceAtlas: Number(trade.unitPriceAtlas ?? trade.priceAtlas), grossAtlas: Number(trade.grossAtlas),
      marketplaceFeeAtlas: Number(trade.marketplaceFeeAtlas || 0), txFeeAtlas: Number(trade.txFeeAtlas || 0),
    });
  }
  for (const transaction of scanned?.rawTransactions || []) {
    const signature = String(transaction?.signature || transaction?.transaction?.signatures?.[0] || '');
    const cancellations = (transaction?.meta?.logMessages || []).filter((line) => String(line).includes('Instruction: ProcessCancel'));
    cancellations.forEach((_line, index) => events.push({
      eventId: `${signature}:${eventType}:cancel:${index}`, signature, eventType,
      action: 'order_cancelled', market: String(market || '').toUpperCase(),
    }));
  }
  return events;
}

function rawRowHasDiscoverySource(row, source) {
  const discoverySource = String(row?.discoverySource || '');
  return discoverySource === source || discoverySource === 'multiple';
}

function rawTransactionAccountKeys(transaction) {
  return (transaction?.transaction?.message?.accountKeys || []).map((key) => String(key?.pubkey || key || '')).filter(Boolean);
}

function projectMarketplaceEventsFromRawRows(rawRows, market) {
  const discoverySource = market === 'GM' ? 'gm_wallet' : 'lm_scanner';
  const transactions = (rawRows || []).filter((row) => rawRowHasDiscoverySource(row, discoverySource))
    .map((row) => row.payload).filter(Boolean);
  const marketAssetsByMint = buildGlobalMarketAssetMap();
  const ordersById = new Map();
  for (const transaction of transactions) {
    const order = decodeLocalMarketOrder(transaction, {
      trackedWallets: rawTransactionAccountKeys(transaction), marketAssetsByMint,
    });
    if (order && order.marketplace === market) ordersById.set(order.orderId, order);
  }
  const trades = [];
  for (const transaction of transactions) {
    const trade = decodeOrderExecution(transaction, ordersById, rawTransactionAccountKeys(transaction));
    if (trade && trade.marketplace === market) trades.push(trade);
  }
  return projectMarketplaceOrderAndExecutionEvents({
    orders: Array.from(ordersById.values()), trades, rawTransactions: transactions,
  }, market);
}

async function syncMarketplaceEventsFromRawData(settings) {
  const rawData = await fetchMarketplaceRawDataFromInflux(settings);
  if (rawData.error) throw new Error(rawData.error);
  const cssScopes = ['MUD', 'ONI', 'USTUR'].map((faction) => ({
    faction, profile: String(settings.playerProfiles?.[faction] || '').trim(),
  })).filter((entry) => entry.profile).map(({ faction, profile }) => {
    const css = STARBASE_REGISTRY.find((entry) => entry.name === CSS_STARBASE_NAMES[faction]);
    if (!css) throw new Error(`marketplace_events_css_missing_${faction}`);
    return {
      sageProgramId: SAGE_PROGRAM_ID.toBase58(),
      address: deriveCssStarbasePlayer({
        sageProgramId: SAGE_PROGRAM_ID.toBase58(), gameId: SAGE_GAME_ID.toBase58(),
        playerProfile: profile, starbase: css.publicKey,
      }),
    };
  });
  const transactions = rawData.rows.map((row) => row.payload).filter(Boolean);
  const blockTimes = transactions.map((transaction) => Number(transaction?.blockTime)).filter(Number.isFinite);
  const fromMs = (Math.min(...blockTimes) * 1000) - 24 * 60 * 60 * 1000;
  const toMs = (Math.max(...blockTimes) * 1000) + 10 * 60 * 1000;
  const [sol, atlas] = blockTimes.length ? await Promise.all([
    fetchAephiaTokenPriceSeries('sol', fromMs, toMs).catch(() => []),
    fetchAephiaTokenPriceSeries('atlas', fromMs, toMs).catch(() => []),
  ]) : [[], []];
  const events = enrichMarketplaceEventsWithTransactionFees([
    ...deriveCustodyEventsFromRawRows(rawData.rows, { cssScopes }),
    ...projectMarketplaceEventsFromRawRows(rawData.rows, 'LM'),
    ...projectMarketplaceEventsFromRawRows(rawData.rows, 'GM'),
  ], transactions, { sol, atlas });
  return writeMarketplaceEvents(settings, events, transactions);
}

async function syncMarketplaceRawDataUnlocked(settings, connection, { gmWallets, configuredProfiles, profileWalletsByFaction }) {
  const checkpoint = await loadMarketplaceRawDataCheckpoint();
  const playerWallets = Object.values(profileWalletsByFaction).flat();
  const cssScopes = configuredProfiles.map(({ faction, profile }) => {
    const css = STARBASE_REGISTRY.find((entry) => entry.name === CSS_STARBASE_NAMES[faction]);
    if (!css) throw new Error(`marketplace_rawdata_css_missing_${faction}`);
    return {
      faction,
      sageProgramId: SAGE_PROGRAM_ID.toBase58(),
      address: deriveCssStarbasePlayer({
        sageProgramId: SAGE_PROGRAM_ID.toBase58(), gameId: SAGE_GAME_ID.toBase58(),
        playerProfile: profile, starbase: css.publicKey,
      }),
    };
  });
  const tokenAccountOwners = [...new Set([...playerWallets, ...gmWallets].map(String).filter(Boolean))].sort();
  const checkpointTokenAccountOwners = [...new Set((checkpoint.tokenAccountOwners || []).map(String).filter(Boolean))].sort();
  const tokenAccountOwnersChanged = JSON.stringify(tokenAccountOwners) !== JSON.stringify(checkpointTokenAccountOwners);
  const transferScanAge = Date.now() - Date.parse(checkpoint.lastTransferScanAt || '');
  const transferScanDue = tokenAccountOwnersChanged || !Number.isFinite(transferScanAge) || transferScanAge >= 24 * 60 * 60 * 1000;
  const tokenAccountsAge = Date.now() - Date.parse(checkpoint.tokenAccountsRefreshedAt || '');
  const refreshTokenAccounts = transferScanDue
    && (tokenAccountOwnersChanged || !checkpoint.tokenAccounts.length || !Number.isFinite(tokenAccountsAge) || tokenAccountsAge >= 24 * 60 * 60 * 1000);
  const tokenAccounts = refreshTokenAccounts
    ? await discoverPlayerTokenAccounts(connection, tokenAccountOwners, ASSET_REGISTRY.map((asset) => asset.mint))
    : checkpoint.tokenAccounts;
  const scanned = await scanMarketplaceRawData(connection, {
    gmWallets, cssScopes, playerWallets, tokenAccounts: transferScanDue ? tokenAccounts : [], cursors: checkpoint.cursors,
    startIso: MARKETPLACE_RAWDATA_CUTOVER_ISO, startSlot: MARKETPLACE_RAWDATA_CUTOVER_SLOT, maxPages: 1,
  });
  const written = await writeMarketplaceRawRecords(settings, scanned.records);
  await writeJsonAtomic(marketplaceRawDataCheckpointPath(), {
    schemaVersion: 2, savedAt: new Date().toISOString(), cursors: scanned.cursors, tokenAccounts, tokenAccountOwners,
    tokenAccountsRefreshedAt: refreshTokenAccounts ? new Date().toISOString() : checkpoint.tokenAccountsRefreshedAt,
    lastTransferScanAt: transferScanDue ? new Date().toISOString() : checkpoint.lastTransferScanAt,
  });
  return { ...written, rpc: scanned.rpc };
}

async function syncMarketplaceRawData(settings, connection, scope) {
  const directory = path.dirname(marketplaceRawDataCheckpointPath());
  await fs.mkdir(directory, { recursive: true });
  let release;
  try {
    release = await lockfile.lock(directory, { realpath: false, retries: 0, stale: 30 * 60 * 1000 });
  } catch (error) {
    if (String(error?.code || '') === 'ELOCKED') return { transactions: 0, events: 0, rpc: null, disposition: 'shared_scan_in_progress' };
    throw error;
  }
  try {
    return await syncMarketplaceRawDataUnlocked(settings, connection, scope);
  } finally {
    await release();
  }
}

async function writeMarketplaceFactionV2Lines(settings, rows) {
  const lines = rows.map(formatGmFactionMarketplaceV2Line).filter(Boolean);
  if (!lines.length) return { written: 0, error: '' };
  try {
    await writeInventoryBasisLinesToInflux(settings, lines.join('\n'));
    return { written: lines.length, error: '' };
  } catch (error) {
    return { written: 0, error: marketplacePublicationErrorCode(error?.message, 'marketplace_faction_v2_write_failed') };
  }
}

function buildGmShadowWalletUniverse(gmTradingWallets, assetFlows) {
  const profileWalletsByFaction = { MUD: [], ONI: [], USTUR: [] };
  for (const flow of assetFlows || []) {
    const faction = normalizeFaction(flow.faction);
    if (!profileWalletsByFaction[faction]) continue;
    const location = flow.flow === 'css-deposit' ? flow.origin : flow.flow === 'css-withdraw' ? flow.destination : '';
    const match = String(location).match(/^wallet:(.+)$/);
    if (match) profileWalletsByFaction[faction].push(match[1]);
  }
  return buildGmWalletUniverse({ gmTradingWallets, profileWalletsByFaction });
}

function marketplaceTradeRank(trade) {
  return String(trade.orderId || '').trim() || String(trade.creationSignature || '').trim() || Number(trade.txFeeAtlas || 0) !== 0
    ? 'enriched' : 'fallback';
}

function marketplaceTradePublicationCandidate(trade, { market, faction, profileScope }) {
  const rank = marketplaceTradeRank(trade);
  const identity = {
    market, faction, profileScope, executionSignature: String(trade.signature),
    rawMint: String(trade.rawMint), side: trade.side, quantity: trade.quantity,
  };
  const common = {
    [`${rank}Quantity`]: trade.quantity,
    [`${rank}SettledAtlas`]: trade.settledAtlas,
    [`${rank}GrossAtlas`]: trade.grossAtlas ?? trade.settledAtlas,
    [`${rank}MarketplaceFeeAtlas`]: trade.marketplaceFeeAtlas ?? 0,
    [`${rank}NetAtlas`]: trade.netAtlas ?? trade.settledAtlas,
    [`${rank}UnitPriceAtlas`]: trade.unitPriceAtlas,
    [`${rank}Wallet`]: String(trade.wallet || ''),
    [`${rank}Starbase`]: String(trade.starbase || ''),
    [`${rank}Asset`]: String(trade.asset || ''),
    [`${rank}CertificateMint`]: String(trade.certificateMint || ''),
  };
  if (rank === 'enriched') {
    common.enrichedTxFeeAtlas = trade.txFeeAtlas ?? 0;
    common.enrichedOrderId = String(trade.orderId || '');
    common.enrichedCreationSignature = String(trade.creationSignature || '');
  }
  return {
    logicalKey: deriveMarketplaceTradeId(identity),
    currentId: String(trade.id || ''),
    representationRank: rank,
    source: trade,
    record: {
      eventType: 'trade', identity,
      pointTimestampNs: String(BigInt(new Date(trade.timestamp).getTime()) * 1000000n),
      sourceVersion: `${rank}_v1`, fields: common,
    },
  };
}

function marketplaceFlowPublicationCandidate(event) {
  return { logicalKey: String(event.id), currentId: String(event.id), source: event, record: { eventType: 'asset_flow', ...event } };
}

function groupMarketplacePublicationCandidates(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = candidate.logicalKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  for (const rows of groups.values()) rows.sort((left, right) => {
    const rank = { fallback: 0, enriched: 1 };
    return (rank[left.representationRank] ?? 0) - (rank[right.representationRank] ?? 0)
      || left.currentId.localeCompare(right.currentId);
  });
  return new Map(Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right)));
}

function findMarketplaceOutboxEvent(document, candidate) {
  for (const generation of Object.values(document?.generations || {})) {
    for (const event of Object.values(generation.events || {})) {
      if (candidate.record.eventType === 'trade' && event.tradeId === candidate.logicalKey) return event;
      if (candidate.record.eventType === 'asset_flow' && event.flowId === candidate.logicalKey) return event;
    }
  }
  return null;
}

function marketplaceCoordinatorHoldResult(outcome) {
  if (outcome === 'publication_ambiguous') return { state: 'held_ambiguous', lastCoordinatorResult: { outcome, detailCode: outcome } };
  if (outcome === 'published_mark_failed' || outcome === 'published_mark_uncertain' || outcome === 'mark_failed_before_commit') {
    return { state: 'held_mark_failed', lastCoordinatorResult: { outcome, detailCode: outcome } };
  }
  if (outcome === 'posting') return { state: 'held_posting', lastCoordinatorResult: { outcome, detailCode: outcome } };
  if (outcome === 'publication_failed' || outcome === 'stage_failed') {
    return { state: 'held_staged', lastCoordinatorResult: { outcome: 'publication_failed', detailCode: outcome } };
  }
  if (MARKETPLACE_PUBLICATION_SUCCESS.has(outcome)) {
    return { state: 'held_staged', lastCoordinatorResult: { outcome: outcome === 'already_published' ? outcome : 'published_confirmed', detailCode: outcome } };
  }
  return { state: outcome === 'not_configured' ? 'held_not_configured' : 'held_staged', lastCoordinatorResult: { outcome: 'pending_unattempted', detailCode: marketplacePublicationErrorCode(outcome, 'pending_unattempted') } };
}

function marketplaceEffectiveCoordinatorOutcome(result, canStage) {
  if (!canStage && result?.outcome === 'stage_failed' && result?.detailCode === 'not_configured') return 'not_configured';
  return result?.outcome || (canStage ? 'pending_unattempted' : 'not_configured');
}

function mapMarketplacePublicationResult({
  kind, outcome, detailCode, revisionId, currentRevisionId,
  currentMutableIds = [], revisionMutableIds = [], flowId = null,
}) {
  const current = Boolean(revisionId && revisionId === currentRevisionId);
  if (MARKETPLACE_PUBLICATION_SUCCESS.has(outcome)) {
    if (kind === 'asset_flow') {
      return current
        ? { publishedIds: flowId ? [flowId] : [], retainHold: false, error: '' }
        : { publishedIds: [], retainHold: true, error: 'asset_flow_superseded_revision' };
    }
    return {
      publishedIds: current ? currentMutableIds : revisionMutableIds,
      retainHold: !current,
      error: '',
    };
  }
  if (outcome === 'published_superseded_revision') {
    return kind === 'trade'
      ? { publishedIds: revisionMutableIds, retainHold: true, error: '' }
      : { publishedIds: [], retainHold: true, error: 'asset_flow_superseded_revision' };
  }
  if (MARKETPLACE_PUBLICATION_PENDING.has(outcome)) return { publishedIds: [], retainHold: true, error: '' };
  return {
    publishedIds: [], retainHold: true,
    error: marketplacePublicationErrorCode(detailCode || outcome),
  };
}

function splitMarketplaceLinePart(value, delimiter) {
  const parts = []; let current = ''; let escaped = false; let quoted = false;
  for (const character of String(value)) {
    if (escaped) { current += character; escaped = false; continue; }
    if (character === '\\') { current += character; escaped = true; continue; }
    if (character === '"') { current += character; quoted = !quoted; continue; }
    if (character === delimiter && !quoted) { parts.push(current); current = ''; continue; }
    current += character;
  }
  parts.push(current); return parts;
}

function unescapeMarketplaceLineValue(value) {
  return String(value).replace(/\\([ ,=\\"])/g, '$1');
}

function parseMarketplaceLineForReconciliation(line) {
  const text = String(line || '');
  let firstSpace = -1; let lastSpace = -1; let escaped = false; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === ' ' && !quoted) { if (firstSpace < 0) firstSpace = index; lastSpace = index; }
  }
  if (firstSpace <= 0 || lastSpace <= firstSpace) return null;
  const identityParts = splitMarketplaceLinePart(text.slice(0, firstSpace), ',');
  const measurement = unescapeMarketplaceLineValue(identityParts.shift());
  const tags = {};
  for (const part of identityParts) {
    const [key, ...rest] = splitMarketplaceLinePart(part, '=');
    if (!key || !rest.length) return null;
    tags[unescapeMarketplaceLineValue(key)] = unescapeMarketplaceLineValue(rest.join('='));
  }
  const fields = {};
  for (const part of splitMarketplaceLinePart(text.slice(firstSpace + 1, lastSpace), ',')) {
    const [key, ...rest] = splitMarketplaceLinePart(part, '=');
    if (!key || !rest.length) return null;
    const raw = rest.join('=');
    fields[unescapeMarketplaceLineValue(key)] = raw.startsWith('"') && raw.endsWith('"')
      ? unescapeMarketplaceLineValue(raw.slice(1, -1)) : Number(raw.replace(/i$/, ''));
  }
  const pointTimestampNs = text.slice(lastSpace + 1);
  if (!/^(?:0|-?[1-9]\d*)$/.test(pointTimestampNs)) return null;
  return { measurement, tags, fields, pointTimestampNs };
}

function marketplaceFluxString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function resolveMarketplaceExactPoint(settings, exact) {
  try {
    const organization = await resolveMarketplacePublicationOrganization(settings);
    const publicationSettings = marketplacePublicationSettings(settings, organization);
    const token = String(settings.influxAuthToken || '').trim().replace(/^(?:Token|Bearer)\s+/i, '');
    if (!publicationSettings.baseUrl || !publicationSettings.bucket || !organization || !token) return { outcome: 'indeterminate' };
    const loaded = await loadMarketplaceOutboxV2({
      storageRoot: publicationSettings.storageRoot,
      installationId: publicationSettings.installationId,
      applicationProfile: publicationSettings.applicationProfile,
    });
    const found = findMarketplaceOutboxRevision(loaded.document, exact.eventId, exact.revisionId);
    const expected = parseMarketplaceLineForReconciliation(found?.revision?.payload?.line);
    if (!expected || expected.pointTimestampNs !== exact.pointTimestampNs || found.revision.payloadHash !== exact.payloadHash) {
      return { outcome: 'indeterminate' };
    }
    const stopNs = String(BigInt(expected.pointTimestampNs) + 1n);
    const tagFilters = Object.entries(expected.tags)
      .map(([key, value]) => `r[${marketplaceFluxString(key)}] == ${marketplaceFluxString(value)}`).join(' and ');
    const query = `from(bucket: ${marketplaceFluxString(publicationSettings.bucket)})\n`
      + `  |> range(start: time(v: ${expected.pointTimestampNs}), stop: time(v: ${stopNs}))\n`
      + `  |> filter(fn: (r) => r._measurement == ${marketplaceFluxString(expected.measurement)}${tagFilters ? ` and ${tagFilters}` : ''})\n`
      + '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n'
      + '  |> limit(n: 2)';
    const response = await fetchWithInfluxRetry(({ signal }) => fetch(`${getInfluxBaseUrl(settings.influxUrl)}/api/v2/query?org=${encodeURIComponent(organization)}`, {
      method: 'POST', headers: { Accept: 'text/csv', Authorization: `Token ${token}`, 'Content-Type': 'application/vnd.flux' },
      body: query, signal,
    }), { timeoutMs: 15_000, retries: 1, retryDelayMs: 250 });
    if (!response.ok) return { outcome: 'indeterminate' };
    const rows = parseInfluxCsv(await response.text());
    if (!rows.length) return { outcome: 'absent' };
    const matched = rows.some((row) => Object.entries(expected.fields).every(([key, value]) => {
      if (!Object.hasOwn(row, key)) return false;
      return typeof value === 'number' ? Number(row[key]) === value : String(row[key]) === value;
    }));
    return matched ? { outcome: 'matched', payloadHash: exact.payloadHash } : { outcome: 'mismatch' };
  } catch (_error) {
    return { outcome: 'indeterminate' };
  }
}

async function publishMarketplaceCandidateSet(settings, candidates, holdContext, { commitSafeCursor } = {}) {
  try {
    if (typeof commitSafeCursor === 'function') await commitSafeCursor();
  } catch (_error) {
    return {
      publishedTradeIds: new Set(), publishedFlowIds: new Set(), holdIdsToComplete: [], tradeHoldIdsToComplete: [], flowHoldIdsToComplete: [],
      allCurrentComplete: false, allTradeCurrentComplete: false, allFlowCurrentComplete: false, allEnrichableComplete: false,
      error: 'safe_cursor_checkpoint_failed', safeCursorCommitted: false,
    };
  }
  return {
    publishedTradeIds: new Set(), publishedFlowIds: new Set(), holdIdsToComplete: [], tradeHoldIdsToComplete: [], flowHoldIdsToComplete: [],
    allCurrentComplete: true, allTradeCurrentComplete: true, allFlowCurrentComplete: true, allEnrichableComplete: true,
    error: '', safeCursorCommitted: true,
  };
  // Frozen legacy publication implementation is retained below for tomorrow's
  // deliberate removal; the canonical raw-data checkpoint above is now the boundary.
  const groups = groupMarketplacePublicationCandidates(candidates);
  const stagedCandidates = [];
  const representativeByGroupRank = new Map();
  for (const [logicalKey, rows] of groups) {
    const byRank = new Map();
    for (const row of rows) {
      const rank = row.representationRank || 'asset_flow';
      const prior = byRank.get(rank);
      if (!prior || JSON.stringify(row.record) < JSON.stringify(prior.record)) byRank.set(rank, row);
    }
    for (const rank of ['fallback', 'enriched', 'asset_flow']) {
      const representative = byRank.get(rank);
      if (!representative) continue;
      representativeByGroupRank.set(`${logicalKey}:${rank}`, representative);
      stagedCandidates.push(representative);
    }
  }
  const stagedCandidateIndexes = new Map(stagedCandidates.map((candidate, index) => [candidate, index]));
  const organization = await resolveMarketplacePublicationOrganization(settings);
  const publicationSettings = marketplacePublicationSettings(settings, organization);
  const canStage = Boolean(publicationSettings.baseUrl && publicationSettings.bucket);
  const coordinatorSettings = canStage ? publicationSettings : { ...publicationSettings, token: '' };
  let durable = true;
  const preRecordedHolds = new Map();
  for (const [logicalKey, rows] of groups) {
    const current = rows.find((row) => row.representationRank === 'enriched') || rows[rows.length - 1];
    const candidate = current.record.eventType === 'asset_flow'
      ? marketplaceFlowHoldCandidate(current.source, holdContext, rows.map((row) => ({ currentId: row.currentId, representationRank: row.representationRank, record: row.record })))
      : marketplaceTradeHoldCandidate(current.source, holdContext, rows.map((row) => ({ currentId: row.currentId, representationRank: row.representationRank, record: row.record })));
    const currentRank = current.representationRank || 'asset_flow';
    candidate.currentMutableIds = current.record.eventType === 'trade'
      ? Array.from(new Set(rows.filter((row) => (row.representationRank || 'asset_flow') === currentRank)
        .map((row) => row.currentId).filter(Boolean))).sort() : [];
    candidate.observedMutableIdsByRank = Object.fromEntries(Array.from(new Set(rows.map((row) => row.representationRank || 'asset_flow')))
      .map((rank) => [rank, current.record.eventType === 'trade'
        ? Array.from(new Set(rows.filter((row) => (row.representationRank || 'asset_flow') === rank)
          .map((row) => row.currentId).filter(Boolean))).sort() : []]));
    const recorded = await recordMarketplacePublicationHold({ installationRoot: getAppRoot(), candidate });
    if (!['hold_recorded', 'hold_updated', 'hold_unchanged'].includes(recorded.status)) durable = false;
    else preRecordedHolds.set(logicalKey, recorded.hold.holdId);
  }
  const stagingCoordinator = createMarketplacePublicationCoordinator();
  let staging;
  try {
    staging = await stagingCoordinator.publishMarketplaceCandidates({ settings: coordinatorSettings, candidates: stagedCandidates });
  } catch (error) {
    staging = { results: stagedCandidates.map(() => ({ outcome: 'stage_failed', detailCode: marketplacePublicationErrorCode(error?.code || error?.message) })) };
  }
  const stagedOutbox = await loadMarketplaceOutboxV2({
    storageRoot: publicationSettings.storageRoot,
    installationId: publicationSettings.installationId,
    applicationProfile: publicationSettings.applicationProfile,
  });
  const stagedDocument = stagedOutbox.status === 'loaded' ? stagedOutbox.document : null;
  for (const [logicalKey, rows] of groups) {
    const current = rows.find((row) => row.representationRank === 'enriched') || rows[rows.length - 1];
    const event = findMarketplaceOutboxEvent(stagedDocument, current);
    if (!event) continue; // The complete pre-stage retry hold remains authoritative.
    const currentRank = current.representationRank || 'asset_flow';
    const currentRows = rows.filter((row) => (row.representationRank || 'asset_flow') === currentRank);
    const observedMutableIdsByRevision = {};
    const observedMutableIdsByRank = {};
    for (const row of rows) {
      const rank = row.representationRank || 'asset_flow';
      const revision = Object.values(event.revisions || {}).find((value) => value.revisionKind === rank);
      const ids = row.record.eventType === 'trade' ? rows.filter((value) => (value.representationRank || 'asset_flow') === rank)
        .map((value) => value.currentId).filter(Boolean) : [];
      if (revision) observedMutableIdsByRevision[revision.revisionId] = Array.from(new Set(ids)).sort();
      observedMutableIdsByRank[rank] = Array.from(new Set(ids)).sort();
    }
    const candidate = current.record.eventType === 'asset_flow'
      ? marketplaceFlowHoldCandidate(current.source, holdContext, rows.map((row) => ({ currentId: row.currentId, representationRank: row.representationRank, record: row.record })))
      : marketplaceTradeHoldCandidate(current.source, holdContext, rows.map((row) => ({ currentId: row.currentId, representationRank: row.representationRank, record: row.record })));
    candidate.eventId = event.eventId;
    candidate.currentRevisionId = event.currentRevisionId;
    candidate.currentRank = currentRank;
    candidate.currentMutableIds = current.record.eventType === 'trade'
      ? Array.from(new Set(currentRows.map((value) => value.currentId).filter(Boolean))).sort() : [];
    candidate.observedMutableIdsByRevision = observedMutableIdsByRevision;
    candidate.observedMutableIdsByRank = observedMutableIdsByRank;
    const recorded = await recordMarketplacePublicationHold({ installationRoot: getAppRoot(), candidate });
    if (!['hold_recorded', 'hold_updated', 'hold_unchanged'].includes(recorded.status)) durable = false;
    else preRecordedHolds.set(logicalKey, recorded.hold.holdId);
  }
  if (!durable || preRecordedHolds.size !== groups.size) {
    return {
      publishedTradeIds: new Set(), publishedFlowIds: new Set(), holdIdsToComplete: [], tradeHoldIdsToComplete: [], flowHoldIdsToComplete: [],
      allCurrentComplete: false, allTradeCurrentComplete: false, allFlowCurrentComplete: false, allEnrichableComplete: false,
      error: 'publication_hold_write_failed', safeCursorCommitted: false,
    };
  }
  try {
    if (typeof commitSafeCursor === 'function') await commitSafeCursor();
  } catch (_error) {
    return {
      publishedTradeIds: new Set(), publishedFlowIds: new Set(), holdIdsToComplete: [], tradeHoldIdsToComplete: [], flowHoldIdsToComplete: [],
      allCurrentComplete: false, allTradeCurrentComplete: false, allFlowCurrentComplete: false, allEnrichableComplete: false,
      error: 'safe_cursor_checkpoint_failed', safeCursorCommitted: false,
    };
  }
  const stagingFailed = (staging.results || []).some((result) => result.outcome === 'stage_failed' && result.detailCode !== 'not_configured');
  const coordinator = createMarketplacePublicationCoordinator({
    fetchImpl: publicationSettings.canPost && !stagingFailed ? fetch : undefined,
    resolveExactPoint: stagingFailed ? undefined : (exact) => resolveMarketplaceExactPoint(settings, exact),
  });
  let publication;
  try {
    publication = await coordinator.publishMarketplaceCandidates({ settings: coordinatorSettings, candidates: stagedCandidates });
  } catch (error) {
    publication = { results: stagedCandidates.map(() => ({ outcome: 'stage_failed', detailCode: marketplacePublicationErrorCode(error?.code || error?.message) })) };
  }
  const outbox = await loadMarketplaceOutboxV2({
    storageRoot: publicationSettings.storageRoot,
    installationId: publicationSettings.installationId,
    applicationProfile: publicationSettings.applicationProfile,
  });
  const document = outbox.status === 'loaded' ? outbox.document : null;
  const publishedTradeIds = new Set();
  const publishedFlowIds = new Set();
  const holdIdsToComplete = [];
  const tradeHoldIdsToComplete = [];
  const flowHoldIdsToComplete = [];
  const errors = [];
  let allCurrentComplete = true;
  let allTradeCurrentComplete = true;
  let allFlowCurrentComplete = true;
  let allEnrichableComplete = true;

  for (const [logicalKey, rows] of groups) {
    const current = rows.find((row) => row.representationRank === 'enriched') || rows[rows.length - 1];
    const currentRank = current.representationRank || 'asset_flow';
    const currentRows = rows.filter((row) => (row.representationRank || 'asset_flow') === currentRank);
    const currentRepresentative = representativeByGroupRank.get(`${logicalKey}:${currentRank}`);
    const event = findMarketplaceOutboxEvent(document, current);
    const observedMutableIdsByRevision = {};
    const observedMutableIdsByRank = {};
    for (const row of rows) {
      const rank = row.representationRank || 'asset_flow';
      const revision = event && Object.values(event.revisions || {}).find((value) => value.revisionKind === rank);
      if (revision) {
        observedMutableIdsByRevision[revision.revisionId] = Array.from(new Set([
          ...(observedMutableIdsByRevision[revision.revisionId] || []), row.currentId,
        ].filter(Boolean))).sort();
      }
      observedMutableIdsByRank[rank] = row.record.eventType === 'trade'
        ? Array.from(new Set([...(observedMutableIdsByRank[rank] || []), row.currentId].filter(Boolean))).sort()
        : [];
    }
    const currentRevisionId = event?.currentRevisionId || null;
    const currentRevision = currentRevisionId ? event?.revisions?.[currentRevisionId] : null;
    const currentIndex = stagedCandidateIndexes.get(currentRepresentative);
    const currentOutcome = marketplaceEffectiveCoordinatorOutcome(publication.results?.[currentIndex], canStage);
    const currentComplete = Boolean(currentRevision && currentRevision.state === 'published');
    allCurrentComplete = allCurrentComplete && currentComplete;
    if (current.record.eventType === 'trade') allTradeCurrentComplete = allTradeCurrentComplete && currentComplete;
    else allFlowCurrentComplete = allFlowCurrentComplete && currentComplete;
    if (rows.some((row) => row.representationRank === 'enriched')) allEnrichableComplete = allEnrichableComplete && currentComplete;

    rows.forEach((row) => {
      const representative = representativeByGroupRank.get(`${logicalKey}:${row.representationRank || 'asset_flow'}`);
      const index = stagedCandidateIndexes.get(representative);
      const outcome = marketplaceEffectiveCoordinatorOutcome(publication.results?.[index], canStage);
      const revision = event && Object.values(event.revisions || {}).find((value) => value.revisionKind === (row.representationRank || 'asset_flow'));
      const mapped = mapMarketplacePublicationResult({
        kind: row.record.eventType, outcome,
        detailCode: publication.results?.[index]?.detailCode,
        revisionId: revision?.revisionId || null, currentRevisionId,
        currentMutableIds: currentRows.map((value) => value.currentId).filter(Boolean),
        revisionMutableIds: rows.filter((value) => (value.representationRank || 'asset_flow') === (row.representationRank || 'asset_flow'))
          .map((value) => value.currentId).filter(Boolean),
        flowId: row.currentId,
      });
      for (const id of mapped.publishedIds) {
        if (row.record.eventType === 'asset_flow') publishedFlowIds.add(id);
        else publishedTradeIds.add(id);
      }
      if (mapped.error) errors.push(mapped.error);
    });

    const candidate = current.record.eventType === 'asset_flow'
      ? marketplaceFlowHoldCandidate(current.source, holdContext, rows.map((row) => ({ currentId: row.currentId, representationRank: row.representationRank, record: row.record })))
      : marketplaceTradeHoldCandidate(current.source, holdContext, rows.map((row) => ({ currentId: row.currentId, representationRank: row.representationRank, record: row.record })));
    candidate.eventId = event?.eventId || null;
    candidate.currentRevisionId = currentRevisionId;
    candidate.currentRank = current.representationRank || 'asset_flow';
    candidate.currentMutableIds = current.record.eventType === 'trade'
      ? Array.from(new Set(currentRows.map((value) => value.currentId).filter(Boolean))).sort() : [];
    candidate.observedMutableIdsByRevision = observedMutableIdsByRevision;
    candidate.observedMutableIdsByRank = observedMutableIdsByRank;
    let recorded;
    try { recorded = await recordMarketplacePublicationHold({ installationRoot: getAppRoot(), candidate }); }
    catch (_error) { recorded = { status: 'storage_failed', hold: null }; }
    if (!['hold_recorded', 'hold_updated', 'hold_unchanged'].includes(recorded.status)) {
      errors.push('publication_hold_write_failed'); allCurrentComplete = false; continue;
    }
    const mapped = marketplaceCoordinatorHoldResult(currentOutcome);
    const updated = await updateMarketplacePublicationHold({
      installationRoot: getAppRoot(), holdId: recorded.hold.holdId,
      eventId: event?.eventId || null, currentRevisionId,
      state: mapped.state, lastCoordinatorResult: mapped.lastCoordinatorResult,
    });
    if (updated.status !== 'hold_updated') errors.push('publication_hold_update_failed');
    if (currentComplete) {
      holdIdsToComplete.push(recorded.hold.holdId);
      if (current.record.eventType === 'trade') tradeHoldIdsToComplete.push(recorded.hold.holdId);
      else flowHoldIdsToComplete.push(recorded.hold.holdId);
    }
  }
  return {
    publishedTradeIds, publishedFlowIds, holdIdsToComplete, tradeHoldIdsToComplete, flowHoldIdsToComplete,
    allCurrentComplete, allTradeCurrentComplete, allFlowCurrentComplete, allEnrichableComplete,
    error: Array.from(new Set(errors)).sort().join('; '), safeCursorCommitted: true,
  };
}

async function completeMarketplacePublicationHolds(holdIds) {
  let complete = true;
  for (const holdId of holdIds) {
    const result = await completeMarketplacePublicationHold({
      installationRoot: getAppRoot(), holdId, checkpointWritten: true,
      currentRevisionPublished: true, mutableIdsRecorded: true, reconciliationClear: true,
    });
    if (!['released', 'hold_updated'].includes(result.status)) complete = false;
  }
  return complete;
}

async function hasActiveMarketplacePublicationHolds(market, kinds) {
  const loaded = await loadMarketplacePublicationHolds({ installationRoot: getAppRoot() });
  if (loaded.status === 'missing') return false;
  if (loaded.status !== 'loaded') return true;
  const selectedKinds = new Set(kinds);
  return Object.values(loaded.document.holds).some((hold) => hold.market === market
    && selectedKinds.has(hold.kind) && hold.state !== 'released' && hold.state !== 'abandoned');
}

function findMarketplaceOutboxRevision(document, eventId, revisionId) {
  for (const generation of Object.values(document?.generations || {})) {
    const event = generation.events?.[eventId];
    if (event?.revisions?.[revisionId]) return { event, revision: event.revisions[revisionId] };
  }
  return null;
}

async function persistRecoveredMarketplaceIds(hold, { tradeIds = [], flowIds = [] } = {}) {
  const filePath = hold.market === 'LM'
    ? localMarketCheckpointPath(normalizeFaction(hold.candidateSnapshot?.faction || profileName))
    : globalMarketCheckpointPath();
  let document;
  try { document = JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (hold.kind === 'trade') {
    document.publishedTradeIds = Array.from(new Set([
      ...(Array.isArray(document.publishedTradeIds) ? document.publishedTradeIds : []),
      ...tradeIds,
    ])).sort();
  } else {
    document.publishedFlowIds = Array.from(new Set([
      ...(Array.isArray(document.publishedFlowIds) ? document.publishedFlowIds : []),
      ...flowIds,
    ])).sort();
  }
  document.savedAt = new Date().toISOString();
  await writeJsonAtomic(filePath, document);
  return true;
}

async function recoverMarketplacePublication(settings) {
  const organization = await resolveMarketplacePublicationOrganization(settings);
  const publicationSettings = marketplacePublicationSettings(settings, organization);
  const canStage = Boolean(publicationSettings.baseUrl && publicationSettings.bucket);
  const coordinatorSettings = canStage ? publicationSettings : { ...publicationSettings, token: '' };
  const coordinator = createMarketplacePublicationCoordinator({
    fetchImpl: publicationSettings.canPost ? fetch : undefined,
    resolveExactPoint: (exact) => resolveMarketplaceExactPoint(settings, exact),
  });
  const retryHolds = await loadMarketplacePublicationHolds({ installationRoot: getAppRoot() });
  const retryCandidates = retryHolds.status === 'loaded' ? Object.values(retryHolds.document.holds)
    .filter((hold) => hold.state !== 'released' && hold.state !== 'abandoned' && Array.isArray(hold.candidateSnapshot?.publicationInputs))
    .flatMap((hold) => hold.candidateSnapshot.publicationInputs.map((input) => ({
      logicalKey: hold.logicalKeyOrSourceId,
      currentId: input.currentId,
      representationRank: hold.kind === 'asset_flow' ? undefined : input.representationRank,
      record: input.record,
    }))) : [];
  // Empty-candidate publication drains durable pending work and reconciles
  // posting work; it does not depend on scanner rows surviving a restart.
  try { await coordinator.publishMarketplaceCandidates({ settings: coordinatorSettings, candidates: retryCandidates }); }
  catch (_error) { /* durable outbox and holds remain authoritative */ }
  const [holds, outbox] = await Promise.all([
    loadMarketplacePublicationHolds({ installationRoot: getAppRoot() }),
    loadMarketplaceOutboxV2({
      storageRoot: publicationSettings.storageRoot,
      installationId: publicationSettings.installationId,
      applicationProfile: publicationSettings.applicationProfile,
    }),
  ]);
  if (holds.status !== 'loaded' || outbox.status !== 'loaded') return { status: 'recovery_idle' };
  let recovered = 0;
  for (let hold of Object.values(holds.document.holds)) {
    if (hold.state === 'released' || hold.state === 'abandoned') continue;
    if (!hold.eventId || !hold.currentRevisionId) {
      const currentInput = (hold.candidateSnapshot?.publicationInputs || []).find((input) => hold.kind === 'asset_flow'
        || input.representationRank === hold.candidateSnapshot.currentRank);
      const event = currentInput && findMarketplaceOutboxEvent(outbox.document, {
        logicalKey: hold.logicalKeyOrSourceId, record: currentInput.record,
      });
      const revisionId = event?.currentRevisionId;
      if (event && revisionId) {
        const observedMutableIdsByRevision = {};
        if (hold.kind === 'trade') {
          for (const input of hold.candidateSnapshot.publicationInputs || []) {
            const revision = Object.values(event.revisions || {}).find((value) => value.revisionKind === input.representationRank);
            if (revision) observedMutableIdsByRevision[revision.revisionId] = hold.observedMutableIdsByRank?.[input.representationRank] || [];
          }
        }
        const updated = await updateMarketplacePublicationHold({
          installationRoot: getAppRoot(), holdId: hold.holdId,
          eventId: event.eventId, currentRevisionId: revisionId,
          observedMutableIdsByRevision,
        });
        if (updated.status === 'hold_updated') hold = updated.hold;
      }
    }
    if (!hold.eventId || !hold.currentRevisionId) continue;
    const found = findMarketplaceOutboxRevision(outbox.document, hold.eventId, hold.currentRevisionId);
    if (!found) continue;
    const publishedTradeIds = [];
    if (hold.kind === 'trade') {
      for (const [revisionId, mutableIds] of Object.entries(hold.observedMutableIdsByRevision || {})) {
        const observed = findMarketplaceOutboxRevision(outbox.document, hold.eventId, revisionId);
        if (observed && ['published', 'superseded_published'].includes(observed.revision.state)) {
          publishedTradeIds.push(...mutableIds);
        }
      }
    }
    if (found.revision.state !== 'published' && publishedTradeIds.length) {
      try { await persistRecoveredMarketplaceIds(hold, { tradeIds: publishedTradeIds }); }
      catch (_error) { /* current revision remains held and input cursors stay safe */ }
    }
    if (found.revision.state === 'published') {
      try {
        const checkpointWritten = await persistRecoveredMarketplaceIds(hold, {
          tradeIds: publishedTradeIds,
          flowIds: hold.kind === 'asset_flow' ? hold.observedFlowIds : [],
        });
        if (!checkpointWritten) continue;
        const completed = await completeMarketplacePublicationHold({
          installationRoot: getAppRoot(), holdId: hold.holdId, checkpointWritten: true,
          currentRevisionPublished: true, mutableIdsRecorded: true, reconciliationClear: true,
        });
        if (completed.status === 'released') recovered += 1;
      } catch (_error) {
        // A checkpoint failure intentionally leaves the hold active.
      }
    } else if (found.revision.state === 'posting') {
      const reconciliation = await resolveMarketplaceExactPoint(settings, {
        eventId: hold.eventId, revisionId: hold.currentRevisionId,
        pointTimestampNs: found.event.pointTimestampNs,
        payloadHash: found.revision.payloadHash,
      });
      await updateMarketplacePublicationHold({
        installationRoot: getAppRoot(), holdId: hold.holdId,
        state: reconciliation.outcome === 'matched' ? 'held_mark_failed' : 'held_ambiguous',
        lastCoordinatorResult: {
          outcome: reconciliation.outcome === 'matched' ? 'published_mark_failed' : 'publication_ambiguous',
          detailCode: marketplacePublicationErrorCode(`reconciliation_${reconciliation.outcome}`),
        },
      });
    } else if (['pending', 'failed_retryable', 'superseded_pending'].includes(found.revision.state)) {
      await updateMarketplacePublicationHold({
        installationRoot: getAppRoot(), holdId: hold.holdId, state: 'held_staged',
        lastCoordinatorResult: { outcome: 'pending_unattempted', detailCode: 'reconciled_pending' },
      });
    }
  }
  return { status: 'recovery_complete', recovered };
}

async function fetchLocalMarketTrades(settings, connection) {
  const faction = normalizeFaction(settings.faction);
  const profile = getSelectedPlayerProfile(settings);
  if (!profile) return { trades: [], error: 'local_market_profile_not_configured' };
  let accountInfo;
  try {
    accountInfo = await connection.getAccountInfo(new PublicKey(profile), 'confirmed');
  } catch (error) {
    if (!isMarketplaceRpcBudgetExhaustedError(error)) throw error;
    return { trades: [], error: '', rpc: null, exhaustion: error };
  }
  const executionWallets = decodePlayerProfileWallets(accountInfo);
  const trackedWallets = decodePlayerProfileMarketplaceWallets(accountInfo);
  if (!trackedWallets.length) return { trades: [], error: 'local_market_profile_has_no_active_wallets' };
  let marketAssetsByMint;
  try {
    marketAssetsByMint = await buildLocalMarketAssetMap(connection, faction);
  } catch (error) {
    if (!isMarketplaceRpcBudgetExhaustedError(error)) throw error;
    return { trades: [], error: '', rpc: null, exhaustion: error };
  }
  const filePath = localMarketCheckpointPath(faction);
  const checkpoint = await loadLocalMarketTradeCheckpoint(filePath);
  let openOrders;
  try {
    openOrders = await fetchOpenLocalMarketOrderIds(connection, trackedWallets);
  } catch (error) {
    if (!isMarketplaceRpcBudgetExhaustedError(error)) throw error;
    return { trades: [], error: '', rpc: null, exhaustion: error };
  }
  const existing = checkpoint.trades;
  const startIso = MARKETPLACE_HISTORY_CUTOVER_ISO;
  const startMs = Date.parse(startIso);
  const checkpointNewestMs = existing.reduce((max, trade) => Math.max(max, Date.parse(trade.timestamp) || 0), startMs);
  // Anchor: use the newer of the local checkpoint or what InfluxDB
  // already has under the 'marketplace' measurement. This way a wiped
  // checkpoint, or a fresh install pointing at a populated bucket,
  // never re-scans more than the 1h overlap below.
  const influxNewestMs = await fetchNewestMarketplaceTradeMs(settings).catch(() => null);
  const anchorMs = Math.max(checkpointNewestMs, Number.isFinite(influxNewestMs) ? influxNewestMs : 0, startMs);
  const overlapStart = new Date(Math.max(startMs, anchorMs - 60 * 60 * 1000)).toISOString();
  const needsTradeEnrichment = checkpoint.tradeEnrichmentVersion < 2;
  const migrationWalletCursors = checkpoint.walletCursors;
  const historicalOrderIds = needsTradeEnrichment ? loadLocalMarketHistoricalOrderIds(faction, startIso) : [];
  const cursorInputSnapshot = marketplaceCursorSnapshot(
    migrationWalletCursors,
    needsTradeEnrichment ? {} : checkpoint.orderCursors,
    needsTradeEnrichment ? checkpoint.orders.map((order) => String(order.orderId)).filter(Boolean) : checkpoint.activeOrderIds,
    needsTradeEnrichment ? [] : checkpoint.archivedOrderIds,
  );
  const scanned = await scanLocalMarketTrades(connection, {
    trackedWallets,
    executionWallets,
    marketAssetsByMint,
    knownOrders: checkpoint.orders,
    ...cursorInputSnapshot,
    openOrderIds: openOrders.orderIds,
    historicalOrderIds,
    transactionBatchSize: 5,
    maxPages: 1,
    startIso: needsTradeEnrichment ? startIso : overlapStart,
    addressFactory: (value) => new PublicKey(value),
    atlasPerSol: await fetchAtlasPerSol().then((quote) => quote?.atlasPerSol).catch(() => null),
  });
  const byId = new Map(existing.map((trade) => [trade.id, trade]));
  const publicationRepresentations = Array.from(new Map(
    [...existing, ...scanned.trades].map((trade) => [String(trade.id), trade]),
  ).values()).filter((trade) => Date.parse(trade.timestamp) >= startMs);
  for (const trade of scanned.trades) {
    for (const [id, prior] of byId) {
      const sameExecution = prior.signature && prior.signature === trade.signature
        && String(prior.rawMint || '') === String(trade.rawMint || '')
        && String(prior.side || '') === String(trade.side || '')
        && Number(prior.quantity || 0) === Number(trade.quantity || 0);
      if (id !== trade.id && sameExecution) byId.delete(id);
    }
    byId.set(trade.id, trade);
  }
  const trades = Array.from(byId.values()).filter((trade) => Date.parse(trade.timestamp) >= startMs)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  const lmRawRecords = buildLmRawRecords({ transactions: scanned.rawTransactions });
  try {
    await writeMarketplaceRawRecords(settings, lmRawRecords);
  } catch (error) {
    return {
      trades,
      error: marketplacePublicationErrorCode(error?.message, 'marketplace_rawdata_lm_write_failed'),
      rpc: { ...scanned.stats, openOrderRequests: openOrders.requestCount, totalRpcRequests: scanned.stats.totalRpcRequests + openOrders.requestCount },
      exhaustion: scanned.exhaustion || null,
    };
  }
  const checkpointCursors = resolveMarketplaceCheckpointCursors(checkpoint, scanned);
  const cursorOutputSnapshot = {
    walletCursors: checkpointCursors.walletCursors,
    orderCursors: checkpointCursors.orderCursors,
    activeOrderIds: scanned.activeOrderIds,
    archivedOrderIds: scanned.archivedOrderIds,
  };
  const safeCheckpointDocument = {
    schemaVersion: 2, faction, profile, savedAt: new Date().toISOString(),
    orders: scanned.orders, trades, ...cursorOutputSnapshot,
    publishedTradeIds: Array.from(checkpoint.publishedTradeIds).sort(),
    marketplaceBackfilled: false, tradeEnrichmentVersion: checkpoint.tradeEnrichmentVersion,
  };
  const publication = await publishMarketplaceCandidateSet(
    settings,
    publicationRepresentations.map((trade) => marketplaceTradePublicationCandidate(trade, { market: 'LM', faction, profileScope: profileName })),
    { market: 'LM', faction, profileScope: profileName, cursorInputSnapshot, cursorOutputSnapshot },
    { commitSafeCursor: () => writeJsonAtomic(filePath, safeCheckpointDocument) },
  );
  if (!publication.safeCursorCommitted) return {
    trades, error: publication.error,
    rpc: { ...scanned.stats, openOrderRequests: openOrders.requestCount, totalRpcRequests: scanned.stats.totalRpcRequests + openOrders.requestCount },
    exhaustion: scanned.exhaustion || null,
  };
  for (const id of publication.publishedTradeIds) checkpoint.publishedTradeIds.add(id);
  let publishError = publication.error;
  const checkpointDocument = {
    ...safeCheckpointDocument, savedAt: new Date().toISOString(), ...cursorOutputSnapshot,
    publishedTradeIds: Array.from(checkpoint.publishedTradeIds).sort(),
  };
  // The durable checkpoint containing the applicable mutable IDs is written
  // before any hold can be completed or released.
  await writeJsonAtomic(filePath, checkpointDocument);
  const holdsCompleted = await completeMarketplacePublicationHolds(publication.holdIdsToComplete);
  const hasActiveTradeHold = await hasActiveMarketplacePublicationHolds('LM', ['trade']);
  const marketplaceBackfilledNext = publication.allCurrentComplete && holdsCompleted && !hasActiveTradeHold;
  const tradeEnrichmentVersionNext = marketplaceBackfilledNext
    && scanned.stats.transactionMisses === 0 && publishError === '' && publication.allEnrichableComplete
    ? 2 : checkpoint.tradeEnrichmentVersion;
  await writeJsonAtomic(filePath, {
    ...checkpointDocument, savedAt: new Date().toISOString(), ...cursorOutputSnapshot,
    marketplaceBackfilled: marketplaceBackfilledNext,
    tradeEnrichmentVersion: tradeEnrichmentVersionNext,
  });
  return {
    trades,
    error: publishError,
    rpc: { ...scanned.stats, openOrderRequests: openOrders.requestCount, totalRpcRequests: scanned.stats.totalRpcRequests + openOrders.requestCount },
    exhaustion: scanned.exhaustion || null,
  };
}

async function fetchGlobalMarketTrades(settings, connection) {
  const configuredProfiles = ['MUD', 'ONI', 'USTUR'].map((faction) => ({
    faction, profile: String(settings.playerProfiles?.[faction] || '').trim(),
  })).filter((entry) => entry.profile);
  if (!configuredProfiles.length) return { trades: [], error: 'gm_profile_not_configured' };
  let extraWallets;
  try {
    extraWallets = parseGmTradingWallets(settings.gmTradingWallets);
  } catch (error) {
    return { trades: [], error: `gm_trading_wallet_invalid:${String(error?.message || error)}` };
  }
  const profileWalletsByFaction = { MUD: [], ONI: [], USTUR: [] };
  try {
    const profileKeys = configuredProfiles.map(({ profile }) => new PublicKey(profile));
    const accountInfos = typeof connection.getMultipleAccountsInfo === 'function'
      ? await connection.getMultipleAccountsInfo(profileKeys, 'confirmed')
      : await Promise.all(profileKeys.map((key) => connection.getAccountInfo(key, 'confirmed')));
    for (let index = 0; index < configuredProfiles.length; index += 1) {
      const { faction } = configuredProfiles[index];
      const accountInfo = accountInfos[index];
      profileWalletsByFaction[faction] = decodePlayerProfileWallets(accountInfo);
    }
  } catch (error) {
    if (!isMarketplaceRpcBudgetExhaustedError(error)) throw error;
    return { trades: [], assetFlows: [], error: '', rpc: null, exhaustion: error };
  }
  const profileWallets = Object.values(profileWalletsByFaction).flat();
  // Broad profile-wallet signature scans ingest unrelated SAGE gameplay. GM
  // execution discovery is intentionally limited to configured trading wallets;
  // CSS deposits/withdrawals and cross-profile token transfers use narrow scopes.
  const executionWallets = Array.from(new Set(extraWallets));
  const trackedWallets = Array.from(new Set(extraWallets));
  let rawDataSync;
  try {
    rawDataSync = await syncMarketplaceRawData(settings, connection, {
      gmWallets: extraWallets, configuredProfiles, profileWalletsByFaction,
    });
  } catch (error) {
    if (isMarketplaceRpcBudgetExhaustedError(error)) {
      return { trades: [], assetFlows: [], error: '', rpc: null, exhaustion: error };
    }
    rawDataSync = { transactions: 0, events: 0, rpc: null, error: marketplacePublicationErrorCode(error?.message, 'marketplace_rawdata_sync_failed') };
  }
  const filePath = globalMarketCheckpointPath();
  const checkpoint = await loadLocalMarketTradeCheckpoint(filePath);
  let openOrders;
  try {
    openOrders = await fetchOpenLocalMarketOrderIds(connection, executionWallets);
  } catch (error) {
    if (!isMarketplaceRpcBudgetExhaustedError(error)) throw error;
    return { trades: [], assetFlows: [], error: '', rpc: null, exhaustion: error };
  }
  const existing = checkpoint.trades;
  const startIso = MARKETPLACE_HISTORY_CUTOVER_ISO;
  const startMs = Date.parse(startIso);
  const assetsByMint = Object.fromEntries(ASSET_REGISTRY.map((asset) => [asset.mint, asset]));
  const starbasesByKey = Object.fromEntries(STARBASE_REGISTRY.map((starbase) => [starbase.publicKey, {
    name: starbase.name, faction: starbase.faction,
  }]));
  const atlasPerSol = await fetchAtlasPerSol().then((quote) => quote?.atlasPerSol).catch(() => null);
  const cursorInputSnapshot = marketplaceCursorSnapshot(
    checkpoint.walletCursors,
    checkpoint.orderCursors,
    checkpoint.activeOrderIds,
    checkpoint.archivedOrderIds,
  );
  const scanned = await scanLocalMarketTrades(connection, {
    trackedWallets,
    executionWallets,
    marketAssetsByMint: buildGlobalMarketAssetMap(),
    knownOrders: checkpoint.orders,
    ...cursorInputSnapshot,
    openOrderIds: openOrders.orderIds,
    transactionBatchSize: 5,
    maxPages: 1,
    startIso,
    addressFactory: (value) => new PublicKey(value),
    atlasPerSol,
    decodeAssetFlows: (transaction) => decodeMarketplaceAssetFlows(transaction, {
      trackedWallets, assetsByMint, starbasesByKey, atlasPerSol,
    }),
  });
  const gmEvents = projectMarketplaceOrderAndExecutionEvents(scanned, 'GM');
  const gmEventSignatures = new Set(gmEvents.map((event) => event.signature));
  const gmEventTransactions = scanned.rawTransactions.filter((transaction) => gmEventSignatures.has(String(
    transaction?.signature || transaction?.transaction?.signatures?.[0] || '',
  )));
  await writeMarketplaceRawRecords(settings, gmEventTransactions.map((transaction) => ({
    transaction, discoverySources: ['gm_wallet'],
  })));
  // Do not recursively signature-scan upstream or profile wallets. Cross-profile
  // movements are discovered only through the bounded token-account stream.
  const upstreamWallets = [];
  const upstreamScan = null;
  const byId = new Map(existing.map((trade) => [trade.id, trade]));
  for (const trade of scanned.trades) byId.set(trade.id, trade);
  const trades = Array.from(byId.values()).filter((trade) => Date.parse(trade.timestamp) >= startMs)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  const flowById = new Map(checkpoint.assetFlows.map((event) => [event.id, event]));
  for (const event of scanned.assetFlows) flowById.set(event.id, event);
  const assetFlows = Array.from(flowById.values()).filter((event) => Date.parse(event.timestamp) >= startMs)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  const shadowWalletUniverse = buildGmWalletUniverse({ gmTradingWallets: [...extraWallets, ...upstreamWallets], profileWalletsByFaction });
  const inventoryBasisObservations = await readInventoryBasisSnapshots({
    bucket: settings.influxBucket,
    query: async (flux) => parseInfluxCsv(await queryInfluxFlux(settings, flux)),
  }).catch(() => []);
  const shadowRows = projectGmFactionMarketplaceRows({
    trades: [...trades, ...(upstreamScan?.trades || [])], flows: assetFlows,
    walletUniverse: shadowWalletUniverse, inventoryBasisObservations,
  });
  const shadowWrite = await writeMarketplaceFactionV2Lines(settings, shadowRows);
  const combinedGlobalScan = {
    ...scanned,
    exhaustion: scanned.exhaustion || upstreamScan?.exhaustion || null,
    stats: {
      ...scanned.stats,
      transactionMisses: Number(scanned.stats?.transactionMisses || 0) + Number(upstreamScan?.stats?.transactionMisses || 0),
      signatureRequests: Number(scanned.stats?.signatureRequests || 0) + Number(upstreamScan?.stats?.signatureRequests || 0),
      transactionRequests: Number(scanned.stats?.transactionRequests || 0) + Number(upstreamScan?.stats?.transactionRequests || 0),
      totalRpcRequests: Number(scanned.stats?.totalRpcRequests || 0) + Number(upstreamScan?.stats?.totalRpcRequests || 0),
    },
    walletCursors: { ...checkpoint.walletCursors, ...scanned.walletCursors, ...(upstreamScan?.walletCursors || {}) },
  };
  const checkpointCursors = resolveMarketplaceCheckpointCursors(checkpoint, combinedGlobalScan);
  const cursorOutputSnapshot = {
    walletCursors: checkpointCursors.walletCursors,
    orderCursors: checkpointCursors.orderCursors,
    activeOrderIds: scanned.activeOrderIds,
    archivedOrderIds: scanned.archivedOrderIds,
  };
  const safeCheckpointDocument = {
    schemaVersion: 2, market: 'GM', savedAt: new Date().toISOString(), trackedWallets, executionWallets,
    orders: scanned.orders, trades, assetFlows, ...cursorOutputSnapshot,
    publishedTradeIds: Array.from(checkpoint.publishedTradeIds).sort(),
    publishedFlowIds: Array.from(checkpoint.publishedFlowIds).sort(),
    marketplaceBackfilled: false, assetFlowBackfilled: false,
    tradeEnrichmentVersion: checkpoint.tradeEnrichmentVersion,
  };
  // Trades and flows are passed to one coordinator invocation so every
  // candidate is durably staged before the first POST. Results remain keyed
  // by their individual logical event and are never collapsed to one Boolean.
  const gmLegacyReadScope = { faction: 'GLOBAL', profile: 'GLOBAL', market: 'GM' };
  const publication = await publishMarketplaceCandidateSet(settings, [
    ...trades.map((trade) => marketplaceTradePublicationCandidate(trade, {
      market: gmLegacyReadScope.market, faction: gmLegacyReadScope.faction, profileScope: gmLegacyReadScope.profile,
    })),
    ...assetFlows.map(marketplaceFlowPublicationCandidate),
  ], { market: 'GM', faction: 'GLOBAL', profileScope: 'GLOBAL', cursorInputSnapshot, cursorOutputSnapshot }, {
    commitSafeCursor: () => writeJsonAtomic(filePath, safeCheckpointDocument),
  });
  if (!publication.safeCursorCommitted) return {
    trades, assetFlows, error: [publication.error, shadowWrite.error].filter(Boolean).join('; '),
    marketplaceFactionV2Write: shadowWrite,
    rpc: { ...scanned.stats, openOrderRequests: openOrders.requestCount, totalRpcRequests: scanned.stats.totalRpcRequests + openOrders.requestCount },
    exhaustion: scanned.exhaustion || null,
  };
  for (const id of publication.publishedTradeIds) checkpoint.publishedTradeIds.add(id);
  for (const id of publication.publishedFlowIds) checkpoint.publishedFlowIds.add(id);
  const publishError = [publication.error, shadowWrite.error].filter(Boolean).join('; ');
  const checkpointDocument = {
    ...safeCheckpointDocument, savedAt: new Date().toISOString(), ...cursorOutputSnapshot,
    publishedTradeIds: Array.from(checkpoint.publishedTradeIds).sort(),
    publishedFlowIds: Array.from(checkpoint.publishedFlowIds).sort(),
    marketplaceBackfilled: false,
    assetFlowBackfilled: false,
    tradeEnrichmentVersion: checkpoint.tradeEnrichmentVersion,
  };
  await writeJsonAtomic(filePath, checkpointDocument);
  const tradeHoldsCompleted = await completeMarketplacePublicationHolds(publication.tradeHoldIdsToComplete);
  const flowHoldsCompleted = await completeMarketplacePublicationHolds(publication.flowHoldIdsToComplete);
  const [hasActiveTradeHold, hasActiveFlowHold] = await Promise.all([
    hasActiveMarketplacePublicationHolds('GM', ['trade']),
    hasActiveMarketplacePublicationHolds('GM', ['asset_flow']),
  ]);
  const marketplaceBackfilledNext = publication.allTradeCurrentComplete && tradeHoldsCompleted && !hasActiveTradeHold;
  const assetFlowBackfilledNext = combinedGlobalScan.stats.transactionMisses === 0 && publishError === ''
    && publication.allFlowCurrentComplete && flowHoldsCompleted && !hasActiveFlowHold;
  await writeJsonAtomic(filePath, {
    ...checkpointDocument, savedAt: new Date().toISOString(), ...cursorOutputSnapshot,
    marketplaceBackfilled: marketplaceBackfilledNext,
    assetFlowBackfilled: assetFlowBackfilledNext,
  });
  return {
    trades, assetFlows, error: publishError, marketplaceFactionV2Write: shadowWrite,
    rpc: { ...combinedGlobalScan.stats, openOrderRequests: openOrders.requestCount, totalRpcRequests: combinedGlobalScan.stats.totalRpcRequests + openOrders.requestCount },
    exhaustion: combinedGlobalScan.exhaustion,
  };
}

let marketplaceSyncActive = null;

function marketplaceSyncAttempt(disposition, requestedFaction, activeFaction, runId) {
  return { disposition, requestedFaction, activeFaction, runId };
}

function marketplaceSyncCallerError(error, attempt, preserveOriginal = false) {
  if (preserveOriginal && error && (typeof error === 'object' || typeof error === 'function')) {
    try {
      error.marketplaceSyncAttempt = attempt;
      if (error.marketplaceSyncAttempt === attempt) return error;
    } catch (_attachmentError) {
      // Fall through to a caller-specific wrapper.
    }
  }
  const wrapped = new Error(String(error?.message || error || 'marketplace_sync_failed'));
  wrapped.marketplaceRpcTelemetry = error?.marketplaceRpcTelemetry || null;
  wrapped.marketplaceSyncAttempt = attempt;
  return wrapped;
}

async function syncMarketplaceTrades(payload, { rpcAttemptLimit = DEFAULT_MARKETPLACE_RPC_ATTEMPT_LIMIT } = {}) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const faction = normalizeFaction(settings.faction);
  if (marketplaceSyncActive) {
    const active = marketplaceSyncActive;
    const disposition = active.faction === faction ? 'coalesced' : 'skipped';
    const attempt = marketplaceSyncAttempt(disposition, faction, active.faction, active.runId);
    if (disposition === 'skipped') {
      return { ok: true, skipped: true, faction, marketplaceSyncAttempt: attempt };
    }
    try {
      const result = await active.promise;
      return { ...result, marketplaceSyncAttempt: attempt };
    } catch (error) {
      throw marketplaceSyncCallerError(error, attempt);
    }
  }
  const startedAt = Date.now();
  const telemetry = createMarketplaceRpcTelemetry();
  const attemptBudget = createMarketplaceRpcAttemptBudget({ limit: rpcAttemptLimit, scope: 'operation' });
  const instrumentation = createMarketplaceRpcInstrumentation(telemetry, { attemptBudget });
  const runId = telemetry.snapshot().runId;
  const underlyingPromise = (async () => {
    try {
      await recoverMarketplacePublication(settings);
      const connection = createSolanaConnection(settings, { instrumentation });
      const cachedConnection = createMarketplaceTransactionCacheConnection(connection);
      const localConnection = wrapMarketplaceConnection(cachedConnection, { instrumentation, operation: 'LM' });
      const globalConnection = wrapMarketplaceConnection(cachedConnection, { instrumentation, operation: 'GM' });
      const local = await fetchLocalMarketTrades(settings, localConnection);
      const global = await fetchGlobalMarketTrades(settings, globalConnection);
      const marketplaceEventsWrite = typeof syncMarketplaceEventsFromRawData === 'function'
        ? await syncMarketplaceEventsFromRawData(settings)
          .catch((error) => ({ written: 0, error: String(error?.message || error || 'marketplace_events_sync_failed') }))
        : { written: 0, error: '' };
      const exhaustions = [local.exhaustion, global.exhaustion].filter(Boolean);
      const errors = [local.error, global.error, marketplaceEventsWrite.error].filter(Boolean);
      const marketplaceRpcTelemetry = telemetry.finish();
      const result = {
        ok: errors.length === 0, trades: [...local.trades, ...global.trades], error: errors.join('; '),
        localMarketTrades: local.trades, globalMarketTrades: global.trades,
        localMarketRpc: local.rpc || null, globalMarketRpc: global.rpc || null,
        marketplaceFactionV2Write: global.marketplaceFactionV2Write || { written: 0, error: '' },
        marketplaceEventsWrite,
        rpcCoverage: 'scanner_and_open_orders_only',
        marketplaceRpcTelemetry,
        faction, durationMs: Date.now() - startedAt, checkedAt: new Date().toISOString(),
      };
      if (exhaustions.length) {
        const budget = attemptBudget.snapshot();
        const exhaustion = exhaustions[0];
        result.ok = true;
        result.status = 'budget_exhausted';
        result.resumable = true;
        result.partial = true;
        result.marketplaceRpcBudget = {
          status: 'exhausted', limit: budget.limit, used: budget.used,
          operations: exhaustions.map((entry) => entry.operation === 'GM' ? 'GM' : 'LM'),
          operation: exhaustion.operation === 'GM' ? 'GM' : 'LM',
          method: exhaustion.method == null ? null : String(exhaustion.method).slice(0, 64),
        };
      }
      return result;
    } catch (error) {
      const marketplaceRpcTelemetry = telemetry.finish();
      let telemetryAttached = false;
      if (error && (typeof error === 'object' || typeof error === 'function')) {
        try {
          error.marketplaceRpcTelemetry = marketplaceRpcTelemetry;
          telemetryAttached = error.marketplaceRpcTelemetry === marketplaceRpcTelemetry;
        } catch (_attachmentError) {
          telemetryAttached = false;
        }
      }
      if (telemetryAttached) throw error;
      const wrapped = new Error(String(error?.message || error || 'marketplace_sync_failed'));
      wrapped.marketplaceRpcTelemetry = marketplaceRpcTelemetry;
      throw wrapped;
    }
  })();
  const active = { faction, runId, promise: null };
  active.promise = underlyingPromise.finally(() => {
    if (marketplaceSyncActive === active) marketplaceSyncActive = null;
  });
  marketplaceSyncActive = active;
  const attempt = marketplaceSyncAttempt('started', faction, faction, runId);
  try {
    const result = await active.promise;
    return { ...result, marketplaceSyncAttempt: attempt };
  } catch (error) {
    throw marketplaceSyncCallerError(error, attempt, true);
  }
}

async function fetchMarketplaceSnapshot(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const [result, rawData, decodedEvents, rawDataCoverage, assetFlowEvents, inventoryBasisObservations] = await Promise.all([
    fetchMarketplaceTradesFromInflux(settings),
    fetchMarketplaceRawDataFromInflux(settings),
    fetchMarketplaceEventsFromInflux(settings),
    buildMarketplaceRawDataCoverage(settings).catch(() => ({ sources: [], total: 0, complete: 0, pending: 0, lastSavedAt: '' })),
    fetchMarketplaceAssetFlowsFromInflux(settings).catch(() => []),
    readInventoryBasisSnapshots({
      bucket: settings.influxBucket,
      query: async (flux) => parseInfluxCsv(await queryInfluxFlux(settings, flux)),
    }).catch(() => []),
  ]);
  const accounting = buildCostLedgerResult({ localMarketTrades: result.trades, assetFlowEvents });
  const trades = enrichGmTradesWithInventoryBasis(result.trades, accounting.appliedEventResults, { inventoryBasisObservations });
  const rawSignatures = new Set(rawData.rows.map((row) => row.signature));
  const marketplaceEvents = decodedEvents.rows.filter((event) => rawSignatures.has(event.signature));
  return {
    ok: !result.error,
    marketplaceRawData: rawData.rows,
    marketplaceRawDataCount: rawData.rows.length,
    marketplaceRawDataError: rawData.error,
    marketplaceRawDataCoverage: rawDataCoverage,
    marketplaceEvents,
    marketplaceEventCount: marketplaceEvents.length,
    marketplaceEventsError: decodedEvents.error,
    localMarketTrades: trades,
    localMarketTradeCount: trades.length,
    localMarketError: result.error,
    checkedAt: new Date().toISOString(),
  };
}

function getCurrentResourcePriceAtl(prices, resourceName) {
  const key = normalizeShipName(resourceName);
  const price = Number(prices?.resourcePricesAtlByName?.[key]);
  return Number.isFinite(price) ? price : null;
}

async function fetchCurrentPerStarbaseInventory(settings) {
  // Lightweight inventory snapshot for the Breakeven Analysis: the
  // latest non-zero `curAmount` per (starbase, rss) within the last
  // 7 days. Keeps the response under control because we already have
  // the full day-by-day inventory elsewhere.
  const bucket = escapeFluxString(settings.influxBucket);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -7d)
  |> filter(fn: (r) => r._measurement == "starbase")
  |> filter(fn: (r) => r._field == "curAmount")
  |> filter(fn: (r) => exists r.rss)
  |> group(columns: ["rss", "starbase"])
  |> last()
  |> filter(fn: (r) => r._value > 0)
  |> keep(columns: ["rss", "starbase", "_value", "_time"])
  |> sort(columns: ["starbase", "rss"])`;
  const csv = await queryInfluxFlux(settings, flux).catch(() => '');
  const rows = parseInfluxCsv(csv);
  const result = [];
  for (const row of rows) {
    const starbase = String(row.starbase || '').trim();
    const asset = String(row.rss || '').trim();
    if (!starbase || !asset) continue;
    const quantity = Number(row._value);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    result.push({
      starbase,
      asset,
      quantity,
      lastDate: row._time ? new Date(row._time).toISOString() : null,
    });
  }
  return result;
}

async function fetchOpeningPerStarbaseInventory(settings) {
  // Seed the rebuild from the last known inventory snapshot before the
  // 31-day event window. These quantities are deliberately uncosted: the
  // snapshot proves quantity and location, but not historical acquisition cost.
  const bucket = escapeFluxString(settings.influxBucket);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -38d, stop: -31d)
  |> filter(fn: (r) => r._measurement == "starbase")
  |> filter(fn: (r) => r._field == "curAmount")
  |> filter(fn: (r) => exists r.rss)
  |> group(columns: ["rss", "starbase"])
  |> last()
  |> filter(fn: (r) => r._value > 0)
  |> keep(columns: ["rss", "starbase", "_value", "_time"])
  |> sort(columns: ["starbase", "rss"])`;
  const rows = parseInfluxCsv(await queryInfluxFlux(settings, flux));
  const result = [];
  for (const row of rows) {
    const starbase = String(row.starbase || '').trim();
    const asset = String(row.rss || '').trim();
    const quantity = Number(row._value);
    const timestamp = row._time ? new Date(row._time) : null;
    if (!starbase || !asset || !Number.isFinite(quantity) || quantity <= 0
      || !timestamp || Number.isNaN(timestamp.getTime())) continue;
    const baselineTimestamp = new Date(Date.UTC(
      timestamp.getUTCFullYear(), timestamp.getUTCMonth(), timestamp.getUTCDate(),
    ) - 1).toISOString();
    result.push({ starbase, asset, quantity, timestamp: baselineTimestamp });
  }
  return result;
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

function formatShortDate(date) {
  if (!date) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

async function readLegacyRentalDetails(connection, fleetKey) {
  const contract = deriveRentalContract(new PublicKey(fleetKey), LEGACY_SRSLY_PROGRAM_ID);
  const contractInfo = await connection.getAccountInfo(contract, 'confirmed');
  const decodedContract = decodeLegacyContract(contractInfo?.data);
  if (!decodedContract) return null;

  const rentalInfo = await connection.getAccountInfo(new PublicKey(decodedContract.activeRental), 'confirmed');
  const decodedRental = decodeLegacyRental(rentalInfo?.data);
  if (!decodedRental) return null;

  return {
    contract: contract.toBase58(),
    totalRentalCostAtlasPerDay: decodedRental.effectiveRateAtlasPerDay,
    rentalEnd: new Date(Number(decodedRental.endTimeSeconds) * 1000),
  };
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

// ============================================================================
// RPC resilience helpers (My Star Atlas 0.5.82)
//
// The only direct JSON-RPC call site in this file is getProgramAccountsV2.
// Earlier versions surfaced a hard HTTP 429 to the UI on first app start
// (Earnings tab) when the parallel owned+managed fleet scans hit the Helius
// rate limit. These helpers add:
//   - retry/backoff on HTTP 429, HTTP 5xx, and JSON-RPC rate-limit errors
//     (-32005, -32016, or "rate limit" / "too many requests" in message),
//     honoring Retry-After header and JSON-RPC error.data.retry_after
//   - exponential backoff with full jitter when no server hint is present
//   - per-call rate gating (1 / rpcRequestsPerSecond) so the burst is shaped
//     proactively, not just retried reactively
// ============================================================================

const fetchWithRpcBackoff = createRpcFetcher();
let sharedRpcLimiter = null;
let sharedRpcLimiterRevision = null;

function getRpcMethodLabel(init) {
  try { return JSON.parse(String(init?.body || '{}')).method || 'solanaRpc'; }
  catch (_error) { return 'solanaRpc'; }
}

async function acquireRpcSlot(settings, label = 'solanaRpc') {
  if (!settings?.useRpcLimiter) return;
  const status = getRpcLimiterStatus();
  const mainUrl = status.providers?.main?.url;
  const fallbackUrl = status.providers?.fallback?.url;
  if ((!mainUrl || !isUsableSharedRpcUrl(mainUrl)) && (!fallbackUrl || !isUsableSharedRpcUrl(fallbackUrl))) {
    throw new Error('Use RPC Limiter is enabled, but no RPC Limiter URLs are configured. Send settings to RPC Limiter first.');
  }
  if (!sharedRpcLimiter || sharedRpcLimiterRevision !== status.revision) {
    sharedRpcLimiter = new RpcLimiter();
    sharedRpcLimiterRevision = status.revision;
  }
  await sharedRpcLimiter.wait('rpc:shared', {
    label,
    metrics: { app: 'My Star Atlas', profile: profileName, method: label },
  });
}

function resolveSolanaConnectionRoutes(settings) {
  if (!settings?.useRpcLimiter) {
    return { primaryUrl: String(settings?.rpcUrl || '').trim() || DEFAULT_RPC_URL, primaryProvider: 'main' };
  }
  const status = getRpcLimiterStatus();
  const mainUrl = status.providers?.main?.url;
  const configuredFallbackUrl = status.providers?.fallback?.url;
  const primaryUrl = mainUrl || configuredFallbackUrl;
  if (!primaryUrl || !isUsableSharedRpcUrl(primaryUrl)) {
    throw new Error('Use RPC Limiter is enabled, but no RPC Limiter URLs are configured. Send settings to RPC Limiter first.');
  }
  const fallbackUrl = mainUrl && configuredFallbackUrl
    && configuredFallbackUrl !== primaryUrl && isUsableSharedRpcUrl(configuredFallbackUrl)
    ? configuredFallbackUrl
    : undefined;
  return {
    primaryUrl,
    primaryProvider: mainUrl ? 'main' : 'fallback',
    fallbackUrl,
  };
}

function createSolanaConnection(settings, { instrumentation } = {}) {
  const routes = resolveSolanaConnectionRoutes(settings);
  const telemetryFetchFactory = typeof createTelemetryFetch === 'function'
    ? createTelemetryFetch
    : (fetchImpl, { providerRole, fallback, admit }) => async (info, init) => {
      const method = getRpcMethodLabel(init);
      await admit?.({ method, provider: providerRole, fallback });
      return fetchImpl(info, init);
    };
  const telemetryConnectionWrapper = typeof wrapRpcConnection === 'function' ? wrapRpcConnection : (connection) => connection;
  const createConnectionConfig = (provider, fallback) => ({
    commitment: 'confirmed',
    disableRetryOnRateLimit: false,
    fetch: telemetryFetchFactory(fetch, {
      providerRole: settings?.useRpcLimiter ? provider : 'direct',
      fallback,
      admit: async ({ method }) => {
        await acquireRpcSlot(settings, method);
        if (settings?.useRpcLimiter && typeof recordTelemetryCounter === 'function') recordTelemetryCounter('limiterAdmissions');
        instrumentation?.admitAttempt({ method, provider, fallback });
      },
    }),
  });
  const primary = new Connection(
    routes.primaryUrl,
    createConnectionConfig(routes.primaryProvider, false),
  );
  const fallbackUrl = routes.fallbackUrl;
  if (!fallbackUrl || fallbackUrl === routes.primaryUrl) return telemetryConnectionWrapper(primary);

  // Two-provider failover: try the primary (main) on every call, and on
  // any thrown error fall through to the secondary (fallback) URL. This
  // mirrors the createFailoverConnection shape used by the other bots.
  const fallback = new Connection(fallbackUrl, createConnectionConfig('fallback', true));
  const failoverConnection = new Proxy(primary, {
    get(target, prop, receiver) {
      const primaryFn = Reflect.get(target, prop, receiver);
      if (typeof primaryFn !== 'function') return primaryFn;
      const fallbackFn = Reflect.get(fallback, prop, fallback);
      if (typeof fallbackFn !== 'function') return primaryFn;
      return async (...args) => {
        try {
          return await primaryFn.apply(target, args);
        } catch (primaryError) {
          const budgetExhaustion = instrumentation?.getBudgetExhaustion?.();
          if (budgetExhaustion) throw budgetExhaustion;
          if (isMarketplaceRpcBudgetExhaustedError(primaryError)) throw primaryError;
          // Report 429s back to the shared limiter so the primary (main)
          // goes into cooldown and the next call routes to the fallback.
          // We use 'main' as the failed-provider id here because this
          // Proxy is currently "primary = main, fallback on error". The
          // full provider-aware dispatch (asking the limiter which to use)
          // is a follow-up that requires rewriting the fetch URL inside
          // the Connection's fetch callback; for now, reporting on the
          // primary-side failure is the signal that gets the cooldown
          // logic to actually trip.
          if (sharedRpcLimiter && isRpcRateLimitError(primaryError)) {
            try {
              await sharedRpcLimiter.recordProviderOutcome('main', 'rate_limited');
            } catch (_reportError) {
              // Best-effort; never let a report failure mask the real error.
            }
          }
          return await fallbackFn.apply(fallback, args);
        }
      };
    },
  });
  return telemetryConnectionWrapper(failoverConnection);
}

async function getProgramAccountsV2(rpcUrl, programId, config, options = {}) {
  const settings = options.settings;
  const accounts = [];
  let paginationKey = null;
  do {
    const response = await runLogicalOperation({ rpcMethod: 'getProgramAccountsV2' }, async () => {
      try {
        await acquireRpcSlot(settings, 'getProgramAccountsV2');
      } catch (error) {
        recordTelemetryCounter('limiterStops');
        throw error;
      }
      if (settings?.useRpcLimiter) recordTelemetryCounter('limiterAdmissions');
      recordTelemetryCounter('paginationPages');
      return fetchWithRpcBackoff(
      rpcUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `my-star-atlas-${Date.now()}`,
          method: 'getProgramAccountsV2',
          params: [
            programId.toBase58(),
            {
              ...config,
              encoding: 'base64',
              limit: 1000,
              ...(paginationKey ? { paginationKey } : {}),
            },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      },
      {
        logLabel: 'getProgramAccountsV2',
        ...rawAttemptHooks({ providerRole: settings?.useRpcLimiter ? (options.providerRole || 'unknown') : 'direct' }),
      }
      );
    });
    const payload = await response.json();
    if (payload?.error) {
      const error = new Error(payload.error.message || 'getProgramAccountsV2 failed');
      error.code = payload.error.code;
      throw error;
    }
    const page = payload?.result?.value || payload?.result || {};
    for (const entry of Array.isArray(page.accounts) ? page.accounts : []) {
      const encodedData = Array.isArray(entry?.account?.data) ? entry.account.data[0] : entry?.account?.data;
      accounts.push({
        pubkey: new PublicKey(entry.pubkey),
        account: {
          ...entry.account,
          data: Buffer.from(String(encodedData || ''), 'base64'),
        },
      });
    }
    paginationKey = page.paginationKey || null;
  } while (paginationKey);
  return accounts;
}

async function getFilteredProgramAccounts(connection, rpcUrl, programId, config, options = {}) {
  try {
    return await getProgramAccountsV2(rpcUrl, programId, config, options);
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    const unsupported = error?.code === -32601 || message.includes('method not found') || message.includes('not supported');
    if (!unsupported) throw error;
    return connection.getProgramAccounts(programId, config);
  }
}

async function fetchProfileFleetsUncached(payload) {
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

  const rpcUrl = getRpcUrl(settings);
  const connection = createSolanaConnection(settings);

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

  // Sequential (not Promise.all): a parallel burst of paginated
  // getProgramAccountsV2 calls used to cause HTTP 429 on the Helius RPC at
  // app startup when the Earnings tab opened. Each call now goes through
  // acquireRpcSlot internally to space out its pages, and the two fleet
  // filters run back-to-back so the per-call delay between them is honored.
  const ownedAccounts = await getFilteredProgramAccounts(
    connection,
    rpcUrl,
    SAGE_PROGRAM_ID,
    {
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
    },
    { settings, providerRole: resolveSolanaConnectionRoutes(settings).primaryProvider }
  );
  const managedAccounts = await getFilteredProgramAccounts(
    connection,
    rpcUrl,
    SAGE_PROGRAM_ID,
    {
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
    },
    { settings, providerRole: resolveSolanaConnectionRoutes(settings).primaryProvider }
  );

  // Current SRSLY rentals are authoritative for active rental metadata and can
  // discover a rented fleet even when its SAGE subProfile index is absent or
  // stale. Keep the SAGE managed-fleet query above as the legacy reader, then
  // merge both sources by fleet account.
  const currentRentalsByFleet = new Map();
  let currentRentalFleetKeys = [];
  let currentRentalFleetInfos = [];
  try {
    const currentRentalAccounts = await getFilteredProgramAccounts(
      connection,
      rpcUrl,
      SRSLY_PROGRAM_ID,
      {
        commitment: 'confirmed',
        filters: [{
          memcmp: {
            offset: CURRENT_RENTAL_OFFSETS.borrowerProfile,
            bytes: ownerProfile.toBase58(),
          },
        }],
      },
      { settings, providerRole: resolveSolanaConnectionRoutes(settings).primaryProvider }
    );
    const currentRentalCandidates = currentRentalAccounts
      .map((account) => ({ account, decoded: decodeCurrentRental(account.account.data) }))
      .filter((entry) => entry.decoded);
    const currentContractKeys = currentRentalCandidates.map((entry) => new PublicKey(entry.decoded.contract));
    const currentContractInfos = currentContractKeys.length
      ? await connection.getMultipleAccountsInfo(currentContractKeys, 'confirmed')
      : [];
    currentRentalCandidates.forEach((entry, index) => {
      const matched = matchActiveRental({
        rentalAddress: entry.account.pubkey.toBuffer(),
        rentalData: entry.account.account.data,
        contractData: currentContractInfos[index]?.data,
      });
      if (!matched) return;
      const fleetKey = new PublicKey(matched.fleet).toBase58();
      const endTimeSeconds = Number(matched.endTimeSeconds);
      const rentalDurationSeconds = Number(matched.endTimeSeconds - matched.startTimeSeconds);
      const rentalDurationDays = rentalDurationSeconds / 86_400;
      const baseRateAtlasPerDay = normalizeAtlasAmount(matched.rate);
      const serviceFeeAtlas = normalizeAtlasAmount(matched.serviceFee);
      const reservationPremiumAtlas = normalizeAtlasAmount(matched.bidAtlas);
      const totalRentalCostAtlasPerDay = Number.isFinite(rentalDurationDays) && rentalDurationDays > 0
        ? baseRateAtlasPerDay + (serviceFeeAtlas + reservationPremiumAtlas) / rentalDurationDays
        : null;
      currentRentalsByFleet.set(fleetKey, {
        totalRentalCostAtlasPerDay,
        rentalEnd: Number.isFinite(endTimeSeconds) ? new Date(endTimeSeconds * 1000) : null,
      });
    });
    currentRentalFleetKeys = Array.from(currentRentalsByFleet.keys());
    currentRentalFleetInfos = currentRentalFleetKeys.length
      ? await connection.getMultipleAccountsInfo(currentRentalFleetKeys.map((key) => new PublicKey(key)), 'confirmed')
      : [];
  } catch (error) {
    console.warn('[fleet-rental] Current SRSLY discovery unavailable; preserving legacy fleet results:', error?.message || error);
    currentRentalsByFleet.clear();
    currentRentalFleetKeys = [];
    currentRentalFleetInfos = [];
  }

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
  currentRentalFleetKeys.forEach((fleetKey, index) => {
    const info = currentRentalFleetInfos[index];
    if (!info?.data) return;
    const decoded = decodeFleetAccount({ pubkey: new PublicKey(fleetKey), account: info });
    const existing = fleetMap.get(fleetKey);
    const relationship = existing?.relationship === 'owned' ? 'owned-managed' : 'managed';
    fleetMap.set(fleetKey, {
      ...decoded,
      ...existing,
      relationship,
      ownership: relationship === 'owned-managed' ? 'Owned + managed' : 'Rented',
      activity: inferFleetActivity(info.data, decoded.label, relationship),
    });
  });

  const fleets = Array.from(fleetMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  await Promise.all(
    fleets
      .filter((fleet) => fleet.relationship === 'managed' || fleet.relationship === 'owned-managed')
      .map(async (fleet) => {
        const currentRental = currentRentalsByFleet.get(fleet.key);
        const rental = currentRental || await runWithTelemetryContext(
          { suboperation: 'rental-data' },
          () => readLegacyRentalDetails(connection, fleet.key),
        );
        const rentalEnd = rental?.rentalEnd || null;
        const rentalEndLabel = formatShortDate(rentalEnd);
        fleet.rentalRateAtlasPerDay = rental?.totalRentalCostAtlasPerDay ?? null;
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

// Fleet and Earnings refresh together on the same profile. Share the RPC work
// (including an in-flight request) instead of asking Solana for the same fleet
// accounts twice. A short TTL keeps explicit refreshes reasonably fresh.
const profileFleetCache = new Map();
const PROFILE_FLEET_CACHE_TTL_MS = 30 * 1000;

async function fetchProfileFleets(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  const key = `${getSelectedPlayerProfile(settings)}\n${getRpcUrl(settings)}`;
  const now = Date.now();
  const cached = profileFleetCache.get(key);
  if (cached?.data && cached.expiresAt > now) {
    recordTelemetryCounter('cacheHits', 1, { suboperation: 'fleet-discovery' });
    return cached.data;
  }
  recordTelemetryCounter('cacheMisses', 1, { suboperation: 'fleet-discovery' });
  if (cached?.pending) {
    recordTelemetryCounter('inFlightCoalesced', 1, { suboperation: 'fleet-discovery' });
    recordTelemetryCounter('preventedDuplicates', 1, { suboperation: 'fleet-discovery' });
    return cached.pending;
  }
  const pending = runWithTelemetryContext({ suboperation: 'fleet-discovery' }, () => fetchProfileFleetsUncached(settings))
    .then((data) => {
      profileFleetCache.set(key, { data, expiresAt: Date.now() + PROFILE_FLEET_CACHE_TTL_MS, pending: null });
      return data;
    })
    .catch((error) => {
      profileFleetCache.delete(key);
      throw error;
    });
  profileFleetCache.set(key, { data: cached?.data || null, expiresAt: cached?.expiresAt || 0, pending });
  return pending;
}

async function fetchScanningEarningsRows(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) {
    return [];
  }

  const includedDays = new Set(getLastUtcDays(30).map((date) => getUtcDateKey(date)));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings).catch(() => new Map());
  const sduCostsFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "sdu")
  |> filter(fn: (r) => r._field == "amount" or r._field == "burnedFood" or r._field == "txCostSol")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "_measurement", "_field", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "_measurement", "_field", "_time", "_value"])
  |> sort(columns: ["_time", "fleet"])`;

  const sduProductionByStarbaseFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "sdu" and r._field == "amount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet and exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "starbase", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "starbase", "sectorX", "sectorY", "_time", "_value"])
  |> sort(columns: ["_time", "fleet", "starbase"])`;

  const movementCostsFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "movement" and r._field == "burnedFuel")
  |> filter(fn: (r) => exists r.assignment and r.assignment == "Scan")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "_measurement", "_field", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "_measurement", "_field", "_time", "_value"])
  |> sort(columns: ["_time", "fleet"])`;

  const chanceSumFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "sdu" and r._field == "chance")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> map(fn: (r) => ({r with _value: if float(v: r._value) <= 1.0 then float(v: r._value) * 100.0 else float(v: r._value)}))
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "_time", "_value"])
  |> sort(columns: ["_time", "fleet"])`;

  const chanceCountFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "sdu" and r._field == "chance")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: count, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "_time", "_value"])
  |> sort(columns: ["_time", "fleet"])`;

  const successfulCountFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "sdu" and r._field == "amount" and float(v: r._value) > 0.0)
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: count, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "_time", "_value"])
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
        productionByStarbase: [],
      });
    }
    return rowsByDayFleet.get(key);
  };

  const [sduCostsCsv, sduProductionByStarbaseCsv, movementCostsCsv, chanceSumCsv, chanceCountCsv, successfulCountCsv] = await Promise.all([
    queryInfluxFlux(settings, sduCostsFlux),
    queryInfluxFlux(settings, sduProductionByStarbaseFlux),
    queryInfluxFlux(settings, movementCostsFlux),
    queryInfluxFlux(settings, chanceSumFlux),
    queryInfluxFlux(settings, chanceCountFlux),
    queryInfluxFlux(settings, successfulCountFlux),
  ]);

  for (const row of [...parseInfluxCsv(sduCostsCsv), ...parseInfluxCsv(movementCostsCsv)]) {
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

  for (const row of parseInfluxCsv(sduProductionByStarbaseCsv)) {
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const quantity = Number(row._value);
    const starbase = resolveStarbaseName(row, coordinateMap);
    if (!fleet || !starbase || Number.isNaN(date.getTime()) || !Number.isFinite(quantity) || quantity <= 0) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, fleet, date);
    const existing = entry.productionByStarbase.find((item) => item.starbase === starbase);
    if (existing) existing.quantity += quantity;
    else entry.productionByStarbase.push({ starbase, quantity });
  }

  const applyDailyScanStat = (csv, field) => {
    for (const row of parseInfluxCsv(csv)) {
    const fleet = String(row.fleet || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, fleet, date);
      entry[field] += value;
    }
  };
  applyDailyScanStat(chanceSumCsv, 'chanceSumPercent');
  applyDailyScanStat(chanceCountCsv, 'scanAttempts');
  applyDailyScanStat(successfulCountCsv, 'successfulScans');

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

  const includedDays = new Set(getLastUtcDays(30).map((date) => getUtcDateKey(date)));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings).catch(() => new Map());
  const totalsFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "mining")
  |> filter(fn: (r) => r._field == "amount" or r._field == "burnedAmmo" or r._field == "burnedFood" or r._field == "burnedFuel" or r._field == "txCostSol")
${scopeFilterFlux}
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
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "mining" and r._field == "txCostSol")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "cycleId", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "cycleId", "_time", "_value"])
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
        txsDaily: null,
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
    if (!fleet || isCargoCycleId(fleet) || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const fleetAccount = cargoFleetAccountFromCycleId(row.cycleId);
    const key = `${isoDate}\n${fleetAccount || `label:${fleet}`}`;
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
    const txDaily = txDailyByDayFleet.get(`${row.isoDate}\n${row.fleetAccount || `label:${row.fleet}`}`) || { txCostSol: 0 };
    row.txCostSol = txDaily.txCostSol;
  }

  return Array.from(rowsByKey.values())
    .filter((row) => row.mined > 0 || row.burnedAmmo > 0 || row.burnedFood > 0 || row.burnedFuel > 0 || row.txCostSol > 0 || row.txsDaily > 0);
}

async function fetchCraftingEarningsRows(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) {
    return [];
  }

  const includedDays = new Set(getLastUtcDays(30).map((date) => getUtcDateKey(date)));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings).catch(() => new Map());

  // Read each crafting point once, then split Output/Input/fee/tx/crew
  // locally. The previous implementation scanned the same 15-day range six
  // times, including a duplicate Output query used only for event counts.
  const craftingFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "crafting")
  |> filter(fn: (r) => r._field == "amount" or r._field == "fee" or r._field == "txCostSol" or r._field == "crew")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.starbase and exists r.output and exists r.craftingID)
  |> map(fn: (r) => ({r with _value: float(v: r._value)}))
  |> group()
  |> keep(columns: ["craftingID", "starbase", "output", "input", "type", "_field", "_time", "_value"])
  |> sort(columns: ["_time"])`;

  const craftingRows = excludeSelfReferentialCraftingEvents(parseInfluxCsv(await queryInfluxFlux(settings, craftingFlux)));
  const outputRows = craftingRows.filter((row) => row._field === 'amount' && row.type === 'Output');
  const inputRows = craftingRows.filter((row) => row._field === 'amount' && row.type === 'Input');
  const feeRows = craftingRows.filter((row) => row._field === 'fee' && row.type === 'Output');
  const txsRows = craftingRows.filter((row) => row._field === 'txCostSol' && row.type === 'Output');
  const crewRows = craftingRows.filter((row) => row._field === 'crew' && row.type === 'Output');

  const rowsByKey = new Map();
  const ensureRow = (isoDate, starbase, output, date) => {
    const key = `${isoDate}\n${starbase}\n${output}`;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        starbase,
        output,
        isoDate,
        label: formatShortUtcDate(date),
        crafted: 0,
        txsDaily: 0,
        feeAmount: 0,
        txCostSol: 0,
        crew: 0,
        ingredients: [],
      });
    }
    return rowsByKey.get(key);
  };

  // Defense-in-depth: even though the fee and txs flux queries already
  // filter r.type == "Output" so we get one row per crafting event,
  // track event ids we've already credited so we never double-count
  // if a future query change accidentally returns more than one row
  // per event.
  const seenFeeEvents = new Set();
  const seenTxsEvents = new Set();
  const seenCrewEvents = new Set();
  const crewValuesByRow = new Map();

  for (const row of outputRows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    const output = String(row.output || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!starbase || !output || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, starbase, output, date);
    entry.crafted += value;
  }

  for (const row of inputRows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    const output = String(row.output || '').trim();
    const input = String(row.input || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!starbase || !output || !input || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, starbase, output, date);
    entry.ingredients.push({ input, amount: value });
  }

  for (const row of feeRows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    const output = String(row.output || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    const craftingID = String(row.craftingID || '').trim();
    if (!starbase || !output || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    if (craftingID) {
      if (seenFeeEvents.has(craftingID)) continue;
      seenFeeEvents.add(craftingID);
    }
    const entry = ensureRow(isoDate, starbase, output, date);
    entry.feeAmount += value;
  }

  for (const row of txsRows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    const output = String(row.output || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    const craftingID = String(row.craftingID || '').trim();
    if (!starbase || !output || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    if (craftingID) {
      if (seenTxsEvents.has(craftingID)) continue;
      seenTxsEvents.add(craftingID);
    }
    const entry = ensureRow(isoDate, starbase, output, date);
    entry.txCostSol += value;
  }

  // outputRows is one row per crafting event; txsDaily is the count of
  // accepted event rows, not the sum of a value column.
  for (const row of outputRows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    const output = String(row.output || '').trim();
    const date = new Date(row._time);
    if (!starbase || !output || Number.isNaN(date.getTime())) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, starbase, output, date);
    entry.txsDaily += 1;
  }

  // Crew is assigned capacity, not a consumable. Collect one observation per
  // crafting event and average it for the (date, starbase, output) row so
  // transaction count cannot multiply the displayed daily crew.
  for (const row of crewRows) {
    const starbase = resolveStarbaseName(row, coordinateMap);
    const output = String(row.output || '').trim();
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    const craftingID = String(row.craftingID || '').trim();
    if (!starbase || !output || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    if (craftingID) {
      if (seenCrewEvents.has(craftingID)) continue;
      seenCrewEvents.add(craftingID);
    }
    const entry = ensureRow(isoDate, starbase, output, date);
    const key = `${isoDate}\n${starbase}\n${output}`;
    if (!crewValuesByRow.has(key)) crewValuesByRow.set(key, []);
    crewValuesByRow.get(key).push(value);
    entry.crew = averageRecordedCrew(crewValuesByRow.get(key));
  }

  const result = Array.from(rowsByKey.values())
    .filter((row) => row.crafted > 0 || row.feeAmount > 0 || row.txCostSol > 0 || row.crew > 0 || row.ingredients.length > 0);
  const ledgerByCraftingId = new Map();
  for (const raw of craftingRows) {
    const craftingId = String(raw.craftingID || '').trim();
    const starbase = resolveStarbaseName(raw, coordinateMap);
    const output = String(raw.output || '').trim();
    const eventDate = new Date(raw._time);
    const timestamp = Number.isNaN(eventDate.getTime()) ? '' : eventDate.toISOString();
    if (!craftingId || !starbase || !output || !timestamp) continue;
    if (!ledgerByCraftingId.has(craftingId)) ledgerByCraftingId.set(craftingId, { craftingId, timestamp, starbase, output, crafted: 0, feeAmount: null, txCostSol: null, crew: 0, ingredients: [] });
    const event = ledgerByCraftingId.get(craftingId);
    const value = Number(raw._value);
    if (!Number.isFinite(value)) continue;
    if (raw._field === 'amount' && raw.type === 'Output') event.crafted += value;
    else if (raw._field === 'amount' && raw.type === 'Input') event.ingredients.push({ input: String(raw.input || '').trim(), amount: value });
    else if (raw._field === 'fee' && raw.type === 'Output') event.feeAmount = (event.feeAmount || 0) + value;
    else if (raw._field === 'txCostSol' && raw.type === 'Output') event.txCostSol = (event.txCostSol || 0) + value;
    else if (raw._field === 'crew' && raw.type === 'Output') event.crew += value;
  }
  result.ledgerEvents = Array.from(ledgerByCraftingId.values());
  return result;
}
async function fetchUpgradingEarningsRows(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) return [];
  const today = getUtcDateKey(new Date());
  const includedDays = new Set(getLastUtcDays(15).map(getUtcDateKey).filter((day) => day !== today));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings).catch(() => new Map());
  const flux = `from(bucket: "${bucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "upgrade")
${scopeFilterFlux}
  |> filter(fn: (r) => r._field == "amount" or r._field == "crew" or r._field == "txCostSol" or r._field == "startedAt" or r._field == "completedAt" or r._field == "started_at" or r._field == "completed_at" or r._field == "craftingId" or r._field == "state")
  |> filter(fn: (r) => exists r.starbase and exists r.input)
  |> keep(columns: ["starbase", "input", "instance", "faction", "_field", "_time", "_value"])
  |> sort(columns: ["_time"])`;
  const rows = new Map();
  const crewObservations = new Map();
  const ledgerEvents = [];
  const jobsByEvent = new Map();
  for (const raw of parseInfluxCsv(await queryInfluxFlux(settings, flux))) {
    const starbase = resolveStarbaseName(raw, coordinateMap);
    const asset = String(raw.input || '').trim();
    const date = new Date(raw._time);
    const value = Number(raw._value);
    if (!starbase || !asset || Number.isNaN(date.getTime())) continue;
    const eventKey = `${date.toISOString()}\n${starbase}\n${asset}`;
    if (!jobsByEvent.has(eventKey)) jobsByEvent.set(eventKey, { _time: date.toISOString(), component: asset, starbase, instance: raw.instance, faction: raw.faction });
    jobsByEvent.get(eventKey)[raw._field] = Number.isFinite(value) ? value : raw._value;
    if (!Number.isFinite(value)) continue;
    const groupKey = `${starbase}\n${asset}`;
    if (raw._field === 'amount' && value > 0) {
      ledgerEvents.push({ timestamp: date.toISOString(), starbase, asset, installed: value });
    }
    if (raw._field === 'crew') {
      if (!crewObservations.has(groupKey)) crewObservations.set(groupKey, []);
      crewObservations.get(groupKey).push({ time: date.getTime(), value });
    }
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const key = `${isoDate}
${starbase}
${asset}`;
    if (!rows.has(key)) rows.set(key, { isoDate, label: formatShortUtcDate(date), starbase, asset, installed: 0, crew: 0, txCostSol: 0 });
    const row = rows.get(key);
    if (raw._field === 'amount') row.installed += value;
    if (raw._field === 'txCostSol') row.txCostSol += value;
  }

  // Crew is assigned capacity, not a consumable. Repeated upgrade records must
  // therefore not be summed. For each UTC day, average the observed crew level
  // by the amount of time it was in effect. Carry the latest earlier value into
  // the day; if history starts during the day, use that day's first observation
  // as its opening value so job duration/frequency does not depress the metric.
  for (const row of rows.values()) {
    const observations = crewObservations.get(`${row.starbase}\n${row.asset}`) || [];
    const dayStart = Date.parse(`${row.isoDate}T00:00:00.000Z`);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const beforeOrDuring = observations.filter((item) => item.time < dayEnd);
    const during = beforeOrDuring.filter((item) => item.time >= dayStart);
    let current = [...beforeOrDuring].reverse().find((item) => item.time < dayStart)?.value;
    if (!Number.isFinite(current) && during.length) current = during[0].value;
    if (!Number.isFinite(current)) continue;
    let cursor = dayStart;
    let crewMilliseconds = 0;
    for (const observation of during) {
      crewMilliseconds += current * Math.max(0, observation.time - cursor);
      current = observation.value;
      cursor = observation.time;
    }
    crewMilliseconds += current * Math.max(0, dayEnd - cursor);
    row.crew = crewMilliseconds / (dayEnd - dayStart);
  }
  const result = Array.from(rows.values()).filter((row) => row.installed > 0 || row.crew > 0 || row.txCostSol > 0);
  result.ledgerEvents = ledgerEvents;
  result.jobs = [...jobsByEvent.values()].filter((job) => Number(job.amount) > 0 && Number(job.crew) > 0);
  return result;
}

async function fetchCargoEarningsRows(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) {
    return [];
  }

  const includedDays = new Set(getLastUtcDays(30).map((date) => getUtcDateKey(date)));
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const coordinateMap = await fetchStarbaseCoordinateMap(settings).catch(() => new Map());
  const buildCargoFlux = (rangeFlux) => `from(bucket: "${bucket}")
  ${rangeFlux}
  |> filter(fn: (r) => r._measurement == "movement")
  |> filter(fn: (r) => r._field == "burnedFuel")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.assignment and (r.assignment == "Transport" or r.assignment == "Supply Chain"))
  |> filter(fn: (r) => exists r.fleet)
  |> filter(fn: (r) => exists r.starbase)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "assignment", "starbase", "cycleId", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "assignment", "starbase", "cycleId", "_time", "_value"])`;
  const typeFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "movement")
  |> filter(fn: (r) => r._field == "type")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.assignment and (r.assignment == "Transport" or r.assignment == "Supply Chain"))
  |> filter(fn: (r) => exists r.fleet)
  |> keep(columns: ["fleet", "assignment", "cycleId", "_time", "_value"])`;
  const moveTimeFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "movement")
  |> filter(fn: (r) => r._field == "moveTime")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.assignment and (r.assignment == "Transport" or r.assignment == "Supply Chain"))
  |> filter(fn: (r) => exists r.fleet)
  |> keep(columns: ["fleet", "assignment", "cycleId", "_time", "_value"])`;
  const txDailyFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "movement" and r._field == "txCostSol")
  |> filter(fn: (r) => exists r.assignment and (r.assignment == "Transport" or r.assignment == "Supply Chain"))
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet)
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["fleet", "_time"])
  |> sum(column: "_value")
  |> group()
  |> keep(columns: ["fleet", "_time", "_value"])`;
  const completedCycleFlux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "cargo_cycle_completed" and r._field == "legCount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet and exists r.assignment and exists r.cycleId)
  |> keep(columns: ["fleet", "assignment", "cycleId", "_time", "_value"])`;

  const rowsByKey = new Map();
  const txDailyByDayFleet = new Map();
  const travelModeByMovement = new Map();
  const ensureRow = (isoDate, fleet, assignment, date, fleetAccount = '') => {
    const authoritativeFleet = String(fleetAccount || '').trim();
    const key = `${isoDate}\n${authoritativeFleet || `label:${fleet}`}\n${assignment}`;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        fleet,
        fleetAccount: authoritativeFleet,
        assignment,
        isoDate,
        timestamp: date.toISOString(),
        label: formatShortUtcDate(date),
        starbases: new Set(),
        completedCycleLegs: new Map(),
        movementCycleIds: new Set(),
        travelTimeByMode: { warp: 0, subwarp: 0 },
        burnedFuel: 0,
        txCostSol: 0,
        txsDaily: 0,
      });
    }
    return rowsByKey.get(key);
  };

  // Fetch the row-defining fuel query before the optional enrichment fan-out.
  // Running all five together can overload the Influx proxy and lose the core
  // Cargo table to a transient 504 even though the underlying rows are valid.
  const cargoRecords = await queryCargoRowsWithWindowFallback({
    query: (flux) => queryInfluxFlux(settings, flux),
    buildQuery: buildCargoFlux,
    parseCsv: parseInfluxCsv,
  });
  const [typeResult, moveTimeResult, txDailyResult, completedCycleResult] = await Promise.allSettled([
    queryInfluxFlux(settings, typeFlux),
    queryInfluxFlux(settings, moveTimeFlux),
    queryInfluxFlux(settings, txDailyFlux),
    queryInfluxFlux(settings, completedCycleFlux),
  ]);
  const optionalCsv = (result) => result.status === 'fulfilled' ? result.value : '';
  const typeCsv = optionalCsv(typeResult);
  const moveTimeCsv = optionalCsv(moveTimeResult);
  const txDailyCsv = optionalCsv(txDailyResult);
  const completedCycleCsv = optionalCsv(completedCycleResult);
  const completedCycleEvidenceAvailable = completedCycleResult.status === 'fulfilled';

  for (const row of parseInfluxCsv(completedCycleCsv)) {
    const fleet = String(row.fleet || '').trim();
    const assignment = String(row.assignment || '').trim();
    const cycleId = String(row.cycleId || '').trim();
    const date = new Date(row._time);
    const legCount = Number(row._value);
    if (!fleet || !assignment || !cycleId || !Number.isFinite(legCount) || legCount <= 0 || Number.isNaN(date.getTime())) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    ensureRow(isoDate, fleet, assignment, date, cargoFleetAccountFromCycleId(cycleId)).completedCycleLegs.set(cycleId, legCount);
  }

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

  for (const row of cargoRecords) {
    const fleet = String(row.fleet || '').trim();
    const assignment = String(row.assignment || '').trim();
    const starbase = resolveStarbaseName(row, coordinateMap);
    const date = new Date(row._time);
    const value = Number(row._value || 0);
    if (!fleet || isCargoCycleId(fleet) || !assignment || !starbase || Number.isNaN(date.getTime()) || !Number.isFinite(value)) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, fleet, assignment, date, cargoFleetAccountFromCycleId(row.cycleId));
    if (row.cycleId) entry.movementCycleIds.add(String(row.cycleId).trim());
    entry.burnedFuel += value;
    entry.starbases.add(starbase);
  }

  for (const row of parseInfluxCsv(typeCsv)) {
    const fleet = String(row.fleet || '').trim();
    const assignment = String(row.assignment || '').trim();
    const travelMode = String(row._value || '').trim().toLowerCase();
    const date = new Date(row._time);
    if (!fleet || isCargoCycleId(fleet) || !assignment || !travelMode || Number.isNaN(date.getTime())) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    const entry = ensureRow(isoDate, fleet, assignment, date, cargoFleetAccountFromCycleId(row.cycleId));
    if (row.cycleId) entry.movementCycleIds.add(String(row.cycleId).trim());
    travelModeByMovement.set(`${row._time}\n${row.cycleId}`, travelMode);
    entry.txsDaily += 1;
  }

  for (const row of parseInfluxCsv(moveTimeCsv)) {
    const fleet = String(row.fleet || '').trim();
    const assignment = String(row.assignment || '').trim();
    const moveTime = Number(row._value);
    const date = new Date(row._time);
    const travelMode = travelModeByMovement.get(`${row._time}\n${row.cycleId}`);
    if (!fleet || isCargoCycleId(fleet) || !assignment || (travelMode !== 'warp' && travelMode !== 'subwarp') || !Number.isFinite(moveTime) || moveTime < 0 || Number.isNaN(date.getTime())) continue;
    const isoDate = getUtcDateKey(date);
    if (!includedDays.has(isoDate)) continue;
    ensureRow(isoDate, fleet, assignment, date, cargoFleetAccountFromCycleId(row.cycleId)).travelTimeByMode[travelMode] += moveTime;
  }

  for (const row of rowsByKey.values()) {
    const txDaily = txDailyByDayFleet.get(`${row.isoDate}\n${row.fleet}`) || { txCostSol: 0 };
    row.txCostSol = txDaily.txCostSol;
  }

  return Array.from(rowsByKey.values())
    .map((row) => {
      const travelModeTime = calculateTravelModeTime(row.travelTimeByMode);
      const completedCycleIds = Array.from(row.completedCycleLegs.keys());
      return {
        ...row,
        starbases: Array.from(row.starbases).sort((a, b) => a.localeCompare(b)),
        completedCycleIds,
        movementCycleIds: Array.from(row.movementCycleIds),
        cargoCycles: completedCycleEvidenceAvailable ? completedCycleIds.length : null,
        cargoLegs: completedCycleEvidenceAvailable
          ? Array.from(row.completedCycleLegs.values()).reduce((sum, value) => sum + value, 0)
          : null,
        travelModeTime,
        travelModeWarpPercent: travelModeTime?.warpPercent ?? null,
      };
    })
    .filter((row) => row.burnedFuel > 0 || row.txCostSol > 0 || row.txsDaily > 0);
}


async function fetchCargoVolumeEarningsRows(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) {
    return { rows: [], durationMs: 0, returnedRecordCount: 0 };
  }
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const includedUtcDays = getLastUtcDays(30);
  const rangeStart = cargoVolumeRangeStart(includedUtcDays);
  const flux = `from(bucket: "${bucket}")
  |> range(start: time(v: "${rangeStart}"))
  |> filter(fn: (r) => r._measurement == "cargo_cost_allocation")
  |> filter(fn: (r) => r._field == "cargoVolume")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.cycleId and exists r.allocationIndex and exists r.fleet and exists r.assignment)
  |> group(columns: ["cycleId", "fleet", "assignment"])
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group()
  |> keep(columns: ["_time", "_value", "fleet", "assignment", "cycleId"])`;
  const includedDays = new Set(includedUtcDays.map((date) => getUtcDateKey(date)));
  const startedAt = Date.now();
  const cycleRows = parseInfluxCsv(await queryInfluxFlux(settings, flux));
  const rows = buildCargoVolumeRows(cycleRows, includedDays);
  return { rows, durationMs: Date.now() - startedAt, returnedRecordCount: cycleRows.length };
}

async function fetchCargoCompletionEvidenceRows(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) return [];
  const bucket = escapeFluxString(settings.influxBucket);
  const scopeFilterFlux = buildInstanceScopeFilter(settings);
  const flux = `from(bucket: "${bucket}")
  |> range(start: -31d)
  |> filter(fn: (r) => r._measurement == "cargo_cycle_completed" and r._field == "legCount")
${scopeFilterFlux}
  |> filter(fn: (r) => exists r.fleet and exists r.assignment and exists r.cycleId)
  |> keep(columns: ["fleet", "assignment", "cycleId", "_time", "_value"])
  |> sort(columns: ["_time", "fleet", "assignment"])`;
  return parseInfluxCsv(await queryInfluxFlux(settings, flux));
}

const cargoAllocationSource = createCargoAllocationSource({
  parseCsv: parseInfluxCsv,
  queryBatch: async (settings, batch) => queryInfluxFlux(
    settings,
    buildCargoAllocationPivotFlux(escapeFluxString(settings.influxBucket), buildInstanceScopeFilter(settings), batch)
  ),
  projectRows: createCargoAllocationProjector({
    fetchCargoRows: fetchCargoEarningsRows,
    fetchCompletionRows: fetchCargoCompletionEvidenceRows,
    fetchPrices: fetchCurrentEarningsPrices,
    fetchRawCosts: fetchCanonicalRawCargoCosts,
    getIncludedDays: () => getLastUtcDays(30).map((date) => getUtcDateKey(date)),
    mergeCargoRows: mergeCargoRowsWithCompletedAllocations,
    cargoFleetAccountFromCycleId,
    filterCompleted: filterCargoAllocationsToCompletedCycles,
    exporterForFaction,
    selectCutover: selectLegacyRawCutover,
    valueRawCosts: valueCanonicalRawCosts,
    resolvePrice: (asset, date) => resolveHistoricalAtlasPrice(asset, date),
    requireFuelPrice: requireCargoFuelPrice,
    requireSameDatePrice: requireSameDateCargoPrice,
    aggregateRawCosts: aggregateRawCostsByFleetDay,
    applyRawCosts: applyRawCostsToCargoAllocations,
    groupRows: groupCargoAllocationRows,
    valueNativeCost,
    formatDate: formatShortUtcDate,
  }),
});

async function fetchCargoAllocationSnapshot(payload) {
  const settings = normalizeSettings(payload || (await readSettings()));
  cargoAllocationSource.cancelExcept(settings);
  return cargoAllocationSource.load(settings, { retry: Boolean(payload?.retry) });
}

async function fetchCanonicalRawCargoCosts(settings) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) return { records: [], rejected: [], query: '' };
  const query = buildRawCostFluxQuery(settings.influxBucket);
  const rows = parseInfluxCsv(await queryInfluxFlux(settings, query));
  const projected = projectRawCostEvents(rows);
  return { ...projected, query };
}

async function recoverMissingRentalCrew(records, connection, sot) {
  const missingByAccount = new Map();
  for (const record of records) {
    if (Number.isFinite(record.requiredCrew) && record.requiredCrew > 0) continue;
    const earliest = missingByAccount.get(record.fleetAccount);
    if (!earliest || record.isoDate < earliest) missingByAccount.set(record.fleetAccount, record.isoDate);
  }
  const accounts = Array.from(missingByAccount.keys());
  if (!accounts.length || !connection || !sot?.byName) return records;

  const fleetInfos = await connection.getMultipleAccountsInfo(accounts.map((account) => new PublicKey(account)), 'confirmed');
  const candidates = [];
  for (let index = 0; index < accounts.length; index += 1) {
    const data = fleetInfos[index]?.data;
    if (!data || data.length < fleetFieldOffsets.fleetShips + 32) continue;
    const fleetShips = readPublicKey(data, fleetFieldOffsets.fleetShips);
    if (!fleetShips || fleetShips === DEFAULT_PUBLIC_KEY) continue;
    candidates.push({ fleetAccount: accounts[index], fleetShips, earliest: missingByAccount.get(accounts[index]) });
  }

  const stableCandidates = [];
  for (const candidate of candidates) {
    const signatures = await connection.getSignaturesForAddress(new PublicKey(candidate.fleetShips), { limit: 1000 }, 'confirmed');
    const earliestMs = Date.parse(`${candidate.earliest}T00:00:00.000Z`);
    const hasChangeInRange = signatures.some((entry) => !entry.err && Number(entry.blockTime) * 1000 >= earliestMs);
    const historyTruncated = signatures.length === 1000
      && Number(signatures[signatures.length - 1]?.blockTime) * 1000 >= earliestMs;
    if (!hasChangeInRange && !historyTruncated) stableCandidates.push(candidate);
  }
  if (!stableCandidates.length) return records;

  const fleetShipsInfos = await connection.getMultipleAccountsInfo(
    stableCandidates.map((candidate) => new PublicKey(candidate.fleetShips)),
    'confirmed',
  );
  const compositions = fleetShipsInfos.map((info) => parseFleetShipsAccount(info?.data));
  const shipAccounts = Array.from(new Set(compositions.flat().map((entry) => entry.shipAccount)));
  const shipInfos = shipAccounts.length
    ? await connection.getMultipleAccountsInfo(shipAccounts.map((account) => new PublicKey(account)), 'confirmed')
    : [];
  const shipNames = new Map(shipAccounts.map((account, index) => [account, parseShipAccount(shipInfos[index]?.data, account).name]));
  const recovered = new Map();
  stableCandidates.forEach((candidate, index) => {
    const composition = compositions[index];
    let total = 0;
    let complete = composition.length > 0;
    for (const entry of composition) {
      const requiredCrew = Number(sot.byName.get(normalizeShipName(shipNames.get(entry.shipAccount)))?.requiredCrew);
      if (!Number.isFinite(requiredCrew) || requiredCrew <= 0) {
        complete = false;
        break;
      }
      total += entry.amount * requiredCrew;
    }
    if (complete && total > 0) recovered.set(candidate.fleetAccount, total);
  });
  return applyVerifiedFleetCrew(records, recovered);
}

async function fetchRentalHistoryIndex(settings, connection, sot) {
  if (!settings?.influxUrl || !settings?.influxAuthToken || !settings?.influxBucket) {
    return createRentalHistoryIndex([]);
  }
  const flux = buildRentalHistoryFluxQuery(settings.influxBucket);
  const rows = parseInfluxCsv(await queryInfluxFlux(settings, flux));
  const records = projectRentalHistoryRows(rows);
  const recoveredRecords = await recoverMissingRentalCrew(records, connection, sot).catch(() => records);
  return createRentalHistoryIndex(recoveredRecords);
}

async function fetchEarningsSnapshot(payload, diagnosticContext = null) {
  const rawPayload = payload || (await readSettings());
  const settings = normalizeSettings(rawPayload);
  const snapshotScope = String(rawPayload.earningsScope || rawPayload.earningsSubtab || '').trim().toLowerCase();
  const needsInventoryLedger = ['breakeven', 'crafting', 'upgrading'].includes(snapshotScope);
  const fleetResult = await fetchProfileFleets(settings);
  const fleets = Array.isArray(fleetResult.fleets) ? fleetResult.fleets : [];
  const connection = createSolanaConnection(settings);

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
  // Freeze the already-loaded current priceATL values once. The resolver owns
  // date precedence so cargo accounting never embeds temporary pricing rules.
  await atlasPriceResolver.captureCurrentPriceSeeds({
    ...(prices.resourcePricesAtlByName || {}),
    Fuel: fuelPriceAtl,
    SOL: atlasPerSol,
  });

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
      const cargoCapacityRaw = Number(sotRow?.cargoCapacity);
      const cargoCapacityMapped = Number.isFinite(cargoCapacityRaw) && cargoCapacityRaw >= 0;
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
        cargoCapacity: cargoCapacityMapped ? cargoCapacityRaw : null,
        mapped,
      };
    });
    return {
      ...fleet,
      expectedSduPerScan,
      expectedSduValueAtl: sduPriceAtl != null ? expectedSduPerScan * sduPriceAtl : null,
      totalRequiredCrew: totalRequiredCrew > 0 ? totalRequiredCrew : null,
      totalCargoCapacity: calculateFleetCargoCapacity(ships),
      shipTypes: ships.length,
      ships,
    };
  });

  fleetRows.sort((a, b) => (Number(b.expectedSduPerScan) || 0) - (Number(a.expectedSduPerScan) || 0));

  const fleetByLabel = new Map();
  const fleetByAccount = new Map();
  // Cross-faction leak fix: the wallet's `fetchProfileFleets` is
  // filtered by `ownerProfile` / `subProfile` but NOT by faction, so a
  // single profile can own fleets in multiple factions (MUD/USTUR/ONI)
  // with overlapping labels like "MF-01". The Influx query is faction-
  // tagged correctly, but the join here is by label only, so the first
  // wallet fleet with a given label wins — which might be from another
  // faction. Filter the Map by the wallet's `faction` field (Starbase
  // enum: 1=MUD, 2=ONI, 3=USTUR) so only the selected faction's fleets
  // are eligible. Unaligned fleets (faction=0 / undefined) are kept so
  // we don't drop old data that predates the faction byte.
  const settingsFaction = normalizeFaction(settings.faction);
  const walletFactionMatches = (fleet) => {
    if (!Number.isFinite(Number(fleet.faction)) || Number(fleet.faction) === 0) return true;
    const mapped = { 1: 'MUD', 2: 'ONI', 3: 'USTUR' }[Number(fleet.faction)];
    return mapped === settingsFaction;
  };
  for (const fleet of fleetRows) {
    if (!walletFactionMatches(fleet)) continue;
    const key = normalizeFleetLabel(fleet.label);
    if (key && !fleetByLabel.has(key)) fleetByLabel.set(key, fleet);
    const account = String(fleet.key || '').trim();
    if (account && !fleetByAccount.has(account)) fleetByAccount.set(account, fleet);
  }

  let scanningRows = [];
  let scanningError = '';
  let miningRows = [];
  let miningError = '';
  let cargoRows = [];
  let cargoError = '';
  let craftingRows = [];
  let craftingError = '';
  let upgradingRows = [];
  let upgradingError = '';
  let rawCargoCosts = { records: [], rejected: [], query: '' };
  let rawCargoCostError = '';
  let rentalHistoryIndex = createRentalHistoryIndex([]);
  let rentalHistoryError = '';
  let cargoAllocationLedgerRows = [];
  let cargoAllocationLedgerError = '';
  // Each category already fans out into several Flux queries. Starting all
  // five categories at once overloads the Influx proxy (17+ concurrent
  // queries) and causes 504s, so use bounded category concurrency instead.
  const earningsTasks = [
    () => fetchScanningEarningsRows(settings),
    () => fetchMiningEarningsRows(settings),
    () => fetchCargoEarningsRows(settings),
    () => fetchCraftingEarningsRows(settings),
    () => fetchUpgradingEarningsRows(settings),
    () => fetchCanonicalRawCargoCosts(settings),
    () => fetchCargoVolumeEarningsRows(settings),
    () => fetchRentalHistoryIndex(settings, connection, sot),
    () => needsInventoryLedger ? cargoAllocationSource.load(settings) : Promise.resolve({ ok: true, rows: [] }),
  ];
  const earningsCategoryNames = ['Scanning', 'Mining', 'Cargo', 'Crafting', 'Upgrading'];
  if (diagnosticContext) diagnosticContext.stage = 'category_collection';
  const earningsRowResults = new Array(earningsTasks.length);
  let nextEarningsTask = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (nextEarningsTask < earningsTasks.length) {
      const index = nextEarningsTask++;
      try {
        earningsRowResults[index] = { status: 'fulfilled', value: await earningsTasks[index]() };
        if (diagnosticContext && earningsCategoryNames[index]) {
          diagnosticContext.categories[earningsCategoryNames[index]] = { status: 'fulfilled' };
        }
      } catch (reason) {
        earningsRowResults[index] = { status: 'rejected', reason };
        if (diagnosticContext && earningsCategoryNames[index]) {
          diagnosticContext.categories[earningsCategoryNames[index]] = { status: 'rejected', error: reason };
        }
      }
    }
  }));
  const [scanningResult, miningResult, cargoResult, craftingResult, upgradingResult, rawCargoCostResult, cargoVolumeResult, rentalHistoryResult, cargoAllocationLedgerResult] = earningsRowResults;
  if (diagnosticContext) diagnosticContext.stage = 'projection';
  if (scanningResult.status === 'fulfilled') scanningRows = scanningResult.value;
  else scanningError = String(scanningResult.reason?.message || scanningResult.reason || 'scan_rows_unavailable');
  if (miningResult.status === 'fulfilled') miningRows = miningResult.value;
  else miningError = String(miningResult.reason?.message || miningResult.reason || 'mining_rows_unavailable');
  if (cargoResult.status === 'fulfilled') cargoRows = cargoResult.value;
  else cargoError = String(cargoResult.reason?.message || cargoResult.reason || 'cargo_rows_unavailable');
  if (craftingResult.status === 'fulfilled') craftingRows = craftingResult.value;
  else craftingError = String(craftingResult.reason?.message || craftingResult.reason || 'crafting_rows_unavailable');
  if (upgradingResult.status === 'fulfilled') upgradingRows = upgradingResult.value;
  else upgradingError = String(upgradingResult.reason?.message || upgradingResult.reason || 'upgrading_rows_unavailable');
  if (craftingResult.status === 'fulfilled' && upgradingResult.status === 'fulfilled') {
    craftingRows = removeUpgradeMirroredCraftingEvents(craftingRows, upgradingRows.jobs || []);
  }
  if (rawCargoCostResult.status === 'fulfilled') rawCargoCosts = rawCargoCostResult.value;
  else rawCargoCostError = String(rawCargoCostResult.reason?.message || rawCargoCostResult.reason || 'raw_cargo_cost_rows_unavailable');
  const cargoVolumeFetch = cargoVolumeResult.status === 'fulfilled'
    ? cargoVolumeResult.value
    : { rows: [], durationMs: null, returnedRecordCount: 0 };
  const cargoVolumeRows = cargoVolumeFetch.rows;
  const cargoVolumeError = cargoVolumeResult.status === 'fulfilled'
    ? ''
    : String(cargoVolumeResult.reason?.message || cargoVolumeResult.reason || 'cargo_volume_rows_unavailable').slice(0, 240);
  if (rentalHistoryResult.status === 'fulfilled') rentalHistoryIndex = rentalHistoryResult.value;
  else rentalHistoryError = String(rentalHistoryResult.reason?.message || rentalHistoryResult.reason || 'rental_history_unavailable').slice(0, 240);
  if (cargoAllocationLedgerResult.status === 'fulfilled' && cargoAllocationLedgerResult.value?.ok) {
    cargoAllocationLedgerRows = cargoAllocationLedgerResult.value.rows || [];
    cargoAllocationLedgerError = cargoAllocationLedgerResult.value.refreshError || '';
  } else {
    cargoAllocationLedgerError = String(cargoAllocationLedgerResult.reason?.message || cargoAllocationLedgerResult.reason || cargoAllocationLedgerResult.value?.error || 'cargo_allocation_ledger_unavailable').slice(0, 240);
  }

  const rentalForRow = (fleet, fleetLabel, isoDate, authoritativeFleetAccount = '') => resolveHistoricalRental(rentalHistoryIndex, {
    fleetAccount: authoritativeFleetAccount || fleet?.key || '',
    fleetLabel,
    faction: settingsFaction,
    isoDate,
  });

  const compatibilityCargoRows = cargoRows;
  const rawExporter = exporterForFaction(settings.faction);
  const cutoverSelection = rawExporter
    ? selectLegacyRawCutover({ legacyRows: compatibilityCargoRows, rawRecords: rawCargoCosts.records, ...rawExporter })
    : { cutover: null, legacyRows: cargoRows, rawRecords: [], trackingDisabled: false };
  const valuedCanonicalRawCosts = await valueCanonicalRawCosts(cutoverSelection.rawRecords, {
    resolvePrice: async (asset, date) => asset === 'Fuel'
      ? requireCargoFuelPrice(await resolveHistoricalAtlasPrice(asset, date), date)
      : requireSameDateCargoPrice(await resolveHistoricalAtlasPrice(asset, date), date),
  });
  const canonicalRawDailyRows = aggregateRawCostsByFleetDay(valuedCanonicalRawCosts)
    .map((row) => projectCargoTableRow(row, { formatDate: (isoDate) => formatShortUtcDate(new Date(`${isoDate}T00:00:00.000Z`)) }));
  const cutoverOwnedCargoRows = selectCutoverOwnedCargoRows({
    legacyRows: cutoverSelection.legacyRows,
    operationalRows: rawExporter ? compatibilityCargoRows.map((row) => ({
      ...row,
      faction: rawExporter.faction,
      instance: rawExporter.instance,
      fleetAccount: String(row.fleetAccount || '').trim(),
    })) : [],
    cutover: cutoverSelection.cutover,
  });
  cargoRows = joinCanonicalCostsWithOperationalRows({
    legacyRows: cutoverOwnedCargoRows.legacyRows.map((row) => projectCargoTableRow(row, { formatDate: (isoDate) => formatShortUtcDate(new Date(`${isoDate}T00:00:00.000Z`)) })),
    costRows: canonicalRawDailyRows,
    operationalRows: cutoverOwnedCargoRows.operationalRows,
  });

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
    const historicalRental = rentalForRow(fleet, scanRow.fleet, scanRow.isoDate);
    const rentalRateAtlasPerDay = historicalRental?.rentalCostAtlas ?? null;
    const totalRequiredCrew = historicalRental?.requiredCrew ?? fleet?.totalRequiredCrew ?? null;
    const costParts = [foodCostsAtlas, fuelCostsAtlas, rentalRateAtlasPerDay, txsCostsAtlas].filter((value) => Number.isFinite(value));
    const totalCostsAtlas = costParts.length ? costParts.reduce((sum, value) => sum + value, 0) : null;
    const revenueAtlasPerDay = sduPriceAtl != null ? scanRow.sduFound * sduPriceAtl : null;
    const netProfitAtlas = Number.isFinite(revenueAtlasPerDay) && Number.isFinite(totalCostsAtlas)
      ? revenueAtlasPerDay - totalCostsAtlas
      : null;
    return {
      ...scanRow,
      fleetName: scanRow.fleet,
      fleetAccount: fleet?.key || historicalRental?.fleetAccount || '',
      rented: Boolean(historicalRental),
      ownership: fleet?.ownership || '',
      relationship: fleet?.relationship || '',
      activity: fleet?.activity || '',
      ships: fleet?.ships || [],
      shipTypes: fleet?.shipTypes || 0,
      expectedSduPerScan: fleet?.expectedSduPerScan ?? null,
      expectedSduValueAtl: fleet?.expectedSduValueAtl ?? null,
      totalRequiredCrew,
      crewSnapshotSource: historicalRental?.crewSnapshotSource || (fleet?.totalRequiredCrew ? 'current_fleet_composition' : ''),
      revenueAtlasPerDay,
      foodCostsAtlas,
      fuelCostsAtlas,
      txsCostsAtlas,
      totalCostsAtlas,
      netProfitAtlas,
      netProfitPerCrew: Number.isFinite(netProfitAtlas) && Number.isFinite(totalRequiredCrew) && totalRequiredCrew > 0
        ? netProfitAtlas / totalRequiredCrew
        : null,
      profitMarginPercent: Number.isFinite(netProfitAtlas) && Number.isFinite(revenueAtlasPerDay) && revenueAtlasPerDay !== 0
        ? (netProfitAtlas / revenueAtlasPerDay) * 100
        : null,
      rentalContract: historicalRental?.rentalContract || null,
      rentalRateAtlasPerDay,
    };
  });

  for (const row of rows) {
    row.costsPerUnitAtlas = Number.isFinite(Number(row.totalCostsAtlas)) && Number(row.sduFound) > 0
      ? Number(row.totalCostsAtlas) / Number(row.sduFound)
      : null;
  }

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
    const historicalRental = rentalForRow(fleet, miningRow.fleet, miningRow.isoDate);
    const rentalRateAtlasPerDay = historicalRental?.rentalCostAtlas ?? null;
    const totalRequiredCrew = historicalRental?.requiredCrew ?? fleet?.totalRequiredCrew ?? null;
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
      fleetAccount: fleet?.key || historicalRental?.fleetAccount || '',
      rented: Boolean(historicalRental),
      ownership: fleet?.ownership || '',
      relationship: fleet?.relationship || '',
      activity: fleet?.activity || '',
      ships: fleet?.ships || [],
      shipTypes: fleet?.shipTypes || 0,
      totalRequiredCrew,
      crewSnapshotSource: historicalRental?.crewSnapshotSource || (fleet?.totalRequiredCrew ? 'current_fleet_composition' : ''),
      rawMaterialPriceAtl,
      revenueAtlasPerDay,
      ammoCostsAtlas,
      foodCostsAtlas,
      fuelCostsAtlas,
      txsCostsAtlas,
      totalCostsAtlas,
      netProfitAtlas,
      netProfitPerCrew: Number.isFinite(netProfitAtlas) && Number.isFinite(totalRequiredCrew) && totalRequiredCrew > 0
        ? netProfitAtlas / totalRequiredCrew
        : null,
      profitMarginPercent: Number.isFinite(netProfitAtlas) && Number.isFinite(revenueAtlasPerDay) && revenueAtlasPerDay !== 0
        ? (netProfitAtlas / revenueAtlasPerDay) * 100
        : null,
      rentalContract: historicalRental?.rentalContract || null,
      rentalRateAtlasPerDay,
    };
  });

  const miningCostTotalsByFleetDateAndMaterial = new Map();
  for (const row of mining) {
    const key = `${row.isoDate}\n${row.fleetName}\n${row.rawMaterial}`;
    const current = miningCostTotalsByFleetDateAndMaterial.get(key) || { mined: 0, totalCostsAtlas: 0, costRowCount: 0 };
    if (Number.isFinite(Number(row.mined)) && Number(row.mined) > 0) current.mined += Number(row.mined);
    if (Number.isFinite(Number(row.totalCostsAtlas))) {
      current.totalCostsAtlas += Number(row.totalCostsAtlas);
      current.costRowCount += 1;
    }
    miningCostTotalsByFleetDateAndMaterial.set(key, current);
  }
  for (const row of mining) {
    const totals = miningCostTotalsByFleetDateAndMaterial.get(`${row.isoDate}\n${row.fleetName}\n${row.rawMaterial}`);
    row.costsPerUnitAtlas = totals?.costRowCount > 0 && totals.mined > 0
      ? totals.totalCostsAtlas / totals.mined
      : null;
  }
  const activeCargoFleetKeys = new Set();
  const activeMappedCargoFleetKeys = new Set();
  let cargo = await Promise.all(cargoRows.map(async (cargoRow) => {
    const canonicalRaw = cargoRow.sourceMode === 'canonical_raw' || cargoRow.sourceMode === 'mixed_cost_source';
    const fuelCanonical = cargoRow.costSourceSelection?.fuel === 'canonical' || cargoRow.sourceMode === 'canonical_raw';
    const feeCanonical = cargoRow.costSourceSelection?.fee === 'canonical' || cargoRow.sourceMode === 'canonical_raw';
    const authoritativeAccount = String(cargoRow.fleetAccount || '').trim();
    const fleet = (authoritativeAccount ? fleetByAccount.get(authoritativeAccount) : null)
      || (!authoritativeAccount ? fleetByLabel.get(normalizeFleetLabel(cargoRow.fleet)) : null);
    const activeKey = fleet?.key || (canonicalRaw ? String(cargoRow.allocationKey || '') : normalizeFleetLabel(cargoRow.fleet));
    activeCargoFleetKeys.add(activeKey);
    if (fleet) activeMappedCargoFleetKeys.add(fleet.key);
    const fuelPrice = fuelCanonical ? cargoRow.fuelValuation : requireCargoFuelPrice(await resolveHistoricalAtlasPrice('Fuel', cargoRow.isoDate), cargoRow.isoDate);
    const fuelCostsAtlas = fuelCanonical
      ? (cargoRow.fuelValuation?.amountATL ?? null)
      : (['complete', 'provisional'].includes(fuelPrice.status) ? cargoRow.burnedFuel * fuelPrice.priceATL : null);
    const solValuation = feeCanonical ? cargoRow.solValuation : null;
    const txsCostsAtlas = feeCanonical
      ? (solValuation?.amountATL ?? null)
      : (atlasPerSol != null ? cargoRow.txCostSol * atlasPerSol : null);
    const historicalRental = rentalForRow(fleet, cargoRow.fleet, cargoRow.isoDate, authoritativeAccount);
    const rentalRateAtlasPerDay = historicalRental?.rentalCostAtlas ?? null;
    const totalRequiredCrew = historicalRental?.requiredCrew ?? fleet?.totalRequiredCrew ?? null;
    const incompleteRawValuation = (fuelCanonical && Number(cargoRow.burnedFuel) > 0 && !Number.isFinite(fuelCostsAtlas)) || (feeCanonical && BigInt(cargoRow.txFeeLamports || '0') > 0n && !Number.isFinite(txsCostsAtlas));
    const costParts = [fuelCostsAtlas, rentalRateAtlasPerDay, txsCostsAtlas].filter((value) => Number.isFinite(value));
    const totalCostsAtlas = !incompleteRawValuation && costParts.length ? costParts.reduce((sum, value) => sum + value, 0) : null;
    const netProfitAtlas = Number.isFinite(totalCostsAtlas) ? -totalCostsAtlas : null;
    return {
      ...cargoRow,
      profile: profileName,
      faction: normalizeFaction(settings.faction),
      fleetName: fleet?.label || (cargoRow.allocationStatus === 'unallocated' ? 'Unallocated' : cargoRow.fleet),
      fleetAccount: fleet?.key || historicalRental?.fleetAccount || cargoRow.fleetAccount || '',
      rented: Boolean(historicalRental),
      ownership: fleet?.ownership || '',
      relationship: fleet?.relationship || '',
      activity: fleet?.activity || '',
      ships: fleet?.ships || [],
      shipTypes: fleet?.shipTypes || 0,
      totalRequiredCrew,
      crewSnapshotSource: historicalRental?.crewSnapshotSource || (fleet?.totalRequiredCrew ? 'current_fleet_composition' : ''),
      fleetCargoCapacity: fleet?.totalCargoCapacity ?? null,
      cargoCycles: cargoRow.cargoCycles == null ? null : Number(cargoRow.cargoCycles),
      cargoLegs: cargoRow.cargoLegs == null ? null : Number(cargoRow.cargoLegs),
      starbaseLabel: Array.isArray(cargoRow.starbases) && cargoRow.starbases.length ? cargoRow.starbases.join(', ') : '--',
      fuelCostsAtlas,
      fuelPriceEffectiveUtcDate: fuelPrice?.effectiveUtcDate,
      fuelPriceDay: fuelPrice?.priceDay,
      fuelPriceSource: fuelPrice?.source,
      fuelPriceProvenance: fuelPrice?.provenance,
      fuelPriceEstimated: fuelPrice?.estimated,
      fuelValuationStatus: fuelPrice?.status,
      fuelValuation: canonicalRaw ? cargoRow.fuelValuation : null,
      solValuation,
      rentalContract: historicalRental?.rentalContract || null,
      rentalRateAtlasPerDay,
      txsCostsAtlas,
      totalCostsAtlas,
      netProfitAtlas,
      txsCostsPercent: Number.isFinite(txsCostsAtlas) && Number.isFinite(totalCostsAtlas) && totalCostsAtlas > 0
        ? (txsCostsAtlas / totalCostsAtlas) * 100
        : null,
    };
  }));
  cargo = projectCargoFleetDateRows(cargo, { profile: profileName, faction: normalizeFaction(settings.faction) });
  const rawCargoCostSelectionStats = cargoCostSourceSelectionStats(cargo, rawCargoCosts.rejected);
  const legacyCargoCostPool = buildCargoCostPool(cargo.filter((row) => row.sourceMode !== 'canonical_raw').map((row) => ({
    fleetAccount: row.fleetAccount || row.fleetName,
    isoDate: row.isoDate,
    assignment: row.assignment,
    rentalContract: row.rentalContract,
    costSources: [
      ...(Number.isFinite(row.rentalRateAtlasPerDay) ? [{
        kind: 'rental', daily: true, contractId: row.rentalContract,
        amount: row.rentalRateAtlasPerDay, currency: 'ATLAS', timestamp: `${row.isoDate}T00:00:00.000Z`,
        valuation: { status: 'native' },
      }] : []),
      ...(row.costSourceSelection?.fuel !== 'canonical' && Number(row.burnedFuel) > 0 ? [{
        kind: 'fuel', amount: Number(row.burnedFuel), currency: 'FUEL', timestamp: `${row.isoDate}T00:00:00.000Z`,
        valuation: row.fuelValuationStatus === 'complete' ? {
          status: 'complete', amountATL: row.fuelCostsAtlas, effectiveUtcDate: row.fuelPriceEffectiveUtcDate,
          source: row.fuelPriceSource, provenance: row.fuelPriceProvenance, estimated: row.fuelPriceEstimated,
        } : { status: 'incomplete', amountATL: null, effectiveUtcDate: row.isoDate },
      }] : []),
      ...(row.costSourceSelection?.fee !== 'canonical' && Number(row.txCostSol) > 0 ? [{
        kind: 'transaction_fee', amount: Number(row.txCostSol), currency: 'SOL', timestamp: `${row.isoDate}T00:00:00.000Z`,
        valuation: Number.isFinite(row.txsCostsAtlas) ? { status: 'complete', amountATL: row.txsCostsAtlas, source: prices.atlasPerSolSource } : { status: 'incomplete', amountATL: null },
      }] : []),
    ],
  })));
  const canonicalRawCostPool = buildCanonicalRawCostPool(valuedCanonicalRawCosts, rawCargoCosts.rejected);
  const cargoCostPool = mergeCargoCostPools(legacyCargoCostPool, canonicalRawCostPool);
  const scopedCargoFleetAccounts = new Set(compatibilityCargoRows
    .map((row) => String(row.fleetAccount || '').trim())
    .filter(Boolean));
  const completedCargoCycleIds = new Set(compatibilityCargoRows
    .flatMap((row) => Array.isArray(row.completedCycleIds) ? row.completedCycleIds : [])
    .map((cycleId) => String(cycleId || '').trim())
    .filter(Boolean));
  const scopedCargoVolumeRows = cargoVolumeRows.filter((row) =>
    scopedCargoFleetAccounts.has(String(row.fleetAccount || '').trim())
      && completedCargoCycleIds.has(String(row.cycleId || '').trim())
  );
  const cargoVolumeByFleetDayMap = buildCargoVolumeByFleetDay(scopedCargoVolumeRows);
  const cargoVolumeAvailable = cargoVolumeResult.status === 'fulfilled';
  for (const row of cargo) {
    const volumeKey = `${row.isoDate}\n${normalizeFleetLabel(row.fleetAccount)}`;
    const cargoVolume = cargoVolumeAvailable && cargoVolumeByFleetDayMap.has(volumeKey)
      ? cargoVolumeByFleetDayMap.get(volumeKey)
      : null;
    const efficiency = calculateCargoEfficiency({
      cargoVolume,
      fleetCargoCapacity: row.fleetCargoCapacity,
      cargoLegs: row.cargoLegs,
    });
    row.cargoVolume = cargoVolume;
    row.cargoCapacity = efficiency.cargoCapacity;
    row.cargoEfficiencyPercent = efficiency.cargoEfficiencyPercent;
  }

  const cargoFetchDiagnostics = {
    fuelPrices: cargo.reduce((summary, row) => {
      const status = row.fuelValuationStatus === 'complete' ? 'exact' : row.fuelValuationStatus === 'provisional' ? 'provisional' : 'unavailable';
      summary[status] += 1;
      return summary;
    }, { exact: 0, provisional: 0, unavailable: 0 }),
    volume: {
      durationMs: cargoVolumeFetch.durationMs,
      returnedRecordCount: cargoVolumeFetch.returnedRecordCount,
      deduplicatedAllocations: cargoVolumeRows.length,
      completedCycleMatches: scopedCargoVolumeRows.length,
      projectedFleetDayVolumes: cargoVolumeByFleetDayMap.size,
      failureReason: cargoVolumeError || null,
    },
  };

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

  // Internal weighted-cost ledger adapter. The UI does not consume this yet;
  // later patches will reconcile this chronological production basis against
  // inventory and add cargo/crafting/market events.
  const ledgerCraftingRows = (craftingRows.ledgerEvents || []).map((row) => ({
    ...row,
    feeCostsAtlas: Number.isFinite(Number(row.feeAmount)) ? Number(row.feeAmount) : null,
    txsCostsAtlas: atlasPerSol != null && Number.isFinite(Number(row.txCostSol)) ? Number(row.txCostSol) * atlasPerSol : null,
  }));
  const ledgerFaction = normalizeFaction(settings.faction);
  const ledgerFactionStarbases = needsInventoryLedger ? await fetchFactionStarbases(settings) : null;
  const localMarketResult = needsInventoryLedger
    ? await fetchMarketplaceTradesFromInflux(settings)
    : { trades: [], error: '' };
  const marketplaceAssetFlowEvents = needsInventoryLedger ? await fetchMarketplaceAssetFlowsFromInflux(settings).catch(() => []) : [];
  const inventoryBasisObservations = needsInventoryLedger ? await readInventoryBasisSnapshots({
    bucket: settings.influxBucket,
    query: (flux) => queryInfluxFlux(settings, flux).then(parseInfluxCsv),
  }).catch(() => []) : [];
  const factionCustodyLedger = buildFactionCustodyLedgerEvents({
    flows: marketplaceAssetFlowEvents,
    observations: inventoryBasisObservations,
    faction: ledgerFaction,
  });
  const checkpointPath = ledgerCheckpointPath(ledgerFaction);
  const checkpoint = needsInventoryLedger
    ? await loadLedgerCheckpoint(checkpointPath, { faction: ledgerFaction, profile: profileName })
    : { status: 'skipped', ledger: null, seenEventFingerprints: [], eventResultByFingerprint: {}, eventFingerprintCounts: {}, eventResultsByFingerprint: {}, savedAt: null };
  let openingInventoryRows = [];
  let openingInventoryError = '';
  if (needsInventoryLedger && checkpoint.status !== 'loaded') {
    try {
      openingInventoryRows = (await fetchOpeningPerStarbaseInventory(settings))
        .filter((row) => isStarbaseIncluded(row.starbase, ledgerFactionStarbases, ledgerFaction));
    } catch (error) {
      openingInventoryError = String(error?.message || error || 'opening_inventory_unavailable');
    }
  }
  const inventoryCostLedgerResult = needsInventoryLedger ? buildCostLedgerResult({
    initialLedger: checkpoint.status === 'loaded' ? checkpoint.ledger : null,
    seenEventFingerprints: checkpoint.seenEventFingerprints,
    eventResultByFingerprint: checkpoint.eventResultByFingerprint,
    eventFingerprintCounts: checkpoint.eventFingerprintCounts,
    eventResultsByFingerprint: checkpoint.eventResultsByFingerprint,
    openingInventoryRows,
    scanningRows: rows,
    miningRows: mining,
    cargoRows: cargoAllocationLedgerRows,
    craftingRows: ledgerCraftingRows,
    upgradingRows: upgradingRows.ledgerEvents || [],
    localMarketTrades: localMarketResult.trades,
    assetFlowEvents: factionCustodyLedger.events,
    inventoryBasisFaction: ledgerFaction,
  }) : { events: [], appliedEventResults: [], ledger: { snapshot: () => [] }, rejectedEvents: [], seenEventFingerprints: [], eventResultByFingerprint: {}, eventFingerprintCounts: {}, eventResultsByFingerprint: {}, inventoryBasisSnapshots: [] };
  const inventoryCostLedgerEvents = inventoryCostLedgerResult.events;
  const inventoryCostLedgerAppliedEventResults = inventoryCostLedgerResult.appliedEventResults;
  const inventoryCostLedgerRows = inventoryCostLedgerResult.ledger.snapshot();
  const inventoryCostLedgerRejectedEvents = [
    ...inventoryCostLedgerResult.rejectedEvents,
    ...factionCustodyLedger.rejected.map(({ flow, reason }) => ({ event: flow, error: reason })),
  ];
  let pendingInventoryBasisSnapshots = Array.from(new Map([
    ...(checkpoint.pendingInventoryBasisSnapshots || []),
    ...(inventoryCostLedgerResult.inventoryBasisSnapshots || []),
  ].map((snapshot) => [snapshot.snapshotId, snapshot])).values());
  let ledgerCheckpointStatus = checkpoint.status === 'loaded' ? 'updated' : 'created';
  let ledgerCheckpointError = checkpoint.status === 'invalid' ? checkpoint.error : '';
  let ledgerCheckpointSavedAt = checkpoint.savedAt;
  let inventoryBasisPublishedCount = 0;
  let inventoryBasisPublicationError = '';
  if (!needsInventoryLedger) {
    ledgerCheckpointStatus = 'skipped';
  } else if (checkpoint.status !== 'loaded' && openingInventoryError) {
    ledgerCheckpointStatus = 'baseline-unavailable';
  } else {
    try {
      await saveLedgerCheckpoint(checkpointPath, {
        faction: ledgerFaction,
        profile: profileName,
        ledger: inventoryCostLedgerResult.ledger,
        seenEventFingerprints: inventoryCostLedgerResult.seenEventFingerprints,
        eventResultByFingerprint: inventoryCostLedgerResult.eventResultByFingerprint,
        eventFingerprintCounts: inventoryCostLedgerResult.eventFingerprintCounts,
        eventResultsByFingerprint: inventoryCostLedgerResult.eventResultsByFingerprint,
        pendingInventoryBasisSnapshots,
      });
      ledgerCheckpointSavedAt = new Date().toISOString();
      const publication = await publishInventoryBasisSnapshots(pendingInventoryBasisSnapshots, {
        writeLines: (lines) => writeInventoryBasisLinesToInflux(settings, lines),
      });
      inventoryBasisPublishedCount = publication.confirmedSnapshotIds.length;
      inventoryBasisPublicationError = publication.error;
      if (inventoryBasisPublishedCount > 0) {
        pendingInventoryBasisSnapshots = publication.pendingSnapshots;
        await saveLedgerCheckpoint(checkpointPath, {
          faction: ledgerFaction,
          profile: profileName,
          ledger: inventoryCostLedgerResult.ledger,
          seenEventFingerprints: inventoryCostLedgerResult.seenEventFingerprints,
          eventResultByFingerprint: inventoryCostLedgerResult.eventResultByFingerprint,
          eventFingerprintCounts: inventoryCostLedgerResult.eventFingerprintCounts,
          eventResultsByFingerprint: inventoryCostLedgerResult.eventResultsByFingerprint,
          pendingInventoryBasisSnapshots,
        });
        ledgerCheckpointSavedAt = new Date().toISOString();
      }
    } catch (error) {
      ledgerCheckpointStatus = 'save-failed';
      ledgerCheckpointError = String(error?.message || error || 'checkpoint_save_failed');
    }
  }

  const craftingBasisByDay = buildCurrentInventoryCraftingBasisByDay({ craftingRows, inventoryRows: inventoryCostLedgerRows });
  const upgradingBasisByDay = new Map();
  const totalLotBasis = (lot) => Object.values(lot?.costs || {}).reduce((sum, value) => sum + Number(value || 0), 0) + Number(lot?.cargoCost || 0);
  for (const applied of inventoryCostLedgerAppliedEventResults) {
    const event = applied.event;
    const lot = applied.result;
    const isoDate = getUtcDateKey(new Date(event.timestamp));
    if (event.type === 'consume' && event.purpose === 'upgrading') {
      const key = `${isoDate}\n${event.location}\n${event.asset}`;
      const entry = upgradingBasisByDay.get(key) || { basis: 0, uncosted: false };
      entry.basis += totalLotBasis(lot);
      entry.uncosted ||= Number(lot?.uncostedQuantity || 0) > 0;
      upgradingBasisByDay.set(key, entry);
    }
  }

  // Breakeven analysis: combine per-starbase mining production cost and
  // per-destination cargo allocation cost with current inventory and the
  // current GM price. The inventory fetch is best-effort: a failure here
  // just leaves `breakevenRows` empty and surfaces the error so the UI
  // can warn instead of crashing the rest of the snapshot.
  let breakevenRows = [];
  let breakevenError = '';
  try {
    const inventoryRows = await fetchCurrentPerStarbaseInventory(settings);
    const factionStarbases = ledgerFactionStarbases || await fetchFactionStarbases(settings);
    const faction = ledgerFaction;
    breakevenRows = buildLedgerBreakevenRows({ ledgerRows: inventoryCostLedgerRows, inventoryRows, prices })
      .filter((row) => isStarbaseIncluded(row.starbase, factionStarbases, faction));
  } catch (error) {
    breakevenError = String(error?.message || error || 'breakeven_unavailable');
  }

  // Crafting per-row enrichment: each row is per (starbase, output, date).
  // Revenue = crafted * outputPriceAtl. IngCosts = sum over all
  // ingredients of (ingredientAmount * ingredientPriceAtl). FeeCosts is
  // the crafting fee in ATLAS (no unit conversion). TxsCosts is
  // txCostSol converted to ATLAS via atlasPerSol. TotalCosts is the sum;
  // NetProfit is Revenue - TotalCosts; ProfitMargin is NetProfit/Revenue
  // * 100. txsDaily is the count of crafting events for this
  // (starbase, output, date), already aggregated by the fetch.
  const crafting = enrichCraftingEarningsRows({
    craftingRows,
    craftingBasisByDay,
    resolvePrice: (asset) => getCurrentResourcePriceAtl(prices, asset),
    atlasPerSol,
  });

  let redeemedLpByFactionAndDate = {};
  try {
    redeemedLpByFactionAndDate = await Promise.race([
      fetchFactionRedeemedLpByDate(settings),
      new Promise((_, reject) => setTimeout(() => reject(new Error('lp_summary_timeout')), 8000)),
    ]);
  } catch (error) {
    upgradingError = upgradingError || String(error?.message || error || 'lp_summary_unavailable');
  }
  const faction = normalizeFaction(settings.faction);
  const atlasPool = UPGRADE_ATLAS_POOLS[faction];
  const upgrading = upgradingRows.map((row) => {
    const factionRedeemedLp = Number(redeemedLpByFactionAndDate[faction]?.[row.isoDate]);
    const atlasPerLp = Number.isFinite(factionRedeemedLp) && factionRedeemedLp > 0 ? atlasPool / factionRedeemedLp : null;
    const componentKey = normalizeShipName(row.asset);
    const lpPerComponent = UPGRADE_LP_BY_COMPONENT[componentKey] ?? null;
    const lpValuePerComponentAtl = atlasPerLp != null && lpPerComponent != null ? atlasPerLp * lpPerComponent : null;
    const revenueAtlasPerDay = lpValuePerComponentAtl != null ? row.installed * lpValuePerComponentAtl : null;
    const componentBasis = upgradingBasisByDay.get(`${row.isoDate}\n${row.starbase}\n${row.asset}`);
    const upgradingCostsAtlas = componentBasis && !componentBasis.uncosted ? componentBasis.basis : null;
    const componentPriceAtl = getCurrentResourcePriceAtl(prices, row.asset);
    const componentExternalValueAtlas = componentPriceAtl == null ? null : row.installed * componentPriceAtl;
    const txsCostsAtlas = atlasPerSol != null ? row.txCostSol * atlasPerSol : null;
    const totalCostsAtlas = Number.isFinite(upgradingCostsAtlas) && Number.isFinite(txsCostsAtlas) ? upgradingCostsAtlas + txsCostsAtlas : null;
    const netProfitAtlas = Number.isFinite(revenueAtlasPerDay) && Number.isFinite(totalCostsAtlas) ? revenueAtlasPerDay - totalCostsAtlas : null;
    const externalTotalCostsAtlas = Number.isFinite(componentExternalValueAtlas) && Number.isFinite(txsCostsAtlas) ? componentExternalValueAtlas + txsCostsAtlas : null;
    const externalNetProfitAtlas = Number.isFinite(revenueAtlasPerDay) && Number.isFinite(externalTotalCostsAtlas) ? revenueAtlasPerDay - externalTotalCostsAtlas : null;
    return { ...row, output: row.asset, assetName: row.asset, factionRedeemedLp: Number.isFinite(factionRedeemedLp) ? factionRedeemedLp : null, lpPerComponent, lpValuePerComponentAtl, revenueAtlasPerDay, upgradingCostsAtlas, componentExternalValueAtlas, txsCostsAtlas, totalCostsAtlas, netProfitAtlas, netProfitPerCrew: Number.isFinite(netProfitAtlas) && row.crew > 0 ? netProfitAtlas / row.crew : null, profitMarginPercent: Number.isFinite(netProfitAtlas) && Number.isFinite(revenueAtlasPerDay) && revenueAtlasPerDay !== 0 ? (netProfitAtlas / revenueAtlasPerDay) * 100 : null, externalTotalCostsAtlas, externalNetProfitAtlas, externalNetProfitPerCrew: Number.isFinite(externalNetProfitAtlas) && row.crew > 0 ? externalNetProfitAtlas / row.crew : null, externalProfitMarginPercent: Number.isFinite(externalNetProfitAtlas) && Number.isFinite(revenueAtlasPerDay) && revenueAtlasPerDay !== 0 ? (externalNetProfitAtlas / revenueAtlasPerDay) * 100 : null };
  }).sort((a,b) => String(b.isoDate).localeCompare(String(a.isoDate)) || a.starbase.localeCompare(b.starbase) || a.asset.localeCompare(b.asset));

  crafting.sort((a, b) => {
    const dateSort = String(b.isoDate || '').localeCompare(String(a.isoDate || ''));
    if (dateSort) return dateSort;
    const starbaseSort = String(a.starbase || '').localeCompare(String(b.starbase || ''));
    if (starbaseSort) return starbaseSort;
    return String(a.output || '').localeCompare(String(b.output || ''));
  });

  // "Best of yesterday" metric cards: top fleet by net profit, top fleet
  // by net profit per crew, and top fleet by scan success rate for
  // scanning; top fleet by net profit, top fleet by net profit per crew,
  // and top raw material by total mined for mining. The scanning rows
  // are already per (fleet, day) so the best-of just filters by day and
  // picks the row with the max value. Mining rows are per
  // (fleet, starbase, raw material, day) so net profit and mined need
  // to be summed per fleet / per raw material across starbases+materials.
  // "Yesterday" is the UTC calendar day before today (NOT a rolling
  // 24h window, NOT the local calendar date). The data is already
  // daily-aggregated by UTC day so this matches the Influx data 1:1
  // with no timezone boundary fuzz.
  const now = new Date();
  const yesterdayIsoDate = getUtcDateKey(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
  );
  const todayIsoDate = getUtcDateKey(new Date());
  const yesterdayScanRows = rows.filter((row) => row.isoDate === yesterdayIsoDate);
  const netProfitByFleetScanYesterday = new Map();
  const totalCrewByFleetScanYesterday = new Map();
  for (const row of yesterdayScanRows) {
    if (!Number.isFinite(Number(row.netProfitAtlas))) continue;
    const key = row.fleetName || row.fleet || 'Unnamed fleet';
    netProfitByFleetScanYesterday.set(key, (netProfitByFleetScanYesterday.get(key) || 0) + Number(row.netProfitAtlas));
  }
  for (const row of yesterdayScanRows) {
    if (!Number.isFinite(Number(row.totalRequiredCrew)) || Number(row.totalRequiredCrew) <= 0) continue;
    const key = row.fleetName || row.fleet || 'Unnamed fleet';
    if (!totalCrewByFleetScanYesterday.has(key)) totalCrewByFleetScanYesterday.set(key, Number(row.totalRequiredCrew));
  }
  const topScanNetProfitFleetYesterday = Array.from(netProfitByFleetScanYesterday.entries())
    .map(([fleetName, netProfitAtlas]) => ({ fleetName, netProfitAtlas }))
    .sort((a, b) => b.netProfitAtlas - a.netProfitAtlas || a.fleetName.localeCompare(b.fleetName))[0] || null;
  const topScanNetProfitPerCrewFleetYesterday = Array.from(netProfitByFleetScanYesterday.entries())
    .map(([fleetName, netProfitAtlas]) => ({
      fleetName,
      netProfitPerCrew: netProfitAtlas / (totalCrewByFleetScanYesterday.get(fleetName) || NaN),
    }))
    .filter((entry) => Number.isFinite(entry.netProfitPerCrew))
    .sort((a, b) => b.netProfitPerCrew - a.netProfitPerCrew || a.fleetName.localeCompare(b.fleetName))[0] || null;
  const topScanSuccessRateFleetYesterday = yesterdayScanRows
    .filter((row) => Number.isFinite(Number(row.scanSuccessRatePercent)))
    .map((row) => ({
      fleetName: row.fleetName || row.fleet || 'Unnamed fleet',
      scanSuccessRatePercent: Number(row.scanSuccessRatePercent),
    }))
    .sort((a, b) => b.scanSuccessRatePercent - a.scanSuccessRatePercent || a.fleetName.localeCompare(b.fleetName))[0] || null;

  const yesterdayMiningRows = mining.filter((row) => row.isoDate === yesterdayIsoDate);
  const netProfitByFleetMiningYesterday = new Map();
  const totalCrewByFleetMiningYesterday = new Map();
  const minedByRawMaterialYesterday = new Map();
  for (const row of yesterdayMiningRows) {
    if (!Number.isFinite(Number(row.netProfitAtlas))) continue;
    const key = row.fleetName || row.fleet || 'Unnamed fleet';
    netProfitByFleetMiningYesterday.set(key, (netProfitByFleetMiningYesterday.get(key) || 0) + Number(row.netProfitAtlas));
  }
  for (const row of yesterdayMiningRows) {
    if (!Number.isFinite(Number(row.totalRequiredCrew)) || Number(row.totalRequiredCrew) <= 0) continue;
    const key = row.fleetName || row.fleet || 'Unnamed fleet';
    if (!totalCrewByFleetMiningYesterday.has(key)) totalCrewByFleetMiningYesterday.set(key, Number(row.totalRequiredCrew));
  }
  for (const row of yesterdayMiningRows) {
    if (!Number.isFinite(Number(row.mined))) continue;
    const material = row.rawMaterial || 'Unknown';
    minedByRawMaterialYesterday.set(material, (minedByRawMaterialYesterday.get(material) || 0) + Number(row.mined));
  }
  const topMiningNetProfitFleetYesterday = Array.from(netProfitByFleetMiningYesterday.entries())
    .map(([fleetName, netProfitAtlas]) => ({ fleetName, netProfitAtlas }))
    .sort((a, b) => b.netProfitAtlas - a.netProfitAtlas || a.fleetName.localeCompare(b.fleetName))[0] || null;
  const topMiningNetProfitPerCrewFleetYesterday = Array.from(netProfitByFleetMiningYesterday.entries())
    .map(([fleetName, netProfitAtlas]) => ({
      fleetName,
      netProfitPerCrew: netProfitAtlas / (totalCrewByFleetMiningYesterday.get(fleetName) || NaN),
    }))
    .filter((entry) => Number.isFinite(entry.netProfitPerCrew))
    .sort((a, b) => b.netProfitPerCrew - a.netProfitPerCrew || a.fleetName.localeCompare(b.fleetName))[0] || null;
  const topMiningRawMaterialYesterday = Array.from(minedByRawMaterialYesterday.entries())
    .map(([rawMaterial, mined]) => ({ rawMaterial, mined }))
    .sort((a, b) => b.mined - a.mined || a.rawMaterial.localeCompare(b.rawMaterial))[0] || null;

  // Crafting today + yesterday metric cards. Same 4-box layout as
  // mining but with crafting's natural unit being the output asset
  // (not a fleet), and profit margin / revenue as the secondary
  // metrics (no per-crew concept in crafting).
  const yesterdayCraftingRows = crafting.filter((row) => row.isoDate === yesterdayIsoDate);
  const todayCraftingRows = crafting.filter((row) => row.isoDate === todayIsoDate);
  const netProfitByCraftingAssetYesterday = new Map();
  const netProfitByCraftingAssetToday = new Map();
  const profitMarginByCraftingAssetYesterday = new Map();
  const revenueByCraftingAssetYesterday = new Map();
  for (const row of yesterdayCraftingRows) {
    if (!Number.isFinite(Number(row.netProfitAtlas))) continue;
    const key = row.output || 'Unknown';
    netProfitByCraftingAssetYesterday.set(key, (netProfitByCraftingAssetYesterday.get(key) || 0) + Number(row.netProfitAtlas));
  }
  for (const row of todayCraftingRows) {
    if (!Number.isFinite(Number(row.netProfitAtlas))) continue;
    const key = row.output || 'Unknown';
    netProfitByCraftingAssetToday.set(key, (netProfitByCraftingAssetToday.get(key) || 0) + Number(row.netProfitAtlas));
  }
  for (const row of yesterdayCraftingRows) {
    if (!Number.isFinite(Number(row.profitMarginPercent))) continue;
    const key = row.output || 'Unknown';
    // Average margin across all (starbase, date) rows for the asset,
    // weighted by revenue: only one date (yesterday), so simple
    // revenue-weighted average. (Same approach as scanning/mining
    // per-crew: numerator is the day's summed NP, denominator is the
    // day's summed revenue.)
    const current = profitMarginByCraftingAssetYesterday.get(key) || { netProfit: 0, revenue: 0 };
    current.netProfit += Number(row.netProfitAtlas) || 0;
    current.revenue += Number(row.revenueAtlasPerDay) || 0;
    profitMarginByCraftingAssetYesterday.set(key, current);
  }
  for (const row of yesterdayCraftingRows) {
    if (!Number.isFinite(Number(row.revenueAtlasPerDay))) continue;
    const key = row.output || 'Unknown';
    revenueByCraftingAssetYesterday.set(key, (revenueByCraftingAssetYesterday.get(key) || 0) + Number(row.revenueAtlasPerDay));
  }
  const topCraftingNetProfitAssetToday = Array.from(netProfitByCraftingAssetToday.entries())
    .map(([asset, netProfitAtlas]) => ({ asset, netProfitAtlas }))
    .sort((a, b) => b.netProfitAtlas - a.netProfitAtlas || a.asset.localeCompare(b.asset))[0] || null;
  const topCraftingNetProfitAssetYesterday = Array.from(netProfitByCraftingAssetYesterday.entries())
    .map(([asset, netProfitAtlas]) => ({ asset, netProfitAtlas }))
    .sort((a, b) => b.netProfitAtlas - a.netProfitAtlas || a.asset.localeCompare(b.asset))[0] || null;
  const topCraftingProfitMarginAssetYesterday = Array.from(profitMarginByCraftingAssetYesterday.entries())
    .map(([asset, sums]) => ({
      asset,
      profitMarginPercent: sums.revenue > 0 ? (sums.netProfit / sums.revenue) * 100 : null,
    }))
    .filter((entry) => Number.isFinite(entry.profitMarginPercent))
    .sort((a, b) => b.profitMarginPercent - a.profitMarginPercent || a.asset.localeCompare(b.asset))[0] || null;
  const topCraftingRevenueAssetYesterday = Array.from(revenueByCraftingAssetYesterday.entries())
    .map(([asset, revenue]) => ({ asset, revenue }))
    .sort((a, b) => b.revenue - a.revenue || a.asset.localeCompare(b.asset))[0] || null;

  const activeFleetRows = fleetRows.filter((fleet) => activeMappedFleetKeys.has(fleet.key));
  const totalExpectedSduPerScan = activeFleetRows.reduce((sum, fleet) => sum + (Number(fleet.expectedSduPerScan) || 0), 0);
  const todayRentalByFleet = new Map();
  for (const row of [...rows, ...mining, ...cargo]) {
    if (row.isoDate !== todayIsoDate || !Number.isFinite(Number(row.rentalRateAtlasPerDay))) continue;
    const key = String(row.fleetAccount || row.fleetName || row.fleet || '').trim();
    if (key && !todayRentalByFleet.has(key)) todayRentalByFleet.set(key, Number(row.rentalRateAtlasPerDay));
  }
  const rentalAtlasPerDay = Array.from(todayRentalByFleet.values()).reduce((sum, value) => sum + value, 0);
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
    cargoFetchDiagnostics,
    rawCargoCostError,
    rentalHistoryError,
    cargoAllocationLedgerError,
    rawCargoCostQuery: rawCargoCosts.query,
    rawCargoCostCutoverManifestVersion: RAW_COST_CUTOVER_MANIFEST_VERSION,
    rawCargoCostCutoverUtc: cutoverSelection.cutover,
    rawCargoCostTrackingDisabled: cutoverSelection.trackingDisabled,
    rawCargoCostRecordCount: valuedCanonicalRawCosts.length,
    rawCargoCostRejectedCount: rawCargoCosts.rejected.length,
    rawCargoCostSelectionStats,
    activeMiningFleetCount: activeMiningFleetKeys.size,
    activeMappedMiningFleetCount: activeMappedMiningFleetKeys.size,
    miningRowCount: mining.length,
    activeCargoFleetCount: activeCargoFleetKeys.size,
    activeMappedCargoFleetCount: activeMappedCargoFleetKeys.size,
    cargoRowCount: cargo.length,
    cargoCostPool,
    cargoCostCount: cargoCostPool.costs.length,
    cargoCostNeedsReviewCount: cargoCostPool.pending.length,
    totalMined,
    totalMiningRevenueAtlas: totalMiningRevenueCount > 0 ? totalMiningRevenueAtlas : null,
    todayMined: todayMiningTotals.mined,
    averageMinedPerDay,
    todayMiningRevenueAtlas: todayMiningTotals.revenueCount > 0 ? todayMiningTotals.revenueAtlas : null,
    averageMiningRevenueAtlasPerDay,
    topMiningNetProfitFleetToday,
    topScanNetProfitFleetYesterday,
    topScanNetProfitPerCrewFleetYesterday,
    topScanSuccessRateFleetYesterday,
    topMiningNetProfitFleetYesterday,
    topMiningNetProfitPerCrewFleetYesterday,
    topMiningRawMaterialYesterday,
    topCraftingNetProfitAssetToday,
    topCraftingNetProfitAssetYesterday,
    topCraftingProfitMarginAssetYesterday,
    topCraftingRevenueAssetYesterday,
    craftingError,
    craftingRowCount: crafting.length,
    upgradingError,
    upgradingRowCount: upgrading.length,
    fleets: fleetRows,
    rows,
    miningRows: mining,
    cargoRows: cargo,
    craftingRows: crafting,
    upgradingRows: upgrading,
    breakevenRows,
    breakevenError,
    localMarketTrades: localMarketResult.trades,
    localMarketTradeCount: localMarketResult.trades.length,
    localMarketError: localMarketResult.error,
    inventoryCostLedgerEvents,
    inventoryCostLedgerAppliedEventResults,
    inventoryCostLedgerRows,
    inventoryCostLedgerRejectedEvents,
    openingInventoryCount: openingInventoryRows.length,
    openingInventoryError,
    ledgerCheckpointStatus,
    ledgerCheckpointError,
    ledgerCheckpointSavedAt,
    pendingInventoryBasisSnapshotCount: pendingInventoryBasisSnapshots.length,
    inventoryBasisPublishedCount,
    inventoryBasisPublicationError,
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
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

const rendererUrl = pathToFileURL(path.join(__dirname, 'renderer.html')).href;

const RPC_USAGE_ROUTES = Object.freeze({
  'fleet:list': ['MF', 'fleets'],
  'earnings:snapshot': ['EA', null],
  'earnings:cargo-allocation': ['EA', 'cargo'],
  'marketplace:snapshot': ['EA', 'marketplace'], 'marketplace:sync': ['EA', 'marketplace'],
  'sdu:daily': ['PC', 'scanning'], 'sdu:consumption': ['PC', 'scanning'],
  'mining:daily': ['PC', 'mining'], 'crafting:daily': ['PC', 'crafting'], 'production:daily': ['PC', 'production'],
  'consumption:mining': ['PC', 'consumption'], 'consumption:crafting': ['PC', 'consumption'],
  'consumption:upgrading': ['PC', 'consumption'], 'consumption:scanning': ['PC', 'consumption'],
  'consumption:cargo': ['PC', 'consumption'], 'consumption:total': ['PC', 'consumption'],
  'pcr:daily': ['PC', 'pct-charts'], 'inventory:daily': ['PC', 'inventory'],
  'optimization:scanning': ['OP', 'scanning'], 'optimization:upgrading': ['OP', 'upgrading'],
});

function handleTrustedIpc(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      assertTrustedSender(event, mainWindow?.webContents, rendererUrl);
      args.forEach((arg) => validateIpcPayload(arg));
      const hydratedArgs = channel === 'settings:save' || channel === 'rpc-limiter:send-settings'
        ? args
        : await Promise.all(args.map((arg) => (
          arg && typeof arg === 'object' && !Array.isArray(arg)
            ? hydrateSecureSettings(arg)
            : arg
        )));
      const route = RPC_USAGE_ROUTES[channel];
      if (!route) return await handler(event, ...hydratedArgs);
      const [menu, fixedTab] = route;
      const payload = hydratedArgs[0] || {};
      const tab = fixedTab || String(payload.earningsSubtab || 'total');
      return await runTelemetryFeature(payload, menu, () => handler(event, ...hydratedArgs), tab);
    } catch (error) {
      if (channel === 'earnings:snapshot') {
        const context = earningsDiagnosticContexts.get(error) || {};
        earningsDiagnosticContexts.delete(error);
        await earningsErrorDiagnostic.record({
          correlationId: context.correlationId || `earnings-${crypto.randomUUID()}`,
          channel,
          faction: context.faction || normalizeFaction(args[0]?.faction),
          boundary: 'main',
          source: 'handleTrustedIpc',
          stage: context.stage || 'trusted_ipc_preflight',
          categories: context.categories || {},
          error,
        }).catch(() => {});
      }
      throw error;
    }
  });
}

handleTrustedIpc('app:get-profile-name', () => profileName);
handleTrustedIpc('app:get-version', () => packageJson.version);
handleTrustedIpc('telemetry:rpc-usage-day', (_event, utcDate) => getRpcUsageDay(utcDate));
handleTrustedIpc('updates:check', () => checkForUpdates());
handleTrustedIpc('updates:download-and-restart', () => downloadUpdateAndRestart());
handleTrustedIpc('settings:get', async () => redactSettings(await readSettings()));
handleTrustedIpc('settings:save', async (_event, payload) => redactSettings(await writeSettings(payload)));
handleTrustedIpc('rpc-limiter:get-status', () => getRpcLimiterStatus());
handleTrustedIpc('rpc-limiter:send-settings', async (_event, payload) => sendSettingsToRpcLimiter(payload));

function runTelemetryFeature(payload, feature, callback, suboperation) {
  const mappedFeature = feature === 'Fleet discovery' ? 'MF' : feature === 'Earnings' ? 'EA' : feature;
  const mappedSuboperation = suboperation || (mappedFeature === 'MF' ? 'fleets'
    : mappedFeature === 'EA' ? String(payload?.earningsSubtab || 'total') : 'none');
  const safe = normalizeTelemetryContext({
    profile: profileName,
    faction: payload?.faction,
    feature: mappedFeature,
    suboperation: mappedSuboperation,
    trigger: payload?.trigger,
  });
  return runFeature(safe, callback);
}

handleTrustedIpc('fleet:list', async (_event, payload) => runTelemetryFeature(payload, 'Fleet discovery', async () => {
  try {
    return await fetchProfileFleets(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'fleet_list_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
}));
handleTrustedIpc('earnings:snapshot', async (_event, payload) => {
  const diagnosticContext = {
    correlationId: `earnings-${crypto.randomUUID()}`,
    channel: 'earnings:snapshot',
    faction: normalizeFaction(payload?.faction),
    stage: 'preflight',
    categories: {
      Scanning: { status: 'pending' },
      Mining: { status: 'pending' },
      Cargo: { status: 'pending' },
      Crafting: { status: 'pending' },
      Upgrading: { status: 'pending' },
    },
  };
  try {
    return await runTelemetryFeature(payload, 'Earnings', async () => {
      try {
        return await fetchEarningsSnapshot(payload, diagnosticContext);
      } catch (error) {
        await earningsErrorDiagnostic.record({ ...diagnosticContext, boundary: 'main', source: 'fetchEarningsSnapshot', error }).catch(() => {});
        return {
          ok: false,
          error: String(error?.message || error || 'earnings_snapshot_failed'),
          checkedAt: new Date().toISOString(),
        };
      }
    });
  } catch (error) {
    earningsDiagnosticContexts.set(error, { ...diagnosticContext, stage: 'telemetry_wrapper' });
    throw error;
  }
});
handleTrustedIpc('diagnostic:earnings-renderer', async (_event, payload) => {
  try {
    await earningsRendererErrorDiagnostic.record({
      correlationId: payload?.correlationId,
      channel: 'earnings:snapshot',
      faction: normalizeFaction(payload?.faction),
      boundary: 'renderer',
      source: 'refreshEarnings',
      stage: payload?.stage || 'renderer_catch',
      error: payload?.error,
    });
    return { ok: true };
  } catch (_diagnosticError) {
    return { ok: false };
  }
});
registerCargoAllocationIpc(handleTrustedIpc, {
  runTelemetry: runTelemetryFeature,
  loadAllocation: fetchCargoAllocationSnapshot,
});
handleTrustedIpc('marketplace:snapshot', async (_event, payload) => fetchMarketplaceSnapshot(payload));
handleTrustedIpc('marketplace:sync', async (_event, payload) => runTelemetryFeature(payload, 'EA', async () => {
  try {
    return await syncMarketplaceTrades(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'marketplace_sync_failed'),
      marketplaceRpcTelemetry: error?.marketplaceRpcTelemetry || null,
      marketplaceSyncAttempt: error?.marketplaceSyncAttempt || null,
      checkedAt: new Date().toISOString(),
    };
  }
}, 'marketplace'));
handleTrustedIpc('influx:test', async (_event, payload) => {
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
handleTrustedIpc('sdu:daily', async (_event, payload) => {
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
handleTrustedIpc('sdu:consumption', async (_event, payload) => {
  try {
    return await fetchDailySduConsumption(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'sdu_consumption_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});
handleTrustedIpc('mining:daily', async (_event, payload) => {
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
handleTrustedIpc('crafting:daily', async (_event, payload) => {
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
handleTrustedIpc('production:daily', async (_event, payload) => {
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
handleTrustedIpc('consumption:mining', async (_event, payload) => {
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
handleTrustedIpc('consumption:crafting', async (_event, payload) => {
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
handleTrustedIpc('consumption:upgrading', async (_event, payload) => {
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
handleTrustedIpc('consumption:scanning', async (_event, payload) => {
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
handleTrustedIpc('consumption:cargo', async (_event, payload) => {
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
handleTrustedIpc('consumption:total', async (_event, payload) => {
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
handleTrustedIpc('pcr:daily', async (_event, payload) => {
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

handleTrustedIpc('inventory:daily', async (_event, payload) => {
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

handleTrustedIpc('optimization:scanning', async (_event, payload) => {
  try {
    return await fetchScanningOptimization(payload);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'optimization_scanning_failed'),
      checkedAt: new Date().toISOString(),
    };
  }
});

handleTrustedIpc('optimization:upgrading', async (_event, payload) => {
  try { return await fetchUpgradingOptimization(payload); }
  catch (error) { return { ok: false, error: String(error?.message || error || 'optimization_upgrading_failed'), checkedAt: new Date().toISOString() }; }
});

app.whenReady().then(async () => {
  void telemetryLedger.start().catch(() => {});
  const powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  console.log(`[MSA] prevent-app-suspension blocker=${powerSaveBlockerId} active=${powerSaveBlocker.isStarted(powerSaveBlockerId)}`)

  try { await recoverMarketplacePublication(await readSettings()); }
  catch (_error) { /* recovery is fail-closed and will retry on the next sync */ }
  createWindow();
});

let telemetryQuitFlushStarted = false;
app.on('before-quit', (event) => {
  if (telemetryQuitFlushStarted) return;
  telemetryQuitFlushStarted = true;
  event.preventDefault();
  telemetryLedger.stop().finally(() => app.quit());
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
