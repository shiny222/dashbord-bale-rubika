import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import SummaryBar from '../components/SummaryBar.jsx';
import ServiceCard from '../components/ServiceCard.jsx';
import TelegramApiCard from '../components/TelegramApiCard.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import LogViewer from '../components/LogViewer.jsx';
import Spinner from '../components/Spinner.jsx';
import { useToast } from '../components/ToastContext.jsx';
import { useServices, useTelegramApiHealth } from '../hooks/useServices.js';
import { useLogs } from '../hooks/useLogs.js';
import { api } from '../api/client.js';

export default function DashboardPage({ user, onLogout, onNavigate, view }) {
  const { notify } = useToast();
  const services = useServices();
  const telegram = useTelegramApiHealth();
  const [busyAction, setBusyAction] = useState(null); // { id, action }
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirm, setConfirm] = useState(null); // { title, body, confirmLabel, run }
  const [logTarget, setLogTarget] = useState(null); // service object
  const [logLines, setLogLines] = useState(100);
  const [logSearch, setLogSearch] = useState('');
  const logCloseRef = useRef(null);

  const logs = useLogs(logTarget?.serviceName || '', logLines, logSearch);

  // Escape closes the log viewer; focus moves into the dialog on open.
  useEffect(() => {
    if (!logTarget) return undefined;
    logCloseRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') setLogTarget(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [logTarget]);

  const runAction = useCallback(
    async (service, action) => {
      setBusyAction({ id: service.serviceName, action });
      try {
        await api(`/services/${encodeURIComponent(service.serviceName)}/${action}`, { method: 'POST' });
        notify({ type: 'success', message: `${action} request sent for ${service.displayName}.` });
        services.refresh();
      } catch (err) {
        notify({ type: 'error', message: `${action} failed: ${err.message}` });
      } finally {
        setBusyAction(null);
      }
    },
    [notify, services],
  );

  const runApiAction = useCallback(
    async (action) => {
      setBusyAction({ id: 'telegram-api', action });
      try {
        await api(`/telegram-api/control/${action}`, { method: 'POST' });
        notify({ type: 'success', message: `Telegram API ${action} request sent.` });
        telegram.refresh();
      } catch (err) {
        notify({ type: 'error', message: `${action} failed: ${err.message}` });
      } finally {
        setBusyAction(null);
      }
    },
    [notify, telegram],
  );

  const handleServiceAction = useCallback(
    (service, action) => {
      if (action === 'start') {
        runAction(service, action);
        return;
      }
      const verb = action === 'restart' ? 'restart' : 'stop';
      setConfirm({
        title: `${verb === 'restart' ? 'Restart' : 'Stop'} ${service.displayName}?`,
        body: `This will ${verb} the service ${service.serviceName}. ${
          verb === 'stop' ? 'The bot will stop forwarding messages until started again.' : 'There may be a short interruption.'
        }`,
        confirmLabel: verb === 'restart' ? 'Restart' : 'Stop',
        run: () => runAction(service, action),
      });
    },
    [runAction],
  );

  const handleApiAction = useCallback(
    (action) => {
      if (action === 'start') {
        runApiAction(action);
        return;
      }
      const verb = action === 'restart' ? 'restart' : 'stop';
      setConfirm({
        title: `${action === 'restart' ? 'Restart' : 'Stop'} the Telegram Local API?`,
        body: `This will ${verb} the Telegram Bot API service and interrupt bot connectivity.`,
        confirmLabel: action === 'restart' ? 'Restart' : 'Stop',
        run: () => runApiAction(action),
      });
    },
    [runApiAction],
  );

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    await onLogout();
  }, [onLogout]);

  const serviceList = useMemo(() => services.data || [], [services.data]);
  const isBusy = (serviceName) => busyAction?.id === serviceName;

  return (
    <div className="app">
      <Navbar
        username={user}
        updatedAt={services.updatedAt}
        onLogout={handleLogout}
        loggingOut={loggingOut}
        view={view}
        onNavigate={onNavigate}
      />

      <main className="content">
        {services.error && (
          <div className="banner-error" role="alert">
            Status refresh failed: {services.error.message}
          </div>
        )}

        <SummaryBar services={serviceList} telegramHealth={telegram.data} />

        <section className="section">
          <h2 className="section-title">Telegram bots</h2>
          {services.loading && serviceList.length === 0 ? (
            <div className="cards-loading">
              <Spinner size={20} /> Loading service status…
            </div>
          ) : (
            <div className="cards-grid">
              {serviceList.map((service) => (
                <ServiceCard
                  key={service.serviceName}
                  service={service}
                  busyAction={isBusy(service.serviceName) ? busyAction.action : null}
                  onAction={(action) => handleServiceAction(service, action)}
                  onViewLogs={() => setLogTarget(service)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <h2 className="section-title">Telegram Local Bot API</h2>
          <TelegramApiCard
            health={telegram.data}
            busyAction={busyAction?.id === 'telegram-api' ? busyAction.action : null}
            onAction={handleApiAction}
          />
        </section>
      </main>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel={confirm?.confirmLabel || 'Confirm'}
        busy={Boolean(busyAction)}
        onConfirm={() => {
          const run = confirm.run;
          setConfirm(null);
          run();
        }}
        onCancel={() => setConfirm(null)}
      />

      {logTarget && (
        <div className="dialog-backdrop log-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setLogTarget(null)}>
          <div className="dialog log-modal" role="dialog" aria-modal="true" aria-label={`Logs for ${logTarget.displayName}`}>
            <div className="log-modal-header">
              <div>
                <h2 className="dialog-title">{logTarget.displayName}</h2>
                <p className="card-subtitle">{logTarget.serviceName}</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setLogTarget(null)}
                aria-label="Close log viewer"
                ref={logCloseRef}
              >
                Close
              </button>
            </div>
            <LogViewer
              serviceName={logTarget.serviceName}
              logs={logs.logs}
              loading={logs.loading}
              error={logs.error}
              lines={logLines}
              onLinesChange={setLogLines}
              search={logSearch}
              onSearchChange={setLogSearch}
              onRefresh={logs.refresh}
            />
          </div>
        </div>
      )}
    </div>
  );
}
