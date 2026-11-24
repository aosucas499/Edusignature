"""
EduSignage Pi - Capa de persistencia SQLite asíncrona.
Compatible con Raspberry Pi OS Lite 32-bit (armv7l) y 64-bit (aarch64).
"""
import os
import aiosqlite

DB_PATH = os.environ.get("EDUSIGNAGE_DB", "/opt/edusignage/data/edusignage.db")


async def get_db() -> aiosqlite.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL;")
    await db.execute("PRAGMA foreign_keys=ON;")
    return db


async def init_db() -> None:
    db = await get_db()
    try:
        await db.executescript(
            """
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
                messages_json TEXT NOT NULL DEFAULT '["Bienvenidos al curso académico","Recreo general: 11:15 – 11:45"]',
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
                security TEXT NOT NULL DEFAULT 'WPA2-PSK',
                signal INTEGER NOT NULL DEFAULT 80,
                connected INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )

        defaults = {
            "device_name": "EduSignage Hall Principal",
            "hostname": "edusignage",
            "web_port": "8080",
            "media_root": "/opt/edusignage/media",
            "samba_enabled": "true",
            "ssh_enabled": "true",
            "mdns_enabled": "true",
            "resolution": "1920x1080",
            "orientation": "normal",
            "timezone": "Europe/Madrid",
            "swap_mb": "1024",
            "boot_autostart": "true",
            "auth_enabled": "false",
            "app_version": "1.0.0-rpi3b",
        }
        for k, v in defaults.items():
            await db.execute(
                "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
                (k, v),
            )

        await db.execute("INSERT OR IGNORE INTO standby_config (id) VALUES (1)")

        old_chromium_args = "--kiosk --noerrdialogs --disable-infobars --disable-dev-shm-usage"
        new_chromium_args = (
            "--kiosk --noerrdialogs --disable-infobars --disable-dev-shm-usage "
            "--disable-metrics --disable-metrics-reporting --disable-breakpad --disable-crash-reporter"
        )

        cur = await db.execute("SELECT COUNT(*) as c FROM authorized_apps")
        row = await cur.fetchone()
        if row["c"] == 0:
            apps = [
                ("RetroArch (Emulador Educativo)", "/usr/bin/retroarch", "--fullscreen", "fullscreen", 30, "standby", 1, "medium", 1, "Emulador ligero compatible con VideoCore IV"),
                ("Presentación feh (Carpeta Imágenes)", "/usr/bin/feh", "--fullscreen --auto-zoom --hide-pointer --slideshow-delay 8", "fullscreen", 60, "standby", 1, "low", 1, "Opción predeterminada (<35 MB RAM) para RPi 3B"),
                ("Reproductor MPV Local", "/usr/bin/mpv", "--fs --no-osd-bar --hwdec=auto-safe", "fullscreen", 45, "standby", 1, "low", 1, "Reproducción de vídeo local H.264/MP4"),
                ("Chromium Kiosco", "/usr/bin/chromium-browser", new_chromium_args, "fullscreen", 120, "standby", 1, "high", 1, "Navegador web kiosco sin métricas/volcados (se cierra al cambiar)"),
                ("Firefox ESR Kiosco", "/usr/bin/firefox-esr", "--kiosk", "fullscreen", 90, "standby", 0, "high", 1, "Alternativa opcional; requiere swap >= 1024 MB"),
                ("LibreOffice Impress", "/usr/bin/libreoffice", "--impress --norestore", "fullscreen", 30, "standby", 1, "medium", 1, "Presentaciones ODP/PPTX locales (añade ruta .odp --show si deseas reproducción directa)"),
            ]
            await db.executemany(
                """
                INSERT INTO authorized_apps
                (name, binary_path, args, display_mode, default_duration_min, on_finish_action, rpi3b_compatible, ram_profile, enabled, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                apps,
            )
        else:
            await db.execute(
                "UPDATE authorized_apps SET args = ? WHERE name = 'Chromium Kiosco' AND args = ?",
                (new_chromium_args, old_chromium_args),
            )

        await db.commit()
    finally:
        await db.close()
