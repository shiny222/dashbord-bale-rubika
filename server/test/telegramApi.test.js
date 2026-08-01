import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramApiService } from '../src/services/telegramApi.js';

function fakeSystemd(status) {
  return { getServiceStatus: async () => status };
}

test('reports service-not-found when the unit is missing', async () => {
  const api = createTelegramApiService({
    systemd: fakeSystemd({ found: false, status: 'not-found', activeState: '', subState: '' }),
    fetchImpl: async () => {
      throw new Error('should not be called');
    },
  });
  const health = await api.check();
  assert.equal(health.healthy, false);
  assert.equal(health.endpoint.reason, 'service-not-found');
});

test('reports service-not-running when the service is stopped', async () => {
  const api = createTelegramApiService({
    systemd: fakeSystemd({ found: true, status: 'stopped', activeState: 'inactive', subState: 'dead' }),
    fetchImpl: async () => {
      throw new Error('should not be called');
    },
  });
  const health = await api.check();
  assert.equal(health.healthy, false);
  assert.equal(health.endpoint.reason, 'service-not-running');
});

test('reports service-not-running when the service failed', async () => {
  const api = createTelegramApiService({
    systemd: fakeSystemd({ found: true, status: 'failed', activeState: 'failed', subState: 'failed' }),
    fetchImpl: async () => {
      throw new Error('should not be called');
    },
  });
  const health = await api.check();
  assert.equal(health.healthy, false);
  assert.equal(health.endpoint.reason, 'service-not-running');
});

test('an HTTP response proves liveness even for 404', async () => {
  const api = createTelegramApiService({
    systemd: fakeSystemd({ found: true, status: 'running', activeState: 'active', subState: 'running' }),
    fetchImpl: async () => ({ status: 404, ok: false }),
  });
  const health = await api.check();
  assert.equal(health.healthy, true);
  assert.equal(health.endpoint.reachable, true);
  assert.equal(health.endpoint.statusCode, 404);
  assert.ok(health.endpoint.responseTimeMs >= 0);
});

test('connection failure is reported distinctly', async () => {
  const api = createTelegramApiService({
    systemd: fakeSystemd({ found: true, status: 'running', activeState: 'active', subState: 'running' }),
    fetchImpl: async () => {
      const err = new Error('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    },
  });
  const health = await api.check();
  assert.equal(health.healthy, false);
  assert.equal(health.endpoint.reason, 'connection-failed');
});

test('timeouts are reported distinctly', async () => {
  const api = createTelegramApiService({
    systemd: fakeSystemd({ found: true, status: 'running', activeState: 'active', subState: 'running' }),
    timeoutMs: 50,
    fetchImpl: async (_url, opts) => {
      await new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
        setTimeout(resolve, 500);
      });
      throw new Error('unreachable');
    },
  });
  const health = await api.check();
  assert.equal(health.healthy, false);
  assert.equal(health.endpoint.reason, 'timeout');
});
