# Commander v2 Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Commander from full planner to focused signal decomposer + read-only TUI dashboard + OpenCode-based model configuration.

**Architecture:** Slim the pipeline to classify+decompose (2 phases), replace interactive TUI with a read-only Ink dashboard polling DB/git/status files, add model-resolver that reads opencode.json with env var overrides, and support mixed-model worker fleets.

**Tech Stack:** TypeScript, Ink 5 + React 18, Vercel AI SDK, SQLite (via termite-db.sh), opencode.json config

**Reference:** `docs/plans/2026-03-04-commander-v2-redesign.md`

---

## Phase 1: Model Resolver

### Task 1: Create model-resolver module

**Files:**
- Create: `commander/src/config/model-resolver.ts`
- Test: `commander/src/config/__tests__/model-resolver.test.ts`

**Step 1: Write the test**

```typescript
// commander/src/config/__tests__/model-resolver.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveModels, parseWorkerSpec, readOpenCodeConfig } from "../model-resolver.js";

describe("parseWorkerSpec", () => {
  it("parses count-only spec", () => {
    expect(parseWorkerSpec("3")).toEqual([
      { model: undefined, count: 3 },
    ]);
  });

  it("parses mixed model spec", () => {
    expect(parseWorkerSpec("sonnet:1,haiku:2,gemini-flash:1")).toEqual([
      { model: "sonnet", count: 1 },
      { model: "haiku", count: 2 },
      { model: "gemini-flash", count: 1 },
    ]);
  });

  it("handles single model spec", () => {
    expect(parseWorkerSpec("haiku:3")).toEqual([
      { model: "haiku", count: 3 },
    ]);
  });
});

describe("readOpenCodeConfig", () => {
  it("returns null when no config file exists", () => {
    expect(readOpenCodeConfig("/nonexistent/path")).toBeNull();
  });
});

describe("resolveModels", () => {
  const origEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("uses env vars when set", () => {
    process.env.COMMANDER_MODEL = "claude-opus-4";
    process.env.TERMITE_WORKERS = "haiku:2";
    const result = resolveModels("/tmp");
    expect(result.commanderModel).toBe("claude-opus-4");
    expect(result.workers).toEqual([{ model: "haiku", count: 2 }]);
  });

  it("falls back to defaults when nothing configured", () => {
    delete process.env.COMMANDER_MODEL;
    delete process.env.TERMITE_WORKERS;
    delete process.env.TERMITE_MODEL;
    const result = resolveModels("/tmp");
    expect(result.commanderModel).toBe("claude-sonnet-4-5");
    expect(result.workers.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd commander && npx vitest run src/config/__tests__/model-resolver.test.ts`
Expected: FAIL — module not found

**Step 3: Implement model-resolver**

