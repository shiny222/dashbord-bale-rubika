import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRequestId,
  createRequestContext,
  runWithRequestContext,
  getRequestContext,
  getRequestId,
} from '../src/context/request-context.js';

test('normalizeRequestId generates a UUID for missing/blank input', () => {
  const id = normalizeRequestId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test('normalizeRequestId accepts a safe inbound id', () => {
  assert.equal(normalizeRequestId('abc-123_DEF.456'), 'abc-123_DEF.456');
});

test('normalizeRequestId rejects scriptable or malformed input', () => {
  const a = normalizeRequestId('; rm -rf /');
  const b = normalizeRequestId('x');
  assert.notEqual(a, '; rm -rf /');
  assert.notEqual(b, 'x');
});

test('request id is visible inside an awaited async operation', async () => {
  const ctx = createRequestContext({ requestId: 'req-123' });
  await runWithRequestContext(ctx, async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(getRequestId(), 'req-123');
    assert.equal(getRequestContext().requestId, 'req-123');
  });
});

test('context does not leak outside its async scope', async () => {
  const ctx = createRequestContext({ requestId: 'req-456' });
  let inside;
  await runWithRequestContext(ctx, async () => {
    inside = getRequestId();
  });
  assert.equal(inside, 'req-456');
  assert.equal(getRequestId(), null);
});
