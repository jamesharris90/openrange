#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f server.pid ]; then
  echo "server.pid exists; server may already be running (pid=$(cat server.pid))." >&2
  exit 1
fi
nohup node index.js > server.log 2>&1 &
PID=$!
echo $PID > server.pid
echo "Started server (pid=$PID). Logs: server.log"
