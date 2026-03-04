#!/usr/bin/env bash
# lib.sh — Shared utilities for Commander Claude Code plugin

# Find colony root by walking up from cwd looking for scripts/termite-db.sh
find_colony_root() {
  local dir="${1:-$PWD}"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/scripts/termite-db.sh" ]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# Check if Commander is running by reading commander.lock
commander_is_running() {
  local colony_root="$1"
  local lock_file="$colony_root/commander.lock"
  if [ ! -f "$lock_file" ]; then
    return 1
  fi
  local pid
  pid=$(grep -o '"pid":[[:space:]]*[0-9]*' "$lock_file" | grep -o '[0-9]*')
  if [ -z "$pid" ]; then
    return 1
  fi
  # Check if process is alive
  if kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  # Stale lock — process is gone
  return 1
}

# Read .commander-status.json and output summary
read_status() {
  local colony_root="$1"
  local status_file="$colony_root/.commander-status.json"
  if [ ! -f "$status_file" ]; then
    echo "No status file found."
    return 1
  fi
  cat "$status_file"
}

# Read commander.lock
read_lock() {
  local colony_root="$1"
  local lock_file="$colony_root/commander.lock"
  if [ ! -f "$lock_file" ]; then
    echo "No lock file found."
    return 1
  fi
  cat "$lock_file"
}
