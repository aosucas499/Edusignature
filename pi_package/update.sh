#!/usr/bin/env bash
set -euo pipefail

# EduSignage Pi - Actualizador Automático mediante Git Pull (sin perder base de datos ni medios)
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Ejecuta con sudo: sudo bash update.sh"
  exit 1
fi

INSTALL_DIR="/opt/edusignage"
REPO_DIR="${EDUSIGNAGE_REPO_ROOT:-${INSTALL_DIR}/repo}"
SNAP_DIR="${INSTALL_DIR}/backups/pre_update_$(date +%Y%m%d_%H%M%S)"

mkdir -p "$SNAP_DIR"
if [[ -f "${INSTALL_DIR}/data/edusignage.db" ]]; then
  cp -a "${INSTALL_DIR}/data/edusignage.db" "${SNAP_DIR}/"
  echo "==> Copia preventiva de SQLite guardada en ${SNAP_DIR}"
fi

if [[ -d "${REPO_DIR}/.git" ]]; then
  echo "==> Descargando últimos cambios desde GitHub (git pull --ff-only)..."
  git -C "$REPO_DIR" fetch --all --prune
  git -C "$REPO_DIR" pull --ff-only
else
  echo "ADVERTENCIA: ${REPO_DIR} no es un repositorio Git; aplicando archivos locales existentes."
fi

echo "==> Deteniendo servicios web, planificador y reproductor..."
systemctl stop edusignage-scheduler edusignage-player edusignage-web || true

cp -r "${REPO_DIR}/pi_package/app/"* "${INSTALL_DIR}/app/"
"${INSTALL_DIR}/venv/bin/pip" install -r "${REPO_DIR}/pi_package/requirements.txt"

if command -v npm >/dev/null 2>&1 && [[ -f "${REPO_DIR}/package.json" ]]; then
  echo "==> Recompilando interfaz web..."
  pushd "$REPO_DIR" >/dev/null
  NODE_OPTIONS="--max-old-space-size=512" npm install --no-audit --no-fund
  NODE_OPTIONS="--max-old-space-size=512" npm run build
  rm -rf "${INSTALL_DIR}/web/"*
  cp -r dist/* "${INSTALL_DIR}/web/"
  popd >/dev/null
fi

cp "${REPO_DIR}/pi_package/systemd/"*.service /etc/systemd/system/
systemctl daemon-reload
chown -R edusignage:edusignage "${INSTALL_DIR}/app" "${INSTALL_DIR}/web"

echo "==> Reiniciando servicios..."
systemctl start edusignage-system-helper edusignage-player edusignage-scheduler edusignage-web
echo "==> Actualización completada correctamente."
