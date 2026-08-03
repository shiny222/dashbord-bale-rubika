// Reusable operation timing helper. Wraps an async operation, records its
// wall-clock duration, logs success/failure with the current request
// context, and feeds the metrics collector. Rethrows the original error
// so callers keep their own error-handling contract.

import { performance } from 'node:perf_hooks';
import { logger } from '../logger.js';

// `operation` — stable metric/log name, e.g. 'service-status'.
// `meta`      — extra context (serviceId, action, ...). Sensitive fields
//               are redacted by the logger automatically.
// `fn`        — async function to measure.
// `metrics`   — optional metrics collector; `record(operation, ms, ok)`.
export async function measureOperation(operation, meta, fn, { metrics } = {}) {
  const started = performance.now();
  let success = false;
  try {
    const result = await fn();
    success = true;
    return result;
  } catch (err) {
    logger.warn('operation failed', {
      operation,
      ...meta,
      error: err.code || err.name || 'Error',
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    });
    throw err;
  } finally {
    const durationMs = performance.now() - started;
    logger.info('operation completed', {
      operation,
      ...meta,
      success,
      durationMs: Math.round(durationMs * 100) / 100,
    });
    if (metrics && typeof metrics.record === 'function') {
      metrics.record(operation, durationMs, success);
    }
  }
}
