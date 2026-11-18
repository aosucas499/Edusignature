import { Film, Globe, Image as ImageIcon, Monitor, Play, Save } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import type { HostTelemetry, MediaAsset, StandbyConfig } from '../types';
import { apiRequest } from '../utils/api';

interface PlayersViewProps {
  telemetry: HostTelemetry | null;
  standby: StandbyConfig;
  onStandbyUpdated: (s: StandbyConfig) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

type PlayerTab = 'web' | 'images' | 'video' | 'standby';

export const PlayersView: React.FC<PlayersViewProps> = ({
  telemetry,
  standby,
  onStandbyUpdated,
  onNotify,
}) => {
  const [tab, setTab] = useState<PlayerTab>('web');
  const [imagesList, setImagesList] = useState<MediaAsset[]>([]);
  const [videosList, setVideosList] = useState<MediaAsset[]>([]);
  const [slideIdx, setSlideIdx] = useState(0);

  // Web Kiosk Config
  const [webCfg, setWebCfg] = useState({
    url: 'https://campus.centroeducativo.local/tablones',
    browser: 'chromium' as 'chromium' | 'firefox',
    kiosk: true,
    hideNav: true,
    disableScreensaver: true,
    keepScreenOn: true,
    zoom: 100,
    dwellSec: 0,
    refreshIntervalSec: 300,
  });

  // feh Images Config
  const [imgCfg, setImgCfg] = useState({
    folder: 'images',
    intervalSec: 8,
    transition: 'fade',
    randomOrder: false,
    fitMode: 'fit',
    keepAspect: true,
    loop: true,
    recursive: false,
  });

  // mpv Video Config
  const [vidCfg, setVidCfg] = useState({
    target: 'videos',
    loop: true,
    volume: 80,
    fullscreen: true,
  });

  // Standby Config Form
  const [standbyForm, setStandbyForm] = useState({
    school_name: standby.school_name,
    subtitle: standby.subtitle,
    messagesText: (() => {
      try {
        return (JSON.parse(standby.messages_json || '[]') as string[]).join('\n');
      } catch {
        return '';
      }
    })(),
    logo_path: standby.logo_path,
    photos_folder: standby.photos_folder,
    show_clock: standby.show_clock === 1,
    show_date: standby.show_date === 1,
    theme: standby.theme,
  });

  useEffect(() => {
    apiRequest<MediaAsset[]>('/api/media?category=images')
      .then((items) => setImagesList(items.filter((i) => !i.isDirectory)))
      .catch(() => {});
    apiRequest<MediaAsset[]>('/api/media?category=videos')
      .then((items) => setVideosList(items.filter((i) => !i.isDirectory)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (imagesList.length <= 1) return;
    const t = window.setInterval(() => {
      setSlideIdx((prev) => (prev + 1) % imagesList.length);
    }, Math.max(2000, imgCfg.intervalSec * 1000));
    return () => window.clearInterval(t);
  }, [imagesList.length, imgCfg.intervalSec]);

  const launchNow = async (
    title: string,
    contentType: 'web' | 'images' | 'video' | 'standby',
    targetRef: string,
    config: Record<string, unknown>
  ) => {
    try {
      await apiRequest('/api/player/play', {
        method: 'POST',
        body: JSON.stringify({ title, contentType, targetRef, config }),
      });
      onNotify(`Reproduciendo "${title}" en pantalla exclusiva DISPLAY=:0.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error lanzando reproductor', true);
    }
  };

  const saveStandby = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const messages = standbyForm.messagesText
        .split('\n')
        .map((m) => m.trim())
        .filter(Boolean);
      const updated = await apiRequest<StandbyConfig>('/api/standby', {
        method: 'PUT',
        body: JSON.stringify({
          school_name: standbyForm.school_name,
          subtitle: standbyForm.subtitle,
          messages,
          logo_path: standbyForm.logo_path,
          photos_folder: standbyForm.photos_folder,
          show_clock: standbyForm.show_clock,
          show_date: standbyForm.show_date,
          theme: standbyForm.theme,
        }),
      });
      onStandbyUpdated(updated);
      onNotify('Pantalla de espera guardada.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error guardando pantalla de espera', true);
    }
  };

  const chromiumInstalled = telemetry?.binaries.chromium?.installed ?? false;
  const firefoxInstalled = telemetry?.binaries.firefox?.installed ?? false;
  const fehInstalled = telemetry?.binaries.feh?.installed ?? false;
  const mpvInstalled = telemetry?.binaries.mpv?.installed ?? false;

  return (
    <div className="space-y-6">
      {/* Pestañas de reproductores */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 w-fit">
        {(
          [
            { id: 'web', label: 'Páginas Web (Kiosco)', icon: Globe },
            { id: 'images', label: 'Imágenes (feh)', icon: ImageIcon },
            { id: 'video', label: 'Vídeos (mpv)', icon: Film },
            { id: 'standby', label: 'Pantalla de Espera', icon: Monitor },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3.5 py-2 rounded-md text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap ${
                tab === item.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB A: PÁGINAS WEB (KIOSCO) */}
      {tab === 'web' && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Reproductor Web en Modo Kiosco
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                En Raspberry Pi 3B (1 GB RAM), Chromium se cierra por completo al cambiar a otro contenido para evitar saturación de memoria.
              </p>
            </div>
            <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
              Chromium: {chromiumInstalled ? 'Detectado' : 'Pendiente RPi'} · Firefox:{' '}
              {firefoxInstalled ? 'Detectado' : 'Opcional'}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="md:col-span-2">
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Dirección URL (Web del centro, Home Assistant, calendario local…)
              </label>
              <input
                type="text"
                value={webCfg.url}
                onChange={(e) => setWebCfg({ ...webCfg, url: e.target.value })}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Navegador
              </label>
              <select
                value={webCfg.browser}
                onChange={(e) => setWebCfg({ ...webCfg, browser: e.target.value as 'chromium' | 'firefox' })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="chromium">Chromium (Recomendado en Raspberry Pi OS)</option>
                <option value="firefox">Firefox ESR (Requiere Swap ≥ 1024 MB en RPi 3B)</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Zoom (%)</label>
                <input
                  type="number"
                  min={50}
                  max={200}
                  value={webCfg.zoom}
                  onChange={(e) => setWebCfg({ ...webCfg, zoom: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Permanencia (s)</label>
                <input
                  type="number"
                  min={0}
                  value={webCfg.dwellSec}
                  onChange={(e) => setWebCfg({ ...webCfg, dwellSec: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Refresco (s)</label>
                <input
                  type="number"
                  min={0}
                  value={webCfg.refreshIntervalSec}
                  onChange={(e) => setWebCfg({ ...webCfg, refreshIntervalSec: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-700 dark:text-slate-300">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={webCfg.kiosk} onChange={(e) => setWebCfg({ ...webCfg, kiosk: e.target.checked })} />
              <span>Modo kiosco pantalla completa</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={webCfg.hideNav} onChange={(e) => setWebCfg({ ...webCfg, hideNav: e.target.checked })} />
              <span>Ocultar barras de navegación</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={webCfg.disableScreensaver} onChange={(e) => setWebCfg({ ...webCfg, disableScreensaver: e.target.checked })} />
              <span>Desactivar salvapantallas</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={webCfg.keepScreenOn} onChange={(e) => setWebCfg({ ...webCfg, keepScreenOn: e.target.checked })} />
              <span>Mantener pantalla encendida</span>
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => launchNow(`Web: ${webCfg.url}`, 'web', webCfg.url, webCfg)}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-2"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Lanzar en pantalla ahora</span>
            </button>
          </div>
        </section>
      )}

      {/* TAB B: IMÁGENES (FEH) */}
      {tab === 'images' && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Presentación Ligera con feh (Opción Predeterminada RPi 3B)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Consumo inferior a 35 MB RAM. Carpeta compartible por Samba: <span className="font-mono">\\{telemetry?.mdnsAddress}\EduSignage-Media\images</span>
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                feh: {fehInstalled ? 'Instalado' : 'Vía install.sh'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Carpeta origen</label>
                <input
                  type="text"
                  value={imgCfg.folder}
                  onChange={(e) => setImgCfg({ ...imgCfg, folder: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Tiempo por imagen (s)</label>
                <input
                  type="number"
                  min={2}
                  max={300}
                  value={imgCfg.intervalSec}
                  onChange={(e) => setImgCfg({ ...imgCfg, intervalSec: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Ajuste en pantalla</label>
                <select
                  value={imgCfg.fitMode}
                  onChange={(e) => setImgCfg({ ...imgCfg, fitMode: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="fit">Ajustar manteniendo proporción</option>
                  <option value="fill">Rellenar pantalla completa</option>
                  <option value="center">Centrar tamaño original</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-700 dark:text-slate-300">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={imgCfg.randomOrder} onChange={(e) => setImgCfg({ ...imgCfg, randomOrder: e.target.checked })} />
                <span>Orden aleatorio</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={imgCfg.keepAspect} onChange={(e) => setImgCfg({ ...imgCfg, keepAspect: e.target.checked })} />
                <span>Mantener proporciones</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={imgCfg.loop} onChange={(e) => setImgCfg({ ...imgCfg, loop: e.target.checked })} />
                <span>Repetición continua</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={imgCfg.recursive} onChange={(e) => setImgCfg({ ...imgCfg, recursive: e.target.checked })} />
                <span>Incluir subcarpetas</span>
              </label>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => launchNow(`Presentación feh (${imgCfg.folder})`, 'images', imgCfg.folder, imgCfg)}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Iniciar presentación feh</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900 dark:text-slate-100">Vista previa del carrusel</span>
              <span className="font-mono text-slate-500 tabular-nums">
                {imagesList.length > 0 ? `${slideIdx + 1} / ${imagesList.length}` : '0 imágenes'}
              </span>
            </div>
            <div className="aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950 flex items-center justify-center">
              {imagesList[slideIdx] ? (
                <img
                  src={imagesList[slideIdx].url}
                  alt={imagesList[slideIdx].name}
                  referrerPolicy="no-referrer"
                  className={`w-full h-full ${imgCfg.fitMode === 'fill' ? 'object-cover' : 'object-contain'}`}
                />
              ) : (
                <span className="text-xs text-slate-400">Sube imágenes en Archivos Multimedia</span>
              )}
            </div>
            {imagesList[slideIdx] && (
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {imagesList[slideIdx].name}
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB C: VÍDEOS (MPV) */}
      {tab === 'video' && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Reproductor de Vídeos Locales (mpv · MP4 / MKV / WebM)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configurado con <span className="font-mono">--hwdec=auto-safe</span> para decodificación eficiente en VideoCore IV (1080p H.264).
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              mpv: {mpvInstalled ? 'Instalado' : 'Vía install.sh'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Carpeta o vídeo</label>
              <select
                value={vidCfg.target}
                onChange={(e) => setVidCfg({ ...vidCfg, target: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
              >
                <option value="videos">Toda la carpeta /videos (lista continua)</option>
                {videosList.map((v) => (
                  <option key={v.relativePath} value={`videos/${v.relativePath}`}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Volumen ({vidCfg.volume}%)
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={vidCfg.volume}
                onChange={(e) => setVidCfg({ ...vidCfg, volume: Number(e.target.value) })}
                className="w-full mt-2"
              />
            </div>
            <div className="flex items-end gap-4 pb-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={vidCfg.loop} onChange={(e) => setVidCfg({ ...vidCfg, loop: e.target.checked })} />
                <span>Bucle continuo</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={vidCfg.fullscreen} onChange={(e) => setVidCfg({ ...vidCfg, fullscreen: e.target.checked })} />
                <span>Pantalla completa</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => launchNow(`Vídeo mpv (${vidCfg.target})`, 'video', vidCfg.target, vidCfg)}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-2"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Reproducir vídeo con mpv</span>
            </button>
          </div>
        </section>
      )}

      {/* TAB D: PANTALLA DE ESPERA */}
      {tab === 'standby' && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={saveStandby}
            className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 text-xs"
          >
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Configuración de Pantalla de Espera
            </h3>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Nombre del centro</label>
              <input
                type="text"
                value={standbyForm.school_name}
                onChange={(e) => setStandbyForm({ ...standbyForm, school_name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Subtítulo informativo</label>
              <input
                type="text"
                value={standbyForm.subtitle}
                onChange={(e) => setStandbyForm({ ...standbyForm, subtitle: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Mensajes rotativos (uno por línea)
              </label>
              <textarea
                rows={4}
                value={standbyForm.messagesText}
                onChange={(e) => setStandbyForm({ ...standbyForm, messagesText: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Logotipo</label>
                <input
                  type="text"
                  value={standbyForm.logo_path}
                  onChange={(e) => setStandbyForm({ ...standbyForm, logo_path: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Tema visual</label>
                <select
                  value={standbyForm.theme}
                  onChange={(e) => setStandbyForm({ ...standbyForm, theme: e.target.value as 'dark' | 'light' })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="dark">Oscuro institucional</option>
                  <option value="light">Claro minimalista</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={standbyForm.show_clock} onChange={(e) => setStandbyForm({ ...standbyForm, show_clock: e.target.checked })} />
                <span>Mostrar hora actual</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={standbyForm.show_date} onChange={(e) => setStandbyForm({ ...standbyForm, show_date: e.target.checked })} />
                <span>Mostrar fecha</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Guardar pantalla de espera</span>
              </button>
            </div>
          </form>

          {/* Vista previa en vivo de la pantalla de espera */}
          <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900 dark:text-slate-100">Vista previa HDMI (16:9)</span>
              <button
                type="button"
                onClick={() => launchNow('Pantalla de Espera', 'standby', 'standby', {})}
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                Activar en pantalla
              </button>
            </div>

            <div
              className={`aspect-video rounded-lg border border-slate-200 dark:border-slate-800 p-6 flex flex-col justify-between ${
                standbyForm.theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {standbyForm.logo_path && (
                    <img
                      src={standbyForm.logo_path}
                      alt="Logotipo del centro"
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-lg object-cover bg-white p-0.5"
                    />
                  )}
                  <div>
                    <div className="font-display font-bold text-base">{standbyForm.school_name}</div>
                    <div className="text-xs opacity-70">{standbyForm.subtitle}</div>
                  </div>
                </div>
                {(standbyForm.show_clock || standbyForm.show_date) && (
                  <div className="text-right font-mono tabular-nums">
                    {standbyForm.show_clock && (
                      <div className="text-xl font-bold">
                        {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                    {standbyForm.show_date && (
                      <div className="text-[11px] opacity-70">
                        {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-current/15 px-4 py-3 text-xs">
                {standbyForm.messagesText.split('\n').filter(Boolean)[0] || 'Sin mensajes configurados'}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
