#!/usr/bin/env bash
set -euo pipefail

# EduSignage Pi - Desinstalador Seguro
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Ejecuta con sudo: sudo bash uninstall.sh"
  exit 1
fi

echo "==> Deteniendo y deshabilitando servicios EduSignage..."
for svc in edusignage-web edusignage-scheduler edusignage-player edusignage-x11 edusignage-system-helper; do
  systemctl disable --now "${svc}.service" 2>/dev/null || true
  rm -f "/etc/systemd/system/${svc}.service"
done
systemctl daemon-reload

rm -f /etc/avahi/services/edusignage.service
rm -f /etc/xdg/openbox/edusignage-xinitrc

read -r -p "¿Eliminar también la base de datos y archivos multimedia en /opt/edusignage? [s/N]: " PURGE
if [[ "${PURGE,,}" == "s" || "${PURGE,,}" == "y" ]]; then
  rm -rf /opt/edusignage
  userdel edusignage 2>/dev/null || true
  echo "==> Todos los archivos y datos fueron eliminados."
else
  echo "==> Servicios eliminados. Datos preservados en /opt/edusignage."
fi
