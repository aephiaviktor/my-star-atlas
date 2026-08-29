'use strict';

function averageRecordedCrew(values) {
  const valid = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

module.exports = { averageRecordedCrew };
