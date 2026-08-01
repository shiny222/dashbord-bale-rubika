// Authentication: express-session setup, requireAuth guard and
// constant-time string comparison helpers.

import crypto from 'node:crypto';
import session from 'express-session';

export const SESSION_COOKIE_NAME = 'tbdash.sid';

export function createSessionMiddleware(config) {
  return session({
    name: SESSION_COOKIE_NAME,
    secret: config.auth.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.security.secureCookies,
      maxAge: config.auth.sessionTtlMs,
      path: '/',
    },
  });
}

// Constant-time comparison that also works for unequal-length inputs.
export function safeEqualStr(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) {
    const hA = crypto.createHash('sha256').update(bufA).digest();
    const hB = crypto.createHash('sha256').update(bufB).digest();
    return crypto.timingSafeEqual(hA, hB);
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Guards every protected route. Sessions are stored server-side, so a
// stolen cookie without a matching server session is useless.
export function requireAuth(req, res, next) {
  if (req.session && req.session.user && req.session.user.username) {
    return next();
  }
  return res.status(401).json({
    success: false,
    error: 'AUTH_REQUIRED',
    message: 'Authentication required. Please log in.',
  });
}

// Regenerates the session id on login to prevent session fixation.
export function regenerateSession(req, username) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.user = { username };
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}
