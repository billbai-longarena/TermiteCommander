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
| Plan + run (with design doc) | `nohup termite-commander plan "<obj>" --plan PLAN.md --colony "$PWD" --run > .commander.log 2>&1 &` |
| Plan + run (with context) | `nohup termite-commander plan "<obj>" --context "<summary>" --colony "$PWD" --run > .commander.log 2>&1 &` |
| Status | `termite-commander status --colony "$PWD"` |
| Status JSON | `termite-commander status --colony "$PWD" --json` |
| Workers | `termite-commander workers --colony "$PWD"` |
| Stop | `termite-commander stop --colony "$PWD"` |
| Resume | `termite-commander resume --colony "$PWD"` |
| TUI Dashboard | `termite-commander` |

## Signal Standards for Weak Models

Signals must be:
- **Atomic**: one action, one file, single session
- **Self-contained**: all context in title + nextHint
- **Verifiable**: explicit acceptance criteria
- **Specific**: exact file paths, no guessing
- **Flat**: max depth 3, maximize parallelism

## Model Config

```bash
# Commander (strong model for decomposition)
export COMMANDER_MODEL=claude-sonnet-4-5

# Workers (uniform)
export TERMITE_WORKERS=3
export TERMITE_MODEL=claude-haiku-3-5

# Workers (mixed)
export TERMITE_WORKERS=sonnet:1,haiku:2,gemini-flash:1
```

Falls back to `opencode.json` fields: `model`, `small_model`, `commander.workers`.

## Status Files

- `commander.lock` — `{ pid, startedAt, objective }`. Presence = Commander running.
- `.commander-status.json` — heartbeat snapshot: signal counts, worker states, model info.
