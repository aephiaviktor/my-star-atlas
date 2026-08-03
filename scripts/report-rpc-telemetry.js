#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createSnapshotMarker, generateTelemetryReport } = require('../electron/telemetry-reporter');

function value(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
async function main() {
  const command = process.argv[2];
  const userDataPath = path.resolve(value('--user-data') || '');
  if (!value('--user-data')) throw new Error('--user-data is required');
  let result;
  if (command === 'snapshot') result = await createSnapshotMarker({ userDataPath, boundary: value('--boundary') || undefined });
  else if (command === 'report') {
    const startMarker = value('--start'); const endMarker = value('--end');
    if (!startMarker || !endMarker) throw new Error('--start and --end are required');
    result = await generateTelemetryReport({ userDataPath, startMarker, endMarker });
  } else throw new Error('usage: report-rpc-telemetry.js snapshot|report --user-data PATH [--boundary ISO | --start ID --end ID]');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error?.message || 'telemetry_report_failed'}\n`); process.exitCode = 1; });
