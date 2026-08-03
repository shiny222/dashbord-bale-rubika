import React, { useCallback, useMemo, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import MetricCard from '../components/MetricCard.jsx';
import PerformanceTable from '../components/PerformanceTable.jsx';
import Spinner from '../components/Spinner.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { fetchDiagnostics } from '../api/diagnostics-api.js';
import { formatBytes, formatUptime, formatTime } from '../utils/format.js';

// Auto-refresh cadence for the diagnostics page (spec: 5-10 s).
const REFRESH_MS = 8000;

// Warning thresholds for abnormal values.
const WARN_EVENT_LOOP_MEAN_MS = 50;
const WARN_EVENT_LOOP_P95_MS = 150;
const WARN_HEAP_USED_RATIO = 0.9;

// process.cpuUsage() reports cumulative microseconds since start.
function formatMicroseconds(value) {
  if (!Number.isFinite(value)) return '—';
  return `${(value / 1e6).toFixed(1)}s`;
}

export default function DiagnosticsPage({ user, onLogout, onNavigate }) {
  const { data, updatedAt, error, refresh, loading } = usePoll(
    ({ signal }) => fetchDiagnostics({ signal }),
    REFRESH_MS,
    true,
  );
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    await onLogout();
  }, [onLogout]);

  const operationRows = useMemo(() => data?.operationMetrics || [], [data]);
  const systemdRows = useMemo(
    () => operationRows.filter((r) => r.operation.startsWith('service-')),
    [operationRows],
  );
  const apiRows = useMemo(
    () => operationRows.filter((r) => r.operation === 'api-request'),
    [operationRows],
  );
  const telegramRows = useMemo(
    () => operationRows.filter((r) => r.operation === 'telegram-api-health'),
    [operationRows],
  );

  const processInfo = data?.process || null;
  const memory = data?.memory || null;
  const cpu = data?.cpu || null;
  const eventLoop = data?.eventLoop || null;
  const recent = data?.recentOperations || {};

  const heapRatio = memory && memory.heapTotalBytes > 0 ? memory.heapUsedBytes / memory.heapTotalBytes : 0;
  const eventLoopMean = eventLoop?.meanMs ?? 0;
  const eventLoopP95 = eventLoop?.p95Ms ?? 0;

  const nav = (
    <Navbar
      username={user}
      updatedAt={updatedAt}
      onLogout={handleLogout}
      loggingOut={loggingOut}
      view="diagnostics"
      onNavigate={onNavigate}
    />
  );

  if (loading) {
    return (
      <div className="app">
        {nav}
        <main className="content">
          <div className="cards-loading">
            <Spinner size={20} /> Loading diagnostics…
          </div>
        </main>
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className="app">
        {nav}
        <main className="content">
          <div className="banner-error" role="alert">
            Unable to load diagnostics: {error.message}
          </div>
          <button type="button" className="btn btn-primary" onClick={refresh}>
            Retry
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      {nav}
      <main className="content">
        <div className="diag-header">
          <div>
            <h2 className="diag-title">Diagnostics</h2>
            <p className="diag-subtitle">Node.js process health, event-loop latency and operation timing.</p>
          </div>
          <div className="diag-header-actions">
            {updatedAt && <span className="diag-updated">Updated {updatedAt.toLocaleTimeString()}</span>}
            <button type="button" className="btn" onClick={refresh}>
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="banner-error" role="alert">
            Diagnostics refresh failed: {error.message}
          </div>
        )}

        {processInfo && (
          <section className="diag-section">
            <h3 className="diag-section-title">Application Health</h3>
            <div className="diag-grid">
              <MetricCard label="Uptime" value={formatUptime(processInfo.uptimeSeconds)} sub="process" />
              <MetricCard label="Node.js" value={processInfo.nodeVersion} sub="version" />
              <MetricCard label="App version" value={processInfo.applicationVersion} />
              <MetricCard label="Server time" value={formatTime(processInfo.timestamp)} sub="your local timezone" />
            </div>
          </section>
        )}

        {memory && (
          <section className="diag-section">
            <h3 className="diag-section-title">Memory</h3>
            <div className="diag-grid">
              <MetricCard label="RSS" value={formatBytes(memory.rssBytes)} />
              <MetricCard
                label="Heap used"
                value={formatBytes(memory.heapUsedBytes)}
                warning={heapRatio > WARN_HEAP_USED_RATIO}
                title="High heap usage may indicate a memory leak"
              />
              <MetricCard label="Heap total" value={formatBytes(memory.heapTotalBytes)} />
              <MetricCard label="External" value={formatBytes(memory.externalBytes)} />
              <MetricCard
                label="Heap usage"
                value={`${Math.round(heapRatio * 100)}%`}
                warning={heapRatio > WARN_HEAP_USED_RATIO}
              />
            </div>
          </section>
        )}

        {cpu && (
          <section className="diag-section">
            <h3 className="diag-section-title">CPU</h3>
            <div className="diag-grid">
              <MetricCard label="User time" value={formatMicroseconds(cpu.userMicroseconds)} sub="cumulative" />
              <MetricCard label="System time" value={formatMicroseconds(cpu.systemMicroseconds)} sub="cumulative" />
            </div>
          </section>
        )}

        {eventLoop && (
          <section className="diag-section">
            <h3 className="diag-section-title">Event Loop</h3>
            <div className="diag-grid">
              <MetricCard
                label="Mean delay"
                value={`${eventLoop.meanMs} ms`}
                warning={eventLoopMean > WARN_EVENT_LOOP_MEAN_MS}
                title="Mean event-loop delay above 50 ms indicates the process is struggling"
              />
              <MetricCard label="Max delay" value={`${eventLoop.maxMs} ms`} />
              <MetricCard label="p50" value={`${eventLoop.p50Ms} ms`} />
              <MetricCard
                label="p95"
                value={`${eventLoop.p95Ms} ms`}
                warning={eventLoopP95 > WARN_EVENT_LOOP_P95_MS}
                title="p95 event-loop delay above 150 ms indicates periodic stalls"
              />
              <MetricCard label="p99" value={`${eventLoop.p99Ms} ms`} />
            </div>
          </section>
        )}

        <section className="diag-section">
          <h3 className="diag-section-title">API Performance</h3>
          <PerformanceTable title="API requests" rows={apiRows} />
        </section>

        <section className="diag-section">
          <h3 className="diag-section-title">Systemd Operations</h3>
          <PerformanceTable title="Service commands" rows={systemdRows} />
        </section>

        <section className="diag-section">
          <h3 className="diag-section-title">Telegram API Health</h3>
          {recent.telegramApiHealthAverageMs != null && (
            <div className="diag-grid diag-grid-narrow">
              <MetricCard label="Avg probe time" value={`${recent.telegramApiHealthAverageMs} ms`} sub="endpoint health check" />
            </div>
          )}
          <PerformanceTable title="Telegram API health probes" rows={telegramRows} />
        </section>
      </main>
    </div>
  );
}
