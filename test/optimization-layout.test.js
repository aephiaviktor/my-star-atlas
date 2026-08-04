const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.css'), 'utf8');

test('optimization flex chain gives the scrollable table a definite height', () => {
  assert.match(css, /\.section-view\[data-section-panel="optimization"\]\.active\s*\{[^}]*flex:\s*1 1 0;[^}]*height:\s*0;/s);
  assert.match(css, /\.optimization-panel\.active\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;/s);
  assert.match(css, /\.optimization-surface\s*\{[^}]*flex:\s*1 1 0;[^}]*height:\s*100%;/s);
  assert.match(css, /\.optimization-surface > \.fleet-table-wrap\s*\{[^}]*flex:\s*1 1 0;[^}]*height:\s*0;[^}]*overflow:\s*scroll;/s);
});

test('optimization table has visible scrollbar tracks and thumbs', () => {
  assert.match(css, /\.optimization-surface > \.fleet-table-wrap::\-webkit-scrollbar\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/s);
  assert.match(css, /\.optimization-surface > \.fleet-table-wrap::\-webkit-scrollbar-thumb/);
});

test('optimization toolbar stacks primary tabs above indented secondary tabs', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.html'), 'utf8');
  assert.match(html, /class="optimization-tab-row optimization-primary-tabs"[\s\S]*data-optimization-subtab="scanning"[\s\S]*data-optimization-subtab="upgrading"/);
  assert.match(html, /class="optimization-tab-row optimization-secondary-tabs"[\s\S]*data-optimization-view="data"[\s\S]*data-optimization-view="analytics"/);
  assert.ok(html.indexOf('optimization-primary-tabs') < html.indexOf('optimization-secondary-tabs'));
  assert.match(css, /\.optimization-toolbar-tabs\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(css, /\.optimization-secondary-tabs\s*\{[^}]*padding-left:\s*18px;[^}]*font-size:\s*12px;/s);
});
