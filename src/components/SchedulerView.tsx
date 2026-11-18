import { Calendar, Edit2, Play, Plus, Trash2, X } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import type { AuthorizedApp, ContentType, OnFinishAction, RecurrenceMode, ScheduleRule } from '../types';
import { apiRequest } from '../utils/api';

interface SchedulerViewProps {
  schedules: ScheduleRule[];
  apps: AuthorizedApp[];
  onSchedulesChange: (rows: ScheduleRule[]) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

const WEEKDAYS = [
  { id: '1', short: 'Lun', full: 'Lunes' },
  { id: '2', short: 'Mar', full: 'Martes' },
  { id: '3', short: 'Mié', full: 'Miércoles' },
  { id: '4', short: 'Jue', full: 'Jueves' },
  { id: '5', short: 'Vie', full: 'Viernes' },
  { id: '6', short: 'Sáb', full: 'Sábado' },
  { id: '7', short: 'Dom', full: 'Domingo' },
];

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 07:00 .. 21:00

const TYPE_STYLES: Record<ContentType, string> = {
  web: 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-800 text-blue-900 dark:text-blue-200',
  images: 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200',
  video: 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200',
  app: 'bg-violet-50 dark:bg-violet-950/60 border-violet-300 dark:border-violet-800 text-violet-900 dark:text-violet-200',
  standby: 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200',
};

const TYPE_LABELS: Record<ContentType, string> = {
  web: 'Página Web',
  images: 'Imágenes (feh)',
  video: 'Vídeo (mpv)',
  app: 'App Linux',
  standby: 'Espera',
};

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHhmm(mins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const SchedulerView: React.FC<SchedulerViewProps> = ({
  schedules,
  apps,
  onSchedulesChange,
  onNotify,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draggingRule, setDraggingRule] = useState<{ id: number; fromDay: string } | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  const [form, setForm] = useState({
    name: '',
    content_type: 'web' as ContentType,
    target_ref: 'https://campus.centroeducativo.local',
    start_time: '08:00',
    end_time: '09:00',
    days: ['1', '2', '3', '4', '5'] as string[],
    start_date: '',
    end_date: '',
    recurrence_mode: 'weekly' as RecurrenceMode,
    priority: 10,
    enabled: true,
    on_finish_action: 'standby' as OnFinishAction,
    browser: 'chromium',
    intervalSec: 8,
    volume: 80,
  });

  const openCreateModal = (dayId?: string, hour?: number) => {
    const startH = hour ?? 8;
    const endH = Math.min(23, startH + 1);
    setEditingId(null);
    setForm({
      name: '',
      content_type: 'web',
      target_ref: 'https://',
      start_time: `${String(startH).padStart(2, '0')}:00`,
      end_time: `${String(endH).padStart(2, '0')}:00`,
      days: dayId ? [dayId] : ['1', '2', '3', '4', '5'],
      start_date: '',
      end_date: '',
      recurrence_mode: 'weekly',
      priority: 10,
      enabled: true,
      on_finish_action: 'standby',
      browser: 'chromium',
      intervalSec: 8,
      volume: 80,
    });
    setModalOpen(true);
  };

  const openEditModal = (rule: ScheduleRule) => {
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(rule.config_json || '{}');
    } catch {
      cfg = {};
    }
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      content_type: rule.content_type,
      target_ref: rule.target_ref,
      start_time: rule.start_time,
      end_time: rule.end_time,
      days: rule.days_of_week.split(',').map((d) => d.trim()).filter(Boolean),
      start_date: rule.start_date || '',
      end_date: rule.end_date || '',
      recurrence_mode: rule.recurrence_mode,
      priority: rule.priority,
      enabled: rule.enabled === 1,
      on_finish_action: rule.on_finish_action,
      browser: String(cfg.browser || 'chromium'),
      intervalSec: Number(cfg.intervalSec || 8),
      volume: Number(cfg.volume ?? 80),
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const configObj =
      form.content_type === 'web'
        ? { browser: form.browser, kiosk: true, hideNav: true, disableScreensaver: true, keepScreenOn: true }
        : form.content_type === 'images'
        ? { intervalSec: form.intervalSec, loop: true, keepAspect: true }
        : form.content_type === 'video'
        ? { volume: form.volume, loop: true }
        : {};

    const payload = {
      name: form.name,
      content_type: form.content_type,
      target_ref: form.target_ref,
      config_json: JSON.stringify(configObj),
      start_time: form.start_time,
      end_time: form.end_time,
      days_of_week: form.days.join(','),
      start_date: form.start_date,
      end_date: form.end_date,
      recurrence_mode: form.recurrence_mode,
      priority: form.priority,
      enabled: form.enabled,
      on_finish_action: form.on_finish_action,
    };

    try {
      if (editingId) {
        const res = await apiRequest<{ schedules: ScheduleRule[] }>(`/api/schedules/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onSchedulesChange(res.schedules);
        onNotify('Programación horaria actualizada en SQLite.');
      } else {
        const res = await apiRequest<{ schedules: ScheduleRule[] }>('/api/schedules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onSchedulesChange(res.schedules);
        onNotify('Nueva franja horaria guardada y evaluada.');
      }
      setModalOpen(false);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error guardando programación', true);
    }
  };

  const handleToggleRule = async (rule: ScheduleRule) => {
    try {
      const res = await apiRequest<{ schedules: ScheduleRule[] }>(`/api/schedules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: rule.enabled === 1 ? 0 : 1 }),
      });
      onSchedulesChange(res.schedules);
      onNotify(`Regla "${rule.name}" ${rule.enabled === 1 ? 'desactivada' : 'activada'}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error cambiando estado', true);
    }
  };

  const handleDeleteRule = async (id: number) => {
    try {
      const res = await apiRequest<{ schedules: ScheduleRule[] }>(`/api/schedules/${id}`, {
        method: 'DELETE',
      });
      onSchedulesChange(res.schedules);
      onNotify('Programación eliminada.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error eliminando programación', true);
    }
  };

  const handleTestPlay = async (rule: ScheduleRule) => {
    try {
      let config = {};
      try {
        config = JSON.parse(rule.config_json || '{}');
      } catch {
        config = {};
      }
      await apiRequest('/api/player/play', {
        method: 'POST',
        body: JSON.stringify({
          title: rule.name,
          contentType: rule.content_type,
          targetRef: rule.target_ref,
          config,
          durationMin: 15,
        }),
      });
      onNotify(`Ejecutando "${rule.name}" en pantalla (15 min prueba).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error lanzando contenido', true);
    }
  };

