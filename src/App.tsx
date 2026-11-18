import { useCallback, useEffect, useState } from 'react';
import { AppsView } from './components/AppsView';
import { DashboardView } from './components/DashboardView';
import { DeployBackupView } from './components/DeployBackupView';
import { LoginGate } from './components/LoginGate';
import { MediaView } from './components/MediaView';
import { PlayersView } from './components/PlayersView';
import { SchedulerView } from './components/SchedulerView';
import { SettingsView } from './components/SettingsView';
import { Sidebar, type NavSection } from './components/Sidebar';
import { SystemView } from './components/SystemView';
import { TopBar } from './components/TopBar';
import { useWebSocketState } from './hooks/useWebSocketState';
import type {
  AuditLogEntry,
  AuthStatus,
  AuthorizedApp,
  HealthCheckReport,
  HostTelemetry,
  PlayerState,
  ScheduleRule,
  StandbyConfig,
  SystemSettings,
} from './types';
import { apiRequest } from './utils/api';

interface FullAppState {
  telemetry: HostTelemetry;
  player: PlayerState;
  schedules: ScheduleRule[];
  apps: AuthorizedApp[];
  standby: StandbyConfig;
  settings: SystemSettings;
  logs: AuditLogEntry[];
  wifiProfiles: Array<{ id: number; ssid: string; security: string; signal: number; connected: number }>;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('edusignage_theme');
    return saved === 'light' ? 'light' : 'dark';
  });
  const [section, setSection] = useState<NavSection>('panel');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [state, setState] = useState<FullAppState | null>(null);
  const [healthReport, setHealthReport] = useState<HealthCheckReport | null>(null);
  const [healthRunning, setHealthRunning] = useState(false);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('edusignage_theme', theme);
  }, [theme]);

  const notify = useCallback((msg: string, isError = false) => {
    setToast({ msg, isError });
    window.setTimeout(() => {
      setToast((curr) => (curr?.msg === msg ? null : curr));
    }, 4000);
  }, []);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const auth = await apiRequest<AuthStatus>('/api/auth/status');
      setAuthStatus(auth);
      return auth;
    } catch {
      return null;
    }
  }, []);

  const fetchFullState = useCallback(async () => {
    try {
      const data = await apiRequest<FullAppState>('/api/state');
      setState(data);
    } catch {
      // handled by unauthorized listener if 401
    }
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      fetchAuthStatus();
    };
    window.addEventListener('edusignage:unauthorized', onUnauthorized);
    fetchAuthStatus().then((auth) => {
      if (!auth || !auth.authEnabled || auth.authenticated) {
        fetchFullState();
      }
    });
    return () => window.removeEventListener('edusignage:unauthorized', onUnauthorized);
  }, [fetchAuthStatus, fetchFullState]);

  const wsEnabled = Boolean(authStatus && (!authStatus.authEnabled || authStatus.authenticated));
  const wsStatus = useWebSocketState(wsEnabled, {
    onTelemetry: (telemetry) =>
      setState((prev) => (prev ? { ...prev, telemetry } : prev)),
    onPlayer: (player) =>
      setState((prev) => (prev ? { ...prev, player } : prev)),
    onServices: (services) =>
      setState((prev) =>
        prev && prev.telemetry ? { ...prev, telemetry: { ...prev.telemetry, services } } : prev
      ),
    onSchedules: (schedules) =>
      setState((prev) => (prev ? { ...prev, schedules } : prev)),
    onApps: (apps) =>
      setState((prev) => (prev ? { ...prev, apps } : prev)),
    onStandby: (standby) =>
      setState((prev) => (prev ? { ...prev, standby } : prev)),
  });

  const handleRunHealthCheck = async () => {
    setHealthRunning(true);
    try {
      const report = await apiRequest<HealthCheckReport>('/api/health-check', { method: 'POST' });
      setHealthReport(report);
      notify(
        report.overall === 'ok'
          ? 'Todos los componentes superaron la comprobación.'
          : 'Comprobación completada con advertencias revisables.'
      );
      fetchFullState();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error ejecutando comprobación', true);
    } finally {
      setHealthRunning(false);
    }
  };

  const handleLockSession = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    await fetchAuthStatus();
  };

  if (authStatus && authStatus.authEnabled && !authStatus.authenticated) {
    return (
      <LoginGate
        onAuthenticated={async () => {
          await fetchAuthStatus();
          await fetchFullState();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Sidebar
        active={section}
        onSelect={setSection}
        wsStatus={wsStatus}
        deviceName={state?.settings.device_name || 'EduSignage Pi'}
        mdnsAddress={state?.telemetry.mdnsAddress || 'edusignage.local'}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeSection={section}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onRunHealthCheck={handleRunHealthCheck}
          healthRunning={healthRunning}
          authEnabled={Boolean(authStatus?.authEnabled)}
          onLockSession={handleLockSession}
        />

        <main className="flex-1 p-4 lg:p-8 max-w-[1440px] w-full mx-auto">
          {!state ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="h-28 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <>
              {section === 'panel' && (
                <DashboardView
                  telemetry={state.telemetry}
                  player={state.player}
                  standby={state.standby}
                  logs={state.logs}
                  healthReport={healthReport}
                  onStandby={async () => {
                    const p = await apiRequest<PlayerState>('/api/player/standby', { method: 'POST' });
                    setState((prev) => (prev ? { ...prev, player: p } : prev));
                    notify('Pantalla de espera activada.');
                  }}
                  onStopDisplay={async () => {
                    const p = await apiRequest<PlayerState>('/api/player/stop', { method: 'POST' });
                    setState((prev) => (prev ? { ...prev, player: p } : prev));
                    notify('Salida de pantalla detenida.');
                  }}
                  onResumeSchedule={async () => {
                    const p = await apiRequest<PlayerState>('/api/player/resume-schedule', { method: 'POST' });
                    setState((prev) => (prev ? { ...prev, player: p } : prev));
                    notify('Control devuelto al planificador horario.');
                  }}
                  onNavigate={setSection}
                />
              )}

              {section === 'programacion' && (
                <SchedulerView
                  schedules={state.schedules}
                  apps={state.apps}
                  onSchedulesChange={(schedules) => setState((prev) => (prev ? { ...prev, schedules } : prev))}
                  onNotify={notify}
                />
              )}

              {section === 'reproductores' && (
                <PlayersView
                  telemetry={state.telemetry}
                  standby={state.standby}
                  onStandbyUpdated={(standby) => setState((prev) => (prev ? { ...prev, standby } : prev))}
                  onNotify={notify}
                />
              )}

              {section === 'aplicaciones' && (
                <AppsView
                  apps={state.apps}
                  player={state.player}
                  onAppsChange={(apps) => setState((prev) => (prev ? { ...prev, apps } : prev))}
                  onNotify={notify}
                />
              )}

              {section === 'multimedia' && (
                <MediaView
                  mdnsAddress={state.telemetry.mdnsAddress}
                  mediaRootSetting={state.settings.media_root}
                  onNotify={notify}
                />
              )}

              {section === 'sistema' && (
                <SystemView
                  telemetry={state.telemetry}
                  settings={state.settings}
                  logs={state.logs}
                  wifiProfiles={state.wifiProfiles}
                  onRefreshState={fetchFullState}
                  onNotify={notify}
                />
              )}

              {section === 'despliegue' && (
                <DeployBackupView
                  appVersion={state.settings.app_version}
                  healthReport={healthReport}
                  onRunHealthCheck={handleRunHealthCheck}
                  onRefreshState={fetchFullState}
                  onNotify={notify}
                />
              )}

              {section === 'ajustes' && authStatus && (
                <SettingsView
                  settings={state.settings}
                  authStatus={authStatus}
                  logs={state.logs}
                  onRefreshState={fetchFullState}
                  onRefreshAuth={fetchAuthStatus}
                  onNotify={notify}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Notificación flotante */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg border text-xs font-medium shadow-lg max-w-sm ${
            toast.isError
              ? 'bg-red-600 border-red-700 text-white'
              : 'bg-slate-900 dark:bg-slate-100 border-slate-800 dark:border-slate-300 text-white dark:text-slate-900'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
