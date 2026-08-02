'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname,'..','electron','renderer.js'),'utf8');
const keyBuilder = require('../electron/earnings-cache-key').buildEarningsCacheKey;
const between=(a,b)=>renderer.slice(renderer.indexOf(a),renderer.indexOf(b,renderer.indexOf(a)));

test('Breakeven canonical descriptor is complete and cannot collide with lightweight Earnings', () => {
  const complete=keyBuilder({schemaVersion:'1',faction:'MUD',playerProfile:'ActualProfile',section:'earnings',subtab:'breakeven',datasetScope:'complete',filters:{}});
  const light=keyBuilder({schemaVersion:'1',faction:'MUD',playerProfile:'ActualProfile',section:'earnings',subtab:'breakeven',datasetScope:'lightweight',filters:{}});
  assert.notEqual(complete,light);
  const refresh=between('function getBreakevenCacheInput','async function refreshEarnings');
  assert.match(refresh,/getActivePlayerProfile\(settings\)/); assert.match(refresh,/filters: \{\}/);
  assert.doesNotMatch(refresh,/getCachedFactionResult|latestEarningsResult/);
});

test('activation, initial loading, stale display, and manual refresh use only Breakeven cache state', () => {
  const activation=between('function setActiveEarningsSubtab','async function loadInitialState');
  assert.match(activation,/subtab === 'breakeven'[\s\S]*refreshBreakeven\(\)/);
  const refresh=between('async function refreshBreakeven','async function refreshEarnings');
  assert.match(refresh,/breakevenCache\.inspect\(input\)/);
  assert.match(refresh,/initial\?\.entry\?\.value \|\| initial\?\.entry\?\.lastGoodValue/);
  assert.match(refresh,/breakevenCache\.ensure\(input/);
  assert.match(refresh,/getEarningsSnapshot\(settings\)/);
  const manual=between('function refreshCurrentVisibleData','function setActiveSubtab');
  assert.match(manual,/currentEarningsSubtab === 'breakeven'\) return refreshBreakeven\(\{ force: true \}\)/);
});

test('late faction/profile/generation responses and leaving Breakeven cannot update active DOM', () => {
  const guard=between('function isActiveBreakevenContext','async function refreshEarnings');
  assert.match(guard,/currentSection !== 'earnings'/);
  assert.match(guard,/currentEarningsSubtab !== 'breakeven'/);
  assert.match(guard,/getBreakevenCacheInput\(\)/);
  assert.match(guard,/buildKey\(input\) !== key/);
  assert.match(guard,/entry\?\.generation === generation/);
  assert.match(guard,/if \(!isActiveBreakevenContext\(settled\.key, settled\.entry\.generation\)\) return settled/);
});

test('broad Earnings cache cannot satisfy Breakeven and other views retain existing paths', () => {
  const refresh=between('async function refreshBreakeven','async function refreshEarnings');
  assert.doesNotMatch(refresh,/\['earnings'\]|'earnings'\)|latestEarningsResult|earningsRefreshInFlight/);
  assert.match(renderer,/const cached = getCachedFactionResult\(faction, 'earnings'\)/);
  assert.match(renderer,/setCachedFactionResult\(normalizeFaction\(latestSettings\?\.faction\), 'earnings', result\)/);
  assert.match(renderer,/if \(\(subtab === 'scanning' \|\| subtab === 'mining' \|\| subtab === 'cargo' \|\| subtab === 'crafting'\) && !latestEarningsResult\)/);
  assert.match(renderer,/key: 'earnings'.*getCachedFactionResult\(faction, 'earnings'\)/);
});

test('background prefetch, IPC, calculations, Marketplace, and non-Breakeven paths stay outside migration', () => {
  for(const token of ['runFactionBackgroundPrefetch','refreshMarketplace','refreshEarnings','renderEarningsMining','renderEarningsCargo','renderEarningsCrafting','renderEarningsUpgrading']) assert.match(renderer,new RegExp(token));
  assert.doesNotMatch(renderer,/BREAKEVEN_CACHE_FRESHNESS_MS|900000|15 \* 60 \* 1000/);
});
