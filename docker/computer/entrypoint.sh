#!/usr/bin/env bash
set -euo pipefail

# Start a private X session, a lightweight window manager and noVNC. The agent
# drives X11 via docker exec; noVNC is only for human observation.
Xvfb :99 -screen 0 1440x900x24 -ac +extension RANDR >/tmp/xvfb.log 2>&1 &
openbox >/tmp/openbox.log 2>&1 &
x11vnc -display :99 -forever -shared -nopw -listen 127.0.0.1 -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 >/tmp/novnc.log 2>&1 &

# Keep the container alive and reap X if it dies.
wait -n
