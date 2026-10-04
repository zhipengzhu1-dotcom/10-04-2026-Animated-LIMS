#!/bin/bash
# Nightly: stop the Animated demo, reload fresh demo data, start it again.
set -euo pipefail
APP="$HOME/Desktop/Claude/10. October 2026/Aliquot-Animated-live"; DATA="$HOME/Aliquot-Animated-data"; GUI="gui/$(id -u)"
echo "$(date '+%Y-%m-%d %H:%M:%S') demo reset"
launchctl bootout "$GUI/com.aliquot.animated" 2>/dev/null || true
rm -rf "$DATA/aliquot.db" "$DATA/aliquot.db-wal" "$DATA/aliquot.db-shm" "$DATA/files" "$DATA/backups"
mkdir -p "$DATA/files" "$DATA/logs"
(cd "$APP" && ALIQUOT_DATA="$DATA" /usr/local/bin/node scripts/seed-demo.js)
launchctl bootstrap "$GUI" "$HOME/Library/LaunchAgents/com.aliquot.animated.plist"
