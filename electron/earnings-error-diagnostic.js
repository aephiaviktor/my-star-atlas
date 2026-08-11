'use strict';

const DEFAULT_MAX_BYTES = 8192;
const CATEGORY_ORDER = Object.freeze(['Scanning', 'Mining', 'Cargo', 'Crafting', 'Upgrading']);

function sanitize(value, max = 512) {
  return String(value || '')
    .replace(/https?:\/\/[^\s)'"`]+/gi, '[redacted-url]')
    .replace(/\b(?:authorization|token|api[_-]?key|influxAuthToken|aephiaApiKey)\b\s*[:=]?\s*(?:Bearer\s+)?\S*/gi, '[redacted-secret]')
    .replace(/\b[A-Za-z0-9_-]{28,}\b/g, '[redacted-identifier]')
    .slice(0, max);
}

function errorEnvelope(error) {
  const lines = String(error?.stack || '').split(/\r?\n/).slice(0, 12).map((line) => sanitize(line, 320));
  return {
    name: sanitize(error?.name || 'Error', 80),
    message: sanitize(error?.message || error || 'unknown_error', 512),
    code: sanitize(error?.code || '', 80),
    stack: lines.join('\n').slice(0, 2048),
  };
}

function categoryEnvelope(categories = {}) {
  const result = {};
  for (const name of CATEGORY_ORDER) {
    const entry = categories[name] || { status: 'pending' };
    result[name] = { status: ['pending', 'fulfilled', 'rejected'].includes(entry.status) ? entry.status : 'pending' };
    if (entry.status === 'rejected') result[name].error = errorEnvelope(entry.error);
  }
  return result;
}

function serializedBytes(value) {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);
}

function boundedRecord(record, maxBytes) {
  let output = record;
  if (serializedBytes(output) <= maxBytes) return output;
  output = { ...record, categories: Object.fromEntries(Object.entries(record.categories).map(([key, value]) => [key, { status: value.status, ...(value.error ? { error: { name: value.error.name, code: value.error.code, message: value.error.message.slice(0, 120), stack: '' } } : {}) }])), error: { ...record.error, message: record.error.message.slice(0, 120), stack: '' } };
  if (serializedBytes(output) <= maxBytes) return output;
  return { schemaVersion: 1, timestampUtc: record.timestampUtc, applicationVersion: record.applicationVersion, correlationId: record.correlationId, channel: record.channel, faction: record.faction, boundary: record.boundary, source: record.source, stage: record.stage, failingCategory: record.failingCategory, error: { name: record.error.name, code: record.error.code, message: 'diagnostic_truncated', stack: '' } };
}

function createEarningsErrorDiagnostic({ filePath, appVersion, writeAtomic, now = () => new Date(), maxBytes = DEFAULT_MAX_BYTES }) {
  if (!filePath || typeof writeAtomic !== 'function') throw new TypeError('earnings_diagnostic_dependencies_required');
  async function record({ correlationId, channel, faction, boundary = 'main', source = 'earnings:snapshot', stage = 'snapshot', categories = {}, error }) {
    const safeCategories = categoryEnvelope(categories);
    const failingCategory = CATEGORY_ORDER.find((name) => safeCategories[name]?.status === 'rejected') || null;
    const value = boundedRecord({ schemaVersion: 1, timestampUtc: now().toISOString(), applicationVersion: sanitize(appVersion, 32), correlationId: sanitize(correlationId, 96), channel: sanitize(channel, 64), faction: sanitize(faction, 16), boundary: sanitize(boundary, 32), source: sanitize(source, 64), stage: sanitize(stage, 64), failingCategory, categories: safeCategories, error: errorEnvelope(error) }, Math.max(1024, Number(maxBytes) || DEFAULT_MAX_BYTES));
    await writeAtomic(filePath, value);
    return value;
  }
  async function run(context, operation) {
    try { return await operation(); }
    catch (error) { await record({ ...context, error }).catch(() => {}); throw error; }
  }
  return Object.freeze({ record, run });
}

module.exports = { createEarningsErrorDiagnostic, sanitizeEarningsDiagnosticValue: sanitize, DEFAULT_MAX_BYTES };
