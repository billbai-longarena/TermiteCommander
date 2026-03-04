# Termite Commander Design

**Date**: 2026-03-04
**Status**: Approved
**Author**: Human + Claude Opus 4.6

---

## 1. Overview

Termite Commander is an autonomous orchestration engine that sits above the Termite Protocol and OpenCode, acting as software architect, user representative, and research consultant. It receives high-level direction from humans (who may be developers OR business users), autonomously researches, plans, decomposes work into protocol-standard signals, and drives termite colonies to execute through a dual-heartbeat mechanism.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime model | Hybrid: independent engine + protocol interface | Decoupled from agent platforms, works through file system and signals |
| Trigger mode | CLI + REPL + DIRECTIVE.md file watch | Adapts to task complexity and user preference |
| Signal priority | Directive signals override autonomous | Commander signals have higher default weight, termites still self-discover |
| OpenCode adaptation | Skill/Plugin layer only (zero core changes) | Preserves independent upgradeability of OpenCode |
| Autonomy level | Fully autonomous | Commander can research, plan, architect, define quality without human confirmation |

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      TERMITE COMMANDER                          │
│                                                                 │
│  ┌───────────┐  ┌───────────┐  ┌────────────┐  ┌────────────┐  │
│  │Input Layer │  │Brain Layer│  │Output Layer │  │ Heartbeat  │  │
│  │           │  │           │  │            │  │  Engine    │  │
│  │ - CLI     │  │ - Classify│  │ - Signal   │  │            │  │
│  │ - REPL    │  │ - Research│  │   Generator│  │ ┌────────┐ │  │
│  │ - DIRECTIVE│  │ - Simulate│  │ - PLAN.md  │  │ │Cmdr    │ │  │
│  │   .md     │  │ - Arch.  │  │ - Quality  │  │ │Heartbeat│ │  │
│  │           │  │ - Synth. │  │   Criteria │  │ └────┬───┘ │  │
│  │           │  │ - Decomp.│  │ - Audit    │  │      │     │  │
│  │           │  │ - Quality│  │   Collector│  │ ┌────┴───┐ │  │
│  │           │  │           │  │            │  │ │Colony  │ │  │
│  │           │  │           │  │            │  │ │Heartbeat│ │  │
│  └─────┬─────┘  └─────┬─────┘  └──────┬─────┘  │ └────┬───┘ │  │
│        │              │               │         │ ┌──┴───┐ │  │
│        └──────────────┴───────────────┘         │ │Circuit│ │  │
│                       │                         │ │Breaker│ │  │
│                       │                         │ └──────┘ │  │
│               field-commander.sh                └─────┬────┘  │
└───────────────────────┬───────────────────────────────┘       │
                        │                                        │
                 ┌──────┴──────┐                                 │
                 │    Colony    │ <── Colony Heartbeat trigger ───┘
                 │  signals/   │
                 │  .birth     │
                 │  .pheromone │
                 │  PLAN.md    │
                 │  HALT.md    │  <- written on circuit break
                 └──────┬──────┘
                  ┌─────┴─────┐
                  v           v
           Claude Code    OpenCode
           (plugin)       (skill)
              v               v
           Termite A/B    Termite C/D/E
```

### Four Layers

1. **Input Layer**: Accepts human directives via CLI, REPL, or DIRECTIVE.md file watch.
2. **Brain Layer**: Autonomous intelligence — classifies tasks, researches, simulates users, designs architecture, decomposes into signals, defines quality standards.
3. **Output Layer**: Translates decisions into protocol-standard artifacts — signals in SQLite, PLAN.md, quality criteria, audit data.
4. **Heartbeat Engine**: Two independent heartbeat loops (Commander + Colony) with a dual-layer circuit breaker to prevent idle spinning.

---

## 3. Dual Heartbeat + Circuit Breaker

### 3.1 Two Heartbeat Loops

**Commander Heartbeat** (slow: 30-120s interval) — strategic level:
- Senses colony-wide status: signal completion, blockages, quality metrics
- Decides whether to adjust plan, emit new signals, unblock stuck work
- Enters completion assessment when all directive signals are done

**Colony Heartbeat** (fast: 10-60s interval) — execution level:
- Injects "白蚁协议" keyword into OpenCode/Claude Code sessions to trigger continuous work
- Termites claim signals, execute, commit, deposit pheromones
- Each heartbeat checks if actionable work remains

**Adaptive Interval**:
- New commits detected -> shorten to 10s (active)
- Claimed signals but no commits -> 30s (working)
- Long stall -> lengthen to 60s (approaching circuit break)

### 3.2 Dual-Layer Circuit Breaker

**Layer 1: Signal Drain (normal completion)**
```
IF all directive signals status in {done, archived}
AND no open child signals remain
AND quality checks pass
THEN -> HALT(reason: complete)
```

**Layer 2: Stall Fuse (abnormal halt)**
```
Commander side:
  IF N consecutive cycles with no new signals emitted
  AND no BLOCKED signals resolved
  THEN -> HALT(reason: commander_stall)

