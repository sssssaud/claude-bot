#!/usr/bin/env bash
# One-command setup for claude-bot on a fresh machine (Nobara / Fedora, KDE Plasma). Safe to run again.
#   ./setup.sh    checks the system, installs the Python and Node parts, builds, runs the tests, then asks
#                 before connecting Claude Code (hooks + status line in ~/.claude/settings.json, backed up first).
# It never uses sudo: missing system packages are printed with the dnf command, and it stops.
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

step "1/6 Checking the system"
missing=()
for tool in python3 node npm curl qdbus dbus-monitor bluetoothctl nmcli; do
  command -v "$tool" >/dev/null || missing+=("/usr/bin/$tool") # dnf installs by file: right package on any release
done
# app/kwin.py (eyes on the terminal, coming to the cursor) runs on the system python3 with these two:
python3 -c 'import dbus' 2>/dev/null || missing+=(python3-dbus)
python3 -c 'import gi' 2>/dev/null || missing+=(python3-gobject-base)
if ((${#missing[@]})); then
  echo "Missing: ${missing[*]}"
  echo "Install them, then run ./setup.sh again:"
  echo "  sudo dnf install ${missing[*]}"
  exit 1
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else "Python 3.10 or newer is needed")'
node -e 'const [a, b] = process.versions.node.split(".").map(Number);
  if (a < 22 || (a === 22 && b < 12)) { console.error(`Node 22.12 or newer is needed (Electron 45), found ${process.version}`); process.exit(1); }'
if [[ "${XDG_CURRENT_DESKTOP:-}" != *KDE* ]]; then
  echo "Note: this isn't KDE Plasma (${XDG_CURRENT_DESKTOP:-unknown}). The octos run, but looking at the terminal and"
  echo "coming to the cursor need KWin, and brightness uses KDE's power manager."
fi
echo "ok: python $(python3 -V | cut -d' ' -f2), node $(node -v), KDE tools present"

step "2/6 Python parts (.venv)"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt
echo "ok: $(.venv/bin/python -m pip list --format=freeze 2>/dev/null | wc -l) packages in .venv"

step "3/6 Node parts (node_modules, Electron)"
npm install --no-fund --no-audit --loglevel=error
# Electron 45 has no install script (it downloads on first use); run.sh starts the binary directly, so get it now
node node_modules/electron/install.js
[ -x node_modules/electron/dist/electron ] || { echo "Electron's binary didn't download (internet?). Run ./setup.sh again."; exit 1; }
echo "ok: Electron $(node -p 'require("./node_modules/electron/package.json").version')"

step "4/6 Building the octo pages"
npm run build --silent >/dev/null
echo "ok: dist/ built"

step "5/6 Running the tests"
log=$(mktemp)
if ! npm run test:all >"$log" 2>&1; then
  tail -30 "$log"
  echo "Tests failed (full output: $log). Setup stopped here."
  exit 1
fi
echo "ok: $(grep -m1 -E '^ℹ pass' "$log" | sed 's/ℹ //') node tests, $(grep -m1 -oE '[0-9]+ passed' "$log") bridge tests"
rm -f "$log"

step "6/6 Claude Code (optional)"
echo "The octos learn what each session does from Claude Code hooks and its status line."
answer=n
if [ -t 0 ]; then
  read -r -p "Add them to ~/.claude/settings.json now? It's backed up first. [y/N] " answer || answer=n
fi
if [[ "$answer" == [yY]* ]]; then
  python3 hooks/install.py
else
  echo "Skipped. Later: python3 hooks/install.py   (preview: --dry-run, undo: --uninstall)"
fi

step "Done. Start it with:  ./run.sh"
echo "Then the tray icon has Quit, Personality, Feelings and Start on login."
