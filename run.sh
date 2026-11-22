#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Check if Python bridge is already running
if ! curl -s http://127.0.0.1:8765/health > /dev/null 2>&1; then
  echo "Starting Claude Bot Python bridge on 127.0.0.1:8765..."
  .venv/bin/python -m bridge.server &
  BRIDGE_PID=$!
  trap 'kill $BRIDGE_PID 2>/dev/null || true' EXIT
  for i in {1..20}; do
    if curl -s http://127.0.0.1:8765/health > /dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done
fi

npm run app
