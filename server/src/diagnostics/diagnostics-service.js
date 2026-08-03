// Process health diagnostics: uptime, memory, CPU, and event-loop delay.
//
// The event-loop delay histogram is created once and enabled for the life
// of the process (it is NOT reset when a user opens the page), so the
// percentiles reflect a continuous sampling window. `stop()` disables it
// during graceful shutdown.

import { monitorEventLoopDelay } from 'node:perf_hooks';

// ms with two decimals. The event-loop histogram reports null until it has
// collected its first sample, so a fresh process yields 0 instead of null
// to keep the API response numerically complete.
function ms2(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function createDiagnosticsService({ metrics, applicationVersion = '1.0.0' } = {}) {
  const histogram = monitorEventLoopDelay({ resolution: 20 }); // 20ms buckets
  histogram.enable();

  // Recent average durations, pulled from the shared metrics collector.
  const RECENT_OPS = [
    'service-status',
    'service-start',
    'service-stop',
    'service-restart',
    'service-logs',
    'telegram-api-health',
  ];

  function recentOperations() {
    const out = {};
    if (metrics && typeof metrics.summary === 'function') {
      for (const op of RECENT_OPS) {
        const s = metrics.summary(op);
        if (s && s.count > 0) out[`${op}AverageMs`] = s.averageMs;
      }
    }
    return out;
  }

  function snapshot() {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      process: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        applicationVersion,
        timestamp: new Date().toISOString(),
      },
      memory: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
      },
      cpu: {
        // process.cpuUsage() returns cumulative microseconds since start.
        userMicroseconds: cpu.user,
        systemMicroseconds: cpu.system,
      },
      eventLoop: {
        meanMs: ms2(histogram.mean),
        maxMs: ms2(histogram.max),
        p50Ms: ms2(histogram.percentile(50)),
        p95Ms: ms2(histogram.percentile(95)),
        p99Ms: ms2(histogram.percentile(99)),
      },
      recentOperations: recentOperations(),
    };
  }

  function stop() {
    try {
      histogram.disable();
    } catch {
      // already disabled — ignore
    }
  }

  return { snapshot, stop };
}
