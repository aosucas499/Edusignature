import { Power, RefreshCw, RotateCcw, Shield, Terminal, Wifi } from 'lucide-react';
import React, { useState } from 'react';
import type { AuditLogEntry, HostTelemetry, SystemSettings } from '../types';
import { apiRequest } from '../utils/api';

interface SystemViewProps {
  telemetry: HostTelemetry | null;
  settings: SystemSettings;
  logs: AuditLogEntry[];
  wifiProfiles: Array<{ id: number; ssid: string; security: string; signal: number; connected: number }>;
  onRefreshState: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const SystemView: React.FC<SystemViewProps> = ({
  telemetry,
  settings,
  logs,
  wifiProfiles,
  onRefreshState,
  onNotify,
}) => {
  const [hostnameInput, setHostnameInput] = useState(settings.hostname || 'edusignage');
  const [resolutionInput, setResolutionInput] = useState(settings.resolution || '1920x1080');
  const [orientationInput, setOrientationInput] = useState(settings.orientation || 'normal');
  const [timezoneInput, setTimezoneInput] = useState(settings.timezone || 'Europe/Madrid');
  const [swapInput, setSwapInput] = useState(Number(settings.swap_mb || 1024));
  const [scannedWifi, setScannedWifi] = useState(wifiProfiles);
  const [wifiModal, setWifiModal] = useState<{ ssid: string; security: string } | null>(null);
  const [wifiPassword, setWifiPassword] = useState('');
  const [powerConfirm, setPowerConfirm] = useState<'reboot' | 'shutdown' | null>(null);

  const toggleSsh = async () => {
    const next = !(telemetry?.sshActive ?? settings.ssh_enabled === 'true');
    try {
      await apiRequest('/api/system/ssh', {
        method: 'POST',
        body: JSON.stringify({ enabled: next }),
      });
      onNotify(`SSH ${next ? 'habilitado' : 'deshabilitado'} mediante helper autorizado.`);
      onRefreshState();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error cambiando SSH', true);
    }
  };

  const saveHostname = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/system/hostname', {
        method: 'POST',
        body: JSON.stringify({ hostname: hostnameInput }),
      });
      onNotify(`Hostname actualizado a ${hostnameInput} (${hostnameInput}.local).`);
      onRefreshState();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error cambiando hostname', true);
    }
  };

  const saveDisplay = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/system/display', {
        method: 'POST',
        body: JSON.stringify({ resolution: resolutionInput, orientation: orientationInput }),
      });
      onNotify(`Pantalla X11 configurada: ${resolutionInput} (${orientationInput}).`);
      onRefreshState();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error configurando pantalla', true);
    }
  };

  const saveTimezoneAndSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/system/timezone', {
        method: 'POST',
        body: JSON.stringify({ timezone: timezoneInput }),
      });
      await apiRequest('/api/system/swap', {
        method: 'POST',
        body: JSON.stringify({ swap_mb: swapInput }),
      });
      onNotify(`Zona horaria (${timezoneInput}) y Swap (${swapInput} MB) aplicadas.`);
      onRefreshState();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error guardando configuración OS', true);
    }
  };

  const controlService = async (unit: string, action: 'start' | 'stop' | 'restart') => {
    try {
      await apiRequest('/api/system/service', {
        method: 'POST',
        body: JSON.stringify({ unit, action }),
      });
      onNotify(`Servicio ${unit}: ${action} ejecutado.`);
      onRefreshState();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error controlando servicio', true);
    }
  };

  const scanWifi = async () => {
    try {
      const res = await apiRequest<{ networks: typeof scannedWifi }>('/api/system/wifi/scan', {
        method: 'POST',
      });
      setScannedWifi(res.networks);
      onNotify('Escaneo de redes WiFi completado.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error escaneando WiFi', true);
    }
  };

  const connectWifi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wifiModal) return;
    try {
      const res = await apiRequest<{ profiles: typeof scannedWifi }>('/api/system/wifi/connect', {
        method: 'POST',
        body: JSON.stringify({
          ssid: wifiModal.ssid,
          security: wifiModal.security,
          password: wifiPassword,
        }),
      });
      setScannedWifi(res.profiles);
      setWifiModal(null);
      setWifiPassword('');
      onNotify(`Conectado al perfil WiFi ${wifiModal.ssid}.`);
      onRefreshState();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error configurando WiFi', true);
    }
  };

  const executePowerAction = async (action: 'reboot' | 'shutdown') => {
    try {
      const res = await apiRequest<{ message: string }>('/api/system/power', {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setPowerConfirm(null);
      onNotify(res.message);
      onRefreshState();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error ejecutando acción de energía', true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner seguridad privilege separation */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-blue-600 shrink-0" />
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Separación de Privilegios Activa (edusignage-system-helper)
            </div>
            <div className="text-slate-500 dark:text-slate-400">
              El backend web no se ejecuta como root. Todas las operaciones del sistema pasan por una lista blanca estricta sin acceso a shell.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setPowerConfirm('reboot')}
            className="px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-medium flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reiniciar Pi</span>
          </button>
          <button
            type="button"
            onClick={() => setPowerConfirm('shutdown')}
            className="px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5"
          >
            <Power className="w-3.5 h-3.5" />
            <span>Apagar Pi</span>
          </button>
        </div>
      </div>

      {/* Grid de Controles del Sistema */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SSH + Hostname */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Acceso SSH y Nombre de Host (mDNS)
              </h3>
              <p className="text-slate-500 dark:text-slate-400">
                SSH desactivado hacia Internet por defecto; solo accesible en red local.
              </p>
            </div>
            <button
              type="button"
              onClick={toggleSsh}
              className={`px-3 py-1.5 rounded-lg font-medium ${
                telemetry?.sshActive
                  ? 'bg-emerald-600 text-white'
                  : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
              }`}
            >
              SSH: {telemetry?.sshActive ? 'Activo' : 'Desactivado'}
            </button>
          </div>

          <form onSubmit={saveHostname} className="flex gap-2">
            <input
              type="text"
              value={hostnameInput}
              onChange={(e) => setHostnameInput(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
            />
            <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium">
              Aplicar hostname
            </button>
          </form>

          {/* Interfaces IP reales */}
          <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="font-medium text-slate-700 dark:text-slate-300">Interfaces de red detectadas</div>
            {telemetry?.networkInterfaces.map((ifc) => (
              <div key={`${ifc.name}-${ifc.ip}`} className="flex justify-between font-mono text-slate-600 dark:text-slate-400">
                <span>{ifc.name}</span>
                <span>{ifc.ip} · {ifc.mac}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Pantalla X11, Zona Horaria y Swap RPi 3B */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Pantalla HDMI (X11), Zona Horaria y Swap RPi 3B
          </h3>

          <form onSubmit={saveDisplay} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={resolutionInput}
              onChange={(e) => setResolutionInput(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
            >
              <option value="1920x1080">1920x1080 (Full HD)</option>
              <option value="1280x720">1280x720 (HD 720p)</option>
              <option value="1366x768">1366x768</option>
              <option value="1024x768">1024x768</option>
            </select>
            <select
              value={orientationInput}
              onChange={(e) => setOrientationInput(e.target.value as SystemSettings['orientation'])}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="normal">Horizontal (0°)</option>
              <option value="left">Vertical izquierda (90°)</option>
              <option value="right">Vertical derecha (270°)</option>
              <option value="inverted">Invertida (180°)</option>
            </select>
            <button type="submit" className="px-3 py-2 rounded-lg bg-blue-600 text-white font-medium">
              Aplicar HDMI
            </button>
          </form>

          <form onSubmit={saveTimezoneAndSwap} className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <select
              value={timezoneInput}
              onChange={(e) => setTimezoneInput(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
            >
              <option value="Europe/Madrid">Europe/Madrid</option>
              <option value="Atlantic/Canary">Atlantic/Canary</option>
              <option value="Europe/London">Europe/London</option>
              <option value="America/Mexico_City">America/Mexico_City</option>
              <option value="America/Argentina/Buenos_Aires">America/Buenos_Aires</option>
              <option value="UTC">UTC</option>
            </select>
            <select
              value={swapInput}
              onChange={(e) => setSwapInput(Number(e.target.value))}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
            >
              <option value={256}>Swap 256 MB</option>
              <option value={512}>Swap 512 MB</option>
              <option value={1024}>Swap 1024 MB (Rec. RPi 3B)</option>
              <option value={2048}>Swap 2048 MB</option>
            </select>
            <button type="submit" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 font-medium hover:bg-slate-100 dark:hover:bg-slate-800">
              Guardar OS/Swap
            </button>
          </form>
        </section>
      </div>

      {/* WiFi + Servicios Systemd */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold flex items-center gap-2">
              <Wifi className="w-4 h-4 text-blue-600" />
              <span>Redes WiFi (nmcli)</span>
            </h3>
            <button
              type="button"
              onClick={scanWifi}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Escanear</span>
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {scannedWifi.map((net) => (
              <div key={net.ssid} className="py-2.5 flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">{net.ssid}</div>
                  <div className="font-mono text-[11px] text-slate-500">
                    {net.security} · Señal {net.signal}%
                  </div>
                </div>
                {net.connected === 1 ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">Conectada</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setWifiModal({ ssid: net.ssid, security: net.security })}
                    className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Conectar
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
          <h3 className="font-display text-sm font-semibold">Control de Servicios systemd Autorizados</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Servicio</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 pr-3 font-medium">RAM</th>
                  <th className="py-2 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {telemetry?.services.map((svc) => (
                  <tr key={svc.unit}>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{svc.unit}.service</div>
                      <div className="text-slate-500">{svc.role}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={
                          svc.status === 'active'
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : 'text-red-600 dark:text-red-400 font-medium'
                        }
                      >
                        {svc.status === 'active' ? 'Activo' : 'Detenido'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums">{svc.memoryMb} MB</td>
                    <td className="py-2.5 text-right whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        onClick={() => controlService(svc.unit, 'start')}
                        className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Iniciar
                      </button>
                      <button
                        type="button"
                        onClick={() => controlService(svc.unit, 'restart')}
                        className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Reiniciar
                      </button>
                      {svc.unit !== 'edusignage-web' && (
                        <button
                          type="button"
                          onClick={() => controlService(svc.unit, 'stop')}
                          className="px-2 py-1 rounded border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400"
                        >
                          Detener
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Procesos reales y Logs del sistema */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
          <h3 className="font-display text-sm font-semibold">Procesos Activos del Sistema (Top RSS)</h3>
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left font-mono">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-1.5 pr-2">PID</th>
                  <th className="py-1.5 pr-2">Proceso</th>
                  <th className="py-1.5 pr-2 text-right">CPU%</th>
                  <th className="py-1.5 text-right">RSS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 tabular-nums">
                {telemetry?.processes.map((p) => (
                  <tr key={p.pid}>
                    <td className="py-1.5 pr-2 text-slate-500">{p.pid}</td>
                    <td className="py-1.5 pr-2 truncate max-w-[140px]">{p.command}</td>
                    <td className="py-1.5 pr-2 text-right">{p.cpu.toFixed(1)}</td>
                    <td className="py-1.5 text-right">{p.rssMb} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
          <h3 className="font-display text-sm font-semibold flex items-center gap-2">
            <Terminal className="w-4 h-4 text-blue-600" />
            <span>Registros de Auditoría y Sistema</span>
          </h3>
          <div className="max-h-72 overflow-y-auto space-y-1.5 font-mono text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
            {logs.map((l) => (
              <div key={l.id} className="flex gap-2">
                <span className="text-slate-400 shrink-0 tabular-nums">{l.timestamp}</span>
                <span className="text-blue-600 dark:text-blue-400 shrink-0">[{l.category}]</span>
                <span className="text-slate-800 dark:text-slate-200">{l.message}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Modal contraseña WiFi */}
      {wifiModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={connectWifi}
            className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs"
          >
            <h3 className="font-display text-sm font-semibold">Conectar a {wifiModal.ssid}</h3>
            <input
              type="password"
              required
              placeholder="Contraseña WiFi"
              value={wifiPassword}
              onChange={(e) => setWifiPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setWifiModal(null)} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700">
                Cancelar
              </button>
              <button type="submit" className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium">
                Conectar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmación Reinicio / Apagado */}
      {powerConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs">
            <h3 className="font-display text-sm font-semibold">
              {powerConfirm === 'reboot' ? 'Confirmar reinicio de Raspberry Pi' : 'Confirmar apagado de Raspberry Pi'}
            </h3>
            <p className="text-slate-600 dark:text-slate-400">
              {powerConfirm === 'reboot'
                ? 'La pantalla se interrumpirá brevemente y el planificador retomará la programación automáticamente tras el arranque.'
                : 'El dispositivo se apagará de forma ordenada. Requerirá reconexión eléctrica para volver a encenderse.'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPowerConfirm(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => executePowerAction(powerConfirm)}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
