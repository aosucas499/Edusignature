#!/usr/bin/env bash
set -euo pipefail
trap '' HUP

# EduSignage Pi - Instalador Automático mediante Git Clone para Raspberry Pi OS (Lite y Desktop, 32/64-bit)
# Optimizado para Raspberry Pi 3 Model B (1 GB RAM, ARM Cortex-A53, VideoCore IV)

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Ejecuta este instalador con sudo: sudo ./install.sh"
  exit 1
fi

BUILD_WEB=false
for arg in "$@"; do
  if [[ "$arg" == "--build-web" ]]; then
    BUILD_WEB=true
  fi
done

ARCH="$(uname -m)"
echo "==> Arquitectura detectada: ${ARCH}"
if [[ "$ARCH" != "armv7l" && "$ARCH" != "aarch64" && "$ARCH" != "x86_64" ]]; then
  echo "ADVERTENCIA: Arquitectura no estándar (${ARCH}). Continuando bajo compatibilidad Linux."
fi

if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  echo "==> Sistema operativo: ${PRETTY_NAME:-Linux}"
fi

INSTALL_DIR="/opt/edusignage"
REPO_ROOT="${EDUSIGNAGE_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PKG_DIR="${REPO_ROOT}/pi_package"
BACKUP_DIR="${INSTALL_DIR}/backups/pre_install_$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

echo "==> Actualizando índices APT e instalando dependencias base y X11/Openbox..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git curl ca-certificates \
  python3 python3-venv python3-pip python3-psutil python3-dev sqlite3 \
  xserver-xorg xserver-xorg-legacy xinit xauth openbox unclutter x11-xserver-utils dbus-x11 kbd \
  feh mpv avahi-daemon network-manager

DEBIAN_FRONTEND=noninteractive apt-get install -y chromium || \
  DEBIAN_FRONTEND=noninteractive apt-get install -y chromium-browser || true

if apt-cache show dphys-swapfile >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y dphys-swapfile || true
fi

read -r -p "¿Instalar Firefox ESR y RetroArch como reproductores adicionales? [s/N]: " OPT_EXTRA
if [[ "${OPT_EXTRA,,}" == "s" || "${OPT_EXTRA,,}" == "y" ]]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y firefox-esr retroarch || true
fi

read -r -p "¿Configurar Samba para compartir /opt/edusignage/media en red local? [S/n]: " OPT_SAMBA
OPT_SAMBA="${OPT_SAMBA:-S}"
if [[ "${OPT_SAMBA,,}" == "s" || "${OPT_SAMBA,,}" == "y" ]]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y samba || true
fi

echo "==> Creando/actualizando usuario de servicio sin privilegios 'edusignage'..."
if ! id -u edusignage >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin --groups video,audio,render,tty,input edusignage
else
  usermod -aG video,audio,render,tty,input edusignage || true
fi

echo "==> Creando estructura de carpetas en ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"/{app,web,data,media/images,media/videos,media/web,backups,logs}

echo "==> Optimizando Swap (1024 MB) para Raspberry Pi 3 Model B (1 GB RAM)..."
if [[ -f /etc/dphys-swapfile ]]; then
  cp /etc/dphys-swapfile "${BACKUP_DIR}/dphys-swapfile.bak"
  sed -i 's/^#*CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
  systemctl restart dphys-swapfile || true
fi

echo "==> Configurando permisos X11 para arranque directo sin escritorio..."
if [[ -f /etc/X11/Xwrapper.config ]]; then
  cp /etc/X11/Xwrapper.config "${BACKUP_DIR}/Xwrapper.config.bak"
fi
cat <<'EOF' > /etc/X11/Xwrapper.config
allowed_users=anybody
needs_root_rights=yes
EOF

if [[ ! -f "${INSTALL_DIR}/backups/prev_default_target.txt" ]]; then
  systemctl get-default > "${INSTALL_DIR}/backups/prev_default_target.txt" 2>/dev/null || echo "multi-user.target" > "${INSTALL_DIR}/backups/prev_default_target.txt"
fi

if [[ -L /etc/systemd/system/display-manager.service ]]; then
  DM_TARGET="$(basename "$(readlink -f /etc/systemd/system/display-manager.service)" .service 2>/dev/null || true)"
  if [[ -n "$DM_TARGET" && "$DM_TARGET" != "null" ]]; then
    grep -qxF "$DM_TARGET" "${INSTALL_DIR}/backups/prev_dm.txt" 2>/dev/null || echo "$DM_TARGET" >> "${INSTALL_DIR}/backups/prev_dm.txt"
  fi
