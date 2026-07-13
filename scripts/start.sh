#!/bin/bash
# Starts Khmer Practice and opens it in your browser.
# Double-click "Khmer Practice.app" (which runs this), or run this file directly.
cd "$(dirname "$0")/.." || exit 1

clear
printf "\n  🇰🇭  Khmer Practice\n\n"

# First run only: install dependencies (needs internet, ~30s).
if [ ! -d node_modules ]; then
  printf "  First run — installing (one time, needs internet)…\n\n"
  if ! npm install; then
    printf "\n  Install failed. Open Terminal here and run: npm install\n"
    printf "  Press any key to close.\n"
    read -r -n 1 -s
    exit 1
  fi
fi

# Open the browser once the server has had a moment to boot.
( sleep 2; open "http://localhost:${PORT:-3000}" >/dev/null 2>&1 ) &

printf "  Starting… your browser will open automatically.\n"
printf "  To STOP the app: close this window (or press Ctrl-C).\n\n"

# Runs in the foreground so the LAN address for your wife stays on screen
# and closing the window cleanly stops the server.
exec npm start