Colony side:
  IF M consecutive cycles with:
    - no new commits
    - no signal status changes
    - claim timeouts (orphaned locks)
  THEN -> HALT(reason: colony_stall)
```

### 3.3 Heartbeat Coordination: Who Stops First?

| Scenario | Sequence |
|----------|----------|
| Normal completion | Colony drains signals -> Colony stops -> Commander detects completion -> writes HALT.md -> Commander stops |
| Colony stall | Colony stalls M cycles -> Colony circuit-breaks -> Commander evaluates -> attempts unblock or writes HALT.md(stall) |
| Commander idle | Commander planning complete, waiting for Colony -> Commander enters low-frequency monitor (5min) -> Colony completes -> normal exit |
| Dual stall | Both stall simultaneously -> Both circuit-break -> HALT.md records dual-stop |

### 3.4 HALT.md Format

```markdown
# Colony Halted

- **Time**: 2026-03-04T15:00:00Z
- **Reason**: complete | stall
- **Commander cycles**: 47
- **Colony cycles**: 230

## Signal Summary
- Total: 15
- Completed: 12
- Remaining open: S-007, S-012, S-014

## Last Progress
- Last commit: abc1234 (8 min ago)
- Last signal state change: S-011 -> done (12 min ago)

## Recommendation
S-007 blocked on external API decision -- needs human input.
S-012 and S-014 depend on S-007.

## To Resume
Edit DIRECTIVE.md with decision on S-007, or run:
  commander resume
