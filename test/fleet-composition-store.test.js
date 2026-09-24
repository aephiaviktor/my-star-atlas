'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createFleetCompositionStore, FLEET_COMPOSITION_SCHEMA_VERSION } = require('../electron/fleet-composition-store');

function tempStore(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-composition-store-'));
  const filePath = path.join(dir, 'compositions.sqlite');
  t.after(() => {
    try { store.close(); } catch (_) { /* already closed or failed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const store = createFleetCompositionStore({ filePath, ...overrides });
  return { store, filePath, dir };
}

const SHIPS = [
  { shipAccount: 'ship-a', name: 'Opal Jetjet', amount: 7, requiredCrew: 5 },
  { shipAccount: 'ship-b', name: 'Fimbul Base', amount: 3, requiredCrew: 2 },
];

test('fleet composition store round-trips ships, crew, and observation time', () => {
  const { store } = tempStore(test);
  const entry = {
    faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-1', label: 'Garter Snake Fleet',
    ships: SHIPS, totalRequiredCrew: 41, observedAtMs: 1788091200000,
  };
  const stored = store.upsertComposition(entry);
  assert.equal(stored.shipTypes, 2);
  const read = store.readComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-1' });
  assert.equal(read.label, 'Garter Snake Fleet');
  assert.equal(read.totalRequiredCrew, 41);
  assert.equal(read.shipTypes, 2);
  assert.deepEqual(read.ships, SHIPS);
  assert.equal(read.observedAtMs, 1788091200000);
  assert.equal(store.readComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'missing' }), null);
});

test('fleet composition store keeps the newest observation per fleet', () => {
  const { store } = tempStore(test);
  store.upsertComposition({
    faction: 'ONI', profile: 'profile-a', fleetAccount: 'fleet-1', label: 'Old Label',
    ships: [{ name: 'Opal Jet', amount: 1 }], totalRequiredCrew: 2, observedAtMs: 1000,
  });
  store.upsertComposition({
    faction: 'ONI', profile: 'profile-a', fleetAccount: 'fleet-1', label: 'New Label',
    ships: [{ name: 'Ogrika', amount: 4 }], totalRequiredCrew: 9, observedAtMs: 2000,
  });
  const read = store.readComposition({ faction: 'ONI', profile: 'profile-a', fleetAccount: 'fleet-1' });
  assert.equal(read.label, 'New Label');
  assert.equal(read.totalRequiredCrew, 9);
  assert.deepEqual(read.ships, [{ name: 'Ogrika', amount: 4 }]);
  assert.equal(read.observedAtMs, 2000);
});

test('fleet composition store isolates faction, profile, and fleet account', () => {
  const { store } = tempStore(test);
  store.upsertComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-1', label: 'A', ships: [{ name: 'X', amount: 1 }], totalRequiredCrew: 1, observedAtMs: 1000 });
  store.upsertComposition({ faction: 'ONI', profile: 'profile-a', fleetAccount: 'fleet-1', label: 'B', ships: [{ name: 'Y', amount: 2 }], totalRequiredCrew: 2, observedAtMs: 1000 });
  store.upsertComposition({ faction: 'MUD', profile: 'profile-b', fleetAccount: 'fleet-1', label: 'C', ships: [{ name: 'Z', amount: 3 }], totalRequiredCrew: 3, observedAtMs: 1000 });
  store.upsertComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-2', label: 'D', ships: [{ name: 'W', amount: 4 }], totalRequiredCrew: 4, observedAtMs: 1000 });
  assert.equal(store.readComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-1' }).label, 'A');
  assert.equal(store.readComposition({ faction: 'ONI', profile: 'profile-a', fleetAccount: 'fleet-1' }).label, 'B');
  assert.equal(store.readComposition({ faction: 'MUD', profile: 'profile-b', fleetAccount: 'fleet-1' }).label, 'C');
  assert.equal(store.readComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-2' }).label, 'D');
  assert.equal(store.readComposition({ faction: 'UST', profile: 'profile-a', fleetAccount: 'fleet-1' }), null);
});

test('fleet composition store finds the newest composition by faction label fallback', () => {
  const { store } = tempStore(test);
  store.upsertComposition({ faction: 'USTUR', profile: 'profile-a', fleetAccount: 'fleet-1', label: 'Bongo Fleet', ships: [{ name: 'Opal Jetjet', amount: 6 }], totalRequiredCrew: 45, observedAtMs: 1000 });
  store.upsertComposition({ faction: 'USTUR', profile: 'profile-a', fleetAccount: 'fleet-2', label: 'Bongo Fleet', ships: [{ name: 'Fimbul Base', amount: 9 }], totalRequiredCrew: 30, observedAtMs: 5000 });
  const read = store.readCompositionByLabel({ faction: 'USTUR', profile: 'profile-a', label: 'Bongo Fleet' });
  assert.equal(read.fleetAccount, 'fleet-2');
  assert.deepEqual(read.ships, [{ name: 'Fimbul Base', amount: 9 }]);
  assert.equal(store.readCompositionByLabel({ faction: 'USTUR', profile: 'profile-a', label: 'Missing' }), null);
});

test('fleet composition store persists across a reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-composition-store-'));
  const filePath = path.join(dir, 'compositions.sqlite');
  t_after: {
    const first = createFleetCompositionStore({ filePath });
    first.upsertComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-1', label: 'Eagle Fleet', ships: SHIPS, totalRequiredCrew: 35, observedAtMs: 1000 });
    first.close();
  }
  const second = createFleetCompositionStore({ filePath });
  const read = second.readComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-1' });
  assert.equal(read.label, 'Eagle Fleet');
  assert.deepEqual(read.ships, SHIPS);
  assert.equal(read.totalRequiredCrew, 35);
  second.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fleet composition store fails closed on invalid identity, crew, and observation time', () => {
  const { store } = tempStore(test);
  const base = { faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-1', ships: SHIPS, totalRequiredCrew: 5, observedAtMs: 1000 };
  assert.throws(() => store.upsertComposition({ ...base, faction: '' }), /fleet_composition_identity_required/);
  assert.throws(() => store.upsertComposition({ ...base, profile: '  ' }), /fleet_composition_identity_required/);
  assert.throws(() => store.upsertComposition({ ...base, fleetAccount: '' }), /fleet_composition_identity_required/);
  assert.throws(() => store.upsertComposition({ ...base, observedAtMs: 0 }), /fleet_composition_observed_at_required/);
  assert.throws(() => store.upsertComposition({ ...base, observedAtMs: 'nope' }), /fleet_composition_observed_at_required/);
  assert.throws(() => store.upsertComposition({ ...base, totalRequiredCrew: 'nope' }), /fleet_composition_crew_invalid/);
});

test('fleet composition store rejects invalid ships and keeps a stable schema version', () => {
  const { store } = tempStore(test);
  const read = (ships) => store.readComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-1', ships })?.ships || [];
  store.upsertComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-1', label: 'A', ships: [{ name: 'X', amount: 1 }, { name: '', amount: 2 }, { name: 'Y', amount: 0 }], totalRequiredCrew: 1, observedAtMs: 1000 });
  const loaded = store.readComposition({ faction: 'MUD', profile: 'profile-a', fleetAccount: 'fleet-1' });
  assert.deepEqual(loaded.ships, [{ name: 'X', amount: 1 }]);
  assert.equal(FLEET_COMPOSITION_SCHEMA_VERSION, 1);
});