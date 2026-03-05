# Termite Commander

**让一群便宜的 AI 模型替你写代码，由一个聪明的模型指挥。**
**A swarm of cheap AI models writes your code, directed by one smart model.**

---

## Executive Summary

Termite Commander turns any AI coding agent (Claude Code, OpenCode) into a **multi-model construction crew**. You design with a strong model, Commander decomposes the plan into atomic tasks, then a fleet of cheap models executes them in parallel — with automatic monitoring and halt-on-completion.

**Cost reduction**: A task that takes one Sonnet session 2 hours can be split into 15 signals executed by 3 Haiku workers in 20 minutes, at ~1/10th the token cost.

**Key insight**: Weak models (Haiku, Gemini Flash) can execute well-defined, atomic tasks reliably. They fail at planning, design, and ambiguous work. Commander separates these concerns: strong model plans, weak models execute.

---

## The Problem

### AI coding agents are powerful but expensive and sequential

Today's AI coding workflow:

```
Human → Claude Code (strong model) → works on tasks one by one → slow, expensive
```

You're paying Sonnet/Opus prices for work that a Haiku-class model could do — **if someone told it exactly what to do, in small enough pieces**.

### Existing multi-agent solutions don't address the real bottleneck

| Approach | Problem |
|----------|---------|
| **Multi-agent chat** (CrewAI, AutoGen) | Agents discuss plans endlessly. Weak models hallucinate in discussions. No persistent memory across sessions. |
| **Task queues** (Devin-style) | Single model, single session. No cost optimization. No weak-model delegation. |
| **Prompt chaining** | Brittle. No parallel execution. No monitoring. No recovery from failures. |

The real bottleneck is not "how do agents talk to each other" — it's **"how do you decompose work so that cheap models can do it reliably."**

---

## Why Termite Commander

### 1. Signal Decomposition: The Core Innovation

Commander's value is in one function: turning a design plan into **atomic signals that weak models can execute without ambiguity**.

```
Design: "Build OAuth2 authentication with JWT tokens"

↓ Commander decomposes (one strong-model LLM call) ↓

Signal 1: "Create src/middleware/auth.ts: JWT verification middleware
           that checks Authorization header, verifies with JWT_SECRET,
           calls next() on success or returns 401."

Signal 2: "Create src/routes/auth.ts: POST /login endpoint that validates
           email+password against DB, returns {token, user} on success."

Signal 3: "Add JWT_SECRET to .env.example, update README with auth docs."

... (each signal = one file, one action, explicit acceptance criteria)
```

Each signal is:
- **Atomic**: one action, one file, completable in a single session
- **Self-contained**: all context embedded (file paths, function signatures, expected behavior)
- **Verifiable**: explicit acceptance criteria the model checks itself
- **Parallel**: flat dependency tree, maximum concurrency

### 2. Mixed-Model Economics

Run different models for different cost/capability profiles:

```bash
export TERMITE_WORKERS=sonnet:1,haiku:2,gemini-flash:1
# 1 Sonnet for complex signals, 2 Haiku for routine code, 1 Gemini Flash for docs
```

### 3. Biological Reliability: The Termite Protocol

