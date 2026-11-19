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

echo "==> Deteniendo servicios web, planificador y reproductor..."
systemctl stop edusignage-scheduler edusignage-player edusignage-web || true

cp -r "${REPO_DIR}/pi_package/app/"* "${INSTALL_DIR}/app/"
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

echo "==> Reiniciando servicios..."
systemctl start edusignage-system-helper edusignage-player edusignage-scheduler edusignage-web
echo "==> Actualización completada correctamente."
