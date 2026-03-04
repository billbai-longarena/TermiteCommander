#!/usr/bin/env node

import { program } from "commander";
import { Pipeline, type PipelineConfig } from "./engine/pipeline.js";
import { SignalBridge } from "./colony/signal-bridge.js";
import { resolve } from "node:path";

function detectPlatform(): "opencode" | "claude-code" | "unknown" {
  if (process.env.CLAUDE_PROJECT_DIR) return "claude-code";
  if (process.env.OPENCODE_SESSION) return "opencode";
  return "unknown";
}

program
  .name("termite-commander")
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
      llmConfig: {
        provider: (process.env.COMMANDER_LLM_PROVIDER as any) ?? "azure-openai",
        model: process.env.COMMANDER_LLM_MODEL,
      },
      skillSourceDir: resolve(import.meta.dirname ?? ".", "../skills/termite"),
      maxWorkers: parseInt(process.env.COMMANDER_MAX_WORKERS ?? "3", 10),
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
