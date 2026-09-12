const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const excludedDirectories = new Set(['.git', 'node_modules']);
const textExtensions = new Set([
  '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.sh', '.txt', '.vbs', '.yaml', '.yml',
]);
const conflictMarker = /^(?:<{7}(?: |$)|={7}$|>{7}(?: |$))/m;

function textFilesUnder(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excludedDirectories.has(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...textFilesUnder(filePath));
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) files.push(filePath);
  }
  return files;
}

test('repository text files contain no unresolved Git conflict markers', () => {
  const conflictedFiles = textFilesUnder(repositoryRoot)
    .filter((filePath) => conflictMarker.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(repositoryRoot, filePath));

  assert.deepEqual(conflictedFiles, []);
});
