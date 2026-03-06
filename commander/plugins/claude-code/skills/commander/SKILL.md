---
name: commander
description: |
  Decompose plans into atomic signals for termite colony execution. Invoke when user says:
  /commander, 让蚁群干活, 让白蚁施工, dispatch to colony, termite protocol execute,
  开始施工, 让白蚁协议干活, start colony work, deploy termites
user_invocable: true
---

# Termite Commander — Signal Decomposition & Colony Orchestration

You are orchestrating work through **Termite Commander** — an engine that decomposes objectives into atomic signals that weak models can execute, then dispatches them to a colony of workers.

## When to Use

- User has a plan/design ready and wants the colony to execute it
- User says "让蚁群干活", "开始施工", "deploy termites", etc.
- **NOT** for research, analysis, or design — do those yourself first, then hand off to Commander

## Signal Decomposition Standards for Weak Models

Commander decomposes work into signals that haiku-class models can execute. When preparing context for Commander, ensure the design is specific enough for these standards:

### What Makes a Good Signal:
- **Atomic**: one clear action, one file/module, completable in a single session
- **Self-contained**: title + nextHint contain ALL context needed (file paths, function names, expected behavior)
- **Verifiable**: explicit acceptance criteria the model can check itself
- **Specific paths**: exact file paths specified, weak models don't guess well
- **Flat dependencies**: max depth 3, maximize parallelism

### Bad vs Good Signals:
```
BAD:  "Implement authentication" (too broad, haiku can't plan this)
GOOD: "Create src/middleware/auth.ts: JWT verification middleware that checks
       Authorization header, verifies with process.env.JWT_SECRET, calls next()
       on success or returns 401. Use jsonwebtoken library."

BAD:  "Optimize database queries" (vague, no specific target)
GOOD: "Add Redis cache to src/api/users.ts getUsers(): TTL 300s, key format
       users:page:{n}. Return cached data on hit. Test: repeated request <10ms."
```

## Commands

### First Run (recommended)
```bash
termite-commander init --colony "$PWD"
```

### Start Colony Work

Two ways to provide design context:

**Option A: From a design document**
```bash
nohup termite-commander plan "<objective>" --plan .termite/worker/PLAN.md --colony "$PWD" --run > .commander.log 2>&1 &
```

**Option B: From conversation context**
Summarize the current design into a text block, then:
```bash
nohup termite-commander plan "<objective>" --context "<design summary>" --colony "$PWD" --run > .commander.log 2>&1 &
```

### Check Status
```bash
termite-commander status --colony "$PWD"
termite-commander status --colony "$PWD" --json
```

### Show Workers
```bash
termite-commander workers --colony "$PWD"
```

### Stop
```bash
termite-commander stop --colony "$PWD"
```

### Resume
```bash
termite-commander resume --colony "$PWD"
```

### Watch (live monitoring in terminal)
```bash
termite-commander watch --colony "$PWD"
```

Or launch the dashboard:
```bash
termite-commander dashboard --mode auto
```

### Daemon (long-running background execution)
```bash
termite-commander daemon start "<objective>" --plan .termite/worker/PLAN.md --colony "$PWD"
termite-commander daemon status --colony "$PWD"
termite-commander daemon stop --colony "$PWD"
```

## Model Configuration

When user asks to configure models, prefer `termite.config.json` (Commander-specific), then keep `opencode.json` compatible.

### Read current config
```bash
termite-commander config bootstrap --from auto
cat termite.config.json 2>/dev/null || echo "No termite.config.json found"
cat opencode.json 2>/dev/null || echo "No opencode.json found"
```

### Write/update config
Read current files first, then update `termite.config.json` as the primary Commander config:

```json
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

**Fields explained:**
- `commander.model` — strong model for Commander's signal decomposition (**required**)
- `commander.default_worker_cli` — default worker runtime (`opencode` / `claude` / `codex`)
- `commander.default_worker_model` — default weak model for workers
- `commander.workers` — mixed fleet entries with `{cli, model, count}`

**Recommended: Shepherd Effect config** (1 strong + N weak):
```json
{
  "commander": {
    "model": "anthropic/claude-sonnet-4-5",
    "workers": [
      { "cli": "opencode", "model": "anthropic/claude-sonnet-4-5", "count": 1 },
      { "cli": "opencode", "model": "anthropic/claude-haiku-3-5", "count": 2 }
    ]
  }
}
```

Workers are passed to OpenCode via `opencode run --model <model>`. The model format is `provider/model` (e.g., `anthropic/claude-haiku-3-5`).

### Alternative: environment variables (temporary, per-session)
```bash
export COMMANDER_MODEL=claude-sonnet-4-5
export TERMITE_WORKERS=sonnet:1,haiku:2
```

Priority: termite.config.json > opencode.json > env vars > defaults (except commander model has no default; it must be configured).

Recommended flow:
```bash
termite-commander init --colony "$PWD"
# Optional: if you need to preserve existing fields strictly:
termite-commander config import --from auto --apply
termite-commander doctor --config --credentials --runtime
```

## Routing Logic

1. User says "plan/start/施工/干活/deploy" + objective → **Start Colony Work**
2. User says "status/进度/怎么样" → **Check Status**
3. User says "stop/halt/停/暂停" → **Stop**
4. User says "workers/工人/谁在工作" → **Show Workers**
5. User says "resume/continue/继续" → **Resume**
6. User says "configure/配置/model/模型" → **Model Configuration**: run `termite-commander config bootstrap --from auto` as the tool, then edit `termite.config.json` only if needed
7. User says "watch/monitor/监控" → suggest dashboard: `termite-commander dashboard --mode auto`

## Important Notes

- Commander runs as a background process (`nohup`). PID stored in `commander.lock`.
- Status snapshots written to `.commander-status.json` on every heartbeat cycle.
- Use `termite-commander dashboard --mode auto` (or `termite-commander`) to open dashboard in a separate terminal.
- Use `termite-commander daemon start ...` for managed background runs with inherited env/PATH.
- Runtime logs are captured in `.commander.events.log` (rotated), with optional legacy output in `.commander.log`.
- Commander does NOT do research or design — that's your job. Commander only decomposes and orchestrates.
- Use `.termite/human/` for unstable drafts and `.termite/worker/` for worker-facing finalized context.
- **After running `termite-commander install`**, restart Claude Code session for the plugin to take effect.
- **API keys**: Commander inherits env vars from the current shell. Ensure provider-specific credentials for `commander.model` are set before launching.
- **Worker runtime required**: install at least one worker CLI (`opencode`, `claude`, or `codex`) used by your configured fleet.
