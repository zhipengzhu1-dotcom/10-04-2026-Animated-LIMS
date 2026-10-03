#!/bin/bash
# Double-click to start Aliquot on a Mac. Keep this window open while the lab is using the system.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again."
  read -r -p "Press Enter to close…"
  exit 1
fi
(sleep 2; open "http://localhost:${PORT:-3000}") &
node server.js
