// Express application assembly.
// In production this server also serves the built React client from
// server/public (created by `npm run build` in client/).

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { loadConfig, validateSecrets } from './config/index.js';
import { logger } from './logger.js';
import { createExecutor } from './services/executor.js';
import { createSystemdService } from './services/systemd.js';
import { createDockerService } from './services/docker.js';
import { createTelegramApiService } from './services/telegramApi.js';
import { createRedactor } from './security/redact.js';
import { createSessionMiddleware, requireAuth } from './middleware/auth.js';
import { applySecurity, apiLimiter, createOriginCheck } from './middleware/security.js';
import { createRequestContextMiddleware } from './middleware/request-context.js';
import { createRequestTimingMiddleware } from './middleware/request-timing.js';
import { notFound, createErrorHandler } from './middleware/errors.js';
import { createMetricsCollector } from './diagnostics/metrics-collector.js';
import { createDiagnosticsService } from './diagnostics/diagnostics-service.js';
import { createAuthRouter } from './routes/auth.js';
import { createServicesRouter } from './routes/services.js';
import { createTelegramApiRouter } from './routes/telegramApi.js';
import { createDiagnosticsRouter } from './routes/diagnostics-routes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');

// Collects sensitive environment values so they can be redacted from
// any output that reaches the browser.
function collectSecrets(config) {
  const candidates = [
    config.auth.sessionSecret,
    config.auth.passwordHash,
    config.auth.username,
  ];
  for (const [key, value] of Object.entries(process.env)) {
    if (/token|secret|password|hash|api[_-]?id|api[_-]?hash|key|session/i.test(key)) {
      candidates.push(value);
    }
  }
  return candidates;
}

export function createApp(config, deps = {}) {
  const executor = deps.executor || createExecutor({ timeoutMs: config.security.commandTimeoutMs });
  const redact = deps.redact || createRedactor(collectSecrets(config));
  const metrics = deps.metrics || createMetricsCollector();
  const diagnostics = deps.diagnostics || createDiagnosticsService({ metrics, applicationVersion: process.env.npm_package_version || '1.0.0' });

  let backend;
  if (config.controlBackend === 'docker') {
    backend =
      deps.docker ||
      createDockerService({
        executor,
        redact,
        commandTimeoutMs: config.security.commandTimeoutMs,
        logLineOptions: config.log.linesOptions,
        maxLogLines: config.log.maxLogLines,
        metrics,
      });
  } else {
    backend =
      deps.systemd ||
      createSystemdService({
        executor,
        redact,
        useSudo: config.security.useSudo,
        commandTimeoutMs: config.security.commandTimeoutMs,
        logLineOptions: config.log.linesOptions,
        maxLogLines: config.log.maxLogLines,
        metrics,
      });
  }

  const telegramApi =
    deps.telegramApi ||
    createTelegramApiService({
      systemd: backend,
      serviceName: config.telegramApi.serviceName,
      url: config.telegramApi.url,
      timeoutMs: config.telegramApi.healthTimeoutMs,
      metrics,
    });

  const app = express();
  applySecurity(app, config);
  app.use(createRequestContextMiddleware());
  app.use(apiLimiter);
  app.use(createSessionMiddleware(config));
  app.use(createOriginCheck({ allowedOrigins: config.security.allowedOrigins }));
  app.use(createRequestTimingMiddleware({ metrics }));

  // REST API
  const api = express.Router();
  api.get('/health', (req, res) => {
    res.json({ success: true, data: { ok: true, uptime: Math.floor(process.uptime()) } });
  });
  api.use('/auth', createAuthRouter(config));
  api.use('/services', requireAuth, createServicesRouter({ config, systemd: backend, redact, metrics }));
  api.use('/telegram-api', requireAuth, createTelegramApiRouter({ config, telegramApi, systemd: backend }));
  api.use('/diagnostics', createDiagnosticsRouter({ diagnostics, metrics }));
  app.use('/api', api);

  // Built client (production). Falls back to index.html for SPA routes.
  if (fs.existsSync(PUBLIC_DIR)) {
    app.use(
      express.static(PUBLIC_DIR, {
        index: 'index.html',
        maxAge: '1h',
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });
  }

  app.use('/api', notFound);
  app.use(createErrorHandler(redact));

  return app;
}

// Start only when executed directly (not when imported by tests).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const config = loadConfig();
    const problems = validateSecrets(config);
    if (problems.length > 0) {
      throw new Error(problems.join(' | '));
    }
    const app = createApp(config);
    const server = app.listen(config.port, config.host, () => {
      logger.info('dashboard started', { host: config.host, port: config.port, bots: config.bots.length });
    });

    // Graceful shutdown: stop accepting requests, close the HTTP server,
    // disable the event-loop monitor, then force-exit after a safe
    // timeout so systemd never hangs on stop.
    let shuttingDown = false;
    const SHUTDOWN_FORCE_MS = 10000;
    function shutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('shutdown started', { signal });
      const force = setTimeout(() => {
        logger.warn('shutdown force-exit after timeout', { signal, timeoutMs: SHUTDOWN_FORCE_MS });
        process.exit(1);
      }, SHUTDOWN_FORCE_MS);
      force.unref();
      server.close(() => {
        clearTimeout(force);
        logger.info('shutdown complete', { signal });
        process.exit(0);
      });
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('startup failed', { error: err.message });
    process.exit(1);
  }
}
