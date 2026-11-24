import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'edusignage.db');
export const MEDIA_BASE_DIR = path.join(DATA_DIR, 'media');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
for (const sub of ['images', 'videos', 'web']) {
  fs.mkdirSync(path.join(MEDIA_BASE_DIR, sub), { recursive: true, mode: 0o755 });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content_type TEXT NOT NULL CHECK(content_type IN ('web','images','video','app','standby')),
      target_ref TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      days_of_week TEXT NOT NULL DEFAULT '1,2,3,4,5',
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      recurrence_mode TEXT NOT NULL DEFAULT 'weekly',
      priority INTEGER NOT NULL DEFAULT 10,
      enabled INTEGER NOT NULL DEFAULT 1,
      on_finish_action TEXT NOT NULL DEFAULT 'standby',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authorized_apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      binary_path TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '',
      display_mode TEXT NOT NULL DEFAULT 'fullscreen',
      default_duration_min INTEGER NOT NULL DEFAULT 30,
      on_finish_action TEXT NOT NULL DEFAULT 'standby',
      rpi3b_compatible INTEGER NOT NULL DEFAULT 1,
      ram_profile TEXT NOT NULL DEFAULT 'low',
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS standby_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      school_name TEXT NOT NULL DEFAULT 'IES Tecnología Educativa',
      subtitle TEXT NOT NULL DEFAULT 'Cartelería Digital del Centro · Información y Horarios',
      messages_json TEXT NOT NULL DEFAULT '["Bienvenidos al curso académico · Secretaría abierta de 09:00 a 13:30","Recreo general: 11:15 – 11:45 · Aula de Robótica abierta en el 2º turno","Recuerda mantener las pantallas y equipos en modo ahorro al finalizar la jornada"]',
      logo_path TEXT NOT NULL DEFAULT '/media/images/escudo_centro.jpg',
      photos_folder TEXT NOT NULL DEFAULT 'images',
      show_clock INTEGER NOT NULL DEFAULT 1,
      show_date INTEGER NOT NULL DEFAULT 1,
      theme TEXT NOT NULL DEFAULT 'dark'
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT NOT NULL DEFAULT 'system',
      category TEXT NOT NULL DEFAULT 'general',
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wifi_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ssid TEXT UNIQUE NOT NULL,
      security TEXT NOT NULL DEFAULT 'WPA2',
      signal INTEGER NOT NULL DEFAULT 82,
      connected INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const defaultSettings: Record<string, string> = {
    device_name: 'EduSignage Hall Principal',
    hostname: 'edusignage',
    web_port: '3000',
    media_root: '/opt/edusignage/media',
    samba_enabled: 'true',
    ssh_enabled: 'true',
    mdns_enabled: 'true',
    resolution: '1920x1080',
    orientation: 'normal',
    timezone: 'Europe/Madrid',
    swap_mb: '1024',
    boot_autostart: 'true',
    auth_enabled: 'false',
    app_version: '1.0.0-rpi3b',
  };

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)'
  );
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, v);
  }

  db.prepare('INSERT OR IGNORE INTO standby_config (id) VALUES (1)').run();

  // Seed generated images into real local media folder on first run
  const seedImages: Array<{ src: string; destName: string }> = [
    {
      src: path.resolve(process.cwd(), 'src/assets/images/edusignage_campus_banner_1795036681506.jpg'),
      destName: 'campus_atrio.jpg',
    },
    {
      src: path.resolve(process.cwd(), 'src/assets/images/edusignage_robotics_slide_1795036681085.jpg'),
      destName: 'taller_robotica.jpg',
    },
    {
      src: path.resolve(process.cwd(), 'src/assets/images/edusignage_school_crest_1795036681245.jpg'),
      destName: 'escudo_centro.jpg',
    },
  ];

  for (const img of seedImages) {
    const target = path.join(MEDIA_BASE_DIR, 'images', img.destName);
    if (fs.existsSync(img.src) && !fs.existsSync(target)) {
      fs.copyFileSync(img.src, target);
      fs.chmodSync(target, 0o644);
    }
  }

  // Seed sample local web HTML panel for /media/web
  const sampleHtml = path.join(MEDIA_BASE_DIR, 'web', 'aviso_recreo.html');
  if (!fs.existsSync(sampleHtml)) {
    fs.writeFileSync(
      sampleHtml,
      `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Aviso de Recreo</title>
<style>body{margin:0;background:#0f172a;color:#f8fafc;font-family:sans-serif;display:grid;place-items:center;height:100vh;text-align:center}h1{font-size:3rem;margin-bottom:.5rem}p{color:#94a3b8;font-size:1.5rem}</style>
</head>
<body><div><h1>Turno de Recreo · Biblioteca y Patio</h1><p>Acceso abierto de 11:15 a 11:45. Respeta las zonas de estudio.</p></div></body>
</html>`,
      { mode: 0o644 }
    );
  }

  // Seed initial schedules if empty
  const scheduleCount = (db.prepare('SELECT COUNT(*) as count FROM schedules').get() as { count: number }).count;
  if (scheduleCount === 0) {
    const insertSchedule = db.prepare(`
      INSERT INTO schedules
      (name, content_type, target_ref, config_json, start_time, end_time, days_of_week, start_date, end_date, recurrence_mode, priority, enabled, on_finish_action)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const initialSchedules = [
      [
        'Portal Informativo del Centro',
        'web',
        'https://campus.centroeducativo.local/tablones',
        JSON.stringify({ browser: 'chromium', kiosk: true, hideNav: true, disableScreensaver: true, keepScreenOn: true, zoom: 100, dwellSec: 0, refreshIntervalSec: 300 }),
        '08:00',
        '09:00',
        '1,2,3,4,5',
        '',
        '',
        'weekly',
        10,
        1,
        'standby',
      ],
      [
        'Presentación Campus y Robótica (feh)',
        'images',
        'images',
        JSON.stringify({ intervalSec: 8, transition: 'fade', randomOrder: false, fitMode: 'fit', keepAspect: true, loop: true, recursive: false }),
        '09:00',
        '11:15',
        '1,2,3,4,5',
        '',
        '',
        'weekly',
        10,
        1,
        'standby',
      ],
      [
        'Información del Recreo',
        'web',
        '/media/web/aviso_recreo.html',
        JSON.stringify({ browser: 'chromium', kiosk: true, hideNav: true, disableScreensaver: true, keepScreenOn: true, zoom: 110, dwellSec: 0, refreshIntervalSec: 0 }),
        '11:15',
        '12:00',
        '1,2,3,4,5',
        '',
        '',
        'weekly',
        20,
        1,
        'standby',
      ],
      [
        'Sesión RetroArch · Taller Videojuegos',
        'app',
        '1',
        JSON.stringify({ displayMode: 'fullscreen', durationMin: 30 }),
        '12:00',
        '12:30',
        '3,5',
        '',
        '',
        'weekly',
        30,
        1,
        'standby',
      ],
      [
        'Portal Informativo Tarde',
        'web',
        'https://campus.centroeducativo.local/tablones',
        JSON.stringify({ browser: 'chromium', kiosk: true, hideNav: true, disableScreensaver: true, keepScreenOn: true, zoom: 100, dwellSec: 0, refreshIntervalSec: 300 }),
        '12:30',
        '14:00',
        '1,2,3,4,5',
        '',
        '',
        'weekly',
        10,
        1,
        'standby',
      ],
      [
        'Reposo Institucional de Tarde',
        'standby',
        'standby',
        JSON.stringify({}),
        '14:00',
        '20:00',
        '1,2,3,4,5',
        '',
        '',
        'weekly',
        5,
        1,
        'standby',
      ],
    ];

    for (const row of initialSchedules) {
      insertSchedule.run(...row);
    }
  }

  // Seed authorized Linux apps if empty
  const oldChromiumArgs = '--kiosk --noerrdialogs --disable-infobars --disable-dev-shm-usage';
  const newChromiumArgs =
    '--kiosk --noerrdialogs --disable-infobars --disable-dev-shm-usage --disable-metrics --disable-metrics-reporting --disable-breakpad --disable-crash-reporter';

  const appCount = (db.prepare('SELECT COUNT(*) as count FROM authorized_apps').get() as { count: number }).count;
  if (appCount === 0) {
    const insertApp = db.prepare(`
      INSERT INTO authorized_apps
      (name, binary_path, args, display_mode, default_duration_min, on_finish_action, rpi3b_compatible, ram_profile, enabled, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const initialApps = [
      ['RetroArch (Emulador Educativo)', '/usr/bin/retroarch', '--fullscreen', 'fullscreen', 30, 'standby', 1, 'medium', 1, 'Ejecución a pantalla completa compatible con VideoCore IV en Raspberry Pi 3B.'],
      ['Presentación feh (Carpeta Imágenes)', '/usr/bin/feh', '--fullscreen --auto-zoom --hide-pointer --slideshow-delay 8', 'fullscreen', 60, 'standby', 1, 'low', 1, 'Opción predeterminada de muy bajo consumo (<35 MB RAM) para Raspberry Pi 3B.'],
      ['Reproductor MPV Local', '/usr/bin/mpv', '--fs --no-osd-bar --hwdec=auto-safe', 'fullscreen', 45, 'standby', 1, 'low', 1, 'Reproductor ligero para vídeos MP4/MKV H.264 locales.'],
      ['Chromium Kiosco', '/usr/bin/chromium-browser', newChromiumArgs, 'fullscreen', 120, 'standby', 1, 'high', 1, 'Sin métricas/volcados; se cierra automáticamente al cambiar de tarea para liberar ~420 MB de RAM.'],
      ['Firefox ESR Kiosco', '/usr/bin/firefox-esr', '--kiosk', 'fullscreen', 90, 'standby', 0, 'high', 1, 'Alternativa opcional; requiere swap de 1024 MB en Raspberry Pi 3B de 1 GB RAM.'],
      ['LibreOffice Impress', '/usr/bin/libreoffice', '--impress --norestore', 'fullscreen', 30, 'standby', 1, 'medium', 1, 'Presentaciones ODP/PPTX locales (añade ruta .odp --show si deseas reproducción directa).'],
    ];
    for (const row of initialApps) {
      insertApp.run(...row);
    }
  } else {
    db.prepare("UPDATE authorized_apps SET args = ? WHERE name = 'Chromium Kiosco' AND args = ?").run(
      newChromiumArgs,
      oldChromiumArgs
    );
  }

  const wifiCount = (db.prepare('SELECT COUNT(*) as count FROM wifi_profiles').get() as { count: number }).count;
  if (wifiCount === 0) {
    db.prepare('INSERT INTO wifi_profiles (ssid, security, signal, connected) VALUES (?, ?, ?, ?)').run(
      'RED_DOCENTE_5G',
      'WPA2-PSK',
      86,
      1
    );
  }

  const logCount = (db.prepare('SELECT COUNT(*) as count FROM audit_logs').get() as { count: number }).count;
  if (logCount === 0) {
    addAuditLog('system', 'boot', 'info', 'Base de datos SQLite inicializada y motor de planificación listo.');
  }
}

export function getSettingsMap(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM system_settings').all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return map;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  );
}

export function addAuditLog(actor: string, category: string, level: 'info' | 'warning' | 'error', message: string): void {
  db.prepare('INSERT INTO audit_logs (actor, category, level, message) VALUES (?, ?, ?, ?)').run(
    actor,
    category,
    level,
    message
  );
}
