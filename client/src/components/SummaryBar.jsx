import React from 'react';
import { STATUS_META } from './StatusPill.jsx';

function Stat({ count, cls, label }) {
  return (
    <div className="summary-stat">
      <span className={`summary-count ${cls}`}>{count}</span>
      <span className="summary-label">{label}</span>
    </div>
  );
}

export default function SummaryBar({ services, telegramHealth }) {
  const counts = { running: 0, starting: 0, stopped: 0, failed: 0, unknown: 0 };
  for (const s of services) {
    counts[s.status] = (counts[s.status] || 0) + 1;
  }

  const apiMeta = telegramHealth ? STATUS_META[telegramHealth.healthy ? 'running' : telegramHealth.service?.status] : STATUS_META.unknown;
  const apiStatus = telegramHealth
    ? telegramHealth.healthy
      ? 'API online'
      : telegramHealth.service?.status === 'stopped'
        ? 'API stopped'
        : telegramHealth.service?.status === 'failed'
          ? 'API failed'
          : 'API unreachable'
    : 'Checking API…';

  return (
    <section className="summary-bar" aria-label="System summary">
      <div className="summary-stats">
        <Stat count={counts.running || 0} cls="stat-green" label="Running" />
        <Stat count={counts.starting || 0} cls="stat-amber" label="Transitioning" />
        <Stat count={counts.stopped || 0} cls="stat-gray" label="Stopped" />
        <Stat count={counts.failed || 0} cls="stat-red" label="Failed" />
      </div>
      <div className="summary-api">
        <span className={`status-pill ${apiMeta ? apiMeta.cls : 'status-unknown'}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          Telegram API · {apiStatus}
        </span>
        {telegramHealth && telegramHealth.endpoint?.responseTimeMs !== null && telegramHealth.endpoint?.responseTimeMs !== undefined && (
          <span className="summary-api-latency">{telegramHealth.endpoint.responseTimeMs} ms</span>
        )}
      </div>
    </section>
  );
}
