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
import { createTelegramApiService } from './services/telegramApi.js';
import { createRedactor } from './security/redact.js';
import { createSessionMiddleware, requireAuth } from './middleware/auth.js';
import { applySecurity, apiLimiter, checkSameOrigin } from './middleware/security.js';
import { notFound, createErrorHandler } from './middleware/errors.js';
import { createAuthRouter } from './routes/auth.js';
import { createServicesRouter } from './routes/services.js';
import { createTelegramApiRouter } from './routes/telegramApi.js';

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
  const systemd =
    deps.systemd ||
    createSystemdService({
      executor,
      redact,
      useSudo: config.security.useSudo,
      commandTimeoutMs: config.security.commandTimeoutMs,
      logLineOptions: config.log.linesOptions,
      maxLogLines: config.log.maxLogLines,
    });
  const telegramApi =
    deps.telegramApi ||
    createTelegramApiService({
      systemd,
      serviceName: config.telegramApi.serviceName,
      url: config.telegramApi.url,
      timeoutMs: config.telegramApi.healthTimeoutMs,
    });

  const app = express();
  applySecurity(app, config);
  app.use(apiLimiter);
  app.use(createSessionMiddleware(config));
  app.use(checkSameOrigin);

  // REST API
  const api = express.Router();
  api.get('/health', (req, res) => {
    res.json({ success: true, data: { ok: true, uptime: Math.floor(process.uptime()) } });
  });
  api.use('/auth', createAuthRouter(config));
  api.use('/services', requireAuth, createServicesRouter({ config, systemd, redact }));
  api.use('/telegram-api', requireAuth, createTelegramApiRouter({ config, telegramApi, systemd }));
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
    app.listen(config.port, config.host, () => {
      logger.info('dashboard started', { host: config.host, port: config.port, bots: config.bots.length });
    });
  } catch (err) {
    logger.error('startup failed', { error: err.message });
    process.exit(1);
  }
}
