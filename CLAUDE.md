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
    index.ts                 # CLI entry point
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
termite-commander plan "<objective>" --colony <path> [--dispatch] [--run]
termite-commander status --colony <path> [--json]
termite-commander workers --colony <path> [--json]
termite-commander stop --colony <path>
termite-commander resume --colony <path>
termite-commander watch --colony <path> [--interval <ms>]
```

## Build & Test

```bash
cd commander
npm run build          # tsc
npx tsc --noEmit       # type check
npx vitest run         # 21 tests
```

## Conventions

- TypeScript strict mode, ESM (ES2022 target)
- LLM provider: Anthropic (default) or Azure OpenAI
- Worker platform: OpenCode (`opencode run`)
- Signals use SQLite (via colony's termite-db.sh)
- Chinese and English patterns supported in classifier
