import { Activity, ArchiveRestore, CheckCircle2, Copy, Download, FileCode2, RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import type { HealthCheckReport, PackageFileEntry } from '../types';
import { apiRequest, formatBytes } from '../utils/api';

interface DeployBackupViewProps {
  appVersion: string;
  healthReport: HealthCheckReport | null;
  onRunHealthCheck: () => void;
  onRefreshState: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const DeployBackupView: React.FC<DeployBackupViewProps> = ({
  appVersion,
  healthReport,
  onRunHealthCheck,
  onRefreshState,
  onNotify,
}) => {
  const [packageFiles, setPackageFiles] = useState<PackageFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<PackageFileEntry | null>(null);
  const [backups, setBackups] = useState<Array<{ name: string; sizeBytes: number; createdAt: string }>>([]);

  const loadData = async () => {
    try {
      const [files, bks] = await Promise.all([
        apiRequest<PackageFileEntry[]>('/api/package/files'),
        apiRequest<Array<{ name: string; sizeBytes: number; createdAt: string }>>('/api/backups/list'),
      ]);
      setPackageFiles(files);
      if (files.length > 0 && !selectedFile) {
        const inst = files.find((f) => f.path === 'install.sh') || files[0];
        setSelectedFile(inst);
      }
      setBackups(bks);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error cargando paquete de despliegue', true);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExportBackup = () => {
    window.location.href = '/api/backups/export';
    onNotify('Descargando copia de seguridad completa en formato JSON.');
    setTimeout(loadData, 1000);
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await apiRequest('/api/backups/restore', {
        method: 'POST',
        body: JSON.stringify(json),
      });
      onNotify('Copia de seguridad restaurada en SQLite.');
      onRefreshState();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Archivo de respaldo inválido', true);
    } finally {
      e.target.value = '';
    }
  };

  const handleDownloadTar = () => {
    window.location.href = '/api/package/download';
    onNotify('Generando paquete nativo edusignage-pi-bundle.tar.gz para Raspberry Pi OS.');
  };

  const copyContent = async () => {
    if (!selectedFile) return;
    await navigator.clipboard.writeText(selectedFile.content);
    onNotify(`Contenido de ${selectedFile.path} copiado al portapapeles.`);
  };

  return (
    <div className="space-y-6">
      {/* Tarjetas de Diagnóstico, Respaldo y Actualización */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Comprobación de Componentes
            </h3>
            <Activity className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-slate-500 dark:text-slate-400">
            Verifica integridad SQLite, memoria/swap RPi 3B, almacenamiento, sensores y los 4 servicios systemd.
          </p>
          <button
            type="button"
            onClick={onRunHealthCheck}
            className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            Ejecutar diagnóstico completo
          </button>
          {healthReport && (
            <div className="pt-1 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Estado global: {healthReport.overall.toUpperCase()}</span>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Copias de Seguridad y Restauración
            </h3>
            <ArchiveRestore className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-slate-500 dark:text-slate-400">
            Exporta horarios, aplicaciones autorizadas, pantalla de espera y ajustes o restaura desde un archivo local.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExportBackup}
              className="flex-1 py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Exportar copia
            </button>
            <label className="flex-1 py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 font-medium hover:bg-slate-100 dark:hover:bg-slate-800 text-center cursor-pointer">
              Restaurar JSON
              <input type="file" accept=".json" onChange={handleRestoreFile} className="hidden" />
            </label>
          </div>
          <div className="font-mono text-[11px] text-slate-500">
            Copias locales guardadas: {backups.length}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Paquete Nativo Raspberry Pi 3B
            </h3>
            <RefreshCw className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-slate-500 dark:text-slate-400">
            Versión actual: <span className="font-mono font-semibold">{appVersion}</span>. Incluye FastAPI, scheduler, player X11/Openbox, helper root, Samba, Avahi e instalador.
          </p>
          <button
            type="button"
            onClick={handleDownloadTar}
            className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>Descargar edusignage-pi-bundle.tar.gz</span>
          </button>
        </div>
      </div>

      {/* Instrucciones paso a paso + Explorador de código fuente Raspberry Pi */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
        <div>
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Instalación, Actualización vía Git y Verificación en Raspberry Pi OS Lite (32/64 bits)
          </h3>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Opción recomendada tras subir el repositorio a GitHub (<span className="font-mono">git clone</span> y actualizaciones con <span className="font-mono">update.sh</span>), o bien mediante el archivo <span className="font-mono">edusignage-pi-bundle.tar.gz</span>:
          </p>
          <pre className="mt-2 p-3 rounded-lg bg-slate-950 text-slate-100 font-mono text-[11px] overflow-x-auto">
{`# Instalación limpia en Raspberry Pi OS Lite:
git clone https://github.com/TU-USUARIO/edusignage-pi.git
cd edusignage-pi
sudo ./install.sh

# Actualizar en el futuro conservando SQLite y archivos multimedia:
sudo ./update.sh

# Verificar servicios, memoria y temperatura RPi 3B:
systemctl status edusignage-web edusignage-scheduler edusignage-player edusignage-system-helper
vcgencmd measure_temp && free -m`}
          </pre>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800 max-h-[420px] overflow-y-auto">
            {packageFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedFile(file)}
                className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  selectedFile?.path === file.path ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : ''
                }`}
              >
                <span className="flex items-center gap-2 font-mono truncate">
                  <FileCode2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{file.path}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400 shrink-0 tabular-nums">
                  {formatBytes(file.sizeBytes)}
                </span>
              </button>
            ))}
          </div>

          <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                {selectedFile ? selectedFile.path : 'Selecciona un archivo'}
              </span>
              {selectedFile && (
                <button
                  type="button"
                  onClick={copyContent}
                  className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copiar</span>
                </button>
              )}
            </div>
            <pre className="p-4 bg-slate-950 text-slate-100 font-mono text-[11px] leading-relaxed overflow-auto max-h-[375px]">
              {selectedFile?.content || ''}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
};
