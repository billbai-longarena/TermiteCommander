import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TaskClassifier } from "./classifier.js";
import { SignalDecomposer, type DecomposedSignal } from "./decomposer.js";
import { SignalBridge } from "../colony/signal-bridge.js";
import { PlanWriter, type Plan } from "../colony/plan-writer.js";
import { CommanderLoop } from "../heartbeat/commander-loop.js";
import { ColonyLoop, type Platform } from "../heartbeat/colony-loop.js";
import { callLLM, type LLMConfig } from "../llm/provider.js";
import { assertProviderCredentials, configFromResolved } from "../llm/provider.js";
import {
  resolveModels,
  type ResolvedModels,
  assertPlanningModelConfigured,
} from "../config/model-resolver.js";
import { OpenCodeLauncher } from "../colony/opencode-launcher.js";
import { ensureWorkspaceBoundary } from "../colony/workspace-boundary.js";
import { ensureTermiteProtocolInstalled } from "../colony/protocol-installer.js";

export interface PipelineConfig {
  colonyRoot: string;
  platform: "opencode" | "claude-code" | "unknown";
  llmConfig?: LLMConfig;
  skillSourceDir: string; // path to commander/skills/termite/
  // maxWorkers removed — driven by model-resolver
}

export class Pipeline {
  private config: PipelineConfig;
  private bridge: SignalBridge;
  private launcher: OpenCodeLauncher;
  private models: ResolvedModels;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.bridge = new SignalBridge(config.colonyRoot);
    this.models = resolveModels(config.colonyRoot);
    assertPlanningModelConfigured(this.models);
    this.logModelResolution();
    // Override llmConfig with resolved models
    this.config.llmConfig = configFromResolved(this.models);
    assertProviderCredentials(this.config.llmConfig.provider);
    this.launcher = new OpenCodeLauncher({
      colonyRoot: config.colonyRoot,
      skillSourceDir: config.skillSourceDir,
      workerSpecs: this.models.workers,
      defaultWorkerCli: this.models.defaultWorkerCli,
      defaultWorkerModel: this.models.defaultWorkerModel,
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
      cli: w.cli,
      model: w.model,
      pid: w.process?.pid ?? null,
      status: w.status,
      sessionId: w.sessionId,
      runId: w.runId,
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
      models: {
        commander: this.models.commanderModel,
        defaultWorkerCli: this.models.defaultWorkerCli,
        defaultWorkerModel: this.models.defaultWorkerModel,
        workers: this.models.workers.map(w =>
          `${w.cli}@${w.model ?? this.models.defaultWorkerModel} ×${w.count}`
        ).join(" | "),
        workerSpecs: this.models.workers,
        resolution: this.models.resolution,
      },
      workers,
      heartbeat: {
        activeWorkers: this.launcher.activeCount(),
        runningWorkers: this.launcher.runningCount(),
      },
    };
    writeFileSync(statusPath, JSON.stringify(data, null, 2), "utf-8");
  }

