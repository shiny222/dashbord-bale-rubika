// Health monitoring for the Telegram Local Bot API server.
// Distinguishes: service stopped / service running but endpoint
// unreachable / endpoint responding (any HTTP status proves liveness).
// No bot token is required or exposed.

import { measureOperation } from '../utils/measure-operation.js';

export function createTelegramApiService(options = {}) {
  const {
    systemd,
    serviceName = 'telegram-bot-api.service',
    url = 'http://127.0.0.1:8081',
    timeoutMs = 3000,
    fetchImpl = globalThis.fetch,
    metrics,
  } = options;

  if (typeof fetchImpl !== 'function') {
    throw new Error('createTelegramApiService requires a fetch implementation');
  }

  function serviceSnapshot(st, error) {
    if (error) {
      return { serviceName, status: 'unknown', activeState: '', subState: '', found: true, error: 'Unable to query service status' };
    }
    return {
      serviceName,
      status: st.status,
      activeState: st.activeState,
      subState: st.subState,
      found: st.found,
    };
  }

  async function check() {
    return measureOperation(
      'telegram-api-health',
      { serviceId: serviceName },
      async () => {
        let service;
        try {
          const st = await systemd.getServiceStatus(serviceName);
          service = serviceSnapshot(st, null);
        } catch {
          service = serviceSnapshot(null, true);
        }

        const endpoint = { reachable: false, reason: 'service-not-running', statusCode: null, ok: null, responseTimeMs: null };

        if (service.found === false || service.status === 'not-found') {
          return { healthy: false, service, endpoint: { ...endpoint, reason: 'service-not-found' } };
        }
        if (service.status === 'stopped' || service.status === 'failed') {
          return { healthy: false, service, endpoint };
        }

        // Service is at least active — probe the HTTP endpoint.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const startedAt = Date.now();
        try {
          const res = await fetchImpl(url, {
            method: 'GET',
            signal: controller.signal,
            redirect: 'manual',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          });
          const responseTimeMs = Date.now() - startedAt;
          return {
            healthy: true,
            service,
            endpoint: {
              reachable: true,
              statusCode: res.status,
              ok: res.ok,
              responseTimeMs,
              reason: null,
            },
          };
        } catch (err) {
          const responseTimeMs = Date.now() - startedAt;
          const timedOut = err && (err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.code === 'UND_ERR_CONNECT_TIMEOUT');
          return {
            healthy: false,
            service,
            endpoint: {
              ...endpoint,
              reason: timedOut ? 'timeout' : 'connection-failed',
              responseTimeMs,
            },
          };
        } finally {
          clearTimeout(timer);
        }
      },
      { metrics },
    );
  }

  return { check };
}
