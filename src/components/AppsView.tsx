import { Edit2, Play, Plus, ShieldCheck, Square, Trash2, X } from 'lucide-react';
import React, { useState } from 'react';
import type { AuthorizedApp, OnFinishAction, PlayerState } from '../types';
import { apiRequest } from '../utils/api';

interface AppsViewProps {
  apps: AuthorizedApp[];
  player: PlayerState;
  onAppsChange: (rows: AuthorizedApp[]) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const AppsView: React.FC<AppsViewProps> = ({
  apps,
  player,
  onAppsChange,
  onNotify,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AuthorizedApp | null>(null);
  const [form, setForm] = useState({
    name: '',
    binary_path: '/usr/bin/',
    args: '--fullscreen',
    display_mode: 'fullscreen' as 'fullscreen' | 'windowed',
    default_duration_min: 30,
    on_finish_action: 'standby' as OnFinishAction,
    rpi3b_compatible: true,
    ram_profile: 'low' as 'low' | 'medium' | 'high',
    enabled: true,
    description: '',
  });

  const openNew = () => {
    setEditing(null);
    setForm({
      name: '',
      binary_path: '/usr/bin/',
      args: '--fullscreen',
      display_mode: 'fullscreen',
      default_duration_min: 30,
      on_finish_action: 'standby',
      rpi3b_compatible: true,
      ram_profile: 'low',
      enabled: true,
      description: '',
    });
    setModalOpen(true);
  };

  const openEdit = (app: AuthorizedApp) => {
    setEditing(app);
    setForm({
      name: app.name,
      binary_path: app.binary_path,
      args: app.args,
      display_mode: app.display_mode,
      default_duration_min: app.default_duration_min,
      on_finish_action: app.on_finish_action,
      rpi3b_compatible: app.rpi3b_compatible === 1,
      ram_profile: app.ram_profile,
      enabled: app.enabled === 1,
      description: app.description,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        const res = await apiRequest<{ apps: AuthorizedApp[] }>(`/api/apps/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
        onAppsChange(res.apps);
        onNotify(`Aplicación "${form.name}" actualizada.`);
      } else {
        const res = await apiRequest<{ apps: AuthorizedApp[] }>('/api/apps', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        onAppsChange(res.apps);
        onNotify(`Aplicación autorizada "${form.name}" registrada.`);
      }
      setModalOpen(false);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error guardando aplicación', true);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await apiRequest<{ apps: AuthorizedApp[] }>(`/api/apps/${id}`, {
        method: 'DELETE',
      });
      onAppsChange(res.apps);
      onNotify('Aplicación eliminada del catálogo.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error eliminando aplicación', true);
    }
  };

  const handleLaunch = async (app: AuthorizedApp) => {
    try {
      await apiRequest('/api/player/play', {
        method: 'POST',
        body: JSON.stringify({
          title: app.name,
          contentType: 'app',
          targetRef: String(app.id),
          durationMin: app.default_duration_min,
          config: { displayMode: app.display_mode },
        }),
      });
      onNotify(`Iniciando ${app.name} en pantalla completa (duración ${app.default_duration_min} min).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error lanzando aplicación', true);
    }
  };

  const handleStopRemote = async () => {
    try {
      await apiRequest('/api/player/resume-schedule', { method: 'POST' });
      onNotify('Aplicación detenida; control devuelto al motor de planificación.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error deteniendo aplicación', true);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            Catálogo Seguro de Aplicaciones Linux y RetroArch
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Por seguridad, el navegador nunca ejecuta comandos arbitrarios. Solo los binarios registrados aquí pueden lanzarse mediante <span className="font-mono">exec</span> directo.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {player.contentType === 'app' && player.status === 'playing' && (
            <button
              type="button"
              onClick={handleStopRemote}
              className="px-3.5 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Detener app activa</span>
            </button>
          )}
          <button
            type="button"
            onClick={openNew}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Añadir aplicación</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {apps.map((app) => {
          const isRunning =
            player.contentType === 'app' &&
            player.status === 'playing' &&
            (player.targetRef === String(app.id) || player.activeApp === app.name);

          return (
            <div
              key={app.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {app.name}
                  </h3>
                  <span
                    className={`text-[11px] font-medium ${
                      app.rpi3b_compatible === 1
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {app.rpi3b_compatible === 1 ? 'Apta RPi 3B' : 'Exige Swap'}
                  </span>
                </div>

                <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 break-all">
                  {app.binary_path} {app.args}
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {app.description || 'Sin descripción adicional.'}
                </p>

                <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-2">
                  <span>Modo: {app.display_mode === 'fullscreen' ? 'Pantalla completa' : 'Ventana'}</span>
                  <span aria-hidden="true">·</span>
                  <span>Duración: {app.default_duration_min} min</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    RAM: {app.ram_profile === 'low' ? 'Baja' : app.ram_profile === 'medium' ? 'Media' : 'Alta'}
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                {isRunning ? (
                  <button
                    type="button"
                    onClick={handleStopRemote}
                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium flex items-center gap-1.5"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Detener ahora</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={app.enabled === 0}
                    onClick={() => handleLaunch(app)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Ejecutar</span>
                  </button>
                )}

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(app)}
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                    title="Editar aplicación"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(app.id)}
                    className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400"
                    title="Eliminar aplicación"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  {editing ? 'Editar aplicación autorizada' : 'Registrar aplicación autorizada'}
                </h3>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Nombre visible</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej. RetroArch"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Ruta absoluta del binario
                  </label>
                  <input
                    type="text"
                    required
                    value={form.binary_path}
                    onChange={(e) => setForm({ ...form, binary_path: e.target.value })}
                    placeholder="/usr/bin/retroarch"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Argumentos</label>
                  <input
                    type="text"
                    value={form.args}
                    onChange={(e) => setForm({ ...form, args: e.target.value })}
                    placeholder="--fullscreen"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Modo pantalla</label>
                  <select
                    value={form.display_mode}
                    onChange={(e) => setForm({ ...form, display_mode: e.target.value as 'fullscreen' | 'windowed' })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="fullscreen">Completa</option>
                    <option value="windowed">Normal</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Duración (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={form.default_duration_min}
                    onChange={(e) => setForm({ ...form, default_duration_min: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Perfil RAM</label>
                  <select
                    value={form.ram_profile}
                    onChange={(e) => setForm({ ...form, ram_profile: e.target.value as 'low' | 'medium' | 'high' })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="low">Bajo (&lt;100 MB)</option>
                    <option value="medium">Medio (100-300 MB)</option>
                    <option value="high">Alto (&gt;350 MB)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Descripción</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.rpi3b_compatible}
                    onChange={(e) => setForm({ ...form, rpi3b_compatible: e.target.checked })}
                  />
                  <span>Compatible con Raspberry Pi 3B (1 GB RAM)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  />
                  <span>Habilitada</span>
                </label>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700"
                >
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