```typescript
// commander/src/config/model-resolver.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface WorkerSpec {
  model: string | undefined;
  count: number;
}

export interface ResolvedModels {
  commanderModel: string;
  commanderProvider: "anthropic" | "openai" | "azure-openai";
  workers: WorkerSpec[];
  defaultWorkerModel: string;
}

interface OpenCodeConfig {
  model?: string;
  small_model?: string;
  commander?: {
    workers?: Array<{ model: string; count: number }>;
  };
}

export function parseWorkerSpec(spec: string): WorkerSpec[] {
  const trimmed = spec.trim();

  // Pure number: "3" → 3 workers with default model
  if (/^\d+$/.test(trimmed)) {
    return [{ model: undefined, count: parseInt(trimmed, 10) }];
  }

  // Mixed: "sonnet:1,haiku:2,gemini-flash:1"
  return trimmed.split(",").map((part) => {
    const [model, countStr] = part.trim().split(":");
    return { model: model.trim(), count: parseInt(countStr ?? "1", 10) };
  });
}

export function readOpenCodeConfig(colonyRoot: string): OpenCodeConfig | null {
  const candidates = [
    join(colonyRoot, "opencode.json"),
    join(colonyRoot, ".opencode", "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.json"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8");
        // Strip JSONC comments (// and /* */)
        const stripped = raw
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "");
        return JSON.parse(stripped);
      } catch {
        continue;
      }
    }
  }
  return null;
}

function extractProvider(modelId: string): "anthropic" | "openai" | "azure-openai" {
  // opencode format: "provider/model" e.g. "anthropic/claude-sonnet-4-5"
  const slash = modelId.indexOf("/");
  if (slash > 0) {
    const provider = modelId.slice(0, slash).toLowerCase();
    if (provider === "anthropic") return "anthropic";
    if (provider === "openai") return "openai";
    if (provider === "azure") return "azure-openai";
  }
  // Heuristic: claude → anthropic, gpt → openai
  if (/claude/i.test(modelId)) return "anthropic";
  if (/gpt|codex/i.test(modelId)) return "azure-openai";
  return "anthropic";
}

function extractModelName(modelId: string): string {
  // Strip "provider/" prefix if present
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(slash + 1) : modelId;
}

export function resolveModels(colonyRoot: string): ResolvedModels {
  const oc = readOpenCodeConfig(colonyRoot);

  // 1. Commander model: env > opencode model > default
  const rawCommander =
    process.env.COMMANDER_MODEL ??
    (oc?.model ? extractModelName(oc.model) : null) ??
    "claude-sonnet-4-5";
  const commanderProvider =
    oc?.model ? extractProvider(oc.model) : extractProvider(rawCommander);

  // 2. Default worker model: env > opencode small_model > default
  const defaultWorkerModel =
    process.env.TERMITE_MODEL ??
    (oc?.small_model ? extractModelName(oc.small_model) : null) ??
    "claude-haiku-3-5";

  // 3. Worker fleet: env > opencode commander.workers > 3× default
  let workers: WorkerSpec[];

  if (process.env.TERMITE_WORKERS) {
    workers = parseWorkerSpec(process.env.TERMITE_WORKERS);
  } else if (oc?.commander?.workers && oc.commander.workers.length > 0) {
    workers = oc.commander.workers.map((w) => ({
      model: extractModelName(w.model),
      count: w.count,
    }));
  } else {
    workers = [{ model: undefined, count: 3 }];
  }

  return {
    commanderModel: rawCommander,
    commanderProvider,
    workers,
    defaultWorkerModel,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd commander && npx vitest run src/config/__tests__/model-resolver.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add commander/src/config/
git commit -m "feat: add model-resolver with opencode.json + env var support"
```

---

## Phase 2: SignalBridge Enhancement

### Task 2: Add listSignals() to SignalBridge

**Files:**
- Modify: `commander/src/colony/signal-bridge.ts`
- Modify: `commander/src/colony/__tests__/signal-bridge.test.ts`

**Step 1: Add SignalDetail interface and listSignals method**

Add to `signal-bridge.ts` after the `StallStatus` interface (line 27):

```typescript
export interface SignalDetail {
  id: string;
  type: string;
  title: string;
  status: string;
  weight: number;
  claimedBy: string;
  createdAt: string;
  updatedAt: string;
}
```

Add `listSignals()` method to the `SignalBridge` class after `status()`:

```typescript
async listSignals(): Promise<SignalDetail[]> {
  const script = `${this.dbPreamble()} && sqlite3 -separator '|' "$PROJECT_ROOT/.termite/termite.db" "SELECT id, type, title, status, weight, claimed_by, created_at, updated_at FROM signals ORDER BY CASE status WHEN 'open' THEN 2 WHEN 'claimed' THEN 1 ELSE 3 END, created_at ASC"`;

  const result = await this.exec("bash", ["-c", script]);
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];

  return result.stdout.split("\n").filter(Boolean).map((line) => {
    const [id, type, title, status, weight, claimedBy, createdAt, updatedAt] = line.split("|");
    return {
      id: id ?? "",
      type: type ?? "",
      title: title ?? "",
      status: status ?? "open",
      weight: parseInt(weight ?? "0", 10),
      claimedBy: claimedBy ?? "",
      createdAt: createdAt ?? "",
      updatedAt: updatedAt ?? "",
    };
  });
}
```

