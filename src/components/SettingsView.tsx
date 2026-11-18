import { KeyRound, Save, ShieldCheck, ShieldOff } from 'lucide-react';
import React, { useState } from 'react';
import type { AuditLogEntry, AuthStatus, SystemSettings } from '../types';
import { apiRequest } from '../utils/api';

interface SettingsViewProps {
  settings: SystemSettings;
  authStatus: AuthStatus;
  logs: AuditLogEntry[];
  onRefreshState: () => void;
  onRefreshAuth: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  authStatus,
  logs,
  onRefreshState,
  onRefreshAuth,
  onNotify,
}) => {
  const [form, setForm] = useState({
    device_name: settings.device_name,
    hostname: settings.hostname,
    web_port: settings.web_port,
    media_root: settings.media_root,
    samba_enabled: settings.samba_enabled === 'true',
    ssh_enabled: settings.ssh_enabled === 'true',
    mdns_enabled: settings.mdns_enabled === 'true',
    boot_autostart: settings.boot_autostart === 'true',
  });

  const [secForm, setSecForm] = useState({
    username: authStatus.username || 'admin',
    password: '',
    authEnabled: authStatus.authEnabled,
  });

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          device_name: form.device_name,
          hostname: form.hostname,
          web_port: form.web_port,
          media_root: form.media_root,
          samba_enabled: String(form.samba_enabled),
          ssh_enabled: String(form.ssh_enabled),
          mdns_enabled: String(form.mdns_enabled),
          boot_autostart: String(form.boot_autostart),
        }),
      });
      onNotify('Configuración general guardada en SQLite.');
      onRefreshState();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error guardando ajustes', true);
    }
  };

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/auth/configure', {
        method: 'POST',
        body: JSON.stringify({
          username: secForm.username,
          password: secForm.password,
          authEnabled: secForm.authEnabled,
        }),
      });
      setSecForm((prev) => ({ ...prev, password: '' }));
      onNotify(
        secForm.authEnabled
          ? 'Bloqueo de seguridad activado. Todas las rutas administrativas están protegidas.'
          : 'Bloqueo por contraseña desactivado (acceso directo en red local).'
      );
      onRefreshAuth();
      onRefreshState();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error configurando seguridad', true);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuración General */}
        <form
          onSubmit={handleSaveGeneral}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 text-xs"
        >
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Configuración General del Dispositivo
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Nombre del dispositivo
              </label>
              <input
                type="text"
                value={form.device_name}
                onChange={(e) => setForm({ ...form, device_name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Puerto web (Raspberry Pi)
              </label>
              <input
                type="number"
                value={form.web_port}
                onChange={(e) => setForm({ ...form, web_port: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Directorio raíz multimedia
            </label>
            <input
              type="text"
              value={form.media_root}
              onChange={(e) => setForm({ ...form, media_root: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1 text-slate-700 dark:text-slate-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.samba_enabled}
                onChange={(e) => setForm({ ...form, samba_enabled: e.target.checked })}
              />
              <span>Activar carpeta Samba</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.mdns_enabled}
                onChange={(e) => setForm({ ...form, mdns_enabled: e.target.checked })}
              />
              <span>Activar Avahi mDNS (.local)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.ssh_enabled}
                onChange={(e) => setForm({ ...form, ssh_enabled: e.target.checked })}
              />
              <span>Activar servicio SSH local</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.boot_autostart}
                onChange={(e) => setForm({ ...form, boot_autostart: e.target.checked })}
              />
              <span>Arranque automático directo en pantalla</span>
            </label>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Guardar configuración</span>
            </button>
          </div>
        </form>

        {/* Seguridad y Control de Acceso Opcional */}
        <form
          onSubmit={handleSaveSecurity}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {secForm.authEnabled ? (
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
              ) : (
                <ShieldOff className="w-5 h-5 text-slate-400" />
              )}
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Seguridad y Bloqueo de Panel
                </h3>
                <p className="text-slate-500 dark:text-slate-400">
                  {authStatus.authEnabled
                    ? 'Protegido con usuario, contraseña (scrypt) y cookie de sesión HttpOnly.'
                    : 'Acceso directo activo. Activa el bloqueo para exigir contraseña en la red local.'}
                </p>
              </div>
            </div>
          </div>

          <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 cursor-pointer">
            <span className="font-medium text-slate-900 dark:text-slate-100">
              Exigir inicio de sesión para administrar EduSignage Pi
            </span>
            <input
              type="checkbox"
              checked={secForm.authEnabled}
              onChange={(e) => setSecForm({ ...secForm, authEnabled: e.target.checked })}
              className="w-4 h-4"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Usuario administrador
              </label>
              <input
                type="text"
                value={secForm.username}
                onChange={(e) => setSecForm({ ...secForm, username: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                {authStatus.hasAdminUser ? 'Nueva contraseña (dejar vacío para mantener)' : 'Contraseña inicial (mín. 6 caract.)'}
              </label>
              <input
                type="password"
                value={secForm.password}
                onChange={(e) => setSecForm({ ...secForm, password: e.target.value })}
                placeholder="••••••"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-1.5"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Aplicar política de seguridad</span>
            </button>
          </div>
        </form>
      </div>

      {/* Auditoría de acciones administrativas */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
          Registro de Auditoría de Acciones Administrativas
        </h3>
        <div className="overflow-x-auto max-h-64">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 pr-3 font-medium">Fecha/Hora</th>
                <th className="py-2 pr-3 font-medium">Usuario</th>
                <th className="py-2 pr-3 font-medium">Categoría</th>
                <th className="py-2 font-medium">Acción registrada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3 font-mono text-slate-500 tabular-nums whitespace-nowrap">{l.timestamp}</td>
                  <td className="py-2 pr-3 font-mono">{l.actor}</td>
                  <td className="py-2 pr-3 text-slate-500">{l.category}</td>
                  <td className="py-2 text-slate-800 dark:text-slate-200">{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
