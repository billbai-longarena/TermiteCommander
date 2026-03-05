# Termite Commander

**白蚁协议的自主编排引擎 — 从设计方案到蚁群施工，一键启动**
**Autonomous orchestration engine for the Termite Protocol — from design to colony execution in one command**

---

## What is Termite Commander?

Termite Commander bridges the gap between **human planning** and **colony execution**. You design with Claude Code or OpenCode, then Commander decomposes your plan into atomic signals that weak models (haiku-class) can execute, dispatches them to a colony of workers, and monitors progress via dual heartbeats.

```
You + Claude Code:  Design the architecture, write the plan
         ↓
Commander:          Decompose → dispatch signals → launch workers → heartbeat monitoring
         ↓
Colony (Termites):  Claim signals → execute → commit → deposit pheromones
         ↓
TUI Dashboard:      Watch progress in real-time
```

### Key Features

- **Signal Decomposition for Weak Models** — One strong-model LLM call decomposes your plan into atomic, self-contained signals that haiku-class models can execute
- **Mixed-Model Worker Fleet** — Run `sonnet:1,haiku:2,gemini-flash:1` simultaneously
- **Dual Heartbeat + Circuit Breaker** — Commander loop (60s strategic) + Colony loop (15-60s adaptive) with automatic halt on completion or stall
- **Read-Only TUI Dashboard** — Live terminal view of signals, workers, git commits
- **Claude Code / OpenCode Integration** — `/commander` skill for seamless handoff from design to execution

---

## Quick Start

### Prerequisites

- Node.js 22+
- [Termite Protocol](https://github.com/billbai-longarena/Termite-Protocol) installed in your project
- [OpenCode](https://github.com/nicepkg/opencode) for worker execution
- An LLM API key (Anthropic or Azure OpenAI)

### Install

```bash
git clone https://github.com/billbai-longarena/TermiteCommander.git
cd TermiteCommander/commander
npm install
npm run build
npm link  # global install as 'termite-commander'
```

### Basic Usage

```bash
# 1. Install Termite Protocol in your project
bash /path/to/TermiteProtocol/install.sh ~/your-project

# 2. Initialize the colony
cd ~/your-project && ./scripts/field-arrive.sh

# 3. Decompose a plan and start the colony
termite-commander plan "Implement OAuth2 authentication system" \
  --plan PLAN.md --colony . --run

# 4. Watch progress (in another terminal)
termite-commander
```

---

## CLI Reference

```bash
termite-commander                      # Read-only TUI dashboard
termite-commander plan <objective>     # Decompose and optionally execute
  --plan <file>                        # Design document as context
  --context <text>                     # Direct text context
  --colony <path>                      # Colony root (default: cwd)
  --dispatch                           # Dispatch signals only (no workers)
  --run                                # Full execution (dispatch + workers + heartbeats)
termite-commander status [--json]      # Colony status
termite-commander workers [--json]     # Worker status
termite-commander stop                 # Stop Commander + workers
termite-commander resume               # Clear HALT.md, restart
termite-commander watch                # Real-time status polling
```

---

## Model Configuration

Commander uses a strong model for signal decomposition and weak models for worker execution.

**Priority:** environment variables > `opencode.json` > defaults

| Variable | Purpose | Default |
|----------|---------|---------|
| `COMMANDER_MODEL` | Strong model for signal decomposition | `claude-sonnet-4-5` |
| `TERMITE_MODEL` | Default weak model for workers | `claude-haiku-3-5` |
| `TERMITE_WORKERS` | Worker fleet spec | `3` (3x default model) |

### Uniform Workers

```bash
export COMMANDER_MODEL=claude-sonnet-4-5
export TERMITE_WORKERS=3
export TERMITE_MODEL=claude-haiku-3-5
```

### Mixed-Model Fleet

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
      { "model": "anthropic/claude-haiku-3-5", "count": 2 },
      { "model": "google/gemini-3-flash", "count": 1 }
    ]
  }
}
```

---

## Claude Code / OpenCode Integration

Commander integrates as a skill in both platforms. After `npm link`, use it in Claude Code:

```
> /commander 按照PLAN.md开始施工
> /commander status
> /commander stop
```

Or natural language triggers:

```
> 让蚁群干活
> 让白蚁协议执行这个设计
> deploy termites
```

The skill guides your AI assistant to:
1. Collect design context (from PLAN.md or conversation)
2. Invoke `termite-commander plan ... --run` in background
3. Report status and control workers

---

## Signal Decomposition Standards

Commander's core intelligence: decomposing plans into signals that weak models can execute.

### What Makes a Good Signal

- **Atomic**: one clear action, one file/module, single session
- **Self-contained**: title + nextHint contain ALL context (file paths, function names, behavior)
- **Verifiable**: explicit acceptance criteria the model can check itself
- **Specific paths**: exact file paths, no guessing
- **Flat dependencies**: max depth 3, maximize parallelism

### Example

```
BAD:  "Implement authentication"
GOOD: "Create src/middleware/auth.ts: JWT verification middleware
       that checks Authorization header, verifies with JWT_SECRET,
       calls next() on success or returns 401.
       Acceptance: file exists, exports verifyToken, has basic test."
```

---

## Architecture

```
commander/
  src/
    config/model-resolver.ts     # Model config: opencode.json + env vars
    engine/pipeline.ts           # 2-phase pipeline: classify → decompose
    engine/classifier.ts         # BUILD / HYBRID classification
    engine/decomposer.ts         # Signal decomposition with weak-model standards
    colony/signal-bridge.ts      # SQLite DB bridge via field scripts
    colony/opencode-launcher.ts  # Mixed-model worker management
    colony/plan-writer.ts        # PLAN.md generation
    colony/halt-writer.ts        # HALT.md on circuit break
    heartbeat/                   # Commander + Colony loops, circuit breaker
    tui/                         # Read-only Ink/React dashboard
    index.ts                     # CLI entry point
  plugins/
    claude-code/                 # Claude Code plugin (hooks + skill)
    opencode/                    # OpenCode skill
```

---

## Pipeline

Commander's pipeline is intentionally slim — 2 phases, 2 LLM calls:

| Phase | What | LLM |
|-------|------|-----|
| 0 | Classify task (BUILD / HYBRID) | 1 cheap call |
| 1 | Decompose into atomic signals | 1 strong-model call |

Research, design, and architecture analysis are done in Claude Code / OpenCode before invoking Commander. Commander only decomposes and orchestrates.

---

## Relationship with Termite Protocol

Commander is built on top of [Termite Protocol](https://github.com/billbai-longarena/Termite-Protocol) (v5.1). It uses the protocol's:

- **Signal system** (SQLite DB + field scripts) for task dispatching
- **Field scripts** (`field-arrive.sh`, `field-claim.sh`, `field-deposit.sh`) for worker lifecycle
- **.birth files** for worker initialization
- **Pheromone system** for cross-session knowledge persistence

Commander adds:
- **Automated signal decomposition** from natural language + design docs
- **Dual heartbeat monitoring** with circuit breaker
- **Mixed-model worker fleet** management
- **Real-time TUI dashboard**

### Recommended Workflow

```
1. Install Termite Protocol in your project
2. Install Commander globally (npm link)
3. Design in Claude Code / OpenCode
4. /commander to start colony execution
5. Watch the TUI dashboard
```

---

## Build & Test

```bash
cd commander
npm run build          # TypeScript compilation
npm test               # 50 tests across 7 test suites
npx tsc --noEmit       # Type check only
```

---

## License

MIT
