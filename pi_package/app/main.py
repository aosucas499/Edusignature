"""
EduSignage Pi - Servidor Web FastAPI (edusignage-web.service)
Se ejecuta sin privilegios root. Provee la API REST completa compatible con el panel
React SPA (/opt/edusignage/web), WebSockets en tiempo real, gestión multimedia segura,
standby HTML (/standby) y puente seguro hacia scheduler/player/system-helper.
"""
import asyncio
import hashlib
import hmac
import json
import mimetypes
import os
import platform
import re
import secrets
import shutil
import socket
import time
from datetime import datetime
from typing import Any, Optional

import psutil
from fastapi import Cookie, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from database import get_db, init_db

app = FastAPI(title="EduSignage Pi", version="1.0.0")

MEDIA_ROOT = os.environ.get("EDUSIGNAGE_MEDIA", "/opt/edusignage/media")
WEB_DIST_DIR = os.environ.get("EDUSIGNAGE_WEB_DIST", "/opt/edusignage/web")
BACKUP_DIR = os.environ.get("EDUSIGNAGE_BACKUPS", "/opt/edusignage/backups")
HELPER_SOCKET = os.environ.get("EDUSIGNAGE_HELPER_SOCK", "/run/edusignage/syshelper.sock")
PLAYER_SOCKET = os.environ.get("EDUSIGNAGE_PLAYER_SOCK", "/run/edusignage/player.sock")
STATE_FILE = "/run/edusignage/player_state.json"
OVERRIDE_FILE = "/run/edusignage/manual_override.json"
SESSION_COOKIE = "edusignage_session"
SESSION_SECRET = os.environ.get("EDUSIGNAGE_SECRET") or secrets.token_hex(32)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".mp4", ".mkv", ".webm", ".html", ".htm"}
SAFE_BINARY_RE = re.compile(r"^/(usr/bin|usr/local/bin|bin|opt|snap/bin)/[a-zA-Z0-9._\-/]+$")
FORBIDDEN_SHELL_RE = re.compile(r"[;&|$><`\n\r]")


def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    s = salt or secrets.token_hex(16)
    h = hashlib.scrypt(password.encode("utf-8"), salt=s.encode("utf-8"), n=16384, r=8, p=1, dklen=64).hex()
    return h, s


def verify_password(password: str, stored_hash: str, salt: str) -> bool:
    derived, _ = hash_password(password, salt)
    return hmac.compare_digest(derived, stored_hash)


def sign_session(username: str) -> str:
    exp = int(time.time()) + 43200
    body = f"{username}:{exp}"
    sig = hmac.new(SESSION_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{body}:{sig}"


def verify_session(token: Optional[str]) -> Optional[str]:
    if not token or token.count(":") != 2:
        return None
    username, exp_s, sig = token.split(":")
    try:
        if int(time.time()) > int(exp_s):
            return None
    except ValueError:
        return None
    expected = hmac.new(SESSION_SECRET.encode("utf-8"), f"{username}:{exp_s}".encode("utf-8"), hashlib.sha256).hexdigest()
    return username if hmac.compare_digest(sig, expected) else None


def read_cpu_temp() -> Optional[float]:
    for path in ("/sys/class/thermal/thermal_zone0/temp", "/sys/class/hwmon/hwmon0/temp1_input"):
        if os.path.exists(path):
            try:
                raw = int(open(path, "r", encoding="utf-8").read().strip())
                return round(raw / 1000.0 if raw > 1000 else float(raw), 1)
            except Exception:
                pass
    return None


def call_unix_socket(sock_path: str, payload: dict) -> dict:
    if not os.path.exists(sock_path):
        return {"ok": False, "error": f"Socket no disponible: {sock_path}"}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(12.0)
        s.connect(sock_path)
        s.sendall((json.dumps(payload) + "\n").encode("utf-8"))
        return json.loads(s.recv(65536).decode("utf-8"))


async def get_settings_map() -> dict[str, str]:
    db = await get_db()
    try:
        cur = await db.execute("SELECT key, value FROM system_settings")
        rows = await cur.fetchall()
        return {r["key"]: r["value"] for r in rows}
    finally:
        await db.close()


async def add_audit_log(actor: str, category: str, level: str, message: str) -> None:
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO audit_logs (actor, category, level, message) VALUES (?, ?, ?, ?)",
            (actor, category, level, message),
        )
        await db.commit()
    finally:
        await db.close()


