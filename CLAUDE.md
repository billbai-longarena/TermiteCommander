# Termite Commander

Autonomous orchestration engine for the Termite Protocol. Decomposes objectives into signals, dispatches to colony workers, monitors via heartbeats.

## Session Handoff

**每次会话结束前，更新 WIP.md。每次会话开始时，先读 WIP.md。**

```
开始工作前: 读 WIP.md → 了解上次做到哪 → 继续
结束工作前: 写 WIP.md → 记录做了什么、下一步是什么
```

## Repository Structure

This workspace contains two independent Git repos that work together:

| Directory | Repo | Branch | Description |
|-----------|------|--------|-------------|
| `.` (root) | `git@github.com:billbai-longarena/TermiteCommander.git` | `master` | Commander engine, CLI, plugins, skills |
| `TermiteProtocol/` | `git@github.com:billbai-longarena/Termite-Protocol.git` | `main` | Protocol spec, field scripts, templates, audit packages |

**Push separately:**

```bash
# Commander (root)
git push origin master

# Termite Protocol (nested repo)
cd TermiteProtocol && git push origin main
```

## Key Paths

```
commander/
  src/
    config/model-resolver.ts     # Model config: opencode.json + env vars
    engine/pipeline.ts           # 2-phase: classify → decompose + auto protocol install + genesis
    engine/classifier.ts         # BUILD / HYBRID classification
    engine/decomposer.ts         # Signal decomposition with weak-model standards
    colony/signal-bridge.ts      # DB/bash bridge to colony (status + listSignals)
    colony/opencode-launcher.ts  # Mixed-model worker fleet (passes --model to opencode run)
    colony/plan-writer.ts        # PLAN.md generation
    colony/halt-writer.ts        # HALT.md generation
    heartbeat/                   # Commander + Colony loops, circuit breaker
    tui/                         # Read-only Ink dashboard (full-screen, responsive)
      MonitorApp.tsx             # Single dashboard view
      components/                # ProgressBar, SignalList, WorkerTable, CommitFeed, ActivityLog
      hooks/                     # useColonyState, useGitCommits, useLogTail
    index.ts                     # CLI entry (no args → TUI, install/plan/status/stop/...)
  skills/termite/                # Termite protocol skills (arrive, deposit, molt)
  plugins/
    claude-code/                 # Claude Code plugin (hooks, skills, scripts)
    opencode/                    # OpenCode commander skill
```

## CLI

```bash
termite-commander                  # Read-only TUI dashboard (full-screen)
termite-commander install          # Install skills into project
termite-commander plan "<obj>" --colony <path> [--plan <file>] [--context <text>] [--dispatch] [--run]
termite-commander status [--json]  # Colony status
termite-commander workers [--json] # Worker status
termite-commander stop             # Stop + cleanup stale state
termite-commander resume           # Resume from halt
termite-commander watch            # Polling status
```

## Model Configuration

Priority: environment variables > opencode.json > defaults

| Variable | Purpose | Default |
|----------|---------|---------|
| COMMANDER_MODEL | Strong model for signal decomposition | claude-sonnet-4-5 |
| TERMITE_MODEL | Default weak model for workers | claude-haiku-3-5 |
| TERMITE_WORKERS | Worker fleet spec ("3" or "sonnet:1,haiku:2") | 3 × default |

Falls back to opencode.json: `model`, `small_model`, `commander.workers`.

## Build & Test

```bash
cd commander
npm run build          # tsc
npm test               # 50 tests, 7 suites
```

## Conventions

- TypeScript strict mode, ESM (ES2022 target), JSX via react-jsx
- TUI: Ink 5 + React 18 — read-only full-screen dashboard (alternate screen buffer)
- Pipeline: 2 phases (classify + decompose), auto-installs protocol + genesis
- Model config: env vars > opencode.json > defaults, mixed-model worker fleets
- Workers: `opencode run --model <provider/model>` per worker
- Pre-flight checks: OpenCode availability, protocol presence
- LLM provider: Anthropic (default) or Azure OpenAI via Vercel AI SDK
- Signals use SQLite (via colony's termite-db.sh)
