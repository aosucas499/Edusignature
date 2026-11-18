import {
  CalendarClock,
  Cpu,
  FolderOpen,
  Gamepad2,
  LayoutDashboard,
  MonitorPlay,
  PackageCheck,
  Settings,
  X,
} from 'lucide-react';
import React from 'react';

export type NavSection =
  | 'panel'
  | 'programacion'
  | 'reproductores'
  | 'aplicaciones'
  | 'multimedia'
  | 'sistema'
  | 'despliegue'
  | 'ajustes';

interface SidebarProps {
  active: NavSection;
  onSelect: (section: NavSection) => void;
  wsStatus: 'connected' | 'connecting' | 'disconnected';
  deviceName: string;
  mdnsAddress: string;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'panel', label: 'Panel Principal', icon: LayoutDashboard },
  { id: 'programacion', label: 'Programación Horaria', icon: CalendarClock },
  { id: 'reproductores', label: 'Reproductores y Espera', icon: MonitorPlay },
  { id: 'aplicaciones', label: 'Apps Linux y RetroArch', icon: Gamepad2 },
  { id: 'multimedia', label: 'Archivos Multimedia', icon: FolderOpen },
  { id: 'sistema', label: 'Sistema Raspberry Pi', icon: Cpu },
  { id: 'despliegue', label: 'Paquete Pi y Backups', icon: PackageCheck },
  { id: 'ajustes', label: 'Ajustes y Seguridad', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({
  active,
  onSelect,
  wsStatus,
  deviceName,
  mdnsAddress,
  mobileOpen,
  onCloseMobile,
}) => {
  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[260px] shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <div className="min-w-0">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
              EduSignage Pi
            </span>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            aria-label="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Navegación principal">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
          <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{deviceName}</div>
          <div className="font-mono text-slate-500 dark:text-slate-400 truncate">{mdnsAddress}</div>
          <div className="flex items-center gap-2 pt-1 text-slate-600 dark:text-slate-300">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                wsStatus === 'connected'
                  ? 'bg-emerald-600'
                  : wsStatus === 'connecting'
                  ? 'bg-amber-600'
                  : 'bg-red-600'
              }`}
              aria-hidden="true"
            />
            <span>
              {wsStatus === 'connected'
                ? 'Telemetría WebSocket activa'
                : wsStatus === 'connecting'
                ? 'Conectando canal WS…'
                : 'Reconectando canal WS…'}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
