import type { AuthorizedApp, ContentType, PlayerState, ScheduleRule, ServiceStatus, StandbyConfig } from '../src/types.ts';
import { addAuditLog, db } from './db.ts';

type BroadcastFn = (eventType: string, data: unknown) => void;

class SignageEngine {
  private timer: NodeJS.Timeout | null = null;
  private broadcast: BroadcastFn = () => {};
  private manualOverride: {
    title: string;
    contentType: ContentType;
    targetRef: string;
    config: Record<string, unknown>;
    expiresAt: number | null;
    actor: string;
  } | null = null;

  private serviceStartTimes: Record<string, number> = {
    'edusignage-web': Date.now(),
    'edusignage-scheduler': Date.now(),
    'edusignage-player': Date.now(),
    'edusignage-system-helper': Date.now(),
  };

  private serviceStatuses: Record<string, 'active' | 'inactive' | 'degraded'> = {
    'edusignage-web': 'active',
    'edusignage-scheduler': 'active',
    'edusignage-player': 'active',
    'edusignage-system-helper': 'active',
  };

  private playerState: PlayerState = {
    status: 'standby',
    source: 'standby',
    scheduleId: null,
    title: 'Pantalla de Espera',
    contentType: 'standby',
    targetRef: 'standby',
    activeApp: 'Chromium Kiosco (Standby Local)',
    commandPreview: 'chromium-browser --kiosk --app=http://127.0.0.1:8080/standby --noerrdialogs',
    config: {},
    startedAt: new Date().toISOString(),
    manualExpiresAt: null,
    exclusiveLockOwner: 'edusignage-player (DISPLAY=:0)',
    lastError: null,
  };

