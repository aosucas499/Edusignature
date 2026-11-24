"""
EduSignage Pi - Demonio Reproductor Exclusivo de Pantalla (edusignage-player.service)
Controla DISPLAY=:0 bajo X11/Openbox.
Garantiza exclusión mutua (solo 1 aplicación gráfica en pantalla), cierra Chromium al
cambiar de contenido para liberar RAM en Raspberry Pi 3B (1 GB) y recupera procesos bloqueados.
"""
import asyncio
import json
import logging
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import time
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [PLAYER] %(levelname)s: %(message)s",
)
logger = logging.getLogger("edusignage.player")

PLAYER_SOCKET = os.environ.get("EDUSIGNAGE_PLAYER_SOCK", "/run/edusignage/player.sock")
STATE_FILE = "/run/edusignage/player_state.json"
DB_PATH = os.environ.get("EDUSIGNAGE_DB", "/opt/edusignage/data/edusignage.db")
DISPLAY = os.environ.get("DISPLAY", ":0")
XAUTHORITY = os.environ.get("XAUTHORITY", "/opt/edusignage/.Xauthority")
XDG_RUNTIME_DIR = os.environ.get("XDG_RUNTIME_DIR", "/run/edusignage/xdg")
CHILD_LOG_FILE = "/opt/edusignage/logs/player_child.log"
CHROMIUM_PROFILE_DIRS = (
    "/opt/edusignage/.config/chromium",
    "/opt/edusignage/data/chromium-profile",
)
CHROMIUM_TELEMETRY_FLAGS = (
    "--disable-metrics",
    "--disable-metrics-reporting",
    "--disable-breakpad",
    "--disable-crash-reporter",
)