fi

for dm in lightdm greetd gdm3 sddm xdm; do
  if systemctl is-enabled "${dm}.service" >/dev/null 2>&1 || systemctl is-active "${dm}.service" >/dev/null 2>&1; then
    echo "==> Deshabilitando y enmascarando gestor de escritorio (${dm})..."
    grep -qxF "$dm" "${INSTALL_DIR}/backups/prev_dm.txt" 2>/dev/null || echo "$dm" >> "${INSTALL_DIR}/backups/prev_dm.txt"
  fi
  systemctl disable "${dm}.service" 2>/dev/null || true
  systemctl mask "${dm}.service" 2>/dev/null || true
done

systemctl disable display-manager.service 2>/dev/null || true
if [[ -e /etc/systemd/system/display-manager.service || -L /etc/systemd/system/display-manager.service ]]; then
  if [[ "$(readlink -f /etc/systemd/system/display-manager.service 2>/dev/null || true)" != "/dev/null" ]]; then
    rm -f /etc/systemd/system/display-manager.service
  fi
fi
systemctl mask display-manager.service 2>/dev/null || true

for tty_unit in getty@tty1 autologin@tty1; do
  if systemctl is-enabled "${tty_unit}.service" >/dev/null 2>&1; then
    grep -qxF "$tty_unit" "${INSTALL_DIR}/backups/prev_tty1.txt" 2>/dev/null || echo "$tty_unit" >> "${INSTALL_DIR}/backups/prev_tty1.txt"
  fi
  systemctl disable "${tty_unit}.service" 2>/dev/null || true
  systemctl mask "${tty_unit}.service" 2>/dev/null || true
done

systemctl set-default multi-user.target || true

echo "==> Sincronizando código fuente desde el repositorio Git..."
if [[ "$REPO_ROOT" != "${INSTALL_DIR}/repo" ]]; then
  rm -rf "${INSTALL_DIR}/repo"
  cp -a "$REPO_ROOT" "${INSTALL_DIR}/repo"
fi
git config --system --add safe.directory "${INSTALL_DIR}/repo" 2>/dev/null || true

cp -r "${INSTALL_DIR}/repo/pi_package/app/"* "${INSTALL_DIR}/app/"
chmod 0755 "${INSTALL_DIR}/app/start_x11.sh"

echo "==> Configurando entorno virtual Python..."
python3 -m venv --system-site-packages "${INSTALL_DIR}/venv"
"${INSTALL_DIR}/venv/bin/pip" install --upgrade pip || true
"${INSTALL_DIR}/venv/bin/pip" install -r "${INSTALL_DIR}/repo/pi_package/requirements.txt"

