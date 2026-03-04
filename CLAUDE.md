# Termite Commander

Autonomous orchestration engine for the Termite Protocol. Decomposes objectives into signals, dispatches to colony workers, monitors via heartbeats.

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
    engine/pipeline.ts       # Orchestration: plan → dispatch → heartbeats
    engine/classifier.ts     # Task type classification (RESEARCH/BUILD/ANALYZE/HYBRID)
    engine/decomposer.ts     # Signal tree decomposition
    colony/signal-bridge.ts  # DB/bash bridge to colony
    colony/opencode-launcher.ts  # OpenCode worker management + skill installer
    colony/plan-writer.ts    # PLAN.md generation
    colony/halt-writer.ts    # HALT.md generation
    heartbeat/               # Commander + Colony loops, circuit breaker
    config/model-resolver.ts # Model config: opencode.json + env vars
    tui/                     # Read-only Ink dashboard (signal list, workers, git commits)
      MonitorApp.tsx         # Single dashboard view (no interaction)
      components/            # ProgressBar, SignalList, WorkerTable, CommitFeed, etc.
      hooks/                 # useColonyState (polling DB + files), useGitCommits
    index.ts                 # CLI entry point (no args → TUI, with subcommand → CLI)
  skills/termite/            # Termite protocol skills (arrive, deposit, molt)
  plugins/
    claude-code/             # Claude Code plugin (hooks, skills, scripts)
    opencode/                # OpenCode commander skill
```

## Runtime Artifacts (generated in colony, not committed)

- `commander.lock` — `{ pid, startedAt, objective }`, presence = Commander running
- `.commander-status.json` — heartbeat snapshot: signal counts, worker states
- `.commander-pulse` — last heartbeat timestamp
- `HALT.md` / `PLAN.md` / `WIP.md` / `DIRECTIVE.md` — lifecycle documents

## CLI

```bash
termite-commander                  # No args → read-only TUI dashboard
termite-commander plan "<objective>" --colony <path> [--plan <file>] [--context <text>] [--dispatch] [--run]
termite-commander status --colony <path> [--json]
termite-commander workers --colony <path> [--json]
termite-commander stop --colony <path>
termite-commander resume --colony <path>
termite-commander watch --colony <path> [--interval <ms>]
```

## Model Configuration

Priority: environment variables > opencode.json > defaults

| Variable | Purpose | Default |
|----------|---------|---------|
| COMMANDER_MODEL | Strong model for signal decomposition | claude-sonnet-4-5 |
| TERMITE_MODEL | Default weak model for workers | claude-haiku-3-5 |
| TERMITE_WORKERS | Worker fleet spec (e.g. "3" or "sonnet:1,haiku:2") | 3 × default |

Falls back to opencode.json: `model` → commander, `small_model` → workers, `commander.workers` → mixed fleet.

## Build & Test

```bash
cd commander
npm run build          # tsc
npx tsc --noEmit       # type check
npx vitest run         # 21 tests
```

## Conventions

- TypeScript strict mode, ESM (ES2022 target), JSX via react-jsx
- TUI: Ink 5 + React 18 — read-only dashboard (no interactive input)
- Pipeline: 2 phases (classify + decompose), optimized for weak-model signal decomposition
- Model config: env vars > opencode.json > defaults, supports mixed-model worker fleets
- LLM provider: Anthropic (default) or Azure OpenAI
- Worker platform: OpenCode (`opencode run`)
- Signals use SQLite (via colony's termite-db.sh)
- Chinese and English patterns supported in classifier
