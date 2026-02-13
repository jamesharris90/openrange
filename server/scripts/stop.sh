#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f server.pid ]; then
  echo "server.pid not found; cannot stop." >&2
  exit 1
fi
PID=$(cat server.pid)
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped server (pid=$PID)."
else
  echo "Process $PID not running; removing stale server.pid." >&2
fi
rm -f server.pid
