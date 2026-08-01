// Authentication routes: login (rate-limited, brute-force resistant),
// session introspection and logout.

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { loginLimiter } from '../middleware/security.js';
import { safeEqualStr, regenerateSession, SESSION_COOKIE_NAME } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';
import { logger } from '../logger.js';
import { redact } from '../security/redact.js';

// A precomputed hash used when the username is wrong, so password
// comparison still runs (equalizes timing).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-1234567890', 10);

export function createAuthRouter(config) {
  const router = Router();

  router.post(
    '/login',
    loginLimiter,
    asyncHandler(async (req, res) => {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string' || username === '' || password === '') {
        return res.status(400).json({
          success: false,
          error: 'INVALID_INPUT',
          message: 'Username and password are required.',
        });
      }

      const userMatch = safeEqualStr(username, config.auth.username);
      let passwordOk = false;
      if (config.auth.passwordHash) {
        passwordOk = await bcrypt.compare(password, userMatch ? config.auth.passwordHash : DUMMY_HASH);
      }

      if (!userMatch || !passwordOk) {
        logger.warn('login failed', { username: redact(username) });
        // Constant-ish delay to slow brute force.
        await new Promise((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 250)));
        return res.status(401).json({
          success: false,
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid username or password.',
        });
      }

      await regenerateSession(req, username);
      logger.info('login success', { username: redact(username) });
      return res.json({ success: true, data: { username, authenticated: true } });
    }),
  );

  router.get('/session', (req, res) => {
    const user = req.session && req.session.user ? req.session.user.username : null;
    res.json({ success: true, data: { authenticated: Boolean(user), username: user || null } });
  });

  router.post(
    '/logout',
    (req, res, next) => {
      req.session.destroy((err) => {
        if (err) return next(err);
        res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
        res.json({ success: true, data: { authenticated: false } });
      });
    },
  );

  return router;
}
