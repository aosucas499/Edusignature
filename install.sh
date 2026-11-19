#!/usr/bin/env bash
set -euo pipefail

# EduSignage Pi - Lanzador de instalación desde raíz del repositorio Git
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Ejecuta la instalación como root: sudo bash install.sh"
  exit 1
fi

export EDUSIGNAGE_REPO_ROOT="$SCRIPT_DIR"
exec bash "${SCRIPT_DIR}/pi_package/install.sh" "$@"
