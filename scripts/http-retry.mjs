const transientHttpStatuses = new Set([502, 503, 504]);

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isTransientHttpStatus(status) {
  return transientHttpStatuses.has(Number(status));
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchWithTransientRetry(url, init = {}, options = {}) {
  const attempts = positiveInteger(options.attempts, 3);
  const requestTimeoutMs = positiveInteger(options.requestTimeoutMs, 8000);
  const retryDelayMs = Number.isFinite(Number(options.retryDelayMs)) && Number(options.retryDelayMs) >= 0
    ? Number(options.retryDelayMs)
    : 750;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const waitImpl = options.waitImpl || wait;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`${url} timed out after ${requestTimeoutMs}ms`)),
      requestTimeoutMs
    );

    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (!isTransientHttpStatus(response.status) || attempt === attempts) return response;
      await response.body?.cancel?.();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    } finally {
      clearTimeout(timeout);
    }

    await waitImpl(retryDelayMs * attempt);
  }

  throw lastError || new Error(`${url} request failed`);
}

export { fetchWithTransientRetry, isTransientHttpStatus };
