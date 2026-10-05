#!/usr/bin/env bash
# Starts a throwaway Aliquot on a port the system picks, loaded with the demo lab, for one verification run.
# Usage: .claude/skills/verify/scripts/launch.sh [run-name]     (run-name defaults to "verify")
# Prints the base URL. State lives in .verify/runs/<run-name>/ (removed by stop.sh); evidence goes in .verify/evidence/<run-name>/ (kept).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
NAME=${1:-verify}
RUN="$ROOT/.verify/runs/$NAME"
EVIDENCE="$ROOT/.verify/evidence/$NAME"

if [[ -f "$RUN/pid" ]] && kill -0 "$(cat "$RUN/pid")" 2>/dev/null; then
  echo "Run '$NAME' is already up at $(cat "$RUN/base"). Use it, or stop it first: .claude/skills/verify/scripts/stop.sh $NAME" >&2
  exit 1
fi
rm -rf "$RUN"
mkdir -p "$RUN/data" "$EVIDENCE"

ALIQUOT_DATA="$RUN/data" node "$ROOT/scripts/seed-demo.js" >"$RUN/seed.log" 2>&1 || { cat "$RUN/seed.log" >&2; exit 1; }

cd "$ROOT"
PORT=0 HOST=127.0.0.1 ALIQUOT_DATA="$RUN/data" nohup node server.js >"$RUN/server.log" 2>&1 &
echo $! >"$RUN/pid"

for _ in $(seq 1 100); do
  PORT=$(grep -oE 'http://localhost:[0-9]+' "$RUN/server.log" | head -1 | grep -oE '[0-9]+$' || true)
  if [[ -n "$PORT" ]] && curl -fsS "http://127.0.0.1:$PORT/api/setup" >/dev/null 2>&1; then
    echo "http://127.0.0.1:$PORT" >"$RUN/base"
    echo "http://127.0.0.1:$PORT"
    exit 0
  fi
  kill -0 "$(cat "$RUN/pid")" 2>/dev/null || break
  sleep 0.1
done
echo "Aliquot did not start:" >&2
cat "$RUN/server.log" >&2
kill "$(cat "$RUN/pid")" 2>/dev/null || true
exit 1
