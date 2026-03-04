#!/usr/bin/env bash
# hook-session-start.sh — SessionStart hook for Commander Claude Code plugin
# Detects if Commander is running and injects status into the session.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

COLONY_ROOT=$(find_colony_root "$PWD")
if [ -z "$COLONY_ROOT" ]; then
  exit 0
fi

if commander_is_running "$COLONY_ROOT"; then
  STATUS_FILE="$COLONY_ROOT/.commander-status.json"
  if [ -f "$STATUS_FILE" ]; then
    OBJECTIVE=$(grep -o '"objective":"[^"]*"' "$STATUS_FILE" | head -1 | sed 's/"objective":"//;s/"$//')
    TOTAL=$(grep -o '"total":[0-9]*' "$STATUS_FILE" | head -1 | grep -o '[0-9]*')
    DONE=$(grep -o '"done":[0-9]*' "$STATUS_FILE" | head -1 | grep -o '[0-9]*')
    ACTIVE=$(grep -o '"activeWorkers":[0-9]*' "$STATUS_FILE" | head -1 | grep -o '[0-9]*')
    echo "[Commander] Colony active. ${DONE:-0}/${TOTAL:-?} signals done. ${ACTIVE:-0} workers. Objective: ${OBJECTIVE:-unknown}"
    echo "Use /commander for plan/status/stop/workers/resume commands."
  else
    echo "[Commander] Colony active (no status snapshot yet)."
  fi
fi
