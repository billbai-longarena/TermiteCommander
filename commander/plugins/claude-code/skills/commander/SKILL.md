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

### Start Colony Work

Two ways to provide design context:

**Option A: From a design document**
```bash
nohup termite-commander plan "<objective>" --plan PLAN.md --colony "$PWD" --run > .commander.log 2>&1 &
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

Or launch the read-only TUI dashboard:
```bash
termite-commander
```

## Model Configuration

When user asks to configure models, help them by reading and writing `opencode.json`.

### Read current config
```bash
cat opencode.json 2>/dev/null || echo "No opencode.json found"
```

### Write/update config
Read the current `opencode.json` (if it exists), then modify these fields:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-3-5",
  "commander": {
    "workers": [
      { "model": "anthropic/claude-sonnet-4-5", "count": 1 },
      { "model": "anthropic/claude-haiku-3-5", "count": 2 }
    ]
  }
}
```

**Fields explained:**
- `model` — strong model for Commander's signal decomposition (default: claude-sonnet-4-5)
- `small_model` — default weak model for workers (default: claude-haiku-3-5)
- `commander.workers` — mixed fleet: each entry specifies a model and how many workers to launch

**Recommended: Shepherd Effect config** (1 strong + N weak):
```json
{
  "commander": {
    "workers": [
      { "model": "anthropic/claude-sonnet-4-5", "count": 1 },
      { "model": "anthropic/claude-haiku-3-5", "count": 2 }
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

Priority: env vars > opencode.json > defaults.

## Routing Logic

1. User says "plan/start/施工/干活/deploy" + objective → **Start Colony Work**
2. User says "status/进度/怎么样" → **Check Status**
3. User says "stop/halt/停/暂停" → **Stop**
4. User says "workers/工人/谁在工作" → **Show Workers**
5. User says "resume/continue/继续" → **Resume**
6. User says "configure/配置/model/模型" → **Model Configuration**: read opencode.json, help user edit it
7. User says "watch/monitor/监控" → suggest opening TUI: `termite-commander`

## Important Notes

- Commander runs as a background process (`nohup`). PID stored in `commander.lock`.
- Status snapshots written to `.commander-status.json` on every heartbeat cycle.
- Use `termite-commander` (no args) to open read-only TUI dashboard in a separate terminal.
- Commander does NOT do research or design — that's your job. Commander only decomposes and orchestrates.
- **After running `termite-commander install`**, restart Claude Code session for the plugin to take effect.
- **API keys**: Commander inherits env vars from the current shell. Ensure `ANTHROPIC_API_KEY` is set before launching.
- **OpenCode required**: Workers are driven by `opencode run`. Install OpenCode first: `npm install -g opencode`.
