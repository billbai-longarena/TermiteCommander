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

Commander reads model config from environment variables and opencode.json:

**Commander model** (strong, for signal decomposition):
```bash
export COMMANDER_MODEL=claude-sonnet-4-5
```

**Worker models** (weak/mixed, for execution):
```bash
# Uniform: 3 workers with same model
export TERMITE_WORKERS=3
export TERMITE_MODEL=claude-haiku-3-5

# Mixed: different models
export TERMITE_WORKERS=sonnet:1,haiku:2,gemini-flash:1
```

Or configure in `opencode.json`:
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

## Routing Logic

1. User says "plan/start/施工/干活/deploy" + objective → **Start Colony Work**
2. User says "status/进度/怎么样" → **Check Status**
3. User says "stop/halt/停/暂停" → **Stop**
4. User says "workers/工人/谁在工作" → **Show Workers**
5. User says "resume/continue/继续" → **Resume**
6. User says "configure model/配置模型" → **Model Configuration** guidance

## Important Notes

- Commander runs as a background process (`nohup`). PID stored in `commander.lock`.
- Status snapshots written to `.commander-status.json` on every heartbeat cycle.
- Use `termite-commander` (no args) to open read-only TUI dashboard in a separate terminal.
- Commander does NOT do research or design — that's your job. Commander only decomposes and orchestrates.
