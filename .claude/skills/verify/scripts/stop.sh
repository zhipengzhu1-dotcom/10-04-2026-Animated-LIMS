#!/usr/bin/env bash
# Stops the server this run started, closes its browser session, and removes its data. Keeps .verify/evidence/<run-name>/.
# Usage: .claude/skills/verify/scripts/stop.sh [run-name]
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
NAME=${1:-verify}
RUN="$ROOT/.verify/runs/$NAME"

agent-browser --session "aliquot-$NAME" close >/dev/null 2>&1 || true
if [[ -f "$RUN/pid" ]]; then
  PID=$(cat "$RUN/pid")
  if kill -0 "$PID" 2>/dev/null && ps -o command= -p "$PID" | grep -q 'node server.js'; then
    kill "$PID"
    for _ in $(seq 1 50); do kill -0 "$PID" 2>/dev/null || break; sleep 0.1; done
  fi
fi
rm -rf "$RUN"
echo "Stopped run '$NAME'. Evidence kept in .verify/evidence/$NAME/"
