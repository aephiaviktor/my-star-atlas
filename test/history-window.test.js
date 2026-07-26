const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'electron', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'electron', 'renderer.html'), 'utf8');

test('historical dashboards use a 30-day display window with a 31-day query buffer', () => {
  assert.match(main, /function createDayTemplates\(dayCount = 30\)/);
  assert.doesNotMatch(main, /getLastUtcDays\(14\)/);
  assert.doesNotMatch(main, /range\(start: -15d\)/);
  assert.match(main, /range\(start: -31d\)/);
});

test('historical dashboard copy consistently says 30 days', () => {
  const combined = `${main}\n${renderer}\n${html}`;
  assert.doesNotMatch(combined, /Last 14 days|last 14 days|over 14 days|14-day window|full 14 days|14 completed days|14d\b/);
  assert.match(combined, /Last 30 days/);
});