**Step 2: Build and verify**

Run: `cd commander && npm run build`
Expected: Compile success

**Step 3: Commit**

```bash
git add commander/src/colony/signal-bridge.ts
git commit -m "feat: add listSignals() to SignalBridge for TUI dashboard"
```

---

## Phase 3: Pipeline Simplification

### Task 3: Slim pipeline to classify + decompose

**Files:**
- Modify: `commander/src/engine/pipeline.ts`
- Modify: `commander/src/engine/classifier.ts`
- Modify: `commander/src/engine/decomposer.ts`
- Modify: `commander/src/index.ts`

**Step 1: Simplify classifier — remove RESEARCH/ANALYZE**

Replace `classifier.ts` contents. Keep only BUILD and HYBRID. Default to BUILD:

```typescript
export type TaskType = "BUILD" | "HYBRID";

export class TaskClassifier {
  static classify(input: string): TaskType {
    const hasBuild = /构建|开发|实现|创建|添加|build|create|implement|develop|add|code|api|function|test|deploy/i.test(input);
    const hasResearch = /调研|研究|分析|explore|research|investigate|analyze/i.test(input);
    if (hasBuild && hasResearch) return "HYBRID";
    return "BUILD";
  }

  static async classifyWithLLM(
    input: string,
    generateText: (prompt: string) => Promise<string>,
  ): Promise<TaskType> {
    const prompt = `Classify this task. Reply with ONLY: BUILD or HYBRID.

BUILD: creating/modifying code, features, systems
HYBRID: building + investigating existing systems

Task: "${input}"

Category:`;

    try {
      const result = await generateText(prompt);
      const cleaned = result.trim().toUpperCase() as TaskType;
      if (["BUILD", "HYBRID"].includes(cleaned)) return cleaned;
    } catch {}
    return this.classify(input);
  }
}
```

**Step 2: Enhance decomposer prompt for weak models**

Replace `buildDecompositionPrompt` in `decomposer.ts`:

```typescript
static buildDecompositionPrompt(
  objective: string,
  taskType: string,
  designContext: string,
): string {
  return `You are decomposing a task into atomic signals that WEAK language models (haiku-class) can execute.

Objective: ${objective}
Task Type: ${taskType}

Design Context:
${designContext}

CRITICAL: Each signal must be completable by a weak model in a single session.

Signal Standards for Weak Models:
- ATOMIC: one clear action, one file/module, completable in ~10 minutes
- SELF-CONTAINED: title + nextHint must contain ALL context needed (file paths, function names, expected behavior)
- VERIFIABLE: explicit acceptance criteria the model can check itself
- SPECIFIC PATHS: always specify exact file paths, don't let the model guess
- MAX DEPTH 3: keep dependencies flat, maximize parallelism (parentId: null)

Signal types: HOLE (write/modify code), EXPLORE (investigate code), REPORT (write docs), REVIEW (check quality)
Weight: 70-90 for directive signals (higher = more urgent)

BAD signal (too vague for weak model):
  "Implement authentication" — weak model won't know where to start

GOOD signal (atomic, self-contained):
  title: "Create src/middleware/auth.ts: JWT verification middleware"
  nextHint: "Create file src/middleware/auth.ts. Import jsonwebtoken. Export function verifyToken(req, res, next) that reads Authorization header, verifies JWT with process.env.JWT_SECRET, calls next() on success or res.status(401).json({error:'unauthorized'}) on failure."
  acceptanceCriteria: "File exists, exports verifyToken, has basic test"

Output as JSON array:
[
  {
    "type": "HOLE",
    "title": "Brief but specific description with file path",
    "weight": 80,
    "parentId": null,
    "module": "relevant/path/",
    "nextHint": "Detailed step-by-step instructions for a weak model",
    "acceptanceCriteria": "How to verify this is done"
  }
]

