# EduSignage Pi — Paquete Nativo para Raspberry Pi OS Lite (32/64-bit)

Optimizado específicamente para **Raspberry Pi 3 Model B** (1 GB RAM, ARM Cortex-A53, VideoCore IV).

## Instalación en Raspberry Pi OS Lite

1. Clona el repositorio en tu Raspberry Pi y ejecuta el instalador:
   ```bash
   git clone https://github.com/TU-USUARIO/edusignage-pi.git
   cd edusignage-pi
   sudo ./install.sh
   ```

2. Accede desde cualquier navegador de la red local:
   - `http://edusignage.local:8080`
   - o mediante la IP local asignada a la Raspberry Pi en el puerto `8080`.

## Arquitectura de Servicios `systemd`

- `edusignage-web.service`: Servidor FastAPI sin privilegios root.
- `edusignage-scheduler.service`: Motor autónomo de evaluación horaria (independiente del navegador).
- `edusignage-player.service`: Control exclusivo de `DISPLAY=:0` bajo X11 + Openbox (`chromium`, `firefox-esr`, `feh`, `mpv`, `retroarch`).
- `edusignage-system-helper.service`: Servicio auxiliar root con lista blanca estricta de comandos OS.
- `edusignage-x11.service`: Sesión X11/Openbox directa sin entorno de escritorio pesado.

## Verificación tras instalar

```bash
systemctl status edusignage-web edusignage-scheduler edusignage-player edusignage-system-helper
vcgencmd measure_temp
free -m
```
