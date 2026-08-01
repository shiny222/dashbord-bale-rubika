// Redaction of likely secrets from any text that may be shown to the
// browser (log lines, error messages). Applied defensively everywhere
// user-facing output is produced.

const TELEGRAM_TOKEN_RE = /\b\d{6,12}:[A-Za-z0-9_-]{30,45}\b/g;
// Header-style credentials only ("Key: value"). Query-string keys
// ("?api_key=...") are handled separately by QUERY_SECRET_RE and must
// not be double-matched here.
const CREDENTIAL_HEADER_RE = /(authorization|proxy-authorization|x-api-key|api[_-]?key|api[_-]?secret)\s*:\s*[^\s,;]+/gi;
const QUERY_SECRET_RE = /([?&](?:api[_-]?key|token|secret|password|passwd|hash|auth|session|access[_-]?token))=[^&\s]+/gi;

function redactHeader(match) {
  const colon = match.indexOf(':');
  const eq = match.indexOf('=');
  const sepIdx = colon !== -1 && (eq === -1 || colon < eq) ? colon : eq;
  return `${match.slice(0, sepIdx + 1)} [REDACTED]`;
}

// Builds a redaction function aware of configured secrets
// (env values such as api_id / api_hash / SESSION_SECRET / tokens).
export function createRedactor(secretValues = []) {
  const secrets = [...new Set(
    secretValues
      .filter((v) => typeof v === 'string' && v.length >= 8)
      .map((v) => v.trim()),
  )].sort((a, b) => b.length - a.length); // longest first so nested values match fully

  return function redact(input) {
    if (typeof input !== 'string' || input === '') return input;
    let out = input
      .replace(TELEGRAM_TOKEN_RE, '[REDACTED_TOKEN]')
      .replace(CREDENTIAL_HEADER_RE, redactHeader)
      .replace(QUERY_SECRET_RE, '$1=[REDACTED]');
    for (const secret of secrets) {
      if (out.includes(secret)) out = out.split(secret).join('[REDACTED]');
    }
    return out;
  };
}

// Default pattern-based redactor when no secrets are provided.
export const redact = createRedactor([]);