  setBroadcaster(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  start(): void {
    if (this.timer) return;
    this.evaluateNow('boot');
    this.timer = setInterval(() => {
      this.evaluateNow('tick');
    }, 10000);
  }

  stopEngine(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getPlayerState(): PlayerState {
    return this.playerState;
  }

  getServicesStatus(): ServiceStatus[] {
    const now = Date.now();
    const defs: Array<{ name: string; unit: string; role: string; mem: number }> = [
      { name: 'Servidor Web Admin', unit: 'edusignage-web', role: 'API REST + WebSockets + Panel Web', mem: 42 },
      { name: 'Motor de Planificación', unit: 'edusignage-scheduler', role: 'Evaluación horaria autónoma SQLite', mem: 18 },
      { name: 'Reproductor Exclusivo X11', unit: 'edusignage-player', role: 'Control único DISPLAY=:0 y watchdog', mem: 26 },
      { name: 'Helper Privilegiado OS', unit: 'edusignage-system-helper', role: 'Lista blanca root (systemd/SSH/red)', mem: 14 },
    ];
    return defs.map((d) => {
      const status = this.serviceStatuses[d.unit] || 'active';
      const started = this.serviceStartTimes[d.unit] || now;
      return {
        name: d.name,
        unit: d.unit,
        role: d.role,
        status,
        pid: status === 'active' ? 1200 + defs.indexOf(d) * 37 : null,
        memoryMb: status === 'active' ? d.mem : 0,
        uptimeSec: status === 'active' ? Math.max(1, Math.floor((now - started) / 1000)) : 0,
      };
    });
  }

  controlService(unit: string, action: 'start' | 'stop' | 'restart'): ServiceStatus[] {
    if (!(unit in this.serviceStatuses)) {
      throw new Error(`Servicio no autorizado: ${unit}`);
    }
    if (action === 'stop') {
      if (unit === 'edusignage-web') {
        throw new Error('No se puede detener el servidor web desde sí mismo.');
      }
      this.serviceStatuses[unit] = 'inactive';
      if (unit === 'edusignage-player') {
        this.playerState = {
          ...this.playerState,
          status: 'stopped',
          activeApp: 'Ninguna (Reproductor detenido)',
          commandPreview: '—',
        };
      }
    } else if (action === 'start' || action === 'restart') {
      this.serviceStatuses[unit] = 'active';
      this.serviceStartTimes[unit] = Date.now();
      if (unit === 'edusignage-player' || unit === 'edusignage-scheduler') {
        this.evaluateNow('service-restart');
      }
    }
    addAuditLog('admin', 'systemd', 'info', `Servicio ${unit}: acción ${action} ejecutada.`);
    this.broadcast('services:updated', this.getServicesStatus());
    this.broadcast('player:changed', this.playerState);
    return this.getServicesStatus();
  }

  triggerManualPlay(params: {
    title: string;
    contentType: ContentType;
    targetRef: string;
    config?: Record<string, unknown>;
    durationMin?: number;
    actor?: string;
  }): PlayerState {
    const expiresAt =
      params.durationMin && params.durationMin > 0
        ? Date.now() + params.durationMin * 60 * 1000
        : null;

    this.manualOverride = {
      title: params.title,
      contentType: params.contentType,
      targetRef: params.targetRef,
      config: params.config || {},
      expiresAt,
      actor: params.actor || 'admin',
    };

    addAuditLog(
      params.actor || 'admin',
      'player',
      'info',
      `Reproducción manual lanzada: ${params.title} (${params.contentType})`
    );
    this.evaluateNow('manual');
    return this.playerState;
  }

  stopManualAndReturnToSchedule(actor = 'admin'): PlayerState {
    this.manualOverride = null;
    addAuditLog(actor, 'player', 'info', 'Reproducción manual detenida; devolviendo control al planificador.');
    this.evaluateNow('manual-clear');
    return this.playerState;
  }

  forceStandby(actor = 'admin'): PlayerState {
    return this.triggerManualPlay({
      title: 'Pantalla de Espera (Forzada)',
      contentType: 'standby',
      targetRef: 'standby',
      actor,
    });
  }

  stopDisplayOutput(actor = 'admin'): PlayerState {
    this.manualOverride = {
      title: 'Salida de Pantalla Detenida',
      contentType: 'standby',
      targetRef: 'stopped',
      config: {},
      expiresAt: null,
      actor,
    };
    this.playerState = {
      status: 'stopped',
      source: 'manual',
      scheduleId: null,
      title: 'Pantalla detenida manualmente',
      contentType: 'standby',
      targetRef: 'stopped',
      activeApp: 'Ninguna (DISPLAY=:0 libre)',
      commandPreview: 'pkill -f chromium && pkill -f feh && pkill -f mpv',
      config: {},
      startedAt: new Date().toISOString(),
      manualExpiresAt: null,
      exclusiveLockOwner: 'edusignage-player (inactivo)',
      lastError: null,
    };
    addAuditLog(actor, 'player', 'info', 'Reproductor gráfico detenido manualmente.');
    this.broadcast('player:changed', this.playerState);
    return this.playerState;
  }

  private isTimeInWindow(nowHHMM: string, startHHMM: string, endHHMM: string): boolean {
    if (startHHMM <= endHHMM) {
      return nowHHMM >= startHHMM && nowHHMM < endHHMM;
    }
    return nowHHMM >= startHHMM || nowHHMM < endHHMM;
  }

  private resolveAppAndCommand(
    contentType: ContentType,
    targetRef: string,
    config: Record<string, unknown>
  ): { activeApp: string; commandPreview: string; error: string | null } {
    if (contentType === 'web') {
      const browser = config.browser === 'firefox' ? 'firefox-esr' : 'chromium-browser';
      const zoom = Number(config.zoom || 100) / 100;
      const cmd =
        browser === 'firefox-esr'
          ? `/usr/bin/firefox-esr --kiosk ${targetRef}`
          : `/usr/bin/chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-dev-shm-usage --force-device-scale-factor=${zoom} ${targetRef}`;
      return {
        activeApp: browser === 'firefox-esr' ? 'Firefox ESR (Kiosco)' : 'Chromium (Kiosco)',
        commandPreview: cmd,
        error: null,
      };
    }

    if (contentType === 'images') {
      const delay = Number(config.intervalSec || 8);
      const flags = [
        '--fullscreen',
        '--auto-zoom',
        '--hide-pointer',
        `--slideshow-delay ${delay}`,
        config.randomOrder ? '--randomize' : '',
        config.recursive ? '--recursive' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return {
        activeApp: 'feh (Presentación ligera)',
        commandPreview: `/usr/bin/feh ${flags} /opt/edusignage/media/${targetRef}`,
        error: null,
      };
    }

    if (contentType === 'video') {
      const vol = Number(config.volume ?? 80);
      return {
        activeApp: 'mpv (Reproductor Vídeo Local)',
        commandPreview: `/usr/bin/mpv --fs --no-osd-bar --loop-playlist=inf --hwdec=auto-safe --volume=${vol} /opt/edusignage/media/${targetRef}`,
        error: null,
      };
    }

    if (contentType === 'app') {
      const app = db
        .prepare('SELECT * FROM authorized_apps WHERE (id = ? OR name = ?) AND enabled = 1')
        .get(targetRef, targetRef) as AuthorizedApp | undefined;
      if (!app) {
        return {
          activeApp: 'Aplicación bloqueada',
          commandPreview: '—',
          error: `La aplicación '${targetRef}' no figura en el catálogo autorizado.`,
        };
      }
      return {
        activeApp: app.name,
        commandPreview: `${app.binary_path} ${app.args}`.trim(),
        error: null,
      };
    }

    return {
      activeApp: 'Pantalla de Espera Institucional',
      commandPreview: '/usr/bin/chromium-browser --kiosk --app=http://127.0.0.1:8080/standby --noerrdialogs',
      error: null,
    };
  }

  evaluateNow(reason = 'tick'): PlayerState {
    if (this.serviceStatuses['edusignage-scheduler'] !== 'active') {
      return this.playerState;
    }

    // Check manual override expiration
    if (this.manualOverride) {
      if (this.manualOverride.expiresAt && Date.now() > this.manualOverride.expiresAt) {
        this.manualOverride = null;
        addAuditLog('scheduler', 'schedule', 'info', 'Tiempo de reproducción manual finalizado; retomando programación.');
      } else if (this.manualOverride.targetRef === 'stopped') {
        return this.playerState;
      } else {
        const resolved = this.resolveAppAndCommand(
          this.manualOverride.contentType,
          this.manualOverride.targetRef,
          this.manualOverride.config
        );
        const nextState: PlayerState = {
          status: resolved.error ? 'error' : this.manualOverride.contentType === 'standby' ? 'standby' : 'playing',
          source: 'manual',
          scheduleId: null,
          title: this.manualOverride.title,
          contentType: this.manualOverride.contentType,
          targetRef: this.manualOverride.targetRef,
          activeApp: resolved.activeApp,
          commandPreview: resolved.commandPreview,
          config: this.manualOverride.config,
          startedAt: this.playerState.source === 'manual' && this.playerState.title === this.manualOverride.title
            ? this.playerState.startedAt
            : new Date().toISOString(),
          manualExpiresAt: this.manualOverride.expiresAt
            ? new Date(this.manualOverride.expiresAt).toISOString()
            : null,
          exclusiveLockOwner: 'edusignage-player (DISPLAY=:0)',
          lastError: resolved.error,
        };
        const changed =
          nextState.title !== this.playerState.title ||
          nextState.contentType !== this.playerState.contentType ||
          nextState.targetRef !== this.playerState.targetRef ||
          nextState.status !== this.playerState.status;
        this.playerState = nextState;
        if (changed) this.broadcast('player:changed', this.playerState);
        return this.playerState;
      }
    }

    // Evaluate scheduled rules from SQLite
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const nowHHMM = `${hh}:${mm}`;
    const todayIso = now.toISOString().slice(0, 10);
    const isoWeekday = String(now.getDay() === 0 ? 7 : now.getDay());

    const rules = db
      .prepare('SELECT * FROM schedules WHERE enabled = 1 ORDER BY priority DESC, id ASC')
      .all() as ScheduleRule[];

    let matched: ScheduleRule | null = null;
    for (const rule of rules) {
      const days = rule.days_of_week
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      if (rule.recurrence_mode !== 'daily' && !days.includes(isoWeekday)) {
        continue;
      }
      if (rule.start_date && todayIso < rule.start_date) continue;
      if (rule.end_date && todayIso > rule.end_date) continue;
      if (this.isTimeInWindow(nowHHMM, rule.start_time, rule.end_time)) {
        matched = rule;
        break;
      }
    }

    let nextState: PlayerState;
    if (matched) {
      let cfg: Record<string, unknown> = {};
      try {
        cfg = JSON.parse(matched.config_json || '{}');
      } catch {
        cfg = {};
      }
      const resolved = this.resolveAppAndCommand(matched.content_type, matched.target_ref, cfg);
      nextState = {
        status: resolved.error ? 'error' : matched.content_type === 'standby' ? 'standby' : 'playing',
        source: 'schedule',
        scheduleId: matched.id,
        title: matched.name,
        contentType: matched.content_type,
        targetRef: matched.target_ref,
        activeApp: resolved.activeApp,
        commandPreview: resolved.commandPreview,
        config: cfg,
        startedAt:
          this.playerState.scheduleId === matched.id && this.playerState.source === 'schedule'
            ? this.playerState.startedAt
            : new Date().toISOString(),
        manualExpiresAt: null,
        exclusiveLockOwner: 'edusignage-player (DISPLAY=:0)',
        lastError: resolved.error,
      };
    } else {
      const standby = db.prepare('SELECT * FROM standby_config WHERE id = 1').get() as StandbyConfig;
      const resolved = this.resolveAppAndCommand('standby', 'standby', {});
      nextState = {
        status: 'standby',
        source: 'standby',
        scheduleId: null,
        title: `${standby?.school_name || 'Pantalla de Espera'} (Espera)`,
        contentType: 'standby',
        targetRef: 'standby',
        activeApp: resolved.activeApp,
        commandPreview: resolved.commandPreview,
        config: (standby as unknown as Record<string, unknown>) || {},
        startedAt:
          this.playerState.source === 'standby' ? this.playerState.startedAt : new Date().toISOString(),
        manualExpiresAt: null,
        exclusiveLockOwner: 'edusignage-player (DISPLAY=:0)',
        lastError: null,
      };
    }

    const changed =
      nextState.scheduleId !== this.playerState.scheduleId ||
      nextState.source !== this.playerState.source ||
      nextState.targetRef !== this.playerState.targetRef ||
      nextState.status !== this.playerState.status;

    this.playerState = nextState;
    if (changed) {
      if (reason !== 'boot') {
        addAuditLog(
          'scheduler',
          'player',
          nextState.status === 'error' ? 'error' : 'info',
          `Transición automática (${reason}): ${nextState.title} -> ${nextState.activeApp}`
        );
      }
      this.broadcast('player:changed', this.playerState);
    }

    return this.playerState;
  }
}

export const signageEngine = new SignageEngine();
