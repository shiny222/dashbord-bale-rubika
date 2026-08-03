import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestApp,
  closeTestApp,
  login,
  apiFetch,
  createFakeExecutor,
  FIXTURE_SYSTEMCTL_SHOW,
} from './helpers.js';

test('diagnostics requires authentication', async () => {
  const { server, base } = await startTestApp({});
  try {
    const res = await apiFetch(base, '/diagnostics');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'AUTH_REQUIRED');
  } finally {
    await closeTestApp(server);
  }
});

test('diagnostics returns safe process data when authenticated', async () => {
  const { server, base } = await startTestApp({});
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/diagnostics', { cookie });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    const d = body.data;
    assert.ok(Number.isFinite(d.process.uptimeSeconds));
    assert.ok(d.process.nodeVersion);
    assert.ok(Number.isInteger(d.memory.rssBytes) && d.memory.rssBytes > 0);
    assert.ok(Number.isInteger(d.memory.heapUsedBytes));
    assert.ok(Number.isInteger(d.cpu.userMicroseconds));
    assert.ok(Number.isFinite(d.eventLoop.meanMs));
    assert.ok(Array.isArray(d.operationMetrics));
  } finally {
    await closeTestApp(server);
  }
});

test('GET /api/services checks all services concurrently (one failure does not break others)', async () => {
  // bot2's `systemctl show` fails -> its entry carries an error, bot1 is fine.
  const executor = async (cmd, args, options = {}) => {
    if (cmd === 'journalctl') return { stdout: '', stderr: '', code: 0, timedOut: false, error: null };
    if (args[0] === 'show' && args[1] === 'my-second-bot.service') {
      return { stdout: '', stderr: 'failed to connect to bus', code: 1, timedOut: false, error: null };
    }
    return createFakeExecutor().executor(cmd, args, options);
  };
  const { server, base } = await startTestApp({ deps: { executor } });
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/services', { cookie });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 2);
    const ids = body.data.map((s) => s.id);
    assert.ok(ids.includes('bot1'));
    assert.ok(ids.includes('bot2'));
    const bot1 = body.data.find((s) => s.id === 'bot1');
    const bot2 = body.data.find((s) => s.id === 'bot2');
    assert.equal(bot1.status, 'running');
    assert.equal(bot2.status, 'unknown');
    assert.ok(bot2.error);
  } finally {
    await closeTestApp(server);
  }
});

test('duplicate control request on the same service returns 409 SERVICE_BUSY', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const executor = async (cmd, args) => {
    if (args[0] === '-n' && args[2] === 'restart') {
      await gate; // hold the first restart in flight
      return { stdout: '', stderr: '', code: 0, timedOut: false, error: null };
    }
    if (args[0] === 'show') {
      return { stdout: FIXTURE_SYSTEMCTL_SHOW, stderr: '', code: 0, timedOut: false, error: null };
    }
    return { stdout: '', stderr: '', code: 0, timedOut: false, error: null };
  };
  const { server, base } = await startTestApp({ deps: { executor } });
  try {
    const { cookie } = await login(base);
    const first = apiFetch(base, '/services/my-first-bot.service/restart', { method: 'POST', cookie });
    await new Promise((r) => setTimeout(r, 50)); // let the lock register
    const second = await apiFetch(base, '/services/my-first-bot.service/restart', { method: 'POST', cookie });
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.equal(body.error, 'SERVICE_BUSY');
    release();
    const firstRes = await first;
    assert.equal(firstRes.status, 200);
    // Lock is cleared after the first op finishes -> third attempt works.
    const third = await apiFetch(base, '/services/my-first-bot.service/restart', { method: 'POST', cookie });
    assert.equal(third.status, 200);
  } finally {
    release && release();
    await closeTestApp(server);
  }
});

test('different services can be controlled concurrently', async () => {
  const inFlight = new Set();
  const executor = async (cmd, args) => {
    if (args[0] === '-n' && args[2] === 'restart') {
      inFlight.add(args[3]);
      await new Promise((r) => setTimeout(r, 80));
      inFlight.delete(args[3]);
      return { stdout: '', stderr: '', code: 0, timedOut: false, error: null };
    }
    return createFakeExecutor().executor(cmd, args);
  };
  const { server, base } = await startTestApp({ deps: { executor } });
  try {
    const { cookie } = await login(base);
    const a = apiFetch(base, '/services/my-first-bot.service/restart', { method: 'POST', cookie });
    const b = apiFetch(base, '/services/my-second-bot.service/restart', { method: 'POST', cookie });
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.status, 200);
    assert.equal(rb.status, 200);
  } finally {
    await closeTestApp(server);
  }
});

test('request ID is returned in X-Request-ID header and error bodies', async () => {
  const { server, base } = await startTestApp({});
  try {
    const res = await apiFetch(base, '/services', {}); // 401
    const headerId = res.headers.get('x-request-id');
    assert.ok(headerId);
    const body = await res.json();
    assert.equal(body.requestId, headerId);
  } finally {
    await closeTestApp(server);
  }
});
