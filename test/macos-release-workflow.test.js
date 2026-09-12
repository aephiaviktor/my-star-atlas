const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'release-macos.yml'),
  'utf8',
);

test('macOS packaging disables electron-builder implicit publishing', () => {
  assert.match(workflow, /run: npm run package:mac -- --publish never/);
});
