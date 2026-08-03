// Shared helpers for integration tests. Real systemd commands are never
// executed — the executor and fetch are always injected/mocked.

import http from 'node:http';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';

export const TEST_PASSWORD = 'correct-horse-battery-staple';
export const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);

export const TEST_ENV = {
  BOT_1_NAME: 'Bot One',
  BOT_1_SERVICE: 'my-first-bot.service',
  BOT_2_NAME: 'Bot Two',
  BOT_2_SERVICE: 'my-second-bot.service',
  TELEGRAM_API_SERVICE: 'telegram-bot-api.service',
  TELEGRAM_API_URL: 'http://127.0.0.1:8081',
  PORT: '0',
  SESSION_SECRET: 'x'.repeat(48),
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD_HASH: TEST_PASSWORD_HASH,
  USE_SUDO: 'true',
  SECURE_COOKIES: 'false',
  TRUST_PROXY: 'false',
  ALLOWED_ORIGINS: '',
};

export const FIXTURE_SYSTEMCTL_SHOW = [
  'Id=my-first-bot.service',
  'Description=My Bot Service',
  'LoadState=loaded',
  'ActiveState=active',
  'SubState=running',
  'MainPID=1234',
  'ExecMainStatus=0',
  'ExecMainCode=0',
  'ExecMainStartTimestamp=Fri 2026-07-31 21:33:37 UTC',
  'ActiveEnterTimestamp=Fri 2026-07-31 21:33:37 UTC',
  'NRestarts=2',
  'MemoryCurrent=73400320',
  'CPUUsageNSec=123456789',
  'Result=success',
].join('\n');

export const FIXTURE_JOURNAL = [
  '2026-07-31T21:33:37+0000 host systemd[1]: Started My Bot Service.',
  '2026-07-31T21:33:40+0000 host python[1234]: INFO: bot is running',
  '2026-07-31T21:34:01+0000 host python[1234]: ERROR: upload failed with status=413',
].join('\n');

// A fake executor that answers systemctl/journalctl from canned data.
export function createFakeExecutor({ show = FIXTURE_SYSTEMCTL_SHOW, journal = FIXTURE_JOURNAL } = {}) {
  const calls = [];
  return {
    calls,
    executor: async (cmd, args, options = {}) => {
      calls.push({ cmd, args });
      if (cmd === 'journalctl') {
        return { stdout: journal, stderr: '', code: 0, timedOut: false, error: null };
      }
      if (args[0] === 'show') {
        return { stdout: show, stderr: '', code: 0, timedOut: false, error: null };
      }
      // control actions succeed
      return { stdout: '', stderr: '', code: 0, timedOut: false, error: null };
    },
  };
}

// Starts the app on an ephemeral port with the given deps.
export async function startTestApp(overrides = {}) {
  const config = loadConfig({ ...TEST_ENV, ...(overrides.env || {}) });
  const app = createApp(config, overrides.deps || {});
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return { server, base, config };
}

export async function closeTestApp(server) {
  await new Promise((resolve) => server.close(resolve));
  // Node's fetch (undici) keeps keep-alive connections open, which would
  // otherwise delay server.close() by ~3s per test.
  server.closeAllConnections();
}

export async function apiFetch(base, path, { method = 'GET', body, cookie, headers = {}, signal } = {}) {
  const opts = { method, headers: { ...headers }, redirect: 'manual' };
  if (cookie) opts.headers.Cookie = cookie;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (signal) opts.signal = signal;
  return fetch(`${base}/api${path}`, opts);
}

export async function login(base, { username = 'admin', password = TEST_PASSWORD } = {}) {
  const res = await apiFetch(base, '/auth/login', { method: 'POST', body: { username, password } });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : '';
  return { res, cookie };
}
