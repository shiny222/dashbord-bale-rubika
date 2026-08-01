import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestApp,
  closeTestApp,
  login,
  apiFetch,
  createFakeExecutor,
  FIXTURE_JOURNAL,
} from './helpers.js';

function fakeOk() {
  return createFakeExecutor().executor;
}

test('GET /api/services lists all configured bots with parsed status', async () => {
  const { server, base } = await startTestApp({ deps: { executor: fakeOk() } });
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/services', { cookie });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 2);
    const first = body.data[0];
    assert.equal(first.id, 'bot1');
    assert.equal(first.displayName, 'Bot One');
    assert.equal(first.serviceName, 'my-first-bot.service');
    assert.equal(first.status, 'running');
    assert.equal(first.mainPid, 1234);
    assert.equal(first.restartCount, 2);
    assert.equal(first.memoryBytes, 73400320);
  } finally {
    await closeTestApp(server);
  }
});

test('unknown service names are rejected (allowlist)', async () => {
  const { server, base } = await startTestApp({ deps: { executor: fakeOk() } });
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/services/ssh.service', { cookie });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'SERVICE_NOT_ALLOWED');
  } finally {
    await closeTestApp(server);
  }
});

test('start action calls sudo -n systemctl start and returns status', async () => {
  const fake = createFakeExecutor();
  const { server, base } = await startTestApp({ deps: { executor: fake.executor } });
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/services/my-first-bot.service/start', { method: 'POST', cookie });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.action, 'start');
    assert.ok(fake.calls.some((c) => c.cmd === 'sudo' && c.args[0] === '-n' && c.args[1] === 'systemctl' && c.args[2] === 'start' && c.args[3] === 'my-first-bot.service'));
    assert.equal(body.data.status.status, 'running');
  } finally {
    await closeTestApp(server);
  }
});

test('control of an unlisted service returns 404', async () => {
  const { server, base } = await startTestApp({ deps: { executor: fakeOk() } });
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/services/nginx.service/stop', { method: 'POST', cookie });
    assert.equal(res.status, 404);
  } finally {
    await closeTestApp(server);
  }
});

test('control command failure returns a friendly error', async () => {
  const executor = async (cmd, args) => {
    if (args[1] === 'systemctl' && (args[2] === 'stop' || args[2] === 'restart' || args[2] === 'start')) {
      return { stdout: '', stderr: 'Job for my-first-bot.service failed', code: 1, timedOut: false, error: null };
    }
    return createFakeExecutor().executor(cmd, args);
  };
  const { server, base } = await startTestApp({ deps: { executor } });
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/services/my-first-bot.service/stop', { method: 'POST', cookie });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.length > 0);
  } finally {
    await closeTestApp(server);
  }
});

test('control timeout returns 504', async () => {
  const executor = async (cmd, args) => {
    if (args[0] === '-n') {
      return { stdout: '', stderr: '', code: -1, timedOut: true, error: { killed: true } };
    }
    return createFakeExecutor().executor(cmd, args);
  };
  const { server, base } = await startTestApp({ deps: { executor } });
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/services/my-first-bot.service/restart', { method: 'POST', cookie });
    assert.equal(res.status, 504);
  } finally {
    await closeTestApp(server);
  }
});

test('GET logs returns parsed, redacted lines with limits validated', async () => {
  const { server, base } = await startTestApp({ deps: { executor: fakeOk() } });
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/services/my-first-bot.service/logs?lines=100', { cookie });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.lines.length, 3);
    assert.equal(body.data.serviceName, 'my-first-bot.service');

    const bad = await apiFetch(base, '/services/my-first-bot.service/logs?lines=999', { cookie });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'INVALID_LINES');

    const badText = await apiFetch(base, '/services/my-first-bot.service/logs?lines=abc', { cookie });
    assert.equal(badText.status, 400);
  } finally {
    await closeTestApp(server);
  }
});

test('logs redact tokens and support search', async () => {
  const journal = [
    '2026-07-31T21:35:00+0000 host python[9]: token 123456789:AAHwLkXyZq9fJ5tG3vB8nC2mD4eF6gH8jK0lM1nOp leaked',
    '2026-07-31T21:35:01+0000 host python[9]: WARNING: slow upload',
    '2026-07-31T21:35:02+0000 host python[9]: INFO: heartbeat ok',
  ].join('\n');
  const { executor } = createFakeExecutor({ journal });
  const { server, base } = await startTestApp({ deps: { executor } });
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/services/my-first-bot.service/logs?lines=100', { cookie });
    const body = await res.json();
    const first = body.data.lines[0];
    assert.ok(!first.raw.includes('123456789:AAHwLkXy'));
    assert.ok(first.raw.includes('[REDACTED_TOKEN]'));

    const search = await apiFetch(base, '/services/my-first-bot.service/logs?lines=100&search=heartbeat', { cookie });
    const searchBody = await search.json();
    assert.equal(searchBody.data.lines.length, 1);
  } finally {
    await closeTestApp(server);
  }
});

test('cross-origin state-changing request is rejected', async () => {
  const { server, base } = await startTestApp({ deps: { executor: fakeOk() } });
  try {
    const { cookie } = await login(base);
    const res = await apiFetch(base, '/services/my-first-bot.service/start', {
      method: 'POST',
      cookie,
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'ORIGIN_MISMATCH');
  } finally {
    await closeTestApp(server);
  }
});

test('same-origin request passes the origin check', async () => {
  const { server, base } = await startTestApp({ deps: { executor: fakeOk() } });
  try {
    const { cookie } = await login(base);
    const host = base.replace('http://', '');
    const res = await apiFetch(base, '/services/my-first-bot.service/start', {
      method: 'POST',
      cookie,
      headers: { Origin: `http://${host}` },
    });
    assert.equal(res.status, 200);
  } finally {
    await closeTestApp(server);
  }
});
