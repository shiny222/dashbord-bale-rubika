// Per-request context stored in AsyncLocalStorage so that request ID,
// start time and route template remain available inside route handlers,
// awaited promises, service functions, logger calls and error handlers —
// without threading them through every function signature.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export const requestContextStorage = new AsyncLocalStorage();

// Accept an inbound X-Request-ID only if it is a plausible, non-scriptable
// identifier (alphanumeric + ._- separator, 4-128 chars). Anything else is
// ignored and a fresh UUID is generated instead — never trust client input
// blindly. The ID is only used for tracing/logging, never in commands.
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9._-]{4,128}$/;

export function normalizeRequestId(incoming) {
  if (typeof incoming === 'string' && SAFE_REQUEST_ID_RE.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}

export function createRequestContext({ requestId, startedAt, method, path }) {
  return {
    requestId: normalizeRequestId(requestId),
    startedAt: startedAt || Date.now(),
    method: method || null,
    path: path || null,
  };
}

// Runs `fn` inside a fresh request context. Returns fn's value (or the
// rejection). The store is automatically restored when fn completes.
export function runWithRequestContext(context, fn) {
  return requestContextStorage.run(context, fn);
}

// Returns the current request context, or null outside a request.
export function getRequestContext() {
  return requestContextStorage.getStore() || null;
}

export function getRequestId() {
  const ctx = getRequestContext();
  return ctx ? ctx.requestId : null;
}

export function getRequestStartedAt() {
  const ctx = getRequestContext();
  return ctx ? ctx.startedAt : null;
}
