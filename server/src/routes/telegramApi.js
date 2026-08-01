// Telegram Local Bot API routes: health check and (optionally)
// start/stop/restart of its systemd service.

import { Router } from 'express';
import { controlLimiter } from '../middleware/security.js';
import { asyncHandler } from '../middleware/errors.js';

export function createTelegramApiRouter({ config, telegramApi, systemd }) {
  const router = Router();

  router.get(
    '/health',
    asyncHandler(async (req, res) => {
      const health = await telegramApi.check();
      res.json({
        success: true,
        data: { ...health, controlEnabled: config.telegramApi.controlEnabled },
      });
    }),
  );

  if (config.telegramApi.controlEnabled) {
    router.post(
      '/control/:action(start|stop|restart)',
      controlLimiter,
      asyncHandler(async (req, res) => {
        const { action } = req.params;
        const result = await systemd.controlService(config.telegramApi.serviceName, action);
        let health = null;
        try {
          health = await telegramApi.check();
        } catch {
          health = null;
        }
        res.json({ success: true, data: { ...result, health } });
      }),
    );
  }

  return router;
}
