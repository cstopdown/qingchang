#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
mkdir -p .tools/deployment
if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null; then
  printf '本机 8765 端口已被占用。\n' >&2
  exit 1
fi
ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:8765:127.0.0.1:8765 aliyun
pid=$(lsof -nP -t -iTCP:8765 -sTCP:LISTEN | head -1)
printf '%s\n' "$pid" > .tools/deployment/web-tunnel.pid
printf '访问 http://127.0.0.1:8765，隧道 PID：%s\n' "$pid"
