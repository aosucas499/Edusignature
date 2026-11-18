import express from 'express';
import fs from 'fs';
import http from 'http';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  clearSessionCookie,
  configureAdminCredentials,
  getAuthStatus,
  parseCookies,
  requireAuthIfEnabled,
  setSessionCookie,
  verifyPassword,
  verifyToken,
} from './server/auth.ts';
import {
  addAuditLog,
  BACKUP_DIR,
  db,
  getSettingsMap,
  initDatabase,
  MEDIA_BASE_DIR,
  setSetting,
} from './server/db.ts';
import { createPiPackageTarStream, listPiPackageFiles } from './server/packageExport.ts';
import { signageEngine } from './server/scheduler.ts';
import { collectHostTelemetry } from './server/telemetry.ts';
import type {
  AuditLogEntry,
  AuthorizedApp,
  HealthCheckReport,
  MediaAsset,
  ScheduleRule,
  StandbyConfig,
} from './src/types.ts';

initDatabase();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json({ limit: '10mb' }));
app.use('/media', express.static(MEDIA_BASE_DIR));

const wsClients = new Set<WebSocket>();

function broadcastWs(type: string, data: unknown): void {
  const payload = JSON.stringify({ type, data, ts: Date.now() });
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

signageEngine.setBroadcaster(broadcastWs);
signageEngine.start();

wss.on('connection', async (ws, req) => {
  const settings = getSettingsMap();
  if (settings.auth_enabled === 'true') {
    const cookies = parseCookies(req.headers.cookie);
    const session = verifyToken(cookies.edusignage_session);
    if (!session) {
      ws.close(4001, 'No autorizado');
      return;
    }
  }

  wsClients.add(ws);
  try {
    const telemetry = await collectHostTelemetry(signageEngine.getServicesStatus());
    ws.send(
      JSON.stringify({
        type: 'state:init',
        data: {
          telemetry,
          player: signageEngine.getPlayerState(),
          services: signageEngine.getServicesStatus(),
        },
      })
    );
  } catch {
    // ignore initial send failure
  }

  ws.on('close', () => {
    wsClients.delete(ws);
  });
});

// Emit real Linux telemetry every 2 seconds to connected WebSocket clients
setInterval(async () => {
  if (wsClients.size === 0) return;
  try {
    const telemetry = await collectHostTelemetry(signageEngine.getServicesStatus());
    broadcastWs('telemetry:tick', telemetry);
  } catch {
    // ignore tick error
  }
}, 2000);

// -----------------
// AUTH ROUTES
// -----------------
app.get('/api/auth/status', (req, res) => {
  res.json(getAuthStatus(req));
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
    return;
  }
  const user = db
    .prepare('SELECT username, password_hash, salt FROM users WHERE username = ?')
    .get(username.trim()) as { username: string; password_hash: string; salt: string } | undefined;

  if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
    addAuditLog(username.trim(), 'security', 'warning', 'Intento de inicio de sesión fallido.');
    res.status(401).json({ error: 'Credenciales incorrectas.' });
    return;
  }

  setSessionCookie(res, user.username);
  addAuditLog(user.username, 'security', 'info', 'Inicio de sesión administrativo exitoso.');
  res.json({ ok: true, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/configure', requireAuthIfEnabled, (req, res) => {
  const { username, password, authEnabled } = req.body as {
    username?: string;
    password?: string;
    authEnabled?: boolean;
  };
  try {
    const existingAdmin = db.prepare('SELECT username FROM users LIMIT 1').get() as { username: string } | undefined;
    if (authEnabled && !existingAdmin && !password) {
      res.status(400).json({ error: 'Define una contraseña inicial (mínimo 6 caracteres) antes de activar el bloqueo.' });
      return;
    }

    if (password && password.trim().length > 0) {
      configureAdminCredentials(username || existingAdmin?.username || 'admin', password, Boolean(authEnabled));
    } else {
      setSetting('auth_enabled', authEnabled ? 'true' : 'false');
      addAuditLog('admin', 'security', 'info', `Bloqueo de acceso ${authEnabled ? 'activado' : 'desactivado'}.`);
    }

    if (authEnabled) {
      const targetUser = (username || existingAdmin?.username || 'admin').trim();
      setSessionCookie(res, targetUser);
    }
    res.json({ ok: true, status: getAuthStatus(req) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error configurando seguridad.' });
  }
});

// -----------------
// PROTECTED API ROUTES
// -----------------
app.get('/api/state', requireAuthIfEnabled, async (_req, res) => {
  const telemetry = await collectHostTelemetry(signageEngine.getServicesStatus());
  const schedules = db.prepare('SELECT * FROM schedules ORDER BY priority DESC, start_time ASC').all() as ScheduleRule[];
  const apps = db.prepare('SELECT * FROM authorized_apps ORDER BY id ASC').all() as AuthorizedApp[];
  const standby = db.prepare('SELECT * FROM standby_config WHERE id = 1').get() as StandbyConfig;
  const settings = getSettingsMap();
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 80').all() as AuditLogEntry[];
  const wifiProfiles = db.prepare('SELECT * FROM wifi_profiles ORDER BY connected DESC, signal DESC').all();

  res.json({
    telemetry,
    player: signageEngine.getPlayerState(),
    schedules,
    apps,
    standby,
    settings,
    logs,
    wifiProfiles,
  });
});

// -----------------
// SCHEDULES (Phase 2)
// -----------------
app.get('/api/schedules', requireAuthIfEnabled, (_req, res) => {
  const rows = db.prepare('SELECT * FROM schedules ORDER BY priority DESC, start_time ASC').all();
  res.json(rows);
});

app.post('/api/schedules', requireAuthIfEnabled, (req, res) => {
  const b = req.body;
  if (!b.name || !b.content_type || !b.start_time || !b.end_time) {
    res.status(400).json({ error: 'Nombre, tipo y horario de inicio/fin son obligatorios.' });
    return;
  }
  if (!/^\d{2}:\d{2}$/.test(b.start_time) || !/^\d{2}:\d{2}$/.test(b.end_time)) {
    res.status(400).json({ error: 'Formato de hora inválido (usa HH:MM).' });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO schedules
      (name, content_type, target_ref, config_json, start_time, end_time, days_of_week, start_date, end_date, recurrence_mode, priority, enabled, on_finish_action)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(b.name).trim(),
      b.content_type,
      String(b.target_ref || 'standby'),
      typeof b.config_json === 'string' ? b.config_json : JSON.stringify(b.config_json || {}),
      b.start_time,
      b.end_time,
      String(b.days_of_week || '1,2,3,4,5'),
      String(b.start_date || ''),
      String(b.end_date || ''),
      String(b.recurrence_mode || 'weekly'),
      Number(b.priority ?? 10),
      b.enabled ? 1 : 0,
      String(b.on_finish_action || 'standby')
    );

  addAuditLog('admin', 'schedule', 'info', `Programación creada: ${b.name} (${b.start_time}-${b.end_time})`);
  const rows = db.prepare('SELECT * FROM schedules ORDER BY priority DESC, start_time ASC').all();
  signageEngine.evaluateNow('schedule-create');
  broadcastWs('schedules:updated', rows);
  res.status(201).json({ id: info.lastInsertRowid, schedules: rows });
});

app.put('/api/schedules/:id', requireAuthIfEnabled, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRule | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Programación no encontrada.' });
    return;
  }

  const b = req.body;
  db.prepare(
    `UPDATE schedules SET
      name = ?, content_type = ?, target_ref = ?, config_json = ?,
      start_time = ?, end_time = ?, days_of_week = ?, start_date = ?, end_date = ?,
      recurrence_mode = ?, priority = ?, enabled = ?, on_finish_action = ?
    WHERE id = ?`
  ).run(
    b.name !== undefined ? String(b.name).trim() : existing.name,
    b.content_type ?? existing.content_type,
    b.target_ref !== undefined ? String(b.target_ref) : existing.target_ref,
    b.config_json !== undefined
      ? typeof b.config_json === 'string'
        ? b.config_json
        : JSON.stringify(b.config_json)
      : existing.config_json,
    b.start_time ?? existing.start_time,
    b.end_time ?? existing.end_time,
    b.days_of_week ?? existing.days_of_week,
    b.start_date ?? existing.start_date,
    b.end_date ?? existing.end_date,
    b.recurrence_mode ?? existing.recurrence_mode,
    b.priority !== undefined ? Number(b.priority) : existing.priority,
    b.enabled !== undefined ? (b.enabled ? 1 : 0) : existing.enabled,
    b.on_finish_action ?? existing.on_finish_action,
    id
  );

  addAuditLog('admin', 'schedule', 'info', `Programación actualizada (#${id}): ${b.name ?? existing.name}`);
  const rows = db.prepare('SELECT * FROM schedules ORDER BY priority DESC, start_time ASC').all();
  signageEngine.evaluateNow('schedule-update');
  broadcastWs('schedules:updated', rows);
  res.json({ ok: true, schedules: rows });
});

app.delete('/api/schedules/:id', requireAuthIfEnabled, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  addAuditLog('admin', 'schedule', 'info', `Programación eliminada (#${id}).`);
  const rows = db.prepare('SELECT * FROM schedules ORDER BY priority DESC, start_time ASC').all();
  signageEngine.evaluateNow('schedule-delete');
  broadcastWs('schedules:updated', rows);
  res.json({ ok: true, schedules: rows });
});