  const handleDropOnCell = async (targetDay: string, targetHour: number) => {
    if (!draggingRule) return;
    const rule = schedules.find((s) => s.id === draggingRule.id);
    if (!rule) return;

    const durationMins = Math.max(30, hhmmToMinutes(rule.end_time) - hhmmToMinutes(rule.start_time));
    const newStart = `${String(targetHour).padStart(2, '0')}:00`;
    const newEnd = minutesToHhmm(targetHour * 60 + durationMins);

    const existingDays = rule.days_of_week.split(',').map((d) => d.trim()).filter(Boolean);
    let nextDays = existingDays;
    if (!existingDays.includes(targetDay)) {
      if (existingDays.length === 1 && existingDays[0] === draggingRule.fromDay) {
        nextDays = [targetDay];
      } else {
        nextDays = Array.from(new Set([...existingDays.filter((d) => d !== draggingRule.fromDay), targetDay])).sort();
      }
    }

    try {
      const res = await apiRequest<{ schedules: ScheduleRule[] }>(`/api/schedules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          start_time: newStart,
          end_time: newEnd,
          days_of_week: nextDays.join(','),
        }),
      });
      onSchedulesChange(res.schedules);
      onNotify(`Horario movido: ${rule.name} (${newStart}–${newEnd})`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error moviendo franja', true);
    } finally {
      setDraggingRule(null);
    }
  };

  const filteredRules = useMemo(
    () => (filterType === 'all' ? schedules : schedules.filter((s) => s.content_type === filterType)),
    [schedules, filterType]
  );

  return (
    <div className="space-y-6">
      {/* Barra de acciones */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            Calendario Semanal y Reglas Automáticas
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Arrastra los bloques entre días y horas o haz clic en cualquier hueco libre para programar contenido.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">
            {(['all', 'web', 'images', 'video', 'app'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterType(t)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                  filterType === t
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {t === 'all' ? 'Todos' : TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => openCreateModal()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva programación</span>
          </button>
        </div>
      </div>

      {/* Rejilla Semanal Drag & Drop */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="grid grid-cols-8 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-600 dark:text-slate-300">
            <div className="p-3 border-r border-slate-200 dark:border-slate-800 font-mono">Hora</div>
            {WEEKDAYS.map((day) => (
              <div key={day.id} className="p-3 text-center border-r last:border-r-0 border-slate-200 dark:border-slate-800">
                {day.full}
              </div>
            ))}
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            {HOURS.map((hour) => {
              const hourLabel = `${String(hour).padStart(2, '0')}:00`;
              return (
                <div key={hour} className="grid grid-cols-8 min-h-[54px]">
                  <div className="px-3 py-2 border-r border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {hourLabel}
                  </div>
                  {WEEKDAYS.map((day) => {
                    const cellRules = filteredRules.filter((rule) => {
                      const days = rule.days_of_week.split(',').map((d) => d.trim());
                      const appliesDay = rule.recurrence_mode === 'daily' || days.includes(day.id);
                      if (!appliesDay) return false;
                      const startHour = Number(rule.start_time.split(':')[0]);
                      return startHour === hour;
                    });

                    return (
                      <div
                        key={day.id}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDropOnCell(day.id, hour)}
                        onClick={() => {
                          if (cellRules.length === 0) openCreateModal(day.id, hour);
                        }}
                        className="p-1 border-r last:border-r-0 border-slate-100 dark:border-slate-800/70 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors cursor-pointer space-y-1"
                      >
                        {cellRules.map((rule) => (
                          <div
                            key={rule.id}
                            draggable
                            onDragStart={(e) => {
                              e.stopPropagation();
                              setDraggingRule({ id: rule.id, fromDay: day.id });
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(rule);
                            }}
                            className={`rounded-md border px-2 py-1 text-[11px] leading-tight cursor-grab active:cursor-grabbing ${
                              TYPE_STYLES[rule.content_type]
                            } ${rule.enabled === 0 ? 'opacity-45' : ''}`}
                            title="Arrastra para mover de día/hora o haz clic para editar"
                          >
                            <div className="font-semibold truncate">{rule.name}</div>
                            <div className="font-mono text-[10px] opacity-80 tabular-nums">
                              {rule.start_time}–{rule.end_time} · P{rule.priority}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Tabla detallada de reglas */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-600" />
            <span>Listado de Reglas Persistidas en SQLite ({filteredRules.length})</span>
          </h3>
        </div>

        {filteredRules.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No hay programaciones para este filtro.
            </p>
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium"
            >
              Crear primera regla
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 font-medium">Contenido</th>
                  <th className="py-2 pr-3 font-medium">Tipo</th>
                  <th className="py-2 pr-3 font-medium">Horario</th>
                  <th className="py-2 pr-3 font-medium">Días</th>
                  <th className="py-2 pr-3 font-medium">Prioridad</th>
                  <th className="py-2 pr-3 font-medium">Al terminar</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {filteredRules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{rule.name}</div>
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs">
                        {rule.target_ref}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{TYPE_LABELS[rule.content_type]}</td>
                    <td className="py-2.5 pr-3 font-mono whitespace-nowrap tabular-nums">
                      {rule.start_time} – {rule.end_time}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-slate-600 dark:text-slate-300">
                      {rule.recurrence_mode === 'daily'
                        ? 'Diario'
                        : rule.days_of_week
                            .split(',')
                            .map((d) => WEEKDAYS.find((w) => w.id === d.trim())?.short || d)
                            .join(', ')}
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums">{rule.priority}</td>
                    <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">{rule.on_finish_action}</td>
                    <td className="py-2.5 pr-3">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(rule)}
                        className={`text-xs font-medium ${
                          rule.enabled === 1
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {rule.enabled === 1 ? 'Activada' : 'Pausada'}
                      </button>
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleTestPlay(rule)}
                          className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-blue-600 dark:text-blue-400"
                          title="Probar ahora en pantalla"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(rule)}
                          className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                          title="Editar regla"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRule(rule.id)}
                          className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400"
                          title="Eliminar regla"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal Formulario de Programación */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingId ? 'Editar programación horaria' : 'Nueva programación horaria'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nombre del contenido
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej. Web del Colegio"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tipo de contenido
                  </label>
                  <select
                    value={form.content_type}
                    onChange={(e) => {
                      const nextType = e.target.value as ContentType;
                      const defaultTarget =
                        nextType === 'images'
                          ? 'images'
                          : nextType === 'video'
                          ? 'videos'
                          : nextType === 'app'
                          ? String(apps[0]?.id || '1')
                          : nextType === 'standby'
                          ? 'standby'
                          : 'https://';
                      setForm({ ...form, content_type: nextType, target_ref: defaultTarget });
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    <option value="web">Página Web (Kiosco)</option>
                    <option value="images">Presentación de Imágenes (feh)</option>
                    <option value="video">Vídeos Locales (mpv)</option>
                    <option value="app">Aplicación Linux / RetroArch</option>
                    <option value="standby">Pantalla de Espera</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {form.content_type === 'web'
                    ? 'URL de la página web'
                    : form.content_type === 'app'
                    ? 'Aplicación Linux autorizada'
                    : 'Carpeta o archivo multimedia'}
                </label>
                {form.content_type === 'app' ? (
                  <select
                    value={form.target_ref}
                    onChange={(e) => setForm({ ...form, target_ref: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    {apps.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.name} ({a.binary_path})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={form.target_ref}
                    onChange={(e) => setForm({ ...form, target_ref: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Hora inicio
                  </label>
                  <input
                    type="time"
                    required
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Hora fin
                  </label>
                  <input
                    type="time"
                    required
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Prioridad
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Repetición
                  </label>
                  <select
                    value={form.recurrence_mode}
                    onChange={(e) => setForm({ ...form, recurrence_mode: e.target.value as RecurrenceMode })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    <option value="weekly">Semanal</option>
                    <option value="daily">Diaria</option>
                    <option value="dates">Fechas concretas</option>
                  </select>
                </div>
              </div>

              {form.recurrence_mode !== 'daily' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Días de la semana
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((d) => {
                      const active = form.days.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              days: active ? form.days.filter((x) => x !== d.id) : [...form.days, d.id],
                            })
                          }
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                            active
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {d.short}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Fecha inicio (opcional)
                  </label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Fecha fin (opcional)
                  </label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Acción al terminar
                  </label>
                  <select
                    value={form.on_finish_action}
                    onChange={(e) => setForm({ ...form, on_finish_action: e.target.value as OnFinishAction })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    <option value="standby">Mostrar pantalla de espera</option>
                    <option value="next_schedule">Siguiente programación</option>
                    <option value="blank_screen">Apagar / Negro HDMI</option>
                    <option value="keep_last">Mantener último contenido</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 pt-1">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  className="rounded border-slate-300"
                />
                <span>Regla activada (evaluada automáticamente cada 10s incluso sin navegador abierto)</span>
              </label>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                >
                  {editingId ? 'Guardar cambios' : 'Crear programación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
