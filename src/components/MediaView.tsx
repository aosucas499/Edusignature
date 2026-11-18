import { Edit2, Eye, Folder, FolderPlus, Trash2, Upload, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import type { MediaAsset } from '../types';
import { apiRequest, formatBytes } from '../utils/api';

interface MediaViewProps {
  mdnsAddress: string;
  mediaRootSetting: string;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const MediaView: React.FC<MediaViewProps> = ({
  mdnsAddress,
  mediaRootSetting,
  onNotify,
}) => {
  const [category, setCategory] = useState<'images' | 'videos' | 'web'>('images');
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [previewItem, setPreviewItem] = useState<MediaAsset | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [renaming, setRenaming] = useState<{ oldPath: string; value: string } | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<MediaAsset[]>(
        `/api/media?category=${category}&folder=${encodeURIComponent(folder)}`
      );
      setItems(data);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error listando archivos', true);
    } finally {
      setLoading(false);
    }
  }, [category, folder, onNotify]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fd = new FormData();
    fd.append('category', category);
    fd.append('folder', folder);
    for (let i = 0; i < files.length; i++) {
      fd.append('files', files[i]);
    }
    try {
      const res = await apiRequest<{ count: number }>(`/api/media/upload?category=${category}&folder=${encodeURIComponent(folder)}`, {
        method: 'POST',
        body: fd,
      });
      onNotify(`${res.count} archivo(s) subidos con permisos seguros 0644.`);
      loadFiles();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error subiendo archivo', true);
    } finally {
      e.target.value = '';
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await apiRequest('/api/media/folder', {
        method: 'POST',
        body: JSON.stringify({ category, folder, name: newFolderName.trim() }),
      });
      setNewFolderName('');
      onNotify('Carpeta creada.');
      loadFiles();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error creando carpeta', true);
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    try {
      await apiRequest('/api/media/rename', {
        method: 'POST',
        body: JSON.stringify({
          category,
          oldRelativePath: renaming.oldPath,
          newName: renaming.value,
        }),
      });
      setRenaming(null);
      onNotify('Archivo renombrado.');
      loadFiles();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error renombrando', true);
    }
  };

  const handleDelete = async (relativePath: string) => {
    try {
      await apiRequest('/api/media', {
        method: 'DELETE',
        body: JSON.stringify({ category, relativePath }),
      });
      onNotify('Elemento eliminado.');
      loadFiles();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error eliminando', true);
    }
  };

  const visibleItems = items.filter((i) =>
    i.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 w-fit">
            {(
              [
                { id: 'images', label: 'Imágenes (/images)' },
                { id: 'videos', label: 'Vídeos (/videos)' },
                { id: 'web', label: 'Recursos Web (/web)' },
              ] as const
            ).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCategory(c.id);
                  setFolder('');
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  category === c.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            Ruta Pi: {mediaRootSetting}/{category}{folder ? `/${folder}` : ''} · Samba: \\{mdnsAddress}\EduSignage-Media\{category}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar archivos…"
            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          />

          <label className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
            <Upload className="w-3.5 h-3.5" />
            <span>Subir archivos</span>
            <input
              type="file"
              multiple
              accept={
                category === 'images'
                  ? '.jpg,.jpeg,.png,.webp,.gif,.svg'
                  : category === 'videos'
                  ? '.mp4,.mkv,.webm'
                  : '.html,.htm,.jpg,.png,.webp'
              }
              onChange={handleUpload}
              className="hidden"
            />
          </label>
        </div>
      </section>

      {/* Crear subcarpeta y breadcrumb de carpeta */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-600 dark:text-slate-300">
          <button type="button" onClick={() => setFolder('')} className="hover:underline text-blue-600 dark:text-blue-400">
            /{category}
          </button>
          {folder && (
            <>
              <span>/</span>
              <span>{folder}</span>
              <button
                type="button"
                onClick={() => setFolder(folder.split('/').slice(0, -1).join('/'))}
                className="ml-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 underline"
              >
                Subir nivel
              </button>
            </>
          )}
        </div>

        <form onSubmit={handleCreateFolder} className="flex items-center gap-2">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Nueva carpeta…"
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>Crear carpeta</span>
          </button>
        </form>
      </div>

      {/* Tabla / Galería de archivos */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Cargando directorio…</div>
        ) : visibleItems.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No hay archivos en esta carpeta ({category}).
            </p>
            <p className="text-xs text-slate-400">
              Usa "Subir archivos" o copia directamente mediante el recurso compartido Samba.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Archivo / Carpeta</th>
                  <th className="py-2.5 px-4 font-medium">Tipo MIME</th>
                  <th className="py-2.5 px-4 font-medium">Tamaño</th>
                  <th className="py-2.5 px-4 font-medium">Permisos</th>
                  <th className="py-2.5 px-4 font-medium">Modificado</th>
                  <th className="py-2.5 px-4 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {visibleItems.map((item) => (
                  <tr key={item.relativePath} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4">
                      {item.isDirectory ? (
                        <button
                          type="button"
                          onClick={() => setFolder(item.relativePath)}
                          className="flex items-center gap-2 font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <Folder className="w-4 h-4" />
                          <span>{item.name}</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-3">
                          {item.mimeType.startsWith('image/') && (
                            <img
                              src={item.url}
                              alt={item.name}
                              referrerPolicy="no-referrer"
                              className="w-10 h-7 rounded object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                            />
                          )}
                          <span className="font-medium text-slate-900 dark:text-slate-100">{item.name}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400">{item.mimeType}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {item.isDirectory ? '—' : formatBytes(item.sizeBytes)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-emerald-600 dark:text-emerald-400">
                      {item.permissions} (no ejec.)
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {new Date(item.modifiedAt).toLocaleString('es-ES')}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {!item.isDirectory && (
                          <button
                            type="button"
                            onClick={() => setPreviewItem(item)}
                            className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-blue-600 dark:text-blue-400"
                            title="Previsualizar"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setRenaming({ oldPath: item.relativePath, value: item.name })}
                          className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                          title="Renombrar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.relativePath)}
                          className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400"
                          title="Eliminar"
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

      {/* Modal Renombrar */}
      {renaming && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleRenameSubmit}
            className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs"
          >
            <h3 className="font-display text-sm font-semibold">Renombrar elemento</h3>
            <input
              type="text"
              required
              value={renaming.value}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700">
                Cancelar
              </button>
              <button type="submit" className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium">
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lightbox Previsualización */}
      {previewItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="font-mono font-semibold">{previewItem.name}</span>
              <button type="button" onClick={() => setPreviewItem(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex items-center justify-center max-h-[75vh]">
              {previewItem.mimeType.startsWith('image/') ? (
                <img
                  src={previewItem.url}
                  alt={previewItem.name}
                  referrerPolicy="no-referrer"
                  className="max-h-[68vh] object-contain"
                />
              ) : previewItem.mimeType.startsWith('video/') ? (
                <video src={previewItem.url} controls className="max-h-[68vh] w-full" />
              ) : (
                <iframe src={previewItem.url} title={previewItem.name} className="w-full h-[65vh] bg-white rounded" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
