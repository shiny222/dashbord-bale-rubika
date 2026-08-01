import React from 'react';

export default function Metric({ label, value, title }) {
  return (
    <div className="metric" title={title}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}
