#!/usr/bin/env bash
set -euo pipefail

# EduSignage Pi - Actualizador Automático mediante Git Pull (sin perder base de datos ni medios)
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Ejecuta con sudo: sudo ./update.sh"
  exit 1
fi

BUILD_WEB=false
for arg in "$@"; do
  if [[ "$arg" == "--build-web" ]]; then
    BUILD_WEB=true
  fi
done

INSTALL_DIR="/opt/edusignage"
CALLER_REPO="${EDUSIGNAGE_REPO_ROOT:-${INSTALL_DIR}/repo}"
SNAP_DIR="${INSTALL_DIR}/backups/pre_update_$(date +%Y%m%d_%H%M%S)"

mkdir -p "$SNAP_DIR"
if [[ -f "${INSTALL_DIR}/data/edusignage.db" ]]; then
  cp -a "${INSTALL_DIR}/data/edusignage.db" "${SNAP_DIR}/"
  echo "==> Copia preventiva de SQLite guardada en ${SNAP_DIR}"
fi

if [[ -d "${CALLER_REPO}/.git" ]]; then
  echo "==> Descargando últimos cambios desde GitHub (git pull --ff-only)..."
  git -c "safe.directory=${CALLER_REPO}" -C "$CALLER_REPO" fetch --all --prune
  git -c "safe.directory=${CALLER_REPO}" -C "$CALLER_REPO" pull --ff-only
  if [[ "$CALLER_REPO" != "${INSTALL_DIR}/repo" ]]; then
    rm -rf "${INSTALL_DIR}/repo"
    cp -a "$CALLER_REPO" "${INSTALL_DIR}/repo"
  fi
elif [[ -d "${INSTALL_DIR}/repo/.git" ]]; then
  echo "==> Descargando últimos cambios en ${INSTALL_DIR}/repo..."
  git -c "safe.directory=${INSTALL_DIR}/repo" -C "${INSTALL_DIR}/repo" fetch --all --prune
  git -c "safe.directory=${INSTALL_DIR}/repo" -C "${INSTALL_DIR}/repo" pull --ff-only
else
  echo "ADVERTENCIA: No se detectó repositorio Git; aplicando archivos locales existentes."
fi

REPO_DIR="${INSTALL_DIR}/repo"

echo "==> Asegurando dependencias X11 sin escritorio (xorg, xinit, openbox, xserver-xorg-legacy, dbus-x11, kbd)..."
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  xserver-xorg xserver-xorg-legacy xinit openbox unclutter x11-xserver-utils dbus-x11 kbd >/dev/null 2>&1 || true
usermod -aG video,audio,render,tty,input edusignage 2>/dev/null || true

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
    echo "==> Deshabilitando y enmascarando gestor de escritorio (${dm}) para liberar HDMI..."
    grep -qxF "$dm" "${INSTALL_DIR}/backups/prev_dm.txt" 2>/dev/null || echo "$dm" >> "${INSTALL_DIR}/backups/prev_dm.txt"
  fi
  systemctl stop "${dm}.service" 2>/dev/null || true
  systemctl disable "${dm}.service" 2>/dev/null || true
  systemctl mask "${dm}.service" 2>/dev/null || true
done

systemctl stop display-manager.service 2>/dev/null || true
systemctl disable display-manager.service 2>/dev/null || true
if [[ -e /etc/systemd/system/display-manager.service || -L /etc/systemd/system/display-manager.service ]]; then
  [[ "$(readlink -f /etc/systemd/system/display-manager.service 2>/dev/null || true)" != "/dev/null" ]] && rm -f /etc/systemd/system/display-manager.service
fi
systemctl mask display-manager.service 2>/dev/null || true

for tty_unit in getty@tty1 autologin@tty1; do
  if systemctl is-enabled "${tty_unit}.service" >/dev/null 2>&1; then
    grep -qxF "$tty_unit" "${INSTALL_DIR}/backups/prev_tty1.txt" 2>/dev/null || echo "$tty_unit" >> "${INSTALL_DIR}/backups/prev_tty1.txt"
  fi
  systemctl stop "${tty_unit}.service" 2>/dev/null || true
  systemctl disable "${tty_unit}.service" 2>/dev/null || true
  systemctl mask "${tty_unit}.service" 2>/dev/null || true
done

systemctl set-default multi-user.target || true

cat <<'EOF' > /etc/X11/Xwrapper.config
allowed_users=anybody
needs_root_rights=yes
EOF

echo "==> Deteniendo servicios EduSignage..."
systemctl stop edusignage-scheduler edusignage-player edusignage-x11 edusignage-web || true

cp -r "${REPO_DIR}/pi_package/app/"* "${INSTALL_DIR}/app/"
cp "${REPO_DIR}/pi_package/openbox/autostart" /etc/xdg/openbox/edusignage-xinitrc
chmod 0755 /etc/xdg/openbox/edusignage-xinitrc
"${INSTALL_DIR}/venv/bin/pip" install -r "${REPO_DIR}/pi_package/requirements.txt"

if [[ "$BUILD_WEB" == "true" ]] && command -v npm >/dev/null 2>&1 && [[ -f "${REPO_DIR}/package.json" ]]; then
  echo "==> Recompilando interfaz web desde src/..."
  pushd "$REPO_DIR" >/dev/null
  NODE_OPTIONS="--max-old-space-size=512" npm install --legacy-peer-deps --no-audit --no-fund
  NODE_OPTIONS="--max-old-space-size=512" npm run build
  rm -rf "${INSTALL_DIR}/web/"*
  cp -r dist/* "${INSTALL_DIR}/web/"
  popd >/dev/null
elif [[ -f "${REPO_DIR}/pi_package/web/index.html" ]]; then
  echo "==> Actualizando interfaz web precompilada..."
  rm -rf "${INSTALL_DIR}/web/"*
  cp -r "${REPO_DIR}/pi_package/web/"* "${INSTALL_DIR}/web/"
fi

cp "${REPO_DIR}/pi_package/systemd/"*.service /etc/systemd/system/
systemctl daemon-reload
chown -R edusignage:edusignage "${INSTALL_DIR}/app" "${INSTALL_DIR}/web" "${INSTALL_DIR}/repo"

echo "==> Habilitando y reiniciando servicios y sesión X11 exclusiva en HDMI..."
systemctl enable --now edusignage-system-helper.service
systemctl restart edusignage-system-helper.service
systemctl enable --now edusignage-x11.service
systemctl restart edusignage-x11.service
systemctl enable --now edusignage-web.service
systemctl restart edusignage-web.service
systemctl enable --now edusignage-player.service
systemctl restart edusignage-player.service
systemctl enable --now edusignage-scheduler.service
systemctl restart edusignage-scheduler.service
echo "==> Actualización completada correctamente."