```

### 3.5 Restart Mechanism

When HALT.md exists:
- Human reads HALT.md to understand stop reason
- Human can:
  - a) Edit/create DIRECTIVE.md -> Commander auto-restarts
  - b) Manually unblock -> delete HALT.md -> Colony restarts
  - c) Run `commander resume` -> continues from last state

---

## 4. Signal Carrier Strategy (Anti-Corruption Design)

### Carrier Properties

|  | Markdown | JSON/YAML | SQLite |
|--|----------|-----------|--------|
| Fault tolerance | Very high (free-form) | Low (one typo breaks it) | Very high (ACID) |
| Human readable | Native | Moderate | Requires tooling |
| Agent writable | Safe (broken format still readable) | Dangerous (weak models corrupt YAML) | Safe (via API) |
| Git trackable | Good | Good | Poor (binary) |
| Concurrency | None (file conflicts) | None | WAL mode supported |

### Core Principle

**Agents never directly write structured data files. All structured writes go through field scripts into SQLite.**

### Carrier Layers

**Layer 1: SQLite DB (Source of Truth)**
- Tables: signals, observations, rules, claims, agents, pheromone_history
- New tables: commander_state (heartbeat count, circuit-breaker state, planning phase), halt_log (stop reasons, metrics, recommendations)
- Write method: field-*.sh scripts only
- Concurrency: WAL mode + optimistic locking

**Layer 2: Markdown (Agent Consumption + Human Readable)**
- `.birth` <- field-arrive.sh generates (<=800 tokens)
- `PLAN.md` <- field-commander.sh generates
- `HALT.md` <- circuit breaker generates
- `WIP.md` <- agent writes freely during molt
- `BLACKBOARD.md` <- project-wide status board
- Property: agents can safely read/write; format corruption does not break system

**Layer 3: YAML (Audit Export, Read-Only)**
- `signals/*.yaml` <- field scripts export from DB
- `observations/` <- field scripts export from DB
- `rules/` <- field scripts export from DB
- `metadata.yaml` <- audit package metadata
- Property: read-only snapshots; agents never write directly

**Layer 4: JSON (Runtime State, Machine-to-Machine)**
- `.pheromone` <- field-deposit.sh generates
- `commander.lock` <- Commander heartbeat lock (PID + timestamp)
- `colony.lock` <- Colony heartbeat lock
- Property: program-generated / program-consumed; agents don't touch
- Anti-corruption: atomic writes (write to .tmp then mv)

### Anti-Corruption Rules

1. **Agent write path is always field scripts**: agent wants to create signal -> calls `field-claim.sh --create`, not writing YAML directly
2. **JSON files use atomic writes**: write to .tmp, then `mv .tmp target` (all-or-nothing)
3. **YAML is read-only projection of DB**: signal lifecycle goes Commander/Agent -> field script -> SQLite DB -> YAML export
4. **MD is the only format agents can freely write**: WIP.md, code files, comments, docs

---

## 5. Commander Brain Layer: Universal Planning Pipeline

### 5.1 Task Classification (Phase 0)

Commander first classifies the input to select the appropriate pipeline:

| Type | Typical Input | Activated Phases |
|------|--------------|-----------------|
| RESEARCH | "Research top 10 new energy customers and analyze financial trends" | Research -> Audience Analysis -> Synthesis -> Signal Decompose -> Quality Gate |
| BUILD | "Build user authentication with OAuth and JWT" | Research -> User Simulation -> Architecture -> Signal Decompose -> Quality Gate |
| ANALYZE | "Analyze performance bottlenecks in the codebase" | Research -> Diagnosis -> Signal Decompose -> Quality Gate |
| HYBRID | "Research competitor recommendation algorithms and implement our own" | Research -> Synthesis -> Architecture -> Signal Decompose -> Quality Gate |

### 5.2 Pipeline Phases

**Phase 1: RESEARCH**
- Analyze host codebase (language, framework, patterns, dependencies) — for BUILD/ANALYZE
- Search web (best practices, industry reports, competitor analysis) — for RESEARCH/HYBRID
- Read colony history (past observations, rules, audit findings)
- Output: PLAN.md section "Research Findings", observations deposited via field-deposit.sh

**Phase 2: USER SIMULATION / AUDIENCE ANALYSIS**
- BUILD variant: construct user personas, key scenarios (happy path + edge cases), identify security threats
- RESEARCH variant: identify deliverable consumers (executives? analysts? sales?), determine what dimensions they care about, define deliverable format (report, PPT outline, data table)
- Output: PLAN.md section "User Scenarios" or "Audience & Deliverable Format"

**Phase 3: ARCHITECTURE / SYNTHESIS**
- BUILD variant: module decomposition, interface definition, data flow, technology selection
- RESEARCH variant: cross-entity comparison, trend identification, gap analysis
- Output: PLAN.md section "Architecture" or "Analysis & Findings"

**Phase 4: SIGNAL DECOMPOSITION**
- Decompose plan into atomic signals (1 signal = 1 verifiable deliverable)
- Set per signal: type, weight (70-90 for directive), acceptance criteria, parent_id (dependencies), child_hint (execution guidance)
- Order by dependency: independent signals can execute in parallel
- Output: directive signals written to SQLite via field-commander.sh, YAML exported as read-only snapshot

**Phase 5: QUALITY GATE**
- Define global quality standards (test coverage, lint, security scan) — for BUILD
- Define per-signal completion criteria
- Define data traceability standards — for RESEARCH
- Output: criteria encoded in PLAN.md and in .birth template

### 5.3 Extended Signal Types

Existing types: HOLE, EXPLORE, FEEDBACK, BLOCKED, PHEROMONE

New types introduced by Commander:
- **RESEARCH**: research task (search, read, data collection)
- **REPORT**: report generation task (synthesis, writing, formatting)
- **REVIEW**: quality review task (Commander self-check or human checkpoint)

### 5.4 Commander Capability Matrix

| Capability | Implementation | Output |
|-----------|---------------|--------|
| Codebase analysis | Read files / grep / glob | Architecture observations |
| Web research | Web search + fetch | Research findings in PLAN.md |
| History learning | Read audit-packages/ + rules/ | Learned patterns |
| User simulation | LLM inference (few-shot scenarios) | User scenarios + test cases |
| Architecture design | LLM reasoning + pattern matching | Module boundaries + interfaces |
| Signal decomposition | LLM task splitting + dependency ordering | Directive signals in DB |
| Quality definition | Analyze project standards + best practices | Acceptance criteria per signal |

### 5.5 PLAN.md Structure (Universal)

```markdown
# Plan: {objective summary}

## Objective
{human's original input, verbatim}

## Task Type
{RESEARCH | BUILD | ANALYZE | HYBRID}

## Audience
{who consumes the output? technical level?}

## Research Findings
{investigation results}

## User Scenarios / Audience Analysis
{varies by task type}

## Architecture / Synthesis
{BUILD: module diagram + interfaces | RESEARCH: comparative analysis}

## Signal Map
{signal list + dependency graph + parallelism estimate}

## Quality Criteria
{acceptance standards}

## Deliverable Format
{code | report | data | mixed}

## Execution Status
{runtime-updated: completion / blockages / progress}
```

---

## 6. OpenCode Adaptation Layer

### 6.1 Termite Skill for OpenCode

Placed at `.opencode/skill/termite/`, enabling OpenCode agents to work as protocol-compliant termites with zero changes to OpenCode core:

```
.opencode/skill/termite/
├── SKILL.md          # Main skill: termite behavior specification
├── arrive.md         # Sub-skill: colony arrival procedure
├── deposit.md        # Sub-skill: observation/pheromone deposit
└── molt.md           # Sub-skill: session-end handoff
```

**SKILL.md core content instructs agents to:**
1. Run `./scripts/field-arrive.sh` on arrival to get .birth
2. Read .birth for caste, available signals, behavioral template
3. Claim signals via `./scripts/field-claim.sh lock <signal_id>`
4. Execute signal tasks, commit code
5. Run `./scripts/field-cycle.sh` after each commit
6. Release signals via `./scripts/field-claim.sh release <signal_id> done`
7. Deposit observations via `./scripts/field-deposit.sh --observe`
8. Molt before session end via `./scripts/field-deposit.sh --pheromone`

### 6.2 No OpenCode Core Modifications Needed

| Need | Existing OpenCode Mechanism | Adaptation |
|------|---------------------------|-----------|
| Read .birth on start | Skill system | SKILL.md instructs agent to run field-arrive.sh |
| Signal claim/release | Bash tool | Skill instructs agent to call field-claim.sh |
| Post-commit heartbeat | Git hooks (existing) | install.sh installs prepare-commit-msg hook |
| Observation deposit | Bash tool | Skill instructs to call field-deposit.sh |
| Session-end protection | No native support | Skill explicitly instructs molt before ending |

### 6.3 Claude Code Adaptation (Existing Design Base)

The existing Claude Code hook design (2026-02-28 document) covers most needs:
- SessionStart -> field-arrive.sh
- PostToolUse(Bash) -> field-cycle.sh
- Stop -> field-deposit.sh --pheromone
- PreToolUse(Bash) -> S2 safety net (block rm *.md)

New Commander-related hooks:
- SessionStart: detect `commander.lock` exists -> agent reads PLAN.md for global context
- PostToolUse: Colony heartbeat auto-injects "claim next signal" instruction

---

## 7. Evidence-Based Optimization Loops

### Loop 1: Colony Audit -> Protocol Optimization

```
Colony execution generates data (signals/observations/rules/commits)
  -> field-export-audit.sh -> audit package
  -> Commander pulls to TermiteProtocol/audit-packages/
  -> Nurse caste analyzes -> optimization-proposals/
  -> Human approves -> protocol template updates
  -> install.sh --upgrade -> colony gets new protocol version
  -> field-arrive.sh injects upgrade context -> termites sense changes
```

### Loop 2: Termite Capability -> OpenCode Skill Upgrade

```
Audit discovers termite capability gaps
  (e.g., W-014 unsigned commits, W-013 low observation quality)
  -> Commander analyzes -> new skill needed or existing skill enhancement
  -> Generate/update .opencode/skill/termite/ content
  -> Next round of termite work auto-loads new skill
  -> Audit verifies improvement (e.g., observation quality 57% -> 96%)
```

### Loop 3: Commander Self-Learning

```
Commander completes a full task cycle
  -> Compare PLAN.md expectations vs actual execution results
    - Which signal decompositions were right-sized?
    - Were dependency predictions accurate?
    - Were quality standards reasonable?
  -> Generate Commander observation (deposited to protocol source repo)
  -> >= 3 similar observations -> emerge Commander rule
    (e.g., "RESEARCH tasks typically need 3-5 parallel signals;
           BUILD task signal dependency depth should not exceed 3")
  -> Commander future planning auto-references emerged rules
```

---

## 8. Technical Implementation

### 8.1 Technology Stack

```
Commander Engine
├── Language: TypeScript (consistent with OpenCode ecosystem)
├── LLM access: Vercel AI SDK (reuses OpenCode's multi-model support)
├── Database: Reuses Termite Protocol's SQLite (WAL mode)
├── File ops: Node.js fs (chokidar for DIRECTIVE.md watch)
├── Web research: Built-in web search + fetch
├── CLI framework: Commander.js or yargs
└── Process management: Background daemon (systemd/launchd/pm2)
```

### 8.2 Directory Structure

```
TermiteCommander/
├── TermiteProtocol/              # Existing - protocol source repo
│   ├── templates/
│   │   └── scripts/
│   │       └── field-commander.sh    # New - Commander protocol interface
│   └── ...
│
├── opencode/                     # Existing - OpenCode (no core changes)
│   └── ...
│
├── commander/                    # New - Commander Engine
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                  # CLI entry point
│   │   ├── engine/
│   │   │   ├── classifier.ts         # Phase 0: task classification
│   │   │   ├── researcher.ts         # Phase 1: research module
│   │   │   ├── simulator.ts          # Phase 2: user/audience simulation
│   │   │   ├── architect.ts          # Phase 3: architecture design (BUILD)
│   │   │   ├── synthesizer.ts        # Phase 3: synthesis analysis (RESEARCH)
│   │   │   ├── decomposer.ts         # Phase 4: signal decomposition
│   │   │   └── quality-gate.ts       # Phase 5: quality standards
│   │   │
│   │   ├── heartbeat/
│   │   │   ├── commander-loop.ts     # Commander heartbeat loop
│   │   │   ├── colony-loop.ts        # Colony heartbeat loop
│   │   │   └── circuit-breaker.ts    # Dual-layer circuit breaker
│   │   │
│   │   ├── colony/
│   │   │   ├── signal-bridge.ts      # Bridge to field-*.sh scripts
│   │   │   ├── plan-writer.ts        # PLAN.md generator
│   │   │   └── halt-writer.ts        # HALT.md generator
│   │   │
│   │   ├── input/
│   │   │   ├── cli.ts                # CLI command parsing
│   │   │   ├── repl.ts               # Interactive session
│   │   │   └── directive-watcher.ts  # DIRECTIVE.md file watch
│   │   │
│   │   └── audit/
│   │       ├── collector.ts          # Audit data collection
│   │       ├── analyzer.ts           # Audit analysis
│   │       └── upgrader.ts           # Skill/protocol upgrade suggestions
│   │
│   └── skills/                   # Termite skill templates for colonies
│       └── termite/
│           ├── SKILL.md
│           ├── arrive.md
│           ├── deposit.md
│           └── molt.md
│
└── docs/plans/                   # Design documents
```

### 8.3 field-commander.sh Interface

The sole bridge between Commander Engine and the colony:

```bash
# Batch create directive signals
field-commander.sh create-signals --plan /path/to/plan.json

# Query colony status (returns JSON)
field-commander.sh status
# -> {"total": 15, "open": 5, "claimed": 3, "done": 7, "blocked": 0}

# Update signal (adjust weight/status)
field-commander.sh update-signal --id S-005 --weight 90

# Inject heartbeat trigger (for Colony use)
field-commander.sh pulse
# -> injects "白蚁协议" trigger to active OpenCode/Claude Code sessions

# Stall check
field-commander.sh check-stall --since "30min"
# -> {"stalled": true, "last_commit": "25min ago", "signals_unchanged": 6}

# Export current plan
field-commander.sh export-plan
```

### 8.4 Commander CLI Usage

```bash
# Quick mode: one-line task
commander plan "Build user auth with OAuth and JWT"
commander plan "Research top 10 new energy customer financials"

# Interactive mode: deep planning
commander interactive

# Resume mode: continue from HALT.md
commander resume

# Watch mode: real-time colony status
commander watch

# Audit mode: trigger audit collection and analysis
commander audit --colony /path/to/host-project
```

### 8.5 Colony Heartbeat Implementation

```
colony-loop.ts pseudocode:

while (!halted) {
  // 1. Check if colony has actionable work
  status = exec("field-commander.sh status")
  if (status.open === 0 && status.claimed === 0)
    -> signal_drain_halt()

  // 2. Check for stall
  stall = exec("field-commander.sh check-stall --since 10m")
  if (stall.consecutive_stalls >= M)
    -> stall_halt()

  // 3. Inject trigger to agent platform
  if (platform === "opencode") {
    inject_to_opencode("白蚁协议")  // via stdin
  } else if (platform === "claude-code") {
    check_claude_session_alive()    // hooks auto-trigger
  }

  // 4. Wait for next cycle
  await sleep(adaptive_interval)    // 10-60s
}

Adaptive interval:
  - New commits detected -> 10s (active)
  - Claimed signals, no commits -> 30s (working)
  - Long stall -> 60s (approaching circuit break)
```

---

## 9. Key Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Weak model corrupts signal data | All structured writes through field scripts -> SQLite; agents only write MD |
| Commander and Colony both idle-spin | Dual-layer circuit breaker: signal drain (normal) + stall detection (abnormal) |
| OpenCode upstream breaks compatibility | Zero core modifications; all integration via skills + plugins |
| Commander over-decomposes signals | Quality gate + self-learning loop (emerged rules limit signal depth) |
| Heartbeat injection fails silently | Colony heartbeat checks session liveness; HALT.md records failure reason |
| Business user gives vague input | Phase 0 classification + Phase 2 audience analysis guide structured decomposition |
