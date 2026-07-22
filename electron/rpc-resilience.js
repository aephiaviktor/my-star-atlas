const RATE_LIMIT_RPC_CODES = new Set([-32005, -32016]);
const MAX_BACKOFF_MS = 30_000;

function parseRetryAfterMs(value, now = Date.now) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(text);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - now()) : null;
}

function extractRetryAfterMs(response, payload) {
  const header = response?.headers?.get?.('retry-after');
  const headerMs = parseRetryAfterMs(header);
  if (headerMs != null) return headerMs;
  return parseRetryAfterMs(payload?.error?.data?.retry_after ?? payload?.error?.data?.retryAfter);
}

function isRetriableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

function isRetriableJsonRpcError(payload) {
  if (!payload?.error) return false;
  if (RATE_LIMIT_RPC_CODES.has(payload.error.code)) return true;
  const message = String(payload.error.message || '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many requests');
}

function isRetriableNetworkError(error) {
  if (!error || error.name === 'AbortError') return false;
  return error instanceof TypeError || ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code);
}

function createRpcFetcher({
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
  maxAttempts = 5,
  logger = console,
} = {}) {
  const backoffMs = (attempt, retryAfterMs) => {
    if (retryAfterMs != null) {
      return Math.min(MAX_BACKOFF_MS, Math.round(retryAfterMs * (1.1 + random() * 0.1)));
    }
    return Math.round(random() * Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt));
  };

  return async function fetchWithRpcBackoff(url, init, { logLabel = 'rpc' } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, init);
      } catch (error) {
        if (!isRetriableNetworkError(error) || attempt + 1 >= maxAttempts) throw error;
        lastError = error;
        const wait = backoffMs(attempt, null);
        logger.warn(`[rpc] ${logLabel} network failure on attempt ${attempt + 1}/${maxAttempts}; backing off ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (response.ok) return response;
      const status = response.status;
      let payload = null;
      if (isRetriableStatus(status)) {
        try { payload = await response.clone().json(); } catch (_) { /* non-JSON response */ }
      }
      if (!isRetriableStatus(status) && !isRetriableJsonRpcError(payload)) {
        throw new Error(`RPC HTTP ${status} (${logLabel})`);
      }
      const retryAfter = extractRetryAfterMs(response, payload);
      lastError = new Error(`RPC_RATE_LIMIT: HTTP ${status} (${logLabel})${retryAfter != null ? ` retry_after=${retryAfter}ms` : ''}`);
      if (attempt + 1 >= maxAttempts) break;
      const wait = backoffMs(attempt, retryAfter);
      logger.warn(`[rpc] ${logLabel} attempt ${attempt + 1}/${maxAttempts} -> ${status}; backing off ${wait}ms`);
      await sleep(wait);
    }
    throw lastError || new Error(`RPC failed after ${maxAttempts} attempts (${logLabel})`);
  };
}

function createRpcRateGate({
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let nextStartAt = 0;
  let queue = Promise.resolve();
  return {
    acquire(settings) {
      if (!settings?.useRpcLimiter) return Promise.resolve();
      const operation = queue.then(async () => {
        const configured = Number(settings.rpcRequestsPerSecond);
        const requestsPerSecond = Number.isFinite(configured) && configured > 0 ? configured : 5;
        const wait = Math.max(0, nextStartAt - now());
        if (wait > 0) await sleep(wait);
        nextStartAt = now() + 1000 / requestsPerSecond;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}

module.exports = { createRpcFetcher, createRpcRateGate };