class ExclusivePlayer:
    def __init__(self) -> None:
        self.proc: Optional[subprocess.Popen] = None
        self.current_item: Optional[dict] = None
        self.started_at: float = 0.0
        self.lock = asyncio.Lock()

    def _env(self) -> dict:
        os.makedirs(XDG_RUNTIME_DIR, mode=0o700, exist_ok=True)
        env = os.environ.copy()
        env["HOME"] = "/opt/edusignage"
        env["DISPLAY"] = DISPLAY
        env["XDG_RUNTIME_DIR"] = XDG_RUNTIME_DIR
        env["XAUTHORITY"] = XAUTHORITY
        if not env.get("DBUS_SESSION_BUS_ADDRESS"):
            env.pop("DBUS_SESSION_BUS_ADDRESS", None)
        return env

    async def _wait_for_x11(self, timeout_sec: float = 35.0) -> bool:
        display_num = DISPLAY.lstrip(":").split(".")[0] or "0"
        x11_sock = f"/tmp/.X11-unix/X{display_num}"
        xset_bin = shutil.which("xset")
        deadline = time.time() + timeout_sec
        saw_socket_unauth = False
        while time.time() < deadline:
            if os.path.exists(x11_sock):
                if not xset_bin:
                    return True
                res = subprocess.run(
                    [xset_bin, "-display", DISPLAY, "q"],
                    env=self._env(),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                if res.returncode == 0:
                    return True
                saw_socket_unauth = True
            await asyncio.sleep(0.6)
        if saw_socket_unauth:
            logger.error(
                "El socket %s existe pero no autoriza a 'edusignage' (XAUTHORITY=%s). ¿Sigue activo LightDM?",
                x11_sock,
                XAUTHORITY,
            )
        else:
            logger.error("Servidor X11 no disponible en %s tras %.1fs", x11_sock, timeout_sec)
        return False

    async def _wait_for_web(self, port: int, timeout_sec: float = 20.0) -> bool:
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1.0):
                    return True
            except OSError:
                await asyncio.sleep(0.5)
        logger.warning("Servidor web local :%s tardó más de %.1fs en responder", port, timeout_sec)
        return False

    def _disable_screensaver(self) -> None:
        env = self._env()
        for cmd in (
            ["xset", "-display", DISPLAY, "s", "off"],
            ["xset", "-display", DISPLAY, "-dpms"],
            ["xset", "-display", DISPLAY, "s", "noblank"],
        ):
            if shutil.which("xset"):
                subprocess.run(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _stop_current(self) -> None:
        if self.proc and self.proc.poll() is None:
            logger.info("Deteniendo proceso actual PID=%s", self.proc.pid)
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
                self.proc.wait(timeout=4)
            except Exception:
                try:
                    os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
                except Exception:
                    pass
        self.proc = None
        for browser in ("chromium-browser", "chromium", "firefox", "firefox-esr", "feh", "mpv", "retroarch", "soffice.bin"):
            subprocess.run(["pkill", "-u", "edusignage", "-f", browser], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _lookup_authorized_app(self, target_ref: str) -> Optional[dict]:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                "SELECT * FROM authorized_apps WHERE (id = ? OR name = ?) AND enabled = 1",
                (target_ref, target_ref),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def _cleanup_chromium_telemetry(self) -> None:
        removed_files = 0
        freed_bytes = 0
        for profile_root in CHROMIUM_PROFILE_DIRS:
            if not os.path.isdir(profile_root):
                continue
            try:
                with os.scandir(profile_root) as entries:
                    for entry in entries:
                        if entry.is_file(follow_symlinks=False) and entry.name.endswith(".pma"):
                            try:
                                freed_bytes += entry.stat(follow_symlinks=False).st_size
                                os.unlink(entry.path)
                                removed_files += 1
                            except OSError:
                                pass
            except OSError:
                pass

            metrics_dir = os.path.join(profile_root, "BrowserMetrics")
            if os.path.isdir(metrics_dir):
                for root, _, files in os.walk(metrics_dir):
                    for fname in files:
                        if fname.endswith(".pma"):
                            fpath = os.path.join(root, fname)
                            try:
                                freed_bytes += os.path.getsize(fpath)
                                os.unlink(fpath)
                                removed_files += 1
                            except OSError:
                                pass

            crash_dir = os.path.join(profile_root, "Crash Reports")
            if os.path.isdir(crash_dir):
                for root, dirs, files in os.walk(crash_dir, topdown=False):
                    for fname in files:
                        fpath = os.path.join(root, fname)
                        try:
                            freed_bytes += os.path.getsize(fpath)
                            os.unlink(fpath)
                            removed_files += 1
                        except OSError:
                            pass
                    for dname in dirs:
                        try:
                            os.rmdir(os.path.join(root, dname))
                        except OSError:
                            pass

        if removed_files > 0:
            freed_mb = freed_bytes / (1024 * 1024)
            logger.info(
                "Limpieza preventiva Chromium: %d archivo(s) .pma/crash eliminados (%.2f MB liberados)",
                removed_files,
                freed_mb,
            )

    def _chromium_base_flags(self) -> list[str]:
        profile_dir = "/opt/edusignage/data/chromium-profile"
        os.makedirs(profile_dir, exist_ok=True)
        return [
            "--kiosk",
            "--noerrdialogs",
            "--disable-infobars",
            "--no-first-run",
            "--password-store=basic",
            "--disable-gpu-sandbox",
            "--check-for-update-interval=31536000",
            f"--user-data-dir={profile_dir}",
            "--disable-dev-shm-usage",
            *CHROMIUM_TELEMETRY_FLAGS,
        ]

    def _build_command(self, item: dict) -> list[str]:
        ctype = item.get("content_type", "standby")
        target = str(item.get("target_ref", ""))
        cfg = item.get("config") or {}

        if ctype == "web":
            browser_pref = cfg.get("browser", "chromium")
            binary = (
                shutil.which("firefox-esr") or shutil.which("firefox")
                if browser_pref == "firefox"
                else shutil.which("chromium-browser") or shutil.which("chromium")
            )
            if not binary:
                raise RuntimeError(f"Navegador no instalado: {browser_pref}")
            if "firefox" in binary:
                return [binary, "--kiosk", target]
            zoom = float(cfg.get("zoom", 100))
            scale = zoom / 100.0 if zoom > 10 else zoom
            return [binary, *self._chromium_base_flags(), f"--force-device-scale-factor={scale}", target]

        if ctype == "images":
            feh = shutil.which("feh")
            if not feh:
                raise RuntimeError("feh no está instalado")
            media_dir = target if os.path.isabs(target) else os.path.join("/opt/edusignage/media", target)
            delay = str(int(cfg.get("interval_sec", cfg.get("intervalSec", 8))))
            cmd = [feh, "--fullscreen", "--auto-zoom", "--hide-pointer", "--slideshow-delay", delay]
            if cfg.get("random_order") or cfg.get("randomOrder"):
                cmd.append("--randomize")
            if cfg.get("recursive"):
                cmd.append("--recursive")
            cmd.append(media_dir)
            return cmd

        if ctype == "video":
            mpv = shutil.which("mpv")
            if not mpv:
                raise RuntimeError("mpv no está instalado")
            media_path = target if os.path.isabs(target) else os.path.join("/opt/edusignage/media", target)
            vol = str(int(cfg.get("volume", 80)))
            return [
                mpv,
                "--fs",
                "--no-osd-bar",
                "--loop-playlist=inf",
                "--hwdec=auto-safe",
                f"--volume={vol}",
                media_path,
            ]

        if ctype == "app":
            app = self._lookup_authorized_app(target)
            if not app:
                raise PermissionError(f"Aplicación no autorizada o deshabilitada: {target}")
            binary = app["binary_path"]
            if not os.path.exists(binary):
                raise FileNotFoundError(f"Binario no encontrado: {binary}")
            args = [a for a in app["args"].split(" ") if a.strip()]
            if "chromium" in os.path.basename(binary).lower():
                for flag in CHROMIUM_TELEMETRY_FLAGS:
                    if flag not in args:
                        args.append(flag)
            return [binary, *args]

        chromium = shutil.which("chromium-browser") or shutil.which("chromium")
        if chromium:
            port = os.environ.get("EDUSIGNAGE_WEB_PORT", "8080")
            return [chromium, *self._chromium_base_flags(), f"--app=http://127.0.0.1:{port}/standby"]
        raise RuntimeError("No hay reproductor disponible para pantalla de espera")

    def _write_state(self, status: str, error: str = "") -> None:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        payload = {
            "status": status,
            "pid": self.proc.pid if self.proc and self.proc.poll() is None else None,
            "current_item": self.current_item,
            "started_at": self.started_at,
            "error": error,
            "updated_at": time.time(),
        }
        with open(STATE_FILE, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)

    def _spawn_process(self, cmd: list[str]) -> subprocess.Popen:
        if cmd and "chromium" in os.path.basename(cmd[0]).lower():
            self._cleanup_chromium_telemetry()
        os.makedirs(os.path.dirname(CHILD_LOG_FILE), exist_ok=True)
        env = self._env()
        launch_cmd = cmd
        dbus_bin = shutil.which("dbus-run-session")
        if dbus_bin and "DBUS_SESSION_BUS_ADDRESS" not in env:
            launch_cmd = [dbus_bin, "--", *cmd]
        log_fh = open(CHILD_LOG_FILE, "ab")
        log_fh.write(f"\n--- [{time.strftime('%Y-%m-%d %H:%M:%S')}] EXEC: {' '.join(launch_cmd)} ---\n".encode("utf-8"))
        log_fh.flush()
        proc = subprocess.Popen(
            launch_cmd,
            env=env,
            preexec_fn=os.setsid,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
        )
        log_fh.close()
        return proc

    def _tail_child_log(self, lines: int = 12) -> str:
        try:
            with open(CHILD_LOG_FILE, "r", encoding="utf-8", errors="ignore") as fh:
                return "".join(fh.readlines()[-lines:]).strip()
        except Exception:
            return ""

    async def play(self, item: dict) -> dict:
        async with self.lock:
            self._stop_current()
            if not await self._wait_for_x11():
                err = "Servidor gráfico X11 (:0) no está disponible."
                self._write_state("error", err)
                return {"ok": False, "error": err}

            if item.get("content_type", "standby") == "standby":
                port = int(os.environ.get("EDUSIGNAGE_WEB_PORT", "8080"))
                await self._wait_for_web(port)

            self._disable_screensaver()
            self.current_item = item
            try:
                cmd = self._build_command(item)
                logger.info("Lanzando exclusivo en %s: %s", DISPLAY, " ".join(cmd))
                self.proc = self._spawn_process(cmd)
                self.started_at = time.time()
                await asyncio.sleep(1.2)
                if self.proc.poll() is not None:
                    code = self.proc.returncode
                    tail = self._tail_child_log()
                    err = f"El proceso terminó inmediatamente (código {code}). {tail}"
                    logger.error(err)
                    self._write_state("error", err)
                    return {"ok": False, "error": err}
                self._write_state("playing")
                return {"ok": True, "pid": self.proc.pid}
            except Exception as exc:
                logger.error("Error lanzando contenido: %s", exc)
                self._write_state("error", str(exc))
                return {"ok": False, "error": str(exc)}

    async def stop(self) -> dict:
        async with self.lock:
            self._stop_current()
            self.current_item = None
            self._write_state("stopped")
            return {"ok": True}

    async def watchdog_loop(self) -> None:
        while True:
            await asyncio.sleep(5)
            async with self.lock:
                if self.proc and self.proc.poll() is not None and self.current_item:
                    code = self.proc.returncode
                    logger.warning("Proceso terminado inesperadamente (code=%s). Recuperando...", code)
                    item = self.current_item
                    self.proc = None
                    try:
                        cmd = self._build_command(item)
                        self.proc = self._spawn_process(cmd)
                        self.started_at = time.time()
                        self._write_state("recovered")
                    except Exception as exc:
                        self._write_state("error", str(exc))


player = ExclusivePlayer()


async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        raw = await reader.readline()
        req = json.loads(raw.decode("utf-8"))
        action = req.get("action")
        if action == "play":
            res = await player.play(req.get("item", {}))
        elif action == "stop":
            res = await player.stop()
        else:
            res = {"ok": False, "error": "Acción no reconocida"}
        writer.write((json.dumps(res) + "\n").encode("utf-8"))
        await writer.drain()
    except Exception as exc:
        writer.write((json.dumps({"ok": False, "error": str(exc)}) + "\n").encode("utf-8"))
        await writer.drain()
    finally:
        writer.close()


async def main() -> None:
    os.makedirs(os.path.dirname(PLAYER_SOCKET), exist_ok=True)
    if os.path.exists(PLAYER_SOCKET):
        os.remove(PLAYER_SOCKET)
    server = await asyncio.start_unix_server(handle_client, path=PLAYER_SOCKET)
    os.chmod(PLAYER_SOCKET, 0o660)
    logger.info("Reproductor escuchando en %s (DISPLAY=%s)", PLAYER_SOCKET, DISPLAY)
    await asyncio.gather(server.serve_forever(), player.watchdog_loop())


if __name__ == "__main__":
    asyncio.run(main())
