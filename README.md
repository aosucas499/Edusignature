# EduSignage Pi

**Plataforma libre, autohospedada y de código abierto para cartelería digital (Digital Signage) y gestión remota de Raspberry Pi.**

EduSignage Pi transforma cualquier Raspberry Pi —optimizada especialmente para **Raspberry Pi 3 Model B** (1 GB de RAM, ARM Cortex-A53 y GPU VideoCore IV)— en un nodo autónomo de cartelería digital administrable desde cualquier navegador de tu red local, sin servicios en la nube, sin suscripciones y con control real sobre el sistema operativo Linux.

---

## Qué es y por qué existe

Las soluciones comerciales de cartelería digital suelen depender de servidores externos, suscripciones mensuales o contenedores pesados que saturan hardware modesto. **EduSignage Pi** funciona 100 % en local dentro de tu centro educativo, taller u organización:

- **Sin nube ni Internet obligatorio**: todo corre en la red local mediante SQLite, API REST, WebSockets y mDNS (`http://edusignage.local:8080`).
- **Optimizada para Raspberry Pi 3 Model B**: arranca directamente en un servidor gráfico ligero **X11 + Openbox** (sin escritorios pesados como GNOME o KDE), configura **Swap de 1024 MB** y cierra Chromium automáticamente cuando cambia a presentaciones o vídeo para liberar más de 400 MB de RAM.
- **Control real del hardware y del sistema operativo**: además de mostrar páginas web, imágenes, vídeos o aplicaciones Linux como **RetroArch**, permite administrar SSH, Samba, WiFi, resolución HDMI, orientación de pantalla, servicios `systemd`, procesos y copias de seguridad desde el panel web.

---

## Cómo funciona (Arquitectura en 4 servicios)

Para garantizar que el panel de administración siga siempre accesible aunque una aplicación gráfica o navegador se bloquee en la pantalla HDMI, la arquitectura divide las responsabilidades en cuatro procesos independientes gestionados por `systemd`:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Navegador en red local (PC / Tablet / Móvil)                             │
│ Interfaz Web Administrativa (React + Tailwind CSS + WebSocket)           │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ HTTP REST + WebSocket
┌────────────────────────────────────▼─────────────────────────────────────┐
│ 1. Servidor Web (edusignage-web.service)                                 │
│    FastAPI sin privilegios root · API REST · Subida segura · Backups     │
└───────────────┬───────────────────────────────────┬──────────────────────┘
                │ SQLite (WAL)                      │ Socket Unix
┌───────────────▼───────────────┐     ┌─────────────▼──────────────────────┐
│ Base de Datos Local           │     │ 2. Planificador (scheduler)        │
│ • Horarios y prioridades      │◄────┤    Evalúa reglas cada 10s          │
│ • Apps Linux autorizadas      │     │    Autónomo tras reinicios         │
│ • Pantalla de espera y logs   │     └─────────────┬──────────────────────┘
└───────────────────────────────┘                   │ Orden única
                                      ┌─────────────▼──────────────────────┐
                                      │ 3. Reproductor (player_daemon)     │
                                      │    Exclusivo en DISPLAY=:0         │
                                      │    Chromium | Firefox | feh |      │
                                      │    mpv | RetroArch | Espera        │
                                      └─────────────┬──────────────────────┘
                                                    │ Lista blanca estricta
                                      ┌─────────────▼──────────────────────┐
                                      │ 4. Helper OS (system_helper)       │
                                      │    Root aislado sin acceso shell   │
                                      │    SSH, WiFi, Hostname, HDMI, Swap │
                                      └────────────────────────────────────┘
