'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function isInfluxTimeout(error) {
  return /^influx_timeout_\d+ms$/.test(String(error?.message || error || ''));
}

function buildUtcWindows(nowMs, lookbackDays = 31, windowDays = 7) {
  const now = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startMs = todayStartMs - (lookbackDays - 1) * DAY_MS;
  const stopMs = todayStartMs + DAY_MS;
  const windows = [];
  for (let cursor = startMs; cursor < stopMs; cursor += windowDays * DAY_MS) {
    windows.push({ startMs: cursor, stopMs: Math.min(stopMs, cursor + windowDays * DAY_MS) });
  }
  return windows;
}

function absoluteRange({ startMs, stopMs }) {
  return `|> range(start: time(v: "${new Date(startMs).toISOString()}"), stop: time(v: "${new Date(stopMs).toISOString()}"))`;
}

async function queryCargoRowsWithWindowFallback({ query, buildQuery, parseCsv, nowMs = Date.now() }) {
  try {
    return parseCsv(await query(buildQuery('|> range(start: -31d)')));
  } catch (error) {
    if (!isInfluxTimeout(error)) throw error;
  }

  const rows = [];
  for (const window of buildUtcWindows(nowMs)) {
    rows.push(...parseCsv(await query(buildQuery(absoluteRange(window)))));
  }
  return rows;
}

module.exports = {
  buildUtcWindows,
  isInfluxTimeout,
  queryCargoRowsWithWindowFallback,
};
