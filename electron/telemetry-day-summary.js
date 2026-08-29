'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { validDay } = require('./telemetry-ledger');
const { normalizeFaction, normalizeMethod } = require('./telemetry-context');

const FACTION_CATEGORIES = Object.freeze([
  Object.freeze({ key: 'MUD', label: 'MUD' }),
  Object.freeze({ key: 'ONI', label: 'ONI' }),
  Object.freeze({ key: 'USTUR', label: 'USTUR' }),
  Object.freeze({ key: 'global', label: 'Shared/Global' }),
  Object.freeze({ key: 'unknown', label: 'Unknown' }),
]);
const PROVIDER_CATEGORIES = Object.freeze(['main', 'fallback', 'direct', 'unknown']);
const MENU_CATEGORIES = Object.freeze(['MF', 'PC', 'EA', 'OP', 'other']);
const CANONICAL_TABS = Object.freeze({
  MF: new Set(['fleets']),
  PC: new Set(['scanning', 'mining', 'crafting', 'production', 'consumption', 'pct-charts', 'inventory']),
  EA: new Set(['scanning', 'mining', 'marketplace', 'cargo', 'crafting', 'upgrading', 'breakeven']),
  OP: new Set(['scanning', 'upgrading']),
});
function menuTab(d = {}) {
  const feature = String(d.feature || '');
  if (CANONICAL_TABS[feature]) {
    const tab = String(d.suboperation || '');
    return { menu: feature, tab: CANONICAL_TABS[feature].has(tab) ? tab : 'unattributed' };
  }
  if (feature === 'Fleet discovery') return { menu: 'MF', tab: 'fleets' };
  if (feature === 'Rental data') return { menu: 'MF', tab: 'unattributed' };
  if (feature === 'Marketplace LM' || feature === 'Marketplace GM') return { menu: 'EA', tab: 'marketplace' };
  if (feature === 'Earnings') {
    const tab = String(d.suboperation || '');
    return { menu: 'EA', tab: CANONICAL_TABS.EA.has(tab) ? tab : 'unattributed' };
  }
  return { menu: 'other', tab: 'unattributed' };
}
const UTC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function safeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function validateUtcDate(value) {
  const utcDate = String(value || '');
  const parsed = Date.parse(`${utcDate}T00:00:00.000Z`);
  if (!UTC_DATE_PATTERN.test(utcDate) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== utcDate) {
    throw new Error('invalid_utc_date');
  }
  return utcDate;
}

function normalizeProvider(value) {
  const provider = String(value || '').toLowerCase();
  return PROVIDER_CATEGORIES.includes(provider) ? provider : 'unknown';
}

function aggregateRpcUsageDay(day) {
  const rowsByKey = new Map();
  for (const bucket of Object.values(day?.minutes || {})) {
    for (const row of bucket?.rows || []) {
      const requests = safeInteger(row?.counters?.wireAttempts);
      if (requests === 0) continue;
      const faction = normalizeFaction(row?.dimensions?.faction);
      const method = normalizeMethod(row?.dimensions?.rpcMethod);
      const provider = normalizeProvider(row?.dimensions?.providerRole);
      const { menu, tab } = menuTab(row?.dimensions);
      const key = `${menu}\u001f${tab}\u001f${faction}\u001f${method}\u001f${provider}`;
      const target = rowsByKey.get(key) || {
        menu, tab, faction,
        method,
        provider,
        requests: 0,
        retries: 0,
        fallbackAttempts: 0,
        batchElements: 0,
      };
      target.requests += requests;
      target.retries += safeInteger(row?.counters?.retries);
      target.fallbackAttempts += safeInteger(row?.counters?.fallbackAttempts);
      target.batchElements += safeInteger(row?.counters?.batchElements);
      rowsByKey.set(key, target);
    }
  }

  const rows = [...rowsByKey.values()].sort((left, right) => (
    right.requests - left.requests
    || left.method.localeCompare(right.method)
    || left.faction.localeCompare(right.faction)
    || left.provider.localeCompare(right.provider)
  ));
  const totals = rows.reduce((result, row) => ({
    requests: result.requests + row.requests,
    retries: result.retries + row.retries,
    fallbackAttempts: result.fallbackAttempts + row.fallbackAttempts,
    batchElements: result.batchElements + row.batchElements,
  }), { requests: 0, retries: 0, fallbackAttempts: 0, batchElements: 0 });
  const factions = FACTION_CATEGORIES.map(({ key, label }) => ({
    key,
    label,
    requests: rows.filter((row) => row.faction === key).reduce((sum, row) => sum + row.requests, 0),
  }));
  const providers = PROVIDER_CATEGORIES.map((key) => ({
    key,
    label: key === 'main' ? 'Main' : key === 'fallback' ? 'Fallback' : key === 'direct' ? 'Direct' : 'Unknown',
    requests: rows.filter((row) => row.provider === key).reduce((sum, row) => sum + row.requests, 0),
  }));
  const menus = MENU_CATEGORIES.map((key) => ({ key, requests: rows.filter((row) => row.menu === key).reduce((sum, row) => sum + row.requests, 0) }));
  const factionTotal = factions.reduce((sum, item) => sum + item.requests, 0);
  const providerTotal = providers.reduce((sum, item) => sum + item.requests, 0);
  return {
    rows,
    totals,
    factions,
    providers,
    menus,
    tabsByMenu: Object.fromEntries(MENU_CATEGORIES.map((menu) => [menu, [...new Set(rows.filter((row) => row.menu === menu).map((row) => row.tab))].sort()])),
    methods: [...new Set(rows.map((row) => row.method))],
    reconciliation: {
      factionTotal,
      providerTotal,
      factionsMatch: factionTotal === totals.requests,
      providersMatch: providerTotal === totals.requests,
      menusMatch: menus.reduce((sum, item) => sum + item.requests, 0) === totals.requests,
    },
  };
}

