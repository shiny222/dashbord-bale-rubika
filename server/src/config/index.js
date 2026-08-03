// Central configuration loader. All values come from environment
// variables; nothing sensitive is ever hard-coded in source.
function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseIntEnv(value, fallback, { min, max } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return fallback;
  if (max !== undefined && n > max) return fallback;
  return n;
}

// Parses a comma-separated list (e.g. ALLOWED_ORIGINS) into a clean array.
function parseListEnv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Loads and validates configuration from an environment object
// (defaults to process.env). Throws on invalid configuration.
export function loadConfig(envObj = process.env) {
  const controlBackend = (envObj.CONTROL_BACKEND || 'systemd').toLowerCase();
  let bots = [];

  if (controlBackend === 'docker') {
    bots = [
      { id: 'rubika', displayName: 'Rubika', serviceName: 'rubika' },
      { id: 'bale', displayName: 'Bale', serviceName: 'bale' },
    ];
  } else {
    // Support up to 10 managed bot services (BOT_1..BOT_10).
    for (let i = 1; i <= 10; i += 1) {
      const name = envObj[`BOT_${i}_NAME`];
      const service = envObj[`BOT_${i}_SERVICE`];
      if (name === undefined && service === undefined) continue;
      if (!name || !service) {
        throw new Error(`BOT_${i}_NAME and BOT_${i}_SERVICE must both be set`);
      }
      if (!/^[A-Za-z0-9_.@-]+$/.test(service)) {
        throw new Error(`BOT_${i}_SERVICE contains invalid characters: "${service}"`);
      }
      if (!service.endsWith('.service')) {
        throw new Error(`BOT_${i}_SERVICE must end with ".service" (got "${service}")`);
      }
      bots.push({ id: `bot${i}`, displayName: name, serviceName: service });
    }
    if (bots.length === 0) {
      throw new Error('At least one BOT_N_NAME / BOT_N_SERVICE pair is required in the environment');
    }
  }

  const telegramApiService = envObj.TELEGRAM_API_SERVICE || 'telegram-bot-api.service';
  if (!/^[A-Za-z0-9_.@-]+$/.test(telegramApiService) || !telegramApiService.endsWith('.service')) {
    throw new Error(`TELEGRAM_API_SERVICE is invalid: "${telegramApiService}"`);
  }

  const port = parseIntEnv(envObj.PORT, 3000, { min: 1, max: 65535 });

  return {
    port,
    host: envObj.HOST || '127.0.0.1',
    controlBackend,
    bots,
    telegramApi: {
      serviceName: telegramApiService,
      url: envObj.TELEGRAM_API_URL || 'http://127.0.0.1:8081',
      healthTimeoutMs: parseIntEnv(envObj.TELEGRAM_API_TIMEOUT_MS, 3000, { min: 200, max: 30000 }),
      controlEnabled: parseBoolean(envObj.TELEGRAM_API_CONTROL_ENABLED, true),
    },
    auth: {
      username: envObj.ADMIN_USERNAME || 'admin',
      passwordHash: envObj.ADMIN_PASSWORD_HASH || '',
      sessionSecret: envObj.SESSION_SECRET || '',
      sessionTtlMs: 8 * 60 * 60 * 1000, // 8 hours
    },
    security: {
      useSudo: parseBoolean(envObj.USE_SUDO, true),
      secureCookies: parseBoolean(envObj.SECURE_COOKIES, false),
      trustProxy: parseBoolean(envObj.TRUST_PROXY, false),
      allowedOrigins: parseListEnv(envObj.ALLOWED_ORIGINS),
      commandTimeoutMs: parseIntEnv(envObj.COMMAND_TIMEOUT_MS, 15000, { min: 1000, max: 120000 }),
    },
    docker: {
      helperPath: envObj.DOCKER_HELPER_PATH || '/usr/local/bin/docker-control-helper',
      composeFile: envObj.DOCKER_COMPOSE_FILE || '/home/etejah-bot/bot2/compose.yaml',
      project: envObj.DOCKER_COMPOSE_PROJECT || 'etejah-bots',
      workDir: envObj.DOCKER_WORK_DIR || '/home/etejah-bot/bot2',
    },
    log: {
      level: envObj.LOG_LEVEL || 'info',
      linesOptions: [50, 100, 250, 500],
      maxLogLines: 500,
    },
  };
}

// Returns a list of human-readable configuration problems that must
// be fixed before the server starts (fail-fast in production).
export function validateSecrets(config) {
  const problems = [];
  if (!config.auth.sessionSecret || config.auth.sessionSecret.length < 32) {
    problems.push('SESSION_SECRET must be set and at least 32 characters long');
  }
  if (!config.auth.passwordHash) {
    problems.push('ADMIN_PASSWORD_HASH must be set (generate with: node server/scripts/hash-password.js "<password>")');
  }
  return problems;
}
