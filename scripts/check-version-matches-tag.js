'use strict';

// Guards against version drift between a pushed git tag and package.json.
// Used by the macOS release workflow before it builds/attaches an artifact
// to a GitHub Release: the Mac build must come from the exact same tagged
// version as whatever else is attached to that release.
//
// Usage: node scripts/check-version-matches-tag.js <tag>
// A leading "v" on the tag is optional and stripped before comparing.

const { detectVersionDrift } = require('./version-drift');

function main() {
  const tagArg = process.argv[2];
  if (!tagArg) {
    console.error('Usage: node scripts/check-version-matches-tag.js <tag>');
    process.exit(2);
  }

  const packageJson = require('../package.json');
  const drift = detectVersionDrift(tagArg, packageJson.version);
  if (drift) {
    console.error(`Version drift detected: ${drift} Refusing to build a macOS release artifact for a mismatched version.`);
    process.exit(1);
  }

  console.log(`OK: tag "${tagArg}" matches package.json version "${packageJson.version}".`);
}

main();
