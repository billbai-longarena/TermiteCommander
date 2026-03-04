# Termite Commander Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Commander orchestration engine that autonomously plans work, decomposes it into Termite Protocol signals, and drives colony execution through dual heartbeats with circuit breaking.

**Architecture:** Independent TypeScript engine communicating with the colony exclusively through `field-commander.sh` (a new protocol interface script). Two heartbeat loops (Commander + Colony) with dual-layer circuit breaker. OpenCode integration via skill files only — zero core modifications.

**Tech Stack:** TypeScript, Node.js, Vercel AI SDK, SQLite (via existing termite-db.sh), Commander.js (CLI), chokidar (file watcher)

**Reference:** `docs/plans/2026-03-04-termite-commander-design.md`

---

## Phase 1: Project Foundation + Protocol Bridge

### Task 1: Scaffold Commander TypeScript Project

**Files:**
- Create: `commander/package.json`
- Create: `commander/tsconfig.json`
- Create: `commander/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "termite-commander",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "commander": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "commander": "^12.0.0",
    "chokidar": "^4.0.0",
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.0.0",
    "vitest": "^2.0.0",
    "@types/better-sqlite3": "^7.0.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create minimal src/index.ts**

```typescript
#!/usr/bin/env node

import { program } from "commander";

program
  .name("commander")
  .description("Termite Commander — autonomous orchestration engine")
  .version("0.1.0");

program
  .command("plan <objective>")
  .description("Plan and decompose an objective into colony signals")
  .action(async (objective: string) => {
    console.log(`[commander] Received objective: ${objective}`);
    // TODO: wire to brain layer
  });

program
  .command("status")
  .description("Show colony status")
  .action(async () => {
    console.log("[commander] Status check...");
    // TODO: wire to signal-bridge
  });

program.parse();
```

**Step 4: Install dependencies and verify build**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npm install && npx tsc --noEmit`
Expected: Clean compilation, no errors

**Step 5: Verify CLI runs**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx tsx src/index.ts --help`
Expected: Help output showing `plan` and `status` commands

**Step 6: Commit**

```bash
git add commander/package.json commander/tsconfig.json commander/src/index.ts
git commit -m "feat: scaffold commander TypeScript project with CLI entry"
```

---

### Task 2: Signal Bridge — Shell Script Executor

**Files:**
- Create: `commander/src/colony/signal-bridge.ts`
- Create: `commander/src/colony/__tests__/signal-bridge.test.ts`

**Step 1: Write the failing test**

```typescript
// commander/src/colony/__tests__/signal-bridge.test.ts
import { describe, it, expect, vi } from "vitest";
import { SignalBridge } from "../signal-bridge.js";

