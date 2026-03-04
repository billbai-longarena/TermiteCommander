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
    await this.dispatch(plan);

    const commanderLoop = new CommanderLoop({
      colonyRoot: this.config.colonyRoot,
      intervalMs: 60_000,
      stallThreshold: 10,
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
      baseIntervalMs: 15_000,
      maxIntervalMs: 60_000,
      stallThreshold: 20,
      onCycle: (snap, interval) => {
        console.log(`[colony-hb] open=${snap.openSignals} claimed=${snap.claimedSignals} interval=${Math.round(interval)}ms`);
      },
      onHalt: (reason) => {
        console.log(`[colony] Stopped: ${reason}`);
        commanderLoop.stop();
      },
    });

    await Promise.all([
      commanderLoop.start(),
      colonyLoop.start(),
    ]);
  }
}
