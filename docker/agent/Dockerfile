# Zylara agent sandbox.
#
# Build:
#   docker build -t zylara/agent:latest docker/agent
#
# The workspace is mounted at /workspace by the app; this image only provides
# the common toolchains. It intentionally has no agent secrets and no Docker
# socket. Pin the digest in production.

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NODE_NO_WARNINGS=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 python3-pip python3-venv \
       git git-lfs ripgrep jq curl ca-certificates \
       build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

# `node` is uid/gid 1000 in the upstream image, matching the runner's
# `--user 1000:1000`.
USER node
WORKDIR /workspace
