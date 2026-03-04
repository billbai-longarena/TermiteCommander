import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TaskClassifier } from "./classifier.js";
import { SignalDecomposer, type DecomposedSignal } from "./decomposer.js";
import { SignalBridge } from "../colony/signal-bridge.js";
import { PlanWriter, type Plan } from "../colony/plan-writer.js";
import { CommanderLoop } from "../heartbeat/commander-loop.js";
import { ColonyLoop, type Platform } from "../heartbeat/colony-loop.js";
import { callLLM, type LLMConfig } from "../llm/provider.js";
import { OpenCodeLauncher } from "../colony/opencode-launcher.js";

export interface PipelineConfig {
  colonyRoot: string;
  platform: "opencode" | "claude-code" | "unknown";
  llmConfig?: LLMConfig;
  skillSourceDir: string; // path to commander/skills/termite/
  maxWorkers?: number;
}

export class Pipeline {
  private config: PipelineConfig;
  private bridge: SignalBridge;
  private launcher: OpenCodeLauncher;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.bridge = new SignalBridge(config.colonyRoot);
    this.launcher = new OpenCodeLauncher({
      colonyRoot: config.colonyRoot,
      skillSourceDir: config.skillSourceDir,
      maxWorkers: config.maxWorkers ?? 3,
    });
  }

  private writeLockFile(objective: string): void {
    const lockPath = join(this.config.colonyRoot, "commander.lock");
    const data = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      objective,
    };
    writeFileSync(lockPath, JSON.stringify(data, null, 2), "utf-8");
  }

  private writeStatusFile(plan: Plan): void {
    const statusPath = join(this.config.colonyRoot, ".commander-status.json");
    const workers = this.launcher.getWorkers().map((w) => ({
      id: w.id,
      status: w.status,
      sessionId: w.sessionId,
      startedAt: w.startedAt.toISOString(),
    }));
    const data = {
      updatedAt: new Date().toISOString(),
      pid: process.pid,
      objective: plan.objective,
      taskType: plan.taskType,
      signals: {
        total: plan.signals.length,
        open: plan.signals.filter((s) => s.status === "open").length,
        done: plan.signals.filter((s) => s.status === "done" || s.status === "completed").length,
      },
      workers,
      heartbeat: {
        activeWorkers: this.launcher.activeCount(),
        runningWorkers: this.launcher.runningCount(),
      },
    };
    writeFileSync(statusPath, JSON.stringify(data, null, 2), "utf-8");
  }

  private cleanupLockFile(): void {
    const lockPath = join(this.config.colonyRoot, "commander.lock");
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  async plan(
    objective: string,
    opts?: { planFile?: string; context?: string },
  ): Promise<Plan> {
    // Read design context from file or direct text
    let designContext = "";
    if (opts?.planFile) {
      console.log(`[commander] Reading design context from ${opts.planFile}...`);
      designContext = readFileSync(opts.planFile, "utf-8");
    } else if (opts?.context) {
      designContext = opts.context;
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
      deliverableFormat: taskType === "BUILD" ? "Code + tests" : "Analysis + code",
    };

    return plan;
  }

  async dispatch(plan: Plan): Promise<void> {
    console.log("[commander] Writing PLAN.md...");
    await PlanWriter.writeToDisk(plan, this.config.colonyRoot);

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
    // Write lock file to indicate Commander is running
    this.writeLockFile(plan.objective);

    await this.dispatch(plan);

    // Install termite skills into colony
    this.launcher.installSkills();

    // Write initial status
    this.writeStatusFile(plan);

    // Determine how many workers to launch based on parallel signals
    const parallelSignals = plan.signals.filter((s) => !s.parentId).length;
    const workerCount = Math.min(parallelSignals, this.config.maxWorkers ?? 3);

    console.log(`[commander] Launching ${workerCount} OpenCode workers...`);
    for (let i = 0; i < workerCount; i++) {
      await this.launcher.launchWorker();
    }

    // Start heartbeat loops
    const commanderLoop = new CommanderLoop({
      colonyRoot: this.config.colonyRoot,
      intervalMs: 60_000,
      stallThreshold: 10,
      onCycle: (snap) => {
        console.log(`[commander-hb] open=${snap.openSignals} claimed=${snap.claimedSignals} commits=${snap.newCommits} workers=${this.launcher.activeCount()}`);
        this.writeStatusFile(plan);
      },
      onHalt: (info) => {
        console.log(`[commander] HALTED: ${info.reason}. Stopping workers...`);
        this.launcher.stopAll();
        this.cleanupLockFile();
      },
    });

    const colonyLoop = new ColonyLoop({
      colonyRoot: this.config.colonyRoot,
      platform: "opencode",
      baseIntervalMs: 15_000,
      maxIntervalMs: 60_000,
      stallThreshold: 20,
      onCycle: async (snap, interval) => {
        // Pulse all idle workers on each colony heartbeat
        const pulsed = await this.launcher.pulseAllWorkers();
        console.log(`[colony-hb] open=${snap.openSignals} claimed=${snap.claimedSignals} running=${this.launcher.runningCount()} pulsed=${pulsed} interval=${Math.round(interval)}ms`);
      },
      onHalt: (reason) => {
        console.log(`[colony] Stopped: ${reason}`);
        this.launcher.stopAll();
        commanderLoop.stop();
        this.cleanupLockFile();
      },
    });

    // Handle process exit — cleanup lock on SIGINT and SIGTERM
    const cleanup = () => {
      console.log("\n[commander] Interrupted. Stopping...");
      this.launcher.stopAll();
      commanderLoop.stop();
      colonyLoop.stop();
      this.cleanupLockFile();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    await Promise.all([
      commanderLoop.start(),
      colonyLoop.start(),
    ]);
  }
}
