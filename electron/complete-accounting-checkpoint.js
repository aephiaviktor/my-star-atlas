'use strict';

const fs = require('node:fs/promises');
const { writeJsonAtomic } = require('./atomic-json');

const SCHEMA_VERSION = 1;

function sameScope(left, right) {
  return String(left?.faction || '') === String(right?.faction || '') && String(left?.profile || '') === String(right?.profile || '');
}

async function loadCompleteAccountingCheckpoint(filePath, scope) {
  try {
    const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (document?.schemaVersion !== SCHEMA_VERSION || !sameScope(document.scope, scope) || !Array.isArray(document.events)) throw new Error('incompatible complete-accounting checkpoint');
    return { status: 'loaded', error: '', events: document.events, createdAt: document.createdAt || null, savedAt: document.savedAt || null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing', error: '', events: [], createdAt: null, savedAt: null };
    return { status: 'invalid', error: String(error?.message || error), events: [], createdAt: null, savedAt: null };
  }
}

function mergeCompleteAccountingEvents(previous = [], current = []) {
  const byPayload = new Map();
  for (const event of [...previous, ...current]) {
    if (!event?.eventId) continue;
    const key = `${event.eventId}\n${JSON.stringify(event)}`;
    if (!byPayload.has(key)) byPayload.set(key, event);
  }
  return [...byPayload.values()].sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)) || String(left.eventId).localeCompare(String(right.eventId)) || JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

async function saveCompleteAccountingCheckpoint(filePath, { scope, events, createdAt = null }) {
  const now = new Date().toISOString();
  await writeJsonAtomic(filePath, { schemaVersion: SCHEMA_VERSION, scope, createdAt: createdAt || now, savedAt: now, events });
  return now;
}

module.exports = { SCHEMA_VERSION, loadCompleteAccountingCheckpoint, mergeCompleteAccountingEvents, saveCompleteAccountingCheckpoint };
