import React, { useState } from 'react';
import Spinner from '../components/Spinner.jsx';

export default function LoginPage({ onLogin, loginError }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!username || !password || busy) return;
    setBusy(true);
    setError(null);
    const result = await onLogin(username, password);
    if (!result.ok) {
      setError(result.error?.message || 'Login failed.');
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit} aria-label="Sign in">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">◈</span>
          <h1>Bot Control</h1>
          <p>Sign in to manage your Telegram bridges</p>
        </div>

        <label className="field">
          <span className="field-label">Username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {(error || loginError) && (
          <p className="login-error" role="alert">
            {error || loginError?.message || 'Login failed. Please try again.'}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Spinner size={16} /> : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
