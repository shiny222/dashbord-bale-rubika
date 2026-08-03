// Structured JSON logging to stdout/stderr.
// Every entry automatically carries the current request ID (when inside a
// request) and passes sensitive field values through a redactor so that
// tokens, hashes and secrets never reach the journal.

import { getRequestId } from './context/request-context.js';
import { redact } from './security/redact.js';

const LEVELS = ['debug', 'info', 'warn', 'error'];
const configuredLevel = process.env.LOG_LEVEL || 'info';

// Field names whose values are always redacted, regardless of content.
const SENSITIVE_KEYS = /(password|passwd|secret|token|api[_-]?id|api[_-]?hash|authorization|cookie|session)/i;

function emit(level, message, extra) {
  if (LEVELS.indexOf(level) < LEVELS.indexOf(configuredLevel)) return;
  const requestId = getRequestId();
  const safe = {};
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue;
      // Never log raw values of obviously sensitive fields.
      safe[key] = SENSITIVE_KEYS.test(key) ? redact(String(value)) : value;
    }
  }
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(requestId ? { requestId } : {}),
    ...safe,
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
