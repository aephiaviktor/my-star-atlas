'use strict';

const EARNINGS_CACHE_KEY_NAMESPACE = 'msa:earnings-cache:';
const REQUIRED_FIELDS = Object.freeze([
  'schemaVersion',
  'faction',
  'playerProfile',
  'section',
  'subtab',
  'datasetScope',
  'filters',
]);
const FACTIONS = new Set(['MUD', 'ONI', 'USTUR']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalSerialize(value, ancestors = new Set()) {
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Filter numbers must be finite');
    return Object.is(value, -0) ? '-0' : String(value);
  }
  if (type !== 'object') throw new TypeError(`Unsupported filter value type: ${type}`);
  if (ancestors.has(value)) throw new TypeError('Cyclic filter structures are unsupported');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const arrayKeys = Reflect.ownKeys(value);
      if (arrayKeys.some((key) => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))) {
        throw new TypeError('Unsupported array property');
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError('Sparse filter arrays are unsupported');
        }
      }
      return `[${value.map((item) => canonicalSerialize(item, ancestors)).join(',')}]`;
    }
    if (!isPlainObject(value)) throw new TypeError('Filter values must be JSON primitives, arrays, or plain objects');
    const propertyKeys = Reflect.ownKeys(value);
    if (propertyKeys.some((key) => typeof key !== 'string')) throw new TypeError('Unsupported symbol property');
    for (const key of propertyKeys) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property.enumerable || !Object.prototype.hasOwnProperty.call(property, 'value')) {
        throw new TypeError('Unsupported non-data object property');
      }
    }
    return `{${propertyKeys
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(value[key], ancestors)}`)
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function requireNonemptyString(descriptor, field) {
  const value = descriptor[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be an explicit nonempty string`);
  }
  return value;
}

function buildEarningsCacheKey(descriptor) {
  if (!isPlainObject(descriptor)) throw new TypeError('Cache key descriptor must be a plain object');
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(descriptor, field)) throw new TypeError(`${field} is required`);
  }
  for (const field of Object.keys(descriptor)) {
    if (!REQUIRED_FIELDS.includes(field)) throw new TypeError(`Unsupported descriptor field: ${field}`);
  }

  const schemaVersion = requireNonemptyString(descriptor, 'schemaVersion');
  const faction = requireNonemptyString(descriptor, 'faction');
  if (!FACTIONS.has(faction)) throw new TypeError('faction must be MUD, ONI, or USTUR');
  const playerProfile = requireNonemptyString(descriptor, 'playerProfile');
  const section = requireNonemptyString(descriptor, 'section');
  const subtab = requireNonemptyString(descriptor, 'subtab');
  const datasetScope = requireNonemptyString(descriptor, 'datasetScope');
  if (!isPlainObject(descriptor.filters)) throw new TypeError('filters must be an explicit plain object');

  return EARNINGS_CACHE_KEY_NAMESPACE + canonicalSerialize({
    schemaVersion,
    faction,
    playerProfile,
    section,
    subtab,
    datasetScope,
    filters: descriptor.filters,
  });
}

module.exports = {
  EARNINGS_CACHE_KEY_NAMESPACE,
  buildEarningsCacheKey,
};
