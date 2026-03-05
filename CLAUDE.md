# Termite Commander

Autonomous orchestration engine for the Termite Protocol. Decomposes objectives into signals, dispatches to colony workers, monitors via heartbeats.

## Session Handoff

**每次会话结束前，更新 WIP.md。每次会话开始时，先读 WIP.md。**

```
开始工作前: 读 WIP.md → 了解上次做到哪 → 继续
结束工作前: 写 WIP.md → 记录做了什么、下一步是什么
```

## Repository Structure

This workspace contains three repos with different roles:

| Directory | Repo | Branch | Role | Relationship |
|-----------|------|--------|------|-------------|
| `.` (root) | `git@github.com:billbai-longarena/TermiteCommander.git` | `master` | Commander engine, CLI, plugins, skills | 主项目 |
| `TermiteProtocol/` | `git@github.com:billbai-longarena/Termite-Protocol.git` | `main` | Protocol spec, field scripts, templates, audit packages | 嵌套 git repo (subproject)，Commander 通过 gitlink 跟踪其 commit |
| `opencode/` | `https://github.com/anomalyco/opencode.git` | `dev` | AI coding agent (类似 Claude Code) | 参考源码，Commander 需要适配其 API。已在 .gitignore 排除 |

**项目关系：**

```
TermiteCommander (指挥官)
├── 依赖 TermiteProtocol (协议规范)
│   Commander 按照 Protocol 定义的信号格式、field scripts、蚁群规则来分解任务和调度工人
│   Protocol 的 commit 通过 gitlink 记录在 Commander 仓库中
│
└── 适配 OpenCode (工人运行时)
    Commander 支持 `opencode` / `claude` / `codex` CLI 启动工人（可混合调度）
    opencode/ 源码仅作本地参考，不提交到 Commander 仓库
```

**Push 规则：**

```bash
# Commander (root) — 推到 master
git push origin master

# Termite Protocol (nested repo) — 推到 main
cd TermiteProtocol && git push origin main

# 如果 TermiteProtocol 有新 commit，回到 root 更新 gitlink：
cd .. && git add TermiteProtocol && git commit -m "chore: update TermiteProtocol ref"

# opencode/ 不推送，仅本地参考（.gitignore 已排除）
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

Priority: opencode.json > environment variables > defaults

| Variable | Purpose | Default |
|----------|---------|---------|
| COMMANDER_MODEL | Strong model for signal decomposition | claude-sonnet-4-5 |
| TERMITE_WORKER_CLI | Default worker runtime (opencode/claude/codex) | opencode |
| TERMITE_MODEL | Default weak model for workers | claude-haiku-3-5 |
| TERMITE_WORKERS | Worker fleet spec ("3", "model:count", "cli@model:count") | 3 × default |

Falls back to opencode.json: `model`, `small_model_cli`, `small_model`, `commander.default_worker_cli`, `commander.workers`.

## Build & Test

```bash
cd commander
npm run build          # tsc
npm test               # 61 tests, 9 suites
```

## Conventions

- TypeScript strict mode, ESM (ES2022 target), JSX via react-jsx
- TUI: Ink 5 + React 18 — read-only full-screen dashboard (alternate screen buffer)
- Pipeline: 2 phases (classify + decompose), auto-installs protocol + genesis
- Model config: opencode.json > env vars > defaults, mixed-model worker fleets
- Model status feedback: `plan` and `status` print effective model selection and source (config/env/default)
- Workers: supports `opencode`, `claude`, and `codex` runtimes with mixed fleet scheduling
- Pre-flight checks: runtime CLI availability + protocol presence
- LLM provider: Anthropic (default), OpenAI, or Azure OpenAI via Vercel AI SDK
- Signals use SQLite (via colony's termite-db.sh)
