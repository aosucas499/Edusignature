"""
EduSignage Pi - Helper Privilegiado del Sistema (edusignage-system-helper.service)
Se ejecuta como root escuchando únicamente comandos estrictamente autorizados
sobre un socket Unix protegido. Nunca ejecuta texto arbitrario en shell.
"""
import asyncio
import json
import logging
import os
import re
import subprocess

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SYSHELPER] %(levelname)s: %(message)s",
)
logger = logging.getLogger("edusignage.syshelper")

HELPER_SOCKET = os.environ.get("EDUSIGNAGE_HELPER_SOCK", "/run/edusignage/syshelper.sock")

ALLOWED_SERVICES = {
    "edusignage-web",
    "edusignage-scheduler",
    "edusignage-player",
    "ssh",
    "smbd",
    "avahi-daemon",
}
ALLOWED_ACTIONS = {"start", "stop", "restart", "status"}
HOSTNAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9\-]{0,62}$")
RESOLUTION_RE = re.compile(r"^\d{3,4}x\d{3,4}$")
ALLOWED_ORIENTATIONS = {"normal", "left", "right", "inverted"}


def _run(cmd: list[str], timeout: int = 15) -> dict:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return {
        "ok": proc.returncode == 0,
        "code": proc.returncode,
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
    }


def dispatch(req: dict) -> dict:
    op = req.get("op")
    params = req.get("params") or {}

    if op == "ssh_enable":
        return _run(["systemctl", "enable", "--now", "ssh"])
    if op == "ssh_disable":
        return _run(["systemctl", "disable", "--now", "ssh"])
    if op == "ssh_status":
        return _run(["systemctl", "is-active", "ssh"])

    if op == "service_control":
        svc = params.get("service", "")
        act = params.get("action", "")
        if svc not in ALLOWED_SERVICES or act not in ALLOWED_ACTIONS:
            return {"ok": False, "error": "Servicio o acción no autorizada"}
        return _run(["systemctl", act if act != "status" else "is-active", svc])

    if op == "set_hostname":
        hostname = str(params.get("hostname", "")).strip()
        if not HOSTNAME_RE.match(hostname):
            return {"ok": False, "error": "Hostname inválido"}
        return _run(["hostnamectl", "set-hostname", hostname])

    if op == "set_timezone":
        tz = str(params.get("timezone", "")).strip()
        if not re.match(r"^[A-Za-z_]+/[A-Za-z_]+$", tz):
            return {"ok": False, "error": "Zona horaria inválida"}
        return _run(["timedatectl", "set-timezone", tz])

    if op == "wifi_scan":
        return _run(["nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list"])

    if op == "wifi_connect":
        ssid = str(params.get("ssid", "")).strip()
        psk = str(params.get("password", ""))
        if not ssid or len(ssid) > 64:
            return {"ok": False, "error": "SSID inválido"}
        return _run(["nmcli", "dev", "wifi", "connect", ssid, "password", psk], timeout=30)

    if op == "set_display":
        res = str(params.get("resolution", "1920x1080"))
        ori = str(params.get("orientation", "normal"))
        if not RESOLUTION_RE.match(res) or ori not in ALLOWED_ORIENTATIONS:
            return {"ok": False, "error": "Resolución u orientación inválida"}
        env = os.environ.copy()
        env["DISPLAY"] = ":0"
        out = subprocess.run(["xrandr", "--output", "HDMI-1", "--mode", res, "--rotate", ori], env=env, capture_output=True, text=True)
        return {"ok": out.returncode == 0, "stdout": out.stdout, "stderr": out.stderr}

    if op == "configure_swap":
        mb = int(params.get("swap_mb", 1024))
        if mb not in (256, 512, 1024, 2048):
            return {"ok": False, "error": "Tamaño de swap no permitido"}
        conf = "/etc/dphys-swapfile"
        if os.path.exists(conf):
            with open(conf, "w", encoding="utf-8") as fh:
                fh.write(f"CONF_SWAPSIZE={mb}\n")
            return _run(["systemctl", "restart", "dphys-swapfile"], timeout=45)
        return {"ok": False, "error": "dphys-swapfile no instalado"}

    if op == "journal_logs":
        unit = str(params.get("unit", "edusignage-player"))
        if unit not in ALLOWED_SERVICES:
            return {"ok": False, "error": "Unidad no autorizada"}
        return _run(["journalctl", "-u", unit, "-n", "100", "--no-pager"])

    if op == "reboot":
        return _run(["systemctl", "reboot"])
    if op == "shutdown":
        return _run(["systemctl", "poweroff"])

    return {"ok": False, "error": f"Operación desconocida: {op}"}


async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        raw = await reader.readline()
        req = json.loads(raw.decode("utf-8"))
        res = dispatch(req)
        writer.write((json.dumps(res) + "\n").encode("utf-8"))
        await writer.drain()
    except Exception as exc:
        writer.write((json.dumps({"ok": False, "error": str(exc)}) + "\n").encode("utf-8"))
        await writer.drain()
    finally:
        writer.close()


async def main() -> None:
    os.makedirs(os.path.dirname(HELPER_SOCKET), exist_ok=True)
    if os.path.exists(HELPER_SOCKET):
        os.remove(HELPER_SOCKET)
    server = await asyncio.start_unix_server(handle_client, path=HELPER_SOCKET)
    os.chmod(HELPER_SOCKET, 0o660)
    logger.info("Helper privilegiado activo en %s", HELPER_SOCKET)
    await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
