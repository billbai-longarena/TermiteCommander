[中文文档](README.zh-CN.md)

# Termite Commander

**A swarm of cheap AI models writes your code, directed by one smart model.**

---

## Executive Summary

Termite Commander is a **multi-model orchestration engine** that splits AI coding work between a strong model (planning) and cheap models (execution). You design in Claude Code, Commander decomposes the plan into atomic signals, then a fleet of Haiku/Gemini-class workers executes in parallel.

Built on [Termite Protocol](https://github.com/billbai-longarena/Termite-Protocol) — a battle-tested framework validated across **6 production colonies, 900+ commits, and 4 multi-model audit experiments**.

**Core metric**: In the touchcli A-005 experiment, 1 Codex shepherd + 2 Haiku workers achieved **96.4% observation quality** — nearly matching strong-model-only output — through a mechanism we call the **Shepherd Effect**.

---

## The Problem

### Single-model coding agents are a bad cost structure

```
Human → Claude Code (Sonnet/Opus) → works sequentially → $$$
```

You're paying strong-model prices for work that Haiku could do — **if the task were specified precisely enough**.

### Existing multi-agent approaches miss the real issue

| Framework             | How agents coordinate      | Why it doesn't solve the cost problem                                                                                                                                   |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CrewAI / AutoGen**  | Agents discuss via chat    | All agents need strong models to hold conversation context. Weak models hallucinate in multi-turn discussions. No persistent memory — every session restarts from zero. |
| **LangGraph**         | Static workflow graphs     | Predetermined flow, no dynamic task claiming. Can't adapt to parallel workers finishing at different times.                                                             |
| **OpenAI Swarm**      | Agent-to-agent handoff     | Sequential handoff, not parallel execution. One agent active at a time.                                                                                                 |
| **Devin / Codex CLI** | Single agent, long session | No parallelism, no weak-model delegation. One model does everything.                                                                                                    |
| **MetaGPT**           | Role-play simulation       | PM, architect, engineer all need strong models. Conversation overhead scales with agent count.                                                                          |

**The common failure**: These frameworks coordinate agents through **conversation** or **message passing**. This requires every agent to understand context, maintain coherent dialogue, and reason about other agents' state — exactly the things weak models can't do.

**Our insight**: The bottleneck isn't "how do agents talk" — it's **"how do you specify work so precisely that a cheap model can execute it without needing to understand anything else."**

---

## Why Termite Commander + Termite Protocol

### 1. Environment Carries Intelligence, Not Agents

This is the fundamental architectural difference.

In CrewAI/AutoGen, intelligence lives **inside agents** — they reason, discuss, plan. In Termite Protocol, intelligence lives **in the environment** — signals in SQLite, pheromones in files, behavioral templates in the pheromone chain. Agents are stateless executors that sense the environment and act.

```
CrewAI:    Smart Agent ↔ Smart Agent ↔ Smart Agent (conversation)
Termite:   Agent → Environment → Agent → Environment → Agent (stigmergy)
```

Why this matters: **Weak models don't need to be smart. They just need to sense signals and follow templates.** The environment does the coordinating.

### 2. The Shepherd Effect — Proven 18x Quality Improvement

Our most significant finding, validated across 4 audit experiments:

| Configuration           | Observation Quality | Handoff Quality | Source              |
| ----------------------- | ------------------- | --------------- | ------------------- |
| 2 Haiku independent     | **35.7%**           | 0%              | A-003 ReactiveArmor |
| 1 Codex + 2 Haiku       | **96.4%**           | 99%             | A-005 touchcli      |
| 5-model swarm (diluted) | **57%**             | 100%            | A-006 touchcli      |

**Mechanism**: When a strong model (Codex/Sonnet) works in the colony first, it leaves high-quality pheromone deposits — observations with complete pattern/context/detail structure. Subsequent weak models **imitate these templates through in-context learning**. The `.birth` file carries an `observation_example` from the strongest prior deposit.

This is not training. It's not fine-tuning. It's **environmental amplification** — the strong model improves the environment, and the environment makes weak models effective.

**Key finding from A-003 vs A-005**: Weak models aren't incapable of quality work. They're incapable of **initiating** quality patterns. Given a template to follow, Haiku produces work indistinguishable from Codex in 96% of cases.

### 3. .birth Compression: 800 Tokens to Initialize Any Agent

Other frameworks burden agents with full context windows of documentation. Termite Protocol compresses the entire coordination state into a `.birth` file — **<800 tokens** — computed dynamically by `field-arrive.sh`:

| Approach                    | Agent context cost        | What agent needs to read                |
| --------------------------- | ------------------------- | --------------------------------------- |
| Full protocol document (v2) | ~40% of context window    | 28K token TERMITE_PROTOCOL.md           |
| Termite .birth (v3+)        | **~2%** of context window | 800 token computed snapshot             |
| CrewAI role prompt          | ~10-15%                   | Role description + conversation history |
| AutoGen system prompt       | ~5-10%                    | System message + growing chat log       |

The `.birth` file contains: current colony state, top unclaimed signal, behavioral template (Shepherd Effect exemplar), 4 safety rules, and recovery hints. It's everything an agent needs and nothing more.

### 4. Signal Claiming: No Conversation, No Conflicts, No Bottleneck

Agents never talk to each other. They claim signals from SQLite via atomic transactions:

```
Agent arrives → reads .birth → sees unclaimed signal →
  field-claim.sh claim S-007 → EXCLUSIVE lock → success →
  execute task → commit → field-deposit.sh → done
```

- **No scheduler bottleneck**: Agents self-organize, claiming available work
- **No conflicts**: Atomic DB claims prevent double-assignment
- **Crash resilient**: If an agent dies, the claim auto-releases after heartbeat timeout (fixes the 63-minute starvation discovered in A-006)
- **Leaf-priority**: `.birth` shows deepest unclaimed signals first, maximizing parallelism

### 5. Real Production Data, Not Benchmarks

We don't have synthetic benchmarks. We have **real multi-model colony audits** with detailed findings:

| Colony                    | Models          | Duration | Commits | Signals | Key Finding                                                            |
| ------------------------- | --------------- | -------- | ------- | ------- | ---------------------------------------------------------------------- |
| **ReactiveArmor** (A-003) | Codex + 2 Haiku | —        | 121     | 24      | Weak models execute protocol loop but fail judgment (validates F-009c) |
| **touchcli** (A-005)      | Codex + 2 Haiku | 6h       | 130     | 6       | **Shepherd Effect**: 96.4% quality via pheromone templates             |
| **touchcli** (A-006)      | 5 models        | 17h      | **562** | 113     | Highest throughput ever; dilution regression at scale                  |
| **SalesTouch** (0227)     | Production      | ongoing  | —       | —       | Stable production reference colony                                     |

A-005 delivered a complete MVP: PostgreSQL schema (11 tables), REST API (11 endpoints), React/Vite frontend, Docker containerization — all from 1 Codex shepherd + 2 Haiku workers.

### 6. Commander's Signal Decomposition: The Missing Piece

Termite Protocol provides the coordination substrate. Commander adds the **decomposition intelligence**:

```
PLAN.md (your design)
  ↓ Commander (1 strong-model LLM call)
  ↓
Signal 1: "Create src/middleware/auth.ts: JWT verification middleware.
           Check Authorization header, verify with JWT_SECRET,
           next() on success, 401 on failure. Use jsonwebtoken."

Signal 2: "Create src/routes/auth.ts: POST /login validates
           email+password against DB, returns {token, user}."

Signal 3: "Add JWT_SECRET to .env.example, update README auth section."
```

Each signal follows **weak-model execution standards**:
- **One file, one action** — no multi-file coordination needed
- **All context embedded** — file paths, function signatures, expected behavior in the signal text
- **Explicit acceptance criteria** — the model knows when it's done
- **Max depth 3** — flat dependency tree, maximum parallelism

---

## When To Use (and When Not To)

### Ideal Scenarios

| Scenario                                | Why it works                                | Example                                          |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| **Feature implementation after design** | Design is done, execution is parallelizable | "Build the auth system from PLAN.md"             |
| **Large-scale refactoring**             | Many independent file changes               | "Migrate all API routes from Express to Fastify" |
| **Test suite creation**                 | Each test file is independent               | "Add unit tests for all service modules"         |
| **Documentation generation**            | Each doc is independent                     | "Generate API docs for all endpoints"            |
| **Dependency migration**                | Repetitive per-file changes                 | "Upgrade all React class components to hooks"    |
| **Multi-module scaffolding**            | Parallel file creation                      | "Create CRUD endpoints for 8 database models"    |

### Not Ideal Scenarios

| Scenario                           | Why it doesn't fit                                  | What to use instead          |
| ---------------------------------- | --------------------------------------------------- | ---------------------------- |
| **Exploratory research**           | Needs strong model judgment, not parallel execution | Claude Code directly         |
| **Architecture design**            | Needs holistic understanding across the codebase    | Claude Code directly         |
| **Debugging cross-cutting issues** | Requires tracing dependencies across files          | Claude Code directly         |
| **Single-file deep refactoring**   | No parallelism benefit                              | Claude Code directly         |
| **Ambiguous requirements**         | Weak models can't resolve ambiguity                 | Design first, then Commander |

**Rule of thumb**: If you can decompose the work into independent, file-level tasks before starting — Commander will accelerate it. If the work requires discovering what to do as you go — use Claude Code directly.

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│  You + Claude Code / OpenCode                       │
│  Research, design, architect (strong model)          │
│  Output: PLAN.md                                    │
└────────────────────┬────────────────────────────────┘
                     │ /commander
                     ▼
┌─────────────────────────────────────────────────────┐
│  Commander Engine (2 LLM calls)                     │
│  1. Classify task (BUILD / HYBRID)                  │
│  2. Decompose → atomic signals for weak models      │
│  3. Auto-install protocol + genesis if needed        │
│  4. Dispatch signals → SQLite DB                    │
│  5. Launch mixed-model worker fleet                  │
│  6. Dual heartbeat + circuit breaker                │
└────────────────────┬────────────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐
     │ Sonnet  │ │ Haiku   │ │ Haiku   │
     │ (hard)  │ │(routine)│ │(routine)│
     └────┬────┘ └────┬────┘ └────┬────┘
          │          │          │
     claim → execute → commit → deposit pheromone
     (Shepherd Effect: strong model's deposits
      become templates for weak model imitation)
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  TUI Dashboard (full-screen, htop-style)            │
│  Signals • Workers • Git commits • Activity log     │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- **Node.js 22+**
- **OpenCode** — [github.com/nicepkg/opencode](https://github.com/nicepkg/opencode) (drives worker agents)
- **Anthropic API Key** — `export ANTHROPIC_API_KEY=sk-...`
- **Git**

### Step 0: Install Commander (one-time, global)

Commander is a global CLI tool. Install once, use in any project.

```bash
# Recommended: install via npm
npm install -g termite-commander

# Or: one-line install script (auto-detects npm, falls back to clone + build)
curl -fsSL https://raw.githubusercontent.com/billbai-longarena/TermiteCommander/master/install.sh | bash
```

Verify the installation:
```bash
termite-commander --version
```

> **About Termite Protocol**: No manual installation needed. When Commander first runs with `--run`, it auto-detects whether the target project has the protocol installed. If not, Commander automatically clones and installs it from GitHub.

### 7-Step Workflow

**Step 1** — Enter your project and start Claude Code (or OpenCode):
```bash
cd ~/your-project
claude    # or: opencode
```

**Step 2** — Install Commander skills into the project (once per project):
```bash
termite-commander install --colony .
```
This installs:
- `.claude/plugins/termite-commander/` — Claude Code plugin (SessionStart hook + /commander skill)
- `.opencode/skill/commander/` — OpenCode commander skill
- `.opencode/skill/termite/` — Termite Protocol skill (workers use this to claim signals and deposit pheromones)

After installation, Claude Code recognizes `/commander` and natural language triggers ("deploy termites", "send the colony").

**Step 3** — Design in Claude Code:
```
> Help me design an OAuth2 authentication system for this Express app.
> Write the architecture plan to PLAN.md.
```
Design quality directly determines colony output quality. Invest time here.

**Step 4** — Configure worker models (optional, has defaults):
```bash
# Default: 3 Haiku workers, Sonnet for signal decomposition
# Recommended: 1 strong + N weak (Shepherd Effect)
export TERMITE_WORKERS=sonnet:1,haiku:2
```

**Step 5** — Launch the colony:
```
> /commander Build the auth system from PLAN.md
```
Commander handles the full pipeline: detect protocol (install from GitHub if missing) → genesis → signal decomposition → dispatch → launch workers → heartbeat monitoring.

**Step 6** — Open another terminal for the TUI dashboard:
```bash
cd ~/your-project && termite-commander
```

**Step 7** — The colony auto-stops when complete. Review results:
```
> /commander status
> Read HALT.md and summarize what the colony accomplished
```

---

## Model Configuration

**Priority**: environment variables > `opencode.json` > defaults

| Variable          | Purpose                             | Default             |
| ----------------- | ----------------------------------- | ------------------- |
| `COMMANDER_MODEL` | Strong model (signal decomposition) | `claude-sonnet-4-5` |
| `TERMITE_MODEL`   | Default weak model (workers)        | `claude-haiku-4-5`  |
| `TERMITE_WORKERS` | Fleet spec                          | `3` (3x default)    |

```bash
# Uniform fleet
export TERMITE_WORKERS=3

# Mixed fleet (recommended for Shepherd Effect)
export TERMITE_WORKERS=sonnet:1,haiku:2,gemini-flash:1

# Via opencode.json
# { "model": "anthropic/claude-sonnet-4-5", "small_model": "anthropic/claude-haiku-3-5",
#   "commander": { "workers": [{"model":"...","count":1}, ...] } }
```

**Recommended configuration**: 1 strong model worker (Sonnet) + N weak model workers (Haiku). The strong worker's pheromone deposits become templates that amplify weak worker quality via the Shepherd Effect.

---

## CLI Reference

```
termite-commander                      TUI dashboard (full-screen, real-time)
termite-commander install              Install skills into project
termite-commander plan <objective>     Decompose and execute
  --plan <file>                          Design document as context
  --context <text>                       Direct text context
  --colony <path>                        Colony root (default: cwd)
  --run                                  Full execution mode
  --dispatch                             Dispatch signals only
termite-commander status [--json]      Colony status
termite-commander workers [--json]     Worker status
termite-commander stop                 Stop all + cleanup stale state
termite-commander resume               Resume from halt
termite-commander watch                Polling status (non-TUI)
```

---

## TUI Dashboard

Full-screen terminal dashboard (alternate screen buffer):

- **Signal progress** — bar + full list from DB with status/type/worker
- **Worker status** — model labels, session IDs, duration, stale detection (dead workers marked with cleanup instructions)
- **Git commits** — real-time feed from worker commits
- **Activity log** — tails `.commander.log`
- **Responsive** — adapts to terminal width

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
    signal-bridge.ts           # SQLite DB via termite field scripts
    opencode-launcher.ts       # Mixed-model worker fleet
    plan-writer.ts / halt-writer.ts
  heartbeat/
    commander-loop.ts          # 60s strategic monitoring
    colony-loop.ts             # 15-60s adaptive worker pulsing
    circuit-breaker.ts         # Dual-layer halt (complete + stall)
  tui/
    MonitorApp.tsx             # Full-screen Ink/React dashboard
    components/                # ProgressBar, SignalList, WorkerTable, CommitFeed, ActivityLog
    hooks/                     # useColonyState, useGitCommits, useLogTail
```

50 tests across 7 suites. `npm run build && npm test`.

---

## Protocol Integration

| What                           | Provided by      | How                                    |
| ------------------------------ | ---------------- | -------------------------------------- |
| Signal DB + atomic claiming    | Termite Protocol | SQLite + field-claim.sh                |
| Agent initialization           | Termite Protocol | field-arrive.sh → .birth (<800 tokens) |
| Cross-session memory           | Termite Protocol | Pheromone deposits + decay             |
| Shepherd Effect templates      | Termite Protocol | observation_example in .birth          |
| **Signal decomposition**       | **Commander**    | Strong model → atomic signals          |
| **Worker fleet orchestration** | **Commander**    | Mixed-model launch + heartbeat         |
| **Monitoring**                 | **Commander**    | TUI + status files + activity log      |

---

## License

MIT
