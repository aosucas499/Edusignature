#!/usr/bin/env bash
set -euo pipefail

# EduSignage Pi - Lanzador de actualización desde Git (git pull + actualización segura)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Ejecuta la actualización como root: sudo bash update.sh"
  exit 1
fi

export EDUSIGNAGE_REPO_ROOT="$SCRIPT_DIR"
exec bash "${SCRIPT_DIR}/pi_package/update.sh" "$@"
