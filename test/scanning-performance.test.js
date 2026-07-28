const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');

test('SDU production and consumption use separate IPC endpoints', () => {
  assert.match(mainSource, /handleTrustedIpc\('sdu:consumption'/);
  assert.match(preloadSource, /getDailySduConsumption:/);
});

test('Scanning renders production before awaiting consumption', () => {
  const refresh = rendererSource.slice(
    rendererSource.indexOf('async function refreshDailySdu()'),
    rendererSource.indexOf('\nfunction setFleetStatus', rendererSource.indexOf('async function refreshDailySdu()')),
  );
  const renderIndex = refresh.indexOf('renderSduChart(result)');
  const consumptionAwaitIndex = refresh.indexOf('await consumptionPromise');
  assert.ok(renderIndex >= 0, 'production result should be rendered');
  assert.ok(consumptionAwaitIndex > renderIndex, 'consumption should be awaited only after production renders');
});