async function listAvailableDates(activityRoot) {
  const entries = await fs.readdir(activityRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
    .map((entry) => entry.name.slice(0, 10))
    .sort((left, right) => right.localeCompare(left));
}

function unavailableSummary(utcDate, availableDates, reason) {
  return {
    schemaVersion: 1,
    utcDate,
    available: false,
    reason,
    periodLabel: null,
    lastUpdatedAt: null,
    availableDates,
    totalRequests: null,
    totals: null,
    rows: [],
    factions: [],
    providers: [],
    menus: [],
    tabsByMenu: {},
    methods: [],
    reconciliation: null,
  };
}

async function readRpcUsageDay({ userDataPath, installationId, utcDate, now = Date.now } = {}) {
  if (!userDataPath) throw new TypeError('userDataPath is required');
  const selectedDate = validateUtcDate(utcDate);
  const activityRoot = path.join(userDataPath, 'telemetry', 'rpc-activity-v1');
  const availableDates = await listAvailableDates(activityRoot);
  const filePath = path.join(activityRoot, `${selectedDate}.json`);
  let day;
  try {
    day = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    return unavailableSummary(selectedDate, availableDates, error?.code === 'ENOENT' ? 'missing' : 'corrupt');
  }
  if (!installationId || !validDay(day, installationId, selectedDate)) {
    return unavailableSummary(selectedDate, availableDates, 'corrupt');
  }
  const aggregate = aggregateRpcUsageDay(day);
  const currentUtcDate = new Date(now()).toISOString().slice(0, 10);
  return {
    schemaVersion: 1,
    utcDate: selectedDate,
    available: true,
    reason: null,
    periodLabel: selectedDate === currentUtcDate ? 'UTC day in progress' : 'Completed UTC day',
    lastUpdatedAt: day.updatedAt,
    availableDates,
    totalRequests: aggregate.totals.requests,
    ...aggregate,
  };
}

function createRpcUsageReader({ ledger, userDataPath, now = Date.now, readDay = readRpcUsageDay } = {}) {
  if (!ledger || typeof ledger.flush !== 'function' || typeof ledger.getInstallation !== 'function') {
    throw new TypeError('telemetry ledger is required');
  }
  return async function getRpcUsageDay(utcDate) {
    await ledger.flush();
    return readDay({
      userDataPath,
      installationId: ledger.getInstallation()?.installationId || null,
      utcDate,
      now,
    });
  };
}

module.exports = {
  FACTION_CATEGORIES,
  PROVIDER_CATEGORIES,
  validateUtcDate,
  aggregateRpcUsageDay,
  listAvailableDates,
  readRpcUsageDay,
  createRpcUsageReader,
};
