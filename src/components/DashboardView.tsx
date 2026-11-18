import {
  CheckCircle2,
  Monitor,
  PauseCircle,
  Play,
  RotateCcw,
  Square,
  Thermometer,
  Wifi,
  AlertTriangle,
} from 'lucide-react';
import React from 'react';
import type {
  AuditLogEntry,
  HealthCheckReport,
  HostTelemetry,
  PlayerState,
  StandbyConfig,
} from '../types';
import { formatUptime } from '../utils/api';
import type { NavSection } from './Sidebar';

interface DashboardViewProps {
  telemetry: HostTelemetry | null;
  player: PlayerState;
  standby: StandbyConfig;
  logs: AuditLogEntry[];
  healthReport: HealthCheckReport | null;
  onStandby: () => void;
  onStopDisplay: () => void;
  onResumeSchedule: () => void;
  onNavigate: (section: NavSection) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  telemetry,
  player,
  standby,
  logs,
  healthReport,
  onStandby,
  onStopDisplay,
  onResumeSchedule,
  onNavigate,
}) => {
  if (!telemetry) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const ramPct = Math.round((telemetry.ramUsedMb / Math.max(1, telemetry.ramTotalMb)) * 100);
  const swapPct =
    telemetry.swapTotalMb > 0
      ? Math.round((telemetry.swapUsedMb / telemetry.swapTotalMb) * 100)
      : 0;
  const temp = telemetry.cpuTempC;
  const tempState =
    temp === null ? 'Sin sensor' : temp >= 80 ? 'Crítica (Throttling)' : temp >= 72 ? 'Elevada' : 'Óptima';

  return (
    <div className="space-y-6">
      {/* Encabezado de identificación del dispositivo */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{telemetry.hardwareProfile}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{telemetry.osVersion}</span>
          </div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
            {telemetry.deviceName}
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
            <span>IP: {telemetry.localIp}</span>
            <span aria-hidden="true">·</span>
            <span>Host: {telemetry.hostname}</span>
            <span aria-hidden="true">·</span>
            <span>mDNS: http://{telemetry.mdnsAddress}</span>
            <span aria-hidden="true">·</span>
            <span>Activo: {formatUptime(telemetry.uptimeSec)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onResumeSchedule}
            className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Seguir programación</span>
          </button>
          <button
            type="button"
            onClick={onStandby}
            className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <PauseCircle className="w-3.5 h-3.5" />
            <span>Modo espera</span>
          </button>
          <button
            type="button"
            onClick={onStopDisplay}
            className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Square className="w-3.5 h-3.5" />
            <span>Detener pantalla</span>
          </button>
        </div>
      </section>

      {/* Fila KPI Hardware en tiempo real */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Uso y Temperatura CPU</span>
            <Thermometer className="w-4 h-4" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {telemetry.cpuPercent.toFixed(1)}%
            </span>
            <span
              className={`font-mono text-sm font-medium tabular-nums ${
                temp !== null && temp >= 75
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {temp !== null ? `${temp} °C` : 'N/D'} · {tempState}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${Math.min(100, telemetry.cpuPercent)}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Memoria RAM y Swap</span>
            <span className="font-mono tabular-nums">{ramPct}% RAM</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {telemetry.ramUsedMb} MB
            </span>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Libre: {telemetry.ramAvailableMb} / {telemetry.ramTotalMb} MB
            </span>
          </div>
          <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            Swap: {telemetry.swapUsedMb} / {telemetry.swapTotalMb} MB ({swapPct}%)
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Espacio en Disco</span>
            <span className="font-mono tabular-nums">{telemetry.diskUsedPercent}% usado</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {telemetry.diskFreeGb} GB
            </span>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              libres de {telemetry.diskTotalGb} GB
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                telemetry.diskUsedPercent > 85 ? 'bg-amber-600' : 'bg-emerald-600'
              }`}
              style={{ width: `${Math.min(100, telemetry.diskUsedPercent)}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Red y Pantalla HDMI</span>
            <Wifi className="w-4 h-4" />
          </div>
          <div className="flex items-baseline justify-between">
            <span
              className={`text-lg font-semibold ${
                telemetry.networkState === 'online'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {telemetry.networkState === 'online' ? 'Conectado' : 'Sin red local'}
            </span>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {telemetry.resolution}
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
            Orientación: {telemetry.orientation} · SSH {telemetry.sshActive ? 'ON' : 'OFF'} · Samba{' '}
            {telemetry.sambaActive ? 'ON' : 'OFF'}
          </div>
        </div>
      </section>

      {/* Bloque principal: Contenido activo en pantalla + Servicios principales */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Pantalla actual */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Salida HDMI Exclusiva ({player.exclusiveLockOwner})
              </p>
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                {player.title}
              </h3>
            </div>
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-md ${
                player.status === 'playing'
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                  : player.status === 'standby'
                  ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                  : player.status === 'error'
                  ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {player.status === 'playing'
                ? 'Reproduciendo'
                : player.status === 'standby'
                ? 'En espera'
                : player.status === 'error'
                ? 'Error'
                : 'Detenido'}
            </span>
          </div>

          {/* Vista previa representativa de la pantalla conectada */}
          <div className="aspect-video w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 overflow-hidden relative flex flex-col items-center justify-center p-6 text-center">
            {player.contentType === 'images' ? (
              <img
                src="/media/images/campus_atrio.jpg"
                alt="Vista previa de presentación feh"
                referrerPolicy="no-referrer"
                className="absolute inset-0 w-full h-full object-cover opacity-80"
              />
            ) : null}
            <div className="relative z-10 max-w-lg space-y-2 bg-slate-950/75 backdrop-blur-sm px-6 py-4 rounded-lg border border-slate-800">
              <Monitor className="w-6 h-6 mx-auto text-blue-400" />
              <div className="font-display text-base font-semibold">
                {player.contentType === 'standby' ? standby.school_name : player.title}
              </div>
              <div className="text-xs text-slate-300">
                Aplicación activa: <span className="font-mono text-white">{player.activeApp}</span>
              </div>
              <div className="text-xs font-mono text-slate-400 break-all">
                Destino: {player.targetRef}
              </div>
            </div>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-500 dark:text-slate-400">
              <span>
                Origen: {player.source === 'schedule' ? 'Planificador automático' : player.source === 'manual' ? 'Control manual' : 'Pantalla de espera'}
              </span>
              <span className="font-mono tabular-nums">
                Inicio: {new Date(player.startedAt).toLocaleTimeString('es-ES')}
              </span>
            </div>
            <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 overflow-x-auto">
              {player.commandPreview}
            </div>
          </div>
        </div>

        {/* Estado de los 4 servicios principales separados */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Servicios del Sistema (systemd)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Arquitectura desacoplada para tolerancia a fallos en RPi 3B
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('sistema')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Gestionar
            </button>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {telemetry.services.map((svc) => (
              <div key={svc.unit} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {svc.name}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {svc.unit}.service · {svc.role}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`text-xs font-medium ${
                      svc.status === 'active'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {svc.status === 'active' ? 'Activo' : 'Detenido'}
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {svc.memoryMb} MB · {formatUptime(svc.uptimeSec)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Accesos rápidos */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => onNavigate('programacion')}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
            >
              Calendario semanal
            </button>
            <button
              type="button"
              onClick={() => onNavigate('multimedia')}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
            >
              Subir multimedia
            </button>
            <button
              type="button"
              onClick={() => onNavigate('aplicaciones')}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
            >
              Apps y RetroArch
            </button>
            <button
              type="button"
              onClick={() => onNavigate('despliegue')}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
            >
              Paquete Raspberry Pi
            </button>
          </div>
        </div>
      </section>

      {/* Resultado de comprobación global de componentes si fue ejecutada */}
      {healthReport && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {healthReport.overall === 'ok' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              )}
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Resultado de Comprobación Integral de Componentes
              </h3>
            </div>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {new Date(healthReport.checkedAt).toLocaleTimeString('es-ES')}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {healthReport.checks.map((chk) => (
              <div
                key={chk.id}
                className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1 bg-slate-50 dark:bg-slate-950"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {chk.component}
                  </span>
                  <span
                    className={`text-[11px] font-medium ${
                      chk.status === 'ok'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : chk.status === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {chk.status === 'ok' ? 'Correcto' : chk.status === 'warning' ? 'Atención' : 'Error'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">{chk.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Últimos eventos del motor y sistema */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Registro Reciente de Actividad y Planificador
          </h3>
          <button
            type="button"
            onClick={() => onNavigate('sistema')}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Ver logs completos</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4 font-medium">Hora</th>
                <th className="py-2 pr-4 font-medium">Actor</th>
                <th className="py-2 pr-4 font-medium">Categoría</th>
                <th className="py-2 pr-4 font-medium">Estado</th>
                <th className="py-2 font-medium">Mensaje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {logs.slice(0, 6).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 pr-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                    {log.timestamp}
                  </td>
                  <td className="py-2 pr-4 font-mono text-slate-700 dark:text-slate-300">{log.actor}</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">{log.category}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={
                        log.level === 'error'
                          ? 'text-red-600 dark:text-red-400 font-medium'
                          : log.level === 'warning'
                          ? 'text-amber-600 dark:text-amber-400 font-medium'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }
                    >
                      {log.level}
                    </span>
                  </td>
                  <td className="py-2 text-slate-800 dark:text-slate-200">{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
