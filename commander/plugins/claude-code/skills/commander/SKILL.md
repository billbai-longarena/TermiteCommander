---
name: commander
description: Invoke Termite Commander to plan, orchestrate, monitor, and stop colony-based autonomous work
user_invocable: true
---

# Termite Commander Skill

You are orchestrating work through **Termite Commander** — an autonomous engine that decomposes objectives into signals, dispatches them to a colony of workers, and monitors progress via heartbeats.

## Commands

Parse the user's intent into one of these actions:

### `plan <objective>`
Generate a plan from a natural-language objective.

```bash
termite-commander plan "<objective>" --colony "$PWD"
```

Add `--dispatch` to send signals immediately, or `--run` to start full execution with workers and heartbeats (runs in background via nohup):

```bash
nohup termite-commander plan "<objective>" --colony "$PWD" --run > .commander.log 2>&1 &
echo $! > .commander-nohup-pid
```

### `status`
Show current Commander and colony status.

```bash
termite-commander status --colony "$PWD"
```

For machine-readable output:
```bash
termite-commander status --colony "$PWD" --json
```

If Commander is not running, read `.commander-status.json` directly for the last known state:
```bash
cat .commander-status.json 2>/dev/null || echo "No status file found"
```

### `stop`
Stop a running Commander process gracefully.

```bash
termite-commander stop --colony "$PWD"
```

### `workers`
Show worker status table.

```bash
termite-commander workers --colony "$PWD"
```

For JSON output:
```bash
termite-commander workers --colony "$PWD" --json
```

### `resume`
Resume from a halted state (clears HALT.md).

```bash
termite-commander resume --colony "$PWD"
```

After resume, re-run with a new or same objective:
```bash
nohup termite-commander plan "<objective>" --colony "$PWD" --run > .commander.log 2>&1 &
```

### `watch`
Real-time colony monitoring.

```bash
termite-commander watch --colony "$PWD" --interval 5000
```

## Dashboard Format

When presenting status to the user, format as:

```
== Commander Dashboard ==
Status:    RUNNING | HALTED | STOPPED
Objective: <objective text>
Started:   <timestamp>

Signals:   X/Y done (Z claimed)
Workers:   A active, B running

[Worker Table if requested]
```

## Routing Logic

1. If the user says "plan ..." or "start ..." → `plan` (with `--run` if they want execution)
2. If the user says "status" or "how's it going" → `status`
3. If the user says "stop" or "halt" or "kill" → `stop`
4. If the user says "workers" or "who's working" → `workers`
5. If the user says "resume" or "continue" → `resume`
6. If the user says "watch" or "monitor" → `watch`

## Important Notes

- Commander runs as a background process (`nohup`). The PID is stored in `commander.lock`.
- Status snapshots are written to `.commander-status.json` on every heartbeat cycle.
- If `commander.lock` exists but the process is dead, the lock is stale — inform the user and clean up.
- Always use `--colony "$PWD"` to ensure correct colony root.
