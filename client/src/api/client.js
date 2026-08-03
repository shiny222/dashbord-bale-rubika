// Thin fetch wrapper for the dashboard API. Always sends credentials
// (session cookie), parses the { success, data | error } envelope and
// normalizes failures into ApiError. Every request gets a default
// timeout via AbortController, and caller signals are merged so
// components can cancel requests on unmount.

export class ApiError extends Error {
  constructor(code, message, status = 0, requestId = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

// Merges an external AbortSignal with an internal timeout into a single
// signal. Returns { signal, cleanup }.
function withTimeout(signal, timeoutMs) {
  if (!signal && !timeoutMs) return { signal: undefined, cleanup: () => {} };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort);
  }
  const timer = timeoutMs
    ? setTimeout(() => controller.abort(new ApiError('TIMEOUT', `Request timed out after ${timeoutMs} ms.`, 0)), timeoutMs)
    : null;
  return {
    signal: controller.signal,
    cleanup: () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
    },
  };
}

export async function api(path, { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { signal: mergedSignal, cleanup } = withTimeout(signal, timeoutMs);
  const options = { method, headers: {}, credentials: 'same-origin', signal: mergedSignal };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'TIMEOUT')) {
      throw new ApiError('TIMEOUT', 'The request timed out. Please try again.', 0);
    }
    throw new ApiError('NETWORK', 'Cannot reach the dashboard server.');
  } finally {
    cleanup();
  }
  const requestId = res.headers.get('x-request-id') || null;
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.status === 401 && payload && payload.error === 'AUTH_REQUIRED') {
    throw new ApiError('AUTH_REQUIRED', 'Session expired. Please log in again.', res.status, requestId);
  }
  if (!res.ok || !payload || payload.success !== true) {
    throw new ApiError(
      (payload && payload.error) || 'ERROR',
      (payload && payload.message) || `Request failed (${res.status}).`,
      res.status,
      requestId,
    );
  }
  return payload.data;
}
