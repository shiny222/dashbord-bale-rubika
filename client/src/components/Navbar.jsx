import React from 'react';

export default function Navbar({ username, updatedAt, onLogout, loggingOut, view, onNavigate }) {
  return (
    <header className="navbar">
      <div className="navbar-brand">
        <span className="brand-mark" aria-hidden="true">◈</span>
        <div>
          <h1 className="brand-title">Bot Control</h1>
          <p className="brand-sub">Telegram bridge operations dashboard</p>
        </div>
      </div>
      <div className="navbar-right">
        {onNavigate && (
          <nav className="navbar-links" aria-label="Main navigation">
            <button
              type="button"
              className={`nav-link${view === 'dashboard' ? ' nav-link-active' : ''}`}
              aria-current={view === 'dashboard' ? 'page' : undefined}
              onClick={() => onNavigate('dashboard')}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`nav-link${view === 'diagnostics' ? ' nav-link-active' : ''}`}
              aria-current={view === 'diagnostics' ? 'page' : undefined}
              onClick={() => onNavigate('diagnostics')}
            >
              Diagnostics
            </button>
          </nav>
        )}
        {updatedAt && (
          <span className="updated-at" title="Last successful status refresh">
            Updated {updatedAt.toLocaleTimeString()}
          </span>
        )}
        {username && (
          <span className="navbar-user" title="Signed in as">
            {username}
          </span>
        )}
        <button type="button" className="btn btn-ghost" onClick={onLogout} disabled={loggingOut}>
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  );
}
