#!/usr/bin/env bash
set -euo pipefail

# EduSignage Pi - Instalador Automático mediante Git Clone para Raspberry Pi OS Lite (32/64-bit)
# Optimizado para Raspberry Pi 3 Model B (1 GB RAM, ARM Cortex-A53, VideoCore IV)

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Ejecuta este instalador con sudo: sudo bash install.sh"
  exit 1
fi

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
  python3 python3-venv python3-pip sqlite3 \
  xserver-xorg xinit openbox unclutter x11-xserver-utils \
  feh mpv chromium \
  avahi-daemon dphys-swapfile network-manager

read -r -p "¿Instalar Firefox ESR y RetroArch como reproductores adicionales? [s/N]: " OPT_EXTRA
if [[ "${OPT_EXTRA,,}" == "s" || "${OPT_EXTRA,,}" == "y" ]]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y firefox-esr retroarch || true
fi

read -r -p "¿Configurar Samba para compartir /opt/edusignage/media en red local? [S/n]: " OPT_SAMBA
OPT_SAMBA="${OPT_SAMBA:-S}"
if [[ "${OPT_SAMBA,,}" == "s" || "${OPT_SAMBA,,}" == "y" ]]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y samba
fi

echo "==> Creando usuario de servicio sin privilegios 'edusignage'..."
if ! id -u edusignage >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin --groups video,audio,render,tty edusignage
fi

echo "==> Creando estructura de carpetas en ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"/{app,web,data,media/images,media/videos,media/web,backups,logs}

echo "==> Optimizando Swap (1024 MB) para Raspberry Pi 3 Model B (1 GB RAM)..."
if [[ -f /etc/dphys-swapfile ]]; then
  cp /etc/dphys-swapfile "${BACKUP_DIR}/dphys-swapfile.bak"
  sed -i 's/^#*CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
  systemctl restart dphys-swapfile || true
fi

echo "==> Sincronizando código fuente desde el repositorio Git..."
if [[ "$REPO_ROOT" != "${INSTALL_DIR}/repo" ]]; then
  rm -rf "${INSTALL_DIR}/repo"
  cp -a "$REPO_ROOT" "${INSTALL_DIR}/repo"
fi
git config --system --add safe.directory "${INSTALL_DIR}/repo" 2>/dev/null || true

cp -r "${INSTALL_DIR}/repo/pi_package/app/"* "${INSTALL_DIR}/app/"

echo "==> Configurando entorno virtual Python..."
python3 -m venv "${INSTALL_DIR}/venv"
"${INSTALL_DIR}/venv/bin/pip" install --upgrade pip
"${INSTALL_DIR}/venv/bin/pip" install -r "${INSTALL_DIR}/repo/pi_package/requirements.txt"

echo "==> Compilando interfaz web administrativa..."
if ! command -v npm >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm || true
fi

if command -v npm >/dev/null 2>&1 && [[ -f "${INSTALL_DIR}/repo/package.json" ]]; then
  pushd "${INSTALL_DIR}/repo" >/dev/null
  NODE_OPTIONS="--max-old-space-size=512" npm install --no-audit --no-fund
  NODE_OPTIONS="--max-old-space-size=512" npm run build
  cp -r dist/* "${INSTALL_DIR}/web/"
  popd >/dev/null
elif [[ -d "${INSTALL_DIR}/repo/dist" ]]; then
  cp -r "${INSTALL_DIR}/repo/dist/"* "${INSTALL_DIR}/web/"
else
  echo "ADVERTENCIA: No se pudo compilar el frontend web (npm no disponible y sin carpeta dist/)."
fi

echo "==> Copiando recursos gráficos iniciales a ${INSTALL_DIR}/media/images..."
if [[ -d "${INSTALL_DIR}/repo/src/assets/images" ]]; then
  cp -n "${INSTALL_DIR}/repo/src/assets/images/"*.jpg "${INSTALL_DIR}/media/images/" 2>/dev/null || true
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
    systemctl enable --now smbd
  fi
fi

echo "==> Configurando Avahi mDNS (edusignage.local)..."
cp "${PKG_DIR}/avahi/edusignage.service" /etc/avahi/services/edusignage.service
systemctl enable --now avahi-daemon

echo "==> Ajustando permisos seguros (medios no ejecutables)..."
chown -R edusignage:edusignage "$INSTALL_DIR"
find "${INSTALL_DIR}/media" -type d -exec chmod 0755 {} \;
find "${INSTALL_DIR}/media" -type f -exec chmod 0644 {} \;

echo "==> Instalando servicios systemd..."
cp "${PKG_DIR}/systemd/"*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now edusignage-system-helper.service
systemctl enable --now edusignage-x11.service
systemctl enable --now edusignage-player.service
systemctl enable --now edusignage-scheduler.service
systemctl enable --now edusignage-web.service

LOCAL_IP="$(hostname -I | awk '{print $1}')"
echo ""
echo "================================================================="
echo " EduSignage Pi instalado correctamente desde Git"
echo " Acceso local: http://${LOCAL_IP:-127.0.0.1}:8080"
echo " Acceso mDNS : http://$(hostname).local:8080"
echo " Respaldo pre-instalación: ${BACKUP_DIR}"
echo " Para actualizar en el futuro: cd ${INSTALL_DIR}/repo && sudo bash update.sh"
echo "================================================================="
