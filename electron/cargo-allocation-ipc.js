'use strict';

const CARGO_ALLOCATION_CHANNEL = 'earnings:cargo-allocation';

function registerCargoAllocationIpc(registerTrustedIpc, { runTelemetry, loadAllocation }) {
  if (typeof registerTrustedIpc !== 'function' || typeof runTelemetry !== 'function' || typeof loadAllocation !== 'function') {
    throw new TypeError('cargo_allocation_ipc_dependencies_required');
  }
  registerTrustedIpc(CARGO_ALLOCATION_CHANNEL, async (_event, payload) =>
    runTelemetry(payload, 'EA', async () => loadAllocation(payload), 'cargo'));
  return CARGO_ALLOCATION_CHANNEL;
}

module.exports = { CARGO_ALLOCATION_CHANNEL, registerCargoAllocationIpc };
