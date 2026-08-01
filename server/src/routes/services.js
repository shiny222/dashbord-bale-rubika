// Service routes. Only service names present in the configuration
// allowlist can be queried or controlled — an arbitrary systemd unit
// name from the browser is never accepted.

import { Router } from 'express';
import { CommandError } from '../services/executor.js';
import { controlLimiter } from '../middleware/security.js';
import { asyncHandler } from '../middleware/errors.js';

export function createServicesRouter({ config, systemd, redact = (s) => s }) {
  const router = Router();

  const allowlist = new Map(config.bots.map((bot) => [bot.serviceName, bot]));

  function resolveService(serviceName) {
    const entry = allowlist.get(serviceName);
    if (!entry) {
      throw new CommandError('SERVICE_NOT_ALLOWED', `Service "${serviceName}" is not in the configured allowlist.`, 404);
    }
    return entry;
  }

  // Status from systemd carries id=serviceName; the configured bot id
  // and display name must win.
  function decorate(entry, status) {
    return { ...status, id: entry.id, displayName: entry.displayName };
  }

  // GET /api/services — status of every configured bot.
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const results = [];
      for (const bot of config.bots) {
        try {
          const status = await systemd.getServiceStatus(bot.serviceName);
          results.push(decorate(bot, status));
        } catch (err) {
          results.push(
            decorate(bot, {
              found: false,
              status: 'unknown',
              activeState: '',
              subState: '',
              mainPid: 0,
              uptimeSeconds: 0,
              memoryBytes: 0,
              cpuUsageNSec: 0,
              restartCount: 0,
              lastStartedAt: null,
              error: err.safe ? redact(err.message) : 'Status unavailable',
            }),
          );
        }
      }
      res.json({ success: true, data: results });
    }),
  );

  // GET /api/services/:serviceName — single service.
  router.get(
    '/:serviceName',
    asyncHandler(async (req, res) => {
      const entry = resolveService(req.params.serviceName);
      const status = await systemd.getServiceStatus(entry.serviceName);
      res.json({ success: true, data: decorate(entry, status) });
    }),
  );

  // POST /api/services/:serviceName/start|stop|restart
  router.post(
    '/:serviceName/:action(start|stop|restart)',
    controlLimiter,
    asyncHandler(async (req, res) => {
      const entry = resolveService(req.params.serviceName);
      const result = await systemd.controlService(entry.serviceName, req.params.action);
      let status = null;
      try {
        status = decorate(entry, await systemd.getServiceStatus(entry.serviceName));
      } catch {
        status = null;
      }
      res.json({ success: true, data: { ...result, status } });
    }),
  );

  // GET /api/services/:serviceName/logs?lines=100&search=error
  router.get(
    '/:serviceName/logs',
    asyncHandler(async (req, res) => {
      const entry = resolveService(req.params.serviceName);
      const lines = systemd.parseLinesParam(req.query.lines);
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 200) : '';
      const logs = await systemd.getServiceLogs(entry.serviceName, { lines, search });
      res.json({ success: true, data: { ...logs, serviceName: entry.serviceName } });
    }),
  );

  return router;
}
