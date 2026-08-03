import React from 'react';

// A labeled value card with an optional warning flag and sub-value.
export default function MetricCard({ label, value, sub, warning = false, title }) {
  return (
    <div className={`metric-card ${warning ? 'metric-card-warn' : ''}`} title={title}>
      <span className="metric-card-label">{label}</span>
      <span className="metric-card-value">{value}</span>
      {sub ? <span className="metric-card-sub">{sub}</span> : null}
      {warning ? <span className="metric-card-flag" role="img" aria-label="Abnormal value">⚠</span> : null}
    </div>
  );
}
