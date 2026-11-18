#!/usr/bin/env bash
set -euo pipefail

# EduSignage Pi - Lanzador de desinstalación desde raíz del repositorio Git
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Ejecuta la desinstalación como root: sudo bash uninstall.sh"
  exit 1
fi

exec bash "${SCRIPT_DIR}/pi_package/uninstall.sh"