echo "==> Instalando interfaz web administrativa..."
if [[ "$BUILD_WEB" == "true" || ! -f "${INSTALL_DIR}/repo/pi_package/web/index.html" ]]; then
  echo "==> Compilando interfaz web desde código fuente..."
  if ! command -v npm >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm || true
  fi
  if command -v npm >/dev/null 2>&1 && [[ -f "${INSTALL_DIR}/repo/package.json" ]]; then
    pushd "${INSTALL_DIR}/repo" >/dev/null
    NODE_OPTIONS="--max-old-space-size=512" npm install --legacy-peer-deps --no-audit --no-fund
    NODE_OPTIONS="--max-old-space-size=512" npm run build
    rm -rf "${INSTALL_DIR}/web/"*
    cp -r dist/* "${INSTALL_DIR}/web/"
    popd >/dev/null
  else
    echo "ERROR: No se encontró pi_package/web ni npm para compilar el panel web."
    exit 1
  fi
else
  rm -rf "${INSTALL_DIR}/web/"*
  cp -r "${INSTALL_DIR}/repo/pi_package/web/"* "${INSTALL_DIR}/web/"
fi

echo "==> Copiando recursos gráficos iniciales a ${INSTALL_DIR}/media/images..."
if [[ -d "${INSTALL_DIR}/repo/src/assets/images" ]]; then
  cp -n "${INSTALL_DIR}/repo/src/assets/images/"edusignage_campus_banner_*.jpg "${INSTALL_DIR}/media/images/campus_atrio.jpg" 2>/dev/null || true
  cp -n "${INSTALL_DIR}/repo/src/assets/images/"edusignage_robotics_slide_*.jpg "${INSTALL_DIR}/media/images/taller_robotica.jpg" 2>/dev/null || true
  cp -n "${INSTALL_DIR}/repo/src/assets/images/"edusignage_school_crest_*.jpg "${INSTALL_DIR}/media/images/escudo_centro.jpg" 2>/dev/null || true
fi

echo "==> Configurando X11 + Openbox sin escritorio..."
cp "${PKG_DIR}/openbox/autostart" /etc/xdg/openbox/edusignage-xinitrc
chmod 0755 /etc/xdg/openbox/edusignage-xinitrc

if [[ "${OPT_SAMBA,,}" == "s" || "${OPT_SAMBA,,}" == "y" ]]; then
  if [[ -f /etc/samba/smb.conf ]]; then
    cp /etc/samba/smb.conf "${BACKUP_DIR}/smb.conf.bak"
    if ! grep -q "\[EduSignage-Media\]" /etc/samba/smb.conf; then
      cat "${PKG_DIR}/samba/smb.conf.snippet" >> /etc/samba/smb.conf
    fi
    systemctl enable --now smbd || true
  fi
fi

echo "==> Configurando Avahi mDNS (edusignage.local)..."
cp "${PKG_DIR}/avahi/edusignage.service" /etc/avahi/services/edusignage.service
systemctl enable --now avahi-daemon

echo "==> Ajustando permisos seguros (medios no ejecutables)..."
chown -R edusignage:edusignage "$INSTALL_DIR"
find "${INSTALL_DIR}/media" -type d -exec chmod 0755 {} \;
find "${INSTALL_DIR}/media" -type f -exec chmod 0644 {} \;

echo "==> Instalando e iniciando servicios systemd..."
cp "${PKG_DIR}/systemd/"*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable edusignage-system-helper.service edusignage-x11.service edusignage-web.service edusignage-player.service edusignage-scheduler.service

for conflict_unit in lightdm greetd gdm3 sddm xdm display-manager getty@tty1 autologin@tty1; do
  systemctl stop "${conflict_unit}.service" 2>/dev/null || true
done

systemctl restart edusignage-system-helper.service
systemctl restart edusignage-x11.service
systemctl restart edusignage-web.service
systemctl restart edusignage-player.service
systemctl restart edusignage-scheduler.service

echo "==> Verificando estado de bloqueo del escritorio y respuesta X11..."
X11_READY=false
for _ in $(seq 1 15); do
  if su -s /bin/sh edusignage -c "DISPLAY=:0 XAUTHORITY=/opt/edusignage/.Xauthority xset q >/dev/null 2>&1"; then
    X11_READY=true
    break
  fi
  sleep 1
done

for unit in lightdm display-manager getty@tty1; do
  ST="$(systemctl is-enabled "${unit}.service" 2>/dev/null || true)"
  echo "  - ${unit}.service: ${ST:-not-found}"
done
for svc in edusignage-system-helper edusignage-x11 edusignage-web edusignage-player edusignage-scheduler; do
  EN="$(systemctl is-enabled "${svc}.service" 2>/dev/null || true)"
  AC="$(systemctl is-active "${svc}.service" 2>/dev/null || true)"
  echo "  - ${svc}.service: enabled=${EN:-no} active=${AC:-no}"
done
if [[ "$X11_READY" == "true" ]]; then
  echo "  - [OK] Servidor X11 (:0) responde correctamente con cookie propia de 'edusignage'."
else
  echo "  - [ADVERTENCIA] X11 (:0) aún no respondió; ejecuta 'sudo reboot' y revisa 'journalctl -u edusignage-x11 -n 40'."
fi

LOCAL_IP="$(hostname -I | awk '{print $1}')"
echo ""
echo "================================================================="
echo " EduSignage Pi instalado correctamente"
echo " Acceso local: http://${LOCAL_IP:-127.0.0.1}:8080"
echo " Acceso mDNS : http://$(hostname).local:8080"
echo " Respaldo pre-instalación: ${BACKUP_DIR}"
echo " Para actualizar en el futuro: sudo ./update.sh"
echo "================================================================="
