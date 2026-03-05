#!/usr/bin/env node

import { program } from "commander";
import { Pipeline, type PipelineConfig } from "./engine/pipeline.js";
import { SignalBridge } from "./colony/signal-bridge.js";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolveModels } from "./config/model-resolver.js";

function detectPlatform(): "opencode" | "claude-code" | "unknown" {
  if (process.env.CLAUDE_PROJECT_DIR) return "claude-code";
  if (process.env.OPENCODE_SESSION) return "opencode";
  return "unknown";
}

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8")
);

program
  .name("termite-commander")
  .description("Termite Commander — autonomous orchestration engine")
  .version(pkg.version);

program
  .command("install")
  .description("Install Commander skills into current project (Claude Code plugin + OpenCode skill)")
  .option("-c, --colony <path>", "Project root directory", process.cwd())
  .action(async (opts: { colony: string }) => {
    const { OpenCodeLauncher } = await import("./colony/opencode-launcher.js");
    const launcher = new OpenCodeLauncher({
      colonyRoot: opts.colony,
      skillSourceDir: resolve(import.meta.dirname ?? ".", "../skills/termite"),
      workerSpecs: [],
      defaultWorkerModel: "",
    });

    try {
      launcher.installSkills();
    } catch (err: any) {
      console.error(`\nInstallation failed: ${err.message}`);
      process.exit(1);
    }

    // Check OpenCode availability
    const hasOpenCode = await launcher.checkOpenCode();
    if (!hasOpenCode) {
      console.warn("\nWarning: 'opencode' CLI not found in PATH.");
      console.warn("Workers need OpenCode to run. Install: https://github.com/nicepkg/opencode");
    }

    console.log("\nCommander skills installed. Available commands:");
    console.log("  Claude Code: /commander <objective>");
    console.log("  OpenCode:    /commander <objective>");
    console.log("\nTrigger phrases: /commander, 让蚁群干活, 让白蚁施工, deploy termites");
  });

program
  .command("plan <objective>")
  .description("Plan and decompose an objective into colony signals")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("-p, --plan <file>", "Design document to use as decomposition context")
  .option("--context <text>", "Direct text context for decomposition")
  .option("--dispatch", "Dispatch signals immediately after planning", false)
  .option("--run", "Plan, dispatch, and start heartbeats", false)
  .action(async (objective: string, opts: { colony: string; plan?: string; context?: string; dispatch: boolean; run: boolean }) => {
    const config: PipelineConfig = {
      colonyRoot: opts.colony,
      platform: detectPlatform(),
      skillSourceDir: resolve(import.meta.dirname ?? ".", "../skills/termite"),
    };

    const pipeline = new Pipeline(config);
    const plan = await pipeline.plan(objective, {
      planFile: opts.plan,
      context: opts.context,
    });

    console.log("\n=== PLAN ===");
    console.log(`Type: ${plan.taskType}`);
    console.log(`Signals: ${plan.signals.length}`);
    plan.signals.forEach((s) => console.log(`  ${s.id} [${s.type}] ${s.title}`));

    if (opts.run) {
      console.log("\n[commander] Starting colony execution...");
      console.log("[commander] Open another terminal and run 'termite-commander' for the live dashboard.");
      await pipeline.runWithHeartbeats(plan);
    } else if (opts.dispatch) {
      await pipeline.dispatch(plan);
      console.log("\nSignals dispatched. Run 'termite-commander watch' to monitor.");
    } else {
      console.log("\nPlan generated. Use --dispatch to send signals, or --run to start execution.");
    }
  });