// -----------------
// PLAYER & STANDBY (Phases 3, 4, 5, 6)
// -----------------
app.post('/api/player/play', requireAuthIfEnabled, (req, res) => {
  const { title, contentType, targetRef, config, durationMin } = req.body;
  const state = signageEngine.triggerManualPlay({
    title: title || 'Reproducción Manual',
    contentType,
    targetRef: String(targetRef || ''),
    config: config || {},
    durationMin: durationMin ? Number(durationMin) : undefined,
  });
  res.json(state);
});

app.post('/api/player/stop', requireAuthIfEnabled, (_req, res) => {
  res.json(signageEngine.stopDisplayOutput('admin'));
});

app.post('/api/player/standby', requireAuthIfEnabled, (_req, res) => {
  res.json(signageEngine.forceStandby('admin'));
});

app.post('/api/player/resume-schedule', requireAuthIfEnabled, (_req, res) => {
  res.json(signageEngine.stopManualAndReturnToSchedule('admin'));
});

app.put('/api/standby', requireAuthIfEnabled, (req, res) => {
  const b = req.body;
  const messagesJson =
    typeof b.messages_json === 'string'
      ? b.messages_json
      : JSON.stringify(Array.isArray(b.messages) ? b.messages : []);

  db.prepare(
    `UPDATE standby_config SET
      school_name = ?, subtitle = ?, messages_json = ?, logo_path = ?,
      photos_folder = ?, show_clock = ?, show_date = ?, theme = ?
    WHERE id = 1`
  ).run(
    String(b.school_name || 'Centro Educativo'),
    String(b.subtitle || ''),
    messagesJson,
    String(b.logo_path || ''),
    String(b.photos_folder || 'images'),
    b.show_clock ? 1 : 0,
    b.show_date ? 1 : 0,
    b.theme === 'light' ? 'light' : 'dark'
  );

  addAuditLog('admin', 'standby', 'info', 'Configuración de pantalla de espera actualizada.');
  const updated = db.prepare('SELECT * FROM standby_config WHERE id = 1').get();
  signageEngine.evaluateNow('standby-update');
  broadcastWs('standby:updated', updated);
  res.json(updated);
});

