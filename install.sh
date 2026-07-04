#!/bin/bash
# Install cursor-bridge & claude-bridge as LaunchAgents
# Usage: ./install.sh [--uninstall]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
NODE_BIN=$(which node)
HOME_DIR="$HOME"

install() {
  mkdir -p "$LAUNCH_DIR"

  for service in cursor-bridge claude-bridge; do
    local plist="ai.${service}.plist"
    local src="$SCRIPT_DIR/launchagents/$plist"

    if [ ! -f "$src" ]; then
      echo "ERROR: $src not found"
      continue
    fi

    # Generate plist with correct paths for this machine
    CLAUDE_BIN=$(which claude 2>/dev/null || echo "${HOME_DIR}/.local/bin/claude")
    CLAUDE_BIN_DIR=$(dirname "$CLAUDE_BIN")
    sed \
      -e "s|/usr/local/bin/node|${NODE_BIN}|g" \
      -e "s|/Users/YOUR_USERNAME|${HOME_DIR}|g" \
      -e "s|<string>/opt/homebrew/bin|<string>${CLAUDE_BIN_DIR}:/opt/homebrew/bin|g" \
      "$src" > "$LAUNCH_DIR/$plist"

    # Load the service
    launchctl bootout "gui/$(id -u)/ai.${service}" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$LAUNCH_DIR/$plist"
    echo "Installed & started: ai.${service}"
  done

  echo ""
  echo "Logs:"
  echo "  ~/.openclaw/logs/cursor-bridge.log"
  echo "  ~/.openclaw/logs/claude-bridge.log"
  echo ""
  echo "Verify:"
  echo "  curl http://127.0.0.1:18800/health"
  echo "  curl http://127.0.0.1:18801/health"
}

uninstall() {
  for service in cursor-bridge claude-bridge; do
    local plist="ai.${service}.plist"
    launchctl bootout "gui/$(id -u)/ai.${service}" 2>/dev/null && echo "Stopped: ai.${service}" || true
    rm -f "$LAUNCH_DIR/$plist" && echo "Removed: $LAUNCH_DIR/$plist" || true
  done
}

case "${1:-install}" in
  --uninstall|-u)
    uninstall
    ;;
  *)
    install
    ;;
esac
