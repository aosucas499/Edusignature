#!/usr/bin/env bash
set -euo pipefail
trap '' HUP

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

echo "==> Asegurando dependencias X11 sin escritorio (xorg, xinit, xauth, openbox, xserver-xorg-legacy, dbus-x11, kbd)..."
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  xserver-xorg xserver-xorg-legacy xinit xauth openbox unclutter x11-xserver-utils dbus-x11 kbd >/dev/null 2>&1 || true
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

echo "==> Enmascarando de forma reversible gestores de escritorio y tty1..."
for dm in lightdm greetd gdm3 sddm xdm; do
  if systemctl is-enabled "${dm}.service" >/dev/null 2>&1 || systemctl is-active "${dm}.service" >/dev/null 2>&1; then
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

cat <<'EOF' > /etc/X11/Xwrapper.config
allowed_users=anybody
needs_root_rights=yes
EOF

echo "==> Actualizando código de aplicación, Openbox y dependencias Python..."
systemctl stop edusignage-scheduler edusignage-player edusignage-x11 edusignage-web 2>/dev/null || true

echo "==> Purgando archivos .pma y Crash Reports acumulados de Chromium..."
PMA_REMOVED=0
for ch_dir in "${INSTALL_DIR}/.config/chromium" "${INSTALL_DIR}/data/chromium-profile"; do
  if [[ -d "$ch_dir" ]]; then
    CNT=$(find "$ch_dir" -maxdepth 2 -type f -name '*.pma' 2>/dev/null | wc -l)
    PMA_REMOVED=$((PMA_REMOVED + CNT))
    find "$ch_dir" -maxdepth 1 -type f -name '*.pma' -delete 2>/dev/null || true
    if [[ -d "${ch_dir}/BrowserMetrics" ]]; then
      find "${ch_dir}/BrowserMetrics" -type f -name '*.pma' -delete 2>/dev/null || true
    fi
    if [[ -d "${ch_dir}/Crash Reports" ]]; then
      rm -rf "${ch_dir}/Crash Reports/"* 2>/dev/null || true
    fi
  fi
done
echo "  - Limpieza de telemetría Chromium completada (${PMA_REMOVED} archivo(s) .pma purgados)."

cp -r "${REPO_DIR}/pi_package/app/"* "${INSTALL_DIR}/app/"
chmod 0755 "${INSTALL_DIR}/app/start_x11.sh"
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

echo "==> Habilitando servicios de EduSignage..."
systemctl enable edusignage-system-helper.service edusignage-x11.service edusignage-web.service edusignage-player.service edusignage-scheduler.service

echo "==> Liberando HDMI de sesiones de escritorio previas y arrancando EduSignage..."
for conflict_unit in lightdm greetd gdm3 sddm xdm display-manager getty@tty1 autologin@tty1; do
  systemctl stop "${conflict_unit}.service" 2>/dev/null || true
done

systemctl restart edusignage-system-helper.service
systemctl restart edusignage-x11.service
systemctl restart edusignage-web.service
systemctl restart edusignage-player.service
systemctl restart edusignage-scheduler.service

echo ""
echo "==> Autoverificación post-actualización:"
ALL_OK=true

for unit in lightdm display-manager getty@tty1; do
  ST="$(systemctl is-enabled "${unit}.service" 2>/dev/null || true)"
  if [[ "$ST" == "masked" || "$ST" == "not-found" || -z "$ST" ]]; then
    echo "  [OK] ${unit}.service -> ${ST:-not-found}"
  else
    echo "  [ERROR] ${unit}.service sigue en estado '${ST}' (debería ser masked)"
    ALL_OK=false
  fi
done

for svc in edusignage-system-helper edusignage-x11 edusignage-web edusignage-player edusignage-scheduler; do
  EN="$(systemctl is-enabled "${svc}.service" 2>/dev/null || true)"
  AC="$(systemctl is-active "${svc}.service" 2>/dev/null || true)"
  if [[ "$EN" == "enabled" && "$AC" == "active" ]]; then
    echo "  [OK] ${svc}.service -> enabled + active"
  else
    echo "  [ERROR] ${svc}.service -> enabled=${EN:-no}, active=${AC:-no}"
    ALL_OK=false
  fi
done

X11_READY=false
for _ in $(seq 1 15); do
  if su -s /bin/sh edusignage -c "DISPLAY=:0 XAUTHORITY=/opt/edusignage/.Xauthority xset q >/dev/null 2>&1"; then
    X11_READY=true
    break
  fi
  sleep 1
done

if [[ "$X11_READY" == "true" ]]; then
  echo "  [OK] X11 (:0) responde correctamente para el usuario 'edusignage'."
else
  echo "  [ERROR] X11 (:0) no autorizó o no respondió en 15s."
  ALL_OK=false
fi

echo ""
if [[ "$ALL_OK" == "true" ]]; then
  echo "==> Actualización y verificación completadas correctamente."
else
  echo "==> Actualización completada con advertencias. Revisa: journalctl -u edusignage-x11 -u edusignage-player -n 40"
  exit 1
fi
