import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetricsCollector } from '../src/diagnostics/metrics-collector.js';
import { createDiagnosticsService } from '../src/diagnostics/diagnostics-service.js';

test('metrics collector computes count and percentiles', () => {
  const m = createMetricsCollector({ maxSamples: 100 });
  for (let i = 1; i <= 10; i += 1) m.record('service-status', i * 10, true);
  m.record('service-status', 500, false);

  const s = m.summary('service-status');
  assert.equal(s.count, 11);
  assert.equal(s.successCount, 10);
  assert.equal(s.failureCount, 1);
  assert.equal(s.minMs, 10);
  assert.equal(s.maxMs, 500);
  assert.ok(s.p50Ms >= 10);
  assert.ok(s.p95Ms <= 500);
  // 10 samples of 10..100 plus one failure of 500 -> mean of all 11.
  assert.equal(s.averageMs, Math.round((1050 / 11) * 100) / 100);
});

test('metrics collector stays bounded (ring buffer)', () => {
  const m = createMetricsCollector({ maxSamples: 5 });
  for (let i = 1; i <= 100; i += 1) m.record('op', i, true);
  const s = m.summary('op');
  assert.equal(s.count, 5); // only the most recent 5 retained
  assert.equal(s.minMs, 96);
  assert.equal(s.maxMs, 100);
});

test('metrics collector returns empty summary for unknown ops', () => {
  const m = createMetricsCollector();
  const s = m.summary('nope');
  assert.equal(s.count, 0);
  assert.equal(s.averageMs, null);
});

test('metrics all() is bounded by number of operations', () => {
  const m = createMetricsCollector({ maxSamples: 10 });
  for (let i = 0; i < 1000; i += 1) m.record('op-a', 1, true);
  m.record('op-b', 2, true);
  const all = m.all();
  assert.equal(all.length, 2);
});

test('diagnostics snapshot exposes safe process data', () => {
  const m = createMetricsCollector();
  m.record('telegram-api-health', 12.5, true);
  const diag = createDiagnosticsService({ metrics: m, applicationVersion: '9.9.9' });
  try {
    const snap = diag.snapshot();
    assert.equal(snap.process.applicationVersion, '9.9.9');
    assert.ok(Number.isFinite(snap.process.uptimeSeconds));
    assert.ok(Number.isInteger(snap.memory.rssBytes) && snap.memory.rssBytes > 0);
    assert.ok(Number.isInteger(snap.memory.heapUsedBytes));
    assert.ok(Number.isInteger(snap.cpu.userMicroseconds));
    assert.ok(Number.isFinite(snap.eventLoop.meanMs));
    assert.ok(snap.recentOperations['telegram-api-healthAverageMs'] > 0);
    // No secrets / env / paths exposed.
    const raw = JSON.stringify(snap);
    assert.ok(!raw.includes('SESSION_SECRET'));
    assert.ok(!raw.includes('process.env'));
    assert.ok(!raw.includes('/etc/'));
  } finally {
    diag.stop();
  }
});
