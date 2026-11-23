#!/usr/bin/env bash
set -euo pipefail

XAUTH="/opt/edusignage/.Xauthority"
DISPLAY_NUM="${DISPLAY:-:0}"

rm -f "$XAUTH"
touch "$XAUTH"
chmod 0600 "$XAUTH"

COOKIE="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
if command -v xauth >/dev/null 2>&1; then
  xauth -f "$XAUTH" add "$DISPLAY_NUM" . "$COOKIE"
  xauth -f "$XAUTH" add "$(hostname)/unix${DISPLAY_NUM}" . "$COOKIE" 2>/dev/null || true
fi

export HOME="/opt/edusignage"
export DISPLAY="$DISPLAY_NUM"
export XAUTHORITY="$XAUTH"
export XDG_RUNTIME_DIR="/run/edusignage/xdg"

XORG_BIN="$(command -v Xorg || echo /usr/bin/Xorg)"
exec /usr/bin/xinit /etc/xdg/openbox/edusignage-xinitrc -- "$XORG_BIN" "$DISPLAY_NUM" vt1 -auth "$XAUTH" -nolisten tcp -keeptty