  private logModelResolution(): void {
    const workersLabel = this.models.workers
      .map((w) => `${w.cli}@${w.model ?? this.models.defaultWorkerModel} ×${w.count}`)
      .join(" | ");
    console.log("[commander] Model resolution:");
    console.log(
      `  commander=${this.models.commanderModel} provider=${this.models.commanderProvider} source=${this.models.resolution.commanderModel.source} (${this.models.resolution.commanderModel.detail})`,
    );
    console.log(
      `  defaultWorkerCli=${this.models.defaultWorkerCli} source=${this.models.resolution.defaultWorkerCli.source} (${this.models.resolution.defaultWorkerCli.detail})`,
    );
    console.log(
      `  defaultWorker=${this.models.defaultWorkerModel} source=${this.models.resolution.defaultWorkerModel.source} (${this.models.resolution.defaultWorkerModel.detail})`,
    );
    console.log(
      `  workers=${workersLabel} source=${this.models.resolution.workers.source} (${this.models.resolution.workers.detail})`,
    );
    for (const warning of this.models.issues.warnings) {
      console.warn(`[commander] Model config warning: ${warning}`);
    }
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

  private fallbackSignal(objective: string): DecomposedSignal {
    return {
      type: "HOLE",
      title: `Implement objective: ${objective.slice(0, 120)}`,
      weight: 80,
      source: "directive",
      parentId: null,
      childHint: null,
      module: "",
      nextHint: `Translate the objective into concrete code changes and tests. Objective: ${objective}`,
      acceptanceCriteria: "Code changes are implemented and tests pass.",
    };
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
    let signalsJson = "[]";
    let degradedDecomposition = false;
    try {
      signalsJson = await callLLM(decompositionPrompt, this.config.llmConfig);
    } catch (err: any) {
      degradedDecomposition = true;
      console.error(`[commander] Decomposition failed, using fallback signal: ${err?.message ?? "unknown error"}`);
      signalsJson = JSON.stringify([this.fallbackSignal(objective)]);
    }

    let signals: DecomposedSignal[] = [];
    try {
      const parsed = JSON.parse(signalsJson);
      if (!Array.isArray(parsed)) {
        throw new Error("LLM did not return a JSON array");
      }
      signals = parsed;
    } catch {
      degradedDecomposition = true;
      console.error("[commander] Failed to parse signals JSON, using fallback signal");
      signals = [this.fallbackSignal(objective)];
    }

    const { valid, errors } = SignalDecomposer.validateTree(signals);
    if (!valid) {
      console.warn("[commander] Signal validation warnings:", errors);
    }

    const originalIds = signals.map((_, i) => `S-${String(i + 1).padStart(3, "0")}`);
    const originalIdBySignal = new Map<DecomposedSignal, string>();
    signals.forEach((signal, i) => originalIdBySignal.set(signal, originalIds[i]));

    signals = SignalDecomposer.topologicalSort(signals);

    if (degradedDecomposition) {
      console.warn(
        "[commander] DEGRADED MODE: decomposition fallback was used. " +
        "Review PLAN.md and signal quality before large-scale execution.",
      );
    }

    const remappedIds = signals.map((_, i) => `S-${String(i + 1).padStart(3, "0")}`);
    const newIdByOriginalId = new Map<string, string>();
    signals.forEach((signal, i) => {
      const originalId = originalIdBySignal.get(signal);
      if (originalId) {
        newIdByOriginalId.set(originalId, remappedIds[i]);
      }
    });

    const plan: Plan = {
      objective,
      taskType,
      audience: "",
      researchFindings: "",
      userScenarios: "",
      architecture: null,
      synthesis: null,
      signals: signals.map((s, i) => ({
        id: remappedIds[i],
        type: s.type,
        title: s.title,
        weight: s.weight,
        parentId: s.parentId ? (newIdByOriginalId.get(s.parentId) ?? null) : null,
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
    const pending = [...plan.signals];
    const dbIdByPlanId = new Map<string, string>();

    while (pending.length > 0) {
      let progressed = false;

      for (let i = 0; i < pending.length; i++) {
        const signal = pending[i];
        const parentDbId = signal.parentId ? dbIdByPlanId.get(signal.parentId) : undefined;

        if (signal.parentId && !parentDbId) {
          continue;
        }

        const result = await this.bridge.createSignal({
          type: signal.type,
          title: signal.title,
          weight: signal.weight,
          source: "directive",
          parentId: parentDbId,
          module: "",
          nextHint: "",
        });

        if (result.exitCode !== 0) {
          throw new Error(`Failed to create signal ${signal.id}: ${result.stderr || "unknown error"}`);
        }

        const createdId = result.stdout.split(/\s+/).filter(Boolean).pop();
        if (!createdId) {
          throw new Error(`Signal ${signal.id} created but no DB ID was returned`);
        }

        dbIdByPlanId.set(signal.id, createdId);
        pending.splice(i, 1);
        i--;
        progressed = true;
      }

      if (!progressed) {
        const unresolved = pending.map((s) => `${s.id}(parent=${s.parentId ?? "null"})`).join(", ");
        throw new Error(`Unable to resolve signal dependency chain: ${unresolved}`);
      }
    }
    console.log("[commander] Signals dispatched to colony.");
  }

  /**
   * Ensure Termite Protocol is installed in the colony.
   * If scripts/termite-db.sh is missing, run install.sh from the protocol source.
   */
  async ensureProtocol(): Promise<void> {
    ensureTermiteProtocolInstalled({
      colonyRoot: this.config.colonyRoot,
      skillSourceDir: this.config.skillSourceDir,
      logger: (message) => console.log(message),
    });
    const setup = ensureWorkspaceBoundary(this.config.colonyRoot);
    if (setup.createdFiles.length > 0 || setup.createdDirs.length > 0 || setup.gitignoreUpdated) {
      console.log(
        `[commander] Workspace boundary initialized: dirs=${setup.createdDirs.length} files=${setup.createdFiles.length} gitignore=${setup.gitignoreUpdated ? "updated" : "ok"}`,
      );
    }
  }

  /**
   * Ensure colony is initialized (has .birth file).
   * Runs field-arrive.sh if .birth is missing.
   */
  async ensureGenesis(): Promise<void> {
    const birthFile = join(this.config.colonyRoot, ".birth");
    if (existsSync(birthFile)) {
      return;
    }

    const arriveScript = join(
      this.config.colonyRoot,
      "scripts",
      "field-arrive.sh",
    );
    if (!existsSync(arriveScript)) {
      console.warn("[commander] field-arrive.sh not found, skipping genesis.");
      return;
    }

    console.log("[commander] Running colony genesis (field-arrive.sh)...");
    const result = await this.bridge.exec("bash", [arriveScript]);
    if (result.exitCode === 0) {
      console.log("[commander] Colony genesis complete.");
    } else {
      console.warn(
        `[commander] field-arrive.sh exited with code ${result.exitCode}: ${result.stderr}`,
      );
    }
  }

  async runWithHeartbeats(
    plan: Plan,
    opts?: { skipRuntimeSmoke?: boolean; runtimeSmokeTimeoutMs?: number },
  ): Promise<void> {
    // Pre-flight checks
    const runtimeCheck = await this.launcher.checkRequiredRuntimes();
    if (runtimeCheck.missing.length > 0) {
      const installHints: Record<string, string> = {
        opencode: "opencode (https://github.com/nicepkg/opencode)",
        claude: "Claude Code CLI (command: claude)",
        codex: "Codex CLI (command: codex)",
        openclaw: "OpenClaw CLI (command: openclaw)",
      };
      const details = runtimeCheck.missing
        .map((runtime) => `  - ${runtime}: ${installHints[runtime] ?? "install corresponding CLI"}`)
        .join("\n");
      console.error(
        `[commander] Missing required worker CLIs:\n${details}\n` +
          `Configured workers: ${this.models.workers.map((w) => `${w.cli}@${w.model ?? this.models.defaultWorkerModel} ×${w.count}`).join(" | ")}`,
      );
      throw new Error(`Missing worker CLIs: ${runtimeCheck.missing.join(", ")}`);
    }

    const skipRuntimeSmoke = Boolean(opts?.skipRuntimeSmoke || process.env.TERMITE_SKIP_RUNTIME_SMOKE === "1");
    if (!skipRuntimeSmoke) {
      const timeoutMs = opts?.runtimeSmokeTimeoutMs ?? 30_000;
      console.log(`[commander] Running worker runtime/model smoke checks (timeout ${Math.floor(timeoutMs / 1000)}s)...`);
      const probes = await this.launcher.smokeTestConfiguredWorkers(timeoutMs);
      const failedProbes = probes.filter((probe) => !probe.ok && !probe.skipped);
      if (failedProbes.length > 0) {
        for (const probe of probes) {
          const mode = probe.skipped ? "SKIP" : probe.ok ? "OK" : "FAIL";
          console.error(
            `[commander] Runtime probe ${probe.runtime}@${probe.model ?? "<default>"} => ${mode}: ${probe.detail}`,
          );
        }
        throw new Error(
          "Worker runtime/model preflight failed. " +
          "Run 'termite-commander doctor --config --runtime --colony .' to inspect and fix.",
        );
      }
      const skippedCount = probes.filter((probe) => probe.skipped).length;
      console.log(
        `[commander] Runtime/model smoke checks passed (${probes.length - skippedCount}/${probes.length} executed).`,
      );
    } else {
      console.log("[commander] Runtime/model smoke checks skipped.");
    }

    // Ensure protocol + genesis before starting
    await this.ensureProtocol();
    await this.ensureGenesis();

    // Write lock file to indicate Commander is running
    this.writeLockFile(plan.objective);

    await this.dispatch(plan);

    // Install termite skills into colony
    this.launcher.installSkills();

    // Write initial status
    this.writeStatusFile(plan);

    console.log(`[commander] Launching worker fleet...`);
    await this.launcher.launchFleet();

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

    const workerCliSet = new Set(this.models.workers.map((w) => w.cli));
    const colonyPlatform: Platform =
      workerCliSet.size === 1 && workerCliSet.has("opencode")
        ? "opencode"
        : "unknown";

    const colonyLoop = new ColonyLoop({
      colonyRoot: this.config.colonyRoot,
      platform: colonyPlatform,
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
