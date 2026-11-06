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
       xvfb openbox x11vnc socat chromium xdotool scrot wmctrl xclip x11-utils \
       fonts-dejavu-core ca-certificates tini python3 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /bin/bash lumina

COPY entrypoint.sh /usr/local/bin/lumina-computer-entrypoint
COPY clear-input.py /usr/local/bin/lumina-clear-input
RUN chmod 0755 /usr/local/bin/lumina-computer-entrypoint /usr/local/bin/lumina-clear-input

USER lumina
WORKDIR /home/lumina

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/lumina-computer-entrypoint"]
