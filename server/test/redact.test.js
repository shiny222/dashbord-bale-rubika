import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedactor } from '../src/security/redact.js';

const redact = createRedactor(['supersecretenvvalue123', 'api_hash_abc_xyz_123456']);

test('redacts telegram bot tokens', () => {
  const line = 'user 123456789:AAHwLkXyZq9fJ5tG3vB8nC2mD4eF6gH8jK0lM1nOp token used';
  assert.ok(redact(line).includes('[REDACTED_TOKEN]'));
  assert.ok(!redact(line).includes('123456789:AAHwLkXy'));
});

test('redacts authorization headers', () => {
  const line = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret.payload';
  const out = redact(line);
  assert.ok(out.includes('[REDACTED]'));
  assert.ok(!out.includes('Bearer eyJ'));
});

test('redacts query-string secrets', () => {
  const line = 'GET /file?api_key=abcd1234&size=1';
  const out = redact(line);
  assert.ok(out.includes('api_key=[REDACTED]'));
  assert.ok(!out.includes('abcd1234'));
});

test('redacts configured secret values anywhere in the text', () => {
  const out = redact('connection with supersecretenvvalue123 in config');
  assert.ok(!out.includes('supersecretenvvalue123'));
  assert.ok(out.includes('[REDACTED]'));
});

test('leaves normal log lines intact', () => {
  const line = '2026-07-31T21:34:01+0000 host python[1]: INFO: bot started';
  assert.equal(redact(line), line);
});