Respond with ONLY the JSON array.`;
}
```

**Step 3: Rewrite pipeline.plan() — 2 phases only**

Replace the `plan()` method in `pipeline.ts`. The new version:
- Accepts optional `planFilePath` and `contextText`
- Phase 0: classify (one cheap LLM call)
- Phase 1: decompose (one strong LLM call with design context)
- No research/simulate/design/quality phases

```typescript
async plan(
  objective: string,
  opts?: { planFile?: string; context?: string },
): Promise<Plan> {
  // Read design context from file or direct text
  let designContext = opts?.context ?? "";
  if (opts?.planFile) {
    const { readFileSync, existsSync } = await import("node:fs");
    if (existsSync(opts.planFile)) {
      designContext = readFileSync(opts.planFile, "utf-8");
      console.log(`[commander] Read design context from ${opts.planFile}`);
    } else {
      console.warn(`[commander] Plan file not found: ${opts.planFile}`);
    }
  }

  console.log("[commander] Phase 0: Classifying task...");
  const taskType = await TaskClassifier.classifyWithLLM(
    objective,
    (prompt) => callLLM(prompt, this.config.llmConfig),
  );
  console.log(`[commander] Task type: ${taskType}`);

  console.log("[commander] Phase 1: Decomposing into signals...");
  const decompositionPrompt = SignalDecomposer.buildDecompositionPrompt(
    objective,
    taskType,
    designContext,
  );
  const signalsJson = await callLLM(decompositionPrompt, this.config.llmConfig);

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

  const plan: Plan = {
    objective,
    taskType,
    audience: "",
    researchFindings: "",
    userScenarios: "",
    architecture: null,
    synthesis: null,
    signals: signals.map((s, i) => ({
      id: `S-${String(i + 1).padStart(3, "0")}`,
      type: s.type,
      title: s.title,
      weight: s.weight,
      parentId: s.parentId,
      status: "open",
    })),
    qualityCriteria: "",
    deliverableFormat: taskType === "BUILD" ? "Code + tests" : "Code + analysis",
  };

  return plan;
}
```

**Step 4: Update CLI — add --plan and --context options**

In `src/index.ts`, modify the `plan` command:

```typescript
program
  .command("plan <objective>")
  .description("Decompose an objective into colony signals")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("-p, --plan <file>", "Design document to use as decomposition context")
  .option("--context <text>", "Direct text context for decomposition")
  .option("--dispatch", "Dispatch signals immediately after planning", false)
  .option("--run", "Plan, dispatch, and start heartbeats", false)
  .action(async (objective, opts) => {
    // ... existing config setup ...
    const pipeline = new Pipeline(config);
    const plan = await pipeline.plan(objective, {
      planFile: opts.plan,
      context: opts.context,
    });
    // ... rest unchanged ...
  });
```

**Step 5: Build and run tests**

Run: `cd commander && npm run build && npm test`
Expected: Build success, tests pass (classifier tests will need updating)

**Step 6: Update classifier tests**

Modify `src/engine/__tests__/classifier.test.ts` to match new BUILD/HYBRID types — remove RESEARCH/ANALYZE test cases, update expectations.

**Step 7: Commit**

```bash
git add commander/src/engine/ commander/src/index.ts
git commit -m "feat: slim pipeline to classify+decompose, add --plan/--context, enhance weak-model decomposition"
```

---

## Phase 4: Model Integration into LLM Provider + Launcher

### Task 4: Wire model-resolver into provider and launcher

**Files:**
- Modify: `commander/src/llm/provider.ts`
- Modify: `commander/src/colony/opencode-launcher.ts`
- Modify: `commander/src/engine/pipeline.ts`

**Step 1: Update LLMConfig to use resolved models**

In `provider.ts`, update `LLMConfig` and `callLLM` to accept a model name string directly (already works). Add a helper:

