import React from 'react';
import StatusPill from './StatusPill.jsx';
import Metric from './Metric.jsx';
import { formatUptime, formatBytes, formatCpu, formatTime, formatRelative } from '../utils/format.js';

export default function ServiceCard({ service, busyAction, onAction, onViewLogs }) {
  const running = service.status === 'running';
  const starting = service.status === 'starting';
  const stopping = service.status === 'stopping';
  const failed = service.status === 'failed';
  const missing = service.status === 'not-found';
  const busy = Boolean(busyAction);

  return (
    <article className={`card service-card ${failed ? 'card-alert' : ''}`}>
      <div className="card-header">
        <div>
          <h2 className="card-title">{service.displayName || service.id}</h2>
          <p className="card-subtitle">{service.serviceName}</p>
        </div>
        <StatusPill status={service.status} />
      </div>

      {service.error && <p className="card-error">{service.error}</p>}

      <div className="metrics-grid">
        <Metric label="Uptime" value={formatUptime(service.uptimeSeconds)} title="Time since the service became active" />
        <Metric label="PID" value={service.mainPid > 0 ? service.mainPid : '—'} title="Main process ID" />
        <Metric label="Memory" value={formatBytes(service.memoryBytes)} title="Current memory usage" />
        <Metric label="CPU" value={formatCpu(service.cpuUsageNSec)} title="Accumulated CPU time" />
        <Metric label="Restarts" value={service.restartCount} title="Number of automatic restarts by systemd" />
        <Metric label="Last started" value={formatRelative(service.lastStartedAt)} title={formatTime(service.lastStartedAt)} />
      </div>

      {missing ? (
        <p className="card-hint">Unit not found — is it installed on this host?</p>
      ) : (
        <div className="result-row">
          <span className="result-label">Last result</span>
          <span className={`result-value ${service.result && service.result !== 'success' ? 'result-bad' : ''}`}>
            {service.result || '—'}
            {service.execMainStatus !== 0 ? ` (exit ${service.execMainStatus})` : ''}
          </span>
        </div>
      )}

      <div className="card-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onAction('start')}
          disabled={busy || running || starting || missing}
        >
          {busyAction === 'start' ? 'Starting…' : 'Start'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onAction('stop')}
          disabled={busy || !running || stopping}
        >
          {busyAction === 'stop' ? 'Stopping…' : 'Stop'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onAction('restart')}
          disabled={busy || !running || stopping}
        >
          {busyAction === 'restart' ? 'Restarting…' : 'Restart'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onViewLogs} disabled={busy}>
          Logs
        </button>
      </div>
    </article>
  );
}
