import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api('/auth/session')
      .then((data) => {
        if (alive) setUser(data.username);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username, password } });
      setUser(data.username);
      setError(null);
      return { ok: true };
    } catch (err) {
      setError(err);
      return { ok: false, error: err };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // ignore — the session is being torn down either way
    }
    setUser(null);
  }, []);

  return { user, loading, error, login, logout };
}
