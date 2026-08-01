import React from 'react';
import { useAuth } from './hooks/useAuth.js';
import { ToastProvider } from './components/ToastContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import Spinner from './components/Spinner.jsx';

export default function App() {
  const auth = useAuth();

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
        <DashboardPage user={auth.user} onLogout={auth.logout} />
      ) : (
        <LoginPage onLogin={auth.login} loginError={auth.error} />
      )}
    </ToastProvider>
  );
}
