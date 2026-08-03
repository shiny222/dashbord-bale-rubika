// Request timing middleware. Measures every API request with
// performance.now() and logs method, route template, status code,
// duration and request ID when the response finishes. Feeds the
// 'api-request' metric. Route templates (not raw URLs) are preferred so
// query strings — which may carry sensitive values — are never logged.

import { performance } from 'node:perf_hooks';
import { logger } from '../logger.js';
import { getRequestContext } from '../context/request-context.js';

function routeTemplate(req) {
  // express 4 exposes the matched route pattern on req.route after
  // routing; combine with the mount path for accurate templates.
  const base = req.baseUrl || '';
  const routePath = req.route && req.route.path ? req.route.path : req.path;
  return `${base}${routePath}`;
}

export function createRequestTimingMiddleware({ metrics } = {}) {
  return function requestTimingMiddleware(req, res, next) {
    const started = performance.now();
    res.on('finish', () => {
      const durationMs = performance.now() - started;
      const ctx = getRequestContext();
      const template = routeTemplate(req);
      logger.info('request completed', {
        method: req.method,
        path: template,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        requestId: (ctx && ctx.requestId) || req.get('x-request-id') || null,
      });
      if (metrics && typeof metrics.record === 'function') {
        metrics.record('api-request', durationMs, res.statusCode < 400);
      }
    });
    next();
  };
}
