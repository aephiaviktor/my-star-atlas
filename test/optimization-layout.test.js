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