```typescript
export function configFromResolved(
  resolved: import("../config/model-resolver.js").ResolvedModels,
): LLMConfig {
  return {
    provider: resolved.commanderProvider,
    model: resolved.commanderModel,
  };
}
```

**Step 2: Add model field to OpenCodeWorker + LauncherConfig**

In `opencode-launcher.ts`:

```typescript
export interface WorkerModelSpec {
  model: string;
  count: number;
}

export interface LauncherConfig {
  colonyRoot: string;
  skillSourceDir: string;
  workerSpecs: WorkerModelSpec[];  // replaces maxWorkers
  defaultWorkerModel: string;
}

export interface OpenCodeWorker {
  id: string;
  model: string;         // NEW: which model this worker uses
  sessionId: string | null;
  process: ChildProcess | null;
  startedAt: Date;
  status: "running" | "stopped" | "errored" | "idle";
}
```

Update `launchWorker` to accept a model name, pass it via env var or OpenCode `--model` flag if supported. Update `launchWorkerFleet()` to iterate over workerSpecs.

**Step 3: Wire into pipeline**

In `pipeline.ts` constructor, use `resolveModels()`:

```typescript
import { resolveModels, type ResolvedModels } from "../config/model-resolver.js";
import { configFromResolved } from "../llm/provider.js";

constructor(config: PipelineConfig) {
  this.config = config;
  this.bridge = new SignalBridge(config.colonyRoot);
  this.models = resolveModels(config.colonyRoot);
  this.config.llmConfig = configFromResolved(this.models);
  this.launcher = new OpenCodeLauncher({
    colonyRoot: config.colonyRoot,
    skillSourceDir: config.skillSourceDir,
    workerSpecs: this.models.workers.map((w) => ({
      model: w.model ?? this.models.defaultWorkerModel,
      count: w.count,
    })),
    defaultWorkerModel: this.models.defaultWorkerModel,
  });
}
```

Update `writeStatusFile()` to include model info.

**Step 4: Build and test**

Run: `cd commander && npm run build && npm test`

**Step 5: Commit**

```bash
git add commander/src/llm/ commander/src/colony/ commander/src/engine/ commander/src/config/
git commit -m "feat: wire model-resolver into pipeline, provider, and launcher with mixed-model workers"
```

---

## Phase 5: Read-Only TUI Dashboard

### Task 5: Replace interactive TUI with read-only monitor

**Files:**
- Delete: `commander/src/tui/views/REPLView.tsx`
- Delete: `commander/src/tui/views/DashboardView.tsx`
- Delete: `commander/src/tui/views/DetailView.tsx`
- Delete: `commander/src/tui/components/CommandPrompt.tsx`
- Delete: `commander/src/tui/utils/commandParser.ts`
- Delete: `commander/src/tui/hooks/usePipelineStreaming.ts`
- Create: `commander/src/tui/MonitorApp.tsx`
- Create: `commander/src/tui/components/CommitFeed.tsx`
- Create: `commander/src/tui/hooks/useGitCommits.ts`
- Modify: `commander/src/tui/hooks/useColonyState.ts`
- Modify: `commander/src/tui/components/SignalTable.tsx` → `SignalList.tsx`
- Modify: `commander/src/tui/components/WorkerTable.tsx`
- Modify: `commander/src/tui/App.tsx`
- Modify: `commander/src/tui/index.tsx`
- Modify: `commander/src/index.ts`
- Modify: `commander/package.json`

**Step 1: Delete old interactive files**

```bash
rm commander/src/tui/views/REPLView.tsx
rm commander/src/tui/views/DashboardView.tsx
rm commander/src/tui/views/DetailView.tsx
rm commander/src/tui/components/CommandPrompt.tsx
rm commander/src/tui/utils/commandParser.ts
rm commander/src/tui/hooks/usePipelineStreaming.ts
rmdir commander/src/tui/views
```

**Step 2: Remove ink-text-input dependency**

```bash
cd commander && npm uninstall ink-text-input
```

