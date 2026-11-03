# Lumina graphical computer-use sandbox.
#
# Build (pin the digest in production):
#   docker build -t lumina/computer:latest docker/computer
#
# The agent talks to X11 through `docker exec` (scrot/xdotool/wmctrl). noVNC is
# exposed for the human to watch the session; the model never talks VNC.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    LANG=C.UTF-8

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       xvfb openbox x11vnc novnc websockify chromium xdotool scrot wmctrl xclip x11-utils \
       fonts-dejavu-core ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /bin/bash lumina

COPY entrypoint.sh /usr/local/bin/lumina-computer-entrypoint
RUN chmod 0755 /usr/local/bin/lumina-computer-entrypoint

USER lumina
WORKDIR /home/lumina

EXPOSE 6080

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/lumina-computer-entrypoint"]