Built on [Termite Protocol](https://github.com/billbai-longarena/Termite-Protocol) — a battle-tested framework (v5.1, 6 production colonies audited) for stateless AI agent coordination:

- **No shared memory required** — signals persist in SQLite, survive agent crashes
- **Automatic work distribution** — agents claim signals atomically, no conflicts
- **Cross-session persistence** — pheromone system carries knowledge between sessions
- **Self-healing** — stalled workers detected and restarted automatically

### 4. Zero-Overhead Integration

Commander plugs into your existing Claude Code or OpenCode workflow. No new tools to learn:

```
> /commander 按照PLAN.md开始施工
```

Or natural language: "让蚁群干活", "deploy termites", "start colony work".

---

## Why Now

1. **Cheap models are good enough for atomic tasks** — Haiku 3.5 and Gemini Flash can write a single function, create a single file, add a single test — reliably — if the task is well-specified.

2. **Strong models are too expensive for bulk work** — Using Sonnet/Opus for every line of code is like hiring a senior architect to lay bricks.

3. **AI coding agents now support programmatic control** — OpenCode's `opencode run` and Claude Code's skill system enable non-interactive, scriptable agent execution.

4. **The decomposition problem is solved** — LLMs are excellent at breaking down plans into structured, atomic tasks. This is the missing piece: a strong model that decomposes once, enabling many cheap executions.

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│  You + Claude Code / OpenCode                       │
│  Design, research, architect (strong model)         │
│  Output: PLAN.md                                    │
└────────────────────┬────────────────────────────────┘
                     │ /commander
                     ▼
┌─────────────────────────────────────────────────────┐
│  Commander Engine                                   │
│  1. Classify task (BUILD / HYBRID)                  │
│  2. Decompose → atomic signals (1 LLM call)        │
│  3. Dispatch signals → SQLite DB                    │
│  4. Launch mixed-model worker fleet                 │
│  5. Dual heartbeat monitoring                       │
└────────────────────┬────────────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐
     │ Sonnet  │ │ Haiku   │ │ Haiku   │
     │ Worker  │ │ Worker  │ │ Worker  │
     │ (hard)  │ │ (routine)│ │(routine)│
     └─────────┘ └─────────┘ └─────────┘
          │          │          │
          ▼          ▼          ▼
     claim signal → execute → commit → deposit pheromone
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  TUI Dashboard (read-only, real-time)               │
│  Signal progress, worker status, git commits, logs  │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

### Install

```bash
# 1. Clone and build Commander
git clone https://github.com/billbai-longarena/TermiteCommander.git
cd TermiteCommander/commander
npm install && npm run build && npm link

# 2. In your project, install skills
cd ~/your-project
termite-commander install --colony .
```

Prerequisites: Node.js 22+, OpenCode, an Anthropic API key.
Termite Protocol is auto-installed by Commander if not present.

### 7-Step Workflow

**Step 1** — Open your project in Claude Code (or OpenCode):
```bash
cd ~/your-project && claude
```

**Step 2** — Install Commander skills (one-time):
```bash
termite-commander install --colony .
```

**Step 3** — Design your feature in Claude Code:
```
> Help me design an OAuth2 authentication system. Write the plan to PLAN.md.
```

**Step 4** — Configure worker models (optional):
```bash
export TERMITE_WORKERS=sonnet:1,haiku:2    # or just: export TERMITE_WORKERS=3
```

**Step 5** — Start colony execution:
```
> /commander 按照PLAN.md开始施工
```
Commander auto-detects protocol, auto-initializes colony, decomposes, dispatches, launches workers.

**Step 6** — Watch the TUI dashboard (another terminal):
```bash
termite-commander
```

**Step 7** — Colony completes automatically. Review results:
```
> /commander status
> Read HALT.md and summarize what the colony accomplished
```

---

## Model Configuration

**Priority**: environment variables > `opencode.json` > defaults

| Variable | Purpose | Default |
|----------|---------|---------|
| `COMMANDER_MODEL` | Strong model for signal decomposition | `claude-sonnet-4-5` |
| `TERMITE_MODEL` | Default weak model for workers | `claude-haiku-3-5` |
| `TERMITE_WORKERS` | Worker fleet spec | `3` (3x default) |

### Uniform Fleet
```bash
export TERMITE_WORKERS=3
export TERMITE_MODEL=claude-haiku-3-5
```

### Mixed Fleet
```bash
export TERMITE_WORKERS=sonnet:1,haiku:2,gemini-flash:1
```

### Via opencode.json
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

---

## CLI Reference

```bash
termite-commander                      # TUI dashboard (full-screen, real-time)
termite-commander install              # Install skills into project
termite-commander plan <objective>     # Decompose and execute
  --plan <file>                        #   Design document as context
  --context <text>                     #   Direct text context
  --colony <path>                      #   Colony root (default: cwd)
  --run                                #   Full execution mode
  --dispatch                           #   Dispatch signals only
termite-commander status [--json]      # Colony status
termite-commander workers [--json]     # Worker status
termite-commander stop                 # Stop all + cleanup
termite-commander resume               # Resume from halt
termite-commander watch                # Polling status (non-TUI)
```

---

## TUI Dashboard

Full-screen terminal dashboard (alternate screen buffer, like htop):

- **Signal progress** — progress bar + full signal list from DB
- **Worker status** — model labels, session IDs, duration, dead detection
- **Git commits** — real-time commit feed from workers
- **Activity log** — tails `.commander.log` for live Commander output
- **Responsive layout** — adapts to terminal width

Stale state detection: if Commander crashes, workers show as "dead" with cleanup instructions.

---

## Architecture

```
commander/src/
  config/model-resolver.ts     # opencode.json + env vars → model config
  engine/
    pipeline.ts                # 2-phase: classify → decompose
    classifier.ts              # BUILD / HYBRID
    decomposer.ts              # Weak-model signal standards
  colony/
    signal-bridge.ts           # SQLite DB via field scripts
    opencode-launcher.ts       # Mixed-model worker fleet
    plan-writer.ts             # PLAN.md generation
    halt-writer.ts             # HALT.md on circuit break
  heartbeat/
    commander-loop.ts          # 60s strategic monitoring
    colony-loop.ts             # 15-60s adaptive worker pulsing
    circuit-breaker.ts         # Dual-layer halt (complete + stall)
  tui/
    MonitorApp.tsx             # Full-screen Ink/React dashboard
    components/                # ProgressBar, SignalList, WorkerTable, CommitFeed, ActivityLog
    hooks/                     # useColonyState, useGitCommits, useLogTail
  index.ts                     # CLI entry point
```

---

## Termite Protocol Integration

Commander is built on [Termite Protocol](https://github.com/billbai-longarena/Termite-Protocol) (v5.1):

| Layer | Provided by | Purpose |
|-------|------------|---------|
| Signal system | Protocol (SQLite + field scripts) | Atomic task dispatching + claiming |
| Worker lifecycle | Protocol (field-arrive, field-claim, field-deposit) | Agent initialization, work claiming, knowledge deposit |
| Cross-session memory | Protocol (pheromone system) | Knowledge persistence across agent sessions |
| Signal decomposition | **Commander** | Design → atomic signals for weak models |
| Worker orchestration | **Commander** | Mixed-model fleet, heartbeats, circuit breaker |
| Monitoring | **Commander** | TUI dashboard, status files, activity log |

---

## Build & Test

```bash
cd commander
npm run build          # TypeScript compilation
npm test               # 50 tests, 7 suites
```

---

## License

MIT
