import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { addAuditLog, db, getSettingsMap, setSetting } from './db.ts';

const SESSION_COOKIE = 'edusignage_session';
const SESSION_SECRET = process.env.EDUSIGNAGE_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

interface SessionPayload {
  username: string;
  exp: number;
}

export function hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(storedHash, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

function signToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as SessionPayload;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

export function getAuthStatus(req: Request): {
  authEnabled: boolean;
  hasAdminUser: boolean;
  authenticated: boolean;
  username: string | null;
} {
  const settings = getSettingsMap();
  const authEnabled = settings.auth_enabled === 'true';
  const adminUser = db.prepare('SELECT username FROM users LIMIT 1').get() as { username: string } | undefined;
  const cookies = parseCookies(req.headers.cookie);
  const session = verifyToken(cookies[SESSION_COOKIE]);

  if (!authEnabled) {
    return {
      authEnabled: false,
      hasAdminUser: Boolean(adminUser),
      authenticated: true,
      username: session?.username || adminUser?.username || 'admin-local',
    };
  }

  return {
    authEnabled: true,
    hasAdminUser: Boolean(adminUser),
    authenticated: Boolean(session),
    username: session?.username || null,
  };
}

export function setSessionCookie(res: Response, username: string): void {
  const token = signToken({
    username,
    exp: Date.now() + 1000 * 60 * 60 * 12,
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 1000 * 60 * 60 * 12,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requireAuthIfEnabled(req: Request, res: Response, next: NextFunction): void {
  const settings = getSettingsMap();
  if (settings.auth_enabled !== 'true') {
    next();
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  const session = verifyToken(cookies[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ error: 'Sesión requerida. Inicia sesión para administrar este dispositivo.' });
    return;
  }
  (req as Request & { adminUser?: string }).adminUser = session.username;
  next();
}

export function configureAdminCredentials(username: string, password: string, enableLock: boolean): void {
  const cleanUser = username.trim() || 'admin';
  if (password.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }
  const { hash, salt } = hashPassword(password);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUser) as { id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, existing.id);
  } else {
    db.prepare('DELETE FROM users').run();
    db.prepare('INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)').run(
      cleanUser,
      hash,
      salt,
      'admin'
    );
  }
  setSetting('auth_enabled', enableLock ? 'true' : 'false');
  addAuditLog(cleanUser, 'security', 'info', `Credenciales de administrador actualizadas (bloqueo=${enableLock}).`);
}
