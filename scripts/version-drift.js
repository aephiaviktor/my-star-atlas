'use strict';

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

// Returns null when the tag and package version agree (no drift), or a
// human-readable reason string when they don't / can't be compared.
function detectVersionDrift(tag, packageVersion) {
  const tagVersion = normalizeVersion(tag);
  const pkgVersion = normalizeVersion(packageVersion);

  if (!tagVersion) return `Could not parse a version out of tag "${tag}".`;
  if (!pkgVersion) return 'package.json has no usable version.';
  if (tagVersion !== pkgVersion) {
    return `git tag resolves to "${tagVersion}" but package.json version is "${pkgVersion}".`;
  }
  return null;
}

module.exports = { normalizeVersion, detectVersionDrift };
