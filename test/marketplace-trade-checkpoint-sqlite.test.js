'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('LM and GM checkpoint documents migrate from JSON into isolated SQLite scopes', () => {
  assert.match(main, /function marketplaceTradeCheckpointScope\(filePath\)/);
  assert.match(main, /createHash\('sha256'\)\.update\(path\.resolve\(filePath\), 'utf8'\)/);
  assert.match(main, /getMarketplaceCheckpointSqliteStore\(\)\.read\(scope\)/);
  assert.match(main, /getMarketplaceCheckpointSqliteStore\(\)\.write\(scope, document\)/);
  assert.match(main, /JSON\.parse\(await fs\.readFile\(filePath, 'utf8'\)\)/);
});

test('LM and GM checkpoint writes use SQLite primary with a JSON rollback mirror', () => {
  assert.match(main, /async function saveMarketplaceTradeCheckpoint\(filePath, document\)/);
  assert.match(main, /await writeJsonAtomic\(filePath, document\)/);
  assert.doesNotMatch(main, /commitSafeCursor: \(\) => writeJsonAtomic\(filePath, safeCheckpointDocument\)/);
  assert.doesNotMatch(main, /await writeJsonAtomic\(filePath, checkpointDocument\)/);
  assert.match(main, /commitSafeCursor: \(\) => saveMarketplaceTradeCheckpoint\(filePath, safeCheckpointDocument\)/);
});

test('trade checkpoint normalization retains completed raw backfill state', () => {
  assert.match(main, /rawDataBackfilled: document\?\.rawDataBackfilled === true/);
});
