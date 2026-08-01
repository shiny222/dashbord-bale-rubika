import React, { useEffect, useRef, useState } from 'react';
import Spinner from './Spinner.jsx';

const LINE_OPTIONS = [50, 100, 250, 500];

export default function LogViewer({
  serviceName,
  logs,
  loading,
  error,
  lines,
  onLinesChange,
  search,
  onSearchChange,
  onRefresh,
}) {
  const [searchInput, setSearchInput] = useState(search);
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef(null);

  // Keep the input in sync if the search is reset from outside.
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  // Debounce the search input upward so the hook refetches with the filter.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) onSearchChange(searchInput.trim());
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Auto-scroll to the newest lines unless the user scrolled up.
  useEffect(() => {
    if (autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs, lines, search, autoScroll]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(nearBottom);
  };

  const levelClass = (level) => `log-line log-level-${level}`;

  return (
    <div className="log-viewer">
      <div className="log-toolbar">
        <label className="log-control">
          <span className="control-label">Lines</span>
          <select value={lines} onChange={(e) => onLinesChange(Number(e.target.value))}>
            {LINE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="log-control log-search">
          <span className="control-label">Filter</span>
          <input
            type="search"
            value={searchInput}
            placeholder="Filter logs…"
            aria-label="Filter logs by text"
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-ghost" onClick={onRefresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <span className="log-count">
          {logs ? `${logs.lines.length}${logs.search ? ` / ${logs.filtered} matched` : ''} lines` : ''}
        </span>
      </div>

      {error ? (
        <div className="log-banner-error" role="alert">
          {error.message}
        </div>
      ) : (
        <div className="log-body" ref={bodyRef} onScroll={onScroll} tabIndex={0} aria-label={`Journal logs for ${serviceName}`}>
          {loading && logs.lines.length === 0 ? (
            <div className="log-empty">
              <Spinner size={20} /> Loading logs…
            </div>
          ) : logs.lines.length === 0 ? (
            <div className="log-empty">No log lines match.</div>
          ) : (
            <ul className="log-lines">
              {logs.lines.map((line, i) => (
                <li key={`${line.time}-${i}`} className={levelClass(line.level)} title={line.raw}>
                  <span className="log-time">{line.time || '——'}</span>
                  <span className="log-host">{line.host || ''}</span>
                  <span className="log-process">{line.process || ''}</span>
                  <span className="log-message">{line.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
