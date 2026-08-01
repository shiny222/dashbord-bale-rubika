// Shared error-handling middleware and async wrapper.

import { logger } from '../logger.js';

// Wraps async route handlers so rejected promises reach the error
// handler instead of hanging the request.
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFound(req, res) {
  res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Resource not found.' });
}

// Central error handler. Never leaks stack traces or raw command output
// to the browser. Safe (crafted) messages from CommandError pass through
// after redaction; everything else is replaced with a generic message
// in production.
export function createErrorHandler(redact = (s) => s) {
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    const status = err.statusCode || (err.code && err.code.startsWith('INVALID') ? 400 : 500);
    logger.error('request failed', {
      method: req.method,
      path: req.originalUrl || req.path,
      error: err.message || String(err),
      code: err.code || null,
    });

    let message = 'Internal server error.';
    if (err.safe && err.message) {
      message = redact(err.message);
    } else if (status < 500 && err.message) {
      message = redact(err.message);
    }
    res.status(status).json({
      success: false,
      error: err.code || 'INTERNAL_ERROR',
      message,
    });
  };
}
