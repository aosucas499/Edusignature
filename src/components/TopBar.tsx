import { Activity, Lock, Menu, Moon, Sun } from 'lucide-react';
import React from 'react';
import type { NavSection } from './Sidebar';

interface TopBarProps {
  activeSection: NavSection;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenMobileMenu: () => void;
  onRunHealthCheck: () => void;
  healthRunning: boolean;
  authEnabled: boolean;
  onLockSession: () => void;
}

const SECTION_TITLES: Record<NavSection, string> = {
  panel: 'Panel Principal',
  programacion: 'Programación Horaria',
  reproductores: 'Reproductores y Espera',
  aplicaciones: 'Apps Linux y RetroArch',
  multimedia: 'Archivos Multimedia',
  sistema: 'Sistema Raspberry Pi',
  despliegue: 'Paquete Pi y Backups',
  ajustes: 'Ajustes y Seguridad',
};

export const TopBar: React.FC<TopBarProps> = ({
  activeSection,
  theme,
  onToggleTheme,
  onOpenMobileMenu,
  onRunHealthCheck,
  healthRunning,
  authEnabled,
  onLockSession,
}) => {
  return (
    <header className="h-16 px-4 lg:px-8 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
          aria-label="Abrir menú"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 min-w-0 whitespace-nowrap">
          <span className="hidden sm:inline">Controlador Local</span>
          <span className="hidden sm:inline" aria-hidden="true">/</span>
          <h1 className="font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
            {SECTION_TITLES[activeSection]}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onToggleTheme}
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {authEnabled && (
          <button
            type="button"
            onClick={onLockSession}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Bloquear</span>
          </button>
        )}

        <button
          type="button"
          onClick={onRunHealthCheck}
          disabled={healthRunning}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Activity className="w-3.5 h-3.5" />
          <span>{healthRunning ? 'Comprobando…' : 'Comprobar sistema'}</span>
        </button>
      </div>
    </header>
  );
};