describe("SignalBridge", () => {
  it("should detect colony root by finding scripts/ directory", async () => {
    // Use the actual TermiteProtocol templates as a test fixture
    const bridge = new SignalBridge("/Users/bingbingbai/Desktop/TermiteCommander/TermiteProtocol/templates");
    expect(bridge.colonyRoot).toBe("/Users/bingbingbai/Desktop/TermiteCommander/TermiteProtocol/templates");
    expect(bridge.hasScripts()).toBe(true);
  });

  it("should return false for hasScripts when no scripts/ directory", () => {
    const bridge = new SignalBridge("/tmp/nonexistent");
    expect(bridge.hasScripts()).toBe(false);
  });

  it("should execute a field script and return stdout", async () => {
    const bridge = new SignalBridge("/Users/bingbingbai/Desktop/TermiteCommander/TermiteProtocol/templates");
    // field-lib.sh is sourced by others, but we can test script existence
    const result = await bridge.exec("ls", ["scripts/field-arrive.sh"]);
    expect(result.stdout).toContain("field-arrive.sh");
    expect(result.exitCode).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/colony/__tests__/signal-bridge.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement SignalBridge**

```typescript
// commander/src/colony/signal-bridge.ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SignalBridge {
  readonly colonyRoot: string;
  private scriptsDir: string;

  constructor(colonyRoot: string) {
    this.colonyRoot = colonyRoot;
    this.scriptsDir = join(colonyRoot, "scripts");
  }

  hasScripts(): boolean {
    return existsSync(this.scriptsDir);
  }

  async exec(command: string, args: string[] = [], cwd?: string): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: cwd ?? this.colonyRoot,
        timeout: 30_000,
        env: { ...process.env, COLONY_ROOT: this.colonyRoot },
      });
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout?.trim() ?? "",
        stderr: err.stderr?.trim() ?? err.message,
        exitCode: err.code ?? 1,
      };
    }
  }

  async fieldScript(name: string, args: string[] = []): Promise<ExecResult> {
    const scriptPath = join(this.scriptsDir, name);
    if (!existsSync(scriptPath)) {
      return { stdout: "", stderr: `Script not found: ${name}`, exitCode: 127 };
    }
    return this.exec("bash", [scriptPath, ...args]);
  }

  async status(): Promise<ColonyStatus> {
    const result = await this.exec("bash", [
      "-c",
      `source ${join(this.scriptsDir, "termite-db.sh")} && db_init "${this.colonyRoot}" && echo "$(db_signal_count "status='open'")|$(db_signal_count "status='claimed'")|$(db_signal_count "status IN ('done','completed')")|$(db_signal_count)"`,
    ]);

    if (result.exitCode !== 0) {
      return { total: 0, open: 0, claimed: 0, done: 0, blocked: 0 };
    }

    const [open, claimed, done, total] = result.stdout.split("|").map(Number);
    return {
      total: total || 0,
      open: open || 0,
      claimed: claimed || 0,
      done: done || 0,
      blocked: 0,
    };
  }

  async createSignal(params: {
    type: string;
    title: string;
    weight: number;
    source: string;
    parentId?: string;
    childHint?: string;
    module?: string;
    nextHint?: string;
  }): Promise<ExecResult> {
    const script = `
      source ${join(this.scriptsDir, "termite-db.sh")}
      db_init "${this.colonyRoot}"
      ID=$(db_next_signal_id S)
      db_signal_create "$ID" "${params.type}" "$(db_escape "${params.title}")" "open" "${params.weight}" "14" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "commander" "${params.module || ""}" "[]" "$(db_escape "${params.nextHint || ""}")" "0" "${params.source}" "${params.parentId || ""}" "$(db_escape "${params.childHint || ""}")" "${params.parentId ? 1 : 0}"
      echo "$ID"
    `;
    return this.exec("bash", ["-c", script]);
  }

  async checkStall(sinceMinutes: number): Promise<StallStatus> {
    const script = `
      source ${join(this.scriptsDir, "termite-db.sh")}
      db_init "${this.colonyRoot}"
      LAST_COMMIT=$(git -C "${this.colonyRoot}" log -1 --format=%ct 2>/dev/null || echo 0)
      NOW=$(date +%s)
      AGE=$(( (NOW - LAST_COMMIT) / 60 ))
      OPEN=$(db_signal_count "status='open'")
      CLAIMED=$(db_signal_count "status='claimed'")
      echo "$AGE|$OPEN|$CLAIMED"
    `;
    const result = await this.exec("bash", ["-c", script]);
    if (result.exitCode !== 0) {
      return { stalled: false, lastCommitMinutesAgo: 0, openSignals: 0, claimedSignals: 0 };
    }
    const [age, open, claimed] = result.stdout.split("|").map(Number);
    return {
      stalled: age > sinceMinutes,
      lastCommitMinutesAgo: age || 0,
      openSignals: open || 0,
      claimedSignals: claimed || 0,
    };
  }
}

export interface ColonyStatus {
  total: number;
  open: number;
  claimed: number;
  done: number;
  blocked: number;
}

export interface StallStatus {
  stalled: boolean;
  lastCommitMinutesAgo: number;
  openSignals: number;
  claimedSignals: number;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/colony/__tests__/signal-bridge.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add commander/src/colony/signal-bridge.ts commander/src/colony/__tests__/signal-bridge.test.ts
git commit -m "feat: add SignalBridge for colony communication via field scripts"
```

---

### Task 3: field-commander.sh Protocol Interface Script

**Files:**
- Create: `TermiteProtocol/templates/scripts/field-commander.sh`

**Step 1: Write field-commander.sh**

```bash
#!/usr/bin/env bash
# field-commander.sh — Commander ↔ Colony bridge
# Usage:
#   field-commander.sh status                          → JSON colony status
#   field-commander.sh create-signal <json>            → create directive signal
#   field-commander.sh create-signals --plan <file>    → batch create from plan
#   field-commander.sh update-signal --id <id> --field <f> --value <v>
#   field-commander.sh check-stall --since <minutes>   → JSON stall status
#   field-commander.sh pulse                           → heartbeat trigger

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/field-lib.sh" 2>/dev/null || true
source "${SCRIPT_DIR}/termite-db.sh"

COLONY_ROOT="${COLONY_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
db_init "${COLONY_ROOT}"

cmd_status() {
  local total open claimed done blocked
  total=$(db_signal_count)
  open=$(db_signal_count "status='open'")
  claimed=$(db_signal_count "status='claimed'")
  done=$(db_signal_count "status IN ('done','completed')")
  blocked=$(db_signal_count "status='open' AND id IN (SELECT signal_id FROM claims WHERE operation='work')")
  cat <<EOF
{"total":${total},"open":${open},"claimed":${claimed},"done":${done},"blocked":${blocked}}
EOF
}

cmd_create_signal() {
  local json="$1"
  local type title weight source parent_id child_hint module next_hint
  # Parse JSON using simple extraction (no jq dependency)
  type=$(echo "$json" | grep -o '"type":"[^"]*"' | cut -d'"' -f4)
  title=$(echo "$json" | grep -o '"title":"[^"]*"' | cut -d'"' -f4)
  weight=$(echo "$json" | grep -o '"weight":[0-9]*' | cut -d: -f2)
  source=$(echo "$json" | grep -o '"source":"[^"]*"' | cut -d'"' -f4)
  parent_id=$(echo "$json" | grep -o '"parent_id":"[^"]*"' | cut -d'"' -f4)
  child_hint=$(echo "$json" | grep -o '"child_hint":"[^"]*"' | cut -d'"' -f4)
  module=$(echo "$json" | grep -o '"module":"[^"]*"' | cut -d'"' -f4)
  next_hint=$(echo "$json" | grep -o '"next_hint":"[^"]*"' | cut -d'"' -f4)

  type="${type:-HOLE}"
  weight="${weight:-80}"
  source="${source:-directive}"
  local depth=0
  [ -n "$parent_id" ] && depth=1

  local id
  id=$(db_next_signal_id S)
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  db_signal_create "$id" "$type" "$(db_escape "$title")" "open" "$weight" "14" \
    "$now" "$now" "commander" "${module:-}" "[]" "$(db_escape "${next_hint:-}")" \
    "0" "$source" "${parent_id:-}" "$(db_escape "${child_hint:-}")" "$depth"

  echo "{\"id\":\"$id\",\"status\":\"created\"}"
}

cmd_create_signals() {
  local plan_file="$1"
  if [ ! -f "$plan_file" ]; then
    echo '{"error":"plan file not found"}' >&2
    exit 1
  fi
  # Expect plan_file to be a JSON array of signal objects
  # Process line by line (one JSON object per line)
  local count=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    cmd_create_signal "$line"
    count=$((count + 1))
  done < "$plan_file"
  echo "{\"created\":${count}}"
}

cmd_update_signal() {
  local id="" field="" value=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) id="$2"; shift 2 ;;
      --field) field="$2"; shift 2 ;;
      --value) value="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  if [ -z "$id" ] || [ -z "$field" ] || [ -z "$value" ]; then
    echo '{"error":"missing --id, --field, or --value"}' >&2
    exit 1
  fi
  db_signal_update "$id" "$field" "$(db_escape "$value")"
  echo "{\"id\":\"$id\",\"updated\":\"$field\"}"
}

cmd_check_stall() {
  local since_minutes="${1:-30}"
  local last_commit_ts now age_minutes open claimed
  last_commit_ts=$(git -C "${COLONY_ROOT}" log -1 --format=%ct 2>/dev/null || echo 0)
  now=$(date +%s)
  age_minutes=$(( (now - last_commit_ts) / 60 ))
  open=$(db_signal_count "status='open'")
  claimed=$(db_signal_count "status='claimed'")

  local stalled="false"
  [ "$age_minutes" -gt "$since_minutes" ] && stalled="true"

  cat <<EOF
{"stalled":${stalled},"last_commit_minutes_ago":${age_minutes},"open_signals":${open},"claimed_signals":${claimed}}
EOF
}

cmd_pulse() {
  # Write a pulse marker that colony heartbeat can detect
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "$now" > "${COLONY_ROOT}/.commander-pulse"
  echo "{\"pulsed_at\":\"$now\"}"
}

# --- Main dispatch ---
case "${1:-}" in
  status)           cmd_status ;;
  create-signal)    cmd_create_signal "${2:-{}}" ;;
  create-signals)
    shift
    local plan_file=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --plan) plan_file="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    cmd_create_signals "$plan_file"
    ;;
  update-signal)    shift; cmd_update_signal "$@" ;;
  check-stall)
    shift
    local since="30"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --since) since="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    cmd_check_stall "$since"
    ;;
  pulse)            cmd_pulse ;;
  *)
    echo "Usage: field-commander.sh {status|create-signal|create-signals|update-signal|check-stall|pulse}" >&2
    exit 1
    ;;
esac
```

**Step 2: Make executable and verify syntax**

Run: `chmod +x /Users/bingbingbai/Desktop/TermiteCommander/TermiteProtocol/templates/scripts/field-commander.sh && bash -n /Users/bingbingbai/Desktop/TermiteCommander/TermiteProtocol/templates/scripts/field-commander.sh`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add TermiteProtocol/templates/scripts/field-commander.sh
git commit -m "feat: add field-commander.sh protocol interface script"
```

---

### Task 4: PLAN.md Writer

**Files:**
- Create: `commander/src/colony/plan-writer.ts`
- Create: `commander/src/colony/__tests__/plan-writer.test.ts`

**Step 1: Write the failing test**

```typescript
// commander/src/colony/__tests__/plan-writer.test.ts
import { describe, it, expect } from "vitest";
import { PlanWriter, type Plan } from "../plan-writer.js";

describe("PlanWriter", () => {
  it("should generate valid PLAN.md content from a plan object", () => {
    const plan: Plan = {
      objective: "调研新能源行业前十大客户的财报趋势",
      taskType: "RESEARCH",
      audience: "Business analyst, non-technical",
      researchFindings: "Found 10 companies with public financials...",
      userScenarios: "Analyst needs comparative dashboard...",
      architecture: null,
      synthesis: "Three key trends identified: 1) ...",
      signals: [
        { id: "S-001", type: "RESEARCH", title: "Collect Top 10 company data", weight: 80, parentId: null, status: "open" },
        { id: "S-002", type: "RESEARCH", title: "Cross-company comparison", weight: 75, parentId: "S-001", status: "open" },
      ],
      qualityCriteria: "Each finding must cite data source",
      deliverableFormat: "Markdown report",
    };

    const md = PlanWriter.render(plan);

    expect(md).toContain("# Plan:");
    expect(md).toContain("调研新能源行业");
    expect(md).toContain("## Task Type");
    expect(md).toContain("RESEARCH");
    expect(md).toContain("## Signal Map");
    expect(md).toContain("S-001");
    expect(md).toContain("S-002");
    expect(md).toContain("## Quality Criteria");
  });

  it("should include architecture section for BUILD tasks", () => {
    const plan: Plan = {
      objective: "Build user auth with OAuth",
      taskType: "BUILD",
      audience: "Developer",
      researchFindings: "OAuth 2.0 + JWT recommended",
      userScenarios: "User clicks login, redirected to OAuth...",
      architecture: "Three modules: auth-handler, token-store, middleware",
      synthesis: null,
      signals: [],
      qualityCriteria: "All endpoints tested, no security vulns",
      deliverableFormat: "Code + tests",
    };

    const md = PlanWriter.render(plan);
    expect(md).toContain("## Architecture");
    expect(md).toContain("Three modules");
    expect(md).not.toContain("## Synthesis");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/colony/__tests__/plan-writer.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement PlanWriter**

```typescript
// commander/src/colony/plan-writer.ts

export interface SignalEntry {
  id: string;
  type: string;
  title: string;
  weight: number;
  parentId: string | null;
  status: string;
}

export interface Plan {
  objective: string;
  taskType: "RESEARCH" | "BUILD" | "ANALYZE" | "HYBRID";
  audience: string;
  researchFindings: string;
  userScenarios: string;
  architecture: string | null;
  synthesis: string | null;
  signals: SignalEntry[];
  qualityCriteria: string;
  deliverableFormat: string;
}

export class PlanWriter {
  static render(plan: Plan): string {
    const sections: string[] = [];

    sections.push(`# Plan: ${plan.objective.slice(0, 80)}\n`);
    sections.push(`## Objective\n\n${plan.objective}\n`);
    sections.push(`## Task Type\n\n${plan.taskType}\n`);
    sections.push(`## Audience\n\n${plan.audience}\n`);
    sections.push(`## Research Findings\n\n${plan.researchFindings}\n`);

    sections.push(`## User Scenarios\n\n${plan.userScenarios}\n`);

    if (plan.architecture) {
      sections.push(`## Architecture\n\n${plan.architecture}\n`);
    }
    if (plan.synthesis) {
      sections.push(`## Synthesis\n\n${plan.synthesis}\n`);
    }

    sections.push(this.renderSignalMap(plan.signals));
    sections.push(`## Quality Criteria\n\n${plan.qualityCriteria}\n`);
    sections.push(`## Deliverable Format\n\n${plan.deliverableFormat}\n`);
    sections.push(`## Execution Status\n\n_Pending — signals not yet dispatched._\n`);

    return sections.join("\n");
  }

  private static renderSignalMap(signals: SignalEntry[]): string {
    if (signals.length === 0) {
      return "## Signal Map\n\n_No signals generated yet._\n";
    }

    const lines = ["## Signal Map\n"];
    const roots = signals.filter((s) => !s.parentId);
    const children = signals.filter((s) => s.parentId);

    for (const root of roots) {
      lines.push(`- **${root.id}** [${root.type}] ${root.title} (weight: ${root.weight}, status: ${root.status})`);
      for (const child of children.filter((c) => c.parentId === root.id)) {
        lines.push(`  - **${child.id}** [${child.type}] ${child.title} (weight: ${child.weight}, status: ${child.status})`);
      }
    }
    lines.push("");
    return lines.join("\n");
  }

  static async writeToDisk(plan: Plan, colonyRoot: string): Promise<string> {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const content = this.render(plan);
    const path = join(colonyRoot, "PLAN.md");
    await writeFile(path, content, "utf-8");
    return path;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/colony/__tests__/plan-writer.test.ts`
Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add commander/src/colony/plan-writer.ts commander/src/colony/__tests__/plan-writer.test.ts
git commit -m "feat: add PlanWriter for generating PLAN.md from plan objects"
```

---

### Task 5: HALT.md Writer

**Files:**
- Create: `commander/src/colony/halt-writer.ts`
- Create: `commander/src/colony/__tests__/halt-writer.test.ts`

**Step 1: Write the failing test**

```typescript
// commander/src/colony/__tests__/halt-writer.test.ts
import { describe, it, expect } from "vitest";
import { HaltWriter, type HaltInfo } from "../halt-writer.js";

describe("HaltWriter", () => {
  it("should generate HALT.md for normal completion", () => {
    const info: HaltInfo = {
      reason: "complete",
      commanderCycles: 47,
      colonyCycles: 230,
      signalsTotal: 15,
      signalsCompleted: 15,
      remainingSignals: [],
      lastCommitHash: "abc1234",
      lastCommitAge: "2 min ago",
      lastSignalChange: "S-015 -> done (5 min ago)",
      recommendation: "All work completed successfully.",
    };
    const md = HaltWriter.render(info);
    expect(md).toContain("# Colony Halted");
    expect(md).toContain("**Reason**: complete");
    expect(md).toContain("Completed: 15");
    expect(md).toContain("commander resume");
  });

  it("should generate HALT.md for stall with remaining signals", () => {
    const info: HaltInfo = {
      reason: "stall",
      commanderCycles: 20,
      colonyCycles: 80,
      signalsTotal: 10,
      signalsCompleted: 7,
      remainingSignals: ["S-008", "S-009", "S-010"],
      lastCommitHash: "def5678",
      lastCommitAge: "25 min ago",
      lastSignalChange: "S-007 -> done (30 min ago)",
      recommendation: "S-008 may be blocked. Check signal dependencies.",
    };
    const md = HaltWriter.render(info);
    expect(md).toContain("**Reason**: stall");
    expect(md).toContain("S-008, S-009, S-010");
    expect(md).toContain("25 min ago");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/colony/__tests__/halt-writer.test.ts`
Expected: FAIL

**Step 3: Implement HaltWriter**

```typescript
// commander/src/colony/halt-writer.ts

export interface HaltInfo {
  reason: "complete" | "stall" | "commander_stall" | "colony_stall";
  commanderCycles: number;
  colonyCycles: number;
  signalsTotal: number;
  signalsCompleted: number;
  remainingSignals: string[];
  lastCommitHash: string;
  lastCommitAge: string;
  lastSignalChange: string;
  recommendation: string;
}

export class HaltWriter {
  static render(info: HaltInfo): string {
    const now = new Date().toISOString();
    const remaining =
      info.remainingSignals.length > 0
        ? info.remainingSignals.join(", ")
        : "None";

    return `# Colony Halted

- **Time**: ${now}
- **Reason**: ${info.reason}
- **Commander cycles**: ${info.commanderCycles}
- **Colony cycles**: ${info.colonyCycles}

## Signal Summary
- Total: ${info.signalsTotal}
- Completed: ${info.signalsCompleted}
- Remaining open: ${remaining}

## Last Progress
- Last commit: ${info.lastCommitHash} (${info.lastCommitAge})
- Last signal state change: ${info.lastSignalChange}

## Recommendation
${info.recommendation}

## To Resume
Edit DIRECTIVE.md with new instructions, or run:
\`\`\`
commander resume
\`\`\`
`;
  }

  static async writeToDisk(info: HaltInfo, colonyRoot: string): Promise<string> {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const content = this.render(info);
    const path = join(colonyRoot, "HALT.md");
    await writeFile(path, content, "utf-8");
    return path;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/colony/__tests__/halt-writer.test.ts`
Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add commander/src/colony/halt-writer.ts commander/src/colony/__tests__/halt-writer.test.ts
git commit -m "feat: add HaltWriter for generating HALT.md on circuit break"
```

---

## Phase 2: Brain Layer — Task Classification + Signal Decomposition

### Task 6: Task Classifier

**Files:**
- Create: `commander/src/engine/classifier.ts`
- Create: `commander/src/engine/__tests__/classifier.test.ts`

**Step 1: Write the failing test**

```typescript
// commander/src/engine/__tests__/classifier.test.ts
import { describe, it, expect } from "vitest";
import { TaskClassifier, type TaskType } from "../classifier.js";

describe("TaskClassifier", () => {
  it("should classify research-oriented input as RESEARCH", () => {
    expect(TaskClassifier.classify("调研新能源行业前十大客户的财报趋势")).toBe("RESEARCH");
    expect(TaskClassifier.classify("Research top 10 competitors in the market")).toBe("RESEARCH");
  });

  it("should classify build-oriented input as BUILD", () => {
    expect(TaskClassifier.classify("构建用户认证系统，支持 OAuth 和 JWT")).toBe("BUILD");
    expect(TaskClassifier.classify("Build a REST API for user management")).toBe("BUILD");
  });

  it("should classify analysis input as ANALYZE", () => {
    expect(TaskClassifier.classify("分析现有代码库的性能瓶颈")).toBe("ANALYZE");
    expect(TaskClassifier.classify("Analyze the database query performance")).toBe("ANALYZE");
  });

  it("should classify mixed input as HYBRID", () => {
    expect(TaskClassifier.classify("调研竞品的推荐算法并实现我们的版本")).toBe("HYBRID");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/engine/__tests__/classifier.test.ts`
Expected: FAIL

**Step 3: Implement TaskClassifier (heuristic first, LLM upgrade later)**

```typescript
// commander/src/engine/classifier.ts

export type TaskType = "RESEARCH" | "BUILD" | "ANALYZE" | "HYBRID";

const RESEARCH_PATTERNS = [
  /调研|研究|分析.*报|搜索|market.*research|investigate|survey|trend|财报|report/i,
  /research|study|explore.*industry|competitor|benchmark/i,
];

const BUILD_PATTERNS = [
  /构建|开发|实现|创建|添加|build|create|implement|develop|add.*feature/i,
  /REST.*API|frontend|backend|service|module|component/i,
];

const ANALYZE_PATTERNS = [
  /分析.*代码|分析.*性能|诊断|审计|profile|analyze.*code|debug|bottleneck/i,
  /performance.*analysis|code.*review|assess/i,
];

export class TaskClassifier {
  static classify(input: string): TaskType {
    const hasResearch = RESEARCH_PATTERNS.some((p) => p.test(input));
    const hasBuild = BUILD_PATTERNS.some((p) => p.test(input));
    const hasAnalyze = ANALYZE_PATTERNS.some((p) => p.test(input));

    if (hasResearch && hasBuild) return "HYBRID";
    if (hasResearch && hasAnalyze) return "HYBRID";
    if (hasResearch) return "RESEARCH";
    if (hasBuild) return "BUILD";
    if (hasAnalyze) return "ANALYZE";

    // Default: if mentions code/tech terms -> BUILD, else RESEARCH
    if (/code|api|function|class|test|deploy|database/i.test(input)) return "BUILD";
    return "RESEARCH";
  }

  /**
   * LLM-based classification for ambiguous inputs.
   * Falls back to heuristic if LLM unavailable.
   */
  static async classifyWithLLM(
    input: string,
    generateText: (prompt: string) => Promise<string>,
  ): Promise<TaskType> {
    const prompt = `Classify this task into exactly one category. Reply with ONLY the category name.

Categories:
- RESEARCH: information gathering, market research, data analysis, report writing
- BUILD: software development, creating features, building systems
- ANALYZE: diagnosing existing systems, performance analysis, code review
- HYBRID: tasks that combine research/analysis with building

Task: "${input}"

Category:`;

    try {
      const result = await generateText(prompt);
      const cleaned = result.trim().toUpperCase() as TaskType;
      if (["RESEARCH", "BUILD", "ANALYZE", "HYBRID"].includes(cleaned)) {
        return cleaned;
      }
    } catch {
      // Fall through to heuristic
    }
    return this.classify(input);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/engine/__tests__/classifier.test.ts`
Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add commander/src/engine/classifier.ts commander/src/engine/__tests__/classifier.test.ts
git commit -m "feat: add TaskClassifier with heuristic + LLM classification"
```

---

### Task 7: Signal Decomposer

**Files:**
- Create: `commander/src/engine/decomposer.ts`
- Create: `commander/src/engine/__tests__/decomposer.test.ts`

**Step 1: Write the failing test**

```typescript
// commander/src/engine/__tests__/decomposer.test.ts
import { describe, it, expect } from "vitest";
import { SignalDecomposer, type DecomposedSignal } from "../decomposer.js";

describe("SignalDecomposer", () => {
  it("should validate signal structure", () => {
    const signal: DecomposedSignal = {
      type: "HOLE",
      title: "Implement JWT token validation",
      weight: 80,
      source: "directive",
      parentId: null,
      childHint: null,
      module: "src/auth/",
      nextHint: "Create middleware that validates JWT tokens on every request",
      acceptanceCriteria: "Token validation middleware passes all test cases",
    };
    expect(SignalDecomposer.validate(signal)).toBe(true);
  });

  it("should reject signals with empty title", () => {
    const signal: DecomposedSignal = {
      type: "HOLE",
      title: "",
      weight: 80,
      source: "directive",
      parentId: null,
      childHint: null,
      module: "",
      nextHint: "",
      acceptanceCriteria: "",
    };
    expect(SignalDecomposer.validate(signal)).toBe(false);
  });

  it("should enforce max depth of 3", () => {
    const signals: DecomposedSignal[] = [
      { type: "HOLE", title: "Root", weight: 80, source: "directive", parentId: null, childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
      { type: "HOLE", title: "Child", weight: 75, source: "directive", parentId: "S-001", childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
      { type: "HOLE", title: "Grandchild", weight: 70, source: "directive", parentId: "S-002", childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
      { type: "HOLE", title: "Too deep", weight: 65, source: "directive", parentId: "S-003", childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
    ];
    const { valid, errors } = SignalDecomposer.validateTree(signals);
    expect(valid).toBe(false);
    expect(errors).toContain("Signal depth exceeds maximum of 3: Too deep");
  });

  it("should build dependency-ordered signal list", () => {
    const signals: DecomposedSignal[] = [
      { type: "HOLE", title: "B depends on A", weight: 70, source: "directive", parentId: "root", childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
      { type: "HOLE", title: "A is root", weight: 80, source: "directive", parentId: null, childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
    ];
    const ordered = SignalDecomposer.topologicalSort(signals);
    expect(ordered[0].title).toBe("A is root");
    expect(ordered[1].title).toBe("B depends on A");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/engine/__tests__/decomposer.test.ts`
Expected: FAIL

**Step 3: Implement SignalDecomposer**

```typescript
// commander/src/engine/decomposer.ts

export interface DecomposedSignal {
  type: "HOLE" | "EXPLORE" | "RESEARCH" | "REPORT" | "REVIEW" | "FEEDBACK";
  title: string;
  weight: number;
  source: "directive" | "autonomous";
  parentId: string | null;
  childHint: string | null;
  module: string;
  nextHint: string;
  acceptanceCriteria: string;
}

const MAX_DEPTH = 3;

export class SignalDecomposer {
  static validate(signal: DecomposedSignal): boolean {
    if (!signal.title || signal.title.trim().length === 0) return false;
    if (signal.weight < 0 || signal.weight > 100) return false;
    return true;
  }

  static validateTree(signals: DecomposedSignal[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Assign temporary IDs for depth calculation
    const idMap = new Map<string, DecomposedSignal>();
    signals.forEach((s, i) => idMap.set(`S-${String(i + 1).padStart(3, "0")}`, s));

    // Check depth
    for (const [id, signal] of idMap) {
      let depth = 0;
      let current: DecomposedSignal | undefined = signal;
      const visited = new Set<string>();

      while (current?.parentId) {
        if (visited.has(current.parentId)) {
          errors.push(`Circular dependency detected at: ${signal.title}`);
          break;
        }
        visited.add(current.parentId);
        depth++;
        // Find parent by matching temp IDs or explicit parentId
        current = [...idMap.values()].find((s) =>
          s !== current && s.title === [...idMap.entries()].find(([k]) => k === current!.parentId)?.[1]?.title,
        );
        if (!current) break;
      }

      if (depth >= MAX_DEPTH) {
        errors.push(`Signal depth exceeds maximum of ${MAX_DEPTH}: ${signal.title}`);
      }
    }

    // Validate each signal
    for (const signal of signals) {
      if (!this.validate(signal)) {
        errors.push(`Invalid signal: ${signal.title || "(empty title)"}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static topologicalSort(signals: DecomposedSignal[]): DecomposedSignal[] {
    // Roots first (no parentId), then children in order
    const roots = signals.filter((s) => !s.parentId);
    const children = signals.filter((s) => s.parentId);
    return [...roots, ...children];
  }

  /**
   * LLM-based decomposition. Takes objective + research findings,
   * returns structured signal list.
   */
  static buildDecompositionPrompt(
    objective: string,
    taskType: string,
    researchFindings: string,
  ): string {
    return `You are a software architect decomposing a task into atomic work signals.

Task Type: ${taskType}
Objective: ${objective}

Research Context:
${researchFindings}

Decompose this into a list of atomic signals. Each signal should be ONE verifiable deliverable.

Rules:
- Signal types: HOLE (code gap), EXPLORE (investigation), RESEARCH (data collection), REPORT (writing), REVIEW (quality check)
- Weight: 70-90 for directive signals (higher = more urgent)
- Max tree depth: 3
- Independent signals should have parentId: null (they can run in parallel)
- Dependent signals should reference their parent's title
- Each signal MUST have clear acceptance criteria

Output as JSON array:
[
  {
    "type": "HOLE",
    "title": "Brief, specific description",
    "weight": 80,
    "parentId": null,
    "module": "relevant/path/",
    "nextHint": "Specific next action for the termite",
    "acceptanceCriteria": "How to verify this is done"
  }
]

Respond with ONLY the JSON array, no other text.`;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/engine/__tests__/decomposer.test.ts`
Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add commander/src/engine/decomposer.ts commander/src/engine/__tests__/decomposer.test.ts
git commit -m "feat: add SignalDecomposer with validation, depth checking, and sort"
```

---

## Phase 3: Heartbeat Engine

### Task 8: Circuit Breaker

**Files:**
- Create: `commander/src/heartbeat/circuit-breaker.ts`
- Create: `commander/src/heartbeat/__tests__/circuit-breaker.test.ts`

**Step 1: Write the failing test**

```typescript
// commander/src/heartbeat/__tests__/circuit-breaker.test.ts
import { describe, it, expect } from "vitest";
import { CircuitBreaker, type CycleSnapshot } from "../circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("should not trip on first cycle", () => {
    const cb = new CircuitBreaker({ stallThreshold: 3 });
    const snap: CycleSnapshot = { openSignals: 5, claimedSignals: 2, newCommits: 1, signalChanges: 1 };
    expect(cb.evaluate(snap)).toEqual({ halt: false, reason: null });
  });

  it("should trip on signal drain (all done)", () => {
    const cb = new CircuitBreaker({ stallThreshold: 3 });
    const snap: CycleSnapshot = { openSignals: 0, claimedSignals: 0, newCommits: 0, signalChanges: 0 };
    expect(cb.evaluate(snap)).toEqual({ halt: true, reason: "complete" });
  });

  it("should trip after N consecutive stall cycles", () => {
    const cb = new CircuitBreaker({ stallThreshold: 3 });
    const stall: CycleSnapshot = { openSignals: 3, claimedSignals: 1, newCommits: 0, signalChanges: 0 };

    expect(cb.evaluate(stall).halt).toBe(false); // 1st stall
    expect(cb.evaluate(stall).halt).toBe(false); // 2nd stall
    expect(cb.evaluate(stall).halt).toBe(true);  // 3rd stall → trip
    expect(cb.evaluate(stall).reason).toBe("stall");
  });

  it("should reset stall counter on progress", () => {
    const cb = new CircuitBreaker({ stallThreshold: 3 });
    const stall: CycleSnapshot = { openSignals: 3, claimedSignals: 1, newCommits: 0, signalChanges: 0 };
    const progress: CycleSnapshot = { openSignals: 2, claimedSignals: 1, newCommits: 1, signalChanges: 1 };

    cb.evaluate(stall); // 1st stall
    cb.evaluate(stall); // 2nd stall
    cb.evaluate(progress); // progress → reset
    expect(cb.evaluate(stall).halt).toBe(false); // 1st stall again (not 3rd)
  });

  it("should track total cycles", () => {
    const cb = new CircuitBreaker({ stallThreshold: 3 });
    const snap: CycleSnapshot = { openSignals: 5, claimedSignals: 2, newCommits: 1, signalChanges: 1 };
    cb.evaluate(snap);
    cb.evaluate(snap);
    cb.evaluate(snap);
    expect(cb.totalCycles).toBe(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/heartbeat/__tests__/circuit-breaker.test.ts`
Expected: FAIL

**Step 3: Implement CircuitBreaker**

```typescript
// commander/src/heartbeat/circuit-breaker.ts

export interface CycleSnapshot {
  openSignals: number;
  claimedSignals: number;
  newCommits: number;
  signalChanges: number;
}

export interface CircuitBreakerConfig {
  stallThreshold: number; // consecutive stall cycles before trip
}

export interface CircuitBreakerResult {
  halt: boolean;
  reason: "complete" | "stall" | null;
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private consecutiveStalls: number = 0;
  private _totalCycles: number = 0;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  get totalCycles(): number {
    return this._totalCycles;
  }

  evaluate(snapshot: CycleSnapshot): CircuitBreakerResult {
    this._totalCycles++;

    // Layer 1: Signal drain — all signals completed
    if (snapshot.openSignals === 0 && snapshot.claimedSignals === 0) {
      return { halt: true, reason: "complete" };
    }

    // Layer 2: Stall detection — no progress for N cycles
    const hasProgress = snapshot.newCommits > 0 || snapshot.signalChanges > 0;

    if (hasProgress) {
      this.consecutiveStalls = 0;
      return { halt: false, reason: null };
    }

    this.consecutiveStalls++;

    if (this.consecutiveStalls >= this.config.stallThreshold) {
      return { halt: true, reason: "stall" };
    }

    return { halt: false, reason: null };
  }

  reset(): void {
    this.consecutiveStalls = 0;
    this._totalCycles = 0;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx vitest run src/heartbeat/__tests__/circuit-breaker.test.ts`
Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add commander/src/heartbeat/circuit-breaker.ts commander/src/heartbeat/__tests__/circuit-breaker.test.ts
git commit -m "feat: add dual-layer CircuitBreaker with signal drain + stall detection"
```

---

### Task 9: Commander Heartbeat Loop

**Files:**
- Create: `commander/src/heartbeat/commander-loop.ts`

**Step 1: Implement CommanderLoop**

```typescript
// commander/src/heartbeat/commander-loop.ts

import { SignalBridge } from "../colony/signal-bridge.js";
import { CircuitBreaker, type CycleSnapshot } from "./circuit-breaker.js";
import { HaltWriter, type HaltInfo } from "../colony/halt-writer.js";

export interface CommanderLoopConfig {
  colonyRoot: string;
  intervalMs: number;        // base interval (30000-120000)
  stallThreshold: number;    // cycles before stall circuit break
  onCycle?: (snapshot: CycleSnapshot) => void;
  onHalt?: (info: HaltInfo) => void;
}

export class CommanderLoop {
  private bridge: SignalBridge;
  private breaker: CircuitBreaker;
  private config: CommanderLoopConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastSignalSnapshot: string = "";

  constructor(config: CommanderLoopConfig) {
    this.config = config;
    this.bridge = new SignalBridge(config.colonyRoot);
    this.breaker = new CircuitBreaker({ stallThreshold: config.stallThreshold });
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[commander-heartbeat] Started. Interval: ${this.config.intervalMs}ms`);
    await this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[commander-heartbeat] Stopped.");
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      // 1. Sense colony status
      const status = await this.bridge.status();
      const currentSnapshot = JSON.stringify(status);
      const signalChanges = currentSnapshot !== this.lastSignalSnapshot ? 1 : 0;
      this.lastSignalSnapshot = currentSnapshot;

      // 2. Check for new commits
      const stall = await this.bridge.checkStall(1); // 1 minute window
      const newCommits = stall.stalled ? 0 : 1;

      // 3. Evaluate circuit breaker
      const snapshot: CycleSnapshot = {
        openSignals: status.open,
        claimedSignals: status.claimed,
        newCommits,
        signalChanges,
      };

      this.config.onCycle?.(snapshot);

      const result = this.breaker.evaluate(snapshot);

      if (result.halt) {
        const haltInfo: HaltInfo = {
          reason: result.reason === "complete" ? "complete" : "stall",
          commanderCycles: this.breaker.totalCycles,
          colonyCycles: 0, // Colony tracks its own
          signalsTotal: status.total,
          signalsCompleted: status.done,
          remainingSignals: [], // Would need to query specific IDs
          lastCommitHash: "unknown",
          lastCommitAge: `${stall.lastCommitMinutesAgo} min ago`,
          lastSignalChange: "see colony logs",
          recommendation: result.reason === "complete"
            ? "All directive signals completed successfully."
            : `No progress for ${this.config.stallThreshold} cycles. Check for blocked signals.`,
        };

        await HaltWriter.writeToDisk(haltInfo, this.config.colonyRoot);
        this.config.onHalt?.(haltInfo);
        this.stop();
        return;
      }
    } catch (err) {
      console.error("[commander-heartbeat] Cycle error:", err);
    }

    // Schedule next tick
    this.timer = setTimeout(() => this.tick(), this.config.intervalMs);
  }
}
```

**Step 2: Commit**

```bash
git add commander/src/heartbeat/commander-loop.ts
git commit -m "feat: add CommanderLoop with periodic sensing + circuit breaker integration"
```

---

### Task 10: Colony Heartbeat Loop

**Files:**
- Create: `commander/src/heartbeat/colony-loop.ts`

**Step 1: Implement ColonyLoop**

```typescript
// commander/src/heartbeat/colony-loop.ts

import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { SignalBridge } from "../colony/signal-bridge.js";
import { CircuitBreaker, type CycleSnapshot } from "./circuit-breaker.js";

const execFileAsync = promisify(execFile);

export type Platform = "opencode" | "claude-code" | "unknown";

export interface ColonyLoopConfig {
  colonyRoot: string;
  platform: Platform;
  baseIntervalMs: number;     // starting interval (10000)
  maxIntervalMs: number;      // max interval when idle (60000)
  stallThreshold: number;     // cycles before circuit break
  onCycle?: (snapshot: CycleSnapshot, intervalMs: number) => void;
  onHalt?: (reason: string) => void;
}

export class ColonyLoop {
  private bridge: SignalBridge;
  private breaker: CircuitBreaker;
  private config: ColonyLoopConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private currentInterval: number;
  private lastCommitHash: string = "";

  constructor(config: ColonyLoopConfig) {
    this.config = config;
    this.bridge = new SignalBridge(config.colonyRoot);
    this.breaker = new CircuitBreaker({ stallThreshold: config.stallThreshold });
    this.currentInterval = config.baseIntervalMs;
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[colony-heartbeat] Started. Platform: ${this.config.platform}. Interval: ${this.currentInterval}ms`);
    await this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[colony-heartbeat] Stopped.");
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      // 1. Check colony status
      const status = await this.bridge.status();

      // 2. Signal drain check
      if (status.open === 0 && status.claimed === 0) {
        console.log("[colony-heartbeat] Signal drain — no work remaining.");
        this.config.onHalt?.("signal_drain");
        this.stop();
        return;
      }

      // 3. Check for new commits (progress detection)
      const commitResult = await this.bridge.exec("git", [
        "-C", this.config.colonyRoot, "log", "-1", "--format=%H",
      ]);
      const currentHash = commitResult.stdout.trim();
      const hasNewCommit = currentHash !== this.lastCommitHash && this.lastCommitHash !== "";
      this.lastCommitHash = currentHash;

      // 4. Build snapshot and evaluate circuit breaker
      const snapshot: CycleSnapshot = {
        openSignals: status.open,
        claimedSignals: status.claimed,
        newCommits: hasNewCommit ? 1 : 0,
        signalChanges: 0, // Simplified; could compare with previous status
      };

      const result = this.breaker.evaluate(snapshot);
      this.config.onCycle?.(snapshot, this.currentInterval);

      if (result.halt && result.reason === "stall") {
        console.log("[colony-heartbeat] Stall detected — circuit break.");
        this.config.onHalt?.("stall");
        this.stop();
        return;
      }

      // 5. Adaptive interval
      if (hasNewCommit) {
        this.currentInterval = this.config.baseIntervalMs; // Active → fast
      } else if (status.claimed > 0) {
        this.currentInterval = Math.min(this.currentInterval * 1.2, this.config.maxIntervalMs * 0.5);
      } else {
        this.currentInterval = Math.min(this.currentInterval * 1.5, this.config.maxIntervalMs);
      }

      // 6. Inject heartbeat trigger
      await this.injectHeartbeat();

    } catch (err) {
      console.error("[colony-heartbeat] Cycle error:", err);
    }

    // Schedule next tick
    this.timer = setTimeout(() => this.tick(), Math.round(this.currentInterval));
  }

  private async injectHeartbeat(): Promise<void> {
    // Write pulse marker for agent platforms to detect
    const pulsePath = join(this.config.colonyRoot, ".commander-pulse");
    const now = new Date().toISOString();
    writeFileSync(pulsePath, now, "utf-8");

    if (this.config.platform === "opencode") {
      // For OpenCode: the pulse file + skill instructions handle continuation
      // The OpenCode skill reads .commander-pulse and continues working
      console.log(`[colony-heartbeat] Pulse written at ${now}`);
    } else if (this.config.platform === "claude-code") {
      // Claude Code hooks auto-trigger on session events
      // Pulse file serves as a coordination marker
      console.log(`[colony-heartbeat] Pulse written at ${now} (Claude Code hooks handle triggering)`);
    }
  }
}
```

**Step 2: Commit**

```bash
git add commander/src/heartbeat/colony-loop.ts
git commit -m "feat: add ColonyLoop with adaptive interval + platform-specific heartbeat injection"
```

---

## Phase 4: OpenCode Termite Skill

### Task 11: Create Termite Skill for OpenCode

**Files:**
- Create: `commander/skills/termite/SKILL.md`
- Create: `commander/skills/termite/arrive.md`
- Create: `commander/skills/termite/deposit.md`
- Create: `commander/skills/termite/molt.md`

**Step 1: Create main SKILL.md**

```markdown
---
name: termite-protocol
description: Work as a protocol-compliant termite in a Termite Protocol colony. Read .birth for state, claim signals, execute tasks, deposit observations.
---

# Termite Protocol — Agent Behavior Skill

You are a **termite** working in a Termite Protocol colony. Your behavior follows the protocol's 10 grammar rules.

## On Arrival

1. Run: `./scripts/field-arrive.sh`
2. Read the generated `.birth` file — it contains your caste, available signals, behavioral template, and recovery hints.
3. Your caste determines your permissions:
   - **scout**: explore and investigate, create EXPLORE signals
   - **worker**: execute signals, write code, run tests
   - **soldier**: fix failures, handle ALARM.md
   - **nurse**: analyze audit data, optimize protocol

## Work Cycle

1. Read `.birth` to find your assigned signal (in the `## task` section)
2. Claim the signal: `./scripts/field-claim.sh claim <signal-id> work $(whoami)`
3. Execute the signal's task:
   - Read the signal's `next_hint` for guidance
   - Write code, run tests, verify acceptance criteria
4. After EVERY commit, the metabolism runs automatically via git hooks
5. When the signal is complete: `./scripts/field-claim.sh release <signal-id> work`

## Observations

When you discover a meaningful pattern, deposit it:
```bash
./scripts/field-deposit.sh --pattern "pattern-name" --context "file/module" --detail "What you found and why it matters"
```

Good observations have:
- Specific pattern (not "I noticed something")
- Concrete context (file path or module name)
- Actionable detail (>20 chars, explains impact)

## Safety Rules

- **S1**: Commit messages explain WHAT and WHY
- **S2**: NEVER delete .md files
- **S3**: Commit every 50 lines of changes
- **S4**: If ALARM.md exists, read it first

## Session End (Molt)

Before your session ends:
1. Write `WIP.md` with your current progress and unfinished work
2. Run: `./scripts/field-deposit.sh --pheromone --caste <your-caste> --completed "what you did" --unresolved "what remains"`
3. This ensures the next termite can continue your work

## Commander Integration

If `PLAN.md` exists, read it for the overall objective and signal map.
If `.commander-pulse` exists and is recent (< 2 min), there is active Commander orchestration — prioritize directive signals (source: directive) over autonomous ones.
```

**Step 2: Create arrive.md**

```markdown
---
name: termite-arrive
description: Colony arrival procedure — run field-arrive.sh and read .birth
---

# Arrival Procedure

Run this sequence on every new session:

1. `./scripts/field-arrive.sh`
2. Read `.birth` — this is your ONLY required reading. It contains everything you need:
   - Your caste and permissions
   - The top priority signal to work on
   - Behavioral template (example of a good observation)
   - Recovery hints for common situations
3. If `PLAN.md` exists, skim the Signal Map section for overall context
4. If `ALARM.md` exists, read it immediately — you are a soldier
```

**Step 3: Create deposit.md**

```markdown
---
name: termite-deposit
description: How to deposit observations and pheromones correctly
---

# Depositing Observations

When you notice a recurring pattern, architectural insight, or potential issue:

```bash
./scripts/field-deposit.sh \
  --pattern "concise-pattern-name" \
  --context "src/path/to/relevant/code" \
  --confidence high \
  --detail "Detailed explanation of what you found, why it matters, and what action should be taken. Must be >20 characters and substantive."
```

## Quality Checklist

Before depositing, verify:
- [ ] Pattern name is specific (not "code pattern" or "observation")
- [ ] Context points to a real file or module
- [ ] Detail explains the WHY, not just the WHAT
- [ ] Detail is >20 characters with actionable content

## What NOT to deposit
- Signal IDs as patterns
- "I completed my task" (that's a pheromone, not an observation)
- Duplicate of an existing observation (check `.birth` for existing rules)
```

**Step 4: Create molt.md**

```markdown
---
name: termite-molt
description: Session-end handoff — write WIP and deposit pheromone
---

# Molt Procedure (Session End)

When you sense your session is ending (context getting long, task complete, or explicitly asked to stop):

## Step 1: Write WIP.md

```markdown
# WIP — Work In Progress

## What I Did
- [List completed work items]

## What Remains
- [List unfinished items with specific next steps]

## Key Decisions Made
- [Any architectural or design choices]

## Gotchas
- [Anything the next termite should know]
```

## Step 2: Deposit Pheromone

```bash
./scripts/field-deposit.sh \
  --pheromone \
  --caste <your-caste-from-.birth> \
  --completed "Brief summary of completed work" \
  --unresolved "Brief summary of remaining work"
```

## Step 3: Release Claims

If you have an active signal claim that isn't complete:
```bash
./scripts/field-claim.sh release <signal-id> work
```

The signal will return to 'open' status for the next termite to claim.
```

**Step 5: Commit**

```bash
git add commander/skills/termite/SKILL.md commander/skills/termite/arrive.md commander/skills/termite/deposit.md commander/skills/termite/molt.md
git commit -m "feat: add termite protocol skill for OpenCode agents"
```

---

## Phase 5: Wire It All Together — CLI Integration

### Task 12: Wire Brain + Heartbeat into CLI

**Files:**
- Modify: `commander/src/index.ts`
- Create: `commander/src/engine/pipeline.ts`

**Step 1: Create pipeline orchestrator**

```typescript
// commander/src/engine/pipeline.ts

import { TaskClassifier } from "./classifier.js";
import { SignalDecomposer, type DecomposedSignal } from "./decomposer.js";
import { SignalBridge } from "../colony/signal-bridge.js";
import { PlanWriter, type Plan } from "../colony/plan-writer.js";
import { CommanderLoop } from "../heartbeat/commander-loop.js";
import { ColonyLoop, type Platform } from "../heartbeat/colony-loop.js";

export interface PipelineConfig {
  colonyRoot: string;
  platform: Platform;
  generateText: (prompt: string) => Promise<string>;
}

export class Pipeline {
  private config: PipelineConfig;
  private bridge: SignalBridge;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.bridge = new SignalBridge(config.colonyRoot);
  }

  async plan(objective: string): Promise<Plan> {
    console.log("[commander] Phase 0: Classifying task...");
    const taskType = await TaskClassifier.classifyWithLLM(
      objective,
      this.config.generateText,
    );
    console.log(`[commander] Task type: ${taskType}`);

    console.log("[commander] Phase 1: Researching...");
    const researchFindings = await this.config.generateText(
      `You are a research analyst. Analyze this objective and provide key findings, relevant context, and recommendations.\n\nObjective: ${objective}\n\nProvide structured research findings:`,
    );

    console.log("[commander] Phase 2: Simulating user scenarios...");
    const userScenarios = await this.config.generateText(
      `Based on this objective, identify the target audience and key scenarios:\n\nObjective: ${objective}\nTask Type: ${taskType}\n\nDescribe: who consumes the output, what scenarios matter, what edge cases exist.`,
    );

    console.log("[commander] Phase 3: Designing...");
    let architecture: string | null = null;
    let synthesis: string | null = null;

    if (taskType === "BUILD" || taskType === "HYBRID") {
      architecture = await this.config.generateText(
        `Design the technical architecture for:\n\nObjective: ${objective}\n\nResearch: ${researchFindings}\n\nProvide: module decomposition, key interfaces, data flow, technology choices.`,
      );
    }
    if (taskType === "RESEARCH" || taskType === "HYBRID" || taskType === "ANALYZE") {
      synthesis = await this.config.generateText(
        `Synthesize the research findings into actionable analysis:\n\nObjective: ${objective}\n\nResearch: ${researchFindings}\n\nProvide: key trends, gaps, comparative insights, recommendations.`,
      );
    }

    console.log("[commander] Phase 4: Decomposing into signals...");
    const decompositionPrompt = SignalDecomposer.buildDecompositionPrompt(
      objective,
      taskType,
      researchFindings,
    );
    const signalsJson = await this.config.generateText(decompositionPrompt);

    let signals: DecomposedSignal[] = [];
    try {
      signals = JSON.parse(signalsJson);
    } catch {
      console.error("[commander] Failed to parse signals JSON, using empty list");
    }

    const { valid, errors } = SignalDecomposer.validateTree(signals);
    if (!valid) {
      console.warn("[commander] Signal validation warnings:", errors);
    }

    signals = SignalDecomposer.topologicalSort(signals);

    console.log("[commander] Phase 5: Defining quality criteria...");
    const qualityCriteria = await this.config.generateText(
      `Define acceptance criteria for this work:\n\nObjective: ${objective}\nTask Type: ${taskType}\nSignals: ${signals.map((s) => s.title).join(", ")}\n\nProvide: per-signal acceptance criteria and global quality standards.`,
    );

    const plan: Plan = {
      objective,
      taskType,
      audience: userScenarios.slice(0, 200),
      researchFindings,
      userScenarios,
      architecture,
      synthesis,
      signals: signals.map((s, i) => ({
        id: `S-${String(i + 1).padStart(3, "0")}`,
        type: s.type,
        title: s.title,
        weight: s.weight,
        parentId: s.parentId,
        status: "open",
      })),
      qualityCriteria,
      deliverableFormat: taskType === "BUILD" ? "Code + tests" : taskType === "RESEARCH" ? "Report" : "Analysis + code",
    };

    return plan;
  }

  async dispatch(plan: Plan): Promise<void> {
    // Write PLAN.md
    console.log("[commander] Writing PLAN.md...");
    await PlanWriter.writeToDisk(plan, this.config.colonyRoot);

    // Create signals in colony DB
    console.log(`[commander] Creating ${plan.signals.length} directive signals...`);
    for (const signal of plan.signals) {
      await this.bridge.createSignal({
        type: signal.type,
        title: signal.title,
        weight: signal.weight,
        source: "directive",
        parentId: signal.parentId ?? undefined,
        module: "",
        nextHint: "",
      });
    }
    console.log("[commander] Signals dispatched to colony.");
  }

  async runWithHeartbeats(plan: Plan): Promise<void> {
    await this.dispatch(plan);

    // Start both heartbeat loops
    const commanderLoop = new CommanderLoop({
      colonyRoot: this.config.colonyRoot,
      intervalMs: 60_000,       // 1 minute
      stallThreshold: 10,       // 10 minutes of no progress
      onCycle: (snap) => {
        console.log(`[commander-hb] open=${snap.openSignals} claimed=${snap.claimedSignals} commits=${snap.newCommits}`);
      },
      onHalt: (info) => {
        console.log(`[commander] HALTED: ${info.reason}. See HALT.md`);
      },
    });

    const colonyLoop = new ColonyLoop({
      colonyRoot: this.config.colonyRoot,
      platform: this.config.platform,
      baseIntervalMs: 15_000,   // 15 seconds
      maxIntervalMs: 60_000,    // 1 minute max
      stallThreshold: 20,       // 20 * 15s = 5 minutes
      onCycle: (snap, interval) => {
        console.log(`[colony-hb] open=${snap.openSignals} claimed=${snap.claimedSignals} interval=${Math.round(interval)}ms`);
      },
      onHalt: (reason) => {
        console.log(`[colony] Stopped: ${reason}`);
        commanderLoop.stop(); // Colony halt → Commander evaluates and halts
      },
    });

    await Promise.all([
      commanderLoop.start(),
      colonyLoop.start(),
    ]);
  }
}
```

**Step 2: Update CLI entry point**

```typescript
// commander/src/index.ts (full replacement)
#!/usr/bin/env node

import { program } from "commander";
import { Pipeline, type PipelineConfig } from "./engine/pipeline.js";
import { SignalBridge } from "./colony/signal-bridge.js";

function detectPlatform(): "opencode" | "claude-code" | "unknown" {
  if (process.env.CLAUDE_PROJECT_DIR) return "claude-code";
  if (process.env.OPENCODE_SESSION) return "opencode";
  return "unknown";
}

program
  .name("commander")
  .description("Termite Commander — autonomous orchestration engine")
  .version("0.1.0");

program
  .command("plan <objective>")
  .description("Plan and decompose an objective into colony signals")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--dispatch", "Dispatch signals immediately after planning", false)
  .option("--run", "Plan, dispatch, and start heartbeats", false)
  .action(async (objective: string, opts: { colony: string; dispatch: boolean; run: boolean }) => {
    const config: PipelineConfig = {
      colonyRoot: opts.colony,
      platform: detectPlatform(),
      generateText: async (prompt: string) => {
        // TODO: Wire to actual LLM via Vercel AI SDK
        // For now, return a placeholder
        console.log(`[llm] Prompt: ${prompt.slice(0, 100)}...`);
        return `[LLM response placeholder for: ${prompt.slice(0, 50)}]`;
      },
    };

    const pipeline = new Pipeline(config);
    const plan = await pipeline.plan(objective);

    console.log("\n=== PLAN ===");
    console.log(`Type: ${plan.taskType}`);
    console.log(`Signals: ${plan.signals.length}`);
    plan.signals.forEach((s) => console.log(`  ${s.id} [${s.type}] ${s.title}`));

    if (opts.run) {
      await pipeline.runWithHeartbeats(plan);
    } else if (opts.dispatch) {
      await pipeline.dispatch(plan);
      console.log("\nSignals dispatched. Run 'commander watch' to monitor.");
    } else {
      console.log("\nPlan generated. Use --dispatch to send signals, or --run to start execution.");
    }
  });

program
  .command("status")
  .description("Show colony status")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .action(async (opts: { colony: string }) => {
    const bridge = new SignalBridge(opts.colony);
    const status = await bridge.status();
    console.log(JSON.stringify(status, null, 2));
  });

program
  .command("resume")
  .description("Resume from a halted state")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .action(async (opts: { colony: string }) => {
    const { existsSync, readFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const haltPath = join(opts.colony, "HALT.md");

    if (!existsSync(haltPath)) {
      console.log("No HALT.md found. Colony is not halted.");
      return;
    }

    console.log("=== HALT STATUS ===");
    console.log(readFileSync(haltPath, "utf-8"));
    console.log("\nRemoving HALT.md and restarting...");
    unlinkSync(haltPath);
    console.log("Colony resumed. Run 'commander plan --run' with new objectives.");
  });

program
  .command("watch")
  .description("Watch colony status in real-time")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("-i, --interval <ms>", "Refresh interval in ms", "5000")
  .action(async (opts: { colony: string; interval: string }) => {
    const bridge = new SignalBridge(opts.colony);
    const interval = parseInt(opts.interval, 10);

    const tick = async () => {
      const status = await bridge.status();
      const stall = await bridge.checkStall(5);
      process.stdout.write(
        `\r[${new Date().toISOString()}] total=${status.total} open=${status.open} claimed=${status.claimed} done=${status.done} stall=${stall.stalled}`,
      );
    };

    await tick();
    setInterval(tick, interval);
  });

program.parse();
```

**Step 3: Verify build**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx tsc --noEmit`
Expected: Clean compilation

**Step 4: Verify CLI help**

Run: `cd /Users/bingbingbai/Desktop/TermiteCommander/commander && npx tsx src/index.ts --help`
Expected: Shows plan, status, resume, watch commands

**Step 5: Commit**

```bash
git add commander/src/engine/pipeline.ts commander/src/index.ts
git commit -m "feat: wire pipeline + heartbeats into CLI with plan/status/resume/watch commands"
```

---

## Phase 6: DB Schema Extension for Commander

### Task 13: Add Commander Tables to Schema

**Files:**
- Modify: `TermiteProtocol/templates/scripts/termite-db-schema.sql`
- Modify: `TermiteProtocol/templates/scripts/termite-db.sh` (add commander functions)

**Step 1: Add commander_state and halt_log tables to schema**

Append to `termite-db-schema.sql`:

```sql
-- Commander state tracking
CREATE TABLE IF NOT EXISTS commander_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Halt log (every circuit break recorded)
CREATE TABLE IF NOT EXISTS halt_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    halted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    reason TEXT NOT NULL,
    commander_cycles INTEGER DEFAULT 0,
    colony_cycles INTEGER DEFAULT 0,
    signals_total INTEGER DEFAULT 0,
    signals_completed INTEGER DEFAULT 0,
    remaining_signals TEXT DEFAULT '[]',
    last_commit_hash TEXT,
    recommendation TEXT
);

CREATE INDEX IF NOT EXISTS idx_halt_log_time ON halt_log(halted_at DESC);
```

**Step 2: Add commander DB functions to termite-db.sh**

Append these functions:

```bash
# --- Commander State ---

db_commander_set() {
  local key="$1" value="$2"
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  _db "INSERT OR REPLACE INTO commander_state (key, value, updated_at) VALUES ('$(db_escape "$key")', '$(db_escape "$value")', '$now');"
}

db_commander_get() {
  local key="$1"
  _db "SELECT value FROM commander_state WHERE key='$(db_escape "$key")';" | head -1
}

# --- Halt Log ---

db_halt_log_insert() {
  local reason="$1" cmdr_cycles="$2" colony_cycles="$3" total="$4" completed="$5"
  local remaining="$6" commit_hash="$7" recommendation="$8"
  _db "INSERT INTO halt_log (reason, commander_cycles, colony_cycles, signals_total, signals_completed, remaining_signals, last_commit_hash, recommendation) VALUES ('$(db_escape "$reason")', $cmdr_cycles, $colony_cycles, $total, $completed, '$(db_escape "$remaining")', '$(db_escape "$commit_hash")', '$(db_escape "$recommendation")');"
}

db_halt_log_latest() {
  _db "SELECT * FROM halt_log ORDER BY halted_at DESC LIMIT 1;"
}
```

**Step 3: Commit**

```bash
git add TermiteProtocol/templates/scripts/termite-db-schema.sql TermiteProtocol/templates/scripts/termite-db.sh
git commit -m "feat: add commander_state and halt_log tables to protocol schema"
```

---

## Phase 7: Input Layer — DIRECTIVE.md Watcher

### Task 14: DIRECTIVE.md File Watcher

**Files:**
- Create: `commander/src/input/directive-watcher.ts`

**Step 1: Implement DirectiveWatcher**

```typescript
// commander/src/input/directive-watcher.ts

import { watch } from "chokidar";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DirectiveWatcherConfig {
  colonyRoot: string;
  onDirective: (content: string) => Promise<void>;
}

export class DirectiveWatcher {
  private config: DirectiveWatcherConfig;
  private watcher: ReturnType<typeof watch> | null = null;

  constructor(config: DirectiveWatcherConfig) {
    this.config = config;
  }

  start(): void {
    const directivePath = join(this.config.colonyRoot, "DIRECTIVE.md");

    this.watcher = watch(directivePath, {
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher.on("add", async (path) => {
      console.log(`[directive-watcher] DIRECTIVE.md detected: ${path}`);
      await this.processDirective(path);
    });

    this.watcher.on("change", async (path) => {
      console.log(`[directive-watcher] DIRECTIVE.md changed: ${path}`);
      await this.processDirective(path);
    });

    console.log(`[directive-watcher] Watching for DIRECTIVE.md in ${this.config.colonyRoot}`);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    console.log("[directive-watcher] Stopped.");
  }

  private async processDirective(path: string): Promise<void> {
    try {
      const content = await readFile(path, "utf-8");
      if (content.trim().length === 0) return;
      await this.config.onDirective(content);
    } catch (err) {
      console.error("[directive-watcher] Error processing directive:", err);
    }
  }
}
```

**Step 2: Commit**

```bash
git add commander/src/input/directive-watcher.ts
git commit -m "feat: add DirectiveWatcher for file-based commander input"
```

---

## Phase 8: Audit Collector

### Task 15: Audit Data Collector

**Files:**
- Create: `commander/src/audit/collector.ts`

**Step 1: Implement AuditCollector**

```typescript
// commander/src/audit/collector.ts

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AuditCollectorConfig {
  colonyRoot: string;
  protocolRoot: string; // TermiteProtocol source repo
}

export class AuditCollector {
  private config: AuditCollectorConfig;

  constructor(config: AuditCollectorConfig) {
    this.config = config;
  }

  async collectAuditPackage(): Promise<string> {
    const exportScript = join(this.config.colonyRoot, "scripts", "field-export-audit.sh");

    if (!existsSync(exportScript)) {
      throw new Error("field-export-audit.sh not found in colony");
    }

    // Run export
    const { stdout } = await execFileAsync("bash", [exportScript], {
      cwd: this.config.colonyRoot,
      timeout: 60_000,
    });

    console.log(`[audit] Export output: ${stdout.trim()}`);

    // Find the generated audit package
    const auditDir = join(this.config.colonyRoot, "audit-export");
    if (!existsSync(auditDir)) {
      throw new Error("Audit export directory not created");
    }

    return auditDir;
  }

  async copyToProtocolRepo(auditDir: string, projectName: string): Promise<string> {
    const date = new Date().toISOString().split("T")[0];
    const destDir = join(
      this.config.protocolRoot,
      "audit-packages",
      projectName,
      date,
    );

    mkdirSync(destDir, { recursive: true });
    cpSync(auditDir, destDir, { recursive: true });

    console.log(`[audit] Copied audit package to ${destDir}`);
    return destDir;
  }
}
```

**Step 2: Commit**

```bash
git add commander/src/audit/collector.ts
git commit -m "feat: add AuditCollector for exporting and archiving colony audit data"
```

---

## Summary

| Phase | Tasks | What's Built |
|-------|-------|-------------|
| 1 | Tasks 1-5 | Project scaffold, SignalBridge, field-commander.sh, PlanWriter, HaltWriter |
| 2 | Tasks 6-7 | TaskClassifier, SignalDecomposer |
| 3 | Tasks 8-10 | CircuitBreaker, CommanderLoop, ColonyLoop |
| 4 | Task 11 | Termite skill files for OpenCode |
| 5 | Task 12 | Pipeline orchestrator + CLI wiring |
| 6 | Task 13 | Commander DB schema extension |
| 7 | Task 14 | DIRECTIVE.md file watcher |
| 8 | Task 15 | Audit data collector |

**After Phase 8, the system can:**
1. Accept objectives via CLI or DIRECTIVE.md
2. Classify task type (RESEARCH/BUILD/ANALYZE/HYBRID)
3. Decompose into protocol-standard signals
4. Write PLAN.md and dispatch signals to colony
5. Run dual heartbeats with circuit breaking
6. Write HALT.md on completion or stall
7. Collect audit data for feedback loops
8. OpenCode agents work as termites via skill files
