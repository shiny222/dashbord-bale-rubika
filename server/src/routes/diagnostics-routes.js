// Diagnostics routes (administrator only). Returns safe process health
// data — no environment variables, no paths, no command arguments, no
// tokens, no stack traces, no unrestricted host information.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/security.js';
import { asyncHandler } from '../middleware/errors.js';

export function createDiagnosticsRouter({ diagnostics, metrics }) {
  const router = Router();

  // GET /api/diagnostics
  router.get(
    '/',
    requireAuth,
    apiLimiter,
    asyncHandler(async (req, res) => {
      const data = diagnostics.snapshot();
      if (metrics && typeof metrics.all === 'function') {
        data.operationMetrics = metrics.all();
      }
      res.json({ success: true, data });
    }),
  );

  return router;
}
