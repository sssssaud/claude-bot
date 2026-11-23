#!/usr/bin/env bash
# Start the bridge (unless one is already running) and the octo. Closing the octo stops the bridge
# this script started.
set -euo pipefail
cd "$(dirname "$0")"

BRIDGE_PID=
if ! curl -s --max-time 1 http://127.0.0.1:8765/health > /dev/null; then
  echo "Starting the bridge on 127.0.0.1:8765..."
  .venv/bin/python -m bridge.server &
  BRIDGE_PID=$!
  trap 'kill "$BRIDGE_PID" 2>/dev/null || true' EXIT
  for _ in {1..30}; do
    curl -s --max-time 1 http://127.0.0.1:8765/health > /dev/null && break
    sleep 0.1
  done
fi

npm run build --silent
# Pass the platform flag here: without it the app relaunches itself (app/main.js), this script sees
# the first process exit at once and the EXIT trap killed the bridge (found 2026-11-23).
./node_modules/electron/dist/electron . --ozone-platform="${CLAUDE_BOT_OZONE:-x11}"
