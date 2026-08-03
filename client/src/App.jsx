import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { ToastProvider } from './components/ToastContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import DiagnosticsPage from './pages/DiagnosticsPage.jsx';
import Spinner from './components/Spinner.jsx';

// Minimal router: the backend serves index.html for every non-/api GET,
// so real paths work in production and in the Vite dev server. The active
// view is derived from the path and kept in sync with the browser history
// (back/forward supported). No router dependency needed.
function viewFromPath() {
  return window.location.pathname === '/diagnostics' ? 'diagnostics' : 'dashboard';
}

export default function App() {
  const auth = useAuth();
  const [view, setView] = useState(viewFromPath);

  useEffect(() => {
    const onPop = () => setView(viewFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next) => {
    const path = next === 'diagnostics' ? '/diagnostics' : '/';
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setView(next);
  }, []);

  if (auth.loading) {
    return (
      <div className="boot-screen">
        <Spinner size={28} />
        <p>Connecting to dashboard…</p>
      </div>
    );
  }

  return (
    <ToastProvider>
      {auth.user ? (
        view === 'diagnostics' ? (
          <DiagnosticsPage user={auth.user} onLogout={auth.logout} onNavigate={navigate} />
        ) : (
          <DashboardPage user={auth.user} onLogout={auth.logout} onNavigate={navigate} view={view} />
        )
      ) : (
        <LoginPage onLogin={auth.login} loginError={auth.error} />
      )}
    </ToastProvider>
  );
}
