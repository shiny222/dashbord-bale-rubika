import React from 'react';
import StatusPill from './StatusPill.jsx';
import Metric from './Metric.jsx';
import { formatResponseTime } from '../utils/format.js';

export default function TelegramApiCard({ health, busyAction, onAction }) {
  const endpoint = health?.endpoint || {};
  const service = health?.service || {};
  const busy = Boolean(busyAction);
  const healthy = Boolean(health?.healthy);
  const controlEnabled = health?.controlEnabled !== false;
  const serviceStatus = health ? (healthy ? 'running' : service.status || 'unknown') : 'unknown';

  const detail = health
    ? healthy
      ? `HTTP ${endpoint.statusCode ?? '—'}`
      : endpoint.reason === 'service-not-running'
        ? 'Service is not running'
        : endpoint.reason === 'service-not-found'
          ? 'Unit not found'
          : endpoint.reason === 'timeout'
            ? 'Endpoint did not respond in time'
            : 'Endpoint unreachable'
    : 'No health data yet';

  return (
    <article className={`card api-card ${healthy ? '' : 'card-alert'}`}>
      <div className="card-header">
        <div>
          <h2 className="card-title">Telegram Local Bot API</h2>
          <p className="card-subtitle">{service.serviceName || 'telegram-bot-api'}</p>
        </div>
        <StatusPill status={serviceStatus} label={healthy ? 'Healthy' : undefined} />
      </div>

      <div className="metrics-grid">
        <Metric label="Endpoint" value={detail} title="Health probe result" />
        <Metric label="Response time" value={formatResponseTime(endpoint.responseTimeMs)} title="HTTP probe latency" />
        <Metric label="HTTP status" value={endpoint.statusCode ?? '—'} title="Last probe status code" />
        <Metric label="Service state" value={service.subState || '—'} title="Container or systemd service state" />
      </div>

      <p className="card-hint">
        The probe never uses a bot token — an HTTP response from any status code proves the server is reachable.
      </p>

      {controlEnabled ? (
        <div className="card-actions">
          <button
            type="button"
            className="btn"
            onClick={() => onAction('start')}
            disabled={busy || healthy}
          >
            {busyAction === 'start' ? 'Starting…' : 'Start'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onAction('stop')}
            disabled={busy || !healthy}
          >
            {busyAction === 'stop' ? 'Stopping…' : 'Stop'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onAction('restart')}
            disabled={busy || !healthy}
          >
            {busyAction === 'restart' ? 'Restarting…' : 'Restart'}
          </button>
        </div>
      ) : (
        <p className="card-hint">Service controls are disabled in configuration.</p>
      )}
    </article>
  );
}
