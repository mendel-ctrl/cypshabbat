#!/usr/bin/env bash
# Double-click launcher (macOS/Linux) for the Federation calendar submission.
# On macOS, use run.command (Finder can open it directly).
cd "$(dirname "$0")" || exit 1

echo "=== Federation calendar submission ==="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org and run this again."
  read -r -p "Press Enter to close."
  exit 1
fi

if [ ! -d node_modules/playwright ]; then
  echo "Installing Playwright (first run only)..."
  npm install playwright@1.56.1 || { echo "npm install failed."; read -r -p "Press Enter to close."; exit 1; }
fi

echo "Making sure Chromium is installed..."
npx playwright install chromium

echo
echo "  1) Test event #1 only   (do this first, confirm it worked)"
echo "  2) Run the full batch   (resumes automatically, skips anything already submitted)"
echo
read -r -p "Choose 1 or 2: " choice

if [ "$choice" = "1" ]; then
  START_AT=1 STOP_AT=1 node submit_events.js
else
  node submit_events.js
fi

echo
read -r -p "Finished. Press Enter to close."
