// Service routes. Only service names present in the configuration
// allowlist can be queried or controlled — an arbitrary systemd unit
// name from the browser is never accepted.
//
// Status checks run CONCURRENTLY (Promise.allSettled): one failing
// service never breaks the whole dashboard. Control actions are guarded
// by per-service operation locks so a service cannot be restarted twice
// at once; different services remain controllable in parallel.

import { Router } from 'express';
import { CommandError } from '../services/executor.js';
import { ServiceBusyError } from '../errors/application-errors.js';
import { controlLimiter } from '../middleware/security.js';
import { asyncHandler } from '../middleware/errors.js';
import { logger } from '../logger.js';
import { getRequestId } from '../context/request-context.js';

// Per-service in-flight control lock: Map<serviceName, Promise>.
// Never a global lock — Bot 2 stays controllable while Bot 1 is busy.
const operationLocks = new Map();

// Runs `fn` under a per-service lock. Returns a promise for the running
// operation. Throws ServiceBusyError (HTTP 409) if already in flight.
function withServiceLock(serviceName, fn) {
  if (operationLocks.has(serviceName)) {
    throw new ServiceBusyError(`Service "${serviceName}" already has a control operation in progress.`);
  }
  const op = Promise.resolve()
    .then(fn)
    .finally(() => {
      operationLocks.delete(serviceName);
    });
  operationLocks.set(serviceName, op);
  return op;
}

export function createServicesRouter({ config, systemd, redact = (s) => s, metrics }) {
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

  function statusErrorBody(bot, err) {
    return decorate(bot, {
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
    });
  }

  // GET /api/services — status of every configured bot, checked
  // CONCURRENTLY. Each service gets its own result even when others fail.
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const started = Date.now();
      const settled = await Promise.allSettled(
        config.bots.map(async (bot) => {
          const status = await systemd.getServiceStatus(bot.serviceName);
          return decorate(bot, status);
        }),
      );
      const results = settled.map((outcome, i) => {
        const bot = config.bots[i];
        if (outcome.status === 'fulfilled') return outcome.value;
        return statusErrorBody(bot, outcome.reason);
      });
      logger.info('services list completed', {
        count: results.length,
        durationMs: Date.now() - started,
        requestId: getRequestId(),
      });
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
      // Per-service lock: 409 if an operation is already in flight.
      const result = await withServiceLock(entry.serviceName, () =>
        systemd.controlService(entry.serviceName, req.params.action),
      );
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
