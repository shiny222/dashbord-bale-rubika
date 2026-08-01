import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestApp,
  closeTestApp,
  login,
  apiFetch,
  createFakeExecutor,
  TEST_PASSWORD,
} from './helpers.js';

test('login with valid credentials returns a session cookie', async () => {
  const { server, base } = await startTestApp();
  try {
    const { res, cookie } = await login(base);
    assert.equal(res.status, 200);
    assert.ok(cookie.startsWith('tbdash.sid='));
  } finally {
    await closeTestApp(server);
  }
});

test('login with wrong password is rejected', async () => {
  const { server, base } = await startTestApp();
  try {
    const { res } = await login(base, { password: 'wrong-password' });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'INVALID_CREDENTIALS');
  } finally {
    await closeTestApp(server);
  }
});

test('login with wrong username is rejected (timing-safe)', async () => {
  const { server, base } = await startTestApp();
  try {
    const { res } = await login(base, { username: 'attacker', password: TEST_PASSWORD });
    assert.equal(res.status, 401);
  } finally {
    await closeTestApp(server);
  }
});

test('login with missing fields returns 400', async () => {
  const { server, base } = await startTestApp();
  try {
    const res = await apiFetch(base, '/auth/login', { method: 'POST', body: { username: 'admin' } });
    assert.equal(res.status, 400);
  } finally {
    await closeTestApp(server);
  }
});

test('session endpoint reflects authentication state', async () => {
  const { server, base } = await startTestApp();
  try {
    const anon = await apiFetch(base, '/auth/session');
    assert.deepEqual(await anon.json(), { success: true, data: { authenticated: false, username: null } });

    const { cookie } = await login(base);
    const authed = await apiFetch(base, '/auth/session', { cookie });
    assert.equal((await authed.json()).data.authenticated, true);
  } finally {
    await closeTestApp(server);
  }
});

test('protected routes require authentication', async () => {
  const { server, base } = await startTestApp({ deps: { executor: createFakeExecutor().executor } });
  try {
    const res = await apiFetch(base, '/services');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'AUTH_REQUIRED');
  } finally {
    await closeTestApp(server);
  }
});

test('logout invalidates the session', async () => {
  const { server, base } = await startTestApp();
  try {
    const { cookie } = await login(base);
    const logout = await apiFetch(base, '/auth/logout', { method: 'POST', cookie });
    assert.equal(logout.status, 200);
    const after = await apiFetch(base, '/auth/session', { cookie });
    assert.equal((await after.json()).data.authenticated, false);
  } finally {
    await closeTestApp(server);
  }
});