```

### Principios de estabilidad y seguridad
- **Exclusión mutua en pantalla**: solo una aplicación controla `DISPLAY=:0` a la vez. El demonio reproductor vigila el proceso activo y lo recupera automáticamente si se cierra de forma inesperada.
- **Sin ejecución de comandos arbitrarios**: las aplicaciones Linux (como RetroArch o LibreOffice Impress) deben estar previamente registradas en el catálogo autorizado con rutas absolutas y sin operadores de shell.
- **Medios no ejecutables**: cualquier imagen, vídeo o recurso subido por web o por Samba recibe permisos `0644` para impedir su ejecución como código.
- **Acceso protegido opcional**: acceso directo inicial en red local con bloqueo activable desde **Ajustes > Seguridad** (credenciales con `scrypt` y cookies `HttpOnly`).

---

## Funcionalidades principales

- **Dashboard en tiempo real (WebSockets)**: uso y temperatura de CPU, RAM y Swap, espacio en disco, interfaces IP, tiempo encendido, estado de los servicios `systemd`, vista previa de lo que se está mostrando en HDMI y botones de acción rápida.
- **Programación horaria con calendario semanal visual**: creación y edición de franjas horarias con arrastrar y soltar (*drag & drop*), días de la semana, rangos de fechas opcionales, prioridades, repetición y acción al finalizar.
- **Reproductores nativos optimizados**:
  - **Páginas Web**: Chromium o Firefox ESR en modo kiosco, zoom, refresco periódico y desactivación de salvapantallas.
  - **Imágenes (`feh`)**: opción recomendada de muy bajo consumo (`< 35 MB` RAM) con intervalos, orden aleatorio/secuencial, subcarpetas y ajuste de proporciones.
  - **Vídeos (`mpv`)**: reproducción local MP4/MKV/WebM a pantalla completa con decodificación segura para VideoCore IV y control de volumen.
  - **Aplicaciones Linux y RetroArch**: lanzamiento a pantalla completa con duración configurable y retorno automático al planificador.
  - **Pantalla de espera institucional**: logotipo del centro, reloj, fecha y mensajes rotativos configurables.
- **Gestor multimedia + Samba**: subida de archivos, creación de carpetas, renombrado, vista previa y acceso directo desde Windows/macOS mediante recurso compartido `\\edusignage.local\EduSignage-Media`.
- **Administración de Raspberry Pi OS**: activación de SSH, hostname/mDNS, escaneo y conexión WiFi, resolución/rotación HDMI (`xrandr`), zona horaria, configuración de Swap, visor de procesos y logs, copias de seguridad JSON/SQLite y comprobación integral de salud.

---

## Requisitos en la Raspberry Pi

- **Hardware recomendado**: Raspberry Pi 3 Model B (1 GB RAM) o superior (Raspberry Pi 3B+ / 4 / 5 / Zero 2 W).
- **Sistema operativo**: **Raspberry Pi OS Lite** (32 bits `armv7l` o 64 bits `aarch64`, basado en Debian Bookworm/Bullseye).
- **Conexión**: cable Ethernet o WiFi durante la instalación inicial para descargar paquetes APT y el repositorio Git. Una vez instalado funciona sin Internet.

---

## Instalación en Raspberry Pi mediante `git clone`

Conéctate por SSH o teclado local a tu Raspberry Pi con Raspberry Pi OS Lite y ejecuta únicamente estos 3 comandos:

```bash
git clone https://github.com/TU-USUARIO/edusignage-pi.git
cd edusignage-pi
sudo ./install.sh
```

> Sustituye `TU-USUARIO/edusignage-pi` por la URL de tu repositorio en GitHub. Si tu Raspberry Pi OS no trajera `git` preinstalado, instálalo antes con `sudo apt update && sudo apt install -y git`.

### Qué realiza `install.sh` automáticamente
1. Detecta la arquitectura (`armv7l` / `aarch64`) y versión de Raspberry Pi OS.
2. Instala únicamente las dependencias ligeras necesarias (`xserver-xorg`, `openbox`, `unclutter`, `feh`, `mpv`, `chromium`, `python3-venv`, `sqlite3`, `avahi-daemon` y opcionalmente `firefox-esr`, `retroarch` y `samba`).
3. Crea el usuario de servicio sin privilegios `edusignage` y la estructura `/opt/edusignage/{app,web,data,media,backups,logs}`.
4. Configura **1024 MB de Swap** para garantizar estabilidad en Raspberry Pi 3B de 1 GB de RAM.
5. Despliega la interfaz web precompilada (sin necesidad de instalar Node.js ni compilar paquetes `npm` en la Raspberry Pi), prepara el entorno virtual Python e instala los 5 servicios `systemd` con arranque automático directo en pantalla (si modificas `src/`, puedes recompilar con `sudo ./install.sh --build-web`).
6. Crea copias de seguridad de `/etc/dphys-swapfile` y `/etc/samba/smb.conf` antes de modificarlos.

### Acceso tras la instalación
Al finalizar, el instalador mostrará la IP local y la URL de acceso desde cualquier navegador de la red:
- `http://edusignage.local:8080`
- o `http://<IP-DE-LA-RASPBERRY>:8080`

---

## Actualización desde GitHub (`git pull`)

Para actualizar tu Raspberry Pi a la última versión publicada en GitHub sin perder tu base de datos SQLite ni tus archivos multimedia, entra en la carpeta clonada y ejecuta:

```bash
cd edusignage-pi
sudo ./update.sh
```

El script `update.sh` realiza automáticamente una copia preventiva de `edusignage.db` en `/opt/edusignage/backups/`, descarga los cambios mediante `git pull --ff-only`, recompila la interfaz web si es necesario, actualiza el código FastAPI/daemons y reinicia los servicios `systemd`.

---

## Desinstalación

```bash
cd edusignage-pi
sudo ./uninstall.sh
```

Te preguntará si deseas conservar tus horarios y archivos multimedia en `/opt/edusignage` o eliminar todo por completo.

---

## Verificación y diagnóstico en Raspberry Pi OS

Comandos útiles por SSH si necesitas comprobar el estado del sistema:

```bash
# Estado de los servicios principales
systemctl status edusignage-web edusignage-scheduler edusignage-player edusignage-system-helper edusignage-x11

# Registros en tiempo real del planificador o reproductor
journalctl -u edusignage-scheduler -u edusignage-player -f

# Temperatura de CPU/GPU y uso de memoria RAM/Swap en RPi 3B
vcgencmd measure_temp
free -m
```

---

## Desarrollo local en PC / Entorno Web

Si deseas probar o modificar la interfaz web y el servidor de administración directamente en un ordenador Linux/macOS:

```bash
npm install
npm run dev
```

El servidor de desarrollo se iniciará en `http://localhost:3000` con base de datos SQLite local (`data/edusignage.db`), WebSockets en vivo y generador del paquete nativo para Raspberry Pi.

---

## Estructura principal del proyecto

- `install.sh`, `update.sh`, `uninstall.sh`: lanzadores en la raíz para despliegue directo tras `git clone`.
- `pi_package/`: código nativo Python (`FastAPI`, `scheduler.py`, `player_daemon.py`, `system_helper.py`), unidades `systemd/`, configuración minimalista de `openbox/`, `samba/`, `avahi/` y scripts de ciclo de vida.
- `src/`: interfaz web administrativa (React, TypeScript, Tailwind CSS v4).
- `server/` y `server.ts`: servidor Node/Express/SQLite/WebSocket para ejecución y pruebas en entorno de desarrollo.

---

## Licencia

Distribuido bajo licencia **MIT**. Consulta el archivo [`LICENSE`](LICENSE) para más información.
