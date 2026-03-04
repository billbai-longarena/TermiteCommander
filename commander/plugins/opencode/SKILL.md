---
name: commander
description: Termite Commander — plan, orchestrate, monitor, and stop colony work
---

# Commander

Autonomous orchestration engine. Decomposes objectives → signals → workers → heartbeat monitoring.

## Actions

| Intent | Command |
|--------|---------|
| Plan + run | `nohup termite-commander plan "<obj>" --colony "$PWD" --run > .commander.log 2>&1 &` |
| Plan only | `termite-commander plan "<obj>" --colony "$PWD"` |
| Status | `termite-commander status --colony "$PWD"` |
| Status JSON | `termite-commander status --colony "$PWD" --json` |
| Workers | `termite-commander workers --colony "$PWD"` |
| Stop | `termite-commander stop --colony "$PWD"` |
| Resume | `termite-commander resume --colony "$PWD"` |
| Watch | `termite-commander watch --colony "$PWD"` |

## Status Files

- `commander.lock` — `{ pid, startedAt, objective }`. Presence = Commander running.
- `.commander-status.json` — heartbeat snapshot: signal counts, worker states, timestamps.

## Quick Check

```bash
# Is Commander running?
if [ -f commander.lock ]; then
  PID=$(grep -o '"pid":[0-9]*' commander.lock | grep -o '[0-9]*')
  kill -0 "$PID" 2>/dev/null && echo "Running (PID $PID)" || echo "Stale lock"
else
  echo "Not running"
fi
```

## Dashboard

```
Commander: RUNNING (PID XXXX)
Objective: <text>
Signals:   X/Y done
Workers:   A active
```