**Step 3: Create useGitCommits hook**

```typescript
// commander/src/tui/hooks/useGitCommits.ts
import { useState, useEffect } from "react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  message: string;
  timeAgo: string;
}

export function useGitCommits(colonyRoot: string, refreshMs = 5000, maxCommits = 5): GitCommit[] {
  const [commits, setCommits] = useState<GitCommit[]>([]);

  useEffect(() => {
    const poll = async () => {
      try {
        const { stdout } = await execFileAsync("git", [
          "-C", colonyRoot,
          "log", "--oneline", "--format=%h|%s|%cr",
          `-${maxCommits}`,
        ], { timeout: 5000 });
        const parsed = stdout.trim().split("\n").filter(Boolean).map((line) => {
          const [hash, message, timeAgo] = line.split("|");
          return { hash: hash ?? "", message: message ?? "", timeAgo: timeAgo ?? "" };
        });
        setCommits(parsed);
      } catch {
        // Git not available or not a repo — ignore
      }
    };
    poll();
    const timer = setInterval(poll, refreshMs);
    return () => clearInterval(timer);
  }, [colonyRoot, refreshMs, maxCommits]);

  return commits;
}
```

**Step 4: Create CommitFeed component**

```typescript
// commander/src/tui/components/CommitFeed.tsx
import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../utils/formatters.js";
import type { GitCommit } from "../hooks/useGitCommits.js";

interface CommitFeedProps {
  commits: GitCommit[];
}

export function CommitFeed({ commits }: CommitFeedProps) {
  return (
    <Box flexDirection="column">
      {commits.map((c) => (
        <Box key={c.hash}>
          <Text>{"  "}</Text>
          <Text dimColor>{c.timeAgo.padEnd(12)}</Text>
          <Text color="yellow">{c.hash} </Text>
          <Text>{truncate(c.message, 50)}</Text>
        </Box>
      ))}
      {commits.length === 0 && <Text dimColor>{"  No commits yet."}</Text>}
    </Box>
  );
}
```

**Step 5: Enhance useColonyState to include signal details**

Modify `useColonyState.ts` — add `signals: SignalDetail[]` to the state, call `bridge.listSignals()` in the poll function.

**Step 6: Rename SignalTable.tsx → SignalList.tsx**

Update to accept `SignalDetail[]` from DB (with real data), add `claimedBy` column.

**Step 7: Update WorkerTable.tsx — add model column**

Add a `model` column to the worker table display.

**Step 8: Create MonitorApp.tsx — the single read-only view**

