// Security middleware: helmet, rate limiting, same-origin enforcement.

import helmet from 'helmet';
import express from 'express';
import rateLimit from 'express-rate-limit';

const JSON_LIMIT = '32kb';

export function applySecurity(app, config) {
  app.disable('x-powered-by');
  if (config.security.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null, // disabled: dev server runs over http
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(express.json({ limit: JSON_LIMIT }));
}

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
});

// Brute-force protection for the login endpoint.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true,
});

export const controlLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'RATE_LIMITED', message: 'Too many control requests. Please wait.' },
});

// Defense-in-depth CSRF protection. Combined with SameSite=Strict
// session cookies, a cross-origin browser cannot attach the session
// cookie AND will additionally be rejected here when it sends an Origin
// header that does not match the request host. Non-browser clients
// (tests, curl) send no Origin and pass through — they still need a
// valid session cookie.
//
// `allowedOrigins` lets extra origins through when the dashboard is
// reached via a proxy/hostname whose Host header differs from the
// browser Origin. Set it to `['*']` to disable the check entirely
// (not recommended for a panel that can control systemd services).
export function createOriginCheck({ allowedOrigins = [] } = {}) {
  const allowAll = allowedOrigins.includes('*');
  const normalized = allowedOrigins
    .filter((o) => o && o !== '*')
    .map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return o;
      }
    });

  return function checkSameOrigin(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    if (allowAll) return next();
    const host = req.headers.host;
    if (!host) return next();
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) return next();
      if (normalized.includes(originUrl.origin) || normalized.includes(origin)) return next();
    } catch {
      // malformed Origin — reject below
    }
    return res.status(403).json({
      success: false,
      error: 'ORIGIN_MISMATCH',
      message: 'Cross-origin request rejected.',
    });
  };
}
