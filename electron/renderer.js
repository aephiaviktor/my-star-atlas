const api = window.myStarAtlas;
const requestGuard = window.RequestGuard.createRequestGuard();
const rpcUsageModel = window.RpcUsageModel;

function getRefreshContext(filters = {}) {
  const settings = latestSettings || getFormPayload();
  return {
    faction: normalizeFaction(settings?.faction),
    playerProfile: getActivePlayerProfile(settings),
    ...filters,
  };
}

const form = document.querySelector('#settings-form');
const appShell = document.querySelector('.app-shell');
const saveStatus = document.querySelector('#save-status');
const syncDot = document.querySelector('.sync-dot');
const toggleSensitiveButton = document.querySelector('#toggle-sensitive-btn');
const rpcLimiterMainUrl = document.querySelector('#rpc-limiter-main-url');
const rpcLimiterFallbackUrl = document.querySelector('#rpc-limiter-fallback-url');
const rpcLimiterStatePath = document.querySelector('#rpc-limiter-state-path');
const rpcLimiterActive = document.querySelector('#rpc-limiter-active');
const rpcLimiterUpdated = document.querySelector('#rpc-limiter-updated');
const sendRpcLimiterButton = document.querySelector('#send-rpc-limiter-btn');
const testInfluxButton = document.querySelector('#test-influx-btn');
const fleetSearchInput = document.querySelector('#fleet-search-input');
const openSettingsButton = document.querySelector('#open-settings-btn');
const closeSettingsButton = document.querySelector('#close-settings-btn');
const sidebarToggleButton = document.querySelector('#sidebar-toggle-btn');
const settingsOverlay = document.querySelector('#settings-overlay');
const profileLabel = document.querySelector('#profile-label');
const versionLabel = document.querySelector('#version-label');
const refreshDataButton = document.querySelector('#refresh-data-btn');
const updateButton = document.querySelector('#update-btn');
const updateModal = document.querySelector('#update-modal');
const updateCurrentVersion = document.querySelector('#update-current-version');
const updateLatestVersion = document.querySelector('#update-latest-version');
const updateMessage = document.querySelector('#update-message');
const updateConfirmButton = document.querySelector('#update-confirm-btn');
const updateCancelButton = document.querySelector('#update-cancel-btn');
const rpcUsageButton = document.querySelector('#rpc-usage-btn');
const rpcUsageModal = document.querySelector('#rpc-usage-modal');
const rpcUsageCloseButton = document.querySelector('#rpc-usage-close-btn');
const rpcUsageDateSelect = document.querySelector('#rpc-usage-date-select');
const rpcUsageFactionSelect = document.querySelector('#rpc-usage-faction-select');
const rpcUsageMethodSelect = document.querySelector('#rpc-usage-method-select');
const rpcUsagePeriod = document.querySelector('#rpc-usage-period');
const rpcUsageContent = document.querySelector('#rpc-usage-content');
const rpcUsageEmpty = document.querySelector('#rpc-usage-empty');
const rpcUsageTotal = document.querySelector('#rpc-usage-total');
const rpcUsageFiltered = document.querySelector('#rpc-usage-filtered');
const rpcUsageShare = document.querySelector('#rpc-usage-share');
const rpcUsageRetries = document.querySelector('#rpc-usage-retries');
const rpcUsageFallbacks = document.querySelector('#rpc-usage-fallbacks');
const rpcUsageProviders = document.querySelector('#rpc-usage-providers');
const rpcUsageUpdated = document.querySelector('#rpc-usage-updated');
const rpcUsageMethodBody = document.querySelector('#rpc-usage-method-body');
const measurementList = document.querySelector('#measurement-list');
const fleetSyncStatus = document.querySelector('#fleet-sync-status');
const fleetTableBody = document.querySelector('#fleet-table-body');
const optimizationSyncStatus = document.querySelector('#optimization-sync-status');
const optimizationTableHead = document.querySelector('#optimization-table-head');
const optimizationTableBody = document.querySelector('#optimization-table-body');
const optimizationColumnList = document.querySelector('#optimization-column-list');
const optimizationLoadMore = document.querySelector('#optimization-load-more');
const optimizationStartFilter = document.querySelector('#optimization-start-filter');
const optimizationStopFilter = document.querySelector('#optimization-stop-filter');
const optimizationFleetFilter = document.querySelector('#optimization-fleet-filter');
const optimizationExperimentFilter = document.querySelector('#optimization-experiment-filter');
const optimizationEventFilter = document.querySelector('#optimization-event-filter');
const optimizationOperationFilter = document.querySelector('#optimization-operation-filter');
const optimizationParameterFilter = document.querySelector('#optimization-parameter-filter');
const optimizationUpgradingSyncStatus = document.querySelector('#optimization-upgrading-sync-status');
const optimizationUpgradingTableHead = document.querySelector('#optimization-upgrading-table-head');
const optimizationUpgradingTableBody = document.querySelector('#optimization-upgrading-table-body');
const optimizationUpgradingStartFilter = document.querySelector('#optimization-upgrading-start-filter');
const optimizationUpgradingStopFilter = document.querySelector('#optimization-upgrading-stop-filter');
const optimizationAnalyticsDatePicker = document.querySelector('#optimization-analytics-date-picker');
const optimizationAnalyticsDateSummary = document.querySelector('#optimization-analytics-date-summary');
const optimizationAnalyticsCalendarPrevious = document.querySelector('#optimization-analytics-calendar-previous');
const optimizationAnalyticsCalendarNext = document.querySelector('#optimization-analytics-calendar-next');
const optimizationAnalyticsCalendarMonth = document.querySelector('#optimization-analytics-calendar-month');
const optimizationAnalyticsDateCalendar = document.querySelector('#optimization-analytics-date-calendar');
const optimizationAnalyticsOnlyOptimization = document.querySelector('#optimization-analytics-only-optimization');
const optimizationAnalyticsExperiment = document.querySelector('#optimization-analytics-experiment');
const optimizationAnalyticsMetric = document.querySelector('#optimization-analytics-metric');
const optimizationAnalyticsParameter = document.querySelector('#optimization-analytics-parameter');
const optimizationAnalyticsStatus = document.querySelector('#optimization-analytics-status');
const optimizationAnalyticsSummary = document.querySelector('#optimization-analytics-summary');
const optimizationAnalyticsEconomics = document.querySelector('#optimization-analytics-economics');
const optimizationAnalyticsValueChart = document.querySelector('#optimization-analytics-value-chart');
const optimizationAnalyticsSectorChart = document.querySelector('#optimization-analytics-sector-chart');
const optimizationAnalyticsRankingHead = document.querySelector('#optimization-analytics-ranking-head');
const optimizationAnalyticsRanking = document.querySelector('#optimization-analytics-ranking');
const optimizationAnalyticsTooltip = document.querySelector('#optimization-analytics-tooltip');
const optimizationUpgradingAnalyticsStatus = document.querySelector('#optimization-upgrading-analytics-status');
const optimizationUpgradingSelectionV1 = document.querySelector('#optimization-upgrading-selection-v1');
const optimizationUpgradingUtilizationV1 = document.querySelector('#optimization-upgrading-utilization-v1');
const optimizationUpgradingClaimLockV1 = document.querySelector('#optimization-upgrading-claim-lock-v1');
const optimizationUpgradingOperationalV1 = document.querySelector('#optimization-upgrading-operational-v1');
const optimizationUpgradingRedemptionLegend = document.querySelector('#optimization-upgrading-redemption-legend');
const optimizationUpgradingNetAtlasChart = document.querySelector('#optimization-upgrading-net-atlas-chart');
const optimizationUpgradingLpPerCrewByRateChart = document.querySelector('#optimization-upgrading-lp-per-crew-by-rate-chart');
const optimizationUpgradingComponentCostByRateChart = document.querySelector('#optimization-upgrading-component-cost-by-rate-chart');
const optimizationUpgradingUpliftByRateChart = document.querySelector('#optimization-upgrading-uplift-by-rate-chart');
const optimizationUpgradingMarginChart = document.querySelector('#optimization-upgrading-margin-chart');
const optimizationUpgradingEfficiencyChart = document.querySelector('#optimization-upgrading-efficiency-chart');
const optimizationUpgradingEfficiencyLegend = document.querySelector('#optimization-upgrading-efficiency-legend');
const optimizationUpgradingRedemptionChart = document.querySelector('#optimization-upgrading-redemption-chart');
const optimizationUpgradingForecastChart = document.querySelector('#optimization-upgrading-forecast-chart');
const optimizationUpgradingErrorChart = document.querySelector('#optimization-upgrading-error-chart');
const optimizationUpgradingBreakevenBody = document.querySelector('#optimization-upgrading-breakeven-body');
const optimizationUpgradingBreakevenHead = document.querySelector('#optimization-upgrading-breakeven-head');
const optimizationUpgradingBreakevenBasisExternalButton = document.querySelector('#optimization-upgrading-breakeven-basis-external');
const optimizationUpgradingBreakevenBasisInternalButton = document.querySelector('#optimization-upgrading-breakeven-basis-internal');
const optimizationUpgradingBreakevenBasisEqualNetButton = document.querySelector('#optimization-upgrading-breakeven-basis-equal-net');
const optimizationUpgradingBreakevenBasisCustomButton = document.querySelector('#optimization-upgrading-breakeven-basis-custom');
const earningsSyncStatus = document.querySelector('#earnings-sync-status');
const earningsTableHead = document.querySelector('#earnings-table-head');
const earningsTableBody = document.querySelector('#earnings-table-body');
const earningsColumnControlsContainer = document.querySelector('#earnings-column-controls');
let earningsColumnControls = Array.from(document.querySelectorAll('[data-earnings-column]'));
let availableUpdate = null;
let updateCheckInFlight = false;
let rpcUsageSummary = null;
let rpcUsageLoadGeneration = 0;
const earningsSduPriceValue = document.querySelector('#earnings-sdu-price-value');
const earningsSduPriceNote = document.querySelector('#earnings-sdu-price-note');
const earningsSduScanValue = document.querySelector('#earnings-sdu-scan-value');
const earningsSduScanNote = document.querySelector('#earnings-sdu-scan-note');
const earningsSduValueValue = document.querySelector('#earnings-sdu-value-value');
const earningsSduValueNote = document.querySelector('#earnings-sdu-value-note');
const earningsRentalValue = document.querySelector('#earnings-rental-value');
const earningsRentalNote = document.querySelector('#earnings-rental-note');
const earningsNetProfitChart = document.querySelector('#earnings-net-profit-chart');
const earningsMiningSyncStatus = document.querySelector('#earnings-mining-sync-status');
const earningsMiningTableHead = document.querySelector('#earnings-mining-table-head');
const earningsMiningTableBody = document.querySelector('#earnings-mining-table-body');
const earningsMiningNetProfitChart = document.querySelector('#earnings-mining-net-profit-chart');
const earningsMiningMaterialNetProfitChart = document.querySelector('#earnings-mining-material-net-profit-chart');
const earningsMiningStarbaseNetProfitChart = document.querySelector('#earnings-mining-starbase-net-profit-chart');
const earningsMiningAmmoPriceValue = document.querySelector('#earnings-mining-ammo-price-value');
const earningsMiningAmmoPriceNote = document.querySelector('#earnings-mining-ammo-price-note');
const earningsMiningMinedValue = document.querySelector('#earnings-mining-mined-value');
const earningsMiningMinedNote = document.querySelector('#earnings-mining-mined-note');
const earningsMiningRevenueValue = document.querySelector('#earnings-mining-revenue-value');
const earningsMiningRevenueNote = document.querySelector('#earnings-mining-revenue-note');
const earningsMiningRentalValue = document.querySelector('#earnings-mining-rental-value');
const earningsMiningRentalNote = document.querySelector('#earnings-mining-rental-note');
const earningsCargoSyncStatus = document.querySelector('#earnings-cargo-sync-status');
const earningsCargoTableHead = document.querySelector('#earnings-cargo-table-head');
const earningsCargoTableBody = document.querySelector('#earnings-cargo-table-body');
const earningsCargoAllocationSyncStatus = document.querySelector('#earnings-cargo-allocation-sync-status');
const earningsCargoAllocationTableHead = document.querySelector('#earnings-cargo-allocation-table-head');
const earningsCargoAllocationTableBody = document.querySelector('#earnings-cargo-allocation-table-body');
const earningsCraftingSyncStatus = document.querySelector('#earnings-crafting-sync-status');
const earningsCraftingTableHead = document.querySelector('#earnings-crafting-table-head');
const earningsCraftingTableBody = document.querySelector('#earnings-crafting-table-body');
const earningsCraftingAssetNetProfitChart = document.querySelector('#earnings-crafting-asset-net-profit-chart');
const earningsCraftingStarbaseNetProfitChart = document.querySelector('#earnings-crafting-starbase-net-profit-chart');
const earningsCraftingTopAssetValue = document.querySelector('#earnings-crafting-top-asset-value');
const earningsCraftingTopAssetNote = document.querySelector('#earnings-crafting-top-asset-note');
const earningsCraftingBestNpValue = document.querySelector('#earnings-crafting-best-np-value');
const earningsCraftingBestNpNote = document.querySelector('#earnings-crafting-best-np-note');
const earningsCraftingBestMarginValue = document.querySelector('#earnings-crafting-best-margin-value');
const earningsCraftingBestMarginNote = document.querySelector('#earnings-crafting-best-margin-note');
const earningsCraftingBestRevenueValue = document.querySelector('#earnings-crafting-best-revenue-value');
const earningsCraftingBestRevenueNote = document.querySelector('#earnings-crafting-best-revenue-note');
const earningsCraftingDateFilter = document.querySelector('#earnings-crafting-date-filter');
const earningsCraftingStarbaseFilter = document.querySelector('#earnings-crafting-starbase-filter');
const earningsCraftingAssetFilter = document.querySelector('#earnings-crafting-asset-filter');
const earningsUpgradingSyncStatus = document.querySelector('#earnings-upgrading-sync-status');
const earningsUpgradingTableHead = document.querySelector('#earnings-upgrading-table-head');
const earningsUpgradingTableBody = document.querySelector('#earnings-upgrading-table-body');
const earningsUpgradingAssetNetProfitChart = document.querySelector('#earnings-upgrading-asset-net-profit-chart');
const earningsUpgradingDateFilter = document.querySelector('#earnings-upgrading-date-filter');
const earningsUpgradingStarbaseFilter = document.querySelector('#earnings-upgrading-starbase-filter');
const earningsUpgradingAssetFilter = document.querySelector('#earnings-upgrading-asset-filter');
const earningsBreakevenTableHead = document.querySelector('#earnings-breakeven-table-head');
const earningsBreakevenTableBody = document.querySelector('#earnings-breakeven-table-body');
const earningsBreakevenSyncStatus = document.querySelector('#earnings-breakeven-sync-status');
const earningsBreakevenStarbaseFilter = document.querySelector('#earnings-breakeven-starbase-filter');
const earningsBreakevenAssetFilter = document.querySelector('#earnings-breakeven-asset-filter');
const earningsBreakevenHideLowInventory = document.querySelector('#earnings-breakeven-hide-low-inventory');
const earningsMarketplaceSyncStatus = document.querySelector('#earnings-marketplace-sync-status');
const earningsMarketplaceTableBody = document.querySelector('#earnings-marketplace-table-body');
const earningsMarketplaceSideSwitch = document.querySelector('#earnings-marketplace-side-switch');
const earningsMarketplaceSideButtons = Array.from(document.querySelectorAll('[data-marketplace-side]'));
const earningsMarketplaceUnitHeader = document.querySelector('#earnings-marketplace-unit-header');
const earningsScanningDateFilter = document.querySelector('#earnings-scanning-date-filter');
const earningsScanningFleetFilter = document.querySelector('#earnings-scanning-fleet-filter');
const earningsMiningDateFilter = document.querySelector('#earnings-mining-date-filter');
const earningsMiningFleetFilter = document.querySelector('#earnings-mining-fleet-filter');
const earningsMiningMaterialFilter = document.querySelector('#earnings-mining-material-filter');
const earningsCargoDateFilter = document.querySelector('#earnings-cargo-date-filter');
const earningsCargoFleetFilter = document.querySelector('#earnings-cargo-fleet-filter');
const earningsCargoAllocationDateFilter = document.querySelector('#earnings-cargo-allocation-date-filter');
const earningsCargoAllocationFleetFilter = document.querySelector('#earnings-cargo-allocation-fleet-filter');
const earningsCargoAllocationAssetFilter = document.querySelector('#earnings-cargo-allocation-asset-filter');
const earningsCargoNetProfitChart = document.querySelector('#earnings-cargo-net-profit-chart');
const earningsCargoCostBreakdownChart = document.querySelector('#earnings-cargo-cost-breakdown-chart');
const sduTotalValue = document.querySelector('#sdu-total-value');
const sduTotalNote = document.querySelector('#sdu-total-note');
const sduAvgValue = document.querySelector('#sdu-avg-value');
const sduAvgNote = document.querySelector('#sdu-avg-note');
const sduTopFleetValue = document.querySelector('#sdu-top-fleet-value');
const sduTopFleetNote = document.querySelector('#sdu-top-fleet-note');
const sduDaysActiveValue = document.querySelector('#sdu-days-active-value');
const sduDaysActiveNote = document.querySelector('#sdu-days-active-note');
const sduChartTotal = document.querySelector('#sdu-chart-total');
const sduChartBars = document.querySelector('#sdu-chart-bars');
const scanningFleetFilter = document.querySelector('#scanning-fleet-filter');
const scanningFleetNote = document.querySelector('#scanning-fleet-note');
const miningTotalValue = document.querySelector('#mining-total-value');
const miningTotalNote = document.querySelector('#mining-total-note');
const miningAvgValue = document.querySelector('#mining-avg-value');
const miningAvgNote = document.querySelector('#mining-avg-note');
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
const craftingAvgValue = document.querySelector('#crafting-avg-value');
const craftingAvgNote = document.querySelector('#crafting-avg-note');
const craftingTopValue = document.querySelector('#crafting-top-value');
const craftingTopNote = document.querySelector('#crafting-top-note');
const craftingCountValue = document.querySelector('#crafting-count-value');
const craftingCountNote = document.querySelector('#crafting-count-note');
const craftingChartGrid = document.querySelector('#crafting-chart-grid');
const productionFilterNote = document.querySelector('#production-filter-note');
const productionTotalValue = document.querySelector('#production-total-value');
const productionTotalNote = document.querySelector('#production-total-note');
const productionAvgValue = document.querySelector('#production-avg-value');
const productionAvgNote = document.querySelector('#production-avg-note');
const productionTopValue = document.querySelector('#production-top-value');
const productionTopNote = document.querySelector('#production-top-note');
const productionCountValue = document.querySelector('#production-count-value');
const productionCountNote = document.querySelector('#production-count-note');
const productionChartGrid = document.querySelector('#production-chart-grid');
const productionStarbaseFilter = document.querySelector('#production-starbase-filter');
const productionAssetFilter = document.querySelector('#production-asset-filter');
// Consumption — Mining
const consMiningStarbaseFilter = document.querySelector('#consumption-mining-starbase-filter');
const consMiningFleetFilter = document.querySelector('#consumption-mining-fleet-filter');
const consMiningFilterNote = document.querySelector('#consumption-mining-filter-note');
const consMiningTotalValue = document.querySelector('#consumption-mining-total-value');
const consMiningTotalNote = document.querySelector('#consumption-mining-total-note');
const consMiningAvgValue = document.querySelector('#consumption-mining-avg-value');
const consMiningAvgNote = document.querySelector('#consumption-mining-avg-note');
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
const consCraftingAvgValue = document.querySelector('#consumption-crafting-avg-value');
const consCraftingAvgNote = document.querySelector('#consumption-crafting-avg-note');
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
const consUpgradingAvgValue = document.querySelector('#consumption-upgrading-avg-value');
const consUpgradingAvgNote = document.querySelector('#consumption-upgrading-avg-note');
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
const consScanningAvgValue = document.querySelector('#consumption-scanning-avg-value');
const consScanningAvgNote = document.querySelector('#consumption-scanning-avg-note');
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
const consCargoAvgValue = document.querySelector('#consumption-cargo-avg-value');
const consCargoAvgNote = document.querySelector('#consumption-cargo-avg-note');
const consCargoTopValue = document.querySelector('#consumption-cargo-top-value');
const consCargoTopNote = document.querySelector('#consumption-cargo-top-note');
const consCargoAssetCountValue = document.querySelector('#consumption-cargo-asset-count-value');
const consCargoAssetCountNote = document.querySelector('#consumption-cargo-asset-count-note');
const consCargoChartGrid = document.querySelector('#consumption-cargo-chart-grid');

const consTotalStarbaseFilter = document.querySelector('#consumption-total-starbase-filter');
const consTotalAssetFilter = document.querySelector('#consumption-total-asset-filter');
const consTotalFilterNote = document.querySelector('#consumption-total-filter-note');
const consTotalTotalValue = document.querySelector('#consumption-total-total-value');
const consTotalTotalNote = document.querySelector('#consumption-total-total-note');
const consTotalAvgValue = document.querySelector('#consumption-total-avg-value');
const consTotalAvgNote = document.querySelector('#consumption-total-avg-note');
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
let currentEarningsSubtab = 'scanning';
let earningsMarketplaceSide = 'buy';
let activeCargoTable = 'fleet';
let latestSettings = null;
let latestFleetResult = null;
let latestEarningsResult = null;
let latestCargoAllocationResult = null;
let cargoAllocationRequestSequence = 0;
let latestBreakevenResult = null;
let latestUpgradingResult = null;
let latestOptimizationResult = null;
let optimizationRows = [];
let optimizationAnalyticsRows = [];
let optimizationAnalyticsLoadedFaction = '';
let optimizationAnalyticsPrices = null;
let selectedScanningOptimizationDate = '';
let scanningOptimizationCalendarMonth = '';
let selectedScanningOptimizationParameter = '__all__';
let optimizationAnalyticsSort = { column: 'averageScanChance', direction: 'desc' };
let optimizationColumns = [];
let optimizationSelectedColumns = new Set();
let optimizationKnownColumns = new Set();
const OPTIMIZATION_COLUMN_STORAGE_KEY = 'my-star-atlas:optimization-scanning-columns:v1';
const upgradingBreakevenColumns = Object.freeze([
  { key: 'name', label: 'Name', selected: true },
  { key: 'upgradingTime', label: 'Upgrading time', selected: false },
  { key: 'lpValue', label: 'LP value', selected: false },
  { key: 'lpPerSecond', label: 'LP/s', selected: true },
  { key: 'factionLp', label: 'Faction LP redemption', selected: false },
  { key: 'breakevenLp', label: 'Breakeven LP', selected: true },
  { key: 'externalPrice', label: 'External', selected: true, title: 'Galactic Marketplace (GM) price' },
  { key: 'internalCost', label: 'Internal', selected: true, title: 'Production cost from Earnings → Breakeven Analysis, including applicable Scanning C/U, Mining C/U, and every Crafting C/U in the full production chain' },
  { key: 'equalNetPrice', label: 'Equal-Net Price', selected: true },
  { key: 'customPrice', label: 'Custom Price', selected: true },
  { key: 'grossAtlasPerSecond', label: 'Gross ATLAS/s', selected: false },
  { key: 'marginPercent', label: 'Profit Margin', selected: true, group: 'Capital-limited' },
  { key: 'netAtlasPerSecond', label: 'Net ATLAS/s', selected: true, group: 'Crew-limited' },
  { key: 'netAtlasPerCargoUnit', label: 'Net ATLAS/cargo unit', selected: true, group: 'Cargo-limited' },
]);
const UPGRADING_BREAKEVEN_COLUMN_STORAGE_KEY = 'my-star-atlas:optimization-upgrading-analysis-columns:v1';
let upgradingBreakevenSelectedColumns = new Set(upgradingBreakevenColumns.filter((column) => column.selected).map((column) => column.key));

try {
  const saved = JSON.parse(localStorage.getItem(UPGRADING_BREAKEVEN_COLUMN_STORAGE_KEY) || 'null');
  if (Array.isArray(saved)) upgradingBreakevenSelectedColumns = new Set(saved.filter((key) => upgradingBreakevenColumns.some((column) => column.key === key)));
} catch (_error) {
  // Invalid or unavailable storage leaves the documented defaults selected.
}

function persistUpgradingBreakevenColumnState() {
  try { localStorage.setItem(UPGRADING_BREAKEVEN_COLUMN_STORAGE_KEY, JSON.stringify([...upgradingBreakevenSelectedColumns])); }
  catch (_error) { /* Column controls remain functional without storage. */ }
}

const UPGRADING_BREAKEVEN_BASIS_STORAGE_KEY = 'my-star-atlas:optimization-upgrading-analysis-cost-basis:v2';
const UPGRADING_CUSTOM_PRICE_STORAGE_KEY = 'my-star-atlas:optimization-upgrading-custom-prices:v1';
const UPGRADING_BREAKEVEN_BASISES = Object.freeze({ external: 'external', internal: 'internal', equalNet: 'equal-net', custom: 'custom' });
let upgradingBreakevenCostBasis = UPGRADING_BREAKEVEN_BASISES.external;
let upgradingCustomPriceOverrides = {};

function restoreUpgradingBreakevenCostBasis() {
  try {
    const saved = String(localStorage.getItem(UPGRADING_BREAKEVEN_BASIS_STORAGE_KEY) || '');
    if (Object.values(UPGRADING_BREAKEVEN_BASISES).includes(saved)) upgradingBreakevenCostBasis = saved;
  } catch (_error) { /* Missing or restricted storage keeps the documented default. */ }
}

function upgradingComponentIdentity(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function calculateUpgradingProfitability(row, price) {
  const numericPrice = Number(price);
  const durationSeconds = Number(row?.durationSeconds);
  const impliedAtlasValue = Number(row?.impliedAtlasValue);
  const grossAtlasPerSecond = Number(row?.grossAtlasPerSecond);
  const cargoWeight = Number(row?.cargoWeight);
  if (!Number.isFinite(numericPrice) || numericPrice < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(impliedAtlasValue) || !Number.isFinite(grossAtlasPerSecond)) {
    return { marginPercent: null, netAtlasPerSecond: null, netAtlasPerCargoUnit: null };
  }
  return {
    marginPercent: numericPrice === 0 ? null : (impliedAtlasValue / numericPrice - 1) * 100,
    netAtlasPerSecond: grossAtlasPerSecond - numericPrice / durationSeconds,
    netAtlasPerCargoUnit: Number.isFinite(cargoWeight) && cargoWeight > 0 ? (impliedAtlasValue - numericPrice) / cargoWeight : null,
  };
}

function calculateUpgradingEqualNetRows(rows) {
  const candidates = rows.filter((row) => row?.netAtlasPerSecond != null && row?.gmPrice != null && Number.isFinite(Number(row.netAtlasPerSecond)) && Number.isFinite(Number(row.gmPrice)) && Number(row.gmPrice) >= 0)
    .sort((a, b) => Number(b.netAtlasPerSecond) - Number(a.netAtlasPerSecond) || upgradingComponentIdentity(a.name).localeCompare(upgradingComponentIdentity(b.name)));
  const selected = candidates[0];
  if (!selected) return { benchmark: null, rows: rows.map((row) => ({ ...row, equalNetPrice: null, equalNetStatus: 'unavailable' })) };
  const benchmark = { name: selected.name, price: Number(selected.gmPrice), netAtlasPerSecond: Number(selected.netAtlasPerSecond) };
  return {
    benchmark,
    rows: rows.map((row) => {
      const durationSeconds = Number(row?.durationSeconds); const grossAtlasPerSecond = Number(row?.grossAtlasPerSecond);
      if (row?.durationSeconds == null || row?.grossAtlasPerSecond == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(grossAtlasPerSecond)) return { ...row, equalNetPrice: null, equalNetStatus: 'unavailable' };
      const equalNetPrice = row === selected ? benchmark.price : durationSeconds * (grossAtlasPerSecond - benchmark.netAtlasPerSecond);
      if (equalNetPrice < 0) return { ...row, equalNetPrice, equalNetStatus: 'unreachable', marginPercent: null, netAtlasPerSecond: null, netAtlasPerCargoUnit: null };
      return { ...row, equalNetPrice, equalNetStatus: 'available', ...calculateUpgradingProfitability(row, equalNetPrice) };
    }),
  };
}

function applyUpgradingPriceBasis(rows, basis, options) {
  options = options || {};
  const equalNet = calculateUpgradingEqualNetRows(rows);
  const equalByIdentity = new Map(equalNet.rows.map((row) => [upgradingComponentIdentity(row.name), row]));
  const result = rows.map((row) => {
    const identity = upgradingComponentIdentity(row.name);
    const internalPrice = Number.isFinite(Number(options.internalPrices?.[row.name])) && Number(options.internalPrices[row.name]) >= 0 ? Number(options.internalPrices[row.name]) : null;
    const hasCustom = Object.prototype.hasOwnProperty.call(options.customPrices || {}, row.name) && Number.isFinite(Number(options.customPrices[row.name])) && Number(options.customPrices[row.name]) >= 0;
    const customPrice = hasCustom ? Number(options.customPrices[row.name]) : Number(row.gmPrice);
    const equalRow = equalByIdentity.get(identity);
    let appliedPrice = Number(row.gmPrice); let unavailable = false;
    if (basis === 'internal') { appliedPrice = internalPrice; unavailable = appliedPrice == null; }
    if (basis === 'equal-net') { appliedPrice = equalRow?.equalNetStatus === 'available' ? equalRow.equalNetPrice : null; unavailable = appliedPrice == null; }
    if (basis === 'custom') { appliedPrice = customPrice; unavailable = !Number.isFinite(appliedPrice); }
    const metrics = unavailable ? { marginPercent: null, netAtlasPerSecond: null, netAtlasPerCargoUnit: null } : calculateUpgradingProfitability(row, appliedPrice);
    return { ...row, externalPrice: Number(row.gmPrice), internalCost: internalPrice, equalNetPrice: equalRow?.equalNetPrice ?? null, equalNetStatus: equalRow?.equalNetStatus || 'unavailable', equalNetBenchmark: equalNet.benchmark, customPrice, customOverridden: hasCustom, appliedPrice, basis, ...metrics };
  });
  return { rows: result, benchmark: equalNet.benchmark };
}

function parseUpgradingCustomPrice(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!normalized || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return { ok: false, value: null };
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false, value: null };
}

function upgradingCustomPriceScopeKey(profile, faction, component) {
  return JSON.stringify([String(profile || '').trim(), String(faction || '').toUpperCase(), upgradingComponentIdentity(component)]);
}

function updateUpgradingCustomPriceOverrides(overrides, key, value) {
  const next = { ...(overrides || {}) };
  if (value == null) delete next[key]; else next[key] = value;
  return next;
}

function restoreUpgradingCustomPriceOverrides() {
  try { const saved = JSON.parse(localStorage.getItem(UPGRADING_CUSTOM_PRICE_STORAGE_KEY) || '{}'); upgradingCustomPriceOverrides = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}; }
  catch (_error) { upgradingCustomPriceOverrides = {}; }
}

function persistUpgradingCustomPriceOverrides() {
  try { localStorage.setItem(UPGRADING_CUSTOM_PRICE_STORAGE_KEY, JSON.stringify(upgradingCustomPriceOverrides)); }
  catch (_error) { /* Custom prices remain usable for this session. */ }
}

function persistUpgradingBreakevenCostBasis() {
  try { localStorage.setItem(UPGRADING_BREAKEVEN_BASIS_STORAGE_KEY, upgradingBreakevenCostBasis); }
  catch (_error) { /* Toggle remains functional without storage. */ }
}

function phantomStarbaseForFaction(faction) {
  const normalized = String(faction || '').toUpperCase();
  if (normalized === 'MUD') return 'MUD-PHANTOM';
  if (normalized === 'ONI') return 'ONI-PHANTOM';
  if (normalized === 'USTUR' || normalized === 'UST') return 'UST-PHANTOM';
  return `${normalized || 'MUD'}-PHANTOM`;
}

function sumBreakevenCostPerUnit(entry) {
  if (!entry) return null;
  const fields = [entry.scanningCostPerUnit, entry.miningCostPerUnit, entry.craftingCostPerUnit, entry.cargoCostPerUnit];
  if (fields.every((value) => value == null)) return null;
  const total = fields.reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
  return Number.isFinite(total) ? total : null;
}

function getUpgradingBreakevenInternalCosts(faction) {
  const result = latestBreakevenResult;
  const rows = Array.isArray(result?.breakevenRows) ? result.breakevenRows : [];
  if (!rows.length) return { starbase: phantomStarbaseForFaction(faction), byAsset: {}, available: false, reason: 'no-breakeven-data' };
  const phantomStarbase = phantomStarbaseForFaction(faction);
  const matched = rows.filter((row) => String(row.starbase || '').toUpperCase() === phantomStarbase.toUpperCase());
  if (!matched.length) return { starbase: phantomStarbase, byAsset: {}, available: false, reason: 'no-phantom-starbase' };
  const byAsset = {};
  let anyComponentCost = false;
  for (const row of matched) {
    const assetKey = String(row.asset || '').trim();
    if (!assetKey) continue;
    const internalCost = sumBreakevenCostPerUnit(row);
    if (internalCost != null) { byAsset[assetKey] = internalCost; anyComponentCost = true; }
  }
  return { starbase: phantomStarbase, byAsset, available: anyComponentCost, reason: anyComponentCost ? null : 'no-internal-cost' };
}

function restoreOptimizationColumnState() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIMIZATION_COLUMN_STORAGE_KEY) || '{}');
    if (Array.isArray(saved.selected)) optimizationSelectedColumns = new Set(saved.selected.map(String));
    if (Array.isArray(saved.known)) optimizationKnownColumns = new Set(saved.known.map(String));
  } catch (_error) {
    // Invalid or unavailable local storage leaves new columns enabled by default.
  }
}

function persistOptimizationColumnState() {
  try {
    localStorage.setItem(OPTIMIZATION_COLUMN_STORAGE_KEY, JSON.stringify({
      selected: Array.from(optimizationSelectedColumns),
      known: Array.from(optimizationKnownColumns),
    }));
  } catch (_error) {
    // Column controls remain functional when local storage is unavailable.
  }
}

restoreOptimizationColumnState();
restoreUpgradingBreakevenCostBasis();
restoreUpgradingCustomPriceOverrides();

let optimizationSort = { key: 'time', direction: 'desc' };
let currentOptimizationView = 'data';
let currentOptimizationSubtab = 'scanning';
let latestUpgradingOptimizationResult = null;
let latestUpgradingComparisonResults = [];
let optimizationUpgradingRows = [];
let optimizationUpgradingSort = { key: 'time', direction: 'desc' };
const optimizationUpgradingComponents = [
  ['framework', 'Framework'], ['electronics', 'Electronics'], ['power_source', 'Power Source'],
  ['electromagnet', 'Electromagnet'], ['field_stabilizer', 'Field Stabilizer'],
  ['particle_accelerator', 'Particle Accelerator'], ['radiation_absorber', 'Radiation Absorber'],
  ['survey_data_unit', 'Survey Data Unit'],
];
const optimizationUpgradingColumns = [
  { key: 'time', label: 'Date and Time' }, { key: 'faction', label: 'Faction' }, { key: 'instance', label: 'Instance' },
  { key: 'player_lp_installed_today', label: 'Player LP Installed Today' },
  { key: 'phantom_crew', label: 'Phantom Crew' },
  ...optimizationUpgradingComponents.flatMap(([key, label]) => [
    { key: `${key}_installed`, label: `${label} Installed` },
    { key: `${key}_installed_lp`, label: `${label} Installed LP` },
  ]),
  { key: 'neutral_lp_target', label: 'Neutral LP Target' }, { key: 'requested_lp_target', label: 'Requested LP Target' },
  { key: 'optimizer_lp_target', label: 'Optimizer LP Target' }, { key: 'aggressiveness_rel', label: 'Aggr. (rel.)' },
  { key: 'aggressiveness_abs', label: 'Aggr. (abs.)' }, { key: 'aggressiveness', label: 'Aggr.' },
  { key: 'faction_lp_installed_today', label: 'Faction LP Installed Today' },
  { key: 'expected_additional_lp_eod', label: 'Expected Additional LP by EOD' },
  { key: 'expected_total_lp_eod', label: 'Expected Total LP by EOD' },
  { key: 'uninstalled_automated_lp', label: 'Uninstalled automated LP' },
  { key: 'uninstalled_not_automated_lp', label: 'Uninstalled not automated LP' },
  { key: 'uninstalled_not_automated_older_24h_lp', label: 'Uninstalled not automated LP (>24h)' },
  { key: 'oldest_uninstalled_not_automated_age_seconds', label: 'Oldest Uninstalled Age' },
];
let optimizationUpgradingSelectedColumns = new Set(optimizationUpgradingColumns.map((column) => column.key));
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
let selectedProductionAsset = '';
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
let selectedConsTotalAsset = '';

const factionLabels = Object.freeze({
  MUD: 'MUD',
  ONI: 'ONI',
  USTUR: 'USTUR',
});

const scanningEarningsOptionalColumns = Object.freeze([
  Object.freeze({ id: 'color', label: 'Color' }),
  Object.freeze({ id: 'ownership', label: 'Ownership' }),
  Object.freeze({ id: 'ships', label: 'Ships' }),
  Object.freeze({ id: 'requiredCrew', label: 'Required Crew' }),
  Object.freeze({ id: 'sduMax', label: 'SDU Max' }),
  Object.freeze({ id: 'atlasPerScan', label: 'Atlas / Scan' }),
  Object.freeze({ id: 'scanAttempts', label: 'Scan Attempts' }),
  Object.freeze({ id: 'successfulScans', label: 'Successful Scans' }),
  Object.freeze({ id: 'scanSuccessRate', label: 'Scan Success Rate' }),
  Object.freeze({ id: 'averageChance', label: 'Avg Chance' }),
  Object.freeze({ id: 'sduFound', label: 'SDU Found' }),
  Object.freeze({ id: 'revenue', label: 'Revenue' }),
  Object.freeze({ id: 'foodCosts', label: 'Food Cost' }),
  Object.freeze({ id: 'fuelCosts', label: 'Fuel Cost' }),
  Object.freeze({ id: 'rental', label: 'Total Rental Cost' }),
  Object.freeze({ id: 'txsCosts', label: 'Txs Cost' }),
  Object.freeze({ id: 'totalCosts', label: 'Total Costs' }),
  Object.freeze({ id: 'netProfit', label: 'Net Profit' }),
  Object.freeze({ id: 'npPerCrew', label: 'NP per crew' }),
  Object.freeze({ id: 'profitMargin', label: 'Profit Margin' }),
  Object.freeze({ id: 'costsPerUnit', label: 'Cost per Unit' }),
  Object.freeze({ id: 'account', label: 'Account' }),
]);

const miningEarningsOptionalColumns = Object.freeze([
  Object.freeze({ id: 'color', label: 'Color' }),
  Object.freeze({ id: 'ownership', label: 'Ownership' }),
  Object.freeze({ id: 'ships', label: 'Ships' }),
  Object.freeze({ id: 'requiredCrew', label: 'Required Crew' }),
  Object.freeze({ id: 'txsDaily', label: 'Txs Daily' }),
  Object.freeze({ id: 'starbase', label: 'Starbase' }),
  Object.freeze({ id: 'rawMaterial', label: 'Raw Material' }),
  Object.freeze({ id: 'mined', label: 'Mined' }),
  Object.freeze({ id: 'revenue', label: 'Revenue' }),
  Object.freeze({ id: 'ammoCosts', label: 'Ammo Cost' }),
  Object.freeze({ id: 'foodCosts', label: 'Food Cost' }),
  Object.freeze({ id: 'fuelCosts', label: 'Fuel Cost' }),
  Object.freeze({ id: 'rental', label: 'Total Rental Cost' }),
  Object.freeze({ id: 'txsCosts', label: 'Txs Cost' }),
  Object.freeze({ id: 'totalCosts', label: 'Total Costs' }),
  Object.freeze({ id: 'netProfit', label: 'Net Profit' }),
  Object.freeze({ id: 'npPerCrew', label: 'NP per crew' }),
  Object.freeze({ id: 'profitMargin', label: 'Profit Margin' }),
  Object.freeze({ id: 'costsPerUnit', label: 'Cost per Unit' }),
  Object.freeze({ id: 'account', label: 'Account' }),
]);

const cargoEarningsOptionalColumns = Object.freeze([
  Object.freeze({ id: 'color', label: 'Color' }),
  Object.freeze({ id: 'ownership', label: 'Ownership' }),
  Object.freeze({ id: 'ships', label: 'Ships' }),
  Object.freeze({ id: 'requiredCrew', label: 'Required Crew' }),
  Object.freeze({ id: 'txsDaily', label: 'Txs Daily' }),
  Object.freeze({ id: 'cargoCycles', label: 'Cycles Daily' }),
  Object.freeze({ id: 'assignment', label: 'Assignment' }),
  Object.freeze({ id: 'travelModeTime', label: 'Travel Mode (time)' }),
  Object.freeze({ id: 'starbases', label: 'Starbase' }),
  Object.freeze({ id: 'fuelCosts', label: 'Fuel Cost' }),
  Object.freeze({ id: 'rental', label: 'Total Rental Cost' }),
  Object.freeze({ id: 'txsCosts', label: 'Txs Cost' }),
  Object.freeze({ id: 'totalCosts', label: 'Total Costs' }),
  Object.freeze({ id: 'txsCostsPct', label: 'Txs Cost Pct' }),
  Object.freeze({ id: 'cargoVolume', label: 'Cargo Volume' }),
  Object.freeze({ id: 'cargoCapacity', label: 'Cargo Capacity' }),
  Object.freeze({ id: 'cargoEfficiency', label: 'Cargo Efficiency' }),
  Object.freeze({ id: 'account', label: 'Account' }),
]);

const cargoAllocationEarningsOptionalColumns = Object.freeze([
  Object.freeze({ id: 'color', label: 'Color' }),
  Object.freeze({ id: 'ownership', label: 'Ownership' }),
  Object.freeze({ id: 'ships', label: 'Ships' }),
  Object.freeze({ id: 'requiredCrew', label: 'Required Crew' }),
  Object.freeze({ id: 'assignment', label: 'Assignment' }),
  Object.freeze({ id: 'amount', label: 'Cargo Amount' }),
  Object.freeze({ id: 'cargoVolume', label: 'Cargo Volume' }),
  Object.freeze({ id: 'allocatedFuel', label: 'Allocated Fuel' }),
  Object.freeze({ id: 'fuelCosts', label: 'Fuel Cost' }),
  Object.freeze({ id: 'txsCosts', label: 'TXS Cost' }),
  Object.freeze({ id: 'totalCosts', label: 'Total Cargo Costs' }),
  Object.freeze({ id: 'costsPerUnit', label: 'Cargo Cost/Unit' }),
]);

const craftingEarningsOptionalColumns = Object.freeze([
  Object.freeze({ id: 'txsDaily', label: 'Txs Daily' }),
  Object.freeze({ id: 'crafted', label: 'Crafted' }),
  Object.freeze({ id: 'crew', label: 'Avg Crew' }),
  Object.freeze({ id: 'revenue', label: 'Revenue' }),
  Object.freeze({ id: 'ingCosts', label: 'Ingredient Cost Basis' }),
  Object.freeze({ id: 'feeCosts', label: 'Crafting Fee Cost' }),
  Object.freeze({ id: 'txsCosts', label: 'Txs Cost' }),
  Object.freeze({ id: 'totalCosts', label: 'Total Costs' }),
  Object.freeze({ id: 'netProfit', label: 'Net Profit' }),
  Object.freeze({ id: 'npPerCrew', label: 'NP per crew' }),
  Object.freeze({ id: 'profitMargin', label: 'Profit Margin' }),
  Object.freeze({ id: 'costsPerUnit', label: 'Cost per Unit' }),
]);

const upgradingEarningsOptionalColumns = Object.freeze([
  Object.freeze({ id: 'installed', label: 'Installed' }),
  Object.freeze({ id: 'lpRedemption', label: 'LP Redemption' }),
  Object.freeze({ id: 'crew', label: 'Avg Crew' }),
  Object.freeze({ id: 'revenue', label: 'Revenue' }),
  Object.freeze({ id: 'upgCosts', label: 'Component Cost Basis' }),
  Object.freeze({ id: 'txsCosts', label: 'Txs Cost' }),
  Object.freeze({ id: 'totalCosts', label: 'Total Costs' }),
  Object.freeze({ id: 'netProfit', label: 'Net Profit' }),
  Object.freeze({ id: 'npPerCrew', label: 'Net Profit per Crew' }),
  Object.freeze({ id: 'profitMargin', label: 'Profit Margin' }),
]);

const breakevenEarningsBaseColumns = Object.freeze([
  Object.freeze({ id: 'starbase', label: 'Starbase' }),
  Object.freeze({ id: 'asset', label: 'Asset' }),
  Object.freeze({ id: 'inventory', label: 'Inventory' }),
  Object.freeze({ id: 'scanningCost', label: 'Scanning C/U' }),
  Object.freeze({ id: 'miningCost', label: 'Mining C/U' }),
  Object.freeze({ id: 'craftingCost', label: 'Crafting C/U' }),
  Object.freeze({ id: 'lmCost', label: 'LM C/U' }),
  Object.freeze({ id: 'gmCost', label: 'GM C/U' }),
  Object.freeze({ id: 'baseCost', label: 'Base Cost / Unit' }),
  Object.freeze({ id: 'cargoCost', label: 'Cargo Cost / Unit' }),
  Object.freeze({ id: 'landedCost', label: 'Total Cost / Unit' }),
  Object.freeze({ id: 'inventoryValue', label: 'Inventory Cost Basis' }),
  Object.freeze({ id: 'costCoverage', label: 'Cost Coverage' }),
  Object.freeze({ id: 'gmPrice', label: 'GM Price / Unit' }),
  Object.freeze({ id: 'inventoryExternalValue', label: 'Inventory External Value' }),
  Object.freeze({ id: 'ledgerStatus', label: 'Ledger Status' }),
]);

const breakevenEarningsOptionalColumns = Object.freeze([]);

const marketplaceEarningsOptionalColumns = Object.freeze([
  Object.freeze({ id: 'timestamp', label: 'Timestamp (UTC)' }),
  Object.freeze({ id: 'marketplace', label: 'Marketplace' }),
  Object.freeze({ id: 'starbase', label: 'Starbase' }),
  Object.freeze({ id: 'asset', label: 'Asset' }),
  Object.freeze({ id: 'amount', label: 'Amount' }),
  Object.freeze({ id: 'grossAtlas', label: 'Gross ATLAS' }),
  Object.freeze({ id: 'price', label: 'Price' }),
  Object.freeze({ id: 'marketplaceFee', label: 'Marketplace Fee' }),
  Object.freeze({ id: 'txsFee', label: 'Txs Fee' }),
  Object.freeze({ id: 'netAtlas', label: 'Net ATLAS' }),
  Object.freeze({ id: 'unitMetric', label: 'Cost / Unit' }),
  Object.freeze({ id: 'orderId', label: 'Order ID' }),
  Object.freeze({ id: 'signature', label: 'Signature' }),
]);

const earningsColumnsBySubtab = Object.freeze({
  scanning: scanningEarningsOptionalColumns,
  mining: miningEarningsOptionalColumns,
  cargo: cargoEarningsOptionalColumns,
  cargoAllocation: cargoAllocationEarningsOptionalColumns,
  crafting: craftingEarningsOptionalColumns,
  upgrading: upgradingEarningsOptionalColumns,
  breakeven: breakevenEarningsOptionalColumns,
  marketplace: marketplaceEarningsOptionalColumns,
});

const earningsColumnState = {
  scanning: new Set(['sduMax', 'sduFound', 'revenue', 'foodCosts', 'fuelCosts', 'rental', 'txsCosts', 'totalCosts', 'netProfit', 'profitMargin', 'costsPerUnit']),
  mining: new Set(['txsDaily', 'starbase', 'rawMaterial', 'mined', 'revenue', 'ammoCosts', 'foodCosts', 'fuelCosts', 'rental', 'txsCosts', 'totalCosts', 'netProfit', 'profitMargin', 'costsPerUnit']),
  cargo: new Set(['txsDaily', 'cargoCycles', 'assignment', 'travelModeTime', 'starbases', 'fuelCosts', 'rental', 'txsCosts', 'totalCosts', 'txsCostsPct', 'cargoVolume', 'cargoCapacity', 'cargoEfficiency']),
  cargoAllocation: new Set(['assignment', 'amount', 'cargoVolume', 'allocatedFuel', 'fuelCosts', 'txsCosts', 'totalCosts', 'costsPerUnit']),
  crafting: new Set(['txsDaily', 'crafted', 'crew', 'revenue', 'ingCosts', 'feeCosts', 'txsCosts', 'totalCosts', 'netProfit', 'npPerCrew', 'profitMargin', 'costsPerUnit']),
  upgrading: new Set(['installed', 'crew', 'revenue', 'upgCosts', 'txsCosts', 'totalCosts', 'netProfit', 'npPerCrew', 'profitMargin']),
  breakeven: new Set(),
  marketplace: new Set(marketplaceEarningsOptionalColumns.map((column) => column.id)),
};

const EARNINGS_COLUMN_STORAGE_KEY = 'my-star-atlas:earnings-columns:v1';

function restoreEarningsColumnState() {
  try {
    const saved = JSON.parse(localStorage.getItem(EARNINGS_COLUMN_STORAGE_KEY) || '{}');
    for (const subtab of Object.keys(earningsColumnState)) {
      if (!Array.isArray(saved[subtab])) continue;
      const validIds = new Set(getEarningsColumns(subtab).map((column) => column.id));
      earningsColumnState[subtab] = new Set(saved[subtab].filter((id) => validIds.has(id)));
    }
  } catch (_error) {
    // Invalid or unavailable local storage should leave the built-in defaults intact.
  }
}

function persistEarningsColumnState() {
  try {
    const serialized = Object.fromEntries(
      Object.entries(earningsColumnState).map(([subtab, selected]) => [subtab, Array.from(selected)]),
    );
    localStorage.setItem(EARNINGS_COLUMN_STORAGE_KEY, JSON.stringify(serialized));
  } catch (_error) {
    // Column controls remain functional when local storage is unavailable.
  }
}

restoreEarningsColumnState();

const earningsMetricGuideCommon = Object.freeze({
  color: ['Fleet chart color.', 'Assigned display color for this fleet.', 'Use it to match the row to the same fleet in charts.'],
  ownership: ['Whether the fleet is owned or managed/rented.', 'Fleet relationship from the connected profile.', 'Managed fleets can include rental cost and contract constraints.'],
  ships: ['Aggregated ship models and quantities in the fleet.', 'Sum of each matching ship model in the fleet.', 'Use this to understand the composition behind capacity, crew, and operating costs.'],
  requiredCrew: ['Crew required by the fleet’s ships.', 'Σ(ship quantity × required crew per ship).', 'Useful for comparing labor efficiency; unmapped ships are omitted.'],
  txsDaily: ['Transactions attributed to the fleet or activity that UTC day.', 'Count of matching daily transactions.', 'Higher counts usually increase transaction cost and may indicate more operational cycles.'],
  revenue: ['Estimated gross value produced during the row’s UTC day.', 'Output quantity × current output price in ATLAS.', 'This is a current-price estimate, not necessarily realized sale proceeds.'],
  rental: ['Daily rental rate for a managed fleet.', 'Current rental contract rate in ATLAS per day.', 'Treat it as a fixed daily cost when judging whether a rented fleet is profitable.'],
  txsCosts: ['SOL transaction fees converted to ATLAS.', 'Transaction cost in SOL × current ATLAS-per-SOL rate.', 'This varies with network fees and the current SOL/ATLAS conversion rate.'],
  totalCosts: ['All cost components available for this row.', 'Sum of the cost columns shown for this activity.', 'Compare with Revenue; missing price inputs can make the estimate incomplete.'],
  netProfit: ['Estimated value remaining after costs.', 'Revenue − Total Costs.', 'Higher is better for absolute earnings; compare it with margin and per-crew profit for efficiency.'],
  npPerCrew: ['Estimated net-profit efficiency per required or average crew.', 'Net Profit ÷ Crew.', 'Higher is generally better for crew efficiency, but it does not imply higher total profit.'],
  profitMargin: ['Share of revenue left after costs.', '(Net Profit ÷ Revenue) × 100.', 'Positive is profitable; compare it with total Net Profit because a high margin can still represent little ATLAS.'],
  account: ['On-chain fleet account address.', 'Fleet public key.', 'Use it to verify the fleet or investigate its on-chain activity.'],
  crew: ['Average crew assigned during the day.', 'Daily average of recorded crew usage.', 'Use it with Net Profit per Crew to compare activities of different sizes.'],
});

const earningsMetricGuideBySubtab = Object.freeze({
  scanning: Object.freeze({
    sduMax: ['Expected SDU capacity per successful scan.', 'Σ(ship quantity × ship SDU-per-scan capacity).', 'A capacity estimate; actual SDU Found also depends on scan success and chance.'],
    atlasPerScan: ['Estimated ATLAS value of one full-capacity scan.', 'SDU Max × current SDU price.', 'Useful for comparing fleet potential before operating costs and failed scans.'],
    scanAttempts: ['All recorded scan attempts during the UTC day.', 'Successful scans + unsuccessful scans.', 'Use with Successful Scans and Avg Chance to judge scanning frequency and outcomes.'],
    successfulScans: ['Recorded scan attempts that found an SDU.', 'Count of successful scan events.', 'More successes usually increase output, but SDU quantity per success can vary.'],
    scanSuccessRate: ['Observed success rate for the day.', '(Successful Scans ÷ Scan Attempts) × 100.', 'Compare over multiple days; a single day can differ substantially from the expected chance.'],
    averageChance: ['Average recorded success chance across scan attempts.', 'Mean success-chance percentage of recorded attempts.', 'This is the expected probability; compare it with observed Scan Success Rate over a longer period.'],
    sduFound: ['Total Survey Data Units found during the UTC day.', 'Σ SDU from successful scans.', 'The primary scanning output used to estimate Revenue.'],
    foodCosts: ['ATLAS value of food consumed while scanning.', 'Food burned × current food price.', 'Lower cost improves profit, but price changes also affect historical estimates.'],
    fuelCosts: ['ATLAS value of fuel consumed while scanning.', 'Fuel burned × current fuel price.', 'Use it to compare operating efficiency between fleets.'],
    costsPerUnit: ['Estimated cost for each SDU found.', 'Total Costs ÷ SDU Found.', 'Lower is better; compare with the current SDU price to judge unit profitability.'],
  }),
  mining: Object.freeze({
    starbase: ['Starbase associated with the mining activity.', 'Recorded mining starbase.', 'Use it to compare routes, deposits, and fleet placement.'],
    rawMaterial: ['Resource produced by this row.', 'Recorded mined resource.', 'Prices differ by material, so equal quantities can generate different Revenue.'],
    mined: ['Total units mined during the UTC day.', 'Σ recorded mined quantity.', 'Use with Cost per Unit and resource price to compare output efficiency.'],
    ammoCosts: ['ATLAS value of ammunition consumed while mining.', 'Ammunition burned × current ammunition price.', 'Often a major variable cost; lower cost per mined unit improves efficiency.'],
    foodCosts: ['ATLAS value of food consumed while mining.', 'Food burned × current food price.', 'Part of the operating cost used in Total Costs.'],
    fuelCosts: ['ATLAS value of fuel consumed while mining.', 'Fuel burned × current fuel price.', 'Part of the operating cost used in Total Costs.'],
    costsPerUnit: ['Estimated cost per unit of this material.', 'Total costs for fleet/date/material ÷ total units mined.', 'Lower is better; compare with the material’s current ATLAS price.'],
  }),
  cargo: Object.freeze({
    cargoCycles: ['Completed cargo cycles recorded during the UTC day.', 'Count of explicit SLYA round-trip completion events for the fleet and assignment.', 'A cycle closes only when the final configured route leg wraps to the beginning; intermediate visits to the first starbase do not count.'],
    assignment: ['Recorded transport or supply-chain assignment.', 'Most specific assignment recorded for the row.', 'Use it to separate different logistics duties for the same fleet.'],
    travelModeTime: ['Share of recorded movement time spent in each travel mode.', 'Mode moveTime ÷ total movement moveTime, rounded to whole percentages totaling 100%.', 'Time-weighting represents long legs more accurately than counting movement transactions.'],
    starbases: ['Starbases touched by the fleet’s cargo activity.', 'Distinct recorded starbases joined into one row.', 'More locations can indicate a broader or more complex route.'],
    fuelCosts: ['ATLAS value of fuel consumed by cargo movement.', 'Fuel burned × current fuel price.', 'The main operating-resource cost represented in Cargo.'],
    rental: ['Daily rental rate for a managed cargo fleet.', 'Current rental contract rate in ATLAS per day.', 'Included in Total Costs for each UTC day represented by the fleet row.'],
    totalCosts: ['Estimated cargo operating cost represented by available data.', 'Fuel Cost + Total Rental Cost + Txs Cost.', 'Cargo revenue is not tracked here, so this is a cost-efficiency view rather than profit.'],
    txsCostsPct: ['Transaction fees as a share of represented cargo costs.', '(Txs Cost ÷ Total Costs) × 100.', 'A high value means fees dominate fuel; reduce unnecessary transactions where practical.'],
    cargoVolume: ['Total cargo-space volume delivered by the fleet during the UTC day.', 'Σ delivered cargo volume from cargo-allocation telemetry.', 'Compare it with Cargo Capacity to see how much available hold space was used.'],
    cargoCapacity: ['Total cargo-space opportunity across completed cargo routes that day.', 'Fleet cargo capacity × sum of completed-cycle leg counts.', 'Transport contributes 2 legs per completed cycle; Supply Chain contributes targets + 1 legs. Warp jumps within a leg do not add capacity.'],
    cargoEfficiency: ['Share of available cargo capacity used across all cargo legs.', '(Cargo Volume ÷ Cargo Capacity) × 100.', 'Higher means the fleet carried more cargo relative to its available hold space across the full route.'],
  }),
  cargoAllocation: Object.freeze({
    assignment: ['Logistics assignment that delivered this asset.', 'Recorded assignment: Transport or Supply Chain.', 'Use it to separate direct transport from supply-chain activity for the same asset.'],
    amount: ['Units of the asset delivered during the UTC day.', 'Σ delivered Cargo Amount.', 'This is the denominator used for Cargo Cost/Unit.'],
    cargoVolume: ['Cargo-space volume represented by the delivered asset.', 'Σ delivered Cargo Volume.', 'Compare it with Cargo Amount to understand how much hold capacity the asset consumed.'],
    allocatedFuel: ['Fuel attributed to delivery of this asset, including its share of empty-leg overhead.', 'Loaded-leg fuel + allocated empty-leg fuel overhead.', 'This assigns the complete cycle fuel cost across the assets delivered by that cycle.'],
    fuelCosts: ['ATLAS value of the fuel allocated to this asset.', 'Allocated Fuel × applicable fuel price.', 'Unavailable source or price evidence is shown as --, never as a manufactured zero.'],
    txsCosts: ['ATLAS value of transaction fees allocated to this asset, including empty-leg overhead.', 'Allocated transaction cost in SOL × applicable ATLAS-per-SOL rate.', 'Unavailable source or valuation evidence is shown as --.'],
    totalCosts: ['Total represented cargo logistics cost allocated to this asset.', 'Fuel Cost + TXS Cost.', 'Cargo cost currently includes Fuel and TXS only; Rental and inventory basis are not included.'],
    costsPerUnit: ['Allocated cargo logistics cost for one delivered asset unit.', 'Total Cargo Costs ÷ Cargo Amount.', 'Available only when Fuel and TXS costs are available and Cargo Amount is positive.'],
  }),
  crafting: Object.freeze({
    crafted: ['Total output units crafted during the UTC day.', 'Σ crafted output quantity.', 'Use with unit prices and costs to understand production scale.'],
    ingCosts: ['Weighted inventory cost basis of ingredients consumed.', 'Σ consumed ingredient basis from the chronological ledger.', 'Includes upstream production and cargo basis; direct crafting fees remain separate.'],
    feeCosts: ['ATLAS crafting fees recorded for the activity.', 'Σ recorded crafting fee amount.', 'A direct crafting expense included in Total Costs.'],
    totalCosts: ['Cost basis of the crafted output.', 'Ingredient Cost Basis + Crafting Fee Cost + Txs Cost.', 'A dash means consumed ingredient basis is incomplete or explicitly uncosted.'],
    costsPerUnit: ['Cost basis for each crafted output unit.', 'Total Costs ÷ Crafted.', 'This is carried forward in the weighted inventory ledger.'],
  }),
  upgrading: Object.freeze({
    installed: ['Components installed during the completed UTC day.', 'Σ installed component quantity.', 'This is the output quantity used for both estimated reward value and component cost.'],
    lpRedemption: ['Faction-wide LP redeemed on that date.', 'Daily redeemed LP from the faction summary.', 'Higher faction redemption lowers ATLAS value per LP because the daily ATLAS pool is shared.'],
    revenue: ['Estimated ATLAS value of the LP generated by installed components.', 'Installed × LP per component × (Faction ATLAS pool ÷ Faction LP redeemed).', 'This is a pool-share estimate; it changes with faction-wide LP redemption.'],
    upgCosts: ['Weighted inventory cost basis of components installed.', 'Σ consumed component basis from the chronological ledger.', 'Upgrade transaction costs remain separate.'],
    totalCosts: ['Upgrading cost represented by available data.', 'Component Cost Basis + Txs Cost.', 'Compare with Revenue to judge whether the upgrade activity covered component and transaction costs.'],
  }),
  breakeven: Object.freeze({
    starbase: ['Starbase where the asset inventory is currently recorded.', 'Latest non-zero inventory point per starbase and asset.', 'Costs only join when the mining or delivery destination matches this starbase.'],
    asset: ['Resource held at the starbase.', 'Recorded inventory resource name.', 'Each starbase and asset combination has its own cost basis.'],
    inventory: ['Current recorded units at this starbase.', 'Latest non-zero curAmount during the inventory lookback.', 'Use Hide inventory ≤ 2 to suppress dust balances without deleting data.'],
    baseCost: ['Estimated weighted production and acquisition cost per unit.', 'Known Scanning + Mining + Crafting + LM + GM basis ÷ known-cost quantity.', 'The known weighted average is extrapolated across inventory without direct basis; Cost Coverage discloses that estimated share.'],
    cargoCost: ['Estimated weighted accumulated delivery cost per unit.', 'Known cargo basis ÷ known-cost quantity.', 'Includes represented transfers and extrapolates their weighted average to inventory without direct basis.'],
    landedCost: ['Estimated combined cost per unit at this starbase.', 'Base Cost / Unit + Cargo Cost / Unit.', 'This is the estimated breakeven price before unrepresented costs or sale fees; see Cost Coverage for confidence.'],
    inventoryValue: ['Estimated cost basis of current inventory.', 'Inventory × Total Cost / Unit.', 'The known weighted average is applied to the whole current inventory.'],
    costCoverage: ['Share of current inventory whose cost basis is estimated rather than directly represented.', '100% − known-cost coverage, rounded to a whole percent.', '100% tracked requires exact quantity reconciliation and no uncosted inventory; low coverage is still shown but should be treated as a rough estimate.'],
    gmPrice: ['Current Galactic Marketplace reference price.', 'Aephia /gm/resource pricingATL.priceATL.', 'Compare with Total Cost; it is a current market reference, not guaranteed sale proceeds.'],
    inventoryExternalValue: ['Current external value of recorded inventory.', 'Inventory × GM Price / Unit.', 'This is a mark-to-market reference before marketplace fees, not guaranteed sale proceeds.'],
    ledgerStatus: ['Quantity reconciliation between current inventory and the event ledger.', 'Current Inventory − Ledger Quantity.', 'Reconciled can still include explicitly uncosted opening stock; surplus or shortfall identifies telemetry drift.'],
  }),
});

const earningsFilters = {
  scanning: { date: '', fleet: '' },
  mining: { date: '', fleet: '', rawMaterial: '' },
  cargo: { date: '', fleet: '' },
  cargoAllocation: { date: '', fleet: '', asset: '' },
  crafting: { date: '', starbase: '', asset: '' },
  upgrading: { date: '', starbase: '', asset: '' },
  breakeven: { starbase: '', asset: '', hideLowInventory: false },
};

const earningsSort = {
  scanning: { column: null, direction: null },
  mining: { column: null, direction: null },
  cargo: { column: null, direction: null },
  crafting: { column: null, direction: null },
  upgrading: { column: null, direction: null },
  breakeven: { column: null, direction: null },
};

const EARNINGS_TOTAL_FLEETS_FILTER = '__total__';
const EARNINGS_TOTAL_ASSETS_FILTER = '__total__';

// Chart mode state: 'total' (NP in ATLAS) or 'perCrew' (NP / crew). One
// shared value per earnings subtab, so all Net Profit chart panels in
// the same subtab switch together. Mining/Crafting each have multiple
// NP chart panels and they all read from this state on render.
const earningsChartMode = {
  scanning: 'total',
  mining: 'total',
  crafting: 'total',
  upgrading: 'total',
};

const earningsCostBasisMode = {
  crafting: 'internal',
  upgrading: 'internal',
};

function applyEarningsCostBasis(row, subtab) {
  if (earningsCostBasisMode[subtab] !== 'external') return row;
  const basisValue = subtab === 'crafting' ? row.ingredientExternalValueAtlas : row.componentExternalValueAtlas;
  return { ...row, ingCostsAtlas: basisValue, upgradingCostsAtlas: basisValue, totalCostsAtlas: row.externalTotalCostsAtlas, netProfitAtlas: row.externalNetProfitAtlas, netProfitPerCrew: row.externalNetProfitPerCrew, profitMarginPercent: row.externalProfitMarginPercent, costsPerUnitAtlas: row.externalCostsPerUnitAtlas };
}

const earningsSortKeyByColumnId = Object.freeze({
  date: 'isoDate',
  fleet: 'fleetName',
  color: 'fleetName',
  ownership: 'ownership',
  ships: 'shipTypes',
  requiredCrew: 'totalRequiredCrew',
  sduMax: 'expectedSduPerScan',
  atlasPerScan: 'expectedSduValueAtl',
  scanAttempts: 'scanAttempts',
  successfulScans: 'successfulScans',
  scanSuccessRate: 'scanSuccessRate',
  averageChance: 'averageChancePercent',
  sduFound: 'sduFound',
  revenue: 'revenueAtlasPerDay',
  foodCosts: 'foodCostsAtlas',
  fuelCosts: 'fuelCostsAtlas',
  ammoCosts: 'ammoCostsAtlas',
  rental: 'rentalRateAtlasPerDay',
  txsCosts: 'txsCostsAtlas',
  totalCosts: 'totalCostsAtlas',
  netProfit: 'netProfitAtlas',
  npPerCrew: 'netProfitPerCrew',
  profitMargin: 'profitMarginPercent',
  costsPerUnit: 'costsPerUnitAtlas',
  txsDaily: 'txsDaily',
  starbase: 'starbase',
  rawMaterial: 'rawMaterial',
  mined: 'mined',
  assignment: 'assignment',
  asset: 'output',
  origin: 'origin',
  destination: 'destination',
  crafted: 'crafted',
  crew: 'crew',
  ingCosts: 'ingCostsAtlas',
  feeCosts: 'feeCostsAtlas',
  installed: 'installed',
  lpRedemption: 'factionRedeemedLp',
  upgCosts: 'upgradingCostsAtlas',
  travelModeTime: 'travelModeWarpPercent',
  starbases: 'starbaseLabel',
  txsCostsPct: 'txsCostsPercent',
  cargoVolume: 'cargoVolume',
  cargoCapacity: 'cargoCapacity',
  cargoEfficiency: 'cargoEfficiencyPercent',
  account: 'fleetAccount',
  scanningCost: 'scanningCostPerUnit',
  miningCost: 'miningCostPerUnit',
  craftingCost: 'craftingCostPerUnit',
  lmCost: 'lmCostPerUnit',
  gmCost: 'gmCostPerUnit',
  baseCost: 'baseCostPerUnit',
  cargoCost: 'cargoCostPerUnit',
  landedCost: 'landedCostPerUnit',
  inventoryValue: 'inventoryValue',
  costCoverage: 'estimatedPercent',
  gmPrice: 'gmPricePerUnit',
  ledgerStatus: 'reconciliationStatus',
  inventory: 'inventory',
  ammoCost: 'baseAmmoCostPerUnit',
  foodCost: 'baseFoodCostPerUnit',
  fuelCost: 'baseFuelCostPerUnit',
  rentalCost: 'baseRentalCostPerUnit',
  txsCost: 'baseTxsCostPerUnit',
  source: 'source',
});

const earningsFilterBarBySubtab = Object.freeze({
  scanning: () => ({ date: earningsScanningDateFilter, fleet: earningsScanningFleetFilter }),
  mining: () => ({ date: earningsMiningDateFilter, fleet: earningsMiningFleetFilter, rawMaterial: earningsMiningMaterialFilter }),
  cargo: () => ({ date: earningsCargoDateFilter, fleet: earningsCargoFleetFilter }),
  cargoAllocation: () => ({ date: earningsCargoAllocationDateFilter, fleet: earningsCargoAllocationFleetFilter, asset: earningsCargoAllocationAssetFilter }),
  crafting: () => ({ date: earningsCraftingDateFilter, starbase: earningsCraftingStarbaseFilter, asset: earningsCraftingAssetFilter }),
  upgrading: () => ({ date: earningsUpgradingDateFilter, starbase: earningsUpgradingStarbaseFilter, asset: earningsUpgradingAssetFilter }),
  breakeven: () => ({ starbase: earningsBreakevenStarbaseFilter, asset: earningsBreakevenAssetFilter }),
});

const earningsTableHeadBySubtab = Object.freeze({
  scanning: () => earningsTableHead,
  mining: () => earningsMiningTableHead,
  cargo: () => earningsCargoTableHead,
  crafting: () => earningsCraftingTableHead,
  upgrading: () => earningsUpgradingTableHead,
  breakeven: () => earningsBreakevenTableHead,
});

const earningsRowsKeyBySubtab = Object.freeze({
  scanning: 'rows',
  mining: 'miningRows',
  cargo: 'cargoRows',
  crafting: 'craftingRows',
  upgrading: 'upgradingRows',
  breakeven: 'breakevenRows',
});

const earningsFleetPalette = Object.freeze([
  '#f43f5e',
  '#22d3ee',
  '#facc15',
  '#a855f7',
  '#34d399',
  '#fb923c',
  '#60a5fa',
  '#f472b6',
  '#84cc16',
  '#e879f9',
  '#2dd4bf',
  '#f97316',
  '#c084fc',
  '#06b6d4',
  '#fde047',
  '#4ade80',
  '#38bdf8',
  '#e11d48',
  '#14b8a6',
  '#d946ef',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ef4444',
  '#0ea5e9',
  '#65a30d',
  '#ec4899',
  '#fcd34d',
]);

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
  'Radiation Absorber': '#9b6f88',
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
let factionPrefetchGeneration = 0;
const TELEMETRY_TRIGGERS = new Set(['startup', 'background', 'navigation', 'manual', 'settings', 'unknown']);
let rendererTelemetryTrigger = 'unknown';
function normalizeTelemetryTrigger(value) {
  return TELEMETRY_TRIGGERS.has(value) ? value : 'unknown';
}
function setNextRendererTelemetryTrigger(trigger) {
  rendererTelemetryTrigger = normalizeTelemetryTrigger(trigger);
}
function clearRendererTelemetryTrigger() { rendererTelemetryTrigger = 'unknown'; }
function captureRendererTelemetryTrigger(fallback = 'unknown') {
  const captured = rendererTelemetryTrigger === 'unknown' ? normalizeTelemetryTrigger(fallback) : rendererTelemetryTrigger;
  rendererTelemetryTrigger = 'unknown';
  return captured;
}
function withTelemetryTrigger(payload, trigger) { return { ...payload, trigger: normalizeTelemetryTrigger(trigger) }; }

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

function cachePrefetchedFilterResult(faction, section, result, ...filters) {
  if (!result?.ok) return;
  setCachedFactionResult(faction, section, result);
  setCachedFactionResult(faction, getFilterCacheKey(faction, section, ...filters), result);
}

async function runFactionBackgroundPrefetch(generation, faction) {
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'background';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  if (!hasInfluxSettings(latestSettings || getFormPayload())) return;
  const settings = {
    ...(latestSettings || getFormPayload()),
    faction,
    playerProfiles: { ...((latestSettings || getFormPayload()).playerProfiles || {}) },
  };
  settings.trigger = telemetryTrigger;
  const tasks = [
    {
      key: 'fleet',
      cached: () => Boolean(getCachedFactionResult(faction, 'fleet')) || !getActivePlayerProfile(settings),
      load: async () => {
        const result = await api.getFleets(settings);
        if (result?.ok) setCachedFactionResult(faction, 'fleet', result);
      },
    },
    { key: 'scanning', cached: () => Boolean(getCachedFilterResult(faction, 'sdu', '')), load: async () => cachePrefetchedFilterResult(faction, 'sdu', await api.getDailySdu({ ...settings, fleetFilter: '' }), '') },
    { key: 'mining', cached: () => Boolean(getCachedFilterResult(faction, 'mining', '', '')), load: async () => cachePrefetchedFilterResult(faction, 'mining', await api.getDailyMining({ ...settings, starbaseFilter: '', fleetFilter: '' }), '', '') },
    { key: 'crafting', cached: () => Boolean(getCachedFilterResult(faction, 'crafting', '', '')), load: async () => cachePrefetchedFilterResult(faction, 'crafting', await api.getDailyCrafting({ ...settings, starbaseFilter: '', recipeFilter: '' }), '', '') },
    { key: 'production', cached: () => Boolean(getCachedFilterResult(faction, 'production', '', '')), load: async () => cachePrefetchedFilterResult(faction, 'production', await api.getDailyProduction({ ...settings, starbaseFilter: '', assetFilter: '' }), '', '') },
    { key: 'consumption-scanning', cached: () => isConsumptionScanningCacheFresh(settings, '', ''), load: () => refreshConsScanning({ settings, starbaseFilter: '', fleetFilter: '' }) },
    { key: 'consumption-mining', cached: () => isConsumptionMiningCacheFresh(settings, '', ''), load: () => refreshConsMining({ settings, starbaseFilter: '', fleetFilter: '' }) },
    { key: 'consumption-cargo', cached: () => isConsumptionCargoCacheFresh(settings, '', ''), load: () => refreshConsCargo({ settings, starbaseFilter: '', fleetFilter: '' }) },
    { key: 'consumption-crafting', cached: () => isConsumptionCraftingCacheFresh(settings, '', ''), load: () => refreshConsCrafting({ settings, starbaseFilter: '', recipeFilter: '' }) },
    { key: 'consumption-upgrading', cached: () => isConsumptionUpgradingCacheFresh(settings, '', ''), load: () => refreshConsUpgrading({ settings, starbaseFilter: '', componentFilter: '' }) },
    { key: 'consumption-total', cached: () => isConsumptionTotalCacheFresh(settings, '', ''), load: () => refreshConsTotal({ settings, starbaseFilter: '', assetFilter: '' }) },
    { key: 'pcr', cached: () => Boolean(getCachedFactionResult(faction, 'pcr')), load: async () => { const result = await api.getPcrCharts(settings); if (result?.ok) setCachedFactionResult(faction, 'pcr', result); } },
    { key: 'inventory', cached: () => Boolean(getCachedFactionResult(faction, 'inventory::__all__')), load: async () => { const result = await api.getInventory({ ...settings, starbaseFilter: '__all__' }); if (result?.ok) setCachedFactionResult(faction, 'inventory::__all__', result); } },
    { key: 'earnings', cached: () => Boolean(getCachedFactionResult(faction, 'earnings')) || !getActivePlayerProfile(settings), load: async () => { const result = await api.getEarningsSnapshot({ ...settings, earningsSubtab: 'crafting' }); if (result?.ok !== false) setCachedFactionResult(faction, 'earnings', result); } },
    { key: 'optimization-scanning', cached: () => Boolean(getCachedFilterResult(faction, 'optimizationScanning', '', '', '__all__', '__all__', '__all__', '__all__')), load: async () => { const result = await api.getScanningOptimization({ faction, start: null, stop: null, fleet: '__all__', eventType: '__all__', operation: '__all__', status: '__all__', offset: 0, limit: 500 }); if (result?.ok) setCachedFilterResult(faction, 'optimizationScanning', result, '', '', '__all__', '__all__', '__all__', '__all__'); } },
    { key: 'optimization-upgrading', cached: () => Boolean(getCachedFilterResult(faction, 'optimizationUpgrading', '', '')), load: async () => { const result = await api.getUpgradingOptimization({ faction, start: null, stop: null }); if (result?.ok) setCachedFilterResult(faction, 'optimizationUpgrading', result, '', ''); } },
  ];

  for (const task of tasks) {
    if (generation !== factionPrefetchGeneration) return;
    if (task.cached()) continue;
    try {
      await task.load();
    } catch (error) {
      console.warn(`[MSA] Background prefetch failed for ${faction}/${task.key}:`, error);
    }
  }
}

function loadVisibleThenPrefetch(loader) {
  const generation = ++factionPrefetchGeneration;
  const faction = normalizeFaction((latestSettings || getFormPayload()).faction);
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  return Promise.resolve()
    .then(() => { setNextRendererTelemetryTrigger(telemetryTrigger); return loader(); })
    .finally(() => {
      if (generation === factionPrefetchGeneration && faction === normalizeFaction((latestSettings || getFormPayload()).faction)) {
        setNextRendererTelemetryTrigger(telemetryTrigger);
        void runFactionBackgroundPrefetch(generation, faction);
      }
    });
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
  setCachedFactionResult(faction, 'selectedProductionAsset', selectedProductionAsset);
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
  setCachedFactionResult(faction, 'selectedConsTotalAsset', selectedConsTotalAsset);
  setCachedFactionResult(faction, 'selectedInvStarbase', invSelectedStarbase);
}

function restoreFactionFilterState(faction) {
  selectedScanningFleet = getCachedFactionResult(faction, 'selectedScanningFleet') || '';
  selectedMiningFleet = getCachedFactionResult(faction, 'selectedMiningFleet') || '';
  selectedMiningStarbase = getCachedFactionResult(faction, 'selectedMiningStarbase') || '';
  selectedCraftingStarbase = getCachedFactionResult(faction, 'selectedCraftingStarbase') || '';
  selectedCraftingRecipe = getCachedFactionResult(faction, 'selectedCraftingRecipe') || '';
  selectedProductionStarbase = getCachedFactionResult(faction, 'selectedProductionStarbase') || '';
  selectedProductionAsset = getCachedFactionResult(faction, 'selectedProductionAsset') || '';
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
  selectedConsTotalAsset = getCachedFactionResult(faction, 'selectedConsTotalAsset') || '';
  invSelectedStarbase = getCachedFactionResult(faction, 'selectedInvStarbase') || '__all__';
}

function openSettings() {
  form.classList.add('sensitive-hidden');
  toggleSensitiveButton.textContent = 'Show RPC URL';
  void refreshRpcLimiterStatus();
  settingsOverlay.classList.remove('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'false');
  closeSettingsButton.focus();
}

function renderRpcLimiterStatus(status) {
  rpcLimiterMainUrl.value = status?.providers?.main?.url || '';
  rpcLimiterFallbackUrl.value = status?.providers?.fallback?.url || '';
  rpcLimiterStatePath.textContent = status?.path || '—';
  const activeParts = [];
  if (status?.activeProvider) activeParts.push(`active: ${status.activeProvider}`);
  if (status?.providers?.main?.cooldown) activeParts.push('main: cooldown');
  if (status?.providers?.fallback?.cooldown) activeParts.push('fallback: cooldown');
  if (status?.providers?.main?.cooldown && status?.providers?.fallback?.cooldown) {
    activeParts.push('⚠ both providers in cooldown');
  }
  rpcLimiterActive.textContent = activeParts.join(' · ');
  const detail = [];
  if (status?.updatedBy) detail.push(`updated by ${status.updatedBy}`);
  if (status?.updatedAt) detail.push(`at ${status.updatedAt}`);
  rpcLimiterUpdated.textContent = detail.join(' ');
}

async function refreshRpcLimiterStatus() {
  try { renderRpcLimiterStatus(await api.getRpcLimiterStatus()); }
  catch (error) { console.error('[MyStarAtlas] Failed to load RPC limiter status:', error); }
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

function setUpdateModalOpen(open) {
  updateModal.hidden = !open;
}

function currentUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function setRpcUsageModalOpen(open) {
  rpcUsageModal.hidden = !open;
  if (open) rpcUsageCloseButton.focus();
  else rpcUsageButton.focus();
}

function populateRpcUsageDates(dates, selectedDate) {
  const values = [...new Set([selectedDate, ...(Array.isArray(dates) ? dates : [])].filter(Boolean))]
    .sort((left, right) => right.localeCompare(left));
  rpcUsageDateSelect.replaceChildren();
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = value === selectedDate;
    rpcUsageDateSelect.appendChild(option);
  }
}

function populateRpcUsageMethods(methods) {
  const selected = rpcUsageMethodSelect.value || 'all';
  rpcUsageMethodSelect.replaceChildren();
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = 'All methods';
  rpcUsageMethodSelect.appendChild(all);
  for (const method of Array.isArray(methods) ? methods : []) {
    const option = document.createElement('option');
    option.value = method;
    option.textContent = method;
    rpcUsageMethodSelect.appendChild(option);
  }
  rpcUsageMethodSelect.value = [...rpcUsageMethodSelect.options].some((option) => option.value === selected) ? selected : 'all';
}

function formatRpcUsagePercent(value) {
  return `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)}%`;
}

function renderRpcUsage() {
  const summary = rpcUsageSummary;
  if (!summary?.available) {
    rpcUsageContent.hidden = true;
    rpcUsageEmpty.hidden = false;
    setText(rpcUsageEmpty, summary?.reason === 'missing' ? 'No telemetry recorded' : 'Telemetry unavailable for this UTC day.');
    setText(rpcUsagePeriod, 'UTC telemetry unavailable');
    return;
  }
  const view = rpcUsageModel.buildRpcUsageView(summary, {
    faction: rpcUsageFactionSelect.value,
    method: rpcUsageMethodSelect.value,
  });
  rpcUsageContent.hidden = false;
  rpcUsageEmpty.hidden = true;
  setText(rpcUsagePeriod, `${summary.periodLabel} · ${summary.utcDate}`);
  setText(rpcUsageTotal, formatWholeNumber(view.dayTotal));
  setText(rpcUsageFiltered, formatWholeNumber(view.filtered.requests));
  setText(rpcUsageShare, formatRpcUsagePercent(view.filteredShare));
  setText(rpcUsageRetries, formatWholeNumber(view.filtered.retries));
  setText(rpcUsageFallbacks, formatWholeNumber(view.filtered.fallbackAttempts));

  const providerRequests = new Map(view.providers.map((item) => [item.key, item.requests]));
  const providerParts = (summary.providers || []).map((item) => `${item.label}: ${formatWholeNumber(providerRequests.get(item.key) || 0)}`);
  setText(rpcUsageProviders, `Providers: ${providerParts.join(' · ')} · Batch elements: ${formatWholeNumber(view.filtered.batchElements)} (not additional requests)`);
  const updatedAt = Date.parse(summary.lastUpdatedAt);
  setText(rpcUsageUpdated, `Last telemetry update: ${Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : 'Unavailable'}`);

  rpcUsageMethodBody.replaceChildren();
  if (!view.methods.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'No RPC requests recorded for this filter.';
    row.appendChild(cell);
    rpcUsageMethodBody.appendChild(row);
    return;
  }
  for (const method of view.methods) {
    const row = document.createElement('tr');
    const values = [
      method.method,
      formatWholeNumber(method.requests),
      formatRpcUsagePercent(view.dayTotal > 0 ? method.requests / view.dayTotal : 0),
      formatWholeNumber(method.retries),
      formatWholeNumber(method.fallbackAttempts),
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    rpcUsageMethodBody.appendChild(row);
  }
}

async function loadRpcUsage(utcDate = currentUtcDate()) {
  const generation = ++rpcUsageLoadGeneration;
  setText(rpcUsagePeriod, `Loading ${utcDate} UTC...`);
  rpcUsageContent.hidden = true;
  rpcUsageEmpty.hidden = false;
  setText(rpcUsageEmpty, 'Loading telemetry...');
  try {
    const result = await api.getRpcUsageDay(utcDate);
    if (generation !== rpcUsageLoadGeneration) return;
    rpcUsageSummary = result;
    populateRpcUsageDates(rpcUsageSummary.availableDates, rpcUsageSummary.utcDate);
    populateRpcUsageMethods(rpcUsageSummary.methods);
  } catch (error) {
    if (generation !== rpcUsageLoadGeneration) return;
    console.error(error);
    rpcUsageSummary = { available: false, reason: 'unavailable', utcDate, availableDates: [] };
    populateRpcUsageDates([], utcDate);
    populateRpcUsageMethods([]);
  }
  renderRpcUsage();
}

function renderUpdateState(result, error = null) {
  availableUpdate = result || null;
  const updateAvailable = Boolean(result?.updateAvailable);
  updateButton.classList.toggle('update-available', updateAvailable);
  updateButton.title = updateAvailable
    ? `Update available: v${result.latestVersion}`
    : error
      ? 'Update check failed'
      : 'Check for updates';
  setText(updateCurrentVersion, `v${result?.currentVersion || versionLabel.textContent || '--'}`);
  setText(updateLatestVersion, result?.latestVersion ? `v${result.latestVersion}` : error ? 'Unavailable' : 'Checking...');
  updateConfirmButton.disabled = !updateAvailable;
  updateConfirmButton.textContent = updateAvailable ? `Update to v${result.latestVersion}` : 'Update';
  setText(updateMessage, error
    ? `Update check failed: ${error?.message || String(error)}`
    : updateAvailable
      ? 'A newer My Star Atlas version is available on GitHub.'
      : 'My Star Atlas is already up to date.');
}

async function checkForUpdates({ openModal = false } = {}) {
  if (openModal) {
    setUpdateModalOpen(true);
    setText(updateLatestVersion, 'Checking...');
    setText(updateMessage, 'Checking GitHub for the latest version...');
    updateConfirmButton.disabled = true;
  }
  if (updateCheckInFlight) return;
  updateCheckInFlight = true;
  try {
    renderUpdateState(await api.checkForUpdates());
  } catch (error) {
    console.error(error);
    renderUpdateState(null, error);
  } finally {
    updateCheckInFlight = false;
  }
}

function setDailyAverageMetric(valueElement, noteElement, result, unitLabel = 'active days') {
  const activeDays = Number(result?.activeDays || 0);
  setText(valueElement, formatWholeNumber(result?.dailyAverage || 0));
  setText(noteElement, activeDays > 0 ? `Across ${activeDays} ${unitLabel}` : 'No active days');
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
    gmTradingWallets: String(data.get('gmTradingWallets') || ''),
    faction,
    influxUrl: String(data.get('influxUrl') || ''),
    influxAuthToken: String(data.get('influxAuthToken') || ''),
    influxBucket: String(data.get('influxBucket') || ''),
    influxOptimizationBucket: String(data.get('influxOptimizationBucket') || 'optimization'),
    useRpcLimiter: Boolean(data.get('useRpcLimiter')),
    rpcUrl: String(data.get('rpcUrl') || ''),
    rpcRequestsPerSecond: String(data.get('rpcRequestsPerSecond') || ''),
    providerRole: data.get('providerRole') ? 'fallback' : 'main',
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
  const secureLabels = {
    aephiaApiKey: 'Aephia API key',
    influxAuthToken: 'Influx auth token',
    rpcUrl: 'RPC URL',
  };
  for (const [key, label] of Object.entries(secureLabels)) {
    const field = form.elements[key];
    if (!field) continue;
    field.value = '';
    field.placeholder = settings?.secureSettingsStatus?.[key]
      ? 'Stored securely — enter a new value to replace'
      : `Enter ${label} to store securely`;
  }
}

function hasRequiredSettings(settings) {
  return Boolean(
    getActivePlayerProfile(settings) &&
      settings.influxUrl &&
      hasSecureSetting(settings, 'influxAuthToken') &&
      settings.influxBucket
  );
}

function hasInfluxSettings(settings) {
  return Boolean(settings?.influxUrl && hasSecureSetting(settings, 'influxAuthToken') && settings?.influxBucket);
}

function hasSecureSetting(settings, key) {
  return Boolean(settings?.[key] || settings?.secureSettingsStatus?.[key]);
}

function updateSettingsStatus(settings) {
  const ready = hasRequiredSettings(settings);
  const status = ready ? 'Settings Ready' : 'Settings Incomplete';
  syncDot.classList.toggle('ready', ready);
  syncDot.classList.toggle('muted', !ready);
  syncDot.setAttribute('title', status);
  syncDot.setAttribute('aria-label', status);
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
    secureSettingsStatus: latestSettings?.secureSettingsStatus || {},
    ...overrides,
    playerProfiles: {
      ...formPayload.playerProfiles,
      ...(overrides.playerProfiles || {}),
    },
  };
}

function resetFactionScopedState() {
  latestFleetResult = null;
  latestEarningsResult = null;
  latestBreakevenResult = null;
  latestOptimizationResult = null;
  optimizationRows = [];
  optimizationFleetFilter?.replaceChildren(new Option('All fleets', '__all__'));
  optimizationAnalyticsRows = [];
  optimizationAnalyticsLoadedFaction = '';
  optimizationAnalyticsPrices = null;
  latestUpgradingOptimizationResult = null;
  optimizationUpgradingRows = [];
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
  // Earnings table filter+sort state is data-value keyed (fleet name,
  // raw material, date string), so it must reset on faction switch
  // or the previous faction's filter would still be active against
  // the new faction's data and silently filter everything out (or,
  // when a fleet label collides across factions, show the wrong rows).
  earningsFilters.scanning = { date: '', fleet: '' };
  earningsFilters.mining = { date: '', fleet: '', rawMaterial: '' };
  earningsFilters.cargo = { date: '', fleet: '' };
  earningsFilters.crafting = { date: '', starbase: '', asset: '' };
  earningsSort.scanning = { column: null, direction: null };
  earningsSort.mining = { column: null, direction: null };
  earningsSort.cargo = { column: null, direction: null };
  earningsSort.crafting = { column: null, direction: null };
  // Inventory is also faction-scoped: the starbase dropdown and the
  // per-asset visibility are keyed by faction, so wipe the cached
  // result and force a fresh fetch on the next render.
  latestInventoryResult = null;
  invSelectedStarbase = '__all__';
}

function resetLegacyFleetState() {
  latestFleetResult = null;
  for (const cache of factionCache.values()) delete cache.fleet;
}

function resetLegacyEarningsState() {
  latestEarningsResult = null;
  for (const cache of factionCache.values()) delete cache.earnings;
}

function resetLegacyOptimizationState() {
  latestOptimizationResult = null;
  optimizationRows = [];
  optimizationAnalyticsRows = [];
  optimizationAnalyticsLoadedFaction = '';
  optimizationAnalyticsPrices = null;
  latestUpgradingOptimizationResult = null;
  optimizationUpgradingRows = [];
  for (const cache of factionCache.values()) {
    for (const key of Object.keys(cache)) {
      if (key.includes(':optimizationScanning:') || key.includes(':optimizationUpgrading:')) delete cache[key];
    }
  }
}

function resetLegacyInfluxPrimaryState() {
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
  latestInventoryResult = null;
  for (const cache of factionCache.values()) {
    for (const key of Object.keys(cache)) {
      if (key === 'pcr' || key.startsWith('inventory::') || /^(?:sdu|mining|crafting|production|consMining|consCrafting|consUpgrading|consScanning|consCargo|consTotal)$/.test(key) || /:(?:sdu|mining|crafting|production|consMining|consCrafting|consUpgrading|consScanning|consCargo|consTotal):/.test(key)) delete cache[key];
    }
  }
}

function updateTitle() {
  document.querySelectorAll('[data-toolbar-section]').forEach((group) => {
    group.hidden = group.dataset.toolbarSection !== currentSection;
  });
}

function updateInfluxResult(result) {
  if (!result?.ok) {
    measurementList.textContent = formatInfluxError(result?.error);
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

function formatInfluxError(value) {
  const error = String(value || '').trim();
  if (!error) return 'Influx test failed';
  if (/influx_(?:bucket_lookup|flux)_401/i.test(error)) return 'Authentication failed (HTTP 401). Check the Influx token.';
  if (/influx_(?:bucket_lookup|flux)_403/i.test(error)) return 'Access denied (HTTP 403). Check the token permissions.';
  if (/influx_bucket_not_found:/i.test(error)) return `Bucket not found: ${error.split(':').slice(1).join(':')}`;
  if (/influx_bucket_ambiguous:/i.test(error)) return `More than one accessible bucket has this name: ${error.split(':').slice(1).join(':')}`;
  if (/influx_bucket_lookup_\d+/i.test(error)) return `Bucket lookup failed (${error.match(/\d+/)?.[0] || 'HTTP error'}).`;
  if (/influx_flux_\d+/i.test(error)) return `Influx query failed (${error.match(/\d+/)?.[0] || 'HTTP error'}).`;
  if (/fetch failed|network|timed?\s*out|abort/i.test(error)) return 'Could not reach the Influx server.';
  return `Influx test failed: ${error.slice(0, 240)}`;
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

function formatDecimal(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(number);
}

function formatCompactNumber(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

const marketplaceNumberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const marketplaceAtlasFormatter = (digits) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
function formatMarketplaceWhole(value) {
  return marketplaceNumberFormatter.format(Number(value) || 0);
}
function formatMarketplaceAtlas(value, digits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return marketplaceAtlasFormatter(digits).format(number);
}
function formatMarketplaceTimestamp(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
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
    option.title = `${fleet.label || fleet.value}: ${formatWholeNumber(fleet.total)} over 30 days`;
    select.appendChild(option);
  }

  select.value = nextSelected;
  select.disabled = options.length === 0;
  if (note) {
    note.textContent = options.length
      ? `${options.length} active ${options.length === 1 ? 'fleet' : 'fleets'} in last 30 days`
      : 'No fleet activity in last 30 days';
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
    option.title = `${item.label || item.value}: ${formatWholeNumber(item.total)} over 30 days`;
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
  setText(sduTopFleetValue, '--');
  setText(sduTopFleetNote, message);
  setText(sduDaysActiveValue, '--');
  setText(sduDaysActiveNote, message);
  setText(sduChartTotal, '--');
  if (!String(message).startsWith('Loading')) {
    resetActivityFleetFilter(scanningFleetFilter, scanningFleetNote, message);
  }
  sduChartBars.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  sduChartBars.appendChild(empty);
}

function selectCachedSduFleet(result, fleet) {
  if (!result?.fleetDays || !Array.isArray(result.allFleetDays)) return false;
  const selectedFleet = String(fleet || '');
  const days = selectedFleet ? result.fleetDays[selectedFleet] : result.allFleetDays;
  if (!Array.isArray(days)) return false;

  requestGuard.begin('scanning:daily', getRefreshContext({ fleetFilter: selectedFleet }));
  renderSduChart({
    ...result,
    days,
    total: days.reduce((sum, day) => sum + (Number(day.value) || 0), 0),
    selectedFleet,
    surplus: selectedFleet || !result.consumption
      ? null
      : days.reduce((sum, day) => sum + (Number(day.value) || 0), 0) - (Number(result.consumption.total) || 0),
  });
  return true;
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
  setText(
    sduTotalNote,
    result.warning
      ? `Updated ${formatCheckedAt(result.checkedAt)} · consumption unavailable`
      : `Updated ${formatCheckedAt(result.checkedAt)}`
  );
  setText(sduChartTotal, formatWholeNumber(result.total));

  const todayKey = getUtcTodayKey();
  const completedDays = days.filter((day) => day.isoDate !== todayKey);
  const activeDays = completedDays.filter((day) => (Number(day.value) || 0) > 0);
  if (activeDays.length > 0) {
    const avg = activeDays.reduce((sum, day) => sum + (Number(day.value) || 0), 0) / activeDays.length;
    setText(sduAvgValue, formatWholeNumber(avg));
    setText(sduAvgNote, `Across ${activeDays.length} of ${completedDays.length} completed days`);
    setText(sduDaysActiveValue, formatWholeNumber(activeDays.length));
    setText(sduDaysActiveNote, `${completedDays.length} completed days`);
  } else {
    setText(sduAvgValue, '0');
    setText(sduAvgNote, 'No completed days with SDU');
    setText(sduDaysActiveValue, '0');
    setText(sduDaysActiveNote, 'No completed days with SDU');
  }
  const topFleet = Array.isArray(result.fleets)
    ? result.fleets.slice().sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))[0]
    : null;
  setText(sduTopFleetValue, topFleet?.label || '--');
  setText(sduTopFleetNote, topFleet ? `${formatWholeNumber(topFleet.total)} SDU` : 'No fleet data');
  sduChartBars.textContent = '';
  sduChartBars.appendChild(createYAxis(maxValue));

  for (const day of days) {
    const value = Number(day.value) || 0;
    const height = Math.max(3, Math.round((value / maxValue) * 100));
    const bar = document.createElement('div');
    bar.className = 'resource-chart-bar';
    bar.title = `${day.label}: ${formatWholeNumber(value)} SDU`;

    const fill = document.createElement('span');
    fill.className = 'resource-chart-fill';
    fill.style.height = `${height}%`;
    fill.style.background = getAssetChartFill('Survey Data Unit');
    bar.appendChild(fill);
    sduChartBars.appendChild(bar);
  }
}

function renderMiningEmpty(message) {
  latestMiningResult = null;
  setText(miningAvgValue, '--');
  setText(miningAvgNote, message);
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
  setDailyAverageMetric(miningAvgValue, miningAvgNote, result);
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
    bars.setAttribute('aria-label', `${material.resource} mined over the last 30 days`);
    bars.appendChild(createYAxis(maxValue));
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
  setText(craftingAvgValue, '--');
  setText(craftingAvgNote, message);
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
  bars.setAttribute('aria-label', `${step.label} crafted over the last 30 days`);
  bars.appendChild(createYAxis(maxValue));
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
  const total = document.createElement('span');
  total.className = 'resource-card-total';
  total.textContent = formatWholeNumber(pie.dailyAverage ?? pie.total);
  total.title = `Daily average: ${formatWholeNumber(pie.dailyAverage ?? pie.total)}`;
  header.appendChild(title);
  header.appendChild(total);

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
    title.textContent = `${slice.label}: ${formatWholeNumber(slice.dailyAverage ?? slice.total)} daily average`;
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
    item.title = `${slice.label}: ${formatWholeNumber(slice.dailyAverage ?? slice.total)} daily average`;
    item.appendChild(swatch);
    item.appendChild(label);
    legend.appendChild(item);
  });

  card.appendChild(header);
  card.appendChild(pieGraphic);
  card.appendChild(legend);
  return card;
}

function formatStarbaseList(starbases) {
  const list = Array.isArray(starbases)
    ? starbases.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (list.length <= 2) return list.join(', ');
  return `${list[0]} +${list.length - 1}`;
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
  setDailyAverageMetric(craftingAvgValue, craftingAvgNote, result);
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
  setText(productionAvgValue, '--');
  setText(productionAvgNote, message);
  setText(productionTotalValue, '--');
  setText(productionTotalNote, message);
  setText(productionTopValue, '--');
  setText(productionTopNote, message);
  setText(productionCountValue, '--');
  setText(productionCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(productionStarbaseFilter, 'All starbases');
    resetSelectWithAllOption(productionAssetFilter, 'All assets');
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
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'production', result, selectedProductionStarbase, selectedProductionAsset);

  selectedProductionAsset = updateSelectOptions(
    productionAssetFilter,
    result.productOptions,
    result.selectedAsset || selectedProductionAsset,
    'All assets'
  );
  selectedProductionStarbase = updateSelectOptions(
    productionStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedProductionStarbase,
    'All starbases'
  );

  setDailyAverageMetric(productionAvgValue, productionAvgNote, result);
  setText(productionTotalValue, formatWholeNumber(result.total));
  setText(productionTotalNote, `Updated ${formatCheckedAt(result.checkedAt)}`);
  setText(productionTopValue, result.topProduct || '--');
  setText(productionTopNote, result.mode === 'detail' ? 'Largest product' : 'Largest output share');
  setText(productionCountValue, formatWholeNumber(result.productCount || 0));
  setText(productionCountNote, 'Produced outputs');
  setText(
    productionFilterNote,
    `${result.starbaseCount || 0} active ${(result.starbaseCount || 0) === 1 ? 'starbase' : 'starbases'} in last 30 days${
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
    productionChartGrid.appendChild(createConsumptionBarCard(asset, index, { actionLabel: 'produced' }));
  }
}

/* ---- Consumption: Mining ---- */

function renderConsMiningEmpty(message) {
  latestConsMiningResult = null;
  setText(consMiningAvgValue, '--');
  setText(consMiningAvgNote, message);
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

  setDailyAverageMetric(consMiningAvgValue, consMiningAvgNote, result);
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

function getConsumptionMiningCacheInput(settings = latestSettings || getFormPayload(), starbaseFilter = selectedConsMiningStarbase, fleetFilter = selectedConsMiningFleet, force = false) {
  return {
    faction: normalizeFaction(settings?.faction),
    playerProfile: getActivePlayerProfile(settings),
    starbaseFilter: String(starbaseFilter || '').trim(),
    fleetFilter: String(fleetFilter || '').trim(),
    force,
  };
}

function isConsumptionMiningCacheFresh(settings, starbaseFilter, fleetFilter) {
  const input = getConsumptionMiningCacheInput(settings, starbaseFilter, fleetFilter);
  if (!input.playerProfile) return false;
  return api.consumptionMiningCache.inspect(input)?.entry?.status === 'ready';
}

function isActiveConsumptionMiningContext(key, generation) {
  if (currentSection !== 'production' || currentSubtab !== 'consumption' || currentConsumptionSubtab !== 'mining') return false;
  const input = getConsumptionMiningCacheInput();
  if (!input.playerProfile || api.consumptionMiningCache.buildKey(input) !== key) return false;
  const current = api.consumptionMiningCache.inspect(input);
  return current?.key === key && current?.entry?.generation === generation;
}

async function refreshConsMining({
  force = false,
  settings = latestSettings || getFormPayload(),
  starbaseFilter = selectedConsMiningStarbase,
  fleetFilter = selectedConsMiningFleet,
} = {}) {
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  if (!hasInfluxSettings(settings)) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'mining') {
      renderConsMiningEmpty('Awaiting Influx connection');
    }
    return null;
  }

  const input = getConsumptionMiningCacheInput(settings, starbaseFilter, fleetFilter, force);
  if (!input.playerProfile) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'mining') {
      renderConsMiningEmpty(`No ${input.faction} player profile configured`);
    }
    return null;
  }
  const initial = api.consumptionMiningCache.inspect(input);
  const displayable = initial?.entry?.value || initial?.entry?.lastGoodValue;
  const initialGeneration = initial?.entry?.generation;
  if (displayable && isActiveConsumptionMiningContext(initial.key, initialGeneration)) {
    renderConsMining(displayable);
  } else if (!displayable && currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'mining') {
    renderConsMiningEmpty('Loading mining consumption...');
  }

  const requestSettings = {
    ...settings,
    starbaseFilter: input.starbaseFilter,
    fleetFilter: input.fleetFilter,
  };
  requestSettings.trigger = telemetryTrigger;
  const settled = await api.consumptionMiningCache.ensure(input, async () => {
    const result = await api.getDailyConsumptionMining(requestSettings);
    if (result?.ok === false) throw new Error(result.error || 'Mining consumption failed');
    return result;
  });
  if (!isActiveConsumptionMiningContext(settled.key, settled.entry.generation)) return settled;
  const value = settled.entry.value || settled.entry.lastGoodValue;
  if (value) renderConsMining(value);
  else renderConsMiningEmpty(settled.entry.error?.message || 'Influx unavailable');
  return settled;
}

/* ---- Consumption: Crafting ---- */

function renderConsCraftingEmpty(message) {
  latestConsCraftingResult = null;
  setText(consCraftingAvgValue, '--');
  setText(consCraftingAvgNote, message);
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

  setDailyAverageMetric(consCraftingAvgValue, consCraftingAvgNote, result);
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
    const starbaseLabel = result.selectedRecipe && !result.selectedStarbase
      ? formatStarbaseList(asset.starbases)
      : '';
    consCraftingChartGrid.appendChild(createConsumptionBarCard(asset, index, {
      headerRight: starbaseLabel,
      headerRightTitle: (asset.starbases || []).join(', '),
    }));
  }
}

function getConsumptionCraftingCacheInput(settings = latestSettings || getFormPayload(), starbaseFilter = selectedConsCraftingStarbase, recipeFilter = selectedConsCraftingRecipe, force = false) {
  return { faction: normalizeFaction(settings?.faction), playerProfile: getActivePlayerProfile(settings), starbaseFilter: String(starbaseFilter || '').trim(), recipeFilter: String(recipeFilter || '').trim(), force };
}

function isConsumptionCraftingCacheFresh(settings, starbaseFilter, recipeFilter) {
  const input = getConsumptionCraftingCacheInput(settings, starbaseFilter, recipeFilter);
  return Boolean(input.playerProfile && api.consumptionCraftingCache.inspect(input)?.entry?.status === 'ready');
}

function isActiveConsumptionCraftingContext(key, generation) {
  if (currentSection !== 'production' || currentSubtab !== 'consumption' || currentConsumptionSubtab !== 'crafting') return false;
  const input = getConsumptionCraftingCacheInput();
  if (!input.playerProfile || api.consumptionCraftingCache.buildKey(input) !== key) return false;
  const current = api.consumptionCraftingCache.inspect(input);
  return current?.key === key && current?.entry?.generation === generation;
}

async function refreshConsCrafting({ force = false, settings = latestSettings || getFormPayload(), starbaseFilter = selectedConsCraftingStarbase, recipeFilter = selectedConsCraftingRecipe } = {}) {
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  if (!hasInfluxSettings(settings)) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'crafting') renderConsCraftingEmpty('Awaiting Influx connection');
    return null;
  }
  const input = getConsumptionCraftingCacheInput(settings, starbaseFilter, recipeFilter, force);
  if (!input.playerProfile) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'crafting') renderConsCraftingEmpty(`No ${input.faction} player profile configured`);
    return null;
  }
  const initial = api.consumptionCraftingCache.inspect(input);
  const displayable = initial?.entry?.value || initial?.entry?.lastGoodValue;
  if (displayable && isActiveConsumptionCraftingContext(initial.key, initial.entry?.generation)) {
    renderConsCrafting(displayable);
    const resultingInput = getConsumptionCraftingCacheInput();
    if (api.consumptionCraftingCache.buildKey(resultingInput) !== initial.key) {
      const resulting = api.consumptionCraftingCache.inspect(resultingInput);
      if (!resulting?.entry?.value && !resulting?.entry?.lastGoodValue) renderConsCraftingEmpty('Loading crafting consumption...');
      return refreshConsCrafting();
    }
  } else if (!displayable && currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'crafting') renderConsCraftingEmpty('Loading crafting consumption...');
  const requestSettings = { ...settings, starbaseFilter: input.starbaseFilter, recipeFilter: input.recipeFilter };
  requestSettings.trigger = telemetryTrigger;
  const settled = await api.consumptionCraftingCache.ensure(input, async () => {
    const result = await api.getDailyConsumptionCrafting(requestSettings);
    if (result?.ok === false) throw new Error(result.error || 'Crafting consumption failed');
    return result;
  });
  if (!isActiveConsumptionCraftingContext(settled.key, settled.entry.generation)) return settled;
  const value = settled.entry.value || settled.entry.lastGoodValue;
  if (value) {
    renderConsCrafting(value);
    const resultingInput = getConsumptionCraftingCacheInput();
    if (api.consumptionCraftingCache.buildKey(resultingInput) !== settled.key) {
      const resulting = api.consumptionCraftingCache.inspect(resultingInput);
      if (!resulting?.entry?.value && !resulting?.entry?.lastGoodValue) renderConsCraftingEmpty('Loading crafting consumption...');
      return refreshConsCrafting();
    }
  } else renderConsCraftingEmpty(settled.entry.error?.message || 'Influx unavailable');
  return settled;
}

/* ---- Consumption: Upgrading ---- */

function renderConsUpgradingEmpty(message) {
  latestConsUpgradingResult = null;
  setText(consUpgradingAvgValue, '--');
  setText(consUpgradingAvgNote, message);
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

  setDailyAverageMetric(consUpgradingAvgValue, consUpgradingAvgNote, result);
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
    const starbaseLabel = result.selectedComponent && !result.selectedStarbase
      ? formatStarbaseList(asset.starbases)
      : '';
    consUpgradingChartGrid.appendChild(createConsumptionBarCard(asset, index, {
      headerRight: starbaseLabel,
      headerRightTitle: (asset.starbases || []).join(', '),
    }));
  }
}

function getConsumptionUpgradingCacheInput(settings = latestSettings || getFormPayload(), componentFilter = selectedConsUpgradingComponent, starbaseFilter = selectedConsUpgradingStarbase, force = false) {
  return {
    faction: normalizeFaction(settings?.faction),
    playerProfile: getActivePlayerProfile(settings),
    componentFilter: String(componentFilter || ''),
    starbaseFilter: String(starbaseFilter || ''),
    force,
  };
}

function isConsumptionUpgradingCacheFresh(settings, componentFilter, starbaseFilter) {
  const input = getConsumptionUpgradingCacheInput(settings, componentFilter, starbaseFilter);
  if (!input.playerProfile) return false;
  return api.consumptionUpgradingCache.inspect(input)?.entry?.status === 'ready';
}

function isActiveConsumptionUpgradingContext(key, generation) {
  if (currentSection !== 'production' || currentSubtab !== 'consumption' || currentConsumptionSubtab !== 'upgrading') return false;
  const input = getConsumptionUpgradingCacheInput();
  if (!input.playerProfile || api.consumptionUpgradingCache.buildKey(input) !== key) return false;
  const current = api.consumptionUpgradingCache.inspect(input);
  return current?.key === key && current?.entry?.generation === generation;
}

async function refreshConsUpgrading({
  force = false,
  settings = latestSettings || getFormPayload(),
  componentFilter = selectedConsUpgradingComponent,
  starbaseFilter = selectedConsUpgradingStarbase,
} = {}) {
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  if (!hasInfluxSettings(settings)) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'upgrading') {
      renderConsUpgradingEmpty('Awaiting Influx connection');
    }
    return null;
  }

  const input = getConsumptionUpgradingCacheInput(settings, componentFilter, starbaseFilter, force);
  if (!input.playerProfile) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'upgrading') {
      renderConsUpgradingEmpty(`No ${input.faction} player profile configured`);
    }
    return null;
  }
  const initial = api.consumptionUpgradingCache.inspect(input);
  const displayable = initial?.entry?.value || initial?.entry?.lastGoodValue;
  const initialGeneration = initial?.entry?.generation;
  if (displayable && isActiveConsumptionUpgradingContext(initial.key, initialGeneration)) {
    renderConsUpgrading(displayable);
  } else if (!displayable && currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'upgrading') {
    renderConsUpgradingEmpty('Loading upgrading consumption...');
  }

  const requestSettings = {
    ...settings,
    starbaseFilter: input.starbaseFilter,
    componentFilter: input.componentFilter,
  };
  requestSettings.trigger = telemetryTrigger;
  const settled = await api.consumptionUpgradingCache.ensure(input, async () => {
    const result = await api.getDailyConsumptionUpgrading(requestSettings);
    if (result?.ok === false) throw new Error(result.error || 'Upgrading consumption failed');
    return result;
  });
  if (!isActiveConsumptionUpgradingContext(settled.key, settled.entry.generation)) return settled;
  const value = settled.entry.value || settled.entry.lastGoodValue;
  if (value) renderConsUpgrading(value);
  else renderConsUpgradingEmpty(settled.entry.error?.message || 'Influx unavailable');
  return settled;
}

/* ---- Consumption: Scanning ---- */

function renderConsScanningEmpty(message) {
  latestConsScanningResult = null;
  setText(consScanningAvgValue, '--');
  setText(consScanningAvgNote, message);
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

  setDailyAverageMetric(consScanningAvgValue, consScanningAvgNote, result);
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

function getConsumptionScanningCacheInput(settings = latestSettings || getFormPayload(), starbaseFilter = selectedConsScanningStarbase, fleetFilter = selectedConsScanningFleet, force = false) {
  return {
    faction: normalizeFaction(settings?.faction),
    playerProfile: getActivePlayerProfile(settings),
    starbaseFilter: String(starbaseFilter || ''),
    fleetFilter: String(fleetFilter || ''),
    force,
  };
}

function isConsumptionScanningCacheFresh(settings, starbaseFilter, fleetFilter) {
  const input = getConsumptionScanningCacheInput(settings, starbaseFilter, fleetFilter);
  if (!input.playerProfile) return false;
  return api.consumptionScanningCache.inspect(input)?.entry?.status === 'ready';
}

function isActiveConsumptionScanningContext(key, generation) {
  if (currentSection !== 'production' || currentSubtab !== 'consumption' || currentConsumptionSubtab !== 'scanning') return false;
  const input = getConsumptionScanningCacheInput();
  if (!input.playerProfile || api.consumptionScanningCache.buildKey(input) !== key) return false;
  const current = api.consumptionScanningCache.inspect(input);
  return current?.key === key && current?.entry?.generation === generation;
}

async function refreshConsScanning({
  force = false,
  settings = latestSettings || getFormPayload(),
  starbaseFilter = selectedConsScanningStarbase,
  fleetFilter = selectedConsScanningFleet,
} = {}) {
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  if (!hasInfluxSettings(settings)) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'scanning') {
      renderConsScanningEmpty('Awaiting Influx connection');
    }
    return null;
  }

  const input = getConsumptionScanningCacheInput(settings, starbaseFilter, fleetFilter, force);
  if (!input.playerProfile) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'scanning') {
      renderConsScanningEmpty(`No ${input.faction} player profile configured`);
    }
    return null;
  }
  const initial = api.consumptionScanningCache.inspect(input);
  const displayable = initial?.entry?.value || initial?.entry?.lastGoodValue;
  const initialGeneration = initial?.entry?.generation;
  if (displayable && isActiveConsumptionScanningContext(initial.key, initialGeneration)) {
    renderConsScanning(displayable);
  } else if (!displayable && currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'scanning') {
    renderConsScanningEmpty('Loading scanning consumption...');
  }

  const requestSettings = {
    ...settings,
    starbaseFilter: input.starbaseFilter,
    fleetFilter: input.fleetFilter,
  };
  requestSettings.trigger = telemetryTrigger;
  const settled = await api.consumptionScanningCache.ensure(input, async () => {
    const result = await api.getDailyConsumptionScanning(requestSettings);
    if (result?.ok === false) throw new Error(result.error || 'Scanning consumption failed');
    return result;
  });
  if (!isActiveConsumptionScanningContext(settled.key, settled.entry.generation)) return settled;
  const value = settled.entry.value || settled.entry.lastGoodValue;
  if (value) renderConsScanning(value);
  else renderConsScanningEmpty(settled.entry.error?.message || 'Influx unavailable');
  return settled;
}

/* ---- Consumption: Cargo ---- */

function renderConsCargoEmpty(message) {
  latestConsCargoResult = null;
  setText(consCargoAvgValue, '--');
  setText(consCargoAvgNote, message);
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

  setDailyAverageMetric(consCargoAvgValue, consCargoAvgNote, result);
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

function getConsumptionCargoCacheInput(settings = latestSettings || getFormPayload(), starbaseFilter = selectedConsCargoStarbase, fleetFilter = selectedConsCargoFleet, force = false) {
  return { faction: normalizeFaction(settings?.faction), playerProfile: getActivePlayerProfile(settings), starbaseFilter: String(starbaseFilter || '').trim(), fleetFilter: String(fleetFilter || '').trim(), force };
}

function isConsumptionCargoCacheFresh(settings, starbaseFilter, fleetFilter) {
  const input = getConsumptionCargoCacheInput(settings, starbaseFilter, fleetFilter);
  return Boolean(input.playerProfile && api.consumptionCargoCache.inspect(input)?.entry?.status === 'ready');
}

function isActiveConsumptionCargoContext(key, generation) {
  if (currentSection !== 'production' || currentSubtab !== 'consumption' || currentConsumptionSubtab !== 'cargo') return false;
  const input = getConsumptionCargoCacheInput();
  if (!input.playerProfile || api.consumptionCargoCache.buildKey(input) !== key) return false;
  const current = api.consumptionCargoCache.inspect(input);
  return current?.key === key && current?.entry?.generation === generation;
}

async function refreshConsCargo({ force = false, settings = latestSettings || getFormPayload(), starbaseFilter = selectedConsCargoStarbase, fleetFilter = selectedConsCargoFleet } = {}) {
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  if (!hasInfluxSettings(settings)) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'cargo') renderConsCargoEmpty('Awaiting Influx connection');
    return null;
  }
  const input = getConsumptionCargoCacheInput(settings, starbaseFilter, fleetFilter, force);
  if (!input.playerProfile) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'cargo') renderConsCargoEmpty(`No ${input.faction} player profile configured`);
    return null;
  }
  const initial = api.consumptionCargoCache.inspect(input);
  const displayable = initial?.entry?.value || initial?.entry?.lastGoodValue;
  if (displayable && isActiveConsumptionCargoContext(initial.key, initial.entry?.generation)) renderConsCargo(displayable);
  else if (!displayable && currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'cargo') renderConsCargoEmpty('Loading cargo consumption...');
  const requestSettings = { ...settings, starbaseFilter: input.starbaseFilter, fleetFilter: input.fleetFilter };
  requestSettings.trigger = telemetryTrigger;
  const settled = await api.consumptionCargoCache.ensure(input, async () => {
    const result = await api.getDailyConsumptionCargo(requestSettings);
    if (result?.ok === false) throw new Error(result.error || 'Cargo consumption failed');
    return result;
  });
  if (!isActiveConsumptionCargoContext(settled.key, settled.entry.generation)) return settled;
  const value = settled.entry.value || settled.entry.lastGoodValue;
  if (value) renderConsCargo(value);
  else renderConsCargoEmpty(settled.entry.error?.message || 'Influx unavailable');
  return settled;
}

/* ---- Consumption: Total ---- */

function renderConsTotalEmpty(message) {
  latestConsTotalResult = null;
  setText(consTotalAvgValue, '--');
  setText(consTotalAvgNote, message);
  setText(consTotalTotalValue, '--');
  setText(consTotalTotalNote, message);
  setText(consTotalTopValue, '--');
  setText(consTotalTopNote, message);
  setText(consTotalAssetCountValue, '--');
  setText(consTotalAssetCountNote, message);
  if (!String(message).startsWith('Loading')) {
    resetSelectWithAllOption(consTotalStarbaseFilter, 'All starbases');
    resetSelectWithAllOption(consTotalAssetFilter, 'All assets');
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
  setCachedFilterResult(normalizeFaction(latestSettings?.faction), 'consTotal', result, selectedConsTotalStarbase, selectedConsTotalAsset);

  selectedConsTotalStarbase = updateSelectOptions(
    consTotalStarbaseFilter,
    result.starbases,
    result.selectedStarbase || selectedConsTotalStarbase,
    'All starbases'
  );
  selectedConsTotalAsset = updateSelectOptions(
    consTotalAssetFilter,
    result.assetOptions,
    result.selectedAsset || selectedConsTotalAsset,
    'All assets'
  );

  setDailyAverageMetric(consTotalAvgValue, consTotalAvgNote, result);
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

function getConsumptionTotalCacheInput(settings = latestSettings || getFormPayload(), starbaseFilter = selectedConsTotalStarbase, assetFilter = selectedConsTotalAsset, force = false) {
  return { faction: normalizeFaction(settings?.faction), playerProfile: getActivePlayerProfile(settings), starbaseFilter: String(starbaseFilter || '').trim(), assetFilter: String(assetFilter || '').trim(), force };
}

function isConsumptionTotalCacheFresh(settings, starbaseFilter, assetFilter) {
  const input = getConsumptionTotalCacheInput(settings, starbaseFilter, assetFilter);
  return Boolean(input.playerProfile && api.consumptionTotalCache.inspect(input)?.entry?.status === 'ready');
}

function isActiveConsumptionTotalContext(key, generation) {
  if (currentSection !== 'production' || currentSubtab !== 'consumption' || currentConsumptionSubtab !== 'total') return false;
  const input = getConsumptionTotalCacheInput();
  if (!input.playerProfile || api.consumptionTotalCache.buildKey(input) !== key) return false;
  const current = api.consumptionTotalCache.inspect(input);
  return current?.key === key && current?.entry?.generation === generation;
}

async function refreshConsTotal({ force = false, settings = latestSettings || getFormPayload(), starbaseFilter = selectedConsTotalStarbase, assetFilter = selectedConsTotalAsset } = {}) {
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  if (!hasInfluxSettings(settings)) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'total') renderConsTotalEmpty('Awaiting Influx connection');
    return null;
  }
  const input = getConsumptionTotalCacheInput(settings, starbaseFilter, assetFilter, force);
  if (!input.playerProfile) {
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'total') renderConsTotalEmpty(`No ${input.faction} player profile configured`);
    return null;
  }
  const initial = api.consumptionTotalCache.inspect(input);
  const displayable = initial?.entry?.value || initial?.entry?.lastGoodValue;
  if (displayable && isActiveConsumptionTotalContext(initial.key, initial.entry?.generation)) {
    renderConsTotal(displayable);
    const resultingInput = getConsumptionTotalCacheInput();
    if (api.consumptionTotalCache.buildKey(resultingInput) !== initial.key) {
      const resulting = api.consumptionTotalCache.inspect(resultingInput);
      if (!resulting?.entry?.value && !resulting?.entry?.lastGoodValue) renderConsTotalEmpty('Loading total consumption...');
      return refreshConsTotal();
    }
  } else if (!displayable && currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'total') renderConsTotalEmpty('Loading total consumption...');
  const requestSettings = { ...settings, starbaseFilter: input.starbaseFilter, assetFilter: input.assetFilter };
  requestSettings.trigger = telemetryTrigger;
  const settled = await api.consumptionTotalCache.ensure(input, async () => {
    const result = await api.getDailyConsumptionTotal(requestSettings);
    if (result?.ok === false) throw new Error(result.error || 'Total consumption failed');
    return result;
  });
  if (!isActiveConsumptionTotalContext(settled.key, settled.entry.generation)) return settled;
  const value = settled.entry.value || settled.entry.lastGoodValue;
  if (value) {
    renderConsTotal(value);
    const resultingInput = getConsumptionTotalCacheInput();
    if (api.consumptionTotalCache.buildKey(resultingInput) !== settled.key) {
      const resulting = api.consumptionTotalCache.inspect(resultingInput);
      if (!resulting?.entry?.value && !resulting?.entry?.lastGoodValue) renderConsTotalEmpty('Loading total consumption...');
      return refreshConsTotal();
    }
  } else renderConsTotalEmpty(settled.entry.error?.message || 'Influx unavailable');
  return settled;
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

function pcrSetAllAssets(categoryId, assets, hidden) {
  const faction = normalizeFaction(latestSettings?.faction);
  const set = pcrGetCategoryVisibility(faction, categoryId);
  set.clear();
  if (hidden) {
    for (const asset of assets) set.add(asset.label);
  }
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
// full 30 days), we return null to mean "no trimming needed" and show
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

  const dayKeys = new Set(days.map((day) => day.isoDate));
  const chartAssets = assets
    .map((asset) => ({
      ...asset,
      days: (asset.days || []).filter((day) => dayKeys.has(day.isoDate)),
    }))
    .filter((asset) => asset.days.length > 0);
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

  // x-axis day labels (every fifth day, plus first and last)
  for (let i = 0; i < days.length; i += 1) {
    if (i !== 0 && i !== days.length - 1 && i % 5 !== 0) continue;
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
  svg.setAttribute('aria-label', `${category.label} production to consumption ratio over the last 30 days`);

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
  for (const asset of chartAssets) {
    if (visibilitySet.has(asset.label)) hiddenAssets.add(asset.label);
  }

  const segments = [];
  for (const asset of chartAssets) {
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
    tooltip.textContent = '';
    const heading = document.createElement('div');
    heading.style.fontWeight = '600';
    heading.style.marginBottom = '4px';
    heading.textContent = day.label;
    tooltip.appendChild(heading);
    for (const seg of visibleSegments) {
      const assetDay = seg.asset.days[dayIndex];
      const resolved = pcrRatioValue(seg.asset, assetDay);
      const ratioText = !resolved
        ? 'no data'
        : resolved.clipped
          ? '∞'
          : pcrFormatRatio(resolved.ratio);
      const row = document.createElement('div');
      row.className = 'pcr-tooltip-row';
      const swatch = document.createElement('span');
      swatch.className = 'pcr-tooltip-swatch';
      swatch.style.background = seg.color;
      const label = document.createElement('span');
      label.textContent = seg.asset.label;
      const values = document.createElement('span');
      values.style.color = 'var(--muted)';
      values.textContent = `${pcrFormatInteger(assetDay.production)} / ${pcrFormatInteger(assetDay.consumption)}`;
      const ratio = document.createElement('span');
      ratio.style.marginLeft = '6px';
      ratio.textContent = ratioText;
      row.append(swatch, label, values, ratio);
      tooltip.appendChild(row);
    }
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
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'pcr-legend-toggle-all';
  const allHidden = assets.every((asset) => visibilitySet.has(asset.label));
  toggle.textContent = allHidden ? 'Show All' : 'Hide All';
  toggle.title = allHidden ? `Show all ${category.label} assets` : `Hide all ${category.label} assets`;
  toggle.addEventListener('click', () => pcrSetAllAssets(category.id, assets, !allHidden));
  legend.appendChild(toggle);
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
  if (pcrFactionNote) pcrFactionNote.textContent = `Last 30 days · production ÷ consumption · ${message}`;
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
    const parts = ['Last 30 days', `Faction ${faction}`, 'production ÷ consumption'];
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

// Explicit per-faction starbase membership. The starbase measurement
// in InfluxDB has no faction tag, so we derive the faction from the
// starbase name. The mapping is NOT by prefix — MRZ-* starbases are
// split across all three factions, so we have to enumerate them.
const INV_FACTION_STARBASES = Object.freeze({
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
const INV_DEFAULT_METHOD = 'regression'; // two-point vs linear-regression slope
const invAssetVisibility = new Map(); // faction -> Set<assetLabel>

const invRefs = {
  starbaseSelect: null,
  factionNote: null,
  smallCards: {}, // id -> { wrap, summary }
  wideCard: { wrap: null, summary: null, legend: null },
  bars: { consumables: null, other: null },
  debugStrip: null,
};
let latestInventoryResult = null;
let invSelectedStarbase = '__all__';
let invMethod = INV_DEFAULT_METHOD;

// Per-faction Set of hidden asset labels. The same visibility selection
// follows the user while they switch between "All starbases" and individual
// starbases, so isolating Carbon stays isolated everywhere in that faction.
function invGetVisibility(faction) {
  if (!invAssetVisibility.has(faction)) invAssetVisibility.set(faction, new Set());
  return invAssetVisibility.get(faction);
}

function invGetBucketAssets(result, predicate) {
  if (!result?.ok) return [];
  return (Array.isArray(result.assets) ? result.assets : []).filter(predicate);
}

function invSetStarbaseOptions(starbases, current) {
  const select = invRefs.starbaseSelect;
  if (!select) return;
  select.textContent = '';
  // Faction-scoped filter: only show starbases that belong to the
  // active faction, and only those with actual inventory data.
  // The membership map is explicit (see INV_FACTION_STARBASES) —
  // MRZ-* starbases are split across all three factions, so we
  // can't use a prefix match.
  const faction = normalizeFaction(latestSettings?.faction);
  const membership = new Set(INV_FACTION_STARBASES[faction] || []);
  const filtered = (starbases || []).filter((sb) => membership.has(sb));
  const optAll = document.createElement('option');
  optAll.value = '__all__';
  optAll.textContent = 'All starbases';
  select.appendChild(optAll);
  for (const sb of filtered) {
    const opt = document.createElement('option');
    opt.value = sb;
    opt.textContent = sb;
    select.appendChild(opt);
  }
  // If the currently selected starbase doesn't belong to the active
  // faction (e.g. we just switched factions), fall back to __all__
  // so the dropdown shows a valid value and the cached data key
  // doesn't point at a starbase that's no longer in the list.
  select.value = filtered.includes(current) || current === '__all__' ? current : '__all__';
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
  if (invRefs.factionNote) invRefs.factionNote.textContent = `Last 30 days · inventory at starbase · ${message}`;
  if (invRefs.debugStrip) invRefs.debugStrip.textContent = `wide card: ${message} (empty state)`;
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
  let wrap = invRefs.wideCard.wrap;
  const summary = invRefs.wideCard && invRefs.wideCard.summary;
  const dbg = invRefs.debugStrip;
  const writeDbg = (msg) => { if (dbg) dbg.textContent = `wide card: ${msg}`; };
  // Lazy fallback: if initInventory's getElementById returned null
  // for some reason, try to find the element on the fly. This is the
  // most common reason the wide card is empty.
  if (!wrap) {
    wrap = document.getElementById('inv-all-assets-svg-wrap')
      || document.querySelector('[data-inv-category="all-assets"] .inv-chart-svg-wrap');
    if (wrap) {
      invRefs.wideCard.wrap = wrap;
      invRefs.wideCard.summary = invRefs.wideCard.summary
        || document.getElementById('inv-all-assets-summary');
      invRefs.wideCard.legend = invRefs.wideCard.legend
        || document.getElementById('inv-all-assets-legend');
      writeDbg('wrap recovered via lazy lookup, retrying');
      return invRenderWideCard(assets);
    }
    writeDbg('WRAP NULL and lazy lookup failed (element not in DOM)');
    if (summary) summary.textContent = 'WRAP NULL';
    return;
  }
  // Always-visible status: shows asset count and wrap dimensions so
  // we can see at a glance whether the wide card is rendering.
  const w = Math.round(wrap.clientWidth);
  const h = Math.round(wrap.clientHeight);
  writeDbg(`${assets.length} assets · wrap ${w}×${h}`);
  // If the wrap hasn't been laid out yet (0×0), wait for the next
  // animation frame and re-measure. This is the most likely cause of
  // the "wide card is empty" bug when the panel is first shown.
  if (w === 0 || h === 0) {
    writeDbg(`deferring (wrap 0×0) · ${assets.length} assets`);
    requestAnimationFrame(() => {
      if (wrap.clientWidth > 0 && wrap.clientHeight > 0) {
        invRenderWideCard(assets);
      } else {
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
    if (summary) summary.textContent = '0 assets';
    if (invRefs.wideCard.legend) invRefs.wideCard.legend.textContent = '';
    writeDbg('drawn with 0 assets (empty state shown in card)');
    return;
  }
  invRenderLineChart(wrap, null, { strokeWidth: 3, showAxis: true, color: '#fff' }, assets);
  if (summary) {
    summary.textContent = `${assets.length} asset${assets.length === 1 ? '' : 's'}`;
  }
  invRenderWideLegend(assets);
  writeDbg(`${assets.length} assets · wrap ${w}×${h}`);
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

  // Determine common X axis (day index 0..13) and Y range across the
  // assets that are actually visible. Hiding the big-ticket assets
  // shouldn't leave a small asset flat-lined at the bottom — the axis
  // resizes to whatever's on screen, so the line movement stays
  // visible no matter which combination of assets is selected.
  // The Y axis is always anchored at zero on the bottom and at the
  // (visible) max on the top, so we never auto-zoom away from zero.
  const numDays = assets[0].days.length;
  const xStep = numDays > 1 ? innerWidth / (numDays - 1) : 0;
  const faction = normalizeFaction(latestSettings?.faction);
  const visibility = invGetVisibility(faction);
  let maxY = 0;
  for (const a of assets) {
    if (visibility.has(a.label)) continue;
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

  // X axis day labels (every fifth day, plus first and last)
  for (let i = 0; i < numDays; i += 1) {
    if (i !== 0 && i !== numDays - 1 && i % 5 !== 0) continue;
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

  // Build a flat list of all points across all visible assets. The
  // hover handler uses this to find the closest data point to the
  // mouse and show its asset name + value in a tooltip.
  const allPoints = [];
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
      points.push({ x, y, day: d, asset, color });
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
    for (const p of points) allPoints.push(p);
  }

  // Hover overlay: vertical guideline + tooltip. Enabled for every
  // line chart (single-asset and multi-asset) so the user can see
  // the exact day + value at the cursor position.
  if (assets.length > 0) {
    invInstallHoverOverlay(wrap, allPoints, padding, innerWidth, innerHeight, height);
  }
}

function invInstallHoverOverlay(wrap, points, padding, innerWidth, innerHeight, height) {
  // Create the guide line and tooltip once and stash them on the wrap.
  // They're repositioned on mousemove and hidden on mouseleave.
  let guide = wrap.querySelector('.inv-hover-guide');
  if (!guide) {
    guide = document.createElement('div');
    guide.className = 'inv-hover-guide';
    wrap.appendChild(guide);
  }
  let tip = wrap.querySelector('.inv-hover-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'inv-hover-tooltip';
    wrap.appendChild(tip);
  }
  const show = () => { guide.style.display = 'block'; tip.style.display = 'block'; };
  const hide = () => { guide.style.display = 'none'; tip.style.display = 'none'; };

  wrap.onmousemove = (event) => {
    if (!points.length) return;
    const rect = wrap.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    // Clamp the x position to the inner chart area.
    if (mx < padding.left || mx > padding.left + innerWidth) {
      hide();
      return;
    }
    // Find the data point closest to the mouse (Euclidean distance).
    let best = null;
    let bestDist = Infinity;
    for (const p of points) {
      const dx = p.x - mx;
      const dy = p.y - my;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    if (!best) { hide(); return; }
    show();
    guide.style.left = `${best.x}px`;
    tip.textContent = '';
    const assetRow = document.createElement('div');
    assetRow.className = 'inv-hover-asset';
    const swatch = document.createElement('span');
    swatch.className = 'inv-hover-swatch';
    swatch.style.background = best.color;
    assetRow.appendChild(swatch);
    const assetLabel = document.createElement('span');
    assetLabel.textContent = best.asset.label;
    assetRow.appendChild(assetLabel);
    tip.appendChild(assetRow);
    const day = document.createElement('div');
    day.className = 'inv-hover-day';
    day.textContent = best.day.label;
    tip.appendChild(day);
    const value = document.createElement('div');
    value.className = 'inv-hover-value';
    value.textContent = invFormatInteger(best.day.value);
    tip.appendChild(value);
    // Position the tooltip near the point but keep it inside the wrap.
    const tipW = tip.offsetWidth || 140;
    const tipH = tip.offsetHeight || 60;
    let tipX = best.x + 12;
    if (tipX + tipW > rect.width) tipX = best.x - tipW - 12;
    let tipY = best.y - tipH - 8;
    if (tipY < 0) tipY = best.y + 12;
    tip.style.left = `${Math.max(4, tipX)}px`;
    tip.style.top = `${Math.max(4, tipY)}px`;
  };
  wrap.onmouseleave = hide;
}

function invRenderWideLegend(assets) {
  const legend = invRefs.wideCard.legend;
  if (!legend) return;
  legend.textContent = '';
  const faction = normalizeFaction(latestSettings?.faction);
  const visibility = invGetVisibility(faction);
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
      const set = invGetVisibility(faction);
      if (set.has(asset.label)) set.delete(asset.label);
      else set.add(asset.label);
      if (latestInventoryResult) renderInventory(latestInventoryResult);
    });
    legend.appendChild(chip);
  }

  // Select All / Hide All toggle. Sits at the end of the legend and
  // is visually distinct (accent background, no swatch) so it
  // doesn't get confused with an asset chip. If any asset is hidden
  // the button reads "Show All"; if everything is visible it reads
  // "Hide All". Clicking it clears or fills the visibility set in
  // one go, which is much faster than clicking 37 chips individually.
  const hiddenCount = assets.filter((a) => visibility.has(a.label)).length;
  const allVisible = hiddenCount === 0;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'inv-legend-toggle-all';
  toggle.textContent = allVisible ? 'Hide All' : 'Show All';
  toggle.title = allVisible
    ? 'Hide every asset line in the chart'
    : 'Show every asset line in the chart';
  toggle.addEventListener('click', () => {
    const set = invGetVisibility(faction);
    if (allVisible) {
      for (const a of assets) set.add(a.label);
    } else {
      for (const a of assets) set.delete(a.label);
    }
    if (latestInventoryResult) renderInventory(latestInventoryResult);
  });
  legend.appendChild(toggle);
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
    invRefs.factionNote.textContent = `Last 30 days · ${viewLabel}`;
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
  invRefs.debugStrip = document.getElementById('inv-debug-strip');

  // Lightweight init status: shows which refs were set. The
  // invRenderWideCard lazy lookup handles a missing wide-card ref
  // at render time, so we don't need to be loud about it here.
  if (invRefs.debugStrip) {
    invRefs.debugStrip.textContent = `init: select=${!!invRefs.starbaseSelect} `
      + `wide-wrap=${!!invRefs.wideCard.wrap} `
      + `bars=${!!invRefs.bars.consumables}/${!!invRefs.bars.other}`;
  }
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

function createConsumptionBarCard(asset, fallbackIndex, options = {}) {
  const maxValue = Math.max(...asset.days.map((day) => Number(day.value) || 0), 1);
  const actionLabel = options.actionLabel || 'consumed';
  const card = document.createElement('section');
  card.className = 'resource-card';

  const header = document.createElement('div');
  header.className = 'resource-card-header';
  const title = document.createElement('h3');
  title.className = 'resource-card-title';
  title.textContent = asset.label;
  const total = document.createElement('span');
  total.className = 'resource-card-total';
  total.textContent = options.headerRight || formatWholeNumber(asset.total);
  total.title = options.headerRight
    ? String(options.headerRightTitle || options.headerRight)
    : `${formatWholeNumber(asset.total)} over 30 days`;
  header.appendChild(title);
  header.appendChild(total);

  const bars = document.createElement('div');
  bars.className = 'resource-chart-bars';
  bars.setAttribute('aria-label', `${asset.label} ${actionLabel} over the last 30 days`);
  bars.appendChild(createYAxis(maxValue));
  for (const day of asset.days) {
    const value = Number(day.value) || 0;
    const height = Math.max(3, Math.round((value / maxValue) * 100));
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
  const context = getRefreshContext({
    starbaseFilter: selectedProductionStarbase,
    assetFilter: selectedProductionAsset,
  });
  const request = requestGuard.begin('production:daily', context);
  const cached = getCachedFilterResult(faction, 'production', selectedProductionStarbase, selectedProductionAsset);
  if (cached) {
    renderProductionCharts(cached);
  } else {
    renderProductionEmpty('Loading production data...');
  }
  try {
    const result = await api.getDailyProduction({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: context.starbaseFilter,
      assetFilter: context.assetFilter,
    });
    if (!requestGuard.isCurrent(request, getRefreshContext({
      starbaseFilter: selectedProductionStarbase,
      assetFilter: selectedProductionAsset,
    }))) return;
    renderProductionCharts(result);
  } catch (error) {
    console.error(error);
    if (requestGuard.isCurrent(request, getRefreshContext({
      starbaseFilter: selectedProductionStarbase,
      assetFilter: selectedProductionAsset,
    })) && !cached) renderProductionEmpty('Influx unavailable');
  }
}

async function refreshDailyCrafting() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderCraftingEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const context = getRefreshContext({
    starbaseFilter: selectedCraftingStarbase,
    recipeFilter: selectedCraftingRecipe,
  });
  const request = requestGuard.begin('crafting:daily', context);
  const cached = getCachedFilterResult(faction, 'crafting', selectedCraftingStarbase, selectedCraftingRecipe);
  if (cached) {
    renderCraftingCharts(cached);
  } else {
    renderCraftingEmpty('Loading crafting data...');
  }
  try {
    const result = await api.getDailyCrafting({
      ...(latestSettings || getFormPayload()),
      starbaseFilter: context.starbaseFilter,
      recipeFilter: context.recipeFilter,
    });
    if (!requestGuard.isCurrent(request, getRefreshContext({
      starbaseFilter: selectedCraftingStarbase,
      recipeFilter: selectedCraftingRecipe,
    }))) return;
    renderCraftingCharts(result);
  } catch (error) {
    console.error(error);
    if (requestGuard.isCurrent(request, getRefreshContext({
      starbaseFilter: selectedCraftingStarbase,
      recipeFilter: selectedCraftingRecipe,
    })) && !cached) renderCraftingEmpty('Influx unavailable');
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

function formatInfluxFailure(error) {
  const message = String(error || '');
  if (/timeout/i.test(message)) return 'timeout';
  const status = message.match(/influx_(?:flux|bucket_lookup)_(\d{3})/i)?.[1];
  if (status === '401' || status === '403') return 'authentication failed';
  if (status) return `HTTP ${status}`;
  return 'Influx request failed';
}

async function refreshDailySdu() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) {
    renderSduEmpty('Awaiting Influx connection');
    return;
  }

  const faction = normalizeFaction(latestSettings?.faction);
  const context = getRefreshContext({ fleetFilter: selectedScanningFleet });
  const request = requestGuard.begin('scanning:daily', context);
  const cached = getCachedFilterResult(faction, 'sdu', selectedScanningFleet);
  if (cached) {
    renderSduChart(cached);
  } else {
    renderSduEmpty('Loading SDU data...');
  }
  try {
    const payload = {
      ...(latestSettings || getFormPayload()),
      fleetFilter: context.fleetFilter,
    };
    const consumptionPromise = api.getDailySduConsumption(payload).catch((error) => ({
      ok: false,
      error: error?.message || String(error),
    }));
    const result = await api.getDailySdu(payload);
    if (!requestGuard.isCurrent(request, getRefreshContext({ fleetFilter: selectedScanningFleet }))) return;
    if (!result?.ok && cached) {
      renderSduChart(cached);
      const failure = formatInfluxFailure(result.error);
      setText(sduTotalNote, `Last updated ${formatCheckedAt(cached.checkedAt)} · ${failure}`);
      setText(scanningFleetNote, `Showing cached data · ${failure}`);
      return;
    }
    renderSduChart(result);

    const consumptionResult = await consumptionPromise;
    if (!requestGuard.isCurrent(request, getRefreshContext({ fleetFilter: selectedScanningFleet }))) return;
    if (!consumptionResult?.ok) {
      renderSduChart({
        ...result,
        warning: `SDU consumption unavailable: ${consumptionResult?.error || 'unknown error'}`,
      });
      return;
    }
    const consumption = consumptionResult.consumption;
    renderSduChart({
      ...result,
      consumption,
      surplus: result.selectedFleet || !consumption ? null : result.total - consumption.total,
      checkedAt: consumptionResult.checkedAt || result.checkedAt,
      timings: { ...result.timings, ...consumptionResult.timings },
    });
  } catch (error) {
    console.error(error);
    if (!requestGuard.isCurrent(request, getRefreshContext({ fleetFilter: selectedScanningFleet }))) return;
    if (cached) {
      renderSduChart(cached);
      const failure = formatInfluxFailure(error?.message || error);
      setText(sduTotalNote, `Last updated ${formatCheckedAt(cached.checkedAt)} · ${failure}`);
      setText(scanningFleetNote, `Showing cached data · ${failure}`);
    } else {
      renderSduEmpty('Influx unavailable');
    }
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
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  const settings = { ...(latestSettings || getFormPayload()), trigger: telemetryTrigger };
  const faction = normalizeFaction(settings.faction);
  if (!getActivePlayerProfile(settings)) {
    latestFleetResult = null;
    renderFleetEmpty(`No ${normalizeFaction(settings.faction)} player profile configured`);
    setFleetStatus('Awaiting player profile');
    return;
  }

  const cached = getCachedFactionResult(faction, 'fleet');
  if (cached) renderFleets(cached);
  setFleetStatus('Loading fleets from blockchain...');
  try {
    const result = await api.getFleets(settings);
    if (faction !== normalizeFaction((latestSettings || getFormPayload()).faction)) return;
    renderFleets(result);
  } catch (error) {
    console.error(error);
    if (faction !== normalizeFaction((latestSettings || getFormPayload()).faction)) return;
    if (cached) {
      renderFleets(cached);
      setFleetStatus(`Showing cached blockchain data from ${formatCheckedAt(cached.checkedAt)}`);
      return;
    }
    renderFleetEmpty('Fleet sync failed');
    setFleetStatus('Blockchain sync failed');
  }
}

function setEarningsStatus(message) {
  setText(earningsSyncStatus, message);
}

function setEarningsMiningStatus(message) {
  setText(earningsMiningSyncStatus, message);
}

function setEarningsCargoStatus(message) {
  setText(earningsCargoSyncStatus, message);
}

function setEarningsCraftingStatus(message) {
  setText(earningsCraftingSyncStatus, message);
}

function renderEarningsEmpty(message) {
  latestEarningsResult = null;
  renderEarningsHeader('scanning');
  renderEarningsNetProfitChart(null, new Map(), { target: earningsNetProfitChart, label: 'Scanning net profit by fleet in ATLAS by day' });
  setText(earningsSduPriceValue, '--');
  setText(earningsSduPriceNote, message);
  setText(earningsSduScanValue, '--');
  setText(earningsSduScanNote, message);
  setText(earningsSduValueValue, '--');
  setText(earningsSduValueNote, message);
  setText(earningsRentalValue, '--');
  setText(earningsRentalNote, message);
  if (!earningsTableBody) return;
  earningsTableBody.textContent = '';
  const row = document.createElement('tr');
  row.className = 'empty-row';
  const cell = document.createElement('td');
  cell.colSpan = getEarningsTableColSpan('scanning');
  cell.textContent = message;
  row.appendChild(cell);
  earningsTableBody.appendChild(row);
}

function renderEarningsMiningEmpty(message) {
  renderEarningsHeader('mining');
  renderEarningsNetProfitChart(null, new Map(), { target: earningsMiningNetProfitChart, label: 'Mining fleet net profit in ATLAS by day' });
  renderEarningsNetProfitChart(null, new Map(), { target: earningsMiningMaterialNetProfitChart, label: 'Mining raw material net profit in ATLAS by day' });
  renderEarningsNetProfitChart(null, new Map(), { target: earningsMiningStarbaseNetProfitChart, label: 'Mining starbase net profit in ATLAS by day' });
  setText(earningsMiningAmmoPriceValue, '--');
  setText(earningsMiningAmmoPriceNote, message);
  setText(earningsMiningMinedValue, '--');
  setText(earningsMiningMinedNote, message);
  setText(earningsMiningRevenueValue, '--');
  setText(earningsMiningRevenueNote, message);
  setText(earningsMiningRentalValue, '--');
  setText(earningsMiningRentalNote, message);
  if (!earningsMiningTableBody) return;
  earningsMiningTableBody.textContent = '';
  const row = document.createElement('tr');
  row.className = 'empty-row';
  const cell = document.createElement('td');
  cell.colSpan = getEarningsTableColSpan('mining');
  cell.textContent = message;
  row.appendChild(cell);
  earningsMiningTableBody.appendChild(row);
}

function renderEarningsCraftingEmpty(message) {
  renderEarningsHeader('crafting');
  renderEarningsNetProfitChart(null, new Map(), { target: earningsCraftingAssetNetProfitChart, label: 'Crafting net profit by asset in ATLAS by day' });
  renderEarningsNetProfitChart(null, new Map(), { target: earningsCraftingStarbaseNetProfitChart, label: 'Crafting net profit by starbase in ATLAS by day' });
  setText(earningsCraftingTopAssetValue, '--');
  setText(earningsCraftingTopAssetNote, message);
  setText(earningsCraftingBestNpValue, '--');
  setText(earningsCraftingBestNpNote, message);
  setText(earningsCraftingBestMarginValue, '--');
  setText(earningsCraftingBestMarginNote, message);
  setText(earningsCraftingBestRevenueValue, '--');
  setText(earningsCraftingBestRevenueNote, message);
  if (!earningsCraftingTableBody) return;
  earningsCraftingTableBody.textContent = '';
  const row = document.createElement('tr');
  row.className = 'empty-row';
  const cell = document.createElement('td');
  cell.colSpan = getEarningsTableColSpan('crafting');
  cell.textContent = message;
  row.appendChild(cell);
  earningsCraftingTableBody.appendChild(row);
}

function renderEarningsCargoEmpty(message) {
  renderEarningsHeader('cargo');
  renderEarningsNetProfitChart(null, new Map(), {
    target: earningsCargoNetProfitChart,
    label: 'Cargo fleet total costs in ATLAS by day',
    emptyLabel: 'No cargo cost data loaded',
    emptyValueLabel: 'No cargo cost values available',
  });
  renderEarningsCargoCostBreakdownChart({ rows: [] });
  if (!earningsCargoTableBody) return;
  earningsCargoTableBody.textContent = '';
  const row = document.createElement('tr');
  row.className = 'empty-row';
  const cell = document.createElement('td');
  cell.colSpan = getEarningsTableColSpan('cargo');
  cell.textContent = message;
  row.appendChild(cell);
  earningsCargoTableBody.appendChild(row);
}

function formatAtlas(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return `${formatDecimal(number, digits)} ATLAS`;
}

function formatAtlasNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return formatDecimal(number, digits);
}

function formatAtlasWhole(value) {
  return formatAtlasNumber(value, 0);
}

function formatPercentNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return `${formatDecimal(number, digits)}%`;
}

function getUtcDateKeyFromDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function getLastUtcDayLabels(dayCount = 14) {
  const today = new Date();
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: dayCount }, (_value, index) => {
    const offset = dayCount - 1 - index;
    const date = new Date(todayStart - offset * 24 * 60 * 60 * 1000);
    return {
      isoDate: getUtcDateKeyFromDate(date),
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    };
  });
}

function getEarningsFleetLabel(entry) {
  return String(entry?.fleetName || entry?.fleet || 'Unnamed fleet');
}

function getGeneratedFleetColor(index) {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} 82% 58%)`;
}

function buildEarningsFleetColorMap(rows, offset = 0, getLabel = getEarningsFleetLabel) {
  const names = Array.from(new Set((Array.isArray(rows) ? rows : []).map(getLabel).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  const map = new Map();
  names.forEach((name, index) => {
    const paletteIndex = index + offset;
    map.set(name, earningsFleetPalette[paletteIndex] || getGeneratedFleetColor(paletteIndex));
  });
  return map;
}

function buildEarningsAssetColorMap(rows, getLabel) {
  const names = Array.from(new Set((Array.isArray(rows) ? rows : []).map(getLabel).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  const map = new Map();
  names.forEach((name, index) => {
    map.set(name, getAssetChartColor(name, index + 8));
  });
  return map;
}

function getEarningsFleetColor(entry, colorMap, getLabel = getEarningsFleetLabel) {
  const label = getLabel(entry);
  return colorMap?.get(label) || earningsFleetPalette[0];
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function createColorCell(entry, colorMap) {
  const cell = document.createElement('td');
  const swatch = document.createElement('span');
  swatch.className = 'earnings-color-swatch';
  swatch.style.background = getEarningsFleetColor(entry, colorMap);
  swatch.title = getEarningsFleetLabel(entry);
  cell.appendChild(swatch);
  return cell;
}

function renderEarningsNetProfitChart(result, colorMap, options = {}) {
  const target = options.target || earningsNetProfitChart;
  if (!target) return;
  target.textContent = '';
  const getSegmentLabel = options.getSegmentLabel || getEarningsFleetLabel;
  const valueKey = options.valueKey || 'netProfitAtlas';
  const valueLabel = options.valueLabel || 'Net Profit';
  const emptyLabel = options.emptyLabel || 'No net profit data loaded';
  const emptyValueLabel = options.emptyValueLabel || 'No net profit values available';
  const mode = options.mode === 'perCrew' ? 'perCrew' : 'total';
  const getCrew = typeof options.getCrew === 'function' ? options.getCrew : null;
  const getCrewIdentity = typeof options.getCrewIdentity === 'function' ? options.getCrewIdentity : null;
  const isPerCrew = mode === 'perCrew' && !!getCrew;
  const effectiveValueLabel = isPerCrew ? (options.perCrewValueLabel || 'NP / Crew') : valueLabel;
  const effectiveYAxisLabel = isPerCrew
    ? (options.perCrewYAxisLabel || 'ATLAS / Crew')
    : (options.yAxisLabel || 'ATLAS');
  const effectiveEmptyValueLabel = isPerCrew
    ? (options.perCrewEmptyValueLabel || 'No per-crew values available')
    : emptyValueLabel;

  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'earnings-chart-empty';
    empty.textContent = emptyLabel;
    target.appendChild(empty);
    return;
  }

  // Build per-(day, segment) buckets. In total mode, segment.value
  // accumulates the row's numerator (e.g. netProfitAtlas) directly. In
  // per-crew mode, segment.numerator accumulates the sum and
  // segment.crew accumulates the deduplicated crew denominator; we
  // divide once after aggregation. Dedup key is getCrewIdentity(row)
  // (e.g. fleetName for Mining by Raw Material / Starbase) — so a
  // fleet that contributes to N material rows at one starbase counts
  // its crew once, not N times. When getCrewIdentity is null, crew
  // is summed across all rows (used when the per-row crew is already
  // pre-aggregated, e.g. Crafting where (date, starbase, output) is
  // a unique row).
  const days = getLastUtcDayLabels(14).map((day) => ({ ...day, positiveTotal: 0, negativeTotal: 0, segments: [] }));
  const dayByIso = new Map(days.map((day) => [day.isoDate, day]));
  for (const row of rows) {
    const day = dayByIso.get(row.isoDate);
    const numerator = Number(row[valueKey]);
    if (!day || !Number.isFinite(numerator) || numerator === 0) continue;
    const label = getSegmentLabel(row);
    if (!label) continue;
    let segment = day.segments.find((item) => item.fleet === label);
    if (!segment) {
      segment = {
        fleet: label,
        color: getEarningsFleetColor(row, colorMap, getSegmentLabel),
        numerator: 0,
        crew: 0,
        crewByIdentity: isPerCrew && getCrewIdentity ? new Map() : null,
      };
      day.segments.push(segment);
    }
    segment.numerator += numerator;
    if (isPerCrew) {
      const crew = Number(getCrew(row));
      if (Number.isFinite(crew) && crew > 0) {
        if (getCrewIdentity) {
          const identity = String(getCrewIdentity(row) || '');
          if (identity && !segment.crewByIdentity.has(identity)) {
            segment.crewByIdentity.set(identity, crew);
            segment.crew += crew;
          }
        } else {
          segment.crew += crew;
        }
      }
    }
  }
  for (const day of days) {
    for (const segment of day.segments) {
      segment.value = isPerCrew
        ? (segment.crew > 0 ? segment.numerator / segment.crew : 0)
        : segment.numerator;
    }
    if (isPerCrew) {
      // Drop segments that had no crew info — they would be misleading
      // in per-crew mode (division by zero / missing denominator).
      day.segments = day.segments.filter((segment) => segment.crew > 0);
    }
    day.positiveTotal = 0;
    day.negativeTotal = 0;
    for (const segment of day.segments) {
      if (segment.value > 0) day.positiveTotal += segment.value;
      else if (segment.value < 0) day.negativeTotal += segment.value;
    }
  }

  const maxPositive = Math.max(0, ...days.map((day) => day.positiveTotal));
  const maxNegative = Math.max(0, ...days.map((day) => Math.abs(day.negativeTotal)));
  if (maxPositive === 0 && maxNegative === 0) {
    const empty = document.createElement('div');
    empty.className = 'earnings-chart-empty';
    empty.textContent = effectiveEmptyValueLabel;
    target.appendChild(empty);
    return;
  }

  const niceCeil = (value) => {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    const scaled = value / power;
    const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return nice * power;
  };

  const width = 1040;
  const height = 320;
  const margin = { top: 18, right: 18, bottom: 42, left: 96 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const yMax = niceCeil(maxPositive);
  const yMin = maxNegative > 0 ? -niceCeil(maxNegative) : 0;
  const yRange = yMax - yMin || 1;
  const yScale = (value) => margin.top + ((yMax - value) / yRange) * plotHeight;
  const baselineY = yScale(0);
  const slotWidth = plotWidth / days.length;
  const barWidth = Math.min(40, slotWidth * 0.58);
  const svg = createSvgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': options.label || 'Fleets net profit in ATLAS by day',
  });

  const tickValues = Array.from({ length: 5 }, (_value, index) => yMin + (index * yRange) / 4);
  for (const tickValue of tickValues) {
    const y = yScale(tickValue);
    svg.appendChild(createSvgElement('line', {
      x1: margin.left,
      x2: width - margin.right,
      y1: y,
      y2: y,
      class: 'earnings-chart-gridline',
    }));
    const label = createSvgElement('text', {
      x: margin.left - 12,
      y: y + 4,
      class: 'earnings-chart-y-label',
      'text-anchor': 'end',
    });
    label.textContent = formatCompactNumber(tickValue);
    svg.appendChild(label);
  }

  const zeroLine = createSvgElement('line', {
    x1: margin.left,
    x2: width - margin.right,
    y1: baselineY,
    y2: baselineY,
    class: 'earnings-chart-zero-line',
  });
  svg.appendChild(zeroLine);

  days.forEach((day, index) => {
    const x = margin.left + index * slotWidth + (slotWidth - barWidth) / 2;
    let positiveStack = 0;
    let negativeStack = 0;
    const sortedSegments = day.segments.slice().sort((a, b) => a.fleet.localeCompare(b.fleet));
    for (const segment of sortedSegments) {
      const value = segment.value;
      const yStart = value >= 0 ? positiveStack : negativeStack;
      const yEnd = yStart + value;
      const y = value >= 0 ? yScale(yEnd) : yScale(yStart);
      const rectHeight = Math.max(1, Math.abs(yScale(yStart) - yScale(yEnd)));
      const rect = createSvgElement('rect', {
        x,
        y,
        width: barWidth,
        height: rectHeight,
        fill: segment.color,
        rx: 2,
        class: 'earnings-chart-segment',
        'data-fleet': segment.fleet,
        'data-net-profit': formatAtlasNumber(value, 0),
        'data-value-label': effectiveValueLabel,
      });
      const title = createSvgElement('title');
      title.textContent = `${segment.fleet}\n${effectiveValueLabel}: ${formatAtlasNumber(value, 0)}`;
      rect.appendChild(title);
      svg.appendChild(rect);
      if (value >= 0) positiveStack = yEnd;
      else negativeStack = yEnd;
    }

    const label = createSvgElement('text', {
      x: x + barWidth / 2,
      y: height - 14,
      class: 'earnings-chart-x-label',
      'text-anchor': 'middle',
    });
    label.textContent = day.label;
    svg.appendChild(label);
  });

  const yAxisLabel = createSvgElement('text', {
    x: 26,
    y: margin.top + plotHeight / 2,
    class: 'earnings-chart-axis-label',
    transform: `rotate(-90 26 ${margin.top + plotHeight / 2})`,
    'text-anchor': 'middle',
  });
  yAxisLabel.textContent = effectiveYAxisLabel;
  svg.appendChild(yAxisLabel);

  target.appendChild(svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'earnings-chart-tooltip';
  target.appendChild(tooltip);

  svg.addEventListener('mousemove', (event) => {
    const target = event.target?.closest?.('.earnings-chart-segment');
    if (!target) {
      tooltip.style.display = 'none';
      return;
    }
    tooltip.textContent = `${target.dataset.fleet || 'Fleet'}\n${target.dataset.valueLabel || effectiveValueLabel}: ${target.dataset.netProfit || '--'}`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top = `${event.clientY + 14}px`;
  });
  svg.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
}

function renderEarningsCargoCostBreakdownChart(result) {
  const target = earningsCargoCostBreakdownChart;
  if (!target) return;
  target.textContent = '';
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const days = getLastUtcDayLabels(14).map((day) => ({ ...day, txsCostsAtlas: 0, fuelCostsAtlas: 0 }));
  const dayByIso = new Map(days.map((day) => [day.isoDate, day]));
  for (const row of rows) {
    const day = dayByIso.get(row.isoDate);
    if (!day) continue;
    day.txsCostsAtlas += Number(row.txsCostsAtlas) || 0;
    day.fuelCostsAtlas += Number(row.fuelCostsAtlas) || 0;
  }
  const maxTotal = Math.max(0, ...days.map((day) => day.txsCostsAtlas + day.fuelCostsAtlas));
  if (maxTotal <= 0) {
    const empty = document.createElement('div');
    empty.className = 'earnings-chart-empty';
    empty.textContent = 'No cargo costs available';
    target.appendChild(empty);
    return;
  }

  const niceCeil = (value) => {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    const scaled = value / power;
    const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return nice * power;
  };

  const width = 1040;
  const height = 320;
  const margin = { top: 18, right: 18, bottom: 42, left: 96 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const yMax = niceCeil(maxTotal);
  const yScale = (value) => margin.top + ((yMax - value) / yMax) * plotHeight;
  const slotWidth = plotWidth / days.length;
  const barWidth = Math.min(40, slotWidth * 0.58);
  const svg = createSvgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Cargo total costs in ATLAS by day',
  });

  const tickValues = Array.from({ length: 5 }, (_value, index) => (index * yMax) / 4);
  for (const tickValue of tickValues) {
    const y = yScale(tickValue);
    svg.appendChild(createSvgElement('line', {
      x1: margin.left,
      x2: width - margin.right,
      y1: y,
      y2: y,
      class: 'earnings-chart-gridline',
    }));
    const label = createSvgElement('text', {
      x: margin.left - 12,
      y: y + 4,
      class: 'earnings-chart-y-label',
      'text-anchor': 'end',
    });
    label.textContent = formatCompactNumber(tickValue);
    svg.appendChild(label);
  }

  const segments = [
    { key: 'txsCostsAtlas', label: 'Txs Cost', color: '#22d3ee' },
    { key: 'fuelCostsAtlas', label: 'Fuel Cost', color: getAssetChartColor('Fuel', 3) },
  ];

  days.forEach((day, index) => {
    const x = margin.left + index * slotWidth + (slotWidth - barWidth) / 2;
    let stack = 0;
    for (const segment of segments) {
      const value = Number(day[segment.key]) || 0;
      if (value <= 0) continue;
      const yStart = yScale(stack);
      const yEnd = yScale(stack + value);
      const rect = createSvgElement('rect', {
        x,
        y: yEnd,
        width: barWidth,
        height: Math.max(1, yStart - yEnd),
        fill: segment.color,
        rx: 2,
        class: 'earnings-chart-segment',
        'data-fleet': segment.label,
        'data-net-profit': formatAtlasNumber(value, 0),
      });
      const title = createSvgElement('title');
      title.textContent = `${day.label}\n${segment.label}: ${formatAtlasNumber(value, 0)}`;
      rect.appendChild(title);
      svg.appendChild(rect);
      stack += value;
    }

    const label = createSvgElement('text', {
      x: x + barWidth / 2,
      y: height - 14,
      class: 'earnings-chart-x-label',
      'text-anchor': 'middle',
    });
    label.textContent = day.label;
    svg.appendChild(label);
  });

  const yAxisLabel = createSvgElement('text', {
    x: 26,
    y: margin.top + plotHeight / 2,
    class: 'earnings-chart-axis-label',
    transform: `rotate(-90 26 ${margin.top + plotHeight / 2})`,
    'text-anchor': 'middle',
  });
  yAxisLabel.textContent = 'ATLAS';
  svg.appendChild(yAxisLabel);
  target.appendChild(svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'earnings-chart-tooltip';
  target.appendChild(tooltip);
  svg.addEventListener('mousemove', (event) => {
    const hovered = event.target?.closest?.('.earnings-chart-segment');
    if (!hovered) {
      tooltip.style.display = 'none';
      return;
    }
    tooltip.textContent = `${hovered.dataset.fleet || 'Cost'}\nATLAS: ${hovered.dataset.netProfit || '--'}`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top = `${event.clientY + 14}px`;
  });
  svg.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
}

function aggregateShipsByName(fleet) {
  const ships = Array.isArray(fleet.ships) ? fleet.ships : [];
  if (!ships.length) return [];
  const byName = new Map();
  for (const ship of ships) {
    const name = ship.name || 'Unknown ship';
    const amount = Number(ship.amount) || 0;
    const existing = byName.get(name);
    if (existing) existing.amount += amount;
    else byName.set(name, { name, amount });
  }
  return Array.from(byName.values());
}

function describeFleetShips(fleet) {
  const ships = aggregateShipsByName(fleet);
  if (!ships.length) return 'No ship composition';
  return ships
    .slice(0, 2)
    .map((ship) => `${formatWholeNumber(ship.amount)}x ${ship.name}`)
    .join(', ') + (ships.length > 2 ? ` +${ships.length - 2}` : '');
}

function getFleetShipsDetail(fleet) {
  const ships = aggregateShipsByName(fleet);
  if (!ships.length) return 'No ship composition';
  return ships
    .map((ship) => `${formatWholeNumber(ship.amount)}x ${ship.name}`)
    .join('\n');
}

let shipsHoverTooltip = null;

function ensureShipsHoverTooltip() {
  if (shipsHoverTooltip) return shipsHoverTooltip;
  shipsHoverTooltip = document.createElement('div');
  shipsHoverTooltip.className = 'ships-hover-tooltip';
  document.body.appendChild(shipsHoverTooltip);
  return shipsHoverTooltip;
}

function createShipsCell(entry) {
  const cell = document.createElement('td');
  cell.className = 'ships-summary-cell';
  const summary = document.createElement('span');
  summary.className = 'ships-summary';
  summary.textContent = describeFleetShips(entry);
  cell.appendChild(summary);

  const detail = getFleetShipsDetail(entry);
  const moveTooltip = (event) => {
    const tooltip = ensureShipsHoverTooltip();
    tooltip.textContent = detail;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - 340)}px`;
    tooltip.style.top = `${Math.min(event.clientY + 14, window.innerHeight - 220)}px`;
  };
  cell.addEventListener('mouseenter', moveTooltip);
  cell.addEventListener('mousemove', moveTooltip);
  cell.addEventListener('mouseleave', () => {
    if (shipsHoverTooltip) shipsHoverTooltip.style.display = 'none';
  });
  return cell;
}

function getEarningsColumns(subtab = currentEarningsSubtab) {
  return earningsColumnsBySubtab[subtab] || scanningEarningsOptionalColumns;
}

function getActiveEarningsColumnsSubtab() {
  return currentEarningsSubtab === 'cargo' && activeCargoTable === 'allocation' ? 'cargoAllocation' : currentEarningsSubtab;
}

function getVisibleEarningsColumns(subtab = currentEarningsSubtab) {
  const selected = earningsColumnState[subtab] || earningsColumnState.scanning;
  if (subtab === 'cargoAllocation') {
    return CargoAllocationRenderer.getCargoAllocationVisibleColumns(getEarningsColumns(subtab), selected);
  }
  return getEarningsColumns(subtab).filter((column) => selected.has(column.id));
}

function getEarningsMetricGuideEntry(subtab, columnId) {
  return earningsMetricGuideBySubtab[subtab]?.[columnId] || earningsMetricGuideCommon[columnId] || null;
}

function renderEarningsMetricGuide(subtab = currentEarningsSubtab) {
  const container = document.querySelector(`#earnings-${subtab}-metric-guide`);
  if (!container) return;
  container.textContent = '';
  const guideColumns = subtab === 'breakeven'
    ? [...breakevenEarningsBaseColumns, ...getVisibleEarningsColumns(subtab)]
    : getVisibleEarningsColumns(subtab);
  for (const column of guideColumns) {
    const guide = getEarningsMetricGuideEntry(subtab, column.id);
    if (!guide) continue;
    const item = document.createElement('article');
    item.className = 'earnings-metric-guide-item';
    item.dataset.metricId = column.id;
    const title = document.createElement('h4');
    title.textContent = column.label;
    const description = document.createElement('p');
    description.textContent = guide[0];
    const formula = document.createElement('p');
    formula.className = 'earnings-metric-guide-formula';
    const formulaLabel = document.createElement('strong');
    formulaLabel.textContent = 'Formula: ';
    formula.append(formulaLabel, guide[1]);
    const interpretation = document.createElement('p');
    interpretation.textContent = guide[2];
    item.append(title, description, formula, interpretation);
    container.appendChild(item);
  }
}

function highlightEarningsMetricGuide(subtab, columnId) {
  const item = document.querySelector(`#earnings-${subtab}-metric-guide [data-metric-id="${columnId}"]`);
  if (!item) return;
  item.closest('details')?.setAttribute('open', '');
  item.classList.add('highlighted');
  window.setTimeout(() => item.classList.remove('highlighted'), 1800);
}

function getEarningsTableColSpan(subtab = currentEarningsSubtab) {
  const visibleColumns = getVisibleEarningsColumns(subtab);
  // Scanning/mining/cargo have 2 base columns (date + fleet);
  // crafting/upgrading have 3 (date + starbase + asset). Color counts
  // separately when visible (mining only).
  const baseCount = subtab === 'crafting' || subtab === 'upgrading' ? 3 : 2;
  return baseCount + visibleColumns.filter((column) => column.id !== 'color').length + (visibleColumns.some((column) => column.id === 'color') ? 1 : 0);
}

function renderEarningsColumnControls() {
  if (!earningsColumnControlsContainer) return;
  const activeSubtab = getActiveEarningsColumnsSubtab();
  const subtab = earningsColumnsBySubtab[activeSubtab] ? activeSubtab : 'scanning';
  const selected = earningsColumnState[subtab] || earningsColumnState.scanning;
  earningsColumnControlsContainer.textContent = '';
  for (const column of getEarningsColumns(subtab)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.earningsColumn = column.id;
    input.checked = selected.has(column.id);
    input.addEventListener('change', () => {
      if (input.checked) selected.add(column.id);
      else selected.delete(column.id);
      persistEarningsColumnState();
      renderEarningsMetricGuide(subtab);
      if (subtab === 'mining') {
        renderEarningsMining(latestEarningsResult);
      } else if (subtab === 'cargo') {
        renderEarningsCargo(latestEarningsResult);
      } else if (subtab === 'cargoAllocation') {
        renderEarningsCargoAllocations(latestEarningsResult);
      } else if (subtab === 'crafting') {
        renderEarningsCrafting(latestEarningsResult);
      } else if (subtab === 'breakeven') {
        renderEarningsBreakeven(latestBreakevenResult);
      } else if (subtab === 'marketplace') {
        renderEarningsMarketplace(latestEarningsResult);
      } else if (latestEarningsResult) {
        renderEarnings(latestEarningsResult);
      } else {
        renderEarningsHeader('scanning');
      }
    });
    label.appendChild(input);
    label.append(` ${column.label}`);
    earningsColumnControlsContainer.appendChild(label);
  }
  earningsColumnControls = Array.from(earningsColumnControlsContainer.querySelectorAll('[data-earnings-column]'));
  renderEarningsMetricGuide(subtab);
}

function compareEarningsValues(a, b, direction) {
  const aNull = a == null || a === '';
  const bNull = b == null || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  let result;
  if (typeof a === 'number' && typeof b === 'number') result = a - b;
  else result = String(a).localeCompare(String(b));
  return direction === 'desc' ? -result : result;
}

function getEarningsRowsForSubtab(subtab) {
  if (!latestEarningsResult?.ok) return [];
  const key = earningsRowsKeyBySubtab[subtab];
  return Array.isArray(latestEarningsResult[key]) ? latestEarningsResult[key] : [];
}

function populateEarningsFilterOptions(subtab, rows) {
  const filters = earningsFilterBarBySubtab[subtab]?.();
  if (!filters) return;
  const dates = new Set();
  const fleets = new Set();
  const materials = new Set();
  const starbases = new Set();
  const assets = new Set();
  const assignments = new Set();
  const sources = new Set();
  for (const row of rows) {
    if (row.isoDate) dates.add(row.isoDate);
    const fleet = row.fleetName || row.fleet;
    if (fleet) fleets.add(fleet);
    if (row.rawMaterial) materials.add(row.rawMaterial);
    if (row.starbase) starbases.add(row.starbase);
    if (row.output || row.asset) assets.add(row.output || row.asset);
    if (row.assignment) assignments.add(row.assignment);
    if (row.source) sources.add(row.source);
  }
  const sortedDates = Array.from(dates).sort((a, b) => b.localeCompare(a));
  const sortedFleets = Array.from(fleets).sort((a, b) => String(a).localeCompare(String(b)));
  const sortedMaterials = Array.from(materials).sort((a, b) => String(a).localeCompare(String(b)));
  const sortedStarbases = Array.from(starbases).sort((a, b) => String(a).localeCompare(String(b)));
  const sortedAssets = Array.from(assets).sort((a, b) => String(a).localeCompare(String(b)));
  const sortedAssignments = Array.from(assignments).sort((a, b) => String(a).localeCompare(String(b)));
  const sortedSources = Array.from(sources).sort((a, b) => String(a).localeCompare(String(b)));
  const fillSelect = (select, values, defaultLabel) => {
    if (!select) return;
    const current = earningsFilters[subtab] && select.dataset.filterKey ? earningsFilters[subtab][select.dataset.filterKey] : '';
    select.textContent = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = defaultLabel;
    select.appendChild(allOption);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    if (current && values.includes(current)) select.value = current;
  };
  fillSelect(filters.date, sortedDates, 'All Dates');
  fillSelect(filters.fleet, sortedFleets, 'All Fleets');
  if ((subtab === 'scanning' || subtab === 'mining' || subtab === 'cargo' || subtab === 'cargoAllocation') && filters.fleet) {
    const totalOption = document.createElement('option');
    totalOption.value = EARNINGS_TOTAL_FLEETS_FILTER;
    totalOption.textContent = 'Total';
    filters.fleet.insertBefore(totalOption, filters.fleet.options[1] || null);
    if (earningsFilters[subtab].fleet === EARNINGS_TOTAL_FLEETS_FILTER) filters.fleet.value = EARNINGS_TOTAL_FLEETS_FILTER;
  }
  fillSelect(filters.rawMaterial, sortedMaterials, 'All Materials');
  fillSelect(filters.starbase, sortedStarbases, 'All Starbases');
  fillSelect(filters.asset, sortedAssets, 'All Assets');
  if (subtab === 'cargoAllocation' && filters.asset) {
    const totalOption = document.createElement('option');
    totalOption.value = EARNINGS_TOTAL_ASSETS_FILTER;
    totalOption.textContent = 'Total';
    filters.asset.insertBefore(totalOption, filters.asset.options[1] || null);
    if (earningsFilters[subtab].asset === EARNINGS_TOTAL_ASSETS_FILTER) filters.asset.value = EARNINGS_TOTAL_ASSETS_FILTER;
  }
  fillSelect(filters.assignment, sortedAssignments, 'All Assignments');
  fillSelect(filters.source, sortedSources, 'All Sources');
}

function getFilteredEarningsRows(subtab, rows) {
  const filterState = earningsFilters[subtab] || {};
  if (subtab === 'cargoAllocation') {
    const filtered = CargoAllocationRenderer.filterCargoAllocationRows(rows, {
      date: filterState.date,
      fleet: filterState.fleet === EARNINGS_TOTAL_FLEETS_FILTER ? '' : filterState.fleet,
      asset: filterState.asset === EARNINGS_TOTAL_ASSETS_FILTER ? '' : filterState.asset,
    });
    return filtered.filter((row) => {
      if (filterState.assignment && row.assignment !== filterState.assignment) return false;
      if (filterState.source && row.source !== filterState.source) return false;
      return true;
    });
  }
  return rows.filter((row) => {
    if (filterState.date && row.isoDate !== filterState.date) return false;
    const fleet = row.fleetName || row.fleet;
    if (filterState.fleet && filterState.fleet !== EARNINGS_TOTAL_FLEETS_FILTER && fleet !== filterState.fleet) return false;
    if (filterState.rawMaterial && row.rawMaterial !== filterState.rawMaterial) return false;
    if (filterState.starbase && row.starbase !== filterState.starbase) return false;
    if (filterState.asset && filterState.asset !== EARNINGS_TOTAL_ASSETS_FILTER && (row.output || row.asset) !== filterState.asset) return false;
    if (filterState.assignment && row.assignment !== filterState.assignment) return false;
    if (filterState.source && row.source !== filterState.source) return false;
    if (subtab === 'breakeven' && filterState.hideLowInventory && Number(row.inventory) <= 2) return false;
    return true;
  });
}

function sumFiniteEarningsFields(target, rows, fields) {
  for (const field of fields) {
    const values = rows
      .map((row) => row[field])
      .filter((value) => value != null && Number.isFinite(Number(value)))
      .map(Number);
    target[field] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
}

function aggregateTotalFleetRows(subtab, rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = subtab === 'mining' ? `${row.isoDate}\n${row.rawMaterial}` : row.isoDate;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Array.from(groups.values()).map((groupRows) => {
    const first = groupRows[0];
    const total = {
      ...first,
      isFleetTotal: true,
      fleet: 'Total',
      fleetName: 'Total',
      fleetAccount: '',
      ownership: '',
      relationship: 'total',
      ships: [],
      shipTypes: 0,
      starbase: subtab === 'mining' ? '--' : first.starbase,
    };
    const commonFields = [
      'revenueAtlasPerDay', 'foodCostsAtlas', 'fuelCostsAtlas', 'rentalRateAtlasPerDay',
      'txsCostsAtlas', 'totalCostsAtlas', 'netProfitAtlas', 'totalRequiredCrew',
    ];
    if (subtab === 'scanning') {
      sumFiniteEarningsFields(total, groupRows, [
        ...commonFields, 'expectedSduPerScan', 'expectedSduValueAtl', 'scanAttempts',
        'successfulScans', 'sduFound',
      ]);
      total.scanSuccessRatePercent = total.scanAttempts > 0 ? (total.successfulScans / total.scanAttempts) * 100 : null;
      const chanceWeight = groupRows.reduce((sum, row) => sum + (Number(row.scanAttempts) || 0), 0);
      total.averageChancePercent = chanceWeight > 0
        ? groupRows.reduce((sum, row) => sum + (Number(row.averageChancePercent) || 0) * (Number(row.scanAttempts) || 0), 0) / chanceWeight
        : null;
      total.costsPerUnitAtlas = total.sduFound > 0 && Number.isFinite(total.totalCostsAtlas)
        ? total.totalCostsAtlas / total.sduFound
        : null;
    } else {
      sumFiniteEarningsFields(total, groupRows, [...commonFields, 'txsDaily', 'mined', 'ammoCostsAtlas']);
      total.costsPerUnitAtlas = total.mined > 0 && Number.isFinite(total.totalCostsAtlas)
        ? total.totalCostsAtlas / total.mined
        : null;
    }
    total.netProfitPerCrew = total.totalRequiredCrew > 0 && Number.isFinite(total.netProfitAtlas)
      ? total.netProfitAtlas / total.totalRequiredCrew
      : null;
    total.profitMarginPercent = total.revenueAtlasPerDay !== 0 && Number.isFinite(total.revenueAtlasPerDay) && Number.isFinite(total.netProfitAtlas)
      ? (total.netProfitAtlas / total.revenueAtlasPerDay) * 100
      : null;
    return total;
  });
}

function aggregateTotalCargoRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.isoDate)) groups.set(row.isoDate, []);
    groups.get(row.isoDate).push(row);
  }
  return Array.from(groups.values()).map((groupRows) => {
    const first = groupRows[0];
    const total = {
      ...first,
      isFleetTotal: true,
      fleet: 'Total',
      fleetName: 'Total',
      fleetAccount: '',
      ownership: '',
      relationship: 'total',
      ships: [],
      shipTypes: 0,
      assignment: new Set(groupRows.map((row) => row.assignment).filter(Boolean)).size === 1 ? first.assignment : 'Mixed',
      travelModeTime: null,
      travelModeWarpPercent: null,
      starbases: Array.from(new Set(groupRows.flatMap((row) => row.starbases || []))).sort(),
    };
    total.starbaseLabel = total.starbases.length ? total.starbases.join(', ') : '--';
    sumFiniteEarningsFields(total, groupRows, [
      'txsDaily', 'cargoCycles', 'cargoLegs', 'fuelCostsAtlas', 'txsCostsAtlas',
      'totalCostsAtlas', 'cargoVolume', 'cargoCapacity',
    ]);
    total.txsCostsPercent = total.totalCostsAtlas > 0 && Number.isFinite(total.txsCostsAtlas)
      ? (total.txsCostsAtlas / total.totalCostsAtlas) * 100
      : null;
    total.cargoEfficiencyPercent = total.cargoCapacity > 0 && Number.isFinite(total.cargoVolume)
      ? (total.cargoVolume / total.cargoCapacity) * 100
      : null;
    return total;
  });
}

function aggregateTotalCargoAllocationRows(rows, { totalFleet = false, totalAsset = false } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.isoDate, totalFleet ? '' : (row.fleetName || row.fleet), totalAsset ? '' : row.asset].join('\n');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Array.from(groups.values()).map((groupRows) => {
    const first = groupRows[0];
    const uniqueValue = (field, fallback = 'Mixed') => {
      const values = Array.from(new Set(groupRows.map((row) => row[field]).filter(Boolean)));
      return values.length === 1 ? values[0] : fallback;
    };
    const total = {
      ...first,
      fleet: totalFleet ? 'Total' : first.fleet,
      fleetName: totalFleet ? 'Total' : (first.fleetName || first.fleet),
      fleetAccount: totalFleet ? '' : first.fleetAccount,
      asset: totalAsset ? 'Total' : first.asset,
      origin: uniqueValue('origin'),
      destination: uniqueValue('destination'),
      assignment: uniqueValue('assignment'),
      ownership: totalFleet ? '' : first.ownership,
      relationship: totalFleet ? 'total' : first.relationship,
      ships: totalFleet ? [] : first.ships,
      shipTypes: totalFleet ? 0 : first.shipTypes,
    };
    sumFiniteEarningsFields(total, groupRows, [
      'amount', 'cargoVolume', 'allocatedFuel', 'fuelCostsAtlas', 'txsCostsAtlas', 'totalCostsAtlas',
    ]);
    total.costsPerUnitAtlas = total.amount > 0 && Number.isFinite(total.totalCostsAtlas)
      ? total.totalCostsAtlas / total.amount
      : null;
    return total;
  });
}

function sortEarningsRows(subtab, rows) {
  const sortState = earningsSort[subtab];
  if (!sortState || !sortState.column || !sortState.direction) return rows;
  const getValue = (row) => {
    if (subtab === 'breakeven' && sortState.column === 'asset') return row.asset;
    if (subtab === 'breakeven' && sortState.column === 'fuelCost') {
      const values = [row.baseFuelCostPerUnit, row.cargoFuelCostPerUnit].filter((value) => value != null && Number.isFinite(Number(value)));
      return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
    }
    if (subtab === 'breakeven' && sortState.column === 'txsCost') {
      const values = [row.baseTxsCostPerUnit, row.cargoTxsCostPerUnit].filter((value) => value != null && Number.isFinite(Number(value)));
      return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
    }
    const sortKey = earningsSortKeyByColumnId[sortState.column] || sortState.column;
    return row?.[sortKey];
  };
  return rows.slice().sort((a, b) => compareEarningsValues(getValue(a), getValue(b), sortState.direction));
}

function setupEarningsFilterHandlers() {
  const wire = (subtab, select, key) => {
    if (!select) return;
    select.dataset.filterKey = key;
    select.addEventListener('change', () => {
      earningsFilters[subtab][key] = select.value;
      if (subtab === 'mining') renderEarningsMining(latestEarningsResult);
      else if (subtab === 'cargo') renderEarningsCargo(latestEarningsResult);
      else if (subtab === 'cargoAllocation') renderEarningsCargoAllocations(latestEarningsResult);
      else if (subtab === 'crafting') renderEarningsCrafting(latestEarningsResult);
      else if (subtab === 'breakeven') renderEarningsBreakeven(latestBreakevenResult);
      else if (latestEarningsResult) renderEarnings(latestEarningsResult);
    });
  };
  wire('scanning', earningsScanningDateFilter, 'date');
  wire('scanning', earningsScanningFleetFilter, 'fleet');
  wire('mining', earningsMiningDateFilter, 'date');
  wire('mining', earningsMiningFleetFilter, 'fleet');
  wire('mining', earningsMiningMaterialFilter, 'rawMaterial');
  wire('cargo', earningsCargoDateFilter, 'date');
  wire('cargo', earningsCargoFleetFilter, 'fleet');
  wire('cargoAllocation', earningsCargoAllocationDateFilter, 'date');
  wire('cargoAllocation', earningsCargoAllocationFleetFilter, 'fleet');
  wire('cargoAllocation', earningsCargoAllocationAssetFilter, 'asset');
  wire('crafting', earningsCraftingDateFilter, 'date');
  wire('crafting', earningsCraftingStarbaseFilter, 'starbase');
  wire('crafting', earningsCraftingAssetFilter, 'asset');
  wire('upgrading', earningsUpgradingDateFilter, 'date');
  wire('upgrading', earningsUpgradingStarbaseFilter, 'starbase');
  wire('upgrading', earningsUpgradingAssetFilter, 'asset');
  wire('breakeven', earningsBreakevenStarbaseFilter, 'starbase');
  wire('breakeven', earningsBreakevenAssetFilter, 'asset');
  earningsBreakevenHideLowInventory?.addEventListener('change', () => {
    earningsFilters.breakeven.hideLowInventory = earningsBreakevenHideLowInventory.checked;
    renderEarningsBreakeven(latestBreakevenResult);
  });
}

// Apply the active state on every Total / Per Crew button inside
// the given earnings subtab so the segmented switch visually matches
// earningsChartMode[subtab].
function applyEarningsChartModeState(subtab) {
  const mode = earningsChartMode[subtab] || 'total';
  const panel = document.querySelector(`.earnings-panel[data-earnings-panel="${subtab}"]`);
  if (!panel) return;
  panel.querySelectorAll('[data-earnings-chart-mode]').forEach((button) => {
    if (button.dataset.earningsChartMode === mode) button.classList.add('active');
    else button.classList.remove('active');
  });
}

// Switch the chart mode for a whole earnings subtab and re-render its
// NP chart panels. Used by the Total / Per Crew click handler.
function setEarningsChartMode(subtab, mode) {
  if (mode !== 'total' && mode !== 'perCrew') return;
  earningsChartMode[subtab] = mode;
  applyEarningsChartModeState(subtab);
  if (!latestEarningsResult
      && !(subtab === 'breakeven' && latestBreakevenResult)
      && !(subtab === 'upgrading' && latestUpgradingResult)) return;
  if (subtab === 'mining') renderEarningsMining(latestEarningsResult);
  else if (subtab === 'crafting') renderEarningsCrafting(latestEarningsResult);
  else if (subtab === 'upgrading') renderEarningsUpgrading(latestUpgradingResult);
  else if (subtab === 'breakeven') renderEarningsBreakeven(latestBreakevenResult);
  else renderEarnings(latestEarningsResult);
}

function setupEarningsHeaderSortHandlers() {
  const handle = (head, subtab) => {
    if (!head) return;
    head.addEventListener('click', (event) => {
      const th = event.target.closest('th[data-sort-id]');
      if (!th) return;
      const columnId = th.dataset.sortId;
      const current = earningsSort[subtab];
      if (current.column !== columnId) {
        current.column = columnId;
        current.direction = 'desc';
      } else if (current.direction === 'desc') {
        current.direction = 'asc';
      } else {
        current.column = null;
        current.direction = null;
      }
      if (subtab === 'mining') renderEarningsMining(latestEarningsResult);
      else if (subtab === 'cargo') renderEarningsCargo(latestEarningsResult);
      else if (subtab === 'crafting') renderEarningsCrafting(latestEarningsResult);
      else if (subtab === 'breakeven') renderEarningsBreakeven(latestBreakevenResult);
      else if (latestEarningsResult) renderEarnings(latestEarningsResult);
      else renderEarningsHeader(subtab);
      highlightEarningsMetricGuide(subtab, columnId);
    });
  };
  handle(earningsTableHead, 'scanning');
  handle(earningsMiningTableHead, 'mining');
  handle(earningsCargoTableHead, 'cargo');
  handle(earningsCraftingTableHead, 'crafting');
  handle(earningsUpgradingTableHead, 'upgrading');
  handle(earningsBreakevenTableHead, 'breakeven');
}

function appendEarningsHeaderCell(row, columnId, label, sortState) {
  const th = document.createElement('th');
  th.scope = 'col';
  th.dataset.sortId = columnId;
  th.classList.add('earnings-sortable-th');
  const isActive = sortState && sortState.column === columnId && sortState.direction;
  if (isActive) th.classList.add('earnings-sort-active');
  const labelSpan = document.createElement('span');
  labelSpan.className = 'earnings-header-label';
  labelSpan.textContent = label;
  th.appendChild(labelSpan);
  const arrow = document.createElement('span');
  arrow.className = 'earnings-sort-arrow';
  arrow.textContent = isActive ? (sortState.direction === 'desc' ? '\u25BC' : '\u25B2') : '';
  th.appendChild(arrow);
  row.appendChild(th);
}

function renderEarningsHeader(subtab = 'scanning') {
  const tableHead = subtab === 'mining'
    ? earningsMiningTableHead
    : subtab === 'cargo'
      ? earningsCargoTableHead
      : subtab === 'crafting'
        ? earningsCraftingTableHead
        : subtab === 'upgrading'
          ? earningsUpgradingTableHead
          : earningsTableHead;
  if (!tableHead) return;
  const row = document.createElement('tr');
  const visibleColumns = getVisibleEarningsColumns(subtab);
  const colorColumnVisible = visibleColumns.some((column) => column.id === 'color');
  const sortState = earningsSort[subtab] || { column: null, direction: null };
  appendEarningsHeaderCell(row, 'date', 'Date', sortState);
  // Crafting has no fleet — its base columns are Starbase and Output
  // (matches renderEarningsCrafting's body, which appends starbase +
  // output as the 2nd and 3rd cells). Other subtabs use Fleet (and
  // optional Color for scanning/mining).
  if (subtab === 'crafting' || subtab === 'upgrading') {
    appendEarningsHeaderCell(row, 'starbase', 'Starbase', sortState);
    appendEarningsHeaderCell(row, 'output', 'Asset', sortState);
  } else {
    if (colorColumnVisible) appendEarningsHeaderCell(row, 'color', 'Color', sortState);
    appendEarningsHeaderCell(row, 'fleet', 'Fleet', sortState);
  }
  for (const column of visibleColumns.filter((column) => column.id !== 'color')) {
    let label = column.label;
    if (earningsCostBasisMode[subtab] === 'external' && column.id === 'ingCosts') label = 'Ingredient External Value';
    if (earningsCostBasisMode[subtab] === 'external' && column.id === 'upgCosts') label = 'Component External Value';
    appendEarningsHeaderCell(row, column.id, label, sortState);
  }
  tableHead.textContent = '';
  tableHead.appendChild(row);
}

function createEarningsFleetCell(entry) {
  const cell = document.createElement('td');
  const name = document.createElement('strong');
  name.textContent = entry.fleetName || entry.fleet || 'Unnamed fleet';
  cell.appendChild(name);
  return cell;
}

function createOwnershipCell(entry) {
  if (entry.isFleetTotal) return createTextCell('--');
  const cell = document.createElement('td');
  const ownership = document.createElement('span');
  ownership.className = entry.relationship === 'managed' ? 'state-pill warning' : 'state-pill ready';
  ownership.textContent = entry.ownership || 'Owned';
  cell.appendChild(ownership);
  return cell;
}

function createEarningsOptionalCell(entry, columnId, colorMap) {
  if (entry.isFleetTotal && (columnId === 'color' || columnId === 'ships' || columnId === 'account')) return createTextCell('--');
  if (columnId === 'color') return createColorCell(entry, colorMap);
  if (columnId === 'ownership') return createOwnershipCell(entry);
  if (columnId === 'rental') return createTextCell(entry.rentalRateAtlasPerDay == null ? '--' : formatAtlasNumber(entry.rentalRateAtlasPerDay, 2));
  if (columnId === 'ships') return createShipsCell(entry);
  if (columnId === 'requiredCrew') return createTextCell(entry.totalRequiredCrew == null ? '--' : formatWholeNumber(entry.totalRequiredCrew));
  if (columnId === 'sduMax') return createTextCell(entry.expectedSduPerScan == null ? '--' : formatWholeNumber(entry.expectedSduPerScan));
  if (columnId === 'atlasPerScan') return createTextCell(entry.expectedSduValueAtl == null ? '--' : formatAtlasNumber(entry.expectedSduValueAtl, 2));
  if (columnId === 'scanAttempts') return createTextCell(formatWholeNumber(entry.scanAttempts || 0));
  if (columnId === 'successfulScans') return createTextCell(formatWholeNumber(entry.successfulScans || 0));
  if (columnId === 'scanSuccessRate') return createTextCell(formatPercentNumber(entry.scanSuccessRatePercent, 1));
  if (columnId === 'averageChance') return createTextCell(formatPercentNumber(entry.averageChancePercent, 1));
  if (columnId === 'sduFound') return createTextCell(formatWholeNumber(entry.sduFound || 0));
  if (columnId === 'revenue') return createTextCell(entry.revenueAtlasPerDay == null ? '--' : formatAtlasWhole(entry.revenueAtlasPerDay));
  if (columnId === 'foodCosts') return createTextCell(entry.foodCostsAtlas == null ? '--' : formatAtlasWhole(entry.foodCostsAtlas));
  if (columnId === 'fuelCosts') return createTextCell(entry.fuelCostsAtlas == null ? '--' : formatAtlasWhole(entry.fuelCostsAtlas));
  if (columnId === 'txsCosts') return createTextCell(entry.txsCostsAtlas == null ? '--' : formatAtlasWhole(entry.txsCostsAtlas));
  if (columnId === 'totalCosts') return createTextCell(entry.totalCostsAtlas == null ? '--' : formatAtlasWhole(entry.totalCostsAtlas));
  if (columnId === 'netProfit') return createTextCell(entry.netProfitAtlas == null ? '--' : formatAtlasWhole(entry.netProfitAtlas));
  if (columnId === 'npPerCrew') return createTextCell(entry.netProfitPerCrew == null ? '--' : formatAtlasWhole(entry.netProfitPerCrew));
  if (columnId === 'profitMargin') return createTextCell(entry.profitMarginPercent == null ? '--' : formatPercentNumber(entry.profitMarginPercent, 1));
  if (columnId === 'costsPerUnit') return createTextCell(entry.costsPerUnitAtlas == null ? '--' : formatAtlasNumber(entry.costsPerUnitAtlas, 6));
  if (columnId === 'account') return createAccountCell(entry.fleetAccount);
  return createTextCell('--');
}

function createMiningEarningsOptionalCell(entry, columnId, colorMap) {
  if (entry.isFleetTotal && (columnId === 'color' || columnId === 'ships' || columnId === 'account')) return createTextCell('--');
  if (columnId === 'color') return createColorCell(entry, colorMap);
  if (columnId === 'ownership') return createOwnershipCell(entry);
  if (columnId === 'ships') return createShipsCell(entry);
  if (columnId === 'requiredCrew') return createTextCell(entry.totalRequiredCrew == null ? '--' : formatWholeNumber(entry.totalRequiredCrew));
  if (columnId === 'txsDaily') return createTextCell(entry.txsDaily == null ? 'N/A' : formatWholeNumber(entry.txsDaily));
  if (columnId === 'starbase') return createTextCell(entry.starbase);
  if (columnId === 'rawMaterial') return createTextCell(entry.rawMaterial);
  if (columnId === 'mined') return createTextCell(formatWholeNumber(entry.mined || 0));
  if (columnId === 'revenue') return createTextCell(entry.revenueAtlasPerDay == null ? '--' : formatAtlasWhole(entry.revenueAtlasPerDay));
  if (columnId === 'ammoCosts') return createTextCell(entry.ammoCostsAtlas == null ? '--' : formatAtlasWhole(entry.ammoCostsAtlas));
  if (columnId === 'foodCosts') return createTextCell(entry.foodCostsAtlas == null ? '--' : formatAtlasWhole(entry.foodCostsAtlas));
  if (columnId === 'fuelCosts') return createTextCell(entry.fuelCostsAtlas == null ? '--' : formatAtlasWhole(entry.fuelCostsAtlas));
  if (columnId === 'rental') return createTextCell(entry.rentalRateAtlasPerDay == null ? '--' : formatAtlasNumber(entry.rentalRateAtlasPerDay, 2));
  if (columnId === 'txsCosts') return createTextCell(entry.txsCostsAtlas == null ? '--' : formatAtlasWhole(entry.txsCostsAtlas));
  if (columnId === 'totalCosts') return createTextCell(entry.totalCostsAtlas == null ? '--' : formatAtlasWhole(entry.totalCostsAtlas));
  if (columnId === 'netProfit') return createTextCell(entry.netProfitAtlas == null ? '--' : formatAtlasWhole(entry.netProfitAtlas));
  if (columnId === 'npPerCrew') return createTextCell(entry.netProfitPerCrew == null ? '--' : formatAtlasWhole(entry.netProfitPerCrew));
  if (columnId === 'profitMargin') return createTextCell(entry.profitMarginPercent == null ? '--' : formatPercentNumber(entry.profitMarginPercent, 1));
  if (columnId === 'costsPerUnit') return createTextCell(entry.costsPerUnitAtlas == null ? '--' : formatAtlasNumber(entry.costsPerUnitAtlas, 6));
  if (columnId === 'account') return createAccountCell(entry.fleetAccount);
  return createTextCell('--');
}

function createCraftingEarningsOptionalCell(entry, columnId, colorMap) {
  if (columnId === 'txsDaily') return createTextCell(formatWholeNumber(entry.txsDaily || 0));
  if (columnId === 'crafted') return createTextCell(formatWholeNumber(entry.crafted || 0));
  if (columnId === 'crew') return createTextCell(entry.crew == null ? '--' : formatWholeNumber(entry.crew));
  if (columnId === 'revenue') return createTextCell(entry.revenueAtlasPerDay == null ? '--' : formatAtlasWhole(entry.revenueAtlasPerDay));
  if (columnId === 'ingCosts') return createTextCell(entry.ingCostsAtlas == null ? '--' : formatAtlasWhole(entry.ingCostsAtlas));
  if (columnId === 'feeCosts') return createTextCell(entry.feeCostsAtlas == null ? '--' : formatAtlasWhole(entry.feeCostsAtlas));
  if (columnId === 'txsCosts') return createTextCell(entry.txsCostsAtlas == null ? '--' : formatAtlasWhole(entry.txsCostsAtlas));
  if (columnId === 'totalCosts') return createTextCell(entry.totalCostsAtlas == null ? '--' : formatAtlasWhole(entry.totalCostsAtlas));
  if (columnId === 'netProfit') return createTextCell(entry.netProfitAtlas == null ? '--' : formatAtlasWhole(entry.netProfitAtlas));
  if (columnId === 'npPerCrew') return createTextCell(entry.netProfitPerCrew == null ? '--' : formatAtlasWhole(entry.netProfitPerCrew));
  if (columnId === 'profitMargin') return createTextCell(entry.profitMarginPercent == null ? '--' : formatPercentNumber(entry.profitMarginPercent, 1));
  if (columnId === 'costsPerUnit') return createTextCell(entry.costsPerUnitAtlas == null ? '--' : formatAtlasNumber(entry.costsPerUnitAtlas, 6));
  return createTextCell('--');
}

function createUpgradingEarningsOptionalCell(entry, columnId) {
  if (columnId === 'installed') return createTextCell(formatWholeNumber(entry.installed || 0));
  if (columnId === 'lpRedemption') return createTextCell(entry.factionRedeemedLp == null ? '--' : formatWholeNumber(entry.factionRedeemedLp));
  if (columnId === 'crew') return createTextCell(entry.crew > 0 ? formatWholeNumber(entry.crew) : '--');
  if (columnId === 'revenue') return createTextCell(entry.revenueAtlasPerDay == null ? '--' : formatAtlasWhole(entry.revenueAtlasPerDay));
  if (columnId === 'upgCosts') return createTextCell(entry.upgradingCostsAtlas == null ? '--' : formatAtlasWhole(entry.upgradingCostsAtlas));
  if (columnId === 'txsCosts') return createTextCell(entry.txsCostsAtlas == null ? '--' : formatAtlasWhole(entry.txsCostsAtlas));
  if (columnId === 'totalCosts') return createTextCell(entry.totalCostsAtlas == null ? '--' : formatAtlasWhole(entry.totalCostsAtlas));
  if (columnId === 'netProfit') return createTextCell(entry.netProfitAtlas == null ? '--' : formatAtlasWhole(entry.netProfitAtlas));
  if (columnId === 'npPerCrew') return createTextCell(entry.netProfitPerCrew == null ? '--' : formatAtlasWhole(entry.netProfitPerCrew));
  if (columnId === 'profitMargin') return createTextCell(entry.profitMarginPercent == null ? '--' : formatPercentNumber(entry.profitMarginPercent, 1));
  return createTextCell('--');
}

function createCargoEarningsOptionalCell(entry, columnId, colorMap) {
  if (columnId === 'color') return createColorCell(entry, colorMap);
  if (columnId === 'ownership') return createOwnershipCell(entry);
  if (columnId === 'ships') return createShipsCell(entry);
  if (columnId === 'requiredCrew') return createTextCell(entry.totalRequiredCrew == null ? '--' : formatWholeNumber(entry.totalRequiredCrew));
  if (columnId === 'txsDaily') return createTextCell(entry.txsDaily == null ? '--' : formatWholeNumber(entry.txsDaily));
  if (columnId === 'cargoCycles') {
    const cycles = entry.cargoCycles == null ? 0 : Number(entry.cargoCycles);
    const legs = entry.cargoLegs == null ? 0 : Number(entry.cargoLegs);
    return createTextCell(`${formatWholeNumber(cycles)} cycles / ${formatWholeNumber(legs)} legs`);
  }
  if (columnId === 'assignment') return createTextCell(entry.assignment || '--');
  if (columnId === 'travelModeTime') return createTextCell(entry.travelModeTime?.label || '0% Warp | 0% Subwarp');
  if (columnId === 'starbases') return createTextCell(entry.starbaseLabel || '--');
  const valuationCell = (value, formatter = formatAtlasWhole) => createTextCell(value == null ? '--' : formatter(value));
  if (columnId === 'fuelCosts') return valuationCell(entry.fuelCostsAtlas);
  if (columnId === 'rental') return createTextCell(entry.rentalRateAtlasPerDay == null ? '--' : formatAtlasNumber(entry.rentalRateAtlasPerDay, 2));
  if (columnId === 'txsCosts') return valuationCell(entry.txsCostsAtlas);
  if (columnId === 'totalCosts') return valuationCell(entry.totalCostsAtlas);
  if (columnId === 'txsCostsPct') return valuationCell(entry.txsCostsPercent, (value) => formatPercentNumber(value, 0));
  if (columnId === 'cargoVolume') return createTextCell(entry.cargoVolume == null ? '--' : formatWholeNumber(entry.cargoVolume));
  if (columnId === 'cargoCapacity') return createTextCell(entry.cargoCapacity == null ? '--' : formatWholeNumber(entry.cargoCapacity));
  if (columnId === 'cargoEfficiency') return createTextCell(entry.cargoEfficiencyPercent == null ? '--' : formatPercentNumber(entry.cargoEfficiencyPercent, 1));
  if (columnId === 'account') return createAccountCell(entry.fleetAccount);
  return createTextCell('--');
}

function renderEarnings(result) {
  latestEarningsResult = result;
  if (!result?.ok) {
    renderEarningsEmpty(result?.error || 'Earnings sync failed');
    renderEarningsMiningEmpty(result?.error || 'Earnings sync failed');
    renderEarningsCargoEmpty(result?.error || 'Earnings sync failed');
    renderEarningsCraftingEmpty(result?.error || 'Earnings sync failed');
    setEarningsStatus('Earnings sync failed');
    setEarningsMiningStatus('Earnings sync failed');
    setEarningsCargoStatus('Earnings sync failed');
    setEarningsCraftingStatus('Earnings sync failed');
    return;
  }
  setCachedFactionResult(normalizeFaction(latestSettings?.faction), 'earnings', result);
  const rows = Array.isArray(result.rows) ? result.rows : [];
  populateEarningsFilterOptions('scanning', rows);
  renderEarningsHeader('scanning');
  const colorMap = buildEarningsFleetColorMap(rows, 0);
  renderEarningsNetProfitChart(result, colorMap, {
    target: earningsNetProfitChart,
    label: 'Scanning net profit by fleet in ATLAS by day',
    mode: earningsChartMode.scanning,
    getCrew: (row) => row.totalRequiredCrew,
    getCrewIdentity: (row) => row.fleetName || row.fleet,
  });

  setText(earningsSduPriceValue, result.sduPriceAtl == null ? '--' : formatAtlas(result.sduPriceAtl, 6));
  setText(earningsSduPriceNote, '');
  setText(earningsSduScanValue, result.topScanNetProfitFleetYesterday?.fleetName || '--');
  setText(
    earningsSduScanNote,
    result.topScanNetProfitFleetYesterday
      ? `${formatAtlasWhole(result.topScanNetProfitFleetYesterday.netProfitAtlas)} Yesterday`
      : 'No data yesterday'
  );
  setText(earningsSduValueValue, result.topScanNetProfitPerCrewFleetYesterday?.fleetName || '--');
  setText(
    earningsSduValueNote,
    result.topScanNetProfitPerCrewFleetYesterday
      ? `${formatAtlasNumber(result.topScanNetProfitPerCrewFleetYesterday.netProfitPerCrew, 2)} / crew Yesterday`
      : 'No data yesterday'
  );
  setText(earningsRentalValue, result.topScanSuccessRateFleetYesterday?.fleetName || '--');
  setText(
    earningsRentalNote,
    result.topScanSuccessRateFleetYesterday
      ? `${formatPercentNumber(result.topScanSuccessRateFleetYesterday.scanSuccessRatePercent, 1)} yesterday`
      : 'No data yesterday'
  );
  setEarningsStatus(
    `${formatWholeNumber(result.scanRowCount || 0)} scan rows from ${formatWholeNumber(result.activeScanningFleetCount || 0)} active fleets at ${formatCheckedAt(result.checkedAt)}${
      result.scanningError ? ' · Influx scan rows unavailable' : ''
    }`
  );

  if (!earningsTableBody) return;
  const filteredRows = getFilteredEarningsRows('scanning', rows);
  const displayRows = earningsFilters.scanning.fleet === EARNINGS_TOTAL_FLEETS_FILTER
    ? aggregateTotalFleetRows('scanning', filteredRows)
    : filteredRows;
  const sortedRows = sortEarningsRows('scanning', displayRows);
  earningsTableBody.textContent = '';
  if (!sortedRows.length) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = document.createElement('td');
    cell.colSpan = getEarningsTableColSpan('scanning');
    cell.textContent = rows.length
      ? `No ${normalizeFaction(latestSettings?.faction)} rows match the current filters`
      : `No ${normalizeFaction(latestSettings?.faction)} fleets scanned in the last 30 days`;
    row.appendChild(cell);
    earningsTableBody.appendChild(row);
    renderEarningsMining(result);
    renderEarningsCargo(result);
    renderEarningsCrafting(result);
    renderEarningsMarketplace(result);
    return;
  }
  const visibleColumns = getVisibleEarningsColumns('scanning');
  const colorColumnVisible = visibleColumns.some((column) => column.id === 'color');
  const remainingColumns = visibleColumns.filter((column) => column.id !== 'color');
  for (const entry of sortedRows) {
    const row = document.createElement('tr');
    row.appendChild(createTextCell(entry.label || entry.isoDate));
    if (colorColumnVisible) row.appendChild(createColorCell(entry, colorMap));
    row.appendChild(createEarningsFleetCell(entry));
    for (const column of remainingColumns) {
      row.appendChild(createEarningsOptionalCell(entry, column.id, colorMap));
    }
    earningsTableBody.appendChild(row);
  }
  renderEarningsMining(result);
  renderEarningsCargo(result);
  renderEarningsCrafting(result);
  renderEarningsMarketplace(result);
}

function renderEarningsMining(result) {
  if (!result?.ok) {
    renderEarningsMiningEmpty(result?.error || 'Mining earnings sync failed');
    setEarningsMiningStatus('Mining earnings sync failed');
    return;
  }

  const rows = Array.isArray(result.miningRows) ? result.miningRows : [];
  const colorMap = buildEarningsFleetColorMap(rows, 7);
  populateEarningsFilterOptions('mining', rows);
  renderEarningsHeader('mining');
  const miningMode = earningsChartMode.mining;
  const miningGetCrew = (row) => row.totalRequiredCrew;
  const miningGetCrewIdentity = (row) => row.fleetName || row.fleet;
  renderEarningsNetProfitChart(
    { ...result, rows },
    colorMap,
    {
      target: earningsMiningNetProfitChart,
      label: 'Mining fleet net profit in ATLAS by day',
      mode: miningMode,
      getCrew: miningGetCrew,
      getCrewIdentity: miningGetCrewIdentity,
    }
  );
  const materialColorMap = buildEarningsAssetColorMap(rows, (row) => row.rawMaterial || 'Unknown material');
  renderEarningsNetProfitChart(
    { ...result, rows },
    materialColorMap,
    {
      target: earningsMiningMaterialNetProfitChart,
      label: 'Mining raw material net profit in ATLAS by day',
      getSegmentLabel: (row) => row.rawMaterial || 'Unknown material',
      mode: miningMode,
      getCrew: miningGetCrew,
      getCrewIdentity: miningGetCrewIdentity,
    }
  );
  const starbaseColorMap = buildEarningsFleetColorMap(rows, 21, (row) => row.starbase || 'Unknown starbase');
  renderEarningsNetProfitChart(
    { ...result, rows },
    starbaseColorMap,
    {
      target: earningsMiningStarbaseNetProfitChart,
      label: 'Mining starbase net profit in ATLAS by day',
      getSegmentLabel: (row) => row.starbase || 'Unknown starbase',
      mode: miningMode,
      getCrew: miningGetCrew,
      getCrewIdentity: miningGetCrewIdentity,
    }
  );

  const topFleet = result.topMiningNetProfitFleetToday;
  setText(earningsMiningAmmoPriceValue, topFleet?.fleetName || '--');
  setText(earningsMiningAmmoPriceNote, topFleet ? `Net Profit: ${formatAtlasWhole(topFleet.netProfitAtlas)}` : 'No net profit today');
  setText(earningsMiningMinedValue, result.topMiningNetProfitFleetYesterday?.fleetName || '--');
  setText(
    earningsMiningMinedNote,
    result.topMiningNetProfitFleetYesterday
      ? `${formatAtlasWhole(result.topMiningNetProfitFleetYesterday.netProfitAtlas)} Yesterday`
      : 'No data yesterday'
  );
  setText(earningsMiningRevenueValue, result.topMiningNetProfitPerCrewFleetYesterday?.fleetName || '--');
  setText(
    earningsMiningRevenueNote,
    result.topMiningNetProfitPerCrewFleetYesterday
      ? `${formatAtlasNumber(result.topMiningNetProfitPerCrewFleetYesterday.netProfitPerCrew, 2)} / crew Yesterday`
      : 'No data yesterday'
  );
  setText(earningsMiningRentalValue, result.topMiningRawMaterialYesterday?.rawMaterial || '--');
  setText(
    earningsMiningRentalNote,
    result.topMiningRawMaterialYesterday
      ? `${formatWholeNumber(Math.round(result.topMiningRawMaterialYesterday.mined))} yesterday`
      : 'No data yesterday'
  );
  setEarningsMiningStatus(
    `${formatWholeNumber(result.miningRowCount || 0)} mining rows from ${formatWholeNumber(result.activeMiningFleetCount || 0)} active fleets at ${formatCheckedAt(result.checkedAt)}${
      result.miningError ? ' · Influx mining rows unavailable' : ''
    }`
  );

  if (!earningsMiningTableBody) return;
  const filteredRows = getFilteredEarningsRows('mining', rows);
  const displayRows = earningsFilters.mining.fleet === EARNINGS_TOTAL_FLEETS_FILTER
    ? aggregateTotalFleetRows('mining', filteredRows)
    : filteredRows;
  const sortedRows = sortEarningsRows('mining', displayRows);
  earningsMiningTableBody.textContent = '';
  if (!sortedRows.length) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = document.createElement('td');
    cell.colSpan = getEarningsTableColSpan('mining');
    cell.textContent = rows.length
      ? `No ${normalizeFaction(latestSettings?.faction)} rows match the current filters`
      : `No ${normalizeFaction(latestSettings?.faction)} fleets mined in the last 30 days`;
    row.appendChild(cell);
    earningsMiningTableBody.appendChild(row);
    return;
  }

  const visibleColumns = getVisibleEarningsColumns('mining');
  const colorColumnVisible = visibleColumns.some((column) => column.id === 'color');
  const remainingColumns = visibleColumns.filter((column) => column.id !== 'color');
  for (const entry of sortedRows) {
    const row = document.createElement('tr');
    row.appendChild(createTextCell(entry.label || entry.isoDate));
    if (colorColumnVisible) row.appendChild(createColorCell(entry, colorMap));
    row.appendChild(createEarningsFleetCell(entry));
    for (const column of remainingColumns) {
      row.appendChild(createMiningEarningsOptionalCell(entry, column.id, colorMap));
    }
    earningsMiningTableBody.appendChild(row);
  }
}

function renderEarningsCrafting(result) {
  if (!result?.ok) {
    renderEarningsCraftingEmpty(result?.error || 'Crafting earnings sync failed');
    setEarningsCraftingStatus('Crafting earnings sync failed');
    return;
  }

  const rows = Array.isArray(result.craftingRows) ? result.craftingRows.map((row) => applyEarningsCostBasis(row, 'crafting')) : [];
  populateEarningsFilterOptions('crafting', rows);
  renderEarningsHeader('crafting');
  const craftingMode = earningsChartMode.crafting;
  // Each Crafting per-row is already unique on (date, starbase, output),
  // so the per-row crew is pre-aggregated across all events for that
  // (date, starbase, output). In a chart, the segment is either output
  // (by Asset) or starbase (by Starbase). For per-crew mode, dedup the
  // crew by the OTHER axis: starbase for by-Asset (one row per
  // starbase), output for by-Starbase (one row per output). The dedup
  // is a safety net — it produces the same sum either way because each
  // (date, segment, otherAxis) tuple is already a unique row.
  const craftingGetCrew = (row) => row.crew;
  const assetColorMap = buildEarningsAssetColorMap(rows, (row) => row.output || 'Unknown asset');
  renderEarningsNetProfitChart(
    { ...result, rows },
    assetColorMap,
    {
      target: earningsCraftingAssetNetProfitChart,
      label: 'Crafting net profit by asset in ATLAS by day',
      getSegmentLabel: (row) => row.output || 'Unknown asset',
      mode: craftingMode,
      getCrew: craftingGetCrew,
      getCrewIdentity: (row) => row.starbase,
    }
  );
  const starbaseColorMap = buildEarningsAssetColorMap(rows, (row) => row.starbase || 'Unknown starbase');
  renderEarningsNetProfitChart(
    { ...result, rows },
    starbaseColorMap,
    {
      target: earningsCraftingStarbaseNetProfitChart,
      label: 'Crafting net profit by starbase in ATLAS by day',
      getSegmentLabel: (row) => row.starbase || 'Unknown starbase',
      mode: craftingMode,
      getCrew: craftingGetCrew,
      getCrewIdentity: (row) => row.output,
    }
  );

  const topAssetToday = result.topCraftingNetProfitAssetToday;
  setText(earningsCraftingTopAssetValue, topAssetToday?.asset || '--');
  setText(
    earningsCraftingTopAssetNote,
    topAssetToday ? `Net Profit: ${formatAtlasWhole(topAssetToday.netProfitAtlas)}` : 'No net profit today'
  );
  setText(earningsCraftingBestNpValue, result.topCraftingNetProfitAssetYesterday?.asset || '--');
  setText(
    earningsCraftingBestNpNote,
    result.topCraftingNetProfitAssetYesterday
      ? `${formatAtlasWhole(result.topCraftingNetProfitAssetYesterday.netProfitAtlas)} Yesterday`
      : 'No data yesterday'
  );
  setText(earningsCraftingBestMarginValue, result.topCraftingProfitMarginAssetYesterday?.asset || '--');
  setText(
    earningsCraftingBestMarginNote,
    result.topCraftingProfitMarginAssetYesterday
      ? `${formatPercentNumber(result.topCraftingProfitMarginAssetYesterday.profitMarginPercent, 1)} margin Yesterday`
      : 'No data yesterday'
  );
  setText(earningsCraftingBestRevenueValue, result.topCraftingRevenueAssetYesterday?.asset || '--');
  setText(
    earningsCraftingBestRevenueNote,
    result.topCraftingRevenueAssetYesterday
      ? `${formatAtlasWhole(result.topCraftingRevenueAssetYesterday.revenue)} Yesterday`
      : 'No data yesterday'
  );
  setEarningsCraftingStatus(
    `${formatWholeNumber(result.craftingRowCount || 0)} crafting rows at ${formatCheckedAt(result.checkedAt)}${
      result.craftingError ? ' · Influx crafting rows unavailable' : ''
    }`
  );

  if (!earningsCraftingTableBody) return;
  const filteredRows = getFilteredEarningsRows('crafting', rows);
  const sortedRows = sortEarningsRows('crafting', filteredRows);
  earningsCraftingTableBody.textContent = '';
  if (!sortedRows.length) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = document.createElement('td');
    cell.colSpan = getEarningsTableColSpan('crafting');
    cell.textContent = rows.length
      ? `No ${normalizeFaction(latestSettings?.faction)} rows match the current filters`
      : `No ${normalizeFaction(latestSettings?.faction)} crafting data in the last 30 days`;
    row.appendChild(cell);
    earningsCraftingTableBody.appendChild(row);
    return;
  }

  const visibleColumns = getVisibleEarningsColumns('crafting');
  for (const entry of sortedRows) {
    const row = document.createElement('tr');
    row.appendChild(createTextCell(entry.label || entry.isoDate));
    row.appendChild(createTextCell(entry.starbase || '--'));
    row.appendChild(createTextCell(entry.output || '--'));
    for (const column of visibleColumns) {
      row.appendChild(createCraftingEarningsOptionalCell(entry, column.id, null));
    }
    earningsCraftingTableBody.appendChild(row);
  }
}

function renderEarningsMarketplace(result) {
  const rows = Array.isArray(result?.localMarketTrades) ? result.localMarketTrades : [];
  const visibleRows = rows.filter((entry) => entry.side === earningsMarketplaceSide);
  const errorSuffix = result?.localMarketError ? ` · Influx read failed: ${result.localMarketError}` : '';
  setText(earningsMarketplaceSyncStatus, `${formatMarketplaceWhole(visibleRows.length)} LM ${earningsMarketplaceSide} executions at ${formatCheckedAt(result?.checkedAt)}${errorSuffix}`);
  setText(earningsMarketplaceUnitHeader, earningsMarketplaceSide === 'buy' ? 'Cost / Unit' : 'Income / Unit');
  earningsMarketplaceSideButtons.forEach((button) => {
    const active = button.dataset.marketplaceSide === earningsMarketplaceSide;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (!earningsMarketplaceTableBody) return;
  const visibleColumns = getVisibleEarningsColumns('marketplace');
  renderMarketplaceHeader(visibleColumns);
  earningsMarketplaceTableBody.textContent = '';
  if (!visibleRows.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = createTextCell(result?.localMarketError ? `Marketplace Influx read failed: ${result.localMarketError}` : `No Marketplace ${earningsMarketplaceSide} executions found`);
    td.colSpan = Math.max(1, visibleColumns.length);
    tr.appendChild(td);
    earningsMarketplaceTableBody.appendChild(tr);
    return;
  }
  for (const entry of [...visibleRows].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))) {
    const tr = document.createElement('tr');
    const quantity = Number(entry.quantity) || 0;
    const gross = Number(entry.grossAtlas) || 0;
    const txFee = Number(entry.txFeeAtlas) || 0;
    const net = Number(entry.netAtlas ?? entry.settledAtlas ?? 0);
    const unitMetric = quantity > 0
      ? (earningsMarketplaceSide === 'buy' ? (gross + txFee) / quantity : net / quantity)
      : null;
    for (const column of visibleColumns) tr.appendChild(createMarketplaceEarningsCell(entry, column.id, { quantity, gross, txFee, net, unitMetric }));
    earningsMarketplaceTableBody.appendChild(tr);
  }
}

function renderMarketplaceHeader(visibleColumns) {
  const row = earningsMarketplaceTableBody?.closest('table')?.querySelector('thead tr');
  if (!row) return;
  row.textContent = '';
  for (const column of visibleColumns) {
    const th = document.createElement('th');
    th.textContent = column.id === 'unitMetric'
      ? (earningsMarketplaceSide === 'buy' ? 'Cost / Unit' : 'Income / Unit')
      : column.label;
    row.appendChild(th);
  }
}

function createMarketplaceEarningsCell(entry, columnId, calculated) {
  const values = {
    timestamp: formatMarketplaceTimestamp(entry.timestamp), marketplace: entry.marketplace || 'LM',
    starbase: entry.starbase || '--', asset: entry.asset || '--', amount: formatMarketplaceWhole(calculated.quantity),
    grossAtlas: formatMarketplaceAtlas(calculated.gross, 6), price: formatMarketplaceAtlas(entry.unitPriceAtlas || 0, 8),
    marketplaceFee: formatMarketplaceAtlas(entry.marketplaceFeeAtlas || 0, 6), txsFee: formatMarketplaceAtlas(calculated.txFee, 2),
    netAtlas: formatMarketplaceAtlas(calculated.net, 2), unitMetric: calculated.unitMetric == null ? '--' : formatMarketplaceAtlas(calculated.unitMetric, 8),
    orderId: entry.orderId || '--', signature: entry.signature || '--',
  };
  if (columnId !== 'signature') return createTextCell(values[columnId] ?? '--');
  const cell = document.createElement('td');
  if (!entry.signature) { cell.textContent = '--'; return cell; }
  const link = document.createElement('a');
  link.href = `https://solscan.io/tx/${encodeURIComponent(entry.signature)}`;
  link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = entry.signature;
  cell.appendChild(link);
  return cell;
}

function renderEarningsMarketplaceLoading(message = 'Loading Marketplace data...') {
  setText(earningsMarketplaceSyncStatus, message);
  setText(earningsMarketplaceUnitHeader, earningsMarketplaceSide === 'buy' ? 'Cost / Unit' : 'Income / Unit');
  if (!earningsMarketplaceTableBody) return;
  const visibleColumns = getVisibleEarningsColumns('marketplace');
  renderMarketplaceHeader(visibleColumns);
  earningsMarketplaceTableBody.textContent = '';
  const tr = document.createElement('tr');
  tr.className = 'empty-row';
  const td = createTextCell(message);
  td.colSpan = Math.max(1, visibleColumns.length);
  tr.appendChild(td);
  earningsMarketplaceTableBody.appendChild(tr);
}

function renderEarningsBreakevenEmpty(message) {
  renderEarningsBreakevenHeader();
  setText(earningsBreakevenSyncStatus, message);
  if (!earningsBreakevenTableBody) return;
  earningsBreakevenTableBody.textContent = '';
  const row = document.createElement('tr');
  row.className = 'empty-row';
  const cell = document.createElement('td');
  cell.colSpan = breakevenEarningsBaseColumns.length + getVisibleEarningsColumns('breakeven').length;
  cell.textContent = message;
  row.appendChild(cell);
  earningsBreakevenTableBody.appendChild(row);
}

function renderEarningsBreakevenHeader() {
  if (!earningsBreakevenTableHead) return;
  earningsBreakevenTableHead.textContent = '';
  const headRow = document.createElement('tr');
  const sortState = earningsSort.breakeven;
  for (const column of [...breakevenEarningsBaseColumns, ...getVisibleEarningsColumns('breakeven')]) {
    appendEarningsHeaderCell(headRow, column.id, column.label, sortState);
  }
  earningsBreakevenTableHead.appendChild(headRow);
}

function renderEarningsBreakeven(result) {
  const rows = Array.isArray(result?.breakevenRows) ? result.breakevenRows : [];
  const baselineStatus = result?.openingInventoryError
    ? ` · opening baseline unavailable: ${result.openingInventoryError}`
    : Number(result?.openingInventoryCount || 0) > 0
      ? ` · ${formatWholeNumber(result.openingInventoryCount)} opening lots`
      : '';
  const checkpointStatus = result?.ledgerCheckpointStatus
    ? ` · checkpoint ${result.ledgerCheckpointStatus}${result?.ledgerCheckpointError ? ': ' + result.ledgerCheckpointError : ''}`
    : '';
  const syncMessage = `${formatWholeNumber(rows.length)} inventory cost-basis rows at ${formatCheckedAt(result?.checkedAt)}${baselineStatus}${checkpointStatus}${result?.breakevenError ? ' · ' + result.breakevenError : ''}`;
  setText(earningsBreakevenSyncStatus, syncMessage);
  populateEarningsFilterOptions('breakeven', rows);
  if (earningsBreakevenHideLowInventory) earningsBreakevenHideLowInventory.checked = earningsFilters.breakeven.hideLowInventory;
  renderEarningsBreakevenHeader();

  if (!earningsBreakevenTableBody) return;
  earningsBreakevenTableBody.textContent = '';
  const filteredRows = getFilteredEarningsRows('breakeven', rows);
  const sortedRows = sortEarningsRows('breakeven', filteredRows);
  if (!sortedRows.length) {
    return renderEarningsBreakevenEmpty(rows.length ? 'No breakeven rows match the current filters' : 'No breakeven data available — check mining, cargo, and inventory telemetry');
  }
  const optionalColumns = getVisibleEarningsColumns('breakeven');
  for (const entry of sortedRows) {
    const tr = document.createElement('tr');
    tr.appendChild(createTextCell(entry.starbase || '--'));
    tr.appendChild(createTextCell(entry.asset || '--'));
    tr.appendChild(createTextCell(formatWholeNumber(entry.inventory || 0)));
    tr.appendChild(createTextCell(entry.scanningCostPerUnit == null ? '--' : formatAtlasNumber(entry.scanningCostPerUnit, 6)));
    tr.appendChild(createTextCell(entry.miningCostPerUnit == null ? '--' : formatAtlasNumber(entry.miningCostPerUnit, 6)));
    tr.appendChild(createTextCell(entry.craftingCostPerUnit == null ? '--' : formatAtlasNumber(entry.craftingCostPerUnit, 6)));
    tr.appendChild(createTextCell(entry.lmCostPerUnit == null ? '--' : formatAtlasNumber(entry.lmCostPerUnit, 6)));
    tr.appendChild(createTextCell(entry.gmCostPerUnit == null ? '--' : formatAtlasNumber(entry.gmCostPerUnit, 6)));
    tr.appendChild(createTextCell(entry.baseCostPerUnit == null ? '--' : formatAtlasNumber(entry.baseCostPerUnit, 6)));
    tr.appendChild(createTextCell(entry.cargoCostPerUnit == null ? '--' : formatAtlasNumber(entry.cargoCostPerUnit, 6)));
    tr.appendChild(createTextCell(entry.landedCostPerUnit == null ? '--' : formatAtlasNumber(entry.landedCostPerUnit, 6)));
    tr.appendChild(createTextCell(entry.inventoryValue == null ? '--' : formatAtlasWhole(entry.inventoryValue)));
    tr.appendChild(createTextCell(entry.fullyTracked ? '100% tracked' : `${formatWholeNumber(entry.estimatedPercent ?? 100)}% estimated`));
    tr.appendChild(createTextCell(entry.gmPricePerUnit == null ? '--' : formatAtlasNumber(entry.gmPricePerUnit, 6)));
    tr.appendChild(createTextCell(entry.inventoryExternalValue == null ? '--' : formatAtlasWhole(entry.inventoryExternalValue)));
    const status = entry.reconciliationStatus === 'reconciled'
      ? (Number(entry.uncostedQuantity || 0) > 1e-9 ? `Reconciled · ${formatWholeNumber(entry.uncostedQuantity)} uncosted` : 'Reconciled')
      : entry.reconciliationStatus === 'surplus'
        ? `Surplus +${formatWholeNumber(entry.quantityVariance)}`
        : `Shortfall ${formatWholeNumber(Math.abs(Number(entry.quantityVariance || 0)))}`;
    tr.appendChild(createTextCell(status));
    for (const column of optionalColumns) tr.appendChild(createTextCell(entry[column.id] ?? '--'));
    earningsBreakevenTableBody.appendChild(tr);
  }
}

// Legacy wiring assertions retained as documentation only; the broad result is
// no longer an executable Breakeven source:
/*
else if (subtab === 'breakeven') renderEarningsBreakeven(latestEarningsResult);
renderEarningsUpgrading(result);
renderEarningsMarketplace(result);
renderEarningsBreakeven(result);
*/

function renderEarningsUpgradingEmpty(message) {
  renderEarningsHeader('upgrading');
  renderEarningsNetProfitChart(null, new Map(), { target: earningsUpgradingAssetNetProfitChart, label: 'Upgrading net profit by asset in ATLAS by day' });
  setText(earningsUpgradingSyncStatus, message);
  if (!earningsUpgradingTableBody) return;
  earningsUpgradingTableBody.textContent = '';
  const row = document.createElement('tr');
  row.className = 'empty-row';
  const cell = document.createElement('td');
  cell.colSpan = getEarningsTableColSpan('upgrading');
  cell.textContent = message;
  row.appendChild(cell);
  earningsUpgradingTableBody.appendChild(row);
}

function renderEarningsUpgrading(result) {
  const rows = Array.isArray(result?.upgradingRows) ? result.upgradingRows.map((row) => applyEarningsCostBasis(row, 'upgrading')) : [];
  populateEarningsFilterOptions('upgrading', rows);
  renderEarningsHeader('upgrading');
  const colorMap = buildEarningsAssetColorMap(rows, (row) => row.asset || 'Unknown asset');
  renderEarningsNetProfitChart({ ...result, rows }, colorMap, { target: earningsUpgradingAssetNetProfitChart, label: 'Upgrading net profit by asset in ATLAS by day', getSegmentLabel: (row) => row.asset || 'Unknown asset', mode: earningsChartMode.upgrading, getCrew: (row) => row.crew, getCrewIdentity: (row) => row.starbase });
  setText(earningsUpgradingSyncStatus, `${formatWholeNumber(rows.length)} upgrading rows at ${formatCheckedAt(result?.checkedAt)}${result?.upgradingError ? ' · ' + result.upgradingError : ''}`);
  if (!earningsUpgradingTableBody) return;
  const sortedRows = sortEarningsRows('upgrading', getFilteredEarningsRows('upgrading', rows));
  earningsUpgradingTableBody.textContent = '';
  if (!sortedRows.length) return renderEarningsUpgradingEmpty(rows.length ? 'No rows match the current filters' : 'No upgrading data in the last 30 completed days');
  const columns = getVisibleEarningsColumns('upgrading');
  for (const entry of sortedRows) {
    const tr = document.createElement('tr');
    tr.appendChild(createTextCell(entry.label || entry.isoDate)); tr.appendChild(createTextCell(entry.starbase || '--')); tr.appendChild(createTextCell(entry.asset || '--'));
    for (const column of columns) tr.appendChild(createUpgradingEarningsOptionalCell(entry, column.id));
    earningsUpgradingTableBody.appendChild(tr);
  }
}

function renderEarningsCargo(result) {
  if (!result?.ok) {
    renderEarningsCargoEmpty(result?.error || 'Cargo earnings sync failed');
    setEarningsCargoStatus('Cargo earnings sync failed');
    return;
  }

  const rows = Array.isArray(result.cargoRows) ? result.cargoRows : [];
  const colorMap = buildEarningsFleetColorMap(rows, 11);
  populateEarningsFilterOptions('cargo', rows);
  renderEarningsHeader('cargo');
  renderEarningsNetProfitChart(
    { ...result, rows },
    colorMap,
    {
      target: earningsCargoNetProfitChart,
      label: 'Cargo fleet total costs in ATLAS by day',
      valueKey: 'totalCostsAtlas',
      valueLabel: 'Total Costs',
      emptyLabel: 'No cargo cost data loaded',
      emptyValueLabel: 'No cargo cost values available',
    }
  );
  renderEarningsCargoCostBreakdownChart({ ...result, rows });
  setEarningsCargoStatus(
    `${formatWholeNumber(result.cargoRowCount || 0)} cargo rows from ${formatWholeNumber(result.activeCargoFleetCount || 0)} active fleets at ${formatCheckedAt(result.checkedAt)}${
      result.cargoError ? ` · Cargo query failed: ${formatInfluxError(result.cargoError)}` : ''
    }`
  );

  if (!earningsCargoTableBody) return;
  const filteredRows = getFilteredEarningsRows('cargo', rows);
  const displayRows = earningsFilters.cargo.fleet === EARNINGS_TOTAL_FLEETS_FILTER
    ? aggregateTotalCargoRows(filteredRows)
    : filteredRows;
  const sortedRows = sortEarningsRows('cargo', displayRows);
  earningsCargoTableBody.textContent = '';
  if (!sortedRows.length) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = document.createElement('td');
    cell.colSpan = getEarningsTableColSpan('cargo');
    cell.textContent = rows.length
      ? `No ${normalizeFaction(latestSettings?.faction)} rows match the current filters`
      : `No ${normalizeFaction(latestSettings?.faction)} cargo fleets moved in the last 30 days`;
    row.appendChild(cell);
    earningsCargoTableBody.appendChild(row);
    return;
  }

  const visibleColumns = getVisibleEarningsColumns('cargo');
  const colorColumnVisible = visibleColumns.some((column) => column.id === 'color');
  const remainingColumns = visibleColumns.filter((column) => column.id !== 'color');
  for (const entry of sortedRows) {
    const row = document.createElement('tr');
    row.appendChild(createTextCell(entry.label || entry.isoDate));
    if (colorColumnVisible) row.appendChild(createColorCell(entry, colorMap));
    row.appendChild(createEarningsFleetCell(entry));
    for (const column of remainingColumns) {
      row.appendChild(createCargoEarningsOptionalCell(entry, column.id, colorMap));
    }
    earningsCargoTableBody.appendChild(row);
  }
}

function renderEarningsCargoAllocations(result) {
  if (!earningsCargoAllocationTableBody) return;
  const rows = Array.isArray(result?.cargoAllocationRows) ? result.cargoAllocationRows : [];
  const cargoAllocationAvailability = result?.cargoAllocationAvailability
    || (result?.cargoAllocationError ? 'unavailable' : (rows.length ? 'available' : 'empty'));
  populateEarningsFilterOptions('cargoAllocation', rows);
  const filteredRows = getFilteredEarningsRows('cargoAllocation', rows);
  const totalFleet = earningsFilters.cargoAllocation.fleet === EARNINGS_TOTAL_FLEETS_FILTER;
  const totalAsset = earningsFilters.cargoAllocation.asset === EARNINGS_TOTAL_ASSETS_FILTER;
  const displayRows = totalFleet || totalAsset
    ? aggregateTotalCargoAllocationRows(filteredRows, { totalFleet, totalAsset })
    : filteredRows;
  const visibleColumns = getVisibleEarningsColumns('cargoAllocation');
  const fleetDetailIds = new Set(['color', 'ownership', 'ships', 'requiredCrew']);
  const fleetDetailColumns = visibleColumns.filter((column) => fleetDetailIds.has(column.id));
  const remainingColumns = visibleColumns.filter((column) => !fleetDetailIds.has(column.id));
  const colorMap = buildEarningsFleetColorMap(rows, 0);
  renderEarningsMetricGuide('cargoAllocation');
  if (earningsCargoAllocationTableHead) {
    earningsCargoAllocationTableHead.textContent = '';
    const tr = document.createElement('tr');
    for (const label of ['Date', 'Fleet', ...fleetDetailColumns.map((column) => column.label), 'Asset', 'Origin Starbase', 'Destination Starbase', ...remainingColumns.map((column) => column.label)]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      tr.appendChild(th);
    }
    earningsCargoAllocationTableHead.appendChild(tr);
  }
  setText(earningsCargoAllocationSyncStatus, cargoAllocationAvailability === 'unavailable'
    ? `Cargo allocation data unavailable at ${formatCheckedAt(result?.checkedAt)}`
    : `${formatWholeNumber(rows.length)} allocation rows at ${formatCheckedAt(result?.checkedAt)}`);
  earningsCargoAllocationTableBody.textContent = '';
  if (!filteredRows.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 5 + visibleColumns.length;
    td.textContent = cargoAllocationAvailability === 'unavailable'
      ? `Cargo allocation data unavailable${result?.cargoAllocationError ? `: ${formatInfluxError(result.cargoAllocationError)}` : ''}`
      : (cargoAllocationAvailability === 'empty'
        ? 'No cargo cost allocation data in the last 30 days'
        : 'No rows match the current filters');
    tr.appendChild(td);
    earningsCargoAllocationTableBody.appendChild(tr);
    return;
  }
  for (const entry of displayRows) {
    const tr = document.createElement('tr');
    tr.appendChild(createTextCell(entry.label || entry.isoDate));
    tr.appendChild(createEarningsFleetCell(entry));
    for (const column of fleetDetailColumns) {
      tr.appendChild(createCargoEarningsOptionalCell(entry, column.id, colorMap));
    }
    tr.appendChild(createTextCell(entry.asset || '--'));
    tr.appendChild(createTextCell(entry.origin || '--'));
    tr.appendChild(createTextCell(entry.destination || '--'));
    const renderedValues = new Map(
      CargoAllocationRenderer.buildCargoAllocationRenderedColumns(entry).map(({ id, text }) => [id, text]),
    );
    for (const column of remainingColumns) {
      if (column.id === 'assignment') tr.appendChild(createTextCell(entry.assignment || '--'));
      else if (renderedValues.has(column.id)) tr.appendChild(createTextCell(renderedValues.get(column.id)));
    }
    earningsCargoAllocationTableBody.appendChild(tr);
  }
}

// Singleton in-flight guard: every concurrent caller awaits the same
// promise instead of each kicking off its own Earnings snapshot. Multiple
// UI triggers in the same tick (tab open + section change + interval
// refresh) used to fan out into a parallel RPC storm and surface HTTP 429
// to the UI on first app start.
let earningsRefreshInFlight = null;
const marketplaceRefreshInFlight = new Map();
const marketplaceSnapshotCache = new Map();
const MARKETPLACE_SYNC_INTERVAL_MS = 60 * 60 * 1000;

async function refreshMarketplace({ sync = false } = {}) {
  const pendingTelemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  const telemetryTrigger = pendingTelemetryTrigger === 'unknown' && sync ? 'background' : pendingTelemetryTrigger;
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  const settings = { ...(latestSettings || getFormPayload()), trigger: telemetryTrigger };
  const faction = normalizeFaction(settings.faction);
  const profile = getActivePlayerProfile(settings);
  const cacheKey = `${faction}:${profile}`;
  if (!sync && marketplaceSnapshotCache.has(cacheKey)) {
    const cached = marketplaceSnapshotCache.get(cacheKey);
    latestEarningsResult = { ...(latestEarningsResult || {}), ...cached, ok: latestEarningsResult?.ok ?? cached.ok };
    renderEarningsMarketplace(latestEarningsResult);
    return cached;
  }
  if (marketplaceRefreshInFlight.has(cacheKey)) return marketplaceRefreshInFlight.get(cacheKey);
  const promise = (async () => {
    renderEarningsMarketplaceLoading(sync ? 'Syncing Marketplace data...' : 'Loading Marketplace data...');
    if (sync) {
      setText(earningsMarketplaceSyncStatus, 'Marketplace sync running in background...');
      await api.syncMarketplace(settings);
    }
    const result = await api.getMarketplaceSnapshot(settings);
    if (faction !== normalizeFaction((latestSettings || getFormPayload()).faction)) return result;
    marketplaceSnapshotCache.set(cacheKey, result);
    latestEarningsResult = { ...(latestEarningsResult || {}), ...result, ok: latestEarningsResult?.ok ?? result.ok };
    renderEarningsMarketplace(latestEarningsResult);
    return result;
  })().catch((error) => {
    console.error(error);
    setText(earningsMarketplaceSyncStatus, 'Marketplace sync unavailable');
  }).finally(() => {
    if (marketplaceRefreshInFlight.get(cacheKey) === promise) marketplaceRefreshInFlight.delete(cacheKey);
  });
  marketplaceRefreshInFlight.set(cacheKey, promise);
  return promise;
}

function runMarketplaceBackgroundSync() {
  if (!latestSettings || !getActivePlayerProfile(latestSettings)) return Promise.resolve();
  return refreshMarketplace({ sync: true });
}

function getUpgradingCacheInput(settings = latestSettings || getFormPayload(), force = false) {
  return {
    faction: normalizeFaction(settings?.faction),
    playerProfile: getActivePlayerProfile(settings),
    filters: {},
    force,
  };
}

function isActiveUpgradingContext(key, generation) {
  if (currentSection !== 'earnings' || currentEarningsSubtab !== 'upgrading') return false;
  const input = getUpgradingCacheInput();
  if (!input.playerProfile || api.upgradingCache.buildKey(input) !== key) return false;
  const current = api.upgradingCache.inspect(input);
  return current?.key === key && current?.entry?.generation === generation;
}

async function refreshEarningsUpgrading({ force = false } = {}) {
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  const settings = { ...(latestSettings || getFormPayload()), earningsSubtab: 'upgrading' };
  settings.trigger = telemetryTrigger;
  const input = getUpgradingCacheInput(settings, force);
  if (!input.playerProfile) {
    latestUpgradingResult = null;
    renderEarningsUpgradingEmpty(`No ${input.faction} player profile configured`);
    return null;
  }
  const initial = api.upgradingCache.inspect(input);
  const displayable = initial?.entry?.value || initial?.entry?.lastGoodValue;
  if (displayable) {
    latestUpgradingResult = displayable;
    renderEarningsUpgrading(displayable);
  } else {
    renderEarningsUpgradingEmpty('Loading Upgrading ledger data...');
  }
  const settled = await api.upgradingCache.ensure(input, async () => {
    const result = await api.getEarningsSnapshot(settings);
    if (result?.ok === false) throw new Error(result.error || 'Upgrading snapshot failed');
    return result;
  });
  if (!isActiveUpgradingContext(settled.key, settled.entry.generation)) return settled;
  const value = settled.entry.value || settled.entry.lastGoodValue;
  if (value) {
    latestUpgradingResult = value;
    renderEarningsUpgrading(value);
  } else {
    latestUpgradingResult = null;
    renderEarningsUpgradingEmpty(settled.entry.error?.message || 'Upgrading data unavailable');
  }
  return settled;
}

function getBreakevenCacheInput(settings = latestSettings || getFormPayload(), force = false) {
  return {
    faction: normalizeFaction(settings?.faction),
    playerProfile: getActivePlayerProfile(settings),
    filters: {},
    force,
  };
}

function isActiveBreakevenContext(key, generation) {
  if (currentSection !== 'earnings' || currentEarningsSubtab !== 'breakeven') return false;
  const input = getBreakevenCacheInput();
  if (!input.playerProfile || api.breakevenCache.buildKey(input) !== key) return false;
  const current = api.breakevenCache.inspect(input);
  return current?.key === key && current?.entry?.generation === generation;
}

async function refreshBreakeven({ force = false } = {}) {
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  const settings = { ...(latestSettings || getFormPayload()), earningsSubtab: 'breakeven' };
  settings.trigger = telemetryTrigger;
  const input = getBreakevenCacheInput(settings, force);
  if (!input.playerProfile) {
    latestBreakevenResult = null;
    renderEarningsBreakevenEmpty(`No ${input.faction} player profile configured`);
    return null;
  }
  const initial = api.breakevenCache.inspect(input);
  const displayable = initial?.entry?.value || initial?.entry?.lastGoodValue;
  if (displayable) {
    latestBreakevenResult = displayable;
    renderEarningsBreakeven(displayable);
  } else {
    renderEarningsBreakevenEmpty('Loading complete Breakeven data...');
  }
  const settled = await api.breakevenCache.ensure(input, async () => {
    const result = await api.getEarningsSnapshot(settings);
    if (result?.ok === false) throw new Error(result.error || 'Breakeven snapshot failed');
    return result;
  });
  if (!isActiveBreakevenContext(settled.key, settled.entry.generation)) return settled;
  const value = settled.entry.value || settled.entry.lastGoodValue;
  if (value) {
    latestBreakevenResult = value;
    renderEarningsBreakeven(value);
  } else {
    latestBreakevenResult = null;
    renderEarningsBreakevenEmpty(settled.entry.error?.message || 'Breakeven data unavailable');
  }
  return settled;
}

async function refreshCargoAllocation({ retry = false } = {}) {
  const settings = { ...(latestSettings || getFormPayload()), retry };
  const faction = normalizeFaction(settings.faction);
  const playerProfile = getActivePlayerProfile(settings);
  const requestSequence = ++cargoAllocationRequestSequence;
  if (!playerProfile) {
    latestCargoAllocationResult = { ok: false, cargoAllocationAvailability: 'unavailable', cargoAllocationRows: [], cargoAllocationError: `No ${faction} player profile configured` };
    renderEarningsCargoAllocations(latestCargoAllocationResult);
    return;
  }
  renderEarningsCargoAllocations({ ...(latestCargoAllocationResult || {}), cargoAllocationAvailability: 'loading', cargoAllocationRows: latestCargoAllocationResult?.cargoAllocationRows || [] });
  const result = await api.getCargoAllocation(settings);
  const currentSettings = latestSettings || getFormPayload();
  if (requestSequence !== cargoAllocationRequestSequence) return;
  const accepted = CargoAllocationRenderer.acceptCargoAllocationResponse(
    result,
    { faction, playerProfile },
    { faction: normalizeFaction(currentSettings.faction), playerProfile: getActivePlayerProfile(currentSettings) }
  );
  if (!accepted.accepted) return;
  latestCargoAllocationResult = accepted.state;
  renderEarningsCargoAllocations(latestCargoAllocationResult);
}

async function refreshEarnings() {
  const telemetryTrigger = typeof rendererTelemetryTrigger !== 'undefined' && typeof TELEMETRY_TRIGGERS !== 'undefined' && TELEMETRY_TRIGGERS.has(rendererTelemetryTrigger)
    ? rendererTelemetryTrigger
    : 'unknown';
  if (typeof rendererTelemetryTrigger !== 'undefined') rendererTelemetryTrigger = 'unknown';
  if (earningsRefreshInFlight) return earningsRefreshInFlight;
  const refreshPromise = (async () => {
    const settings = { ...(latestSettings || getFormPayload()), earningsSubtab: currentEarningsSubtab };
  settings.trigger = telemetryTrigger;
    const context = {
      faction: normalizeFaction(settings?.faction),
      playerProfile: getActivePlayerProfile(settings),
    };
    const request = requestGuard.begin('earnings:snapshot', context);
    if (!getActivePlayerProfile(settings)) {
      renderEarningsEmpty(`No ${normalizeFaction(settings.faction)} player profile configured`);
      renderEarningsMiningEmpty(`No ${normalizeFaction(settings.faction)} player profile configured`);
      renderEarningsCargoEmpty(`No ${normalizeFaction(settings.faction)} player profile configured`);
      setEarningsStatus('Awaiting player profile');
      setEarningsMiningStatus('Awaiting player profile');
      setEarningsCargoStatus('Awaiting player profile');
      return;
    }

    const faction = normalizeFaction(settings.faction);
    const cached = getCachedFactionResult(faction, 'earnings');
    if (cached) {
      renderEarnings(cached);
    } else {
      renderEarningsEmpty('Loading earnings data...');
      renderEarningsMiningEmpty('Loading mining earnings data...');
      renderEarningsCargoEmpty('Loading cargo earnings data...');
      renderEarningsMarketplaceLoading('Loading Marketplace data...');
      setEarningsStatus('Loading earnings data...');
      setEarningsMiningStatus('Loading mining earnings data...');
      setEarningsCargoStatus('Loading cargo earnings data...');
    }

    let diagnosticStage = 'ipc_invoke';
    try {
      const result = await api.getEarningsSnapshot(settings);
      if (result && result.ok === false) {
        // IPC handler returns {ok: false, error} on failure. Throw so the
        // catch block can apply the same rate-limit / generic handling.
        diagnosticStage = 'backend_response';
        throw new Error(result.error || 'Earnings snapshot failed');
      }
      diagnosticStage = 'renderer_processing';
      if (!requestGuard.isCurrent(request, getRefreshContext())) return;
      if (!result || typeof result !== 'object' || result.ok !== true) {
        Promise.resolve(api.recordEarningsRendererError?.({
          correlationId: `earnings-renderer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          faction,
          stage: 'renderer_validation',
          error: { name: 'Error', message: 'Invalid Earnings snapshot response', code: '', stack: '' },
        })).catch(() => {});
      }
      renderEarnings(result);
    } catch (error) {
      console.error(error);
      Promise.resolve(api.recordEarningsRendererError?.({
        correlationId: `earnings-renderer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        faction,
        stage: typeof diagnosticStage === 'string' ? diagnosticStage : 'renderer_catch',
        error: {
          name: String(error?.name || 'Error').slice(0, 80),
          message: String(error?.message || error || 'unknown_error').slice(0, 512),
          code: String(error?.code || '').slice(0, 80),
          stack: String(error?.stack || '').slice(0, 2048),
        },
      })).catch(() => {});
      if (!requestGuard.isCurrent(request, getRefreshContext())) return;
      if (cached) return; // keep stale UI visible; do not clobber with an error
      const message = String(error?.message || '');
      if (message.startsWith('RPC_RATE_LIMIT:')) {
        // Extract retry-after hint from the main-process error string and
        // surface a clear, non-scary status. Format produced by
        // fetchWithRpcBackoff in main.js: `RPC_RATE_LIMIT: HTTP <s> (...) retry_after=<ms>ms`.
        const match = /retry_after=(\d+)ms/.exec(message);
        const waitSec = match ? Math.max(1, Math.ceil(Number(match[1]) / 1000)) : 60;
        const status = `RPC rate-limited — retry in ${waitSec}s`;
        renderEarningsEmpty(status);
        renderEarningsMiningEmpty(status);
        renderEarningsCargoEmpty(status);
        setEarningsStatus(status);
        setEarningsMiningStatus(status);
        setEarningsCargoStatus(status);
      } else {
        renderEarningsEmpty('Earnings data unavailable');
        renderEarningsMiningEmpty('Mining earnings data unavailable');
        renderEarningsCargoEmpty('Cargo earnings data unavailable');
        setEarningsStatus('Earnings sync failed');
        setEarningsMiningStatus('Earnings sync failed');
        setEarningsCargoStatus('Earnings sync failed');
      }
    }
  })();
  earningsRefreshInFlight = refreshPromise;
  refreshPromise.finally(() => {
    if (earningsRefreshInFlight === refreshPromise) earningsRefreshInFlight = null;
  });
  return refreshPromise;
}

function optimizationFilterIso(input, includeWholeDay = false) {
  if (!input?.value) return '';
  const date = new Date(`${input.value}T00:00:00Z`);
  if (includeWholeDay) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function formatOptimizationUtcDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
}

function optimizationCellValue(column, value) {
  if (value === null || value === undefined || value === '') return '--';
  if (column === 'time') return formatOptimizationUtcDateTime(value);
  return String(value);
}

function compareOptimizationValues(left, right) {
  const leftEmpty = left === null || left === undefined || left === '';
  const rightEmpty = right === null || right === undefined || right === '';
  if (leftEmpty || rightEmpty) return leftEmpty === rightEmpty ? 0 : (leftEmpty ? 1 : -1);
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  const leftDate = Date.parse(left);
  const rightDate = Date.parse(right);
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
  if (/^(true|false)$/i.test(String(left)) && /^(true|false)$/i.test(String(right))) return String(left).localeCompare(String(right));
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function getOrderedOptimizationColumns(columns) {
  const preferred = ['time', 'fleet', 'event_type', 'operation'];
  return [...columns].sort((a, b) => {
    const ai = preferred.indexOf(a);
    const bi = preferred.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b);
  });
}

function renderOptimizationColumnControls() {
  if (!optimizationColumnList) return;
  optimizationColumnList.replaceChildren();
  if (currentOptimizationSubtab === 'upgrading' && currentOptimizationView === 'analytics') {
    for (const column of upgradingBreakevenColumns) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = upgradingBreakevenSelectedColumns.has(column.key);
      input.addEventListener('change', () => {
        if (input.checked) upgradingBreakevenSelectedColumns.add(column.key);
        else upgradingBreakevenSelectedColumns.delete(column.key);
        persistUpgradingBreakevenColumnState();
        renderUpgradingBreakevenTable();
      });
      label.append(input, document.createTextNode(` ${column.label}`));
      optimizationColumnList.append(label);
    }
    return;
  }
  if (currentOptimizationSubtab === 'upgrading') {
    for (const column of optimizationUpgradingColumns) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = optimizationUpgradingSelectedColumns.has(column.key);
      input.addEventListener('change', () => {
        if (input.checked) optimizationUpgradingSelectedColumns.add(column.key);
        else optimizationUpgradingSelectedColumns.delete(column.key);
        renderUpgradingOptimizationTable();
      });
      label.append(input, document.createTextNode(` ${column.label}`));
      optimizationColumnList.append(label);
    }
    return;
  }
  for (const column of optimizationColumns) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = optimizationSelectedColumns.has(column);
    input.addEventListener('change', () => {
      if (input.checked) optimizationSelectedColumns.add(column);
      else optimizationSelectedColumns.delete(column);
      persistOptimizationColumnState();
      renderOptimizationTable();
    });
    label.append(input, document.createTextNode(` ${column}`));
    optimizationColumnList.append(label);
  }
}

function renderOptimizationTable() {
  const visible = optimizationColumns.filter((column) => optimizationSelectedColumns.has(column));
  optimizationTableHead?.replaceChildren();
  for (const column of visible) {
    const th = document.createElement('th');
    th.className = 'earnings-sortable-th';
    if (optimizationSort.key === column) th.classList.add('earnings-sort-active');
    th.textContent = column;
    const arrow = document.createElement('span');
    arrow.className = 'earnings-sort-arrow';
    arrow.textContent = optimizationSort.key === column ? (optimizationSort.direction === 'desc' ? '▼' : '▲') : '';
    th.append(arrow);
    th.addEventListener('click', () => {
      if (optimizationSort.key !== column) optimizationSort = { key: column, direction: 'desc' };
      else if (optimizationSort.direction === 'desc') optimizationSort.direction = 'asc';
      else optimizationSort = { key: 'time', direction: 'desc' };
      renderOptimizationTable();
    });
    optimizationTableHead?.append(th);
  }
  optimizationTableBody?.replaceChildren();
  const direction = optimizationSort.direction === 'asc' ? 1 : -1;
  const rows = [...optimizationRows].sort((a, b) => {
    const left = a[optimizationSort.key];
    const right = b[optimizationSort.key];
    const leftEmpty = left === null || left === undefined || left === '';
    const rightEmpty = right === null || right === undefined || right === '';
    if (leftEmpty || rightEmpty) return leftEmpty === rightEmpty ? 0 : (leftEmpty ? 1 : -1);
    return compareOptimizationValues(left, right) * direction;
  });
  if (!rows.length || !visible.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = Math.max(1, visible.length);
    td.textContent = rows.length ? 'Select at least one column' : 'No optimization rows match the current filters';
    tr.append(td);
    optimizationTableBody?.append(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of visible) {
      const td = document.createElement('td');
      td.textContent = optimizationCellValue(column, row[column]);
      tr.append(td);
    }
    optimizationTableBody?.append(tr);
  }
}

function populateOptimizationFilter(select, rows, key, allLabel) {
  const selected = select?.value || '__all__';
  const values = Array.from(new Set(rows.map((row) => row[key]).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
  select?.replaceChildren(new Option(allLabel, '__all__'), ...values.map((value) => new Option(value, value)));
  select.value = values.includes(selected) ? selected : '__all__';
}

function filterScanningOptimizationRowsByFaction(rows, faction) {
  const selectedFaction = normalizeFaction(faction);
  return (rows || []).filter((row) => {
    const rowFaction = String(row?.faction || '').trim().toUpperCase();
    const normalizedRowFaction = rowFaction === 'UST' ? 'USTUR' : rowFaction;
    return normalizedRowFaction === selectedFaction;
  });
}

function getOptimizationExperimentId(row) {
  return String(row?.experimentId || row?.experiment_id || '').trim();
}

function parseScanningOptimizationValues(row) {
  try {
    const parsed = typeof row?.optimizationValues === 'string' ? JSON.parse(row.optimizationValues) : row?.optimizationValues;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length) return parsed;
  } catch (_error) {}
  const parameter = String(row?.optimizationParameter || '').trim();
  const value = Number(row?.optimizationValue);
  return parameter && Number.isFinite(value) ? { [parameter]: value } : {};
}

const scanningOptimizationParameterNames = Object.freeze({
  scanMin: 'minProb',
  scanMin2: 'instantStrikeoutProb',
  scanMin3: 'successStrikeoutProb',
});

function normalizeScanningOptimizationParameter(parameter) {
  return scanningOptimizationParameterNames[String(parameter || '')] || String(parameter || '').replace(/^scan/, '').replace(/^./, character => character.toLowerCase());
}

function buildScanningOptimizationExperimentCatalog(rows, onlyOptimization = true) {
  const scanRows = (Array.isArray(rows) ? rows : []).filter((row) => String(row?.event_type || row?.eventType || '') === 'scan_result');
  const experimentAliases = new Map();
  for (const row of scanRows) {
    const experimentId = getOptimizationExperimentId(row);
    const previousExperimentId = String(row?.previousExperimentId || row?.previous_experiment_id || '').trim();
    if(experimentId && previousExperimentId && previousExperimentId !== experimentId) experimentAliases.set(previousExperimentId, experimentId);
  }
  const canonicalExperimentId = (id) => {
    let current = String(id || '').trim();
    const seen = new Set();
    while(experimentAliases.has(current) && !seen.has(current)) {
      seen.add(current);
      current = experimentAliases.get(current);
    }
    return current;
  };
  const experimentMetadata = new Map();
  for (const row of scanRows) {
    const experimentId = canonicalExperimentId(getOptimizationExperimentId(row));
    const time = Date.parse(String(row?.time || ''));
    if(!experimentId || !Number.isFinite(time)) continue;
    const existing = experimentMetadata.get(experimentId) || { experimentId, earliest: time, latest: time };
    existing.earliest = Math.min(existing.earliest, time);
    existing.latest = Math.max(existing.latest, time);
    experimentMetadata.set(experimentId, existing);
  }
  const experiments = [...experimentMetadata.values()].map((metadata) => {
    const readableDate = metadata.experimentId.match(/^(?:scan|record)-(\d\d\d\d)(\d\d)(\d\d)-/);
    const type = metadata.experimentId.startsWith('record-') ? 'recording' : 'optimization';
    return {
      ...metadata,
      type,
      date: readableDate ? `${readableDate[1]}-${readableDate[2]}-${readableDate[3]}` : new Date(metadata.earliest).toISOString().slice(0, 10),
    };
  }).filter((metadata) => !onlyOptimization || metadata.type === 'optimization')
    .sort((a, b) => b.latest - a.latest || b.experimentId.localeCompare(a.experimentId));
  const dateMap = new Map();
  for(const metadata of experiments) {
    if(!dateMap.has(metadata.date)) dateMap.set(metadata.date, { date: metadata.date, hasOptimization: false, hasRecording: false, experiments: [] });
    const entry = dateMap.get(metadata.date);
    entry.hasOptimization ||= metadata.type === 'optimization';
    entry.hasRecording ||= metadata.type === 'recording';
    entry.experiments.push(metadata.experimentId);
  }
  return {
    experiments: experiments.map((metadata) => metadata.experimentId),
    dates: [...dateMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
    metadata: experiments,
  };
}

function buildScanningOptimizationAnalytics(rows, selectedExperiment = '__latest__', options = null) {
  const allRows = Array.isArray(rows) ? rows : [];
  const scanRows = allRows.filter((row) => String(row?.event_type || row?.eventType || '') === 'scan_result');
  const experimentAliases = new Map();
  for (const row of allRows) {
    const experimentId = getOptimizationExperimentId(row);
    const previousExperimentId = String(row?.previousExperimentId || row?.previous_experiment_id || '').trim();
    if(experimentId && previousExperimentId && previousExperimentId !== experimentId) experimentAliases.set(previousExperimentId, experimentId);
  }
  const canonicalExperimentId = (id) => {
    let current = String(id || '').trim();
    const seen = new Set();
    while(experimentAliases.has(current) && !seen.has(current)) {
      seen.add(current);
      current = experimentAliases.get(current);
    }
    return current;
  };
  const onlyOptimization = options?.onlyOptimization !== false;
  const catalog = buildScanningOptimizationExperimentCatalog(scanRows, onlyOptimization);
  const selectedDate = String(options?.startDate || '');
  const experimentDate = new Map(catalog.metadata.map((metadata) => [metadata.experimentId, metadata.date]));
  const experiments = catalog.experiments.filter((id) => !selectedDate || experimentDate.get(id) === selectedDate);
  const requestedExperimentId = canonicalExperimentId(String(selectedExperiment || ''));
  const experimentId = selectedExperiment === '__latest__' || !experiments.includes(requestedExperimentId) ? (experiments[0] || '') : requestedExperimentId;
  const selectedRows = allRows.filter((row) => canonicalExperimentId(getOptimizationExperimentId(row)) === experimentId)
    .sort((a, b) => Date.parse(String(a.time || '')) - Date.parse(String(b.time || '')));
  const selectedScanRows = selectedRows.filter((row) => String(row?.event_type || row?.eventType || '') === 'scan_result');
  const runtimeCompletedScans = selectedScanRows.reduce((maximum, row) => {
    const value = Number(row?.optimizationCompletedScans);
    return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
  }, 0);
  const runtimeTotalScans = selectedScanRows.reduce((maximum, row) => {
    const value = Number(row?.optimizationTotalScans);
    return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
  }, 0);
  const getIdentity = (row) => {
    const values = parseScanningOptimizationValues(row);
    const entries = Object.entries(values).filter(([, value]) => Number.isFinite(Number(value)))
      .map(([parameter, value]) => [normalizeScanningOptimizationParameter(parameter), value]);
    if(!entries.length) return null;
    const combination = entries.map(([parameter, value]) => `${parameter}=${Number(value)}`).join(' × ');
    const parameter = entries.length === 1 ? entries[0][0] : 'Combined';
    const value = entries.length === 1 ? Number(entries[0][1]) : combination;
    const rawBlockIndex = Number(row?.optimizationBlockIndex);
    const blockIndex = Number.isInteger(rawBlockIndex) && rawBlockIndex >= 0 ? rawBlockIndex : null;
    return { blockIndex, parameter, value, combination, key: blockIndex == null ? `${parameter}\u0000${value}` : `block:${blockIndex}` };
  };
  const previousByFleet = new Map();
  const samples = [];
  for (const row of selectedScanRows) {
    const timeMs = Date.parse(String(row?.time || ''));
    const identity = getIdentity(row);
    if(!Number.isFinite(timeMs) || !identity) continue;
    const fleet = String(row?.fleet || 'unknown');
    const previous = previousByFleet.get(fleet);
    previousByFleet.set(fleet, timeMs);
    const cycleHours = Number.isFinite(previous) && timeMs > previous ? (timeMs - previous) / 3600000 : null;
    samples.push({
      timeMs, fleet, ...identity,
      sdu: Number(row?.sduFound || 0),
      chance: Number.isFinite(Number(row?.chance)) ? Number(row.chance) : null,
      burnedFood: Number(row?.burnedFood || 0),
      hasPauseTelemetry: Object.prototype.hasOwnProperty.call(row, 'pauseSeconds'),
      pauseCount: Number(row?.pauseCount || 0),
      pauseSeconds: Number(row?.pauseSeconds || 0),
      resupplyExcludedSeconds: Number(row?.resupplyExcludedSeconds || 0),
      txCostSol: Number(row?.txCostSol || 0),
      txSuccess: row?.success === true || String(row?.success).toLowerCase() === 'true',
      scanSuccess: Number(row?.sduFound || 0) > 0,
      cycleHours,
      sectorX: Number(row?.resultSectorX),
      sectorY: Number(row?.resultSectorY),
    });
  }
  const grouped = new Map();
  for (const sample of samples) {
    if(!grouped.has(sample.key)) grouped.set(sample.key, { blockIndex: sample.blockIndex, parameter: sample.parameter, value: sample.value, samples: [] });
    grouped.get(sample.key).samples.push(sample);
  }
  const eventRowsByKey = new Map();
  for(const row of selectedRows) {
    const identity = getIdentity(row);
    const timeMs = Date.parse(String(row?.time || ''));
    if(!identity || !Number.isFinite(timeMs) || !grouped.has(identity.key)) continue;
    if(!eventRowsByKey.has(identity.key)) eventRowsByKey.set(identity.key, []);
    eventRowsByKey.get(identity.key).push({ row, timeMs });
  }
  const starts = [...eventRowsByKey.entries()].map(([key, events]) => ({ key, timeMs: Math.min(...events.map((event) => event.timeMs)) }))
    .sort((a, b) => a.timeMs - b.timeMs);
  const nextStartByKey = new Map(starts.map((entry, index) => [entry.key, starts[index + 1]?.timeMs ?? null]));
  const prices = options?.prices && typeof options.prices === 'object' ? options.prices : {};
  const pricedCost = (quantity, price) => {
    if(quantity == null) return null;
    const amount = Number(quantity || 0);
    if(amount === 0) return 0;
    const unitPrice = Number(price);
    return Number.isFinite(unitPrice) ? amount * unitPrice : null;
  };
  const groups = [...grouped.entries()].map(([key, group]) => {
    const scans = group.samples.length;
    const successfulTransactions = group.samples.filter((sample) => sample.txSuccess).length;
    const successfulScans = group.samples.filter((sample) => sample.txSuccess && sample.scanSuccess).length;
    const totalSdu = group.samples.reduce((sum, sample) => sum + sample.sdu, 0);
    const timed = group.samples.filter((sample) => Number.isFinite(sample.cycleHours) && sample.cycleHours > 0);
    const observedHours = timed.reduce((sum, sample) => sum + sample.cycleHours, 0);
    const estimatedHours = timed.length ? observedHours / timed.length * scans : 0;
    const events = eventRowsByKey.get(key) || [];
    const startedAtMs = events.length ? Math.min(...events.map((event) => event.timeMs)) : null;
    const latestAtMs = events.length ? Math.max(...events.map((event) => event.timeMs)) : null;
    const boundaryAtMs = nextStartByKey.get(key);
    const rawElapsedSeconds = Number.isFinite(startedAtMs)
      ? Math.max(0, ((Number.isFinite(boundaryAtMs) ? boundaryAtMs : latestAtMs) - startedAtMs) / 1000)
      : estimatedHours * 3600;
    const resupplyExcludedSeconds = group.samples.reduce((sum, sample) => sum + sample.resupplyExcludedSeconds, 0);
    const elapsedSeconds = Math.max(0, rawElapsedSeconds - resupplyExcludedSeconds);
    const effectiveHours = elapsedSeconds > 0 ? elapsedSeconds / 3600 : estimatedHours;
    const chances = group.samples.map((sample) => sample.chance).filter(Number.isFinite);
    const hasPauseTelemetry = group.samples.every((sample) => sample.hasPauseTelemetry);
    const pauseCount = hasPauseTelemetry ? group.samples.reduce((sum, sample) => sum + sample.pauseCount, 0) : null;
    const pausedSeconds = hasPauseTelemetry ? group.samples.reduce((sum, sample) => sum + sample.pauseSeconds, 0) : null;
    const movementTransactions = events.filter(({ row }) => ['WARP', 'SUBWARP'].includes(String(row?.operation || '').toUpperCase()));
    const movementEvents = events.filter(({ row }) => String(row?.movementPhase || '').toLowerCase() === 'start' && !(row?.resupplyExcluded === true || String(row?.resupplyExcluded).toLowerCase() === 'true'));
    const hasMovementTelemetry = movementTransactions.length === 0 || movementEvents.length > 0;
    const movementSeconds = hasMovementTelemetry ? movementEvents.reduce((sum, { row }) => sum + Number(row?.movementSeconds || 0), 0) : null;
    const cooldownOverlapSeconds = hasMovementTelemetry ? movementEvents.reduce((sum, { row }) => sum + Number(row?.cooldownOverlapSeconds || 0), 0) : null;
    const opportunityCostMovementSeconds = hasMovementTelemetry ? movementEvents.reduce((sum, { row }) => sum + Number(row?.opportunityCostMovementSeconds || 0), 0) : null;
    const burnedFood = group.samples.reduce((sum, sample) => sum + sample.burnedFood, 0);
    const burnedFuel = hasMovementTelemetry ? movementEvents.reduce((sum, { row }) => sum + Number(row?.burnedFuel || 0), 0) : null;
    const txCostsBySignature = new Map();
    for(const { row, timeMs } of events) {
      if(row?.resupplyExcluded === true || String(row?.resupplyExcluded).toLowerCase() === 'true') continue;
      const cost = Number(row?.txCostSol || 0);
      if(!Number.isFinite(cost) || cost <= 0) continue;
      const signature = String(row?.signature || '').trim();
      const key = signature || `${String(row?.event_type || row?.eventType || '')}:${timeMs}`;
      txCostsBySignature.set(key, Math.max(txCostsBySignature.get(key) || 0, cost));
    }
    const txCostSol = [...txCostsBySignature.values()].reduce((sum, cost) => sum + cost, 0);
    const grossRevenueAtlas = pricedCost(totalSdu, prices.sduPriceAtl);
    const foodCostAtlas = pricedCost(burnedFood, prices.foodPriceAtl);
    const fuelCostAtlas = pricedCost(burnedFuel, prices.fuelPriceAtl);
    const txCostAtlas = pricedCost(txCostSol, prices.solPriceAtl);
    const costs = [foodCostAtlas, fuelCostAtlas, txCostAtlas];
    const totalCostAtlas = costs.every(Number.isFinite) ? costs.reduce((sum, value) => sum + value, 0) : null;
    const netAtlas = Number.isFinite(grossRevenueAtlas) && Number.isFinite(totalCostAtlas) ? grossRevenueAtlas - totalCostAtlas : null;
    return {
      ...group,
      scans,
      totalSdu,
      averageScanChance: chances.length ? chances.reduce((sum, value) => sum + value, 0) / chances.length : null,
      sduPerScan: scans ? totalSdu / scans : 0,
      sduPerHour: effectiveHours > 0 ? totalSdu / effectiveHours : 0,
      sduPerDay: effectiveHours > 0 ? totalSdu / effectiveHours * 24 : 0,
      txSuccessRate: scans ? successfulTransactions / scans * 100 : 0,
      scanSuccessRate: successfulTransactions ? successfulScans / successfulTransactions * 100 : 0,
      elapsedSeconds,
      pauseCount,
      pausedSeconds,
      movementSeconds,
      cooldownOverlapSeconds,
      opportunityCostMovementSeconds,
      burnedFood,
      burnedFuel,
      txCostSol,
      grossRevenueAtlas,
      foodCostAtlas,
      fuelCostAtlas,
      txCostAtlas,
      totalCostAtlas,
      netAtlas,
      netAtlasPerHour: Number.isFinite(netAtlas) && effectiveHours > 0 ? netAtlas / effectiveHours : null,
      netAtlasPerDay: Number.isFinite(netAtlas) && effectiveHours > 0 ? netAtlas / effectiveHours * 24 : null,
      resupplyExcludedSeconds,
    };
  }).sort((a, b) => (a.blockIndex ?? Number.MAX_SAFE_INTEGER) - (b.blockIndex ?? Number.MAX_SAFE_INTEGER) || a.parameter.localeCompare(b.parameter) || Number(a.value) - Number(b.value) || String(a.value).localeCompare(String(b.value)));
  return {
    experimentId,
    experiments,
    catalog,
    samples,
    groups,
    priceSnapshot: { ...prices },
    runtimeCompletedScans,
    runtimeTotalScans,
    unavailableHistoricalScans: Math.max(0, runtimeCompletedScans - samples.length),
    fleets: [...new Set(samples.map((sample) => sample.fleet))],
    startedAt: selectedRows[0]?.time || null,
    endedAt: selectedRows[selectedRows.length - 1]?.time || null,
  };
}

function optimizationAnalyticsColor(index) {
  return ['#22d3ee','#45d6c1','#f59e0b','#a78bfa','#fb7185','#84cc16','#60a5fa','#f97316'][index % 8];
}

function formatOptimizationAnalyticsDuration(seconds) {
  if(seconds == null || !Number.isFinite(Number(seconds))) return '--';
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  if(hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if(minutes) return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
  return `${remainder}s`;
}

function getScanningOptimizationChartMetric(sample, group, metric) {
  if(metric === 'averageScanChance') return Number.isFinite(sample.chance) ? sample.chance : group.averageScanChance;
  if(metric === 'sduPerScan') return sample.sdu;
  if(metric === 'scanSuccessRate') return sample.scanSuccess ? 100 : 0;
  if(metric === 'netAtlasPerDay') return group.netAtlasPerDay;
  if(metric === 'sduPerDay') return sample.cycleHours > 0 ? sample.sdu / sample.cycleHours * 24 : group.sduPerDay;
  return sample.cycleHours > 0 ? sample.sdu / sample.cycleHours : group.sduPerHour;
}

function sortScanningOptimizationAnalyticsGroups(groups, sort) {
  const column = String(sort?.column || 'averageScanChance');
  const direction = sort?.direction === 'asc' ? 'asc' : 'desc';
  const factor = direction === 'asc' ? 1 : -1;
  return [...(Array.isArray(groups) ? groups : [])].sort((left, right) => {
    const a = left?.[column];
    const b = right?.[column];
    const aMissing = a == null || (typeof a === 'number' && !Number.isFinite(a));
    const bMissing = b == null || (typeof b === 'number' && !Number.isFinite(b));
    if(aMissing !== bMissing) return aMissing ? 1 : -1;
    if(!aMissing && !bMissing) {
      const comparison = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
      if(comparison) return comparison * factor;
    }
    return Number(left?.blockIndex ?? Number.MAX_SAFE_INTEGER) - Number(right?.blockIndex ?? Number.MAX_SAFE_INTEGER);
  });
}

function createOptimizationAnalyticsSvg(container, width = 760, height = 280) {
  container?.replaceChildren();
  if(!container) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  container.append(svg);
  return svg;
}

function appendOptimizationSvg(svg, tag, attributes = {}, text = '') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for(const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if(text) node.textContent = text;
  svg.append(node);
  return node;
}

function showOptimizationAnalyticsTooltip(event, text) {
  if(!optimizationAnalyticsTooltip) return;
  const margin = 8;
  const offset = 12;
  optimizationAnalyticsTooltip.textContent = text;
  optimizationAnalyticsTooltip.hidden = false;
  const bounds = optimizationAnalyticsTooltip.getBoundingClientRect();
  const left = Math.max(margin, Math.min(event.clientX + offset, window.innerWidth - bounds.width - margin));
  const preferredTop = event.clientY + offset;
  const fallbackTop = event.clientY - bounds.height - offset;
  const top = Math.max(margin, Math.min(preferredTop + bounds.height <= window.innerHeight - margin ? preferredTop : fallbackTop, window.innerHeight - bounds.height - margin));
  optimizationAnalyticsTooltip.style.left = `${left}px`;
  optimizationAnalyticsTooltip.style.top = `${top}px`;
}

function hideOptimizationAnalyticsTooltip() {
  if(optimizationAnalyticsTooltip) optimizationAnalyticsTooltip.hidden = true;
}

function bindOptimizationAnalyticsTooltip(node, text) {
  node?.addEventListener('pointerenter', event => showOptimizationAnalyticsTooltip(event, text));
  node?.addEventListener('pointermove', event => showOptimizationAnalyticsTooltip(event, text));
  node?.addEventListener('pointerleave', hideOptimizationAnalyticsTooltip);
}

function renderScanningOptimizationDateCalendar(catalog) {
  const dates = Array.isArray(catalog?.dates) ? catalog.dates : [];
  const availableDates = new Map(dates.map((entry) => [entry.date, entry]));
  if(!availableDates.has(selectedScanningOptimizationDate)) selectedScanningOptimizationDate = dates[0]?.date || '';
  if(!scanningOptimizationCalendarMonth) scanningOptimizationCalendarMonth = selectedScanningOptimizationDate.slice(0, 7) || new Date().toISOString().slice(0, 7);
  if(optimizationAnalyticsDateSummary) optimizationAnalyticsDateSummary.textContent = selectedScanningOptimizationDate || 'No experiment dates';
  if(!optimizationAnalyticsDateCalendar) return;
  const [year, month] = scanningOptimizationCalendarMonth.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  if(!Number.isFinite(monthStart.getTime())) return;
  const monthLabel = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if(optimizationAnalyticsCalendarMonth) optimizationAnalyticsCalendarMonth.textContent = monthLabel;
  optimizationAnalyticsDateCalendar.replaceChildren();
  const leadingDays = (monthStart.getUTCDay() + 6) % 7;
  for(let index = 0; index < leadingDays; index += 1) {
    const spacer = document.createElement('span'); spacer.className = 'optimization-calendar-day-spacer'; optimizationAnalyticsDateCalendar.append(spacer);
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for(let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const entry = availableDates.get(date);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'optimization-calendar-day'; button.textContent = String(day); button.disabled = !entry;
    if(entry?.hasOptimization) button.classList.add('optimization-calendar-day--optimization');
    if(entry?.hasRecording) button.classList.add('optimization-calendar-day--recording');
    if(date === selectedScanningOptimizationDate) button.classList.add('optimization-calendar-day--selected');
    if(entry) {
      button.title = `${entry.experiments.length} experiment${entry.experiments.length === 1 ? '' : 's'} started`;
      button.addEventListener('click', () => {
        selectedScanningOptimizationDate = date;
        if(optimizationAnalyticsExperiment) optimizationAnalyticsExperiment.value = '__latest__';
        optimizationAnalyticsDatePicker?.removeAttribute('open');
        renderScanningOptimizationAnalytics();
      });
    }
    optimizationAnalyticsDateCalendar.append(button);
  }
}

function moveScanningOptimizationCalendarMonth(offset) {
  const [year, month] = scanningOptimizationCalendarMonth.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + offset, 1));
  scanningOptimizationCalendarMonth = Number.isFinite(next.getTime()) ? next.toISOString().slice(0, 7) : new Date().toISOString().slice(0, 7);
  const rows = optimizationAnalyticsRows.length ? optimizationAnalyticsRows : optimizationRows;
  renderScanningOptimizationDateCalendar(buildScanningOptimizationExperimentCatalog(rows, optimizationAnalyticsOnlyOptimization?.checked !== false));
}

function renderScanningOptimizationValueChart(analytics, metric, selectedParameter) {
  const parameterGroups = selectedParameter === '__all__' ? analytics.groups : analytics.groups.filter((group) => group.parameter === selectedParameter);
  optimizationAnalyticsValueChart?.replaceChildren();
  if(!parameterGroups.length) {
    const prompt = document.createElement('div');
    prompt.className = 'optimization-analytics-chart-prompt';
    prompt.textContent = 'Select a tested parameter to display its value distribution';
    optimizationAnalyticsValueChart?.append(prompt);
    return;
  }
  optimizationAnalyticsValueChart?.classList.toggle('optimization-analytics-value-chart--scrollable', selectedParameter === '__all__');
  const svg = createOptimizationAnalyticsSvg(optimizationAnalyticsValueChart);
  if(!svg) return;
  const left = 48, right = 16, top = 15, bottom = 65, width = selectedParameter === '__all__' ? Math.max(760, parameterGroups.length * 92) : 760, height = 280;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if(selectedParameter === '__all__') svg.style.width = `${width}px`;
  const values = parameterGroups.flatMap((group) => group.samples.map((sample) => {
    return getScanningOptimizationChartMetric(sample, group, metric);
  })).filter(Number.isFinite);
  const maxY = Math.max(1, ...values) * 1.08;
  for(let tick = 0; tick <= 4; tick++) {
    const y = top + (height - top - bottom) * tick / 4;
    appendOptimizationSvg(svg, 'line', { x1: left, x2: width - right, y1: y, y2: y, class: 'grid-line' });
    appendOptimizationSvg(svg, 'text', { x: left - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-label' }, (maxY * (1 - tick / 4)).toFixed(metric === 'scanSuccessRate' || metric === 'averageScanChance' ? 0 : 1));
  }
  parameterGroups.forEach((group, index) => {
    const x = parameterGroups.length === 1 ? (left + width - right) / 2 : left + index * (width - left - right) / (parameterGroups.length - 1);
    const color = optimizationAnalyticsColor(index);
    group.samples.forEach((sample, sampleIndex) => {
      const raw = getScanningOptimizationChartMetric(sample, group, metric);
      if(!Number.isFinite(raw)) return;
      const y = top + (height - top - bottom) * (1 - Math.min(maxY, raw) / maxY);
      const jitter = ((sampleIndex % 7) - 3) * 2.2;
      const dot = appendOptimizationSvg(svg, 'circle', { cx: x + jitter, cy: y, r: 3, fill: color, opacity: 0.55 });
      bindOptimizationAnalyticsTooltip(dot, `${group.parameter} ${group.value} · ${raw.toFixed(2)} · ${sample.sdu} SDU · scan ${sample.scanSuccess ? 'successful' : 'unsuccessful'} · transaction ${sample.txSuccess ? 'successful' : 'failed'} · sector ${sample.sectorX},${sample.sectorY}`);
    });
    const mean = Number(group[metric] || 0);
    const meanY = top + (height - top - bottom) * (1 - Math.min(maxY, mean) / maxY);
    const meanMarker = appendOptimizationSvg(svg, 'circle', { cx: x, cy: meanY, r: 6, fill: color, class: 'mean-marker' });
    bindOptimizationAnalyticsTooltip(meanMarker, `${group.parameter} ${group.value} · mean ${mean.toFixed(2)} · ${group.scans} scans`);
    appendOptimizationSvg(svg, 'text', { x, y: height - bottom + 14, transform: `rotate(38 ${x} ${height - bottom + 14})`, 'text-anchor': 'start', class: 'axis-label' }, selectedParameter === '__all__' ? `${group.parameter}: ${group.value}` : `${group.value}`);
  });
  appendOptimizationSvg(svg, 'text', { x: left, y: 14, class: 'axis-label' }, `${selectedParameter === '__all__' ? 'All Parameters' : selectedParameter} · ${parameterGroups.length} tested values`);
}

function renderScanningOptimizationSectorChart(analytics, selectedParameter) {
  const svg = createOptimizationAnalyticsSvg(optimizationAnalyticsSectorChart);
  const points = analytics.samples.filter((sample) => Number.isFinite(sample.sectorX) && Number.isFinite(sample.sectorY));
  if(!svg || !points.length) return;
  const width = 760, height = 280, pad = 30;
  const minX = Math.min(...points.map((point) => point.sectorX)), maxX = Math.max(...points.map((point) => point.sectorX));
  const minY = Math.min(...points.map((point) => point.sectorY)), maxY = Math.max(...points.map((point) => point.sectorY));
  const groupIndex = new Map(analytics.groups.filter((group) => group.parameter === selectedParameter).map((group, index) => [`${group.parameter}\u0000${group.value}`, index]));
  const project = (point) => ({
    x: pad + (point.sectorX - minX) / Math.max(1, maxX - minX) * (width - pad * 2),
    y: height - pad - (point.sectorY - minY) / Math.max(1, maxY - minY) * (height - pad * 2),
  });
  const defs = appendOptimizationSvg(svg, 'defs');
  const marker = appendOptimizationSvg(defs, 'marker', { id: 'optimization-route-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
  appendOptimizationSvg(marker, 'path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'optimization-route-arrow-head' });
  for(let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if(previous.sectorX === point.sectorX && previous.sectorY === point.sectorY) continue;
    const start = project(previous); const end = project(point);
    const route = appendOptimizationSvg(svg, 'line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: 'optimization-route-line', 'marker-end': 'url(#optimization-route-arrow)' });
    bindOptimizationAnalyticsTooltip(route, `${previous.sectorX},${previous.sectorY} → ${point.sectorX},${point.sectorY}`);
  }
  points.forEach((point, pointIndex) => {
    const { x, y } = project(point);
    const index = groupIndex.get(`${point.parameter}\u0000${point.value}`) ?? 0;
    const dot = appendOptimizationSvg(svg, 'circle', { cx: x, cy: y, r: pointIndex === 0 || pointIndex === points.length - 1 ? 6 : (point.sdu > 0 ? 5 : 3), fill: optimizationAnalyticsColor(index), opacity: point.sdu > 0 ? 0.92 : 0.5, class: pointIndex === 0 ? 'optimization-route-start' : (pointIndex === points.length - 1 ? 'optimization-route-end' : '') });
    bindOptimizationAnalyticsTooltip(dot, `${pointIndex === 0 ? 'Start · ' : pointIndex === points.length - 1 ? 'End · ' : ''}${point.sectorX},${point.sectorY} · ${point.combination} · ${point.sdu} SDU · scan ${point.scanSuccess ? 'successful' : 'unsuccessful'}`);
  });
  appendOptimizationSvg(svg, 'text', { x: pad, y: 14, class: 'axis-label' }, `X ${minX}…${maxX} · Y ${minY}…${maxY} · arrows show scan order`);
}

function renderScanningOptimizationAnalytics() {
  const selected = optimizationAnalyticsExperiment?.value || '__latest__';
  const rows = optimizationAnalyticsRows.length ? optimizationAnalyticsRows : optimizationRows;
  const onlyOptimization = optimizationAnalyticsOnlyOptimization?.checked !== false;
  const catalog = buildScanningOptimizationExperimentCatalog(rows, onlyOptimization);
  if(!catalog.dates.some((entry) => entry.date === selectedScanningOptimizationDate)) {
    selectedScanningOptimizationDate = catalog.dates[0]?.date || '';
    scanningOptimizationCalendarMonth = selectedScanningOptimizationDate.slice(0, 7);
  }
  renderScanningOptimizationDateCalendar(catalog);
  const analytics = buildScanningOptimizationAnalytics(rows, selected, { onlyOptimization, startDate: selectedScanningOptimizationDate, prices: optimizationAnalyticsPrices });
  if(optimizationAnalyticsExperiment) {
    const prior = selected;
    optimizationAnalyticsExperiment.replaceChildren(new Option('Latest experiment', '__latest__'), ...analytics.experiments.map((id) => new Option(id, id)));
    optimizationAnalyticsExperiment.value = analytics.experiments.includes(prior) ? prior : '__latest__';
  }
  optimizationAnalyticsSummary?.replaceChildren();
  optimizationAnalyticsEconomics?.replaceChildren();
  optimizationAnalyticsRanking?.replaceChildren();
  if(!analytics.experimentId || !analytics.samples.length) {
    if(optimizationAnalyticsStatus) optimizationAnalyticsStatus.textContent = 'No scan_result rows with optimization values are loaded for this experiment';
    optimizationAnalyticsValueChart?.replaceChildren();
    optimizationAnalyticsSectorChart?.replaceChildren();
    optimizationAnalyticsParameter?.replaceChildren();
    const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 11; td.textContent = 'Awaiting scan results'; tr.append(td); optimizationAnalyticsRanking?.append(tr);
    return;
  }
  const metric = optimizationAnalyticsMetric?.value || 'averageScanChance';
  const parameters = [...new Set(analytics.groups.map((group) => group.parameter))].sort((a, b) => a.localeCompare(b));
  if(selectedScanningOptimizationParameter !== '__all__' && !parameters.includes(selectedScanningOptimizationParameter)) selectedScanningOptimizationParameter = '__all__';
  if(optimizationAnalyticsParameter) {
    const prior = selectedScanningOptimizationParameter;
    optimizationAnalyticsParameter.replaceChildren(new Option('All Parameters', '__all__'), ...parameters.map((parameter) => new Option(parameter, parameter)));
    optimizationAnalyticsParameter.value = prior === '__all__' || parameters.includes(prior) ? prior : '__all__';
    selectedScanningOptimizationParameter = optimizationAnalyticsParameter.value;
  }
  const parameterGroups = selectedScanningOptimizationParameter === '__all__'
    ? analytics.groups
    : analytics.groups.filter((group) => group.parameter === selectedScanningOptimizationParameter);
  const rankingGroups = parameterGroups;
  for(const header of optimizationAnalyticsRankingHead?.querySelectorAll('[data-optimization-analytics-sort]') || []) {
    const active = header.dataset.optimizationAnalyticsSort === optimizationAnalyticsSort.column;
    header.textContent = `${header.dataset.label || header.textContent}${active ? (optimizationAnalyticsSort.direction === 'asc' ? ' ▲' : ' ▼') : ''}`;
    header.setAttribute('aria-sort', active ? (optimizationAnalyticsSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
  }
  const totals = analytics.groups.reduce((result, group) => {
    result.scans += group.scans;
    result.totalSdu += group.totalSdu;
    result.elapsedSeconds += group.elapsedSeconds;
    result.chanceWeighted += Number.isFinite(group.averageScanChance) ? group.averageScanChance * group.scans : 0;
    result.chanceScans += Number.isFinite(group.averageScanChance) ? group.scans : 0;
    for(const key of ['pausedSeconds', 'movementSeconds', 'opportunityCostMovementSeconds']) {
      result[key] = Number.isFinite(result[key]) && Number.isFinite(group[key]) ? result[key] + group[key] : null;
    }
    for(const key of ['grossRevenueAtlas', 'foodCostAtlas', 'fuelCostAtlas', 'txCostAtlas', 'totalCostAtlas', 'netAtlas']) {
      result[key] = Number.isFinite(result[key]) && Number.isFinite(group[key]) ? result[key] + group[key] : null;
    }
    return result;
  }, { scans: 0, totalSdu: 0, elapsedSeconds: 0, chanceWeighted: 0, chanceScans: 0, pausedSeconds: 0, movementSeconds: 0, opportunityCostMovementSeconds: 0, grossRevenueAtlas: 0, foodCostAtlas: 0, fuelCostAtlas: 0, txCostAtlas: 0, totalCostAtlas: 0, netAtlas: 0 });
  const elapsedHours = totals.elapsedSeconds / 3600;
  const averageScanChance = totals.chanceScans ? totals.chanceWeighted / totals.chanceScans : null;
  const sduPerDay = elapsedHours > 0 ? totals.totalSdu / elapsedHours * 24 : 0;
  const netAtlasPerDay = elapsedHours > 0 && Number.isFinite(totals.netAtlas) ? totals.netAtlas / elapsedHours * 24 : null;
  const metrics = [
    ['Average Scan Chance', Number.isFinite(averageScanChance) ? `${averageScanChance.toFixed(2)}%` : '--'],
    ['SDU / day', sduPerDay.toFixed(2)],
    ['Net ATLAS / day', Number.isFinite(netAtlasPerDay) ? formatAtlas(netAtlasPerDay, 2) : '--'],
    ['Paused Time', formatOptimizationAnalyticsDuration(totals.pausedSeconds)],
    ['Movement Time', formatOptimizationAnalyticsDuration(totals.movementSeconds)],
    ['Opportunity-Cost Movement', formatOptimizationAnalyticsDuration(totals.opportunityCostMovementSeconds)],
    ['Scan Count', totals.scans.toLocaleString()],
    ['Elapsed Time', formatOptimizationAnalyticsDuration(totals.elapsedSeconds)],
  ];
  for(const [label, value] of metrics) {
    const div = document.createElement('div'); div.className = 'optimization-analytics-metric';
    const span = document.createElement('span'); span.textContent = label; const strong = document.createElement('strong'); strong.textContent = value;
    div.append(span, strong); optimizationAnalyticsSummary?.append(div);
  }
  if(optimizationAnalyticsEconomics) {
    const prices = analytics.priceSnapshot || {};
    const checkedAt = prices.checkedAt ? new Date(prices.checkedAt).toLocaleString() : 'unavailable';
    const label = document.createElement('strong');
    label.textContent = 'Net ATLAS audit: ';
    const detail = document.createTextNode(Number.isFinite(totals.netAtlas)
      ? `${formatAtlas(totals.grossRevenueAtlas, 2)} gross revenue − ${formatAtlas(totals.foodCostAtlas, 2)} food − ${formatAtlas(totals.fuelCostAtlas, 2)} movement fuel − ${formatAtlas(totals.txCostAtlas, 2)} transaction/SOL costs = ${formatAtlas(totals.netAtlas, 2)} net. Current price snapshot: ${checkedAt}; resources: ${prices.resourcePriceSource || 'unavailable'}; SOL/ATLAS: ${prices.atlasPerSolSource || 'unavailable'}.`
      : 'unavailable because one or more current resource or SOL/ATLAS prices could not be loaded.');
    optimizationAnalyticsEconomics.append(label, detail);
  }
  if(optimizationAnalyticsStatus) {
    const runtimeProgress = analytics.runtimeTotalScans > 0
      ? ` · runtime progress ${analytics.runtimeCompletedScans.toLocaleString()}/${analytics.runtimeTotalScans.toLocaleString()}`
      : '';
    const unavailable = analytics.unavailableHistoricalScans > 0
      ? ` · ${analytics.unavailableHistoricalScans.toLocaleString()} historical scans unavailable`
      : '';
    const rankingScope = selectedScanningOptimizationParameter === '__all__' ? 'all parameters' : selectedScanningOptimizationParameter;
    optimizationAnalyticsStatus.textContent = `${analytics.samples.length.toLocaleString()} telemetry scans analyzed${runtimeProgress}${unavailable} · ${analytics.experimentId} · ranking ${rankingScope} · charting ${selectedScanningOptimizationParameter || 'no parameter'}`;
  }
  for(const group of sortScanningOptimizationAnalyticsGroups(rankingGroups, optimizationAnalyticsSort)) {
    const tr = document.createElement('tr');
    for(const value of [
      group.blockIndex == null ? '--' : `#${group.blockIndex + 1}`,
      group.parameter,
      group.value,
      group.scans,
      Number.isFinite(group.averageScanChance) ? `${group.averageScanChance.toFixed(2)}%` : '--',
      group.sduPerDay.toFixed(2),
      Number.isFinite(group.netAtlasPerDay) ? formatAtlas(group.netAtlasPerDay, 2) : '--',
      formatOptimizationAnalyticsDuration(group.pausedSeconds),
      formatOptimizationAnalyticsDuration(group.movementSeconds),
      formatOptimizationAnalyticsDuration(group.opportunityCostMovementSeconds),
      formatOptimizationAnalyticsDuration(group.elapsedSeconds),
    ]) {
      const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
    }
    tr.title = Number.isFinite(group.netAtlas)
      ? `${formatAtlas(group.grossRevenueAtlas, 2)} gross − ${formatAtlas(group.foodCostAtlas, 2)} food − ${formatAtlas(group.fuelCostAtlas, 2)} fuel − ${formatAtlas(group.txCostAtlas, 2)} transaction/SOL = ${formatAtlas(group.netAtlas, 2)} net`
      : 'Net ATLAS unavailable because one or more prices are missing';
    optimizationAnalyticsRanking?.append(tr);
  }
  if(!rankingGroups.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 11; td.textContent = 'No optimization blocks for this table parameter'; tr.append(td); optimizationAnalyticsRanking?.append(tr);
  }
  renderScanningOptimizationValueChart(analytics, metric, selectedScanningOptimizationParameter);
  renderScanningOptimizationSectorChart(analytics, selectedScanningOptimizationParameter);
}

function optimizationQuantile(values, fraction) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if(!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index); const upper = Math.ceil(index);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function buildUpgradingOptimizationAnalytics(result, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const factionByDay = new Map((result?.factionDaily || []).map((row) => [String(row.date), Number(row.lp)]));
  const playerByDay = new Map((result?.playerDaily || []).map((row) => [String(row.date), Number(row.lp)]));
  const redemptionRateByDay = new Map((result?.redemptionRates || []).map((row) => [String(row.date), Number(row.atlasPerLp)]));
  const actualByDay = new Map((result?.netAtlasDaily || []).map((row) => [String(row.date), {
    lp: Number(row.lp), componentCost: Number(row.componentCost), netAtlas: Number(row.netAtlas ?? row.netAtlasProfit),
  }]));
  const neutralByDay = new Map((result?.neutralUpgradingDaily || []).map((row) => [String(row.date), {
    lp: Number(row.lp), componentCost: Number(row.componentCost),
  }]));
  const latestCrewByHour = new Map();
  for(const row of result?.rows || []) {
    const time = String(row.time || row._time || ''); const ms = Date.parse(time); const crew = Number(row.phantom_crew ?? row.phantomCrew);
    if(!Number.isFinite(ms) || !Number.isFinite(crew) || crew <= 0) continue;
    const date = new Date(ms); const day = date.toISOString().slice(0, 10); const hour = date.getUTCHours(); const key = `${day}|${hour}`;
    if(!latestCrewByHour.has(key) || ms > latestCrewByHour.get(key).ms) latestCrewByHour.set(key, { day, crew, ms });
  }
  const crewValuesByDay = new Map();
  for(const point of latestCrewByHour.values()) { if(!crewValuesByDay.has(point.day)) crewValuesByDay.set(point.day, []); crewValuesByDay.get(point.day).push(point.crew); }
  const averageCrewByDay = new Map([...crewValuesByDay].map(([day, values]) => [day, values.reduce((sum, value) => sum + value, 0) / values.length]));
  const scatter = [...factionByDay].filter(([date]) => date < today && playerByDay.has(date) && Number(averageCrewByDay.get(date)) > 0)
    .map(([date, factionLp]) => { const playerLp = playerByDay.get(date); const averageCrew = averageCrewByDay.get(date); return { date, factionLp, playerLp, averageCrew, playerLpPerCrew: playerLp / averageCrew }; })
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const responseScatter = [...playerByDay].filter(([date, playerLp]) => date < today && Number.isFinite(redemptionRateByDay.get(date)) && Number.isFinite(playerLp) && Number(averageCrewByDay.get(date)) > 0)
    .map(([date, playerLp]) => { const atlasPerLp = redemptionRateByDay.get(date); const averageCrew = averageCrewByDay.get(date); return { date, atlasPerLp, playerLp, averageCrew, lpPerCrew: playerLp / averageCrew }; })
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const componentCostScatter = [...actualByDay].filter(([date, row]) => date < today && Number.isFinite(redemptionRateByDay.get(date)) && Number.isFinite(row.componentCost) && Number(averageCrewByDay.get(date)) > 0)
    .map(([date, row]) => { const atlasPerLp = redemptionRateByDay.get(date); const averageCrew = averageCrewByDay.get(date); return { date, atlasPerLp, componentCost: row.componentCost, averageCrew, componentCostPerCrew: row.componentCost / averageCrew }; })
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const upliftScatter = [...actualByDay].filter(([date, actual]) => {
    const neutral = neutralByDay.get(date); const rate = redemptionRateByDay.get(date); const crew = averageCrewByDay.get(date);
    return date < today && neutral && Number.isFinite(rate) && Number.isFinite(actual.lp) && Number.isFinite(actual.componentCost) && Number.isFinite(neutral.lp) && Number.isFinite(neutral.componentCost) && Number(crew) > 0;
  }).map(([date, actual]) => {
    const neutral = neutralByDay.get(date); const atlasPerLp = redemptionRateByDay.get(date); const averageCrew = averageCrewByDay.get(date);
    const uplift = (actual.lp - neutral.lp) * atlasPerLp - (actual.componentCost - neutral.componentCost);
    return { date, atlasPerLp, actualLp: actual.lp, neutralLp: neutral.lp, actualComponentCost: actual.componentCost, neutralComponentCost: neutral.componentCost, averageCrew, uplift, upliftPerCrew: uplift / averageCrew };
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const latestByHour = new Map();
  for(const row of result?.rows || []) {
    const time = String(row.time || row._time || ''); const ms = Date.parse(time); const value = Number(row.expected_total_lp_eod);
    if(!Number.isFinite(ms) || !Number.isFinite(value)) continue;
    const date = new Date(ms); const day = date.toISOString().slice(0, 10); const hour = date.getUTCHours(); const key = `${day}|${hour}`;
    if(!latestByHour.has(key) || ms > latestByHour.get(key).ms) latestByHour.set(key, { day, hour, value, ms });
  }
  const byDay = new Map();
  for(const point of latestByHour.values()) { if(!byDay.has(point.day)) byDay.set(point.day, []); byDay.get(point.day).push(point); }
  const forecasts = [...byDay].map(([day, points]) => ({ day, points: points.sort((a,b) => a.hour-b.hour).slice(1), actual: day < today ? factionByDay.get(day) ?? null : null, today: day === today }))
    .filter((day) => day.points.length)
    .sort((a,b) => a.day.localeCompare(b.day)).slice(-30);
  const errors = new Map();
  for(const day of forecasts) if(Number.isFinite(day.actual)) for(const point of day.points) {
    if(!errors.has(point.hour)) errors.set(point.hour, []); errors.get(point.hour).push(point.value - day.actual);
  }
  const errorByHour = [...errors].sort((a,b) => a[0]-b[0]).map(([hour, values]) => ({ hour, median: optimizationQuantile(values,.5), q25: optimizationQuantile(values,.25), q75: optimizationQuantile(values,.75), count: values.length }));
  const latestFactionRedemption = [...factionByDay].filter(([date, lp]) => date < today && Number.isFinite(lp)).sort((a, b) => a[0].localeCompare(b[0])).at(-1);
  return { scatter, responseScatter, componentCostScatter, upliftScatter, forecasts, errorByHour, latestFactionRedemption: latestFactionRedemption ? { date: latestFactionRedemption[0], factionLp: latestFactionRedemption[1] } : null };
}

function getUpgradingComparisonScales(results, now = new Date()) {
  const analytics = (results || []).map((result) => buildUpgradingOptimizationAnalytics(result, now));
  return {
    playerLpPerCrewMax: Math.max(1, ...analytics.flatMap((entry) => entry.scatter.map((row) => row.playerLpPerCrew)).filter(Number.isFinite)),
    forecastErrorBound: Math.max(1, ...analytics.flatMap((entry) => entry.errorByHour.flatMap((row) => [Math.abs(row.q25), Math.abs(row.q75)])).filter(Number.isFinite)),
  };
}

function mapUpgradingChartY(value, minY, maxY, top, bottom) {
  return top + (maxY - value) / Math.max(Number.EPSILON, maxY - minY) * (bottom - top);
}

function renderUpgradingChartAxes(svg, { minY = 0, maxY = 1, xMin = 0, xMax = 24, xTicks = [0,6,12,18,24], xLabel = '', yLabel = '', height = 280, xFormatter = null, yFormatter = null } = {}) {
  const width=760,left=74,right=16,top=12,bottom=48;
  const x=(value)=>left+(value-xMin)/Math.max(Number.EPSILON,xMax-xMin)*(width-left-right); const y=(value)=>mapUpgradingChartY(value,minY,maxY,top,height-bottom);
  for(let tick=0;tick<=4;tick++){ const value=minY+(maxY-minY)*(4-tick)/4; const yy=top+(height-top-bottom)*tick/4; appendOptimizationSvg(svg,'line',{x1:left,x2:width-right,y1:yy,y2:yy,class:'grid-line'}); appendOptimizationSvg(svg,'text',{x:left-6,y:yy+3,'text-anchor':'end',class:'axis-label'},yFormatter ? yFormatter(value) : formatCompactNumber(value)); }
  for(const value of xTicks) appendOptimizationSvg(svg,'text',{x:x(value),y:height-bottom+16,'text-anchor':'middle',class:'axis-label'},xFormatter ? xFormatter(value) : (Math.abs(value) >= 1000 ? formatCompactNumber(value) : String(Math.round(value))));
  if(xLabel) appendOptimizationSvg(svg,'text',{x:(left+width-right)/2,y:height-5,'text-anchor':'middle',class:'axis-label optimization-axis-title'},xLabel);
  if(yLabel) appendOptimizationSvg(svg,'text',{x:12,y:(top+height-bottom)/2,'text-anchor':'middle',transform:`rotate(-90 12 ${(top+height-bottom)/2})`,class:'axis-label optimization-axis-title'},yLabel);
  return { x, y, width, height, left, right, top, bottom };
}


const upgradingMarginComponents = Object.freeze([
  ['Power Source', 98], ['Framework', 68], ['Electromagnet', 133], ['Electronics', 92],
  ['Field Stabilizer', 222], ['Particle Accelerator', 498], ['Radiation Absorber', 331],
  ['Survey Data Unit', 1325], ['Ink', 100000],
]);
const upgradingFactionColors = Object.freeze({ MUD: '#ef4444', ONI: '#3b82f6', USTUR: '#f59e0b' });
const upgradingDurationSeconds = Object.freeze({ 'Power Source': 15, Framework: 12, Electromagnet: 16, Electronics: 14, 'Field Stabilizer': 24, 'Particle Accelerator': 96, 'Radiation Absorber': 48, 'Survey Data Unit': 120, Ink: 60 });
const upgradingCargoWeight = Object.freeze({ 'Power Source': 2, Framework: 1, Electromagnet: 4, Electronics: 2, 'Field Stabilizer': 6, 'Particle Accelerator': 6, 'Radiation Absorber': 6, 'Survey Data Unit': 1, Ink: 1 });
const selectedUpgradingRedemptionComponents = new Set(upgradingMarginComponents.map(([name]) => name).filter((name) => name !== 'Ink'));
const upgradingRedemptionChartView = { xMin: 10_000_000_000, xMax: 50_000_000_000, netYMin: null, netYMax: null, marginYMin: null, marginYMax: null };
const upgradingScatterChartView = { xMin: null, xMax: null, scatterYMin: null, scatterYMax: null };
const upgradingLpPerCrewByRateChartView = { xMin: null, xMax: null, lpPerCrewByRateYMin: null, lpPerCrewByRateYMax: null };
const upgradingComponentCostByRateChartView = { xMin: null, xMax: null, componentCostByRateYMin: null, componentCostByRateYMax: null };
const upgradingUpliftByRateChartView = { xMin: null, xMax: null, upliftByRateYMin: null, upliftByRateYMax: null };
const upgradingTimeChartView = { xMin: null, xMax: null, forecastYMin: null, forecastYMax: null, errorYMin: null, errorYMax: null };
const upgradingEfficiencyChartView = { xMin: null, xMax: null, efficiencyYMin: null, efficiencyYMax: null };
const selectedUpgradingEfficiencyComponents = new Set(upgradingMarginComponents.map(([name]) => name).filter((name) => name !== 'Ink'));
let animateUpgradingEfficiencyNextRender = false;
const upgradingEfficiencyPointPositions = new Map();

function setUpgradingBreakevenCostBasis(basis) {
  const next = Object.values(UPGRADING_BREAKEVEN_BASISES).includes(basis) ? basis : UPGRADING_BREAKEVEN_BASISES.external;
  if (upgradingBreakevenCostBasis === next) return;
  upgradingBreakevenCostBasis = next;
  persistUpgradingBreakevenCostBasis();
  syncUpgradingBreakevenBasisToggle();
  const analytics = buildUpgradingOptimizationAnalytics(latestUpgradingOptimizationResult || {});
  renderUpgradingBreakevenTable();
  renderUpgradingNetAtlasChart(analytics);
  renderUpgradingMarginChart(analytics);
  renderUpgradingEfficiencyChart(analytics);
}

function syncUpgradingBreakevenBasisToggle() {
  for (const button of [optimizationUpgradingBreakevenBasisExternalButton, optimizationUpgradingBreakevenBasisInternalButton, optimizationUpgradingBreakevenBasisEqualNetButton, optimizationUpgradingBreakevenBasisCustomButton]) {
    if (!button) continue;
    const pressed = button.dataset?.basis === upgradingBreakevenCostBasis;
    button.classList.toggle('active', pressed);
    button.setAttribute('aria-pressed', String(pressed));
  }
}

optimizationUpgradingBreakevenBasisExternalButton?.addEventListener('click', () => setUpgradingBreakevenCostBasis(UPGRADING_BREAKEVEN_BASISES.external));
optimizationUpgradingBreakevenBasisInternalButton?.addEventListener('click', () => setUpgradingBreakevenCostBasis(UPGRADING_BREAKEVEN_BASISES.internal));
optimizationUpgradingBreakevenBasisEqualNetButton?.addEventListener('click', () => setUpgradingBreakevenCostBasis(UPGRADING_BREAKEVEN_BASISES.equalNet));
optimizationUpgradingBreakevenBasisCustomButton?.addEventListener('click', () => setUpgradingBreakevenCostBasis(UPGRADING_BREAKEVEN_BASISES.custom));
syncUpgradingBreakevenBasisToggle();
function buildUpgradingMarginSeries(result, xMin = 10_000_000_000, xMax = 50_000_000_000) {
  const atlasPool = Number(result?.atlasPool), prices = result?.componentPricesAtl || {};
  if (!Number.isFinite(atlasPool) || atlasPool <= 0) return [];
  const firstPositiveFactionLp = xMin > 0 ? xMin : Math.max(1, xMax / 100);
  return upgradingMarginComponents.map(([name, lp]) => {
    const price = Number(prices[String(name).toLowerCase()]);
    if (!Number.isFinite(price) || price <= 0) return null;
    const durationSeconds = Number(upgradingDurationSeconds[name]);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
    const points = Array.from({ length: 101 }, (_, index) => { const factionLp = firstPositiveFactionLp + (xMax - firstPositiveFactionLp) * index / 100; const impliedAtlasValue = atlasPool / factionLp * lp; return { factionLp, impliedAtlasValue, marginPercent: (impliedAtlasValue / price - 1) * 100, netAtlasPerSecond: (impliedAtlasValue - price) / durationSeconds }; });
    return { name, lp, price, durationSeconds, points };
  }).filter(Boolean);
}

function applyUpgradingMarginCostBasis(series, basis, faction) {
  const latestFactionLp = Number(buildUpgradingOptimizationAnalytics(latestUpgradingOptimizationResult || {}).latestFactionRedemption?.factionLp);
  const referenceRows = applyUpgradingCostBasis(buildUpgradingEfficiencyRows(latestUpgradingOptimizationResult || {}, latestFactionLp), basis, faction);
  const priceByIdentity = new Map(referenceRows.map((row) => [upgradingComponentIdentity(row.name), row]));
  return series.map((entry) => {
    const reference = priceByIdentity.get(upgradingComponentIdentity(entry.name));
    const selectedPrice = reference?.appliedPrice;
    if (!Number.isFinite(selectedPrice) || selectedPrice < 0) return null;
    return {
      ...entry,
      price: selectedPrice,
      externalPrice: entry.price,
      costBasis: basis,
      points: entry.points.map((point) => {
        const impliedAtlasValue = Number.isFinite(point.impliedAtlasValue) ? point.impliedAtlasValue : entry.price * (point.marginPercent + 100) / 100;
        const metrics = calculateUpgradingProfitability({ ...entry, ...point, impliedAtlasValue, grossAtlasPerSecond: impliedAtlasValue / entry.durationSeconds }, selectedPrice);
        return { ...point, impliedAtlasValue, marginPercent: metrics.marginPercent, netAtlasPerSecond: metrics.netAtlasPerSecond };
      }),
    };
  }).filter(Boolean);
}
function calculateUpgradingRedemptionDragView(view, mode, dx, dy, width, height, options = null) {
  const xFloor = options?.xFloor ?? null;
  const xMinSpan = Number.isFinite(options?.xMinSpan) ? options.xMinSpan : Number.EPSILON;
  const xMaxSpan = Number.isFinite(options?.xMaxSpan) ? options.xMaxSpan : Number.MAX_VALUE;
  const next = { ...view }, xSpan = view.xMax - view.xMin, ySpan = view.yMax - view.yMin;
  if (mode === 'x-zoom') { const span = Math.max(xMinSpan, Math.min(xMaxSpan, xSpan * Math.exp(dx / Math.max(1, width) * 2))); const center = (view.xMin + view.xMax) / 2; next.xMin = center - span / 2; next.xMax = center + span / 2; }
  if (mode === 'y-zoom') { const span = Math.max(Number.EPSILON, ySpan * Math.exp(-dy / Math.max(1, height) * 2)); const center = (view.yMin + view.yMax) / 2; next.yMin = center - span / 2; next.yMax = center + span / 2; }
  if (mode === 'pan') { const xShift = -dx / Math.max(1, width) * xSpan, yShift = dy / Math.max(1, height) * ySpan; next.xMin = view.xMin + xShift; next.xMax = view.xMax + xShift; next.yMin = view.yMin + yShift; next.yMax = view.yMax + yShift; }
  if (Number.isFinite(xFloor) && next.xMin < xFloor) { const span = next.xMax - next.xMin; next.xMin = xFloor; next.xMax = xFloor + span; }
  return next;
}

function normalizeUpgradingWheelDelta(event) {
  const unit = event?.deltaMode === 1 ? 16 : (event?.deltaMode === 2 ? 240 : 1);
  return Math.max(-80, Math.min(80, Number(event?.deltaY || 0) * unit));
}

function bindUpgradingRedemptionChartNavigation(svg, axes, analytics, chartKey, yMin, yMax) {
  const plotWidth = axes.width - axes.left - axes.right, plotHeight = axes.height - axes.top - axes.bottom;
  const plotArea = appendOptimizationSvg(svg, 'rect', { x: axes.left, y: axes.top, width: plotWidth, height: plotHeight, fill: 'transparent', class: 'optimization-chart-pan-area' });
  svg.insertBefore(plotArea, svg.firstChild);
  const xAxisArea = appendOptimizationSvg(svg, 'rect', { x: axes.left, y: axes.height - axes.bottom, width: plotWidth, height: axes.bottom, fill: 'transparent', class: 'optimization-chart-axis-drag optimization-chart-axis-drag-x' });
  const yAxisArea = appendOptimizationSvg(svg, 'rect', { x: 0, y: axes.top, width: axes.left, height: plotHeight, fill: 'transparent', class: 'optimization-chart-axis-drag optimization-chart-axis-drag-y' });
  const renderBoth = () => { renderUpgradingNetAtlasChart(analytics); renderUpgradingMarginChart(analytics); };
  const startDrag = (mode, event) => {
    event.preventDefault();
    hideOptimizationAnalyticsTooltip();
    const start = { xMin: upgradingRedemptionChartView.xMin, xMax: upgradingRedemptionChartView.xMax, yMin, yMax }, startX = event.clientX, startY = event.clientY;
    const move = (moveEvent) => { const next = calculateUpgradingRedemptionDragView(start, mode, moveEvent.clientX - startX, moveEvent.clientY - startY, plotWidth, plotHeight, { xFloor: 0, xMinSpan: 100_000_000, xMaxSpan: 100_000_000_000 }); upgradingRedemptionChartView.xMin = next.xMin; upgradingRedemptionChartView.xMax = next.xMax; upgradingRedemptionChartView[`${chartKey}YMin`] = next.yMin; upgradingRedemptionChartView[`${chartKey}YMax`] = next.yMax; renderBoth(); };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  };
  xAxisArea.addEventListener('pointerdown', (event) => startDrag('x-zoom', event));
  yAxisArea.addEventListener('pointerdown', (event) => startDrag('y-zoom', event));
  plotArea.addEventListener('pointerdown', (event) => startDrag('pan', event));
  xAxisArea.addEventListener('wheel', (event) => { event.preventDefault(); const next = calculateUpgradingRedemptionDragView({ xMin: upgradingRedemptionChartView.xMin, xMax: upgradingRedemptionChartView.xMax, yMin, yMax }, 'x-zoom', normalizeUpgradingWheelDelta(event), 0, plotWidth, plotHeight, { xFloor: 0, xMinSpan: 100_000_000, xMaxSpan: 100_000_000_000 }); upgradingRedemptionChartView.xMin = next.xMin; upgradingRedemptionChartView.xMax = next.xMax; renderBoth(); }, { passive: false });
  yAxisArea.addEventListener('wheel', (event) => { event.preventDefault(); const next = calculateUpgradingRedemptionDragView({ xMin: upgradingRedemptionChartView.xMin, xMax: upgradingRedemptionChartView.xMax, yMin, yMax }, 'y-zoom', 0, -normalizeUpgradingWheelDelta(event), plotWidth, plotHeight, { xFloor: 0 }); upgradingRedemptionChartView[`${chartKey}YMin`] = next.yMin; upgradingRedemptionChartView[`${chartKey}YMax`] = next.yMax; renderBoth(); }, { passive: false });
  svg.addEventListener('dblclick', (event) => { event.preventDefault(); upgradingRedemptionChartView.xMin = 10_000_000_000; upgradingRedemptionChartView.xMax = 50_000_000_000; upgradingRedemptionChartView[`${chartKey}YMin`] = null; upgradingRedemptionChartView[`${chartKey}YMax`] = null; renderBoth(); });
}

function bindUpgradingAnalyticsChartNavigation(svg, axes, analytics, chartKey, view, defaultView) {
  const plotWidth = axes.width - axes.left - axes.right, plotHeight = axes.height - axes.top - axes.bottom;
  const plotArea = appendOptimizationSvg(svg, 'rect', { x: axes.left, y: axes.top, width: plotWidth, height: plotHeight, fill: 'transparent', class: 'optimization-chart-pan-area' });
  svg.insertBefore(plotArea, svg.firstChild);
  const xAxisArea = appendOptimizationSvg(svg, 'rect', { x: axes.left, y: axes.height - axes.bottom, width: plotWidth, height: axes.bottom, fill: 'transparent', class: 'optimization-chart-axis-drag optimization-chart-axis-drag-x' });
  const yAxisArea = appendOptimizationSvg(svg, 'rect', { x: 0, y: axes.top, width: axes.left, height: plotHeight, fill: 'transparent', class: 'optimization-chart-axis-drag optimization-chart-axis-drag-y' });
  const startDrag = (mode, event) => {
    event.preventDefault(); hideOptimizationAnalyticsTooltip();
    const start = { xMin: Number.isFinite(view.xMin) ? view.xMin : defaultView.xMin, xMax: Number.isFinite(view.xMax) ? view.xMax : defaultView.xMax, yMin: Number.isFinite(view[`${chartKey}YMin`]) ? view[`${chartKey}YMin`] : defaultView.yMin, yMax: Number.isFinite(view[`${chartKey}YMax`]) ? view[`${chartKey}YMax`] : defaultView.yMax }, startX = event.clientX, startY = event.clientY;
    const move = (moveEvent) => { const next = calculateUpgradingRedemptionDragView(start, mode, moveEvent.clientX - startX, moveEvent.clientY - startY, plotWidth, plotHeight, { xFloor: defaultView.xFloor }); view.xMin = next.xMin; view.xMax = next.xMax; view[`${chartKey}YMin`] = next.yMin; view[`${chartKey}YMax`] = next.yMax; renderUpgradingOptimizationAnalytics(); };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  };
  xAxisArea.addEventListener('pointerdown', (event) => startDrag('x-zoom', event)); yAxisArea.addEventListener('pointerdown', (event) => startDrag('y-zoom', event)); plotArea.addEventListener('pointerdown', (event) => startDrag('pan', event));
  const wheelZoom = (mode, event) => { event.preventDefault(); const start = { xMin: Number.isFinite(view.xMin) ? view.xMin : defaultView.xMin, xMax: Number.isFinite(view.xMax) ? view.xMax : defaultView.xMax, yMin: Number.isFinite(view[`${chartKey}YMin`]) ? view[`${chartKey}YMin`] : defaultView.yMin, yMax: Number.isFinite(view[`${chartKey}YMax`]) ? view[`${chartKey}YMax`] : defaultView.yMax }; const next = calculateUpgradingRedemptionDragView(start, mode, mode === 'x-zoom' ? normalizeUpgradingWheelDelta(event) : 0, mode === 'y-zoom' ? -normalizeUpgradingWheelDelta(event) : 0, plotWidth, plotHeight, { xFloor: defaultView.xFloor }); view.xMin = next.xMin; view.xMax = next.xMax; view[`${chartKey}YMin`] = next.yMin; view[`${chartKey}YMax`] = next.yMax; renderUpgradingOptimizationAnalytics(); };
  xAxisArea.addEventListener('wheel', (event) => wheelZoom('x-zoom', event), { passive: false }); yAxisArea.addEventListener('wheel', (event) => wheelZoom('y-zoom', event), { passive: false });
  svg.addEventListener('dblclick', (event) => { event.preventDefault(); view.xMin = null; view.xMax = null; view[`${chartKey}YMin`] = null; view[`${chartKey}YMax`] = null; renderUpgradingOptimizationAnalytics(); });
}

function buildUpgradingEfficiencyRows(result, factionLp) {
  const atlasPool = Number(result?.atlasPool);
  const prices = result?.componentPricesAtl || {};
  if (!Number.isFinite(atlasPool) || atlasPool <= 0 || !Number.isFinite(factionLp) || factionLp <= 0) return [];
  const rows = upgradingMarginComponents.map(([name, lp]) => {
    const gmPrice = Number(prices[String(name).toLowerCase()]);
    const durationSeconds = Number(upgradingDurationSeconds[name]);
    const cargoWeight = Number(upgradingCargoWeight[name]);
    if (!Number.isFinite(gmPrice) || gmPrice <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
    const lpPerSecond = lp / durationSeconds;
    const impliedAtlasValue = atlasPool / factionLp * lp;
    const grossAtlasPerSecond = lpPerSecond * atlasPool / factionLp;
    const netAtlasPerSecond = grossAtlasPerSecond - gmPrice / durationSeconds;
    const marginPercent = (impliedAtlasValue / gmPrice - 1) * 100;
    const netAtlasPerCargoUnit = (impliedAtlasValue - gmPrice) / cargoWeight;
    return { name, lp, gmPrice, durationSeconds, cargoWeight, lpPerSecond, impliedAtlasValue, marginPercent, grossAtlasPerSecond, netAtlasPerSecond, netAtlasPerCargoUnit };
  }).filter(Boolean);
  return rows;
}

function applyUpgradingCostBasis(rows, basis, faction) {
  const internalCosts = getUpgradingBreakevenInternalCosts(faction);
  const profile = getActivePlayerProfile(latestSettings || {}) || '';
  const customPrices = {};
  for (const row of rows) {
    const key = upgradingCustomPriceScopeKey(profile, faction, row.name);
    if (Object.prototype.hasOwnProperty.call(upgradingCustomPriceOverrides, key)) customPrices[row.name] = upgradingCustomPriceOverrides[key];
  }
  return applyUpgradingPriceBasis(rows, basis, { internalPrices: internalCosts.byAsset, customPrices }).rows;
}

function getUpgradingBasisInfo(rows, basis) {
  if (basis === UPGRADING_BREAKEVEN_BASISES.internal) return 'Basis: Internal · Production Cost';
  if (basis === UPGRADING_BREAKEVEN_BASISES.equalNet) {
    const benchmark = rows.find((row) => row.equalNetBenchmark)?.equalNetBenchmark || calculateUpgradingEqualNetRows(rows).benchmark;
    return benchmark ? `Basis: Equal Net · Benchmark: ${benchmark.name} · ${benchmark.netAtlasPerSecond.toFixed(6)} Net ATLAS/s` : 'Basis: Equal Net · Benchmark: —';
  }
  if (basis === UPGRADING_BREAKEVEN_BASISES.custom) {
    const count = rows.filter((row) => row.customOverridden).length;
    return `Basis: Custom · ${count} overrides · remaining prices External`;
  }
  return 'Basis: External · GM Price';
}

function appendUpgradingBasisInfo(svg, rows, basis) {
  if (!svg) return;
  appendOptimizationSvg(svg, 'text', { x: 748, y: 14, 'text-anchor': 'end', class: 'axis-label optimization-basis-info' }, getUpgradingBasisInfo(rows, basis));
}

function markUpgradingDominatedRows(rows, includeCargo = true) {
  return rows.map((row) => ({ ...row, dominated: rows.some((other) => other !== row && other.marginPercent >= row.marginPercent && other.netAtlasPerSecond >= row.netAtlasPerSecond && (!includeCargo || other.cargoWeight <= row.cargoWeight) && (other.marginPercent > row.marginPercent || other.netAtlasPerSecond > row.netAtlasPerSecond || (includeCargo && other.cargoWeight < row.cargoWeight))) }));
}

function renderUpgradingEfficiencyLegend(rows, analytics) {
  if (!optimizationUpgradingEfficiencyLegend) return;
  optimizationUpgradingEfficiencyLegend.replaceChildren();
  rows.forEach((row, index) => {
    const button = document.createElement('button');
    const selected = selectedUpgradingEfficiencyComponents.has(row.name);
    button.type = 'button'; button.className = `optimization-efficiency-legend-button${selected ? ' selected' : ''}`;
    button.textContent = row.name === 'Ink' ? 'INK' : row.name; button.style.setProperty('--component-color', getAssetChartColor(row.name, index)); button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => { if (selected) selectedUpgradingEfficiencyComponents.delete(row.name); else selectedUpgradingEfficiencyComponents.add(row.name); renderUpgradingEfficiencyChart(analytics); });
    optimizationUpgradingEfficiencyLegend.append(button);
  });
}

function renderUpgradingEfficiencyChart(analytics) {
  const svg = createOptimizationAnalyticsSvg(optimizationUpgradingEfficiencyChart, 760, 340);
  if (!svg) return;
  const baseRows = buildUpgradingEfficiencyRows(latestUpgradingOptimizationResult || {}, Number(analytics.latestFactionRedemption?.factionLp));
  const faction = normalizeFaction(latestSettings?.faction);
  const basisRows = applyUpgradingCostBasis(baseRows, upgradingBreakevenCostBasis, faction);
  appendUpgradingBasisInfo(svg, basisRows, upgradingBreakevenCostBasis);
  renderUpgradingEfficiencyLegend(basisRows, analytics);
  const rows = markUpgradingDominatedRows(basisRows.filter((row) => selectedUpgradingEfficiencyComponents.has(row.name) && Number.isFinite(row.marginPercent) && Number.isFinite(row.netAtlasPerSecond)), true);
  if (!rows.length) { appendOptimizationSvg(svg, 'text', { x: 380, y: 170, 'text-anchor': 'middle', class: 'axis-label' }, 'Select at least one component'); return; }
  const margins = rows.map((row) => row.marginPercent), nets = rows.map((row) => row.netAtlasPerSecond);
  const xPad = Math.max(1, (Math.max(...margins) - Math.min(...margins)) * 0.12), yPad = Math.max(0.000001, (Math.max(...nets) - Math.min(...nets)) * 0.12);
  const autoMinX = Math.min(...margins) - xPad, autoMaxX = Math.max(...margins) + xPad, autoMinY = Math.min(...nets) - yPad, autoMaxY = Math.max(...nets) + yPad;
  const minX = Number.isFinite(upgradingEfficiencyChartView.xMin) ? upgradingEfficiencyChartView.xMin : autoMinX, maxX = Number.isFinite(upgradingEfficiencyChartView.xMax) ? upgradingEfficiencyChartView.xMax : autoMaxX, minY = Number.isFinite(upgradingEfficiencyChartView.efficiencyYMin) ? upgradingEfficiencyChartView.efficiencyYMin : autoMinY, maxY = Number.isFinite(upgradingEfficiencyChartView.efficiencyYMax) ? upgradingEfficiencyChartView.efficiencyYMax : autoMaxY;
  const axes = renderUpgradingChartAxes(svg, { minY, maxY, xMin: minX, xMax: maxX, xTicks: [minX, minX + (maxX-minX)/4, minX + (maxX-minX)/2, minX + (maxX-minX)*3/4, maxX], xLabel: 'Profit margin at yesterday’s faction LP (%)', yLabel: 'Net ATLAS/s', height: 340, xFormatter: (value) => value.toFixed(1), yFormatter: (value) => value.toFixed(6) });
  if (minX <= 0 && maxX >= 0) appendOptimizationSvg(svg, 'line', { x1: axes.x(0), x2: axes.x(0), y1: axes.top, y2: axes.height - axes.bottom, class: 'optimization-zero-line' });
  if (minY <= 0 && maxY >= 0) appendOptimizationSvg(svg, 'line', { x1: axes.left, x2: axes.width - axes.right, y1: axes.y(0), y2: axes.y(0), class: 'optimization-zero-line' });
  const frontier = markUpgradingDominatedRows(rows, false).filter((row) => !row.dominated).sort((a, b) => a.marginPercent - b.marginPercent);
  if (frontier.length > 1) appendOptimizationSvg(svg, 'polyline', { points: frontier.map((row) => `${axes.x(row.marginPercent)},${axes.y(row.netAtlasPerSecond)}`).join(' '), fill: 'none', class: 'optimization-pareto-frontier' });
  rows.forEach((row, index) => {
    const cx = axes.x(row.marginPercent), cy = axes.y(row.netAtlasPerSecond), radius = 5 + Math.sqrt(row.cargoWeight) * 2;
    const group = appendOptimizationSvg(svg, 'g', { class: 'optimization-efficiency-point' });
    const dot = appendOptimizationSvg(group, 'circle', { cx, cy, r: radius, fill: getAssetChartColor(row.name, index), opacity: row.dominated ? 0.38 : 0.9, stroke: row.dominated ? '#cbd5e1' : '#e8fffb', 'stroke-width': row.dominated ? 1 : 2 });
    bindOptimizationAnalyticsTooltip(dot, `${row.name} · profit margin ${row.marginPercent.toFixed(1)}% · net ${row.netAtlasPerSecond.toFixed(6)} ATLAS/s · net ${row.netAtlasPerCargoUnit.toFixed(6)} ATLAS/cargo unit`);
    appendOptimizationSvg(group, 'text', { x: cx + radius + 3, y: cy + 3, class: 'axis-label optimization-efficiency-label' }, row.name);
    if (row.dominated) { const size = radius * 0.75; appendOptimizationSvg(group, 'line', { x1: cx-size, y1: cy-size, x2: cx+size, y2: cy+size, class: 'optimization-dominated-cross' }); appendOptimizationSvg(group, 'line', { x1: cx-size, y1: cy+size, x2: cx+size, y2: cy-size, class: 'optimization-dominated-cross' }); }
    const previous = upgradingEfficiencyPointPositions.get(row.name);
    if (animateUpgradingEfficiencyNextRender && previous && group.animate) group.animate([{ transform: `translate(${previous.cx-cx}px, ${previous.cy-cy}px)` }, { transform: 'translate(0px, 0px)' }], { duration: 3000, easing: 'ease-in-out' });
    upgradingEfficiencyPointPositions.set(row.name, { cx, cy });
  });
  animateUpgradingEfficiencyNextRender = false;
  bindUpgradingAnalyticsChartNavigation(svg, axes, analytics, 'efficiency', upgradingEfficiencyChartView, { xMin: autoMinX, xMax: autoMaxX, yMin: autoMinY, yMax: autoMaxY });
}

function renderUpgradingRedemptionLegend(analytics) {
  if (!optimizationUpgradingRedemptionLegend) return;
  optimizationUpgradingRedemptionLegend.replaceChildren();
  upgradingMarginComponents.forEach(([name], index) => {
    const button = document.createElement('button');
    const selected = selectedUpgradingRedemptionComponents.has(name);
    button.type = 'button'; button.className = `optimization-efficiency-legend-button${selected ? ' selected' : ''}`;
    button.textContent = name === 'Ink' ? 'INK' : name; button.style.setProperty('--component-color', getAssetChartColor(name, index)); button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => { if (selected) selectedUpgradingRedemptionComponents.delete(name); else selectedUpgradingRedemptionComponents.add(name); renderUpgradingRedemptionLegend(analytics); renderUpgradingNetAtlasChart(analytics); renderUpgradingMarginChart(analytics); });
    optimizationUpgradingRedemptionLegend.append(button);
  });
}

function renderUpgradingNetAtlasChart(analytics) {
  const svg = createOptimizationAnalyticsSvg(optimizationUpgradingNetAtlasChart, 760, 340); if (!svg) return;
  const xMin = upgradingRedemptionChartView.xMin, xMax = upgradingRedemptionChartView.xMax;
  const faction = normalizeFaction(latestSettings?.faction);
  const series = applyUpgradingMarginCostBasis(buildUpgradingMarginSeries(latestUpgradingOptimizationResult || {}, xMin, xMax), upgradingBreakevenCostBasis, faction).filter((entry) => selectedUpgradingRedemptionComponents.has(entry.name)); if (!series.length) { appendOptimizationSvg(svg, 'text', { x: 380, y: 170, 'text-anchor': 'middle', class: 'axis-label' }, upgradingBreakevenCostBasis === UPGRADING_BREAKEVEN_BASISES.internal ? 'No internal component costs available' : 'Select at least one component'); return; }
  const basisInfoRows = applyUpgradingCostBasis(buildUpgradingEfficiencyRows(latestUpgradingOptimizationResult || {}, Number(analytics.latestFactionRedemption?.factionLp)), upgradingBreakevenCostBasis, faction);
  appendUpgradingBasisInfo(svg, basisInfoRows, upgradingBreakevenCostBasis);
  const values = series.flatMap((entry) => entry.points.map((point) => point.netAtlasPerSecond)), autoMinY = Math.min(0, ...values), autoMaxY = Math.max(0, ...values), padding = Math.max(0.000001, (autoMaxY - autoMinY) * 0.08);
  const minY = Number.isFinite(upgradingRedemptionChartView.netYMin) ? upgradingRedemptionChartView.netYMin : autoMinY - padding, maxY = Number.isFinite(upgradingRedemptionChartView.netYMax) ? upgradingRedemptionChartView.netYMax : autoMaxY + padding;
  const xTicks = Array.from({ length: 5 }, (_, index) => xMin + (xMax - xMin) * index / 4);
  const axes = renderUpgradingChartAxes(svg, { minY, maxY, xMin, xMax, xTicks, xLabel: 'Theoretical faction LP redemption', yLabel: 'Net ATLAS/s', height: 340, yFormatter: (value) => value.toFixed(6) });
  appendOptimizationSvg(svg, 'line', { x1: axes.left, x2: axes.width - axes.right, y1: axes.y(0), y2: axes.y(0), class: 'optimization-zero-line' });
  series.forEach((entry, index) => { const line = appendOptimizationSvg(svg, 'polyline', { points: entry.points.map((point) => `${axes.x(point.factionLp)},${axes.y(point.netAtlasPerSecond)}`).join(' '), fill: 'none', stroke: getAssetChartColor(entry.name, index), 'stroke-width': 2, class: 'optimization-margin-line' }); const costLabel = entry.costBasis === 'internal' ? 'internal cost' : 'current GM'; bindOptimizationAnalyticsTooltip(line, `${entry.name} · ${entry.lp.toLocaleString()} LP/component · ${entry.durationSeconds}s · ${costLabel} ${entry.price.toLocaleString(undefined, { maximumFractionDigits: 6 })} ATLAS`); });
  const yesterday = analytics.latestFactionRedemption;
  if (Number.isFinite(yesterday?.factionLp) && yesterday.factionLp >= xMin && yesterday.factionLp <= xMax) { const faction = normalizeFaction(latestSettings?.faction); const marker = appendOptimizationSvg(svg, 'line', { x1: axes.x(yesterday.factionLp), x2: axes.x(yesterday.factionLp), y1: axes.top, y2: axes.height - axes.bottom, stroke: upgradingFactionColors[faction] || '#45d6c1', 'stroke-width': 3, class: 'optimization-yesterday-line' }); bindOptimizationAnalyticsTooltip(marker, `${yesterday.date} · ${faction === 'USTUR' ? 'UST' : faction} faction redemption ${yesterday.factionLp.toLocaleString()} LP`); }
  bindUpgradingRedemptionChartNavigation(svg, axes, analytics, 'net', minY, maxY);
}

function renderUpgradingMarginChart(analytics) {
  const svg = createOptimizationAnalyticsSvg(optimizationUpgradingMarginChart, 760, 340); if (!svg) return;
  const xMin = upgradingRedemptionChartView.xMin, xMax = upgradingRedemptionChartView.xMax;
  const faction = normalizeFaction(latestSettings?.faction);
  const series = applyUpgradingMarginCostBasis(buildUpgradingMarginSeries(latestUpgradingOptimizationResult || {}, xMin, xMax), upgradingBreakevenCostBasis, faction).filter((entry) => selectedUpgradingRedemptionComponents.has(entry.name));
  if (!series.length) { appendOptimizationSvg(svg, 'text', { x: 380, y: 170, 'text-anchor': 'middle', class: 'axis-label' }, upgradingBreakevenCostBasis === UPGRADING_BREAKEVEN_BASISES.internal ? 'No internal component costs available' : 'Select at least one component'); return; }
  const basisInfoRows = applyUpgradingCostBasis(buildUpgradingEfficiencyRows(latestUpgradingOptimizationResult || {}, Number(analytics.latestFactionRedemption?.factionLp)), upgradingBreakevenCostBasis, faction);
  appendUpgradingBasisInfo(svg, basisInfoRows, upgradingBreakevenCostBasis);
  const values = series.flatMap((entry) => entry.points.map((point) => point.marginPercent)), autoMinY = Math.min(-100, ...values), autoMaxY = Math.max(100, ...values);
  const minY = Number.isFinite(upgradingRedemptionChartView.marginYMin) ? upgradingRedemptionChartView.marginYMin : autoMinY, maxY = Number.isFinite(upgradingRedemptionChartView.marginYMax) ? upgradingRedemptionChartView.marginYMax : autoMaxY;
  const xTicks = Array.from({ length: 5 }, (_, index) => xMin + (xMax - xMin) * index / 4);
  const axes = renderUpgradingChartAxes(svg, { minY, maxY, xMin, xMax, xTicks, xLabel: 'Theoretical faction LP redemption', yLabel: 'Component profit margin (%)', height: 340 });
  appendOptimizationSvg(svg, 'line', { x1: axes.left, x2: axes.width - axes.right, y1: axes.y(0), y2: axes.y(0), class: 'optimization-zero-line' });
  series.forEach((entry, index) => { const line = appendOptimizationSvg(svg, 'polyline', { points: entry.points.map((point) => `${axes.x(point.factionLp)},${axes.y(point.marginPercent)}`).join(' '), fill: 'none', stroke: getAssetChartColor(entry.name, index), 'stroke-width': 2, class: 'optimization-margin-line' }); const costLabel = entry.costBasis === 'internal' ? 'internal cost' : 'current GM'; bindOptimizationAnalyticsTooltip(line, `${entry.name} · ${entry.lp.toLocaleString()} LP/component · ${costLabel} ${entry.price.toLocaleString(undefined, { maximumFractionDigits: 6 })} ATLAS`); });
  const yesterday = analytics.latestFactionRedemption;
  if (Number.isFinite(yesterday?.factionLp) && yesterday.factionLp >= xMin && yesterday.factionLp <= xMax) { const faction = normalizeFaction(latestSettings?.faction); const marker = appendOptimizationSvg(svg, 'line', { x1: axes.x(yesterday.factionLp), x2: axes.x(yesterday.factionLp), y1: axes.top, y2: axes.height - axes.bottom, stroke: upgradingFactionColors[faction] || '#45d6c1', 'stroke-width': 3, class: 'optimization-yesterday-line' }); bindOptimizationAnalyticsTooltip(marker, `${yesterday.date} · ${faction === 'USTUR' ? 'UST' : faction} faction redemption ${yesterday.factionLp.toLocaleString()} LP`); }
  bindUpgradingRedemptionChartNavigation(svg, axes, analytics, 'margin', minY, maxY);
}

function renderUpgradingSelectionUtilizationV1(result) {
  const data = result?.selectionUtilizationV1;
  const unavailable = (container, reason) => { if (container) container.textContent = reason || 'Required cohort, hourly allocation, identity, or provenance evidence is incomplete.'; };
  if (!data) { for (const container of [optimizationUpgradingSelectionV1, optimizationUpgradingUtilizationV1, optimizationUpgradingClaimLockV1, optimizationUpgradingOperationalV1]) unavailable(container, 'Selection/utilization evidence is not available.'); return; }
  const completeSelection = (data.selection || []).filter((row) => row.evidence_complete && Number.isFinite(row.atlas_per_lp) && Number.isFinite(row.selection_uplift_atlas_per_active_crew_day));
  if (optimizationUpgradingSelectionV1) {
    optimizationUpgradingSelectionV1.title='Actual completed component mix versus neutral component mix replayed over the same completed-job population and protocol-active crew time. This measures selection, not uptime.';
    optimizationUpgradingSelectionV1.replaceChildren();
    const svg=createOptimizationAnalyticsSvg(optimizationUpgradingSelectionV1,760,340);
    if (!completeSelection.length) unavailable(optimizationUpgradingSelectionV1, data.selection?.[0]?.incomplete_reason || 'Matched completion-cohort evidence is incomplete.');
    else if(svg){
      const xs=completeSelection.map(r=>r.atlas_per_lp),ys=completeSelection.map(r=>r.selection_uplift_atlas_per_active_crew_day),minX=Math.min(...xs)*.96,maxX=Math.max(...xs)*1.04,pad=Math.max(.05,(Math.max(...ys)-Math.min(...ys))*.12),minY=Math.min(0,...ys)-pad,maxY=Math.max(0,...ys)+pad;
      const axes=renderUpgradingChartAxes(svg,{minY,maxY,xMin:minX,xMax:maxX,xTicks:[minX,minX+(maxX-minX)/2,maxX],xLabel:'ATLAS / LP',yLabel:'Selection uplift ATLAS / active crew-day',height:340,xFormatter:v=>v.toFixed(8),yFormatter:v=>v.toFixed(2)});
      appendOptimizationSvg(svg,'line',{x1:axes.left,x2:axes.width-axes.right,y1:axes.y(0),y2:axes.y(0),class:'optimization-zero-line'});
      const meanX=xs.reduce((a,b)=>a+b,0)/xs.length,meanY=ys.reduce((a,b)=>a+b,0)/ys.length,cov=completeSelection.reduce((s,r)=>s+(r.atlas_per_lp-meanX)*(r.selection_uplift_atlas_per_active_crew_day-meanY),0),variance=xs.reduce((s,x)=>s+(x-meanX)**2,0);
      if(variance){const slope=cov/variance,intercept=meanY-slope*meanX;appendOptimizationSvg(svg,'line',{x1:axes.x(minX),x2:axes.x(maxX),y1:axes.y(intercept+slope*minX),y2:axes.y(intercept+slope*maxX),class:'optimization-trend-line'});}
      for(const row of completeSelection){const dot=appendOptimizationSvg(svg,'circle',{cx:axes.x(row.atlas_per_lp),cy:axes.y(row.selection_uplift_atlas_per_active_crew_day),r:5,fill:'#45d6c1',class:'mean-marker'});bindOptimizationAnalyticsTooltip(dot,`${row.date} · ATLAS/LP ${row.atlas_per_lp.toFixed(10)} · uplift ${row.selection_uplift_atlas.toLocaleString(undefined,{maximumFractionDigits:2})} ATLAS · ${row.selection_uplift_atlas_per_active_crew_day.toFixed(4)} ATLAS / active crew-day · ${row.selection_uplift_lp_per_active_crew_hour.toFixed(2)} LP / active crew-hour · ${row.completion_cohort_active_crew_hours.toLocaleString(undefined,{maximumFractionDigits:1})} active crew-hours · ${row.completed_job_count} jobs · ${row.price_basis} · price basis ${row.price_basis_complete?'complete':'incomplete'}`);}
    }
    const warning=document.createElement('strong'); warning.className='optimization-v1-warning'; warning.textContent=data.price_warning; optimizationUpgradingSelectionV1.append(warning);
  }
  if (optimizationUpgradingUtilizationV1) {
    optimizationUpgradingUtilizationV1.title='Physical crew state inside this UTC period. States are mutually exclusive and sum to configured capacity. Unknown time is shown, never silently assigned.';
    optimizationUpgradingUtilizationV1.replaceChildren();
    const series=[['Protocol active','protocol_active','#22c55e'],['Claim locked','claim_locked','#f59e0b'],['Proven eligible idle','proven_eligible_idle','#38bdf8'],['Proven hard unavailable','proven_hard_unavailable','#ef4444'],['Capacity not observed','capacity_not_observed','#64748b']];
    const legend=document.createElement('div');legend.className='optimization-v1-legend';for(const [label,,color] of series){const item=document.createElement('span');item.textContent=label;item.style.setProperty('--legend-color',color);legend.append(item);}optimizationUpgradingUtilizationV1.append(legend);
    const rows=(data.utilization||[]).filter(r=>r.identity_complete);
    const svg=createOptimizationAnalyticsSvg(optimizationUpgradingUtilizationV1,760,340);
    if(!rows.length) unavailable(optimizationUpgradingUtilizationV1,'UTC-calendar identity evidence is incomplete.');
    else if(svg){const axes=renderUpgradingChartAxes(svg,{minY:0,maxY:100,xMin:0,xMax:rows.length,xTicks:rows.map((_,i)=>i+.5),xLabel:'UTC date',yLabel:'Configured capacity (%)',height:340,xFormatter:v=>rows[Math.max(0,Math.min(rows.length-1,Math.floor(v)))]?.date.slice(5)||''});rows.forEach((row,index)=>{let bottom=0;for(const [label,key,color] of series){const percent=Number(row[`${key}_percent`]||0),hours=Number(row[`${key}_crew_hours`]||0),rect=appendOptimizationSvg(svg,'rect',{x:axes.x(index+.12),y:axes.y(bottom+percent),width:Math.max(1,axes.x(index+.88)-axes.x(index+.12)),height:Math.max(0,axes.y(bottom)-axes.y(bottom+percent)),fill:color});bindOptimizationAnalyticsTooltip(rect,`${row.date} · ${label} · ${percent.toFixed(2)}% · ${hours.toLocaleString(undefined,{maximumFractionDigits:1})} crew-hours · UTC-calendar physical crew state`);bottom+=percent;}});}
  }
  if (optimizationUpgradingClaimLockV1) { const claim=data.claim_lock||{}; optimizationUpgradingClaimLockV1.textContent=`${claim.claim_locked_crew_hours?.toLocaleString(undefined,{maximumFractionDigits:1}) ?? '--'} crew-hours · ${claim.claim_locked_percent?.toFixed(2) ?? '--'}% · delay median ${claim.median_claim_delay_seconds?.toFixed(1) ?? '--'}s · P90 ${claim.p90_claim_delay_seconds?.toFixed(1) ?? '--'}s · P95 ${claim.p95_claim_delay_seconds?.toFixed(1) ?? '--'}s · max ${claim.maximum_claim_delay_seconds?.toFixed(1) ?? '--'}s · attempts/retries/failures: NOT OBSERVED`; optimizationUpgradingClaimLockV1.title='Crew whose protocol work ended but whose completion/claim had not succeeded. This is not active or idle and is not presumed unavoidable.'; }
  if (optimizationUpgradingOperationalV1) { const rows=data.utilization||[]; const lower=rows.reduce((s,r)=>s+r.feasible_neutral_lower_crew_hours,0), upper=rows.reduce((s,r)=>s+r.feasible_neutral_upper_crew_hours,0); optimizationUpgradingOperationalV1.textContent=`UTC-calendar operational measurement combines selection and utilization; it is not component-selection uplift. Feasible-neutral capacity: ${lower.toLocaleString(undefined,{maximumFractionDigits:1})}–${upper.toLocaleString(undefined,{maximumFractionDigits:1})} crew-hours. Residual NOT OBSERVED remains uncertainty.`; }
}

function renderUpgradingOptimizationAnalytics() {
  const analytics = buildUpgradingOptimizationAnalytics(latestUpgradingOptimizationResult || {});
  renderUpgradingSelectionUtilizationV1(latestUpgradingOptimizationResult || {});
  const comparisonScales = getUpgradingComparisonScales(latestUpgradingComparisonResults.length ? latestUpgradingComparisonResults : [latestUpgradingOptimizationResult || {}]);
  const normalizedFaction = normalizeFaction(latestSettings?.faction);
  const factionLabel = normalizedFaction === 'USTUR' ? 'UST' : normalizedFaction;
  if(optimizationUpgradingAnalyticsStatus) optimizationUpgradingAnalyticsStatus.textContent = `${analytics.scatter.length} completed comparison days · ${analytics.forecasts.length} forecast days · rolling 30 days · UTC`;
  renderUpgradingRedemptionLegend(analytics);
  renderUpgradingNetAtlasChart(analytics);
  renderUpgradingRateResponseChart(analytics, 'responseScatter', optimizationUpgradingLpPerCrewByRateChart, upgradingLpPerCrewByRateChartView, {
    chartKey: 'lpPerCrewByRate', yLabel: 'LP / average crew', title: 'LP / average crew', color: '#45d6c1',
    value: (row) => row.lpPerCrew, tooltip: (row) => `${row.date} · ATLAS/LP ${row.atlasPerLp.toLocaleString(undefined, { maximumFractionDigits: 8 })} · player ${row.playerLp.toLocaleString()} LP · avg phantom crew ${row.averageCrew.toLocaleString(undefined, { maximumFractionDigits: 1 })} · ${row.lpPerCrew.toLocaleString(undefined, { maximumFractionDigits: 1 })} LP / crew`,
  });
  renderUpgradingRateResponseChart(analytics, 'componentCostScatter', optimizationUpgradingComponentCostByRateChart, upgradingComponentCostByRateChartView, {
    chartKey: 'componentCostByRate', yLabel: 'Component cost / average crew', title: 'Component cost / average crew', color: '#f59e0b',
    value: (row) => row.componentCostPerCrew, tooltip: (row) => `${row.date} · ATLAS/LP ${row.atlasPerLp.toLocaleString(undefined, { maximumFractionDigits: 8 })} · component cost ${row.componentCost.toLocaleString(undefined, { maximumFractionDigits: 2 })} ATLAS · avg phantom crew ${row.averageCrew.toLocaleString(undefined, { maximumFractionDigits: 1 })} · ${row.componentCostPerCrew.toLocaleString(undefined, { maximumFractionDigits: 2 })} ATLAS / crew`,
  });
  renderUpgradingRateResponseChart(analytics, 'upliftScatter', optimizationUpgradingUpliftByRateChart, upgradingUpliftByRateChartView, {
    chartKey: 'upliftByRate', yLabel: 'Actual − neutral uplift / average crew', title: 'Actual − neutral baseline uplift / average crew', color: '#a78bfa', zeroLine: true,
    value: (row) => row.upliftPerCrew, tooltip: (row) => `${row.date} · ATLAS/LP ${row.atlasPerLp.toLocaleString(undefined, { maximumFractionDigits: 8 })} · actual ${row.actualLp.toLocaleString()} LP · neutral ${row.neutralLp.toLocaleString()} LP · uplift ${row.uplift.toLocaleString(undefined, { maximumFractionDigits: 2 })} ATLAS · ${row.upliftPerCrew.toLocaleString(undefined, { maximumFractionDigits: 2 })} ATLAS / crew`,
  });
  renderUpgradingMarginChart(analytics);
  renderUpgradingEfficiencyChart(analytics);
  let svg=createOptimizationAnalyticsSvg(optimizationUpgradingRedemptionChart,760,340);
  if(svg && analytics.scatter.length){ const autoMinX=0,autoMaxX=Math.max(1,...analytics.scatter.map(r=>r.factionLp))*1.08,autoMinY=0,autoMaxY=comparisonScales.playerLpPerCrewMax*1.08; const minX=Number.isFinite(upgradingScatterChartView.xMin)?upgradingScatterChartView.xMin:autoMinX,maxX=Number.isFinite(upgradingScatterChartView.xMax)?upgradingScatterChartView.xMax:autoMaxX,minY=Number.isFinite(upgradingScatterChartView.scatterYMin)?upgradingScatterChartView.scatterYMin:autoMinY,maxY=Number.isFinite(upgradingScatterChartView.scatterYMax)?upgradingScatterChartView.scatterYMax:autoMaxY; const axes=renderUpgradingChartAxes(svg,{minY,maxY,xMin:minX,xMax:maxX,xTicks:[minX,minX+(maxX-minX)/4,minX+(maxX-minX)/2,minX+(maxX-minX)*3/4,maxX],xLabel:'Faction LP redeemed',yLabel:'Player LP / avg phantom crew',height:340});
    const meanX=analytics.scatter.reduce((s,r)=>s+r.factionLp,0)/analytics.scatter.length,meanY=analytics.scatter.reduce((s,r)=>s+r.playerLpPerCrew,0)/analytics.scatter.length; const cov=analytics.scatter.reduce((s,r)=>s+(r.factionLp-meanX)*(r.playerLpPerCrew-meanY),0),vx=analytics.scatter.reduce((s,r)=>s+(r.factionLp-meanX)**2,0),vy=analytics.scatter.reduce((s,r)=>s+(r.playerLpPerCrew-meanY)**2,0); const correlation=vx&&vy?cov/Math.sqrt(vx*vy):null;
    const defs=appendOptimizationSvg(svg,'defs'); const clipPath=appendOptimizationSvg(defs,'clipPath',{id:'optimization-upgrading-scatter-clip'}); appendOptimizationSvg(clipPath,'rect',{x:axes.left,y:axes.top,width:axes.width-axes.left-axes.right,height:axes.height-axes.top-axes.bottom});
    if(vx){ const slope=cov/vx,intercept=meanY-slope*meanX; const startY=intercept+slope*minX,endY=intercept+slope*maxX; appendOptimizationSvg(svg,'line',{x1:axes.x(minX),y1:axes.y(startY),x2:axes.x(maxX),y2:axes.y(endY),class:'optimization-trend-line','clip-path':`url(#optimization-upgrading-scatter-clip)`}); }
    analytics.scatter.forEach((row,index)=>{const isLatest=index===analytics.scatter.length-1; const dot=appendOptimizationSvg(svg,'circle',{cx:axes.x(row.factionLp),cy:axes.y(row.playerLpPerCrew),r:isLatest?6:5,fill:'#45d6c1',stroke:isLatest?'#e8fffb':'none','stroke-width':isLatest?2:0,class:'mean-marker','clip-path':`url(#optimization-upgrading-scatter-clip)`}); bindOptimizationAnalyticsTooltip(dot,`${row.date} · faction ${row.factionLp.toLocaleString()} LP · player ${row.playerLp.toLocaleString()} LP · avg phantom crew ${row.averageCrew.toLocaleString(undefined,{maximumFractionDigits:1})} · ${row.playerLpPerCrew.toLocaleString(undefined,{maximumFractionDigits:1})} LP / crew`);});
    appendOptimizationSvg(svg,'text',{x:axes.width-axes.right,y:axes.top-2,'text-anchor':'end',class:'axis-label'},`correlation ${correlation==null?'--':correlation.toFixed(2)}`);
    bindUpgradingAnalyticsChartNavigation(svg, axes, analytics, 'scatter', upgradingScatterChartView, { xMin: autoMinX, xMax: autoMaxX, yMin: autoMinY, yMax: autoMaxY, xFloor: 0 });
  }
  svg=createOptimizationAnalyticsSvg(optimizationUpgradingForecastChart,760,340);
  const forecastValues=analytics.forecasts.flatMap(d=>[...d.points.map(p=>p.value),...(Number.isFinite(d.actual)?[d.actual]:[])]);
  if(svg&&forecastValues.length){const min=Math.min(...forecastValues),max=Math.max(...forecastValues),pad=Math.max(1,(max-min)*.08),autoMinX=0,autoMaxX=24,autoMinY=Math.max(0,min-pad),autoMaxY=max+pad,xMin=Number.isFinite(upgradingTimeChartView.xMin)?upgradingTimeChartView.xMin:autoMinX,xMax=Number.isFinite(upgradingTimeChartView.xMax)?upgradingTimeChartView.xMax:autoMaxX,minY=Number.isFinite(upgradingTimeChartView.forecastYMin)?upgradingTimeChartView.forecastYMin:autoMinY,maxY=Number.isFinite(upgradingTimeChartView.forecastYMax)?upgradingTimeChartView.forecastYMax:autoMaxY,axes=renderUpgradingChartAxes(svg,{minY,maxY,xMin,xMax,xTicks:[xMin,xMin+(xMax-xMin)/4,xMin+(xMax-xMin)/2,xMin+(xMax-xMin)*3/4,xMax],xLabel:'Snapshot hour (UTC)',yLabel:'Expected total LP by EOD',height:340}); const totalDays=analytics.forecasts.length; analytics.forecasts.forEach((day,index)=>{const isToday=day.today; const recency=totalDays>1?(totalDays-1-index)/(totalDays-1):1; const alpha=0.3+recency*0.7; const color=isToday?'#f59e0b':`rgba(69, 214, 193, ${alpha.toFixed(3)})`; const pointsAttr=day.points.map(p=>`${axes.x(p.hour)},${axes.y(p.value)}`).join(' '); const line=appendOptimizationSvg(svg,'polyline',{points:pointsAttr,fill:'none',stroke:color,'stroke-width':isToday?3.5:2,class:'optimization-forecast-line'}); appendOptimizationSvg(line,'title',{},`${day.day}${isToday?' (today)':''}`); const firstValue=day.points[0]?.value; const lastValue=day.points.at(-1)?.value; const actualText=Number.isFinite(day.actual)?day.actual.toLocaleString():'not final'; const daySummary=`${day.day}${isToday?' (today)':''} · ${day.points.length} snapshots · range ${Number.isFinite(firstValue)?firstValue.toLocaleString():'?'} → ${Number.isFinite(lastValue)?lastValue.toLocaleString():'?'} LP · actual final ${actualText} LP`; const hitArea=appendOptimizationSvg(svg,'polyline',{points:pointsAttr,class:'optimization-line-hit','stroke-width':16}); bindOptimizationAnalyticsTooltip(hitArea,daySummary); for(const point of day.points){const snapshot=appendOptimizationSvg(svg,'circle',{cx:axes.x(point.hour),cy:axes.y(point.value),r:5,fill:color}); const actual=Number.isFinite(day.actual)?`${day.actual.toLocaleString()} LP`:'not final'; const error=Number.isFinite(day.actual)?`${(point.value-day.actual).toLocaleString()} LP`:'not available'; bindOptimizationAnalyticsTooltip(snapshot,`${day.day} · ${String(point.hour).padStart(2,'0')}:00 UTC · expected ${point.value.toLocaleString()} LP · actual final ${actual} · forecast error ${error}`);} if(Number.isFinite(day.actual)){const dot=appendOptimizationSvg(svg,'circle',{cx:axes.x(24),cy:axes.y(day.actual),r:4,fill:color,class:'mean-marker'});bindOptimizationAnalyticsTooltip(dot,`${day.day} · final ${factionLabel} faction LP redemption · ${day.actual.toLocaleString()} LP`);}}); bindUpgradingAnalyticsChartNavigation(svg, axes, analytics, 'forecast', upgradingTimeChartView, { xMin: autoMinX, xMax: autoMaxX, yMin: autoMinY, yMax: autoMaxY, xFloor: 0 });}
  svg=createOptimizationAnalyticsSvg(optimizationUpgradingErrorChart);
  if(svg&&analytics.errorByHour.length){const bound=comparisonScales.forecastErrorBound*1.1,autoMinX=0,autoMaxX=24,autoMinY=-bound,autoMaxY=bound,xMin=Number.isFinite(upgradingTimeChartView.xMin)?upgradingTimeChartView.xMin:autoMinX,xMax=Number.isFinite(upgradingTimeChartView.xMax)?upgradingTimeChartView.xMax:autoMaxX,minY=Number.isFinite(upgradingTimeChartView.errorYMin)?upgradingTimeChartView.errorYMin:autoMinY,maxY=Number.isFinite(upgradingTimeChartView.errorYMax)?upgradingTimeChartView.errorYMax:autoMaxY,axes=renderUpgradingChartAxes(svg,{minY,maxY,xMin,xMax,xTicks:[xMin,xMin+(xMax-xMin)/4,xMin+(xMax-xMin)/2,xMin+(xMax-xMin)*3/4,xMax],xLabel:'Snapshot hour (UTC)',yLabel:'Forecast error (LP)'}); appendOptimizationSvg(svg,'line',{x1:axes.left,x2:axes.width-axes.right,y1:axes.y(0),y2:axes.y(0),class:'optimization-zero-line'}); const polygon=[...analytics.errorByHour.map(r=>`${axes.x(r.hour)},${axes.y(r.q75)}`),...analytics.errorByHour.slice().reverse().map(r=>`${axes.x(r.hour)},${axes.y(r.q25)}`)].join(' '); appendOptimizationSvg(svg,'polygon',{points:polygon,class:'optimization-error-band'}); appendOptimizationSvg(svg,'polyline',{points:analytics.errorByHour.map(r=>`${axes.x(r.hour)},${axes.y(r.median)}`).join(' '),fill:'none',class:'optimization-error-line'}); for(const row of analytics.errorByHour){const dot=appendOptimizationSvg(svg,'circle',{cx:axes.x(row.hour),cy:axes.y(row.median),r:3,fill:'#45d6c1'});appendOptimizationSvg(dot,'title',{},`${String(row.hour).padStart(2,'0')}:00 · median ${row.median.toLocaleString()} LP · middle 50% ${row.q25.toLocaleString()} to ${row.q75.toLocaleString()} · n=${row.count}`);} bindUpgradingAnalyticsChartNavigation(svg, axes, analytics, 'error', upgradingTimeChartView, { xMin: autoMinX, xMax: autoMaxX, yMin: autoMinY, yMax: autoMaxY, xFloor: 0 });}
  renderUpgradingBreakevenTable();
}

function renderUpgradingRateResponseChart(analytics, seriesKey, container, view, options = {}) {
  const svg = createOptimizationAnalyticsSvg(container, 760, 340);
  if (!svg) return;
  const points = analytics[seriesKey] || [];
  if (!points.length) {
    appendOptimizationSvg(svg, 'text', { x: 380, y: 170, 'text-anchor': 'middle', class: 'axis-label' }, 'No complete daily data available');
    return;
  }
  const values = points.map(options.value).filter(Number.isFinite);
  const autoMinX = Math.max(0, Math.min(...points.map((row) => row.atlasPerLp)) * 0.92);
  const autoMaxX = Math.max(autoMinX + Number.EPSILON, Math.max(...points.map((row) => row.atlasPerLp)) * 1.08);
  const valueMin = Math.min(...values); const valueMax = Math.max(...values); const valuePadding = Math.max(1e-9, (valueMax - valueMin) * 0.08);
  const autoMinY = options.zeroLine ? Math.min(0, valueMin - valuePadding) : valueMin - valuePadding;
  const autoMaxY = options.zeroLine ? Math.max(0, valueMax + valuePadding) : valueMax + valuePadding;
  const minX = Number.isFinite(view.xMin) ? view.xMin : autoMinX;
  const maxX = Number.isFinite(view.xMax) ? view.xMax : autoMaxX;
  const minY = Number.isFinite(view[`${options.chartKey}YMin`]) ? view[`${options.chartKey}YMin`] : autoMinY;
  const maxY = Number.isFinite(view[`${options.chartKey}YMax`]) ? view[`${options.chartKey}YMax`] : autoMaxY;
  const axes = renderUpgradingChartAxes(svg, {
    minY, maxY, xMin: minX, xMax: maxX,
    xTicks: [minX, minX + (maxX - minX) / 4, minX + (maxX - minX) / 2, minX + (maxX - minX) * 3 / 4, maxX],
    xLabel: 'ATLAS / LP', yLabel: options.yLabel, height: 340,
    xFormatter: (value) => value.toLocaleString(undefined, { maximumFractionDigits: 8 }),
    yFormatter: (value) => formatCompactNumber(value),
  });
  if (options.zeroLine && minY <= 0 && maxY >= 0) appendOptimizationSvg(svg, 'line', { x1: axes.left, x2: axes.width - axes.right, y1: axes.y(0), y2: axes.y(0), class: 'optimization-zero-line' });
  const meanX = points.reduce((sum, row) => sum + row.atlasPerLp, 0) / points.length;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  const covariance = points.reduce((sum, row) => sum + (row.atlasPerLp - meanX) * (options.value(row) - meanY), 0);
  const varianceX = points.reduce((sum, row) => sum + (row.atlasPerLp - meanX) ** 2, 0);
  if (varianceX) {
    const slope = covariance / varianceX; const intercept = meanY - slope * meanX;
    appendOptimizationSvg(svg, 'line', { x1: axes.x(minX), y1: axes.y(intercept + slope * minX), x2: axes.x(maxX), y2: axes.y(intercept + slope * maxX), class: 'optimization-trend-line' });
  }
  points.forEach((row, index) => {
    const isLatest = index === points.length - 1;
    const value = options.value(row); const dot = appendOptimizationSvg(svg, 'circle', { cx: axes.x(row.atlasPerLp), cy: axes.y(value), r: isLatest ? 6 : 5, fill: options.color || '#45d6c1', stroke: isLatest ? '#fff7ed' : 'none', 'stroke-width': isLatest ? 2 : 0, class: 'mean-marker' });
    bindOptimizationAnalyticsTooltip(dot, options.tooltip(row));
  });
  appendOptimizationSvg(svg, 'text', { x: axes.width - axes.right, y: axes.top - 2, 'text-anchor': 'end', class: 'axis-label' }, `${options.title} · n=${points.length}`);
  bindUpgradingAnalyticsChartNavigation(svg, axes, analytics, options.chartKey, view, { xMin: autoMinX, xMax: autoMaxX, yMin: autoMinY, yMax: autoMaxY, xFloor: 0 });
}

function renderUpgradingBreakevenTable() {
  if (!optimizationUpgradingBreakevenBody || !optimizationUpgradingBreakevenHead) return;
  const visibleColumns = upgradingBreakevenColumns.filter((column) => upgradingBreakevenSelectedColumns.has(column.key));
  optimizationUpgradingBreakevenHead.replaceChildren();
  const groupRow = document.createElement('tr'); groupRow.className = 'optimization-analysis-group-head';
  const metricRow = document.createElement('tr');
  for (const column of visibleColumns) {
    const th = document.createElement('th');
    if (column.title) th.title = column.title;
    if (column.group) { th.textContent = column.group; th.className = 'optimization-limit-group'; groupRow.append(th); const metricTh = document.createElement('th'); metricTh.textContent = column.label; metricRow.append(metricTh); }
    else { th.textContent = column.label; th.rowSpan = 2; groupRow.append(th); }
  }
  optimizationUpgradingBreakevenHead.append(groupRow);
  if (visibleColumns.some((column) => column.group)) optimizationUpgradingBreakevenHead.append(metricRow);
  optimizationUpgradingBreakevenBody.replaceChildren();
  const result = latestUpgradingOptimizationResult || {};
  const analytics = buildUpgradingOptimizationAnalytics(result);
  const factionLp = Number(analytics.latestFactionRedemption?.factionLp);
  const baseRows = buildUpgradingEfficiencyRows(result, factionLp).sort((a, b) => a.lp - b.lp);
  const faction = normalizeFaction(latestSettings?.faction);
  const profile = getActivePlayerProfile(latestSettings || {}) || '';
  const rows = applyUpgradingCostBasis(baseRows, upgradingBreakevenCostBasis, faction);
  if (!rows.length) { const tr=document.createElement('tr'),td=document.createElement('td'); tr.className='empty-row';td.colSpan=Math.max(1,visibleColumns.length);td.textContent='Component prices or yesterday’s faction LP unavailable';tr.append(td);optimizationUpgradingBreakevenBody.append(tr);return; }
  const rerenderBasisSurfaces = () => { const currentAnalytics = buildUpgradingOptimizationAnalytics(result); renderUpgradingBreakevenTable(); renderUpgradingNetAtlasChart(currentAnalytics); renderUpgradingMarginChart(currentAnalytics); renderUpgradingEfficiencyChart(currentAnalytics); };
  for (const row of rows) {
    const tr=document.createElement('tr');
    const internalCostText = row.internalCost == null ? '—' : Number(row.internalCost).toLocaleString(undefined, { maximumFractionDigits: 6 });
    const equalNetText = row.equalNetStatus === 'unreachable' ? 'Unreachable' : (row.equalNetStatus === 'available' ? Number(row.equalNetPrice).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—');
    const marginText = row.marginPercent == null || !Number.isFinite(row.marginPercent) ? '—' : `${row.marginPercent.toFixed(1)}%`;
    const netAtlasPerSecondText = row.netAtlasPerSecond == null || !Number.isFinite(row.netAtlasPerSecond) ? '—' : row.netAtlasPerSecond.toFixed(6);
    const netAtlasPerCargoUnitText = row.netAtlasPerCargoUnit == null || !Number.isFinite(row.netAtlasPerCargoUnit) ? '—' : row.netAtlasPerCargoUnit.toFixed(6);
    const breakevenLp = Number.isFinite(row.appliedPrice) && row.appliedPrice > 0 ? formatCompactNumber(Number(result.atlasPool) * row.lp / row.appliedPrice) : '—';
    const values={name:row.name==='Ink'?'INK':row.name,upgradingTime:`${row.durationSeconds}s`,lpValue:row.lp.toLocaleString(),lpPerSecond:row.lpPerSecond.toFixed(1),factionLp:formatCompactNumber(factionLp),breakevenLp,externalPrice:row.externalPrice.toLocaleString(undefined,{maximumFractionDigits:6}),internalCost:internalCostText,equalNetPrice:equalNetText,grossAtlasPerSecond:row.grossAtlasPerSecond.toFixed(6),marginPercent:marginText,netAtlasPerSecond:netAtlasPerSecondText,netAtlasPerCargoUnit:netAtlasPerCargoUnitText};
    for (const column of visibleColumns) {
      const cell=document.createElement('td');
      if(column.key==='customPrice') {
        cell.className='numeric-cell optimization-custom-price-cell';
        const wrap=document.createElement('div'); wrap.className='optimization-custom-price-control';
        const input=document.createElement('input'); input.type='text'; input.inputMode='decimal'; input.className='optimization-custom-price-input'; input.dataset.customPriceComponent=row.name; input.value=Number(row.customPrice).toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:12}); input.setAttribute('aria-label',`${row.name} custom price`); input.title=row.customOverridden?'Saved Custom override':'Inheriting current External price';
        input.addEventListener('change',()=>{const parsed=parseUpgradingCustomPrice(input.value);if(!parsed.ok){input.setAttribute('aria-invalid','true');input.title='Enter a non-negative number';return;}input.removeAttribute('aria-invalid');const key=upgradingCustomPriceScopeKey(profile,faction,row.name);upgradingCustomPriceOverrides=updateUpgradingCustomPriceOverrides(upgradingCustomPriceOverrides,key,parsed.value);persistUpgradingCustomPriceOverrides();rerenderBasisSurfaces();});
        wrap.append(input);
        if(row.customOverridden){const reset=document.createElement('button');reset.type='button';reset.className='optimization-custom-price-reset';reset.textContent='Reset';reset.title='Remove override and resume live External inheritance';reset.addEventListener('click',()=>{const key=upgradingCustomPriceScopeKey(profile,faction,row.name);upgradingCustomPriceOverrides=updateUpgradingCustomPriceOverrides(upgradingCustomPriceOverrides,key,null);persistUpgradingCustomPriceOverrides();rerenderBasisSurfaces();});wrap.append(reset);}
        cell.append(wrap);
      } else { cell.textContent=values[column.key]; if(column.key!=='name')cell.className='numeric-cell'; }
      tr.append(cell);
    }
    optimizationUpgradingBreakevenBody.append(tr);
  }
}

async function refreshScanningOptimizationAnalyticsData({ force = false } = {}) {
  if(!api.getScanningOptimization) return;
  const faction = normalizeFaction((latestSettings || getFormPayload()).faction);
  if(!force && optimizationAnalyticsLoadedFaction === faction && optimizationAnalyticsRows.length) {
    renderScanningOptimizationAnalytics();
    return;
  }
  if(optimizationAnalyticsStatus) optimizationAnalyticsStatus.textContent = 'Loading complete optimization-event history and current earnings prices...';
  const result = await api.getScanningOptimization({
    faction,
    fleet: '__all__', eventType: '__all__', operation: '__all__', status: '__all__',
    offset: 0, limit: 5000, analytics: true,
  });
  if(faction !== normalizeFaction((latestSettings || getFormPayload()).faction)) return;
  if(!result?.ok) {
    if(optimizationAnalyticsStatus) optimizationAnalyticsStatus.textContent = `Analytics sync failed: ${result?.error || 'unknown error'}`;
    return;
  }
  optimizationAnalyticsRows = result.rows || [];
  optimizationAnalyticsPrices = result.prices || null;
  optimizationAnalyticsLoadedFaction = faction;
  renderScanningOptimizationAnalytics();
  if(result.hasMore && optimizationAnalyticsStatus) optimizationAnalyticsStatus.textContent += ' · showing newest 5,000 optimization events';
}

async function refreshScanningOptimization({ append = false, force = false } = {}) {
  if (!api.getScanningOptimization) return;
  const faction = normalizeFaction((latestSettings || getFormPayload()).faction);
  const start = optimizationFilterIso(optimizationStartFilter);
  const stop = optimizationFilterIso(optimizationStopFilter, true);
  const fleet = optimizationFleetFilter.value;
  const experimentId = optimizationExperimentFilter?.value || '__all__';
  const eventType = optimizationEventFilter.value;
  const operation = optimizationOperationFilter.value;
  const optimizationParameter = optimizationParameterFilter?.value || '__all__';
  const cached = !append && !force
    ? getCachedFilterResult(faction, 'optimizationScanning', start || '', stop || '', fleet, experimentId, eventType, operation, optimizationParameter)
    : null;
  if (cached) {
    latestOptimizationResult = cached;
    optimizationRows = filterScanningOptimizationRowsByFaction(cached.rows, faction);
    optimizationColumns = getOrderedOptimizationColumns(new Set([...optimizationColumns, ...(cached.columns || [])]));
    renderOptimizationColumnControls();
    renderOptimizationTable();
    populateOptimizationFilter(optimizationFleetFilter, optimizationRows, 'fleet', 'All fleets');
    populateOptimizationFilter(optimizationExperimentFilter, optimizationRows, 'experimentId', 'All experiments');
    populateOptimizationFilter(optimizationOperationFilter, optimizationRows, 'operation', 'All operations');
    populateOptimizationFilter(optimizationParameterFilter, optimizationRows, 'optimizationParameter', 'All optimization parameters');
    optimizationLoadMore.hidden = !cached.hasMore;
    optimizationSyncStatus.textContent = `${optimizationRows.length.toLocaleString()} cached rows · ${cached.bucket} · ${faction}`;
    renderScanningOptimizationAnalytics();
    return;
  }
  optimizationSyncStatus.textContent = append ? 'Loading more optimization rows...' : 'Loading optimization rows...';
  const result = await api.getScanningOptimization({
    faction,
    start,
    stop,
    fleet,
    eventType,
    operation,
    optimizationParameter,
    experimentId,
    offset: append ? optimizationRows.length : 0,
    limit: 500,
  });
  if (faction !== normalizeFaction((latestSettings || getFormPayload()).faction)) return;
  if (!result?.ok) {
    optimizationSyncStatus.textContent = `Optimization sync failed: ${result?.error || 'unknown error'}`;
    if (!append) { optimizationRows = []; renderOptimizationTable(); }
    return;
  }
  const factionRows = filterScanningOptimizationRowsByFaction(result.rows, faction);
  const factionResult = { ...result, rows: factionRows };
  latestOptimizationResult = factionResult;
  if (!append) setCachedFilterResult(faction, 'optimizationScanning', factionResult, start || '', stop || '', fleet, experimentId, eventType, operation, optimizationParameter);
  optimizationRows = append ? [...optimizationRows, ...factionRows] : factionRows;
  const discovered = getOrderedOptimizationColumns(new Set([...optimizationColumns, ...(result.columns || [])]));
  let discoveredNewColumn = false;
  for (const column of discovered) {
    if (optimizationKnownColumns.has(column)) continue;
    optimizationKnownColumns.add(column);
    optimizationSelectedColumns.add(column);
    discoveredNewColumn = true;
  }
  if (discoveredNewColumn) persistOptimizationColumnState();
  optimizationColumns = discovered;
  renderOptimizationColumnControls();
  renderOptimizationTable();
  populateOptimizationFilter(optimizationFleetFilter, optimizationRows, 'fleet', 'All fleets');
  populateOptimizationFilter(optimizationExperimentFilter, optimizationRows, 'experimentId', 'All experiments');
  populateOptimizationFilter(optimizationOperationFilter, optimizationRows, 'operation', 'All operations');
  populateOptimizationFilter(optimizationParameterFilter, optimizationRows, 'optimizationParameter', 'All optimization parameters');
  optimizationLoadMore.hidden = !result.hasMore;
  optimizationSyncStatus.textContent = `${optimizationRows.length.toLocaleString()} rows · ${result.bucket} · ${normalizeFaction((latestSettings || getFormPayload()).faction)}`;
  renderScanningOptimizationAnalytics();
}

function upgradingOptimizationCell(column, value) {
  if (value === null || value === undefined || value === '') return '--';
  if (column.key === 'time') return formatOptimizationUtcDateTime(value);
  if (column.key === 'oldest_uninstalled_not_automated_age_seconds') {
    const hours = Number(value) / 3600;
    return hours >= 48 ? `${(hours / 24).toFixed(1)}d` : `${hours.toFixed(1)}h`;
  }
  if (column.key.startsWith('aggressiveness')) return Number(value).toFixed(3);
  return Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString() : String(value);
}

function renderUpgradingOptimizationTable() {
  const visible = optimizationUpgradingColumns.filter((column) => optimizationUpgradingSelectedColumns.has(column.key));
  optimizationUpgradingTableHead?.replaceChildren();
  for (const column of visible) {
    const th = document.createElement('th');
    th.className = 'earnings-sortable-th';
    th.textContent = column.label;
    const arrow = document.createElement('span');
    arrow.className = 'earnings-sort-arrow';
    arrow.textContent = optimizationUpgradingSort.key === column.key ? (optimizationUpgradingSort.direction === 'desc' ? '▼' : '▲') : '';
    th.append(arrow);
    th.addEventListener('click', () => {
      if (optimizationUpgradingSort.key !== column.key) optimizationUpgradingSort = { key: column.key, direction: 'desc' };
      else optimizationUpgradingSort.direction = optimizationUpgradingSort.direction === 'desc' ? 'asc' : 'desc';
      renderUpgradingOptimizationTable();
    });
    optimizationUpgradingTableHead?.append(th);
  }
  optimizationUpgradingTableBody?.replaceChildren();
  const direction = optimizationUpgradingSort.direction === 'asc' ? 1 : -1;
  const rows = [...optimizationUpgradingRows].sort((a, b) => compareOptimizationValues(a[optimizationUpgradingSort.key], b[optimizationUpgradingSort.key]) * direction);
  if (!rows.length || !visible.length) {
    const tr = document.createElement('tr'); tr.className = 'empty-row';
    const td = document.createElement('td'); td.colSpan = Math.max(1, visible.length);
    td.textContent = rows.length ? 'Select at least one column' : 'No upgrading optimization rows match the current filters';
    tr.append(td); optimizationUpgradingTableBody?.append(tr); return;
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of visible) { const td = document.createElement('td'); td.textContent = upgradingOptimizationCell(column, row[column.key]); tr.append(td); }
    optimizationUpgradingTableBody?.append(tr);
  }
}

async function loadUpgradingComparisonResults(selectedFaction, selectedResult, start, stop, force = false) {
  const factions = ['MUD', 'ONI', 'USTUR'];
  const results = await Promise.all(factions.map(async (faction) => {
    if (faction === selectedFaction) return selectedResult;
    const cached = force ? null : getCachedFilterResult(faction, 'optimizationUpgrading', start || '', stop || '');
    if (cached) return cached;
    const result = await api.getUpgradingOptimization({ faction, start, stop });
    if (!result?.ok) return null;
    setCachedFilterResult(faction, 'optimizationUpgrading', result, start || '', stop || '');
    return result;
  }));
  return results.filter(Boolean);
}

async function refreshUpgradingOptimization({ force = false } = {}) {
  if (!api.getUpgradingOptimization) return;
  const faction = normalizeFaction((latestSettings || getFormPayload()).faction);
  const start = optimizationFilterIso(optimizationUpgradingStartFilter);
  const stop = optimizationFilterIso(optimizationUpgradingStopFilter, true);
  const cached = force ? null : getCachedFilterResult(faction, 'optimizationUpgrading', start || '', stop || '');
  if (cached) {
    latestUpgradingComparisonResults = await loadUpgradingComparisonResults(faction, cached, start, stop, force);
    if (faction !== normalizeFaction((latestSettings || getFormPayload()).faction)) return;
    latestUpgradingOptimizationResult = cached;
    optimizationUpgradingRows = cached.rows || [];
    renderUpgradingOptimizationTable();
    renderUpgradingOptimizationAnalytics();
    optimizationUpgradingSyncStatus.textContent = `${optimizationUpgradingRows.length.toLocaleString()} cached rows · ${cached.bucket} · ${faction}`;
    return;
  }
  optimizationUpgradingSyncStatus.textContent = 'Loading upgrading optimization rows...';
  const result = await api.getUpgradingOptimization({
    faction,
    start,
    stop,
  });
  if (faction !== normalizeFaction((latestSettings || getFormPayload()).faction)) return;
  if (!result?.ok) { optimizationUpgradingSyncStatus.textContent = `Upgrading optimization sync failed: ${result?.error || 'unknown error'}`; return; }
  latestUpgradingComparisonResults = await loadUpgradingComparisonResults(faction, result, start, stop, force);
  if (faction !== normalizeFaction((latestSettings || getFormPayload()).faction)) return;
  latestUpgradingOptimizationResult = result;
  setCachedFilterResult(faction, 'optimizationUpgrading', result, start || '', stop || '');
  optimizationUpgradingRows = result.rows || [];
  renderUpgradingOptimizationTable();
  renderUpgradingOptimizationAnalytics();
  optimizationUpgradingSyncStatus.textContent = `${optimizationUpgradingRows.length.toLocaleString()} rows · ${result.bucket} · ${normalizeFaction((latestSettings || getFormPayload()).faction)}`;
}

function setActiveOptimizationSubtab(subtab) {
  currentOptimizationSubtab = subtab;
  appShell?.classList.toggle('optimization-upgrading-active', subtab === 'upgrading');
  document.querySelectorAll('.optimization-subtab-button').forEach((button) => {
    const active = button.dataset.optimizationSubtab === subtab;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-optimization-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.optimizationPanel === subtab && panel.dataset.optimizationViewPanel === currentOptimizationView));
  renderOptimizationColumnControls();
  if (subtab === 'upgrading' && !latestUpgradingOptimizationResult) refreshUpgradingOptimization();
  if (subtab === 'upgrading' && currentOptimizationView === 'analytics') renderUpgradingOptimizationAnalytics();
  if (subtab === 'scanning' && !latestOptimizationResult) refreshScanningOptimization();
  if (subtab === 'scanning' && currentOptimizationView === 'analytics') refreshScanningOptimizationAnalyticsData();
}

function setActiveOptimizationView(view) {
  currentOptimizationView = view === 'analytics' ? 'analytics' : 'data';
  appShell?.classList.toggle('optimization-analytics-active', currentOptimizationView === 'analytics');
  document.querySelectorAll('.optimization-view-button').forEach((button) => {
    const active = button.dataset.optimizationView === currentOptimizationView;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  });
  setActiveOptimizationSubtab(currentOptimizationSubtab);
}

function updateMarketplaceSideSwitchVisibility() {
  if (earningsMarketplaceSideSwitch) {
    earningsMarketplaceSideSwitch.hidden = !(currentSection === 'earnings' && currentEarningsSubtab === 'marketplace');
  }
}

function setActiveSection(section) {
  currentSection = section;
  updateMarketplaceSideSwitchVisibility();
  appShell?.classList.toggle('earnings-active', section === 'earnings');
  appShell?.classList.toggle('optimization-active', section === 'optimization');
  document.querySelectorAll('.nav-button').forEach((button) => {
    const active = button.dataset.section === section;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-section-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.sectionPanel === section);
  });
  updateTitle();
  if (section === 'fleet' && !latestFleetResult) refreshFleets();
  if (section === 'earnings' && currentEarningsSubtab === 'breakeven') refreshBreakeven();
  else if (section === 'earnings' && currentEarningsSubtab === 'upgrading') refreshEarningsUpgrading();
  else if (section === 'earnings' && !latestEarningsResult) refreshEarnings();
  if (section === 'optimization') {
    if (currentOptimizationSubtab === 'upgrading') refreshUpgradingOptimization();
    else if (!latestOptimizationResult) refreshScanningOptimization();
    renderOptimizationColumnControls();
  }
  if (section === 'production') refreshVisibleProductionSubtab();
}

function refreshVisibleProductionSubtab() {
  if (!hasInfluxSettings(latestSettings || getFormPayload())) return Promise.resolve();
  if (currentSubtab === 'scanning') return latestSduResult ? Promise.resolve() : refreshDailySdu();
  if (currentSubtab === 'mining') return latestMiningResult ? Promise.resolve() : refreshDailyMining();
  if (currentSubtab === 'crafting') return latestCraftingResult ? Promise.resolve() : refreshDailyCrafting();
  if (currentSubtab === 'production') return latestProductionResult ? Promise.resolve() : refreshDailyProduction();
  if (currentSubtab === 'consumption') return refreshVisibleConsumptionIdentity();
  if (currentSubtab === 'pct-charts') return latestPcrResult ? Promise.resolve() : refreshPcrCharts();
  if (currentSubtab === 'inventory') return latestInventoryResult ? Promise.resolve() : refreshInventory();
  return Promise.resolve();
}

function refreshVisibleFactionViews() {
  if (currentSection === 'fleet') return refreshFleets();
  if (currentSection === 'earnings') {
    if (currentEarningsSubtab === 'breakeven') return refreshBreakeven();
    if (currentEarningsSubtab === 'upgrading') return refreshEarningsUpgrading();
    return currentEarningsSubtab === 'marketplace' ? refreshMarketplace({ sync: true }) : refreshEarnings();
  }
  if (currentSection === 'optimization') {
    if(currentOptimizationSubtab === 'upgrading') return refreshUpgradingOptimization();
    return currentOptimizationView === 'analytics' ? refreshScanningOptimizationAnalyticsData() : refreshScanningOptimization();
  }
  if (currentSection === 'production') return refreshVisibleProductionSubtab();
  return Promise.resolve();
}


function refreshVisibleConsumptionIdentity({ force = false } = {}) {
  if (currentConsumptionSubtab === 'scanning') return refreshConsScanning({ force });
  if (currentConsumptionSubtab === 'mining') return refreshConsMining({ force });
  if (currentConsumptionSubtab === 'cargo') return refreshConsCargo({ force });
  if (currentConsumptionSubtab === 'crafting') return refreshConsCrafting({ force });
  if (currentConsumptionSubtab === 'upgrading') return refreshConsUpgrading({ force });
  if (currentConsumptionSubtab === 'total') return refreshConsTotal({ force });
  return Promise.resolve();
}

function refreshVisibleIdentity({ force = false } = {}) {
  if (currentSection === 'fleet') return refreshFleets();
  if (currentSection === 'earnings') {
    if (currentEarningsSubtab === 'marketplace') return refreshMarketplace({ sync: true });
    if (currentEarningsSubtab === 'breakeven') return refreshBreakeven({ force });
    if (currentEarningsSubtab === 'upgrading') return refreshEarningsUpgrading({ force });
    return refreshEarnings();
  }
  if (currentSection === 'optimization') {
    if (currentOptimizationSubtab === 'upgrading') return refreshUpgradingOptimization({ force });
    return currentOptimizationView === 'analytics' ? refreshScanningOptimizationAnalyticsData({ force }) : refreshScanningOptimization({ force });
  }
  if (currentSection !== 'production') return Promise.resolve();
  if (currentSubtab === 'consumption') return refreshVisibleConsumptionIdentity({ force });
  if (currentSubtab === 'scanning') return refreshDailySdu();
  if (currentSubtab === 'mining') return refreshDailyMining();
  if (currentSubtab === 'crafting') return refreshDailyCrafting();
  if (currentSubtab === 'production') return refreshDailyProduction();
  if (currentSubtab === 'pct-charts') return refreshPcrCharts();
  if (currentSubtab === 'inventory') return refreshInventory();
  return Promise.resolve();
}

function refreshCurrentVisibleData() {
  if (currentSection === 'fleet') return refreshFleets();
  if (currentSection === 'earnings') {
    if (currentEarningsSubtab === 'marketplace') return refreshMarketplace({ sync: true });
    if (currentEarningsSubtab === 'breakeven') return refreshBreakeven({ force: true });
    if (currentEarningsSubtab === 'upgrading') return refreshEarningsUpgrading({ force: true });
    return refreshEarnings();
  }
  if (currentSection === 'optimization') {
    if(currentOptimizationSubtab === 'upgrading') return refreshUpgradingOptimization({ force: true });
    return currentOptimizationView === 'analytics' ? refreshScanningOptimizationAnalyticsData({ force: true }) : refreshScanningOptimization({ force: true });
  }
  if (currentSection !== 'production') return Promise.resolve();
  if (currentSubtab === 'scanning') return refreshDailySdu();
  if (currentSubtab === 'mining') return refreshDailyMining();
  if (currentSubtab === 'crafting') return refreshDailyCrafting();
  if (currentSubtab === 'production') return refreshDailyProduction();
  if (currentSubtab === 'pct-charts') return refreshPcrCharts();
  if (currentSubtab === 'inventory') return refreshInventory();
  if (currentSubtab === 'consumption') {
    if (currentConsumptionSubtab === 'mining') return refreshConsMining({ force: true });
    if (currentConsumptionSubtab === 'crafting') return refreshConsCrafting({ force: true });
    if (currentConsumptionSubtab === 'upgrading') return refreshConsUpgrading({ force: true });
    if (currentConsumptionSubtab === 'scanning') return refreshConsScanning({ force: true });
    if (currentConsumptionSubtab === 'cargo') return refreshConsCargo({ force: true });
    if (currentConsumptionSubtab === 'total') return refreshConsTotal({ force: true });
    return Promise.resolve();
  }
  return Promise.resolve();
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
    if (hasInfluxSettings(latestSettings || getFormPayload())) refreshVisibleConsumptionIdentity();
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

function setActiveEarningsSubtab(subtab) {
  currentEarningsSubtab = subtab;
  updateMarketplaceSideSwitchVisibility();
  document.querySelectorAll('.earnings-subtab-button').forEach((button) => {
    const active = button.dataset.earningsSubtab === subtab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-earnings-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.earningsPanel === subtab);
  });
  renderEarningsColumnControls();
  updateTitle();
  if (subtab === 'marketplace') {
    refreshMarketplace({ sync: false });
    return;
  }
  if (subtab === 'breakeven') {
    refreshBreakeven();
    return;
  }
  if (subtab === 'upgrading') {
    refreshEarningsUpgrading();
    return;
  }
  if ((subtab === 'scanning' || subtab === 'mining' || subtab === 'cargo' || subtab === 'crafting') && !latestEarningsResult) {
    refreshEarnings();
  }
  if (subtab === 'mining' && latestEarningsResult) {
    renderEarningsMining(latestEarningsResult);
  } else if (subtab === 'marketplace' && latestEarningsResult) {
    renderEarningsMarketplace(latestEarningsResult);
  } else if (subtab === 'cargo' && latestEarningsResult) {
    renderEarningsCargo(latestEarningsResult);
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
  void checkForUpdates();
  initInventory();
  setNextRendererTelemetryTrigger('startup');
  await loadVisibleThenPrefetch(refreshVisibleFactionViews);
  setNextRendererTelemetryTrigger('startup');
  void runMarketplaceBackgroundSync();
  setInterval(runMarketplaceBackgroundSync, MARKETPLACE_SYNC_INTERVAL_MS);
}

document.querySelectorAll('.nav-button').forEach((button) => {
  button.addEventListener('click', () => { setNextRendererTelemetryTrigger('navigation'); setActiveSection(button.dataset.section); });
});

document.querySelectorAll('.subtab-button[data-subtab]').forEach((button) => {
  button.addEventListener('click', () => { setNextRendererTelemetryTrigger('navigation'); setActiveSubtab(button.dataset.subtab); });
});

document.querySelectorAll('.earnings-subtab-button').forEach((button) => {
  button.addEventListener('click', () => { setNextRendererTelemetryTrigger('navigation'); setActiveEarningsSubtab(button.dataset.earningsSubtab); });
});

earningsMarketplaceSideButtons.forEach((button) => {
  button.addEventListener('click', () => {
    earningsMarketplaceSide = button.dataset.marketplaceSide === 'sell' ? 'sell' : 'buy';
    if (latestEarningsResult) renderEarningsMarketplace(latestEarningsResult);
  });
});

document.querySelectorAll('.optimization-subtab-button').forEach((button) => {
  button.addEventListener('click', () => setActiveOptimizationSubtab(button.dataset.optimizationSubtab));
});

document.querySelectorAll('.optimization-view-button').forEach((button) => {
  button.addEventListener('click', () => setActiveOptimizationView(button.dataset.optimizationView));
});

optimizationAnalyticsExperiment?.addEventListener('change', renderScanningOptimizationAnalytics);
optimizationAnalyticsMetric?.addEventListener('change', renderScanningOptimizationAnalytics);
optimizationAnalyticsParameter?.addEventListener('change', () => { selectedScanningOptimizationParameter = optimizationAnalyticsParameter.value; renderScanningOptimizationAnalytics(); });
optimizationAnalyticsRankingHead?.addEventListener('click', (event) => {
  const header = event.target.closest('[data-optimization-analytics-sort]');
  if(!header) return;
  const column = header.dataset.optimizationAnalyticsSort;
  optimizationAnalyticsSort = optimizationAnalyticsSort.column === column
    ? { column, direction: optimizationAnalyticsSort.direction === 'desc' ? 'asc' : 'desc' }
    : { column, direction: 'desc' };
  renderScanningOptimizationAnalytics();
});
optimizationAnalyticsOnlyOptimization?.addEventListener('change', () => {
  selectedScanningOptimizationDate = '';
  scanningOptimizationCalendarMonth = '';
  if(optimizationAnalyticsExperiment) optimizationAnalyticsExperiment.value = '__latest__';
  renderScanningOptimizationAnalytics();
});
optimizationAnalyticsCalendarPrevious?.addEventListener('click', () => moveScanningOptimizationCalendarMonth(-1));
optimizationAnalyticsCalendarNext?.addEventListener('click', () => moveScanningOptimizationCalendarMonth(1));

renderEarningsColumnControls();
setupEarningsFilterHandlers();
setupEarningsHeaderSortHandlers();

// Apply chart mode visual state for every earnings subtab at startup
// so the segmented Total / Per Crew buttons reflect the persisted
// earningsChartMode (always 'total' on first load).
for (const subtab of ['scanning', 'mining', 'crafting']) {
  applyEarningsChartModeState(subtab);
}

// Wire up the Total / Per Crew mode switches. The click handler
// resolves the owning earnings subtab by walking up to the nearest
// .earnings-panel, then re-renders the relevant renderer. Visual
// state is synced by applyEarningsChartModeState after the state
// update.
document.querySelectorAll('[data-earnings-chart-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    const panel = button.closest('.earnings-panel');
    const subtab = panel?.dataset?.earningsPanel;
    if (!subtab || !button.dataset.earningsChartMode) return;
    setEarningsChartMode(subtab, button.dataset.earningsChartMode);
  });
});

document.querySelectorAll('[data-chart-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const panel = button.closest('[data-chart-panel]');
    const collapsed = panel?.classList.toggle('collapsed') || false;
    button.setAttribute('aria-expanded', String(!collapsed));
  });
});

document.querySelectorAll('[data-cargo-table-select]').forEach((button) => {
  button.addEventListener('click', () => {
    activeCargoTable = button.dataset.cargoTableSelect === 'allocation' ? 'allocation' : 'fleet';
    document.querySelectorAll('[data-cargo-table-select]').forEach((option) => {
      const selected = option.dataset.cargoTableSelect === activeCargoTable;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-selected', String(selected));
    });
    document.querySelectorAll('[data-cargo-table-panel]').forEach((view) => {
      const selected = view.dataset.cargoTablePanel === activeCargoTable;
      view.hidden = !selected;
    });
    renderEarningsColumnControls();
    if (activeCargoTable === 'allocation') refreshCargoAllocation();
  });
});

sidebarToggleButton?.addEventListener('click', () => {
  const collapsed = appShell?.classList.toggle('nav-collapsed') || false;
  sidebarToggleButton.setAttribute('aria-pressed', String(collapsed));
  sidebarToggleButton.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  sidebarToggleButton.textContent = collapsed ? '>' : '<';
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
  renderEarningsEmpty(getActivePlayerProfile(latestSettings) ? 'Loading earnings data...' : 'Awaiting player profile');
  await refreshVisibleFactionViews();
}

factionButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const clickedFaction = normalizeFaction(button.dataset.faction);
    if (latestSettings && normalizeFaction(latestSettings.faction) === clickedFaction) return;

    // Cache current faction's filter state before switching
    const oldFaction = normalizeFaction(latestSettings?.faction);
    recordFactionFilterState(oldFaction);
    // Clear the loaded-result guards from the previous faction. Without
    // this, tab clicks see a non-null result and incorrectly skip both the
    // new faction's prefetched cache and its on-demand request.
    resetFactionScopedState();

    const nextSettings = mergeSettingsFromForm({ faction: clickedFaction });
    latestSettings = nextSettings;
    // Allow the new faction to start its own earnings request immediately;
    // the request guard prevents the superseded response from committing.
    earningsRefreshInFlight = null;
    updateFactionButtons(nextSettings);
    updateSettingsStatus(nextSettings);

    // Restore cached filter selections for new faction
    restoreFactionFilterState(clickedFaction);

    // Render cached data immediately if available (per-filter cache)
    const faction = clickedFaction;
    const cachedFleet = getCachedFactionResult(faction, 'fleet');
    if (cachedFleet) renderFleets(cachedFleet);
    const cachedEarnings = getCachedFactionResult(faction, 'earnings');
    if (cachedEarnings) renderEarnings(cachedEarnings);
    const cachedSdu = getCachedFilterResult(faction, 'sdu', selectedScanningFleet);
    if (cachedSdu) renderSduChart(cachedSdu);
    const cachedMining = getCachedFilterResult(faction, 'mining', selectedMiningStarbase, selectedMiningFleet);
    if (cachedMining) renderMiningCharts(cachedMining);
    const cachedCrafting = getCachedFilterResult(faction, 'crafting', selectedCraftingStarbase, selectedCraftingRecipe);
    if (cachedCrafting) renderCraftingCharts(cachedCrafting);
    const cachedProduction = getCachedFilterResult(faction, 'production', selectedProductionStarbase, selectedProductionAsset);
    if (cachedProduction) renderProductionCharts(cachedProduction);
    const cachedInventory = getCachedFactionResult(faction, 'inventory::__all__');
    if (cachedInventory) renderInventory(cachedInventory);
    // Consumption Scanning is canonical profile/filter keyed. Clear any
    // incompatible prior DOM and ensure the next identity immediately.
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'scanning') {
      renderConsScanningEmpty('Loading scanning consumption...');
      if (typeof setNextRendererTelemetryTrigger === 'function') setNextRendererTelemetryTrigger('settings');
      void refreshConsScanning({ settings: nextSettings });
    }
    // Consumption Mining is canonical profile/filter keyed. Clear any
    // incompatible prior DOM and ensure the next identity immediately.
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'mining') {
      renderConsMiningEmpty('Loading mining consumption...');
      if (typeof setNextRendererTelemetryTrigger === 'function') setNextRendererTelemetryTrigger('settings');
      void refreshConsMining({ settings: nextSettings });
    }
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'cargo') {
      renderConsCargoEmpty('Loading cargo consumption...');
      if (typeof setNextRendererTelemetryTrigger === 'function') setNextRendererTelemetryTrigger('settings');
      void refreshConsCargo({ settings: nextSettings });
    }
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'crafting') {
      renderConsCraftingEmpty('Loading crafting consumption...');
      if (typeof setNextRendererTelemetryTrigger === 'function') setNextRendererTelemetryTrigger('settings');
      void refreshConsCrafting({ settings: nextSettings });
    }
    // Consumption Upgrading is profile- and filter-keyed in the canonical
    // preload cache. Never render its legacy faction-only cache here: after a
    // same-faction profile change it may belong to the previous profile.
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'upgrading') {
      renderConsUpgradingEmpty('Loading upgrading consumption...');
      if (typeof setNextRendererTelemetryTrigger === 'function') setNextRendererTelemetryTrigger('settings');
      void refreshConsUpgrading({ settings: nextSettings });
    }
    if (currentSection === 'production' && currentSubtab === 'consumption' && currentConsumptionSubtab === 'total') {
      renderConsTotalEmpty('Loading total consumption...');
      if (typeof setNextRendererTelemetryTrigger === 'function') setNextRendererTelemetryTrigger('settings');
      void refreshConsTotal({ settings: nextSettings });
    }
    const cachedPcr = getCachedFactionResult(faction, 'pcr');
    if (cachedPcr) renderPcrCharts(cachedPcr);

    saveStatus.textContent = `Switching to ${clickedFaction}...`;
    try {
      const saved = await api.saveSettings(nextSettings);
      latestSettings = saved;
      setFormValues(saved);
      updateSettingsStatus(saved);
      if (typeof setNextRendererTelemetryTrigger === 'function') setNextRendererTelemetryTrigger('settings');
      await loadVisibleThenPrefetch(refreshVisibleFactionViews);
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
  if (selectCachedSduFleet(latestSduResult, selectedScanningFleet)) return;
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
productionAssetFilter.addEventListener('change', () => {
  selectedProductionAsset = productionAssetFilter.value;
  selectedProductionStarbase = '';
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
    setNextRendererTelemetryTrigger('navigation');
    if (currentConsumptionSubtab === 'mining') refreshConsMining();
    if (currentConsumptionSubtab === 'scanning') refreshConsScanning();
    if (currentConsumptionSubtab === 'upgrading') refreshConsUpgrading();
    if (currentConsumptionSubtab === 'cargo') refreshConsCargo();
    if (currentConsumptionSubtab === 'crafting') refreshConsCrafting();
    if (currentConsumptionSubtab === 'total') refreshConsTotal();
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
  refreshConsCrafting();
});
consCraftingRecipeFilter.addEventListener('change', () => {
  selectedConsCraftingRecipe = consCraftingRecipeFilter.value;
  refreshConsCrafting();
});

// Consumption — Upgrading filters
consUpgradingStarbaseFilter.addEventListener('change', () => {
  selectedConsUpgradingStarbase = consUpgradingStarbaseFilter.value;
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
consTotalAssetFilter.addEventListener('change', () => {
  selectedConsTotalAsset = consTotalAssetFilter.value;
  selectedConsTotalStarbase = '';
  refreshConsTotal();
});

openSettingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', closeSettings);

refreshDataButton?.addEventListener('click', async () => {
  refreshDataButton.disabled = true;
  refreshDataButton.textContent = 'Refreshing...';
  try {
    setNextRendererTelemetryTrigger('manual');
    await refreshCurrentVisibleData();
  } finally {
    refreshDataButton.disabled = false;
    refreshDataButton.textContent = 'Refresh data';
  }
});

updateButton.addEventListener('click', () => {
  void checkForUpdates({ openModal: true });
});

rpcUsageButton.addEventListener('click', () => {
  setRpcUsageModalOpen(true);
  void loadRpcUsage(currentUtcDate());
});
rpcUsageCloseButton.addEventListener('click', () => setRpcUsageModalOpen(false));
rpcUsageModal.addEventListener('click', (event) => {
  if (event.target === rpcUsageModal) setRpcUsageModalOpen(false);
});
rpcUsageDateSelect.addEventListener('change', () => void loadRpcUsage(rpcUsageDateSelect.value));
rpcUsageFactionSelect.addEventListener('change', renderRpcUsage);
rpcUsageMethodSelect.addEventListener('change', renderRpcUsage);

updateCancelButton.addEventListener('click', () => setUpdateModalOpen(false));
updateModal.addEventListener('click', (event) => {
  if (event.target === updateModal) setUpdateModalOpen(false);
});

updateConfirmButton.addEventListener('click', async () => {
  if (!availableUpdate?.updateAvailable) return;
  updateConfirmButton.disabled = true;
  updateCancelButton.disabled = true;
  setText(updateMessage, `Downloading My Star Atlas v${availableUpdate.latestVersion}, preparing the update, and restarting...`);
  try {
    await api.downloadUpdateAndRestart();
  } catch (error) {
    console.error(error);
    setText(updateMessage, `Update failed: ${error?.message || String(error)}`);
    updateConfirmButton.disabled = false;
    updateCancelButton.disabled = false;
  }
});

settingsOverlay.addEventListener('click', (event) => {
  if (event.target === settingsOverlay) {
    closeSettings();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!rpcUsageModal.hidden) setRpcUsageModalOpen(false);
    else if (!updateModal.hidden) setUpdateModalOpen(false);
    else if (!settingsOverlay.classList.contains('hidden')) closeSettings();
  }
});

toggleSensitiveButton.addEventListener('click', () => {
  const hidden = form.classList.toggle('sensitive-hidden');
  toggleSensitiveButton.textContent = hidden ? 'Show RPC URL' : 'Hide RPC URL';
});

sendRpcLimiterButton.addEventListener('click', async () => {
  sendRpcLimiterButton.disabled = true;
  saveStatus.textContent = 'Sending RPC limiter settings...';
  try {
    const payload = getFormPayload();
    const status = await api.sendSettingsToRpcLimiter({
      rpcUrl: payload.rpcUrl,
      rpcRequestsPerSecond: payload.rpcRequestsPerSecond,
      providerRole: payload.providerRole,
    });
    renderRpcLimiterStatus(status);
    const rpcLimiterSlot = payload.providerRole === 'fallback' ? 'Fallback' : 'Main';
    const rpcLimiterAction = String(payload.rpcUrl || '').trim() ? 'updated' : 'cleared';
    saveStatus.textContent = `RPC limiter ${rpcLimiterSlot} slot ${rpcLimiterAction}`;
  } catch (error) {
    saveStatus.textContent = `RPC limiter update failed: ${error?.message || String(error)}`;
  } finally {
    sendRpcLimiterButton.disabled = false;
  }
});

function classifySettingsImpact(previous, submitted, saved) {
  const secretReplacement = (key) => String(submitted?.[key] || '').trim().length > 0;
  const factionChanged = normalizeFaction(previous?.faction) !== normalizeFaction(saved?.faction);
  const profileChanged = getActivePlayerProfile(previous) !== getActivePlayerProfile(saved);
  const influxConnectionChanged = previous?.influxUrl !== saved?.influxUrl || secretReplacement('influxAuthToken');
  const influxBucketChanged = previous?.influxBucket !== saved?.influxBucket;
  const optimizationBucketChanged = previous?.influxOptimizationBucket !== saved?.influxOptimizationBucket;
  const aephiaSourceChanged = secretReplacement('aephiaApiKey');
  const rpcSourceChanged = previous?.useRpcLimiter !== saved?.useRpcLimiter || secretReplacement('rpcUrl');
  const influxSourceChanged = influxConnectionChanged || influxBucketChanged;
  const earningsSourceChanged = aephiaSourceChanged || rpcSourceChanged;
  const dataChanged = factionChanged || profileChanged || influxSourceChanged || optimizationBucketChanged || earningsSourceChanged;
  return { factionChanged, profileChanged, influxConnectionChanged, influxBucketChanged, optimizationBucketChanged, aephiaSourceChanged, rpcSourceChanged, influxSourceChanged, earningsSourceChanged, dataChanged };
}

function getVisibleDataset() {
  if (currentSection === 'fleet') return 'fleet';
  if (currentSection === 'earnings') return currentEarningsSubtab === 'marketplace' ? 'marketplace' : 'earnings';
  if (currentSection === 'optimization') return 'optimization';
  if (currentSection === 'production') return currentSubtab === 'consumption' ? 'production-consumption' : 'production';
  return 'none';
}

function isVisibleDatasetAffected(impact, visibleDataset = getVisibleDataset()) {
  if (impact.factionChanged || impact.profileChanged) return true;
  if (visibleDataset === 'fleet') return impact.rpcSourceChanged;
  if (visibleDataset === 'earnings') return impact.influxConnectionChanged || impact.influxBucketChanged || impact.aephiaSourceChanged || impact.rpcSourceChanged;
  if (visibleDataset === 'optimization') return impact.influxConnectionChanged || impact.optimizationBucketChanged;
  if (visibleDataset === 'production' || visibleDataset === 'production-consumption') return impact.influxConnectionChanged || impact.influxBucketChanged;
  return false;
}

function getLegacyResetPlan(impact) {
  return {
    identity: impact.factionChanged || impact.profileChanged,
    fleet: impact.rpcSourceChanged,
    earnings: impact.influxConnectionChanged || impact.influxBucketChanged || impact.aephiaSourceChanged || impact.rpcSourceChanged,
    optimization: impact.influxConnectionChanged || impact.optimizationBucketChanged,
    influxPrimary: impact.influxConnectionChanged || impact.influxBucketChanged,
  };
}

function resetLegacyStateForImpact(impact) {
  const plan = getLegacyResetPlan(impact);
  if (plan.identity) {
    resetFactionScopedState();
    return;
  }
  if (plan.fleet) resetLegacyFleetState();
  if (plan.earnings) resetLegacyEarningsState();
  if (plan.optimization) resetLegacyOptimizationState();
  if (plan.influxPrimary) resetLegacyInfluxPrimaryState();
}

async function applySettingsSave(submitted, orchestrationGeneration) {
  const previous = latestSettings || {};
  const saved = await api.saveSettings(submitted);
  if (orchestrationGeneration !== settingsSaveGeneration) return saved;
  const impact = classifySettingsImpact(previous, submitted, saved);
  const visibleDataset = getVisibleDataset();
  const visibleAffected = isVisibleDatasetAffected(impact, visibleDataset);
  ++factionPrefetchGeneration;
  if (impact.influxSourceChanged) api.settingsCacheControl.markInfluxSourceChanged();
  else if (impact.earningsSourceChanged) api.settingsCacheControl.markEarningsSourceChanged();
  resetLegacyStateForImpact(impact);
  latestSettings = saved;
  setFormValues(saved);
  updateFactionButtons(saved);
  updateSettingsStatus(saved);
  if (impact.dataChanged) {
    if (visibleAffected) {
      const force = impact.influxSourceChanged || impact.optimizationBucketChanged || impact.earningsSourceChanged;
      if (typeof setNextRendererTelemetryTrigger === 'function') setNextRendererTelemetryTrigger('settings');
      await refreshVisibleIdentity({ force });
    }
    if (orchestrationGeneration === settingsSaveGeneration) {
      const generation = ++factionPrefetchGeneration;
      if (typeof setNextRendererTelemetryTrigger === 'function') setNextRendererTelemetryTrigger('settings');
      void runFactionBackgroundPrefetch(generation, normalizeFaction(saved.faction));
    }
  }
  return saved;
}

let settingsSaveGeneration = 0;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  saveStatus.textContent = 'Saving...';
  const generation = ++settingsSaveGeneration;
  try {
    await applySettingsSave(getFormPayload(), generation);
    if (generation !== settingsSaveGeneration) return;
    saveStatus.textContent = 'Saved';
    setTimeout(() => { if (saveStatus.textContent === 'Saved') saveStatus.textContent = ''; }, 2200);
  } catch (error) {
    console.error(error);
    if (generation === settingsSaveGeneration) saveStatus.textContent = 'Save failed';
  }
});

testInfluxButton.addEventListener('click', async () => {
  testInfluxButton.disabled = true;
  saveStatus.textContent = 'Testing Influx...';
  try {
    const result = await api.testInflux(getFormPayload());
    updateInfluxResult(result);
    saveStatus.textContent = result.ok ? 'Influx connected' : formatInfluxError(result.error);
  } catch (error) {
    console.error(error);
    const message = formatInfluxError(error?.message);
    updateInfluxResult({ ok: false, error: error?.message });
    saveStatus.textContent = message;
  } finally {
    testInfluxButton.disabled = false;
  }
});

form.addEventListener('input', () => {
  latestSettings = {
    ...getFormPayload(),
    secureSettingsStatus: latestSettings?.secureSettingsStatus || {},
  };
  updateFactionButtons(latestSettings);
  updateSettingsStatus(latestSettings);
});

fleetSearchInput.addEventListener('input', renderFleetSearch);

for (const filter of [optimizationStartFilter, optimizationStopFilter, optimizationFleetFilter, optimizationExperimentFilter, optimizationEventFilter, optimizationOperationFilter, optimizationParameterFilter]) {
  filter?.addEventListener('change', () => refreshScanningOptimization());
}
for (const filter of [optimizationUpgradingStartFilter, optimizationUpgradingStopFilter]) {
  filter?.addEventListener('change', () => refreshUpgradingOptimization());
}
optimizationLoadMore?.addEventListener('click', () => refreshScanningOptimization({ append: true }));

for (const button of document.querySelectorAll('[data-earnings-cost-basis]')) {
  button.addEventListener('click', () => {
    const subtab = button.dataset.earningsCostBasis;
    const mode = button.dataset.costBasisMode;
    if (!(subtab in earningsCostBasisMode) || !['internal', 'external'].includes(mode)) return;
    earningsCostBasisMode[subtab] = mode;
    for (const sibling of document.querySelectorAll(`[data-earnings-cost-basis="${subtab}"]`)) {
      const active = sibling.dataset.costBasisMode === mode;
      sibling.classList.toggle('active', active);
      sibling.setAttribute('aria-pressed', String(active));
    }
    if (subtab === 'crafting') renderEarningsCrafting(latestEarningsResult);
    else renderEarningsUpgrading(latestUpgradingResult);
  });
}

loadInitialState().catch((error) => {
  console.error(error);
  saveStatus.textContent = 'Load failed';
});
