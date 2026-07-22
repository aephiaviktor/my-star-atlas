const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 250;

function isTransientStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function delay(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithInfluxRetry(fetchAttempt, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 1;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : DEFAULT_RETRY_DELAY_MS;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`influx_timeout_${timeoutMs}ms`)), timeoutMs);
    try {
      const response = await fetchAttempt({ signal: controller.signal, attempt });
      if (response.ok || !isTransientStatus(Number(response.status)) || attempt === retries) return response;
      lastError = new Error(`influx_transient_${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
    } finally {
      clearTimeout(timer);
    }
    await delay(retryDelayMs * (attempt + 1));
  }

  throw lastError || new Error('influx_request_failed');
}

async function timedSource(name, task) {
  const startedAt = Date.now();
  try {
    return { name, ok: true, value: await task(), durationMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return {
      name,
      ok: false,
      value: null,
      durationMs: Date.now() - startedAt,
      error: String(error?.message || error || `${name}_failed`),
    };
  }
}

async function loadSduSources({ production, consumption }) {
  const [productionResult, consumptionResult] = await Promise.all([
    timedSource('production', production),
    timedSource('consumption', consumption),
  ]);
  return { production: productionResult, consumption: consumptionResult };
}

module.exports = {
  fetchWithInfluxRetry,
  isTransientStatus,
  loadSduSources,
};