```typescript
// commander/src/tui/MonitorApp.tsx
import React from "react";
import { Box, Text } from "ink";
import { ProgressBar } from "./components/ProgressBar.js";
import { WorkerStatus } from "./components/WorkerStatus.js";
import { SignalList } from "./components/SignalList.js";
import { WorkerTable } from "./components/WorkerTable.js";
import { CommitFeed } from "./components/CommitFeed.js";
import { useColonyState } from "./hooks/useColonyState.js";
import { useGitCommits } from "./hooks/useGitCommits.js";
import { formatDuration, formatTimeAgo } from "./utils/formatters.js";

interface MonitorAppProps {
  colonyRoot: string;
}

export function MonitorApp({ colonyRoot }: MonitorAppProps) {
  const colony = useColonyState(colonyRoot, 2000);
  const commits = useGitCommits(colonyRoot, 5000);

  const colonyName = colonyRoot.split("/").pop() ?? colonyRoot;
  const stateLabel = colony.isRunning ? "RUNNING" : "STOPPED";
  const stateColor = colony.isRunning ? "green" : "red";
  const duration = colony.lockData?.startedAt
    ? formatDuration(Date.now() - new Date(colony.lockData.startedAt).getTime())
    : "";

  // Model info from status file
  const modelInfo = colony.statusData as any;
  const commanderModel = modelInfo?.models?.commander ?? "";
  const workerModels = modelInfo?.models?.workers ?? "";

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Box>
          <Text bold>Termite Commander</Text>
          <Text>{"  |  "}</Text>
          <Text>Colony: </Text>
          <Text color="cyan">{colonyName}</Text>
          <Text>{"  |  "}</Text>
          <Text color={stateColor} bold>{stateLabel}</Text>
          {duration && <Text dimColor>{`  |  ${duration}`}</Text>}
        </Box>
        {colony.lockData?.objective && (
          <Box><Text dimColor>Objective: </Text><Text>{colony.lockData.objective}</Text></Box>
        )}
        {commanderModel && (
          <Box><Text dimColor>Model: </Text><Text>{commanderModel} (commander)</Text></Box>
        )}
        {workerModels && (
          <Box><Text dimColor>Workers: </Text><Text>{workerModels}</Text></Box>
        )}
      </Box>

      {/* Progress */}
      <Box flexDirection="column" marginY={1}>
        <ProgressBar label="Progress" done={colony.status.done} total={colony.status.total} />
        <Box>
          <Text>{"  Heartbeat   "}</Text>
          <Text dimColor>{`stall: ${colony.status.open > 0 ? "monitoring" : "idle"}`}</Text>
        </Box>
      </Box>

      {/* Signals */}
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text bold>{" Signals"}</Text>
        <SignalList signals={colony.signals ?? []} />
      </Box>

      {/* Commits */}
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text bold>{" Recent Commits"}</Text>
        <CommitFeed commits={commits} />
      </Box>

      {/* Workers */}
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text bold>{" Workers"}</Text>
        <WorkerTable workers={colony.statusData?.workers ?? []} />
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          {"  Ctrl+C to exit | /commander in Claude Code/OpenCode to control"}
        </Text>
      </Box>
    </Box>
  );
}
```

**Step 9: Rewrite App.tsx and index.tsx**

Replace `App.tsx` with a simple wrapper around `MonitorApp`. Remove all view routing, `useInput`, and interactive logic. The TTY check in `index.tsx` remains.

**Step 10: Update src/index.ts TUI entry**

The TUI entry should no longer check for `hasSubcommand` — just use `process.argv.length <= 2`:

```typescript
if (process.argv.length <= 2) {
  const { startTUI } = await import("./tui/index.js");
  await startTUI(process.cwd());
} else {
  program.parse();
}
```

**Step 11: Build and verify**

Run: `cd commander && npm run build && npm test`

**Step 12: Commit**

```bash
git add -A commander/src/tui/ commander/package.json
git commit -m "feat: replace interactive TUI with read-only monitor dashboard"
```

---

## Phase 6: Skills Rewrite

### Task 6: Rewrite Claude Code and OpenCode skills

**Files:**
- Modify: `commander/plugins/claude-code/skills/commander/SKILL.md`
- Modify: `commander/plugins/opencode/SKILL.md`

**Step 1: Rewrite Claude Code SKILL.md**

Focus on:
- Signal decomposition standards for weak models
- White ant protocol control (plan/status/stop/workers/resume)
- Multiple trigger phrases (中英文)
- --plan and --context衔接方式
- Model configuration guidance

**Step 2: Rewrite OpenCode SKILL.md**

Compact version of the same content.

**Step 3: Commit**

```bash
git add commander/plugins/
git commit -m "feat: rewrite skills — focus on signal decomposition standards + protocol control"
```

---

## Phase 7: Cleanup + CLAUDE.md Update

### Task 7: Update docs and verify end-to-end

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/plans/2026-03-04-commander-ux-design.md`

**Step 1: Update CLAUDE.md**

- Update pipeline description (2 phases instead of 6)
- Add --plan/--context to CLI docs
- Add model config section (env vars + opencode.json)
- Update TUI section (read-only monitor)
- Update conventions (mixed-model workers)

**Step 2: Build final + run all tests**

Run: `cd commander && npm run build && npm test`

**Step 3: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: update CLAUDE.md and design docs for Commander v2"
```