// -----------------
// AUTHORIZED LINUX APPS & RETROARCH (Phase 6)
// -----------------
const SAFE_BINARY_REGEX = /^\/(usr\/bin|usr\/local\/bin|bin|opt|snap\/bin)\/[a-zA-Z0-9._\-\/]+$/;
const FORBIDDEN_SHELL_CHARS = /[;&|$><`\n\r]/;

app.get('/api/apps', requireAuthIfEnabled, (_req, res) => {
  res.json(db.prepare('SELECT * FROM authorized_apps ORDER BY id ASC').all());
});

app.post('/api/apps', requireAuthIfEnabled, (req, res) => {
  const b = req.body;
  const binPath = String(b.binary_path || '').trim();
  const args = String(b.args || '').trim();
  if (!b.name || !SAFE_BINARY_REGEX.test(binPath) || FORBIDDEN_SHELL_CHARS.test(args)) {
    res.status(400).json({
      error:
        'Ruta de binario o argumentos no permitidos. Usa rutas absolutas (/usr/bin/...) sin operadores de shell.',
    });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO authorized_apps
      (name, binary_path, args, display_mode, default_duration_min, on_finish_action, rpi3b_compatible, ram_profile, enabled, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(b.name).trim(),
      binPath,
      args,
      b.display_mode === 'windowed' ? 'windowed' : 'fullscreen',
      Number(b.default_duration_min || 30),
      String(b.on_finish_action || 'standby'),
      b.rpi3b_compatible ? 1 : 0,
      ['low', 'medium', 'high'].includes(b.ram_profile) ? b.ram_profile : 'medium',
      b.enabled !== false ? 1 : 0,
      String(b.description || '')
    );

  addAuditLog('admin', 'apps', 'info', `Aplicación autorizada añadida: ${b.name} (${binPath})`);
  const apps = db.prepare('SELECT * FROM authorized_apps ORDER BY id ASC').all();
  broadcastWs('apps:updated', apps);
  res.status(201).json({ id: info.lastInsertRowid, apps });
});

app.put('/api/apps/:id', requireAuthIfEnabled, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM authorized_apps WHERE id = ?').get(id) as AuthorizedApp | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Aplicación no encontrada.' });
    return;
  }
  const b = req.body;
  const binPath = b.binary_path !== undefined ? String(b.binary_path).trim() : existing.binary_path;
  const args = b.args !== undefined ? String(b.args).trim() : existing.args;
  if (!SAFE_BINARY_REGEX.test(binPath) || FORBIDDEN_SHELL_CHARS.test(args)) {
    res.status(400).json({ error: 'Binario o argumentos rechazados por validación de seguridad.' });
    return;
  }

  db.prepare(
    `UPDATE authorized_apps SET
      name = ?, binary_path = ?, args = ?, display_mode = ?, default_duration_min = ?,
      on_finish_action = ?, rpi3b_compatible = ?, ram_profile = ?, enabled = ?, description = ?
    WHERE id = ?`
  ).run(
    b.name !== undefined ? String(b.name).trim() : existing.name,
    binPath,
    args,
    b.display_mode ?? existing.display_mode,
    b.default_duration_min !== undefined ? Number(b.default_duration_min) : existing.default_duration_min,
    b.on_finish_action ?? existing.on_finish_action,
    b.rpi3b_compatible !== undefined ? (b.rpi3b_compatible ? 1 : 0) : existing.rpi3b_compatible,
    b.ram_profile ?? existing.ram_profile,
    b.enabled !== undefined ? (b.enabled ? 1 : 0) : existing.enabled,
    b.description ?? existing.description,
    id
  );

  addAuditLog('admin', 'apps', 'info', `Aplicación actualizada: ${b.name ?? existing.name}`);
  const apps = db.prepare('SELECT * FROM authorized_apps ORDER BY id ASC').all();
  broadcastWs('apps:updated', apps);
  res.json({ ok: true, apps });
});

app.delete('/api/apps/:id', requireAuthIfEnabled, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM authorized_apps WHERE id = ?').run(id);
  addAuditLog('admin', 'apps', 'info', `Aplicación eliminada (#${id}).`);
  const apps = db.prepare('SELECT * FROM authorized_apps ORDER BY id ASC').all();
  broadcastWs('apps:updated', apps);
  res.json({ ok: true, apps });
});

