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
- [OpenCode](https://github.com/nicepkg/opencode) for worker execution
- An LLM API key (Anthropic recommended: `ANTHROPIC_API_KEY`)

> Termite Protocol is auto-installed by Commander if not present.

### Install Commander

```bash
git clone https://github.com/billbai-longarena/TermiteCommander.git
cd TermiteCommander/commander
npm install && npm run build && npm link
```

---

## Complete Workflow: From Zero to Colony Execution

### Step 1: Enter your project and launch Claude Code (or OpenCode)

```bash
cd ~/your-project
claude   # or: opencode
```

### Step 2: Install Commander skills into the project

In Claude Code, or in a terminal:

```bash
termite-commander install --colony .
```

This installs:
- `.claude/plugins/termite-commander/` — Claude Code plugin (hooks + skill)
- `.opencode/skill/commander/` — OpenCode skill
- `.opencode/skill/termite/` — Termite protocol skills for workers

After this, Claude Code recognizes `/commander` and natural language triggers like "让蚁群干活".

### Step 3: Design in Claude Code

Use Claude Code normally to design your feature:

```
> Help me design an OAuth2 authentication system for this Express app.
> Write the architecture plan to PLAN.md.
```

Claude Code does the research, analysis, and design — this is its strength. Take your time here. The quality of the design directly determines the quality of colony output.

### Step 4: Configure worker models (optional)

Set environment variables before starting Commander:

```bash
# Strong model for signal decomposition (default: claude-sonnet-4-5)
export COMMANDER_MODEL=claude-sonnet-4-5

# Worker fleet (default: 3 × claude-haiku-3-5)
export TERMITE_WORKERS=sonnet:1,haiku:2
# Or uniform: TERMITE_WORKERS=3 and TERMITE_MODEL=claude-haiku-3-5
```

Or configure in `opencode.json` (persisted):

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

### Step 5: Start Commander

In Claude Code:

```
> /commander 按照PLAN.md开始施工
```

Or natural language:

```
> 让蚁群按照设计开始干活
> deploy termites with the plan
```

Or directly in terminal:

```bash
termite-commander plan "Implement OAuth2 authentication" --plan PLAN.md --colony . --run
```

**Commander automatically:**
1. Detects if Termite Protocol is installed — if not, installs it
2. Runs colony genesis (`field-arrive.sh`) if `.birth` doesn't exist
3. Decomposes the plan into atomic signals (one strong-model LLM call)
4. Dispatches signals to the colony SQLite DB
5. Installs worker skills
6. Launches the mixed-model worker fleet
7. Starts dual heartbeat monitoring (Commander 60s + Colony 15-60s)

### Step 6: Watch progress

Open another terminal for the live dashboard:

```bash
cd ~/your-project
termite-commander
```

The TUI shows:
- Signal progress bar and full signal list (from DB)
- Worker status with model labels
- Recent git commits from workers
- Heartbeat health

Or check from Claude Code:

```
> /commander status
> /commander workers
```

### Step 7: Colony completes

When all signals are done, the circuit breaker halts Commander automatically:
- Workers stop
- `HALT.md` is generated with a summary
- `commander.lock` is cleaned up

Read the results in Claude Code:

```
> Read HALT.md and summarize what the colony accomplished
> Review the changes in git log
```

---

## CLI Reference

```bash
termite-commander                      # Read-only TUI dashboard
termite-commander install              # Install skills into project
  --colony <path>                      # Project root (default: cwd)
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