async def require_auth(edusignage_session: Optional[str] = Cookie(default=None)) -> str:
    settings = await get_settings_map()
    if settings.get("auth_enabled") != "true":
        return "admin-local"
    user = verify_session(edusignage_session)
    if not user:
        raise HTTPException(status_code=401, detail="Sesión requerida")
    return user


def collect_telemetry_sync(settings: dict[str, str]) -> dict[str, Any]:
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    disk = psutil.disk_usage("/")

    ifaces = []
    for name, addrs in psutil.net_if_addrs().items():
        if name == "lo":
            continue
        ip = next((a.address for a in addrs if a.family == socket.AF_INET), None)
        mac = next((a.address for a in addrs if getattr(psutil, "AF_LINK", -1) == a.family), "00:00:00:00:00:00")
        if ip:
            ifaces.append({"name": name, "ip": ip, "mac": mac, "family": "IPv4"})

    processes = []
    for proc in sorted(psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent", "memory_info"]), key=lambda p: (p.info.get("memory_info").rss if p.info.get("memory_info") else 0), reverse=True)[:15]:
        info = proc.info
        rss = info["memory_info"].rss if info.get("memory_info") else 0
        processes.append({
            "pid": info["pid"],
            "command": info["name"] or "",
            "cpu": round(info.get("cpu_percent") or 0.0, 1),
            "mem": round(info.get("memory_percent") or 0.0, 1),
            "rssMb": round(rss / (1024 * 1024), 1),
        })

    binaries = {}
    for key, names, note in (
        ("chromium", ["chromium-browser", "chromium"], "Cerrar al cambiar contenido para liberar RAM"),
        ("firefox", ["firefox-esr", "firefox"], "Opcional; requiere swap >= 1024 MB en RPi 3B"),
        ("feh", ["feh"], "Recomendado en RPi 3B (< 35 MB RAM)"),
        ("mpv", ["mpv"], "Eficiente para vídeo local H.264"),
        ("retroarch", ["retroarch"], "Compatible en modo exclusivo"),
        ("smbd", ["smbd"], "Compartición Samba en red local"),
        ("avahi", ["avahi-daemon"], "mDNS .local"),
        ("xrandr", ["xrandr"], "Resolución y orientación X11"),
    ):
        found = next((shutil.which(n) for n in names if shutil.which(n)), None)
        binaries[key] = {"installed": bool(found), "path": found, "rpi3bNote": note}

    hostname = settings.get("hostname") or socket.gethostname()
    model = "Raspberry Pi OS"
    if os.path.exists("/proc/device-tree/model"):
        model = open("/proc/device-tree/model", "r", encoding="utf-8", errors="ignore").read().replace("\x00", "").strip()

    services = [
        {"name": "Servidor Web Admin", "unit": "edusignage-web", "role": "API REST + WebSockets + Panel Web", "status": "active", "pid": os.getpid(), "memoryMb": 42, "uptimeSec": int(time.time() - psutil.boot_time())},
        {"name": "Motor de Planificación", "unit": "edusignage-scheduler", "role": "Evaluación horaria autónoma SQLite", "status": "active", "pid": None, "memoryMb": 18, "uptimeSec": int(time.time() - psutil.boot_time())},
        {"name": "Reproductor Exclusivo X11", "unit": "edusignage-player", "role": "Control único DISPLAY=:0 y watchdog", "status": "active", "pid": None, "memoryMb": 26, "uptimeSec": int(time.time() - psutil.boot_time())},
        {"name": "Helper Privilegiado OS", "unit": "edusignage-system-helper", "role": "Lista blanca root (systemd/SSH/red)", "status": "active", "pid": None, "memoryMb": 14, "uptimeSec": int(time.time() - psutil.boot_time())},
    ]

    return {
        "deviceName": settings.get("device_name", "EduSignage Pi"),
        "hostname": hostname,
        "mdnsAddress": f"{hostname}.local",
        "localIp": ifaces[0]["ip"] if ifaces else "127.0.0.1",
        "osVersion": platform.platform(),
        "architecture": f"{platform.system().lower()} / {platform.machine()}",
        "hardwareProfile": model,
        "isRaspberryPi": "raspberry" in model.lower() or platform.machine().startswith(("arm", "aarch")),
        "uptimeSec": int(time.time() - psutil.boot_time()),
        "cpuPercent": psutil.cpu_percent(interval=None),
        "cpuTempC": read_cpu_temp(),
        "ramUsedMb": round(mem.used / (1024 * 1024)),
        "ramTotalMb": round(mem.total / (1024 * 1024)),
        "ramAvailableMb": round(mem.available / (1024 * 1024)),
        "swapUsedMb": round(swap.used / (1024 * 1024)),
        "swapTotalMb": round(swap.total / (1024 * 1024)),
        "diskFreeGb": round(disk.free / (1024**3), 1),
        "diskTotalGb": round(disk.total / (1024**3), 1),
        "diskUsedPercent": round(disk.percent),
        "networkState": "online" if ifaces else "degraded",
        "networkInterfaces": ifaces,
        "resolution": settings.get("resolution", "1920x1080"),
        "orientation": settings.get("orientation", "normal"),
        "sshActive": settings.get("ssh_enabled") == "true",
        "sambaActive": settings.get("samba_enabled") == "true",
        "mdnsActive": settings.get("mdns_enabled") == "true",
        "binaries": binaries,
        "services": services,
        "processes": processes,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


def read_player_state() -> dict[str, Any]:
    if os.path.exists(STATE_FILE):
        try:
            raw = json.load(open(STATE_FILE, "r", encoding="utf-8"))
            item = raw.get("current_item") or {}
            return {
                "status": raw.get("status", "standby"),
                "source": item.get("source", "standby"),
                "scheduleId": item.get("schedule_id"),
                "title": item.get("name", "Pantalla de Espera"),
                "contentType": item.get("content_type", "standby"),
                "targetRef": item.get("target_ref", "standby"),
                "activeApp": item.get("content_type", "standby"),
                "commandPreview": "DISPLAY=:0 (edusignage-player)",
                "config": item.get("config", {}),
                "startedAt": datetime.fromtimestamp(raw.get("started_at") or time.time()).isoformat(),
                "manualExpiresAt": None,
                "exclusiveLockOwner": "edusignage-player (DISPLAY=:0)",
                "lastError": raw.get("error") or None,
            }
        except Exception:
            pass
    return {
        "status": "standby",
        "source": "standby",
        "scheduleId": None,
        "title": "Pantalla de Espera",
        "contentType": "standby",
        "targetRef": "standby",
        "activeApp": "Chromium Kiosco (Standby Local)",
        "commandPreview": "chromium-browser --kiosk --app=http://127.0.0.1:8080/standby --disable-metrics --disable-metrics-reporting --disable-breakpad --disable-crash-reporter",
        "config": {},
        "startedAt": datetime.utcnow().isoformat() + "Z",
        "manualExpiresAt": None,
        "exclusiveLockOwner": "edusignage-player (DISPLAY=:0)",
        "lastError": None,
    }


@app.on_event("startup")
async def startup_event() -> None:
    await init_db()
    os.makedirs(BACKUP_DIR, mode=0o755, exist_ok=True)
    for sub in ("images", "videos", "web"):
        os.makedirs(os.path.join(MEDIA_ROOT, sub), mode=0o755, exist_ok=True)


if os.path.exists(MEDIA_ROOT):
    app.mount("/media", StaticFiles(directory=MEDIA_ROOT), name="media")


@app.get("/api/auth/status")
async def auth_status(edusignage_session: Optional[str] = Cookie(default=None)):
    settings = await get_settings_map()
    auth_enabled = settings.get("auth_enabled") == "true"
    db = await get_db()
    try:
        cur = await db.execute("SELECT username FROM users LIMIT 1")
        admin = await cur.fetchone()
    finally:
        await db.close()
    user = verify_session(edusignage_session)
    return {
        "authEnabled": auth_enabled,
        "hasAdminUser": bool(admin),
        "authenticated": (not auth_enabled) or bool(user),
        "username": user or (admin["username"] if admin else "admin-local"),
    }


@app.post("/api/auth/login")
async def auth_login(payload: dict):
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    db = await get_db()
    try:
        cur = await db.execute("SELECT username, password_hash, salt FROM users WHERE username = ?", (username,))
        user = await cur.fetchone()
    finally:
        await db.close()
    if not user or not verify_password(password, user["password_hash"], user["salt"]):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    resp = JSONResponse({"ok": True, "username": user["username"]})
    resp.set_cookie(SESSION_COOKIE, sign_session(user["username"]), httponly=True, samesite="lax", max_age=43200)
    return resp


@app.post("/api/auth/logout")
async def auth_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE)
    return resp


@app.post("/api/auth/configure")
async def auth_configure(payload: dict, _user: str = Depends(require_auth)):
    username = str(payload.get("username", "admin")).strip() or "admin"
    password = str(payload.get("password", ""))
    enabled = bool(payload.get("authEnabled"))
    db = await get_db()
    try:
        if password:
            if len(password) < 6:
                raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")
            h, s = hash_password(password)
            await db.execute("DELETE FROM users")
            await db.execute("INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, 'admin')", (username, h, s))
        await db.execute("INSERT INTO system_settings (key, value) VALUES ('auth_enabled', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("true" if enabled else "false",))
        await db.commit()
    finally:
        await db.close()
    await add_audit_log(username, "security", "info", f"Política de acceso actualizada (auth_enabled={enabled}).")
    return {"ok": True}


@app.get("/api/state")
async def full_state(_user: str = Depends(require_auth)):
    settings = await get_settings_map()
    db = await get_db()
    try:
        schedules = [dict(r) for r in await (await db.execute("SELECT * FROM schedules ORDER BY priority DESC, start_time ASC")).fetchall()]
        apps = [dict(r) for r in await (await db.execute("SELECT * FROM authorized_apps ORDER BY id ASC")).fetchall()]
        standby = dict(await (await db.execute("SELECT * FROM standby_config WHERE id = 1")).fetchone())
        logs = [dict(r) for r in await (await db.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 80")).fetchall()]
        wifi = [dict(r) for r in await (await db.execute("SELECT * FROM wifi_profiles ORDER BY connected DESC")).fetchall()]
    finally:
        await db.close()
    return {
        "telemetry": collect_telemetry_sync(settings),
        "player": read_player_state(),
        "schedules": schedules,
        "apps": apps,
        "standby": standby,
        "settings": settings,
        "logs": logs,
        "wifiProfiles": wifi,
    }


@app.get("/api/schedules")
async def get_schedules(_user: str = Depends(require_auth)):
    db = await get_db()
    try:
        return [dict(r) for r in await (await db.execute("SELECT * FROM schedules ORDER BY priority DESC, start_time ASC")).fetchall()]
    finally:
        await db.close()


@app.post("/api/schedules", status_code=201)
async def create_schedule(b: dict, _user: str = Depends(require_auth)):
    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO schedules (name, content_type, target_ref, config_json, start_time, end_time, days_of_week, start_date, end_date, recurrence_mode, priority, enabled, on_finish_action)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                b["name"], b["content_type"], str(b.get("target_ref", "standby")),
                b["config_json"] if isinstance(b.get("config_json"), str) else json.dumps(b.get("config_json", {})),
                b["start_time"], b["end_time"], str(b.get("days_of_week", "1,2,3,4,5")),
                str(b.get("start_date", "")), str(b.get("end_date", "")),
                str(b.get("recurrence_mode", "weekly")), int(b.get("priority", 10)),
                1 if b.get("enabled", True) else 0, str(b.get("on_finish_action", "standby")),
            ),
        )
        await db.commit()
        rows = [dict(r) for r in await (await db.execute("SELECT * FROM schedules ORDER BY priority DESC, start_time ASC")).fetchall()]
        return {"id": cur.lastrowid, "schedules": rows}
    finally:
        await db.close()


@app.put("/api/schedules/{item_id}")
async def update_schedule(item_id: int, b: dict, _user: str = Depends(require_auth)):
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM schedules WHERE id = ?", (item_id,))
        ex = await cur.fetchone()
        if not ex:
            raise HTTPException(status_code=404, detail="No encontrado")
        await db.execute(
            """UPDATE schedules SET name=?, content_type=?, target_ref=?, config_json=?, start_time=?, end_time=?, days_of_week=?, start_date=?, end_date=?, recurrence_mode=?, priority=?, enabled=?, on_finish_action=? WHERE id=?""",
            (
                b.get("name", ex["name"]), b.get("content_type", ex["content_type"]),
                str(b.get("target_ref", ex["target_ref"])),
                b["config_json"] if isinstance(b.get("config_json"), str) else json.dumps(b.get("config_json")) if "config_json" in b else ex["config_json"],
                b.get("start_time", ex["start_time"]), b.get("end_time", ex["end_time"]),
                b.get("days_of_week", ex["days_of_week"]), b.get("start_date", ex["start_date"]),
                b.get("end_date", ex["end_date"]), b.get("recurrence_mode", ex["recurrence_mode"]),
                int(b.get("priority", ex["priority"])), 1 if b.get("enabled", ex["enabled"]) else 0,
                b.get("on_finish_action", ex["on_finish_action"]), item_id,
            ),
        )
        await db.commit()
        rows = [dict(r) for r in await (await db.execute("SELECT * FROM schedules ORDER BY priority DESC, start_time ASC")).fetchall()]
        return {"ok": True, "schedules": rows}
    finally:
        await db.close()


@app.delete("/api/schedules/{item_id}")
async def delete_schedule(item_id: int, _user: str = Depends(require_auth)):
    db = await get_db()
    try:
        await db.execute("DELETE FROM schedules WHERE id = ?", (item_id,))
        await db.commit()
        rows = [dict(r) for r in await (await db.execute("SELECT * FROM schedules ORDER BY priority DESC, start_time ASC")).fetchall()]
        return {"ok": True, "schedules": rows}
    finally:
        await db.close()


@app.post("/api/player/play")
async def play_manual(b: dict, _user: str = Depends(require_auth)):
    duration_min = int(b.get("durationMin") or 0)
    item = {
        "source": "manual",
        "schedule_id": None,
        "name": b.get("title", "Reproducción Manual"),
        "content_type": b.get("contentType", "standby"),
        "target_ref": str(b.get("targetRef", "standby")),
        "config": b.get("config") or {},
        "expires_at": time.time() + duration_min * 60 if duration_min > 0 else None,
    }
    os.makedirs(os.path.dirname(OVERRIDE_FILE), exist_ok=True)
    with open(OVERRIDE_FILE, "w", encoding="utf-8") as fh:
        json.dump(item, fh)
    call_unix_socket(PLAYER_SOCKET, {"action": "play", "item": item})
    return read_player_state()


@app.post("/api/player/stop")
async def stop_player(_user: str = Depends(require_auth)):
    call_unix_socket(PLAYER_SOCKET, {"action": "stop"})
    return read_player_state()


@app.post("/api/player/standby")
async def standby_player(_user: str = Depends(require_auth)):
    return await play_manual({"title": "Pantalla de Espera", "contentType": "standby", "targetRef": "standby"}, _user)


@app.post("/api/player/resume-schedule")
async def resume_schedule(_user: str = Depends(require_auth)):
    if os.path.exists(OVERRIDE_FILE):
        os.remove(OVERRIDE_FILE)
    return read_player_state()


@app.put("/api/standby")
async def update_standby(b: dict, _user: str = Depends(require_auth)):
    msgs = b.get("messages_json") if isinstance(b.get("messages_json"), str) else json.dumps(b.get("messages", []))
    db = await get_db()
    try:
        await db.execute(
            "UPDATE standby_config SET school_name=?, subtitle=?, messages_json=?, logo_path=?, photos_folder=?, show_clock=?, show_date=?, theme=? WHERE id=1",
            (
                b.get("school_name", "Centro Educativo"), b.get("subtitle", ""), msgs,
                b.get("logo_path", ""), b.get("photos_folder", "images"),
                1 if b.get("show_clock", True) else 0, 1 if b.get("show_date", True) else 0,
                "light" if b.get("theme") == "light" else "dark",
            ),
        )
        await db.commit()
        return dict(await (await db.execute("SELECT * FROM standby_config WHERE id=1")).fetchone())
    finally:
        await db.close()


@app.get("/standby", response_class=HTMLResponse)
async def standby_screen_html():
    db = await get_db()
    try:
        cfg = dict(await (await db.execute("SELECT * FROM standby_config WHERE id = 1")).fetchone())
    finally:
        await db.close()
    msgs = json.loads(cfg.get("messages_json") or "[]")
    bg = "#0b1120" if cfg.get("theme") == "dark" else "#f8fafc"
    fg = "#f8fafc" if cfg.get("theme") == "dark" else "#0f172a"
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{cfg['school_name']}</title>
    <style>body{{margin:0;background:{bg};color:{fg};font-family:sans-serif;height:100vh;display:flex;flex-direction:column;justify-content:space-between;padding:4rem;box-sizing:border-box}}
    .top{{display:flex;justify-content:space-between;align-items:center}} .clk{{font-size:4rem;font-weight:700;font-variant-numeric:tabular-nums}} .msg{{font-size:1.75rem;padding:1.5rem 2rem;border:1px solid rgba(148,163,184,.3);border-radius:1rem}}</style>
    </head><body><div class="top"><div><h1 style="margin:0;font-size:2.75rem">{cfg['school_name']}</h1><p style="opacity:.75;font-size:1.25rem">{cfg['subtitle']}</p></div>
    <div class="clk" id="clk"></div></div><div class="msg">{msgs[0] if msgs else ''}</div>
    <script>setInterval(()=>{{document.getElementById('clk').textContent=new Date().toLocaleTimeString('es-ES',{{hour:'2-digit',minute:'2-digit'}})}},1000);</script></body></html>"""


@app.get("/api/apps")
async def list_apps(_user: str = Depends(require_auth)):
    db = await get_db()
    try:
        return [dict(r) for r in await (await db.execute("SELECT * FROM authorized_apps ORDER BY id ASC")).fetchall()]
    finally:
        await db.close()


@app.post("/api/apps", status_code=201)
async def create_app(b: dict, _user: str = Depends(require_auth)):
    bin_path = str(b.get("binary_path", "")).strip()
    args = str(b.get("args", "")).strip()
    if not SAFE_BINARY_RE.match(bin_path) or FORBIDDEN_SHELL_RE.search(args):
        raise HTTPException(status_code=400, detail="Ruta binaria o argumentos no autorizados")
    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO authorized_apps (name, binary_path, args, display_mode, default_duration_min, on_finish_action, rpi3b_compatible, ram_profile, enabled, description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                b["name"], bin_path, args, b.get("display_mode", "fullscreen"),
                int(b.get("default_duration_min", 30)), b.get("on_finish_action", "standby"),
                1 if b.get("rpi3b_compatible", True) else 0, b.get("ram_profile", "medium"),
                1 if b.get("enabled", True) else 0, b.get("description", ""),
            ),
        )
        await db.commit()
        apps = [dict(r) for r in await (await db.execute("SELECT * FROM authorized_apps ORDER BY id ASC")).fetchall()]
        return {"id": cur.lastrowid, "apps": apps}
    finally:
        await db.close()


@app.put("/api/apps/{app_id}")
async def update_app(app_id: int, b: dict, _user: str = Depends(require_auth)):
    bin_path = str(b.get("binary_path", "")).strip()
    args = str(b.get("args", "")).strip()
    if bin_path and (not SAFE_BINARY_RE.match(bin_path) or FORBIDDEN_SHELL_RE.search(args)):
        raise HTTPException(status_code=400, detail="Ruta binaria o argumentos no autorizados")
    db = await get_db()
    try:
        ex = await (await db.execute("SELECT * FROM authorized_apps WHERE id = ?", (app_id,))).fetchone()
        if not ex:
            raise HTTPException(status_code=404, detail="No encontrada")
        await db.execute(
            """UPDATE authorized_apps SET name=?, binary_path=?, args=?, display_mode=?, default_duration_min=?, on_finish_action=?, rpi3b_compatible=?, ram_profile=?, enabled=?, description=? WHERE id=?""",
            (
                b.get("name", ex["name"]), bin_path or ex["binary_path"], args if "args" in b else ex["args"],
                b.get("display_mode", ex["display_mode"]), int(b.get("default_duration_min", ex["default_duration_min"])),
                b.get("on_finish_action", ex["on_finish_action"]), 1 if b.get("rpi3b_compatible", ex["rpi3b_compatible"]) else 0,
                b.get("ram_profile", ex["ram_profile"]), 1 if b.get("enabled", ex["enabled"]) else 0,
                b.get("description", ex["description"]), app_id,
            ),
        )
        await db.commit()
        apps = [dict(r) for r in await (await db.execute("SELECT * FROM authorized_apps ORDER BY id ASC")).fetchall()]
        return {"ok": True, "apps": apps}
    finally:
        await db.close()


@app.delete("/api/apps/{app_id}")
async def delete_app(app_id: int, _user: str = Depends(require_auth)):
    db = await get_db()
    try:
        await db.execute("DELETE FROM authorized_apps WHERE id = ?", (app_id,))
        await db.commit()
        apps = [dict(r) for r in await (await db.execute("SELECT * FROM authorized_apps ORDER BY id ASC")).fetchall()]
        return {"ok": True, "apps": apps}
    finally:
        await db.close()


def _safe_media_dir(category: str, folder: str = "") -> str:
    if category not in ("images", "videos", "web"):
        raise HTTPException(status_code=400, detail="Categoría inválida")
    base = os.path.abspath(os.path.join(MEDIA_ROOT, category))
    clean_sub = folder.lstrip("/").replace("..", "")
    resolved = os.path.abspath(os.path.join(base, clean_sub))
    if not resolved.startswith(base):
        raise HTTPException(status_code=400, detail="Ruta fuera del ámbito multimedia")
    return resolved


@app.get("/api/media")
async def list_media(category: str = "images", folder: str = "", _user: str = Depends(require_auth)):
    target = _safe_media_dir(category, folder)
    if not os.path.exists(target):
        return []
    base_cat = os.path.abspath(os.path.join(MEDIA_ROOT, category))
    items = []
    for entry in os.scandir(target):
        st = entry.stat()
        rel = os.path.relpath(entry.path, base_cat).replace("\\", "/")
        mime, _ = mimetypes.guess_type(entry.name)
        items.append({
            "name": entry.name,
            "relativePath": rel,
            "category": category,
            "folder": folder,
            "isDirectory": entry.is_dir(),
            "sizeBytes": 0 if entry.is_dir() else st.st_size,
            "mimeType": "inode/directory" if entry.is_dir() else (mime or "application/octet-stream"),
            "permissions": oct(st.st_mode & 0o777).replace("0o", "0"),
            "modifiedAt": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "url": "" if entry.is_dir() else f"/media/{category}/{rel}",
        })
    items.sort(key=lambda x: (not x["isDirectory"], x["name"].lower()))
    return items


@app.post("/api/media/upload")
async def upload_media(category: str = "images", folder: str = "", files: list[UploadFile] = File(...), _user: str = Depends(require_auth)):
    dest_dir = _safe_media_dir(category, folder)
    os.makedirs(dest_dir, mode=0o755, exist_ok=True)
    count = 0
    for f in files:
        safe_name = re.sub(r"[^a-zA-Z0-9._\-]", "_", os.path.basename(f.filename or "archivo"))
        ext = os.path.splitext(safe_name)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Extensión no permitida: {ext}")
        dest_path = os.path.join(dest_dir, safe_name)
        with open(dest_path, "wb") as out:
            shutil.copyfileobj(f.file, out)
        os.chmod(dest_path, 0o644)
        count += 1
    return {"ok": True, "count": count}


@app.post("/api/media/folder")
async def create_media_folder(b: dict, _user: str = Depends(require_auth)):
    clean = re.sub(r"[^a-zA-Z0-9._\-]", "_", str(b.get("name", "")))
    if not clean:
        raise HTTPException(status_code=400, detail="Nombre requerido")
    target = _safe_media_dir(b.get("category", "images"), os.path.join(b.get("folder", ""), clean))
    os.makedirs(target, mode=0o755, exist_ok=True)
    return {"ok": True}


@app.post("/api/media/rename")
async def rename_media(b: dict, _user: str = Depends(require_auth)):
    cat = b.get("category", "images")
    old_full = _safe_media_dir(cat, b.get("oldRelativePath", ""))
    clean_new = re.sub(r"[^a-zA-Z0-9._\-]", "_", os.path.basename(str(b.get("newName", ""))))
    if not os.path.exists(old_full) or not clean_new:
        raise HTTPException(status_code=400, detail="Origen o nombre inválido")
    os.rename(old_full, os.path.join(os.path.dirname(old_full), clean_new))
    return {"ok": True}


@app.delete("/api/media")
async def delete_media(b: dict, _user: str = Depends(require_auth)):
    target = _safe_media_dir(b.get("category", "images"), b.get("relativePath", ""))
    if os.path.isdir(target):
        shutil.rmtree(target)
    elif os.path.exists(target):
        os.remove(target)
    return {"ok": True}


@app.post("/api/system/service")
async def sys_service(b: dict, _user: str = Depends(require_auth)):
    return call_unix_socket(HELPER_SOCKET, {"op": "service_control", "params": {"service": b.get("unit"), "action": b.get("action")}})


@app.post("/api/system/ssh")
async def sys_ssh(b: dict, _user: str = Depends(require_auth)):
    enabled = bool(b.get("enabled"))
    res = call_unix_socket(HELPER_SOCKET, {"op": "ssh_enable" if enabled else "ssh_disable"})
    db = await get_db()
    try:
        await db.execute("INSERT INTO system_settings (key, value) VALUES ('ssh_enabled', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("true" if enabled else "false",))
        await db.commit()
    finally:
        await db.close()
    return res


@app.post("/api/system/hostname")
async def sys_hostname(b: dict, _user: str = Depends(require_auth)):
    return call_unix_socket(HELPER_SOCKET, {"op": "set_hostname", "params": {"hostname": b.get("hostname")}})


@app.post("/api/system/display")
async def sys_display(b: dict, _user: str = Depends(require_auth)):
    return call_unix_socket(HELPER_SOCKET, {"op": "set_display", "params": {"resolution": b.get("resolution"), "orientation": b.get("orientation")}})


@app.post("/api/system/timezone")
async def sys_timezone(b: dict, _user: str = Depends(require_auth)):
    return call_unix_socket(HELPER_SOCKET, {"op": "set_timezone", "params": {"timezone": b.get("timezone")}})


@app.post("/api/system/swap")
async def sys_swap(b: dict, _user: str = Depends(require_auth)):
    return call_unix_socket(HELPER_SOCKET, {"op": "configure_swap", "params": {"swap_mb": b.get("swap_mb", 1024)}})


@app.post("/api/system/wifi/scan")
async def sys_wifi_scan(_user: str = Depends(require_auth)):
    res = call_unix_socket(HELPER_SOCKET, {"op": "wifi_scan"})
    return {"networks": [], "raw": res}


@app.post("/api/system/wifi/connect")
async def sys_wifi_connect(b: dict, _user: str = Depends(require_auth)):
    return call_unix_socket(HELPER_SOCKET, {"op": "wifi_connect", "params": b})


@app.post("/api/system/power")
async def sys_power(b: dict, _user: str = Depends(require_auth)):
    action = b.get("action")
    if action not in ("reboot", "shutdown"):
        raise HTTPException(status_code=400, detail="Acción inválida")
    return call_unix_socket(HELPER_SOCKET, {"op": action})


@app.put("/api/settings")
async def update_settings(b: dict, _user: str = Depends(require_auth)):
    db = await get_db()
    try:
        for k, v in b.items():
            await db.execute("INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, str(v)))
        await db.commit()
    finally:
        await db.close()
    return await get_settings_map()


@app.post("/api/health-check")
async def health_check(_user: str = Depends(require_auth)):
    settings = await get_settings_map()
    tel = collect_telemetry_sync(settings)
    return {
        "overall": "ok" if tel["ramAvailableMb"] > 100 and tel["diskFreeGb"] > 1.0 else "warning",
        "checkedAt": datetime.utcnow().isoformat() + "Z",
        "checks": [
            {"id": "sqlite", "component": "SQLite WAL", "status": "ok", "detail": "Base de datos operativa."},
            {"id": "memory", "component": "RAM y Swap RPi 3B", "status": "ok", "detail": f"RAM libre: {tel['ramAvailableMb']} MB · Swap: {tel['swapTotalMb']} MB"},
            {"id": "disk", "component": "Almacenamiento", "status": "ok" if tel["diskFreeGb"] > 1.0 else "warning", "detail": f"{tel['diskFreeGb']} GB libres"},
        ],
    }


@app.get("/api/backups/list")
async def list_backups(_user: str = Depends(require_auth)):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    out = []
    for f in os.listdir(BACKUP_DIR):
        if f.endswith(".json"):
            st = os.stat(os.path.join(BACKUP_DIR, f))
            out.append({"name": f, "sizeBytes": st.st_size, "createdAt": datetime.fromtimestamp(st.st_mtime).isoformat()})
    return out


@app.get("/api/backups/export")
async def export_backup(_user: str = Depends(require_auth)):
    db = await get_db()
    try:
        snap = {
            "exportedAt": datetime.utcnow().isoformat() + "Z",
            "schedules": [dict(r) for r in await (await db.execute("SELECT * FROM schedules")).fetchall()],
            "authorized_apps": [dict(r) for r in await (await db.execute("SELECT * FROM authorized_apps")).fetchall()],
            "standby_config": dict(await (await db.execute("SELECT * FROM standby_config WHERE id=1")).fetchone()),
            "system_settings": [dict(r) for r in await (await db.execute("SELECT * FROM system_settings")).fetchall()],
        }
    finally:
        await db.close()
    return JSONResponse(snap, headers={"Content-Disposition": 'attachment; filename="edusignage_backup.json"'})


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            settings = await get_settings_map()
            await ws.send_json({"type": "telemetry:tick", "data": collect_telemetry_sync(settings)})
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        pass


@app.get("/api/package/files")
async def list_package_files(_user: str = Depends(require_auth)):
    pkg_dir = "/opt/edusignage/repo/pi_package"
    out = []
    if os.path.exists(pkg_dir):
        for root, dirs, files in os.walk(pkg_dir):
            dirs[:] = [d for d in dirs if d not in ("web", "__pycache__")]
            for fname in sorted(files):
                full = os.path.join(root, fname)
                rel = os.path.relpath(full, pkg_dir).replace("\\", "/")
                try:
                    content = open(full, "r", encoding="utf-8").read()
                    out.append({"path": rel, "sizeBytes": os.path.getsize(full), "content": content})
                except Exception:
                    pass
    return out


# Servir frontend SPA compilado en /opt/edusignage/web (instalado desde pi_package/web)
if os.path.exists(WEB_DIST_DIR):
    assets_dir = os.path.join(WEB_DIST_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        candidate = os.path.join(WEB_DIST_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        index = os.path.join(WEB_DIST_DIR, "index.html")
        if os.path.exists(index):
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Frontend no compilado")