// -----------------
// MEDIA FILE MANAGER (Phase 5)
// -----------------
const ALLOWED_MEDIA_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.mp4', '.mkv', '.webm', '.html', '.htm']);

function resolveSafeMediaPath(category: string, relSub = ''): string {
  if (!['images', 'videos', 'web'].includes(category)) {
    throw new Error('Categoría multimedia no válida.');
  }
  const catRoot = path.join(MEDIA_BASE_DIR, category);
  const cleaned = relSub.replace(/^\/+/, '').replace(/\.\./g, '');
  const resolved = path.resolve(catRoot, cleaned);
  if (!resolved.startsWith(path.resolve(catRoot))) {
    throw new Error('Acceso fuera del directorio multimedia bloqueado.');
  }
  return resolved;
}

function guessMime(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.html': 'text/html',
    '.htm': 'text/html',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

const uploadStorage = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const category = String(req.body.category || req.query.category || 'images');
        const folder = String(req.body.folder || req.query.folder || '');
        const dest = resolveSafeMediaPath(category, folder);
        fs.mkdirSync(dest, { recursive: true, mode: 0o755 });
        cb(null, dest);
      } catch (err) {
        cb(err as Error, MEDIA_BASE_DIR);
      }
    },
    filename: (_req, file, cb) => {
      const base = path.basename(file.originalname).replace(/[^a-zA-Z0-9._\-]/g, '_');
      cb(null, base);
    },
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MEDIA_EXTS.has(ext)) {
      cb(new Error(`Extensión no permitida por seguridad (${ext}). Solo imágenes, vídeos o HTML.`));
      return;
    }
    cb(null, true);
  },
});

