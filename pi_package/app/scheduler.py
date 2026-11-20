"""
EduSignage Pi - Motor de Planificación Independiente (edusignage-scheduler.service)
Evalúa las reglas almacenadas en SQLite cada 10 segundos sin depender del navegador web.
Envia órdenes de reproducción al demonio reproductor mediante socket Unix.
"""
import asyncio
import json
import logging
import os
import socket
from datetime import datetime
from database import get_db, init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SCHEDULER] %(levelname)s: %(message)s",
)
logger = logging.getLogger("edusignage.scheduler")

PLAYER_SOCKET = os.environ.get("EDUSIGNAGE_PLAYER_SOCK", "/run/edusignage/player.sock")
OVERRIDE_FILE = "/run/edusignage/manual_override.json"


def _time_in_window(now_hhmm: str, start_hhmm: str, end_hhmm: str) -> bool:
    if start_hhmm <= end_hhmm:
        return start_hhmm <= now_hhmm < end_hhmm
    # Ventana nocturna que cruza medianoche
    return now_hhmm >= start_hhmm or now_hhmm < end_hhmm


async def resolve_active_schedule():
    now = datetime.now()
    now_hhmm = now.strftime("%H:%M")
    today_iso = now.strftime("%Y-%m-%d")
    # ISO weekday: 1=Lunes .. 7=Domingo
    weekday_str = str(now.isoweekday())

    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM schedules WHERE enabled = 1 ORDER BY priority DESC, id ASC"
        )
        rows = await cur.fetchall()

        for row in rows:
            days = [d.strip() for d in (row["days_of_week"] or "").split(",") if d.strip()]
            if row["recurrence_mode"] != "daily" and weekday_str not in days:
                continue

            if row["start_date"] and today_iso < row["start_date"]:
                continue
            if row["end_date"] and today_iso > row["end_date"]:
                continue

            if _time_in_window(now_hhmm, row["start_time"], row["end_time"]):
                return {
                    "source": "schedule",
                    "schedule_id": row["id"],
                    "name": row["name"],
                    "content_type": row["content_type"],
                    "target_ref": row["target_ref"],
                    "config": json.loads(row["config_json"] or "{}"),
                    "on_finish_action": row["on_finish_action"],
                }

        # Sin programación activa: cargar pantalla de espera
        standby_cur = await db.execute("SELECT * FROM standby_config WHERE id = 1")
        standby = await standby_cur.fetchone()
        return {
            "source": "standby",
            "schedule_id": None,
            "name": "Pantalla de Espera",
            "content_type": "standby",
            "target_ref": "standby",
            "config": dict(standby) if standby else {},
            "on_finish_action": "standby",
        }
    finally:
        await db.close()


def send_player_command(payload: dict) -> bool:
    if not os.path.exists(PLAYER_SOCKET):
        logger.warning("Socket del reproductor no disponible: %s", PLAYER_SOCKET)
        return False
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(4.0)
            sock.connect(PLAYER_SOCKET)
            sock.sendall((json.dumps(payload) + "\n").encode("utf-8"))
            resp = sock.recv(4096).decode("utf-8").strip()
            logger.info("Respuesta reproductor: %s", resp)
            return True
    except Exception as exc:
        logger.error("Error comunicando con reproductor: %s", exc)
        return False


def check_manual_override():
    if not os.path.exists(OVERRIDE_FILE):
        return None
    try:
        with open(OVERRIDE_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        expires_at = data.get("expires_at")
        if expires_at and datetime.now().timestamp() > float(expires_at):
            os.remove(OVERRIDE_FILE)
            return None
        return data
    except Exception:
        return None


async def main_loop():
    await init_db()
    last_signature = None
    logger.info("Motor de planificación iniciado.")

    while True:
        try:
            # Si el reproductor se reinició o perdió el proceso, forzar reenvío de la regla activa
            state_file = "/run/edusignage/player_state.json"
            if os.path.exists(state_file):
                try:
                    st = json.load(open(state_file, "r", encoding="utf-8"))
                    if st.get("pid") is None and st.get("status") in ("error", "recovered"):
                        last_signature = None
                except Exception:
                    pass

            override = check_manual_override()
            desired = override if override else await resolve_active_schedule()
            signature = json.dumps(
                {
                    "content_type": desired.get("content_type"),
                    "target_ref": desired.get("target_ref"),
                    "schedule_id": desired.get("schedule_id"),
                    "source": desired.get("source"),
                },
                sort_keys=True,
            )

            if signature != last_signature:
                logger.info("Cambio de contenido detectado: %s", desired.get("name"))
                if send_player_command({"action": "play", "item": desired}):
                    last_signature = signature
        except Exception as exc:
            logger.exception("Fallo en ciclo de planificación: %s", exc)

        await asyncio.sleep(10)


if __name__ == "__main__":
    asyncio.run(main_loop())
