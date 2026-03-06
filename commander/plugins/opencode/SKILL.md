---
name: commander
description: |
  Termite Commander — decompose plans into atomic signals for colony execution.
  Trigger: /commander, 让蚁群干活, 让白蚁施工, 开始施工, deploy termites
---

# Commander — Signal Decomposition & Colony Orchestration

Decomposes objectives into atomic signals that weak models (haiku-class) can execute, then dispatches to a termite colony.

## Actions

| Intent | Command |
|--------|---------|
| One-shot init (recommended first run) | `termite-commander init --colony "$PWD"` |
| Plan + run (with design doc) | `nohup termite-commander plan "<obj>" --plan .termite/worker/PLAN.md --colony "$PWD" --run > .commander.log 2>&1 &` |
| Plan + run (with context) | `nohup termite-commander plan "<obj>" --context "<summary>" --colony "$PWD" --run > .commander.log 2>&1 &` |
| Status | `termite-commander status --colony "$PWD"` |
| Status JSON | `termite-commander status --colony "$PWD" --json` |
| Config bootstrap | `termite-commander config bootstrap --from auto --colony "$PWD"` |
| Config import (dry-run) | `termite-commander config import --from auto --colony "$PWD"` |
| Config import (apply) | `termite-commander config import --from auto --apply --colony "$PWD"` |
| Doctor | `termite-commander doctor --config --credentials --runtime --colony "$PWD"` |
| Daemon start | `termite-commander daemon start "<obj>" --plan .termite/worker/PLAN.md --colony "$PWD"` |
| Daemon status | `termite-commander daemon status --colony "$PWD"` |
| Daemon stop | `termite-commander daemon stop --colony "$PWD"` |
| Workers | `termite-commander workers --colony "$PWD"` |
| Logs | `termite-commander logs --colony "$PWD"` |
| Stop | `termite-commander stop --colony "$PWD"` |
| Resume | `termite-commander resume --colony "$PWD"` |
| Dashboard (auto) | `termite-commander dashboard --mode auto` |

## Signal Standards for Weak Models

Signals must be:
- **Atomic**: one action, one file, single session
- **Self-contained**: all context in title + nextHint
- **Verifiable**: explicit acceptance criteria
- **Specific**: exact file paths, no guessing
- **Flat**: max depth 3, maximize parallelism

## Model Config

```json
// termite.config.json (recommended)
{
  "commander": {
    "model": "anthropic/claude-sonnet-4-5",
    "default_worker_cli": "opencode",
    "default_worker_model": "anthropic/claude-haiku-3-5",
    "workers": [
      { "cli": "opencode", "model": "anthropic/claude-sonnet-4-5", "count": 1 },
      { "cli": "opencode", "model": "anthropic/claude-haiku-3-5", "count": 2 }
    ]
  }
}
```

Commander model is required. Resolution priority:
`termite.config.json > opencode.json > env vars > defaults`
(except commander model has no default and must be explicitly set).

Recommended setup flow:
```bash
termite-commander init --colony "$PWD"
```

`doctor --runtime` additionally checks runtime binary/model/provider compatibility before `plan --run`.

## Status Files

- `commander.lock` — `{ pid, startedAt, objective }`. Presence = Commander running.
- `.commander-status.json` — heartbeat snapshot: signal counts, worker states, model info.
- `.commander-daemon.json` — daemon metadata for background starts.
- `.commander.events.log` — rotated runtime event log (preferred for issue reports).
- `.termite/human/` — human draft zone (worker should ignore).
- `.termite/worker/` — worker-facing context zone.
