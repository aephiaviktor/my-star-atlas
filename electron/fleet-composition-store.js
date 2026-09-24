'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const FLEET_COMPOSITION_SCHEMA_VERSION = 1;

function text(value) {
  return String(value || '').trim();
}

function normalizeShips(value) {
  return (Array.isArray(value) ? value : [])
    .filter((ship) => text(ship?.name) && Number.isFinite(Number(ship?.amount)) && Number(ship.amount) > 0)
    .map((ship) => ({ ...ship, amount: Number(ship.amount) }));
}

function createFleetCompositionStore({ filePath, now = Date.now } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('fleet_composition_file_path_required');
  if (typeof now !== 'function') throw new TypeError('fleet_composition_now_required');
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Best effort on filesystems without POSIX modes. */ }
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE IF NOT EXISTS fleet_compositions (
      faction TEXT NOT NULL,
      profile TEXT NOT NULL,
      fleet_account TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      ships_json TEXT NOT NULL,
      total_required_crew REAL,
      ship_types INTEGER NOT NULL DEFAULT 0,
      observed_at_ms INTEGER NOT NULL,
      PRIMARY KEY (faction, profile, fleet_account)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS fleet_compositions_label
      ON fleet_compositions(faction, profile, label);
  `);

  const upsertStatement = database.prepare(`
    INSERT INTO fleet_compositions (
      faction, profile, fleet_account, label, ships_json, total_required_crew, ship_types, observed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(faction, profile, fleet_account) DO UPDATE SET
      label = excluded.label,
      ships_json = excluded.ships_json,
      total_required_crew = excluded.total_required_crew,
      ship_types = excluded.ship_types,
      observed_at_ms = excluded.observed_at_ms
  `);
  const readStatement = database.prepare(`
    SELECT faction, profile, fleet_account, label, ships_json, total_required_crew, ship_types, observed_at_ms
    FROM fleet_compositions
    WHERE faction = ? AND profile = ? AND fleet_account = ?
  `);
  const readByLabelStatement = database.prepare(`
    SELECT faction, profile, fleet_account, label, ships_json, total_required_crew, ship_types, observed_at_ms
    FROM fleet_compositions
    WHERE faction = ? AND profile = ? AND label = ?
    ORDER BY observed_at_ms DESC, fleet_account ASC
  `);
  let closed = false;

  function requireOpen() {
    if (closed) throw new Error('fleet_composition_store_closed');
  }

  function mapRow(row) {
    if (!row) return null;
    let ships = [];
    try { ships = JSON.parse(String(row.ships_json || '[]')); } catch (_error) { ships = []; }
    return {
      faction: String(row.faction),
      profile: String(row.profile),
      fleetAccount: String(row.fleet_account),
      label: String(row.label || ''),
      ships: normalizeShips(ships),
      totalRequiredCrew: row.total_required_crew == null ? null : Number(row.total_required_crew),
      shipTypes: Number(row.ship_types || 0),
      observedAtMs: Number(row.observed_at_ms),
    };
  }

  function upsertComposition(entry = {}) {
    requireOpen();
    const faction = text(entry?.faction).toUpperCase().replace(/^UST$/, 'USTUR');
    const profile = text(entry?.profile);
    const fleetAccount = text(entry?.fleetAccount);
    const label = text(entry?.label);
    if (!faction || !profile || !fleetAccount) throw new TypeError('fleet_composition_identity_required');
    if (!Number.isFinite(Number(entry?.observedAtMs)) || Number(entry.observedAtMs) <= 0) {
      throw new TypeError('fleet_composition_observed_at_required');
    }
    const ships = normalizeShips(entry?.ships);
    const totalRequiredCrew = entry?.totalRequiredCrew == null || entry?.totalRequiredCrew === ''
      ? null : Number(entry.totalRequiredCrew);
    if (totalRequiredCrew != null && !Number.isFinite(totalRequiredCrew)) {
      throw new TypeError('fleet_composition_crew_invalid');
    }
    upsertStatement.run(
      faction,
      profile,
      fleetAccount,
      label,
      JSON.stringify(ships),
      totalRequiredCrew,
      ships.length,
      Math.floor(Number(entry.observedAtMs)),
    );
    return { faction, profile, fleetAccount, label, ships, totalRequiredCrew, shipTypes: ships.length, observedAtMs: Math.floor(Number(entry.observedAtMs)) };
  }

  function readComposition({ faction = '', profile = '', fleetAccount = '' } = {}) {
    requireOpen();
    const normalizedFaction = text(faction).toUpperCase().replace(/^UST$/, 'USTUR');
    const normalizedProfile = text(profile);
    const normalizedAccount = text(fleetAccount);
    if (!normalizedFaction || !normalizedProfile || !normalizedAccount) return null;
    return mapRow(readStatement.get(normalizedFaction, normalizedProfile, normalizedAccount));
  }

  function readCompositionByLabel({ faction = '', profile = '', label = '' } = {}) {
    requireOpen();
    const normalizedFaction = text(faction).toUpperCase().replace(/^UST$/, 'USTUR');
    const normalizedProfile = text(profile);
    const normalizedLabel = text(label);
    if (!normalizedFaction || !normalizedProfile || !normalizedLabel) return null;
    const rows = readByLabelStatement.all(normalizedFaction, normalizedProfile, normalizedLabel);
    if (!rows.length) return null;
    return mapRow(rows[0]);
  }

  function close() {
    if (closed) return;
    closed = true;
    database.close();
  }

  return {
    upsertComposition,
    readComposition,
    readCompositionByLabel,
    close,
  };
}

module.exports = {
  FLEET_COMPOSITION_SCHEMA_VERSION,
  createFleetCompositionStore,
};