const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererPath = path.join(__dirname, '..', 'electron', 'renderer.js');
const htmlPath = path.join(__dirname, '..', 'electron', 'renderer.html');

test('renderer does not use innerHTML for data-bearing DOM updates', () => {
  const source = fs.readFileSync(rendererPath, 'utf8');
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
});

test('renderer document defines a restrictive local-content CSP', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const cspTag = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]+"\s*\/?>/i)?.[0] || '';

  assert.match(cspTag, /default-src\s+'self'/);
  assert.match(cspTag, /script-src\s+'self'/);
  assert.match(cspTag, /object-src\s+'none'/);
  assert.match(cspTag, /base-uri\s+'none'/);
});
