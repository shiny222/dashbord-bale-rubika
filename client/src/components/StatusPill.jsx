import React from 'react';

export const STATUS_META = {
  running: { label: 'Running', cls: 'status-running' },
  starting: { label: 'Starting', cls: 'status-starting' },
  stopping: { label: 'Stopping', cls: 'status-stopping' },
  stopped: { label: 'Stopped', cls: 'status-stopped' },
  failed: { label: 'Failed', cls: 'status-failed' },
  'not-found': { label: 'Not found', cls: 'status-missing' },
  unknown: { label: 'Unknown', cls: 'status-unknown' },
};

export default function StatusPill({ status, label }) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  const text = label || meta.label;
  return (
    <span className={`status-pill ${meta.cls}`} role="status" title={text}>
      <span className="status-dot" aria-hidden="true" />
      {text}
    </span>
  );
}
