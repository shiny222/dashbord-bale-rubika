import React from 'react';

// Renders operation timing statistics as a table.
// `rows` — array of { operation, count, successCount, failureCount,
//           averageMs, minMs, maxMs, p50Ms, p95Ms, p99Ms }.
export default function PerformanceTable({ title, rows = [] }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="perf-table-wrap">
        <h3 className="perf-table-title">{title}</h3>
        <p className="perf-empty">No samples collected yet.</p>
      </div>
    );
  }
  const fmt = (v) => (v === null || v === undefined ? '—' : `${v} ms`);
  return (
    <div className="perf-table-wrap">
      <h3 className="perf-table-title">{title}</h3>
      <table className="perf-table">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Count</th>
            <th>OK</th>
            <th>Fail</th>
            <th>Avg</th>
            <th>Min</th>
            <th>p50</th>
            <th>p95</th>
            <th>p99</th>
            <th>Max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.operation}>
              <td className="perf-op">{r.operation}</td>
              <td>{r.count}</td>
              <td>{r.successCount}</td>
              <td className={r.failureCount > 0 ? 'perf-fail' : ''}>{r.failureCount}</td>
              <td>{fmt(r.averageMs)}</td>
              <td>{fmt(r.minMs)}</td>
              <td>{fmt(r.p50Ms)}</td>
              <td>{fmt(r.p95Ms)}</td>
              <td>{fmt(r.p99Ms)}</td>
              <td>{fmt(r.maxMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
