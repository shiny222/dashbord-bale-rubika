// Express middleware: initializes the AsyncLocalStorage request context
// for every request, echoes a safe X-Request-ID response header, and
// makes sure the context is torn down cleanly afterwards.

import {
  createRequestContext,
  runWithRequestContext,
} from '../context/request-context.js';

export function createRequestContextMiddleware() {
  return function requestContextMiddleware(req, res, next) {
    const context = createRequestContext({
      requestId: req.get('x-request-id') || undefined,
      startedAt: Date.now(),
      method: req.method,
      // Route template only becomes available after routing; store the
      // raw path here and let request-timing middleware refine it.
      path: req.path,
    });
    res.setHeader('X-Request-ID', context.requestId);

    runWithRequestContext(context, () => next());
  };
}
