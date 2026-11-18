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


class ExclusivePlayer:
    def __init__(self) -> None:
        self.proc: Optional[subprocess.Popen] = None
        self.current_item: Optional[dict] = None
        self.started_at: float = 0.0
        self.lock = asyncio.Lock()

    def _env(self) -> dict:
        env = os.environ.copy()
        env["DISPLAY"] = DISPLAY
        return env

    def _disable_screensaver(self) -> None:
        for cmd in (
            ["xset", "-display", DISPLAY, "s", "off"],
            ["xset", "-display", DISPLAY, "-dpms"],
            ["xset", "-display", DISPLAY, "s", "noblank"],
        ):
            if shutil.which("xset"):
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

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
        # Liberar RAM residual en RPi 3B asegurando que no queden procesos Chromium huérfanos
        for browser in ("chromium-browser", "chromium", "firefox", "firefox-esr", "feh", "mpv"):
            if self.current_item and self.current_item.get("content_type") != "app":
                subprocess.run(["pkill", "-f", browser], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

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
            zoom = float(cfg.get("zoom", 1.0))
            return [
                binary,
                "--kiosk",
                "--noerrdialogs",
                "--disable-infobars",
                "--no-first-run",
                "--check-for-update-interval=31536000",
                f"--force-device-scale-factor={zoom}",
                "--disable-dev-shm-usage",
                target,
            ]

        if ctype == "images":
            feh = shutil.which("feh")
            if not feh:
                raise RuntimeError("feh no está instalado")
            media_dir = target if os.path.isabs(target) else os.path.join("/opt/edusignage/media", target)
            delay = str(int(cfg.get("interval_sec", 8)))
            cmd = [feh, "--fullscreen", "--auto-zoom", "--hide-pointer", "--slideshow-delay", delay]
            if cfg.get("random_order"):
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
            cmd = [
                mpv,
                "--fs",
                "--no-osd-bar",
                "--loop-playlist=inf",
                "--hwdec=auto-safe",
                f"--volume={vol}",
                media_path,
            ]
            return cmd

        if ctype == "app":
            app = self._lookup_authorized_app(target)
            if not app:
                raise PermissionError(f"Aplicación no autorizada o deshabilitada: {target}")
            binary = app["binary_path"]
            if not os.path.exists(binary):
                raise FileNotFoundError(f"Binario no encontrado: {binary}")
            args = [a for a in app["args"].split(" ") if a.strip()]
            return [binary, *args]

        # Pantalla de espera servida localmente en Chromium ligero hacia /standby
        chromium = shutil.which("chromium-browser") or shutil.which("chromium")
        if chromium:
            port = os.environ.get("EDUSIGNAGE_WEB_PORT", "8080")
            return [
                chromium,
                "--kiosk",
                "--app=http://127.0.0.1:" + port + "/standby",
                "--noerrdialogs",
                "--disable-infobars",
                "--disable-dev-shm-usage",
            ]
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

    async def play(self, item: dict) -> dict:
        async with self.lock:
            self._stop_current()
            self._disable_screensaver()
            self.current_item = item
            try:
                cmd = self._build_command(item)
                logger.info("Lanzando exclusivo: %s", " ".join(cmd))
                self.proc = subprocess.Popen(
                    cmd,
                    env=self._env(),
                    preexec_fn=os.setsid,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
                self.started_at = time.time()
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
                        self.proc = subprocess.Popen(cmd, env=self._env(), preexec_fn=os.setsid)
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
    logger.info("Reproductor escuchando en %s", PLAYER_SOCKET)
    await asyncio.gather(server.serve_forever(), player.watchdog_loop())


if __name__ == "__main__":
    asyncio.run(main())