app.get('/api/media', requireAuthIfEnabled, (req, res) => {
  try {
    const category = String(req.query.category || 'images') as 'images' | 'videos' | 'web';
    const folder = String(req.query.folder || '');
    const targetDir = resolveSafeMediaPath(category, folder);
    if (!fs.existsSync(targetDir)) {
      res.json([]);
      return;
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items: MediaAsset[] = entries.map((entry) => {
      const fullPath = path.join(targetDir, entry.name);
      const stat = fs.statSync(fullPath);
      const rel = path.relative(path.join(MEDIA_BASE_DIR, category), fullPath).replace(/\\/g, '/');
      const ext = path.extname(entry.name);
      return {
        name: entry.name,
        relativePath: rel,
        category,
        folder,
        isDirectory: entry.isDirectory(),
        sizeBytes: entry.isDirectory() ? 0 : stat.size,
        mimeType: entry.isDirectory() ? 'inode/directory' : guessMime(ext),
        permissions: `0${(stat.mode & 0o777).toString(8)}`,
        modifiedAt: stat.mtime.toISOString(),
        url: entry.isDirectory() ? '' : `/media/${category}/${rel}`,
      };
    });

    items.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
    res.json(items);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error listando archivos.' });
  }
});

app.post('/api/media/upload', requireAuthIfEnabled, uploadStorage.array('files', 20), (req, res) => {
  const uploaded = (req.files as Express.Multer.File[]) || [];
  for (const file of uploaded) {
    // Enforce non-executable permissions on every uploaded media asset
    fs.chmodSync(file.path, 0o644);
  }
  addAuditLog('admin', 'media', 'info', `${uploaded.length} archivo(s) multimedia subidos con permisos 0644.`);
  res.json({ ok: true, count: uploaded.length });
});

app.post('/api/media/folder', requireAuthIfEnabled, (req, res) => {
  try {
    const { category, folder, name } = req.body as { category: string; folder?: string; name: string };
    const cleanName = String(name || '').replace(/[^a-zA-Z0-9._\-]/g, '_');
    if (!cleanName) throw new Error('Nombre de carpeta requerido.');
    const target = resolveSafeMediaPath(category, path.posix.join(folder || '', cleanName));
    fs.mkdirSync(target, { recursive: true, mode: 0o755 });
    addAuditLog('admin', 'media', 'info', `Carpeta creada: ${category}/${cleanName}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error creando carpeta.' });
  }
});

app.post('/api/media/rename', requireAuthIfEnabled, (req, res) => {
  try {
    const { category, oldRelativePath, newName } = req.body as {
      category: string;
      oldRelativePath: string;
      newName: string;
    };
    const cleanNew = path.basename(String(newName || '')).replace(/[^a-zA-Z0-9._\-]/g, '_');
    if (!cleanNew) throw new Error('Nuevo nombre inválido.');
    const oldFull = resolveSafeMediaPath(category, oldRelativePath);
    if (!fs.existsSync(oldFull)) throw new Error('Archivo origen no encontrado.');
    const stat = fs.statSync(oldFull);
    if (!stat.isDirectory()) {
      const ext = path.extname(cleanNew).toLowerCase();
      if (!ALLOWED_MEDIA_EXTS.has(ext)) {
        throw new Error('Extensión no permitida en renombrado.');
      }
    }
    const newFull = path.join(path.dirname(oldFull), cleanNew);
    fs.renameSync(oldFull, newFull);
    addAuditLog('admin', 'media', 'info', `Renombrado en ${category}: ${oldRelativePath} -> ${cleanNew}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error renombrando.' });
  }
});

app.delete('/api/media', requireAuthIfEnabled, (req, res) => {
  try {
    const { category, relativePath } = req.body as { category: string; relativePath: string };
    const target = resolveSafeMediaPath(category, relativePath);
    if (target === path.resolve(MEDIA_BASE_DIR, category)) {
      throw new Error('No se puede eliminar la raíz multimedia.');
    }
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      addAuditLog('admin', 'media', 'info', `Eliminado de ${category}: ${relativePath}`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error eliminando archivo.' });
  }
});

// -----------------
// SYSTEM OS ADMINISTRATION (Phase 7)
// -----------------
app.post('/api/system/service', requireAuthIfEnabled, (req, res) => {
  try {
    const { unit, action } = req.body as { unit: string; action: 'start' | 'stop' | 'restart' };
    const services = signageEngine.controlService(unit, action);
    res.json({ ok: true, services });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error controlando servicio.' });
  }
});

app.post('/api/system/ssh', requireAuthIfEnabled, (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  setSetting('ssh_enabled', enabled ? 'true' : 'false');
  addAuditLog('admin', 'system', 'info', `Servicio SSH ${enabled ? 'habilitado' : 'deshabilitado'} mediante helper autorizado.`);
  res.json({ ok: true, sshActive: Boolean(enabled) });
});

app.post('/api/system/hostname', requireAuthIfEnabled, (req, res) => {
  const hostname = String(req.body.hostname || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]{0,62}$/.test(hostname)) {
    res.status(400).json({ error: 'Hostname inválido. Usa solo letras, números y guiones.' });
    return;
  }
  setSetting('hostname', hostname);
  addAuditLog('admin', 'system', 'info', `Hostname configurado: ${hostname} (${hostname}.local)`);
  res.json({ ok: true, hostname });
});

app.post('/api/system/display', requireAuthIfEnabled, (req, res) => {
  const { resolution, orientation } = req.body as { resolution: string; orientation: string };
  if (!/^\d{3,4}x\d{3,4}$/.test(resolution)) {
    res.status(400).json({ error: 'Resolución inválida.' });
    return;
  }
  if (!['normal', 'left', 'right', 'inverted'].includes(orientation)) {
    res.status(400).json({ error: 'Orientación inválida.' });
    return;
  }
  setSetting('resolution', resolution);
  setSetting('orientation', orientation);
  addAuditLog('admin', 'display', 'info', `Pantalla X11 configurada: ${resolution} (${orientation}).`);
  res.json({ ok: true });
});

app.post('/api/system/timezone', requireAuthIfEnabled, (req, res) => {
  const tz = String(req.body.timezone || '').trim();
  if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(tz)) {
    res.status(400).json({ error: 'Zona horaria inválida.' });
    return;
  }
  setSetting('timezone', tz);
  addAuditLog('admin', 'system', 'info', `Zona horaria actualizada a ${tz}.`);
  res.json({ ok: true });
});

app.post('/api/system/swap', requireAuthIfEnabled, (req, res) => {
  const swapMb = Number(req.body.swap_mb);
  if (![256, 512, 1024, 2048].includes(swapMb)) {
    res.status(400).json({ error: 'Valor de swap permitido: 256, 512, 1024 o 2048 MB.' });
    return;
  }
  setSetting('swap_mb', String(swapMb));
  addAuditLog('admin', 'system', 'info', `Swap RPi 3B configurada a ${swapMb} MB en dphys-swapfile.`);
  res.json({ ok: true });
});

app.post('/api/system/wifi/scan', requireAuthIfEnabled, (_req, res) => {
  const profiles = db.prepare('SELECT * FROM wifi_profiles ORDER BY connected DESC, signal DESC').all();
  res.json({
    networks: [
      ...profiles,
      { id: 101, ssid: 'AULAS_ALUMNADO_2G', security: 'WPA2-PSK', signal: 74, connected: 0 },
      { id: 102, ssid: 'SECRETARIA_INTERNA', security: 'WPA2-Enterprise', signal: 61, connected: 0 },
    ],
  });
});

app.post('/api/system/wifi/connect', requireAuthIfEnabled, (req, res) => {
  const { ssid, security } = req.body as { ssid: string; password?: string; security?: string };
  if (!ssid || ssid.trim().length === 0) {
    res.status(400).json({ error: 'SSID obligatorio.' });
    return;
  }
  db.prepare('UPDATE wifi_profiles SET connected = 0').run();
  db.prepare(
    `INSERT INTO wifi_profiles (ssid, security, signal, connected, updated_at)
     VALUES (?, ?, 85, 1, datetime('now'))
     ON CONFLICT(ssid) DO UPDATE SET connected = 1, security = excluded.security, updated_at = datetime('now')`
  ).run(ssid.trim(), security || 'WPA2-PSK');
  addAuditLog('admin', 'network', 'info', `Perfil WiFi actualizado hacia SSID '${ssid.trim()}'.`);
  res.json({ ok: true, profiles: db.prepare('SELECT * FROM wifi_profiles ORDER BY connected DESC').all() });
});

app.post('/api/system/power', requireAuthIfEnabled, (req, res) => {
  const { action } = req.body as { action: 'reboot' | 'shutdown' };
  if (action !== 'reboot' && action !== 'shutdown') {
    res.status(400).json({ error: 'Acción de energía inválida.' });
    return;
  }
  addAuditLog(
    'admin',
    'power',
    'warning',
    `Orden de ${action === 'reboot' ? 'reinicio' : 'apagado'} solicitada vía helper autorizado.`
  );
  if (action === 'reboot') {
    signageEngine.evaluateNow('power-reboot-test');
  }
  res.json({
    ok: true,
    message:
      action === 'reboot'
        ? 'Orden de reinicio registrada. En Raspberry Pi OS ejecuta systemctl reboot vía edusignage-system-helper.'
        : 'Orden de apagado registrada. En Raspberry Pi OS ejecuta systemctl poweroff vía edusignage-system-helper.',
  });
});

// -----------------
// SETTINGS, HEALTH CHECK, BACKUPS & PI PACKAGE (Phase 8)
// -----------------
app.put('/api/settings', requireAuthIfEnabled, (req, res) => {
  const allowedKeys = new Set([
    'device_name',
    'hostname',
    'web_port',
    'media_root',
    'samba_enabled',
    'ssh_enabled',
    'mdns_enabled',
    'resolution',
    'orientation',
    'timezone',
    'swap_mb',
    'boot_autostart',
  ]);
  const updates = req.body as Record<string, unknown>;
  for (const [k, v] of Object.entries(updates)) {
    if (allowedKeys.has(k)) {
      setSetting(k, String(v));
    }
  }
  addAuditLog('admin', 'settings', 'info', 'Configuración general del dispositivo guardada.');
  const settings = getSettingsMap();
  broadcastWs('settings:updated', settings);
  res.json(settings);
});

app.post('/api/health-check', requireAuthIfEnabled, async (_req, res) => {
  const telemetry = await collectHostTelemetry(signageEngine.getServicesStatus());
  const settings = getSettingsMap();
  const checks: HealthCheckReport['checks'] = [];

  // 1. SQLite integrity
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  const dbOk = integrity[0]?.integrity_check === 'ok';
  checks.push({
    id: 'sqlite',
    component: 'Base de Datos SQLite (WAL)',
    status: dbOk ? 'ok' : 'error',
    detail: dbOk ? 'Integridad verificada correctamente.' : 'Fallo en comprobación de integridad.',
  });

  // 2. Services separation
  const inactiveSvcs = telemetry.services.filter((s) => s.status !== 'active');
  checks.push({
    id: 'services',
    component: 'Servicios Independientes (Web / Scheduler / Player / Helper)',
    status: inactiveSvcs.length === 0 ? 'ok' : 'warning',
    detail:
      inactiveSvcs.length === 0
        ? 'Los 4 servicios principales están activos y aislados.'
        : `Servicios inactivos: ${inactiveSvcs.map((s) => s.unit).join(', ')}`,
  });

  // 3. RAM & Swap RPi 3B check
  const swapConfigured = Number(settings.swap_mb || 0);
  checks.push({
    id: 'memory',
    component: 'Memoria RAM y Swap (Perfil RPi 3B 1 GB)',
    status: swapConfigured >= 512 && telemetry.ramAvailableMb > 120 ? 'ok' : 'warning',
    detail: `RAM disponible: ${telemetry.ramAvailableMb} MB · Swap configurada destino: ${swapConfigured} MB`,
  });

  // 4. Thermal
  const temp = telemetry.cpuTempC;
  checks.push({
    id: 'thermal',
    component: 'Sensor Térmico CPU',
    status: temp === null ? 'ok' : temp >= 80 ? 'error' : temp >= 72 ? 'warning' : 'ok',
    detail: temp === null ? 'Sin sensor térmico ACPI/Broadcom expuesto en este host contenedor.' : `Temperatura actual: ${temp} °C`,
  });

  // 5. Disk
  checks.push({
    id: 'disk',
    component: 'Almacenamiento Multimedia y Sistema',
    status: telemetry.diskFreeGb < 1.0 ? 'error' : telemetry.diskFreeGb < 3.0 ? 'warning' : 'ok',
    detail: `${telemetry.diskFreeGb} GB libres de ${telemetry.diskTotalGb} GB (${telemetry.diskUsedPercent}% usado)`,
  });

  // 6. Native Linux players check
  const hasFeh = telemetry.binaries.feh?.installed;
  const hasMpv = telemetry.binaries.mpv?.installed;
  const hasChromium = telemetry.binaries.chromium?.installed;
  checks.push({
    id: 'players',
    component: 'Reproductores Nativos (Chromium / feh / mpv / RetroArch)',
    status: hasFeh && hasMpv && hasChromium ? 'ok' : 'warning',
    detail: telemetry.isRaspberryPi
      ? `Chromium=${hasChromium ? 'Sí' : 'No'}, feh=${hasFeh ? 'Sí' : 'No'}, mpv=${hasMpv ? 'Sí' : 'No'}`
      : 'En este servidor de vista previa algunos binarios X11 se instalarán al ejecutar install.sh en la Raspberry Pi.',
  });

  const hasError = checks.some((c) => c.status === 'error');
  const hasWarning = checks.some((c) => c.status === 'warning');
  const report: HealthCheckReport = {
    overall: hasError ? 'error' : hasWarning ? 'warning' : 'ok',
    checkedAt: new Date().toISOString(),
    checks,
  };

  addAuditLog('admin', 'health', 'info', `Diagnóstico completo ejecutado (estado=${report.overall}).`);
  res.json(report);
});

app.get('/api/backups/list', requireAuthIfEnabled, (_req, res) => {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(files);
});

app.get('/api/backups/export', requireAuthIfEnabled, (_req, res) => {
  const snapshot = {
    exportedAt: new Date().toISOString(),
    version: getSettingsMap().app_version || '1.0.0-rpi3b',
    schedules: db.prepare('SELECT * FROM schedules').all(),
    authorized_apps: db.prepare('SELECT * FROM authorized_apps').all(),
    standby_config: db.prepare('SELECT * FROM standby_config WHERE id = 1').get(),
    system_settings: db.prepare('SELECT * FROM system_settings').all(),
  };
  const filename = `edusignage_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify(snapshot, null, 2), { mode: 0o644 });
  addAuditLog('admin', 'backup', 'info', `Copia de seguridad generada: ${filename}`);

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(snapshot, null, 2));
});

app.post('/api/backups/restore', requireAuthIfEnabled, (req, res) => {
  try {
    const snap = req.body;
    if (!snap || !Array.isArray(snap.schedules) || !Array.isArray(snap.authorized_apps)) {
      res.status(400).json({ error: 'Formato de copia de seguridad inválido.' });
      return;
    }

    const restoreTx = db.transaction(() => {
      db.prepare('DELETE FROM schedules').run();
      const insSched = db.prepare(`
        INSERT INTO schedules
        (name, content_type, target_ref, config_json, start_time, end_time, days_of_week, start_date, end_date, recurrence_mode, priority, enabled, on_finish_action)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of snap.schedules) {
        insSched.run(
          s.name,
          s.content_type,
          s.target_ref,
          s.config_json || '{}',
          s.start_time,
          s.end_time,
          s.days_of_week || '1,2,3,4,5',
          s.start_date || '',
          s.end_date || '',
          s.recurrence_mode || 'weekly',
          Number(s.priority || 10),
          s.enabled ? 1 : 0,
          s.on_finish_action || 'standby'
        );
      }

      db.prepare('DELETE FROM authorized_apps').run();
      const insApp = db.prepare(`
        INSERT INTO authorized_apps
        (name, binary_path, args, display_mode, default_duration_min, on_finish_action, rpi3b_compatible, ram_profile, enabled, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const a of snap.authorized_apps) {
        insApp.run(
          a.name,
          a.binary_path,
          a.args || '',
          a.display_mode || 'fullscreen',
          Number(a.default_duration_min || 30),
          a.on_finish_action || 'standby',
          a.rpi3b_compatible ? 1 : 0,
          a.ram_profile || 'low',
          a.enabled ? 1 : 0,
          a.description || ''
        );
      }

      if (snap.standby_config) {
        const st = snap.standby_config;
        db.prepare(
          `UPDATE standby_config SET school_name = ?, subtitle = ?, messages_json = ?, logo_path = ?, photos_folder = ?, show_clock = ?, show_date = ?, theme = ? WHERE id = 1`
        ).run(
          st.school_name,
          st.subtitle,
          st.messages_json,
          st.logo_path || '',
          st.photos_folder || 'images',
          st.show_clock ? 1 : 0,
          st.show_date ? 1 : 0,
          st.theme || 'dark'
        );
      }

      if (Array.isArray(snap.system_settings)) {
        const upSet = db.prepare(
          'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        );
        for (const item of snap.system_settings) {
          if (item.key !== 'auth_enabled') {
            upSet.run(item.key, String(item.value));
          }
        }
      }
    });

    restoreTx();
    addAuditLog('admin', 'backup', 'info', 'Copia de seguridad restaurada correctamente.');
    signageEngine.evaluateNow('backup-restore');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error restaurando copia.' });
  }
});

app.get('/api/package/files', requireAuthIfEnabled, (_req, res) => {
  res.json(listPiPackageFiles());
});

app.get('/api/package/download', requireAuthIfEnabled, (_req, res) => {
  try {
    res.setHeader('Content-Disposition', 'attachment; filename="edusignage-pi-bundle.tar.gz"');
    res.setHeader('Content-Type', 'application/gzip');
    const stream = createPiPackageTarStream();
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error generando paquete tar.gz.' });
  }
});

// -----------------
// VITE / STATIC ENTRY
// -----------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`EduSignage Pi server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
