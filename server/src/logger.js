// Structured JSON logging to stdout/stderr.
const LEVELS = ['debug', 'info', 'warn', 'error'];
const configuredLevel = process.env.LOG_LEVEL || 'info';

function emit(level, message, extra) {
  if (LEVELS.indexOf(level) < LEVELS.indexOf(configuredLevel)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(extra || {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message, extra) => emit('debug', message, extra),
  info: (message, extra) => emit('info', message, extra),
  warn: (message, extra) => emit('warn', message, extra),
  error: (message, extra) => emit('error', message, extra),
};

export function setLogLevel(level) {
  if (LEVELS.includes(level)) process.env.LOG_LEVEL = level;
}