program
  .command("status")
  .description("Show colony status")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--json", "Output as JSON", false)
  .action(async (opts: { colony: string; json: boolean }) => {
    const bridge = new SignalBridge(opts.colony);
    const status = await bridge.status();
    const models = resolveModels(opts.colony);
    const workersLabel = models.workers
      .map((w) => `${w.model ?? models.defaultWorkerModel} ×${w.count}`)
      .join(" | ");

    // Also read commander.lock and .commander-status.json if available
    const lockPath = join(opts.colony, "commander.lock");
    const statusFilePath = join(opts.colony, ".commander-status.json");
    let lockData: any = null;
    let statusFileData: any = null;

    if (existsSync(lockPath)) {
      try { lockData = JSON.parse(readFileSync(lockPath, "utf-8")); } catch {}
    }
    if (existsSync(statusFilePath)) {
      try { statusFileData = JSON.parse(readFileSync(statusFilePath, "utf-8")); } catch {}
    }

    if (opts.json) {
      console.log(JSON.stringify({ colony: status, commander: lockData, status: statusFileData, models }, null, 2));
    } else {
      const running = lockData ? `YES (PID ${lockData.pid})` : "NO";
      console.log(`Commander: ${running}`);
      if (lockData) {
        console.log(`  Objective: ${lockData.objective}`);
        console.log(`  Started:   ${lockData.startedAt}`);
      }
      console.log(`Signals: total=${status.total} open=${status.open} claimed=${status.claimed} done=${status.done}`);
      console.log(
        `Resolved Models: commander=${models.commanderModel} provider=${models.commanderProvider} workers=${workersLabel}`,
      );
      console.log(
        `Model Sources: commander=${models.resolution.commanderModel.source} (${models.resolution.commanderModel.detail})` +
        ` defaultWorker=${models.resolution.defaultWorkerModel.source} (${models.resolution.defaultWorkerModel.detail})` +
        ` workers=${models.resolution.workers.source} (${models.resolution.workers.detail})`,
      );
      if (statusFileData) {
        console.log(`Workers: active=${statusFileData.heartbeat?.activeWorkers ?? 0} running=${statusFileData.heartbeat?.runningWorkers ?? 0}`);
        if (statusFileData.models) {
          console.log(`Models: commander=${statusFileData.models.commander} workers=${statusFileData.models.workers}`);
          const resolution = statusFileData.models.resolution;
          if (resolution) {
            console.log(
              `  Sources: commander=${resolution.commanderModel?.source ?? "unknown"} (${resolution.commanderModel?.detail ?? "-"})` +
              ` defaultWorker=${resolution.defaultWorkerModel?.source ?? "unknown"} (${resolution.defaultWorkerModel?.detail ?? "-"})` +
              ` workers=${resolution.workers?.source ?? "unknown"} (${resolution.workers?.detail ?? "-"})`,
            );
          }
        }
        console.log(`Updated: ${statusFileData.updatedAt}`);
      }
    }
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
    console.log("Colony resumed. Run 'termite-commander plan --run' with new objectives.");
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

program
  .command("stop")
  .description("Stop a running Commander process")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .action(async (opts: { colony: string }) => {
    const lockPath = join(opts.colony, "commander.lock");

    if (!existsSync(lockPath)) {
      console.log("No commander.lock found. Commander is not running.");
      return;
    }

    let lockData: { pid: number; startedAt: string; objective: string };
    try {
      lockData = JSON.parse(readFileSync(lockPath, "utf-8"));
    } catch {
      console.error("Failed to parse commander.lock.");
      return;
    }

    console.log(`Stopping Commander (PID ${lockData.pid})...`);
    try {
      process.kill(lockData.pid, "SIGTERM");
      console.log("SIGTERM sent.");
    } catch (err: any) {
      if (err.code === "ESRCH") {
        console.log("Process not found (already exited).");
      } else {
        console.error(`Failed to kill process: ${err.message}`);
      }
    }

    // Clean up lock file and stale status
    try {
      unlinkSync(lockPath);
      console.log("commander.lock removed.");
    } catch {}

    const statusFilePath = join(opts.colony, ".commander-status.json");
    try {
      if (existsSync(statusFilePath)) {
        unlinkSync(statusFilePath);
        console.log(".commander-status.json removed.");
      }
    } catch {}

    console.log("Colony cleaned up. Ready for next run.");
  });

program
  .command("workers")
  .description("Show worker status")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--json", "Output as JSON", false)
  .action(async (opts: { colony: string; json: boolean }) => {
    const statusFilePath = join(opts.colony, ".commander-status.json");

    if (!existsSync(statusFilePath)) {
      console.log("No .commander-status.json found. Commander may not be running.");
      return;
    }

    let data: any;
    try {
      data = JSON.parse(readFileSync(statusFilePath, "utf-8"));
    } catch {
      console.error("Failed to parse .commander-status.json.");
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(data.workers ?? [], null, 2));
      return;
    }

    const workers = data.workers ?? [];
    if (workers.length === 0) {
      console.log("No workers found.");
      return;
    }

    console.log(`Workers (${workers.length}):`);
    console.log("  ID                              STATUS    SESSION             STARTED");
    console.log("  " + "-".repeat(80));
    for (const w of workers) {
      const sid = w.sessionId ? w.sessionId.slice(0, 16) + "..." : "-";
      const started = w.startedAt ? new Date(w.startedAt).toLocaleTimeString() : "-";
      console.log(`  ${w.id.padEnd(34)}${w.status.padEnd(10)}${sid.padEnd(20)}${started}`);
    }
  });

if (process.argv.length <= 2) {
  const { startTUI } = await import("./tui/index.js");
  await startTUI(process.cwd());
} else {
  program.parse();
}
