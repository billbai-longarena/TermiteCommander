#!/usr/bin/env node

import { program } from "commander";
import { Pipeline, type PipelineConfig } from "./engine/pipeline.js";
import { SignalBridge } from "./colony/signal-bridge.js";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { readTermiteConfigWithPath, resolveModels, type ResolvedModels } from "./config/model-resolver.js";
import { ensureWorkspaceBoundary } from "./colony/workspace-boundary.js";
import { checkProviderCredentials, callLLM, configFromResolved } from "./llm/provider.js";
import {
  getTermiteConfigPath,
  importExternalConfig,
  mergeImportedConfig,
  writeTermiteConfig,
  type ExternalConfigSource,
} from "./config/importer.js";
import { OpenCodeLauncher, type RuntimeSmokeProbe } from "./colony/opencode-launcher.js";
import { ensureTermiteProtocolInstalled } from "./colony/protocol-installer.js";

function detectPlatform(): "opencode" | "claude-code" | "unknown" {
  if (process.env.CLAUDE_PROJECT_DIR) return "claude-code";
  if (process.env.OPENCODE_SESSION) return "opencode";
  return "unknown";
}

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8")
);

const importSourceValues: ExternalConfigSource[] = ["auto", "opencode", "claude", "codex"];

function parseImportSource(value: string): ExternalConfigSource {
  const normalized = value.toLowerCase().trim();
  if (importSourceValues.includes(normalized as ExternalConfigSource)) {
    return normalized as ExternalConfigSource;
  }
  throw new Error(`Invalid --from source '${value}'. Use one of: ${importSourceValues.join(", ")}`);
}

function getCredentialStatus(models: ReturnType<typeof resolveModels>): {
  enabled: boolean;
  ok: boolean;
  provider: string;
  detail: string;
  missing: string[];
} {
  if (!models.commanderModel) {
    return {
      enabled: false,
      ok: false,
      provider: models.commanderProvider,
      detail: "Skipped because commander model is missing.",
      missing: [],
    };
  }

  const status = checkProviderCredentials(models.commanderProvider);
  return {
    enabled: true,
    ok: status.ok,
    provider: status.provider,
    detail: status.detail,
    missing: status.missing,
  };
}

function isProcessAlive(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err?.code === "EPERM") return true;
    return false;
  }
}

function getHeartbeatAgeSeconds(statusFileData: unknown): number | null {
  if (!statusFileData || typeof statusFileData !== "object") return null;
  const updatedAt = (statusFileData as Record<string, unknown>).updatedAt;
  if (typeof updatedAt !== "string" || !updatedAt.trim()) return null;
  const updatedMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedMs)) return null;
  const ageSec = Math.floor((Date.now() - updatedMs) / 1000);
  return ageSec >= 0 ? ageSec : 0;
}

function formatRuntimeProbeLabel(probe: RuntimeSmokeProbe): string {
  const model = probe.model ?? "<default>";
  const mode = probe.skipped ? "SKIP" : probe.ok ? "OK" : "FAIL";
  return `${probe.runtime}@${model}: ${mode} (${probe.detail})`;
}

function createLauncher(colonyRoot: string, resolved: ReturnType<typeof resolveModels>): OpenCodeLauncher {
  return new OpenCodeLauncher({
    colonyRoot,
    skillSourceDir: resolve(import.meta.dirname ?? ".", "../skills/termite"),
    workerSpecs: resolved.workers,
    defaultWorkerCli: resolved.defaultWorkerCli,
    defaultWorkerModel: resolved.defaultWorkerModel,
  });
}

async function runWorkerRuntimePreflight(
  colonyRoot: string,
  resolved: ResolvedModels,
  timeoutMs: number,
): Promise<{
  required: string[];
  available: string[];
  missing: string[];
  probes: RuntimeSmokeProbe[];
}> {
  const launcher = createLauncher(colonyRoot, resolved);
  const runtimeCheck = await launcher.checkRequiredRuntimes();
  const probes =
    runtimeCheck.missing.length === 0
      ? await launcher.smokeTestConfiguredWorkers(timeoutMs)
      : [];

  return {
    required: runtimeCheck.required,
    available: runtimeCheck.available,
    missing: runtimeCheck.missing,
    probes,
  };
}

async function probeCommanderModel(
  resolved: ResolvedModels,
  timeoutMs: number,
): Promise<{ enabled: boolean; ok: boolean; detail: string }> {
  if (!resolved.commanderModel) {
    return {
      enabled: false,
      ok: false,
      detail: "Skipped because commander model is missing.",
    };
  }

  const llmConfig = configFromResolved(resolved);
  try {
    const response = await Promise.race([
      callLLM("Reply with exactly: OK", llmConfig),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${Math.floor(timeoutMs / 1000)}s`)), timeoutMs),
      ),
    ]);
    return {
      enabled: true,
      ok: true,
      detail: `Probe succeeded (${llmConfig.provider}/${llmConfig.model}): ${response.slice(0, 80)}`,
    };
  } catch (err: any) {
    return {
      enabled: true,
      ok: false,
      detail: `Probe failed (${llmConfig.provider}/${llmConfig.model}): ${err?.message ?? "unknown error"}`,
    };
  }
}

program
  .name("termite-commander")
  .description("Termite Commander — autonomous orchestration engine")
  .version(pkg.version);

program.addHelpText(
  "after",
  `
Quick Start (new project):
  1) termite-commander init --colony .
  2) termite-commander plan "<objective>" --plan .termite/worker/PLAN.md --colony . --run
  3) termite-commander status --colony .

Minimal Runtime Notes:
  - No args: opens read-only TUI dashboard.
  - commander.model is required before planning.
  - plan --run auto-installs Termite Protocol if missing.
  - Install at least one worker CLI used by your config: opencode/claude/codex/openclaw.
`
);

program
  .command("init")
  .description("One-shot onboarding: protocol + skills + config bootstrap + doctor")
  .option("-c, --colony <path>", "Project root directory", process.cwd())
  .option("--from <source>", "Import source: auto | opencode | claude | codex", "auto")
  .option("--force", "Override existing termite.config.json values during bootstrap", false)
  .option("--runtime-timeout <sec>", "Runtime/model smoke timeout per probe (seconds)", "30")
  .option("--dashboard <mode>", "Dashboard mode: auto | tui | watch | off", "auto")
  .option("--json", "Output as JSON", false)
  .addHelpText(
    "after",
    `
Default flow:
  1) Ensure Termite Protocol is installed (creates AGENTS.md / CLAUDE.md when missing)
  2) Install Commander skills/plugins into the project
  3) Bootstrap model config from opencode/claude/codex config
  4) Run config + credential + runtime/model preflight checks
  5) Optionally start dashboard monitor (auto mode only in agent sessions)

Examples:
  termite-commander init --colony .
  termite-commander init --colony . --from codex --dashboard off
`
  )
  .action(async (opts: {
    colony: string;
    from: string;
    force: boolean;
    runtimeTimeout: string;
    dashboard: string;
    json: boolean;
  }) => {
    try {
      const source = parseImportSource(opts.from);
      const timeoutSecRaw = parseInt(opts.runtimeTimeout, 10);
      const timeoutMs = Number.isNaN(timeoutSecRaw) || timeoutSecRaw <= 0 ? 30_000 : timeoutSecRaw * 1000;
      const dashboardMode = (opts.dashboard ?? "auto").toLowerCase().trim();
      if (!["auto", "tui", "watch", "off"].includes(dashboardMode)) {
        throw new Error("Invalid --dashboard mode. Use: auto | tui | watch | off");
      }

      const skillSourceDir = resolve(import.meta.dirname ?? ".", "../skills/termite");

      const protocolResult = ensureTermiteProtocolInstalled({
        colonyRoot: opts.colony,
        skillSourceDir,
        logger: (message) => {
          if (!opts.json) console.log(message);
        },
      });

      const resolvedForInstall = resolveModels(opts.colony);
      const launcher = createLauncher(opts.colony, resolvedForInstall);
      launcher.installSkills();
      const setup = ensureWorkspaceBoundary(opts.colony);
      if (!opts.json && (setup.createdFiles.length > 0 || setup.createdDirs.length > 0 || setup.gitignoreUpdated)) {
        console.log(
          `[launcher] Workspace boundary initialized: dirs=${setup.createdDirs.length} files=${setup.createdFiles.length} gitignore=${setup.gitignoreUpdated ? "updated" : "ok"}`,
        );
      }

      const selection = importExternalConfig(opts.colony, source);
      const selected = selection.selected;
      const existingLookup = readTermiteConfigWithPath(opts.colony);
      const targetPath = getTermiteConfigPath(opts.colony);
      let mergeResult: ReturnType<typeof mergeImportedConfig> | null = null;
      let applied = false;

      if (selected?.recommended) {
        mergeResult = mergeImportedConfig(existingLookup.config, selected.recommended, opts.force);
        if (mergeResult.changes.length > 0) {
          writeTermiteConfig(targetPath, mergeResult.merged);
          applied = true;
        }
      }

      const resolved = resolveModels(opts.colony);
      const credentials = getCredentialStatus(resolved);
      const configOk = resolved.issues.errors.length === 0;
      const credentialsOk = !credentials.enabled || credentials.ok;
      const commanderProbe = await probeCommanderModel(resolved, timeoutMs);
      const runtime = await runWorkerRuntimePreflight(opts.colony, resolved, timeoutMs);
      const failedProbes = runtime.probes.filter((probe) => !probe.ok && !probe.skipped);
      const runtimeOk = runtime.missing.length === 0 && failedProbes.length === 0;
      const ok = configOk && credentialsOk && commanderProbe.ok && runtimeOk;

      const report = {
        ok,
        colony: opts.colony,
        from: source,
        protocol: protocolResult,
        skillsInstalled: true,
        workspaceBoundary: setup,
        bootstrap: {
          selected,
          candidates: selection.candidates,
          targetPath,
          applied,
          merge: mergeResult,
        },
        doctor: {
          config: { ok: configOk, issues: resolved.issues, resolved },
          credentials: { ...credentials, ok: credentialsOk },
          commanderProbe,
          runtime: {
            required: runtime.required,
            available: runtime.available,
            missing: runtime.missing,
            probes: runtime.probes,
          },
        },
      };

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log("\n=== INIT SUMMARY ===");
        console.log(`Protocol: ${protocolResult.installed ? `INSTALLED (${protocolResult.source})` : "ALREADY INSTALLED"}`);
        console.log("Skills: INSTALLED");
        console.log(`Config bootstrap source: ${source}`);
        if (selected) {
          console.log(
            `  Selected: ${selected.source} (confidence ${(selected.confidence * 100).toFixed(1)}%)` +
              `${selected.path ? ` from ${selected.path}` : ""}`,
          );
        } else {
          console.log("  Selected: none (kept existing config)");
        }
        if (mergeResult) {
          console.log(
            applied
              ? `  Applied: yes -> ${targetPath}`
              : "  Applied: no (existing config already satisfied merge policy)",
          );
        } else {
          console.log("  Applied: no (no valid source selected)");
        }
        console.log(`Doctor config: ${configOk ? "OK" : "FAIL"}`);
        console.log(`Doctor credentials: ${credentialsOk ? "OK" : "FAIL"} (${credentials.detail})`);
        console.log(`Doctor commander probe: ${commanderProbe.ok ? "OK" : "FAIL"} (${commanderProbe.detail})`);
        console.log(`Doctor runtime binaries: ${runtime.missing.length === 0 ? "OK" : `FAIL (${runtime.missing.join(", ")})`}`);
        if (runtime.probes.length > 0) {
          console.log("Doctor runtime probes:");
          for (const probe of runtime.probes) {
            console.log(`  - ${formatRuntimeProbeLabel(probe)}`);
          }
        }
        if (resolved.issues.errors.length > 0) {
          console.log("Model config errors:");
          for (const err of resolved.issues.errors) {
            console.log(`  - ${err}`);
          }
        }
        if (resolved.issues.warnings.length > 0) {
          console.log("Model config warnings:");
          for (const warn of resolved.issues.warnings) {
            console.log(`  - ${warn}`);
          }
        }
      }

      if (!ok) {
        if (!opts.json) {
          console.log("\nSuggested fix flow:");
          console.log("  1) termite-commander config bootstrap --from auto --colony . --force");
          console.log("  2) termite-commander doctor --config --runtime --colony .");
          console.log("  3) Fix failing runtime/model probe from the doctor output.");
        }
        process.exit(1);
      }

      if (!opts.json) {
        console.log("\nInit complete. Next:");
        console.log('  termite-commander plan "<objective>" --plan .termite/worker/PLAN.md --colony . --run');
      }

      const autoDashboard = dashboardMode === "auto";
      const agentSession =
        Boolean(process.env.CODEX_CLI) ||
        Boolean(process.env.CLAUDE_PROJECT_DIR) ||
        Boolean(process.env.OPENCODE_SESSION);
      const shouldStartTui =
        dashboardMode === "tui" ||
        (autoDashboard && agentSession && process.stdout.isTTY && process.stdin.isTTY);
      const shouldStartWatch =
        dashboardMode === "watch" ||
        (autoDashboard && agentSession && !shouldStartTui);

      if (shouldStartTui) {
        if (!opts.json) {
          console.log("\nStarting TUI dashboard (Ctrl+C to exit)...");
        }
        const { startTUI } = await import("./tui/index.js");
        await startTUI(opts.colony);
        return;
      }

      if (shouldStartWatch) {
        if (!opts.json) {
          console.log("\nStarting watch monitor (Ctrl+C to exit)...");
        }
        const bridge = new SignalBridge(opts.colony);
        const tick = async () => {
          const status = await bridge.status();
          const stall = await bridge.checkStall(5);
          process.stdout.write(
            `\r[${new Date().toISOString()}] total=${status.total} open=${status.open} claimed=${status.claimed} done=${status.done} stall=${stall.stalled}   `,
          );
        };
        await tick();
        setInterval(tick, 5000);
      }
    } catch (err: any) {
      console.error(`[init] failed: ${err?.message ?? "unknown error"}`);
      process.exit(1);
    }
  });

program
  .command("install")
  .description("Install Commander skills into current project (Claude Code plugin + OpenCode skill)")
  .option("-c, --colony <path>", "Project root directory", process.cwd())
  .addHelpText(
    "after",
    `
What gets installed:
  - Termite Protocol (if missing): scripts/, signals/, AGENTS.md / CLAUDE.md
  - .opencode/skill/termite/ (worker protocol skills)
  - .opencode/skill/commander/ (OpenCode commander skill)
  - .claude/plugins/termite-commander/ (Claude Code plugin)
  - .termite/{human,worker}/ workspace boundary files

Example:
  termite-commander install --colony .
`
  )
  .action(async (opts: { colony: string }) => {
    const skillSourceDir = resolve(import.meta.dirname ?? ".", "../skills/termite");
    const resolved = resolveModels(opts.colony);
    const launcher = createLauncher(opts.colony, resolved);

    try {
      ensureTermiteProtocolInstalled({
        colonyRoot: opts.colony,
        skillSourceDir,
        logger: (message) => console.log(message.replace("[commander]", "[launcher]")),
      });
      launcher.installSkills();
      const setup = ensureWorkspaceBoundary(opts.colony);
      if (setup.createdFiles.length > 0 || setup.createdDirs.length > 0 || setup.gitignoreUpdated) {
        console.log(
          `[launcher] Workspace boundary initialized: dirs=${setup.createdDirs.length} files=${setup.createdFiles.length} gitignore=${setup.gitignoreUpdated ? "updated" : "ok"}`,
        );
      }
    } catch (err: any) {
      console.error(`\nInstallation failed: ${err.message}`);
      process.exit(1);
    }

    // Check worker runtime CLIs for current config
    const runtimeCheck = await launcher.checkRequiredRuntimes();
    if (runtimeCheck.missing.length > 0) {
      console.warn(`\nWarning: missing worker CLIs: ${runtimeCheck.missing.join(", ")}`);
      for (const runtime of runtimeCheck.missing) {
        if (runtime === "opencode") {
          console.warn("  - opencode: https://github.com/nicepkg/opencode");
        } else if (runtime === "claude") {
          console.warn("  - claude: install Claude Code CLI");
        } else if (runtime === "codex") {
          console.warn("  - codex: install Codex CLI");
        } else if (runtime === "openclaw") {
          console.warn("  - openclaw: install OpenClaw CLI");
        }
      }
    } else {
      console.log(`\nWorker CLIs ready: ${runtimeCheck.available.join(", ")}`);
    }

    if (resolved.issues.errors.length > 0) {
      console.warn("\nModel config errors (planning is blocked until fixed):");
      for (const error of resolved.issues.errors) {
        console.warn(`  - ${error}`);
      }
    }
    if (resolved.issues.warnings.length > 0) {
      console.warn("\nModel config warnings:");
      for (const warning of resolved.issues.warnings) {
        console.warn(`  - ${warning}`);
      }
    }

    console.log("\nCommander skills installed. Available commands:");
    console.log("  Claude Code: /commander <objective>");
    console.log("  OpenCode:    /commander <objective>");
    console.log("\nTrigger phrases: /commander, 让蚁群干活, 让白蚁施工, deploy termites");
    console.log("\nRecommended next steps:");
    console.log("  1) termite-commander config bootstrap --from auto --colony .");
    console.log("  2) termite-commander doctor --config --runtime --colony .");
    console.log('  3) termite-commander plan "<objective>" --plan .termite/worker/PLAN.md --colony . --run');
  });

program
  .command("plan <objective>")
  .description("Plan and decompose an objective into colony signals")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("-p, --plan <file>", "Design document to use as decomposition context")
  .option("--context <text>", "Direct text context for decomposition")
  .option("--dispatch", "Dispatch signals immediately after planning", false)
  .option("--run", "Plan, dispatch, and start heartbeats", false)
  .option("--skip-runtime-smoke", "Skip worker runtime/model smoke tests before --run", false)
  .option("--runtime-timeout <sec>", "Runtime/model smoke timeout per probe (seconds)", "30")
  .addHelpText(
    "after",
    `
Examples:
  termite-commander plan "Build OAuth2 auth" --plan .termite/worker/PLAN.md --colony . --run
  termite-commander plan "Fix flaky CI tests" --context "root cause + fix strategy" --colony . --dispatch

Execution modes:
  --dispatch   plan + dispatch only
  --run        plan + dispatch + protocol check/install + worker fleet + heartbeats
  (default preflight includes runtime/model smoke; disable with --skip-runtime-smoke)
`
  )
  .action(async (objective: string, opts: {
    colony: string;
    plan?: string;
    context?: string;
    dispatch: boolean;
    run: boolean;
    skipRuntimeSmoke: boolean;
    runtimeTimeout: string;
  }) => {
    try {
      const defaultWorkerPlanPath = join(opts.colony, ".termite", "worker", "PLAN.md");
      const planFile =
        opts.plan ??
        (!opts.context && existsSync(defaultWorkerPlanPath) ? defaultWorkerPlanPath : undefined);
      if (!opts.plan && planFile === defaultWorkerPlanPath) {
        console.log(`[commander] Using default worker plan: ${defaultWorkerPlanPath}`);
      }

      const config: PipelineConfig = {
        colonyRoot: opts.colony,
        platform: detectPlatform(),
        skillSourceDir: resolve(import.meta.dirname ?? ".", "../skills/termite"),
      };

      const pipeline = new Pipeline(config);
      const plan = await pipeline.plan(objective, {
        planFile,
        context: opts.context,
      });

      console.log("\n=== PLAN ===");
      console.log(`Type: ${plan.taskType}`);
      console.log(`Signals: ${plan.signals.length}`);
      plan.signals.forEach((s) => console.log(`  ${s.id} [${s.type}] ${s.title}`));

      if (opts.run) {
        console.log("\n[commander] Starting colony execution...");
        console.log("[commander] Open another terminal and run 'termite-commander' for the live dashboard.");
        const timeoutSecRaw = parseInt(opts.runtimeTimeout, 10);
        const runtimeSmokeTimeoutMs =
          Number.isNaN(timeoutSecRaw) || timeoutSecRaw <= 0 ? 30_000 : timeoutSecRaw * 1000;
        await pipeline.runWithHeartbeats(plan, {
          skipRuntimeSmoke: opts.skipRuntimeSmoke,
          runtimeSmokeTimeoutMs,
        });
      } else if (opts.dispatch) {
        await pipeline.dispatch(plan);
        console.log("\nSignals dispatched. Run 'termite-commander watch' to monitor.");
      } else {
        console.log("\nPlan generated. Use --dispatch to send signals, or --run to start execution.");
      }
    } catch (err: any) {
      console.error(`\n[commander] Plan failed: ${err?.message ?? "unknown error"}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show colony status")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--json", "Output as JSON", false)
  .addHelpText(
    "after",
    `
Examples:
  termite-commander status --colony .
  termite-commander status --colony . --json
`
  )
  .action(async (opts: { colony: string; json: boolean }) => {
    const bridge = new SignalBridge(opts.colony);
    const protocolInstalled = bridge.hasScripts();
    const status = await bridge.status();
    const models = resolveModels(opts.colony);
    const workersLabel = models.workers
      .map((w) => `${w.cli}@${w.model ?? models.defaultWorkerModel} ×${w.count}`)
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

    const pidAlive = lockData ? isProcessAlive(lockData.pid) : false;
    const staleLock = Boolean(lockData && !pidAlive);
    const heartbeatAgeSec = getHeartbeatAgeSeconds(statusFileData);
    const heartbeatStale = heartbeatAgeSec !== null && heartbeatAgeSec > 120;

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            protocolInstalled,
            colony: status,
            commander: lockData,
            status: statusFileData,
            runtimeHealth: {
              lockPresent: Boolean(lockData),
              pidAlive,
              staleLock,
              heartbeatAgeSec,
              heartbeatStale,
            },
            models,
          },
          null,
          2,
        ),
      );
    } else {
      let running = "NO";
      if (lockData && pidAlive) {
        running = `YES (PID ${lockData.pid})`;
      } else if (lockData && !pidAlive) {
        running = `STALE (lock PID ${lockData.pid} not running)`;
      }
      console.log(`Commander: ${running}`);
      if (staleLock) {
        console.log("  Tip: run 'termite-commander stop --colony .' to clean stale lock/status files.");
      }
      console.log(`Protocol: ${protocolInstalled ? "INSTALLED" : "MISSING"}`);
      if (!protocolInstalled) {
        console.log("  Tip: run 'termite-commander plan <objective> --run' to auto-install protocol.");
      }
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
        ` defaultWorkerCli=${models.resolution.defaultWorkerCli.source} (${models.resolution.defaultWorkerCli.detail})` +
        ` defaultWorker=${models.resolution.defaultWorkerModel.source} (${models.resolution.defaultWorkerModel.detail})` +
        ` workers=${models.resolution.workers.source} (${models.resolution.workers.detail})`,
      );
      if (models.issues.errors.length > 0) {
        console.log("Model Config Errors:");
        for (const error of models.issues.errors) {
          console.log(`  - ${error}`);
        }
      }
      if (models.issues.warnings.length > 0) {
        console.log("Model Config Warnings:");
        for (const warning of models.issues.warnings) {
          console.log(`  - ${warning}`);
        }
      }
      if (statusFileData) {
        console.log(`Workers: active=${statusFileData.heartbeat?.activeWorkers ?? 0} running=${statusFileData.heartbeat?.runningWorkers ?? 0}`);
        if (heartbeatAgeSec !== null) {
          console.log(`Heartbeat: ${heartbeatStale ? "STALE" : "OK"} (${heartbeatAgeSec}s ago)`);
        } else {
          console.log("Heartbeat: unknown");
        }
        if (statusFileData.models) {
          console.log(
            `Models: commander=${statusFileData.models.commander}` +
            ` defaultWorkerCli=${statusFileData.models.defaultWorkerCli ?? "-"}` +
            ` defaultWorkerModel=${statusFileData.models.defaultWorkerModel ?? "-"}` +
            ` workers=${statusFileData.models.workers}`,
          );
          const resolution = statusFileData.models.resolution;
          if (resolution) {
            console.log(
              `  Sources: commander=${resolution.commanderModel?.source ?? "unknown"} (${resolution.commanderModel?.detail ?? "-"})` +
              ` defaultWorkerCli=${resolution.defaultWorkerCli?.source ?? "unknown"} (${resolution.defaultWorkerCli?.detail ?? "-"})` +
              ` defaultWorker=${resolution.defaultWorkerModel?.source ?? "unknown"} (${resolution.defaultWorkerModel?.detail ?? "-"})` +
              ` workers=${resolution.workers?.source ?? "unknown"} (${resolution.workers?.detail ?? "-"})`,
            );
          }
        }
        console.log(`Updated: ${statusFileData.updatedAt}`);
      }
    }
  });

const configCommand = program
  .command("config")
  .description("Configuration utilities")
  .addHelpText(
    "after",
    `
Recommended init flow:
  termite-commander init --colony .

Manual flow:
  termite-commander config bootstrap --from auto --colony .
  termite-commander doctor --config --runtime --colony .
`
  );

configCommand
  .command("import")
  .description("Import model settings from other CLI configs into termite.config.json")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--from <source>", "Import source: auto | opencode | claude | codex", "auto")
  .option("--apply", "Write merged result to termite.config.json", false)
  .option("--force", "Override existing termite.config.json values", false)
  .option("--json", "Output as JSON", false)
  .addHelpText(
    "after",
    `
Examples:
  termite-commander config import --from auto --colony .
  termite-commander config import --from codex --apply --colony .
`
  )
  .action((opts: { colony: string; from: string; apply: boolean; force: boolean; json: boolean }) => {
    try {
      const source = parseImportSource(opts.from);
      const selection = importExternalConfig(opts.colony, source);
      const selected = selection.selected;
      const existingLookup = readTermiteConfigWithPath(opts.colony);
      const targetPath = getTermiteConfigPath(opts.colony);

      const mergeResult =
        selected?.recommended
          ? mergeImportedConfig(existingLookup.config, selected.recommended, opts.force)
          : null;
      const shouldWrite = Boolean(opts.apply && mergeResult && mergeResult.changes.length > 0);

      if (shouldWrite && mergeResult) {
        writeTermiteConfig(targetPath, mergeResult.merged);
      }

      const resolved = resolveModels(opts.colony);
      const credentials = getCredentialStatus(resolved);
      const payload = {
        colony: opts.colony,
        from: source,
        apply: opts.apply,
        force: opts.force,
        targetPath,
        selected,
        candidates: selection.candidates,
        merge: mergeResult,
        applied: shouldWrite,
        effectiveConfig: {
          commanderModel: resolved.commanderModel,
          commanderProvider: resolved.commanderProvider,
          defaultWorkerCli: resolved.defaultWorkerCli,
          defaultWorkerModel: resolved.defaultWorkerModel,
          workers: resolved.workers,
          issues: resolved.issues,
          credentials,
        },
      };

      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        if (opts.apply && !selected) {
          process.exit(1);
        }
        return;
      }

      console.log(`Config import source: ${source}`);
      if (selected) {
        console.log(
          `Selected: ${selected.source} (confidence ${(selected.confidence * 100).toFixed(1)}%) ` +
          `${selected.path ? `from ${selected.path}` : ""}`,
        );
      } else {
        console.log("Selected: none (no source provided a valid commander.model)");
      }

      if (selection.candidates.length > 0) {
        console.log("Candidates:");
        for (const candidate of selection.candidates) {
          console.log(
            `  - ${candidate.source}: found=${candidate.found} confidence=${(candidate.confidence * 100).toFixed(1)}%` +
            `${candidate.path ? ` path=${candidate.path}` : ""}`,
          );
          for (const diag of candidate.diagnostics) {
            const tag = diag.level.toUpperCase();
            console.log(`      [${tag}] ${diag.message}`);
          }
        }
      }

      if (!opts.apply) {
        console.log("Dry run only. Re-run with --apply to write termite.config.json.");
      } else if (!mergeResult) {
        console.error("Nothing to apply: no valid source yielded commander.model.");
        process.exit(1);
      } else if (shouldWrite) {
        console.log(`Applied merged config to ${targetPath}`);
      } else {
        console.log("No changes written (existing config already has these fields).");
      }

      if (mergeResult) {
        if (mergeResult.changes.length > 0) {
          console.log("Changes:");
          for (const line of mergeResult.changes) {
            console.log(`  - ${line}`);
          }
        }
        if (mergeResult.unchanged.length > 0) {
          console.log("Unchanged:");
          for (const line of mergeResult.unchanged) {
            console.log(`  - ${line}`);
          }
        }
      }

      if (resolved.issues.errors.length > 0) {
        console.log("Model config errors:");
        for (const error of resolved.issues.errors) {
          console.log(`  - ${error}`);
        }
      } else {
        console.log("Model config health: OK");
      }
      if (resolved.issues.warnings.length > 0) {
        console.log("Model config warnings:");
        for (const warning of resolved.issues.warnings) {
          console.log(`  - ${warning}`);
        }
      }
      if (credentials.enabled) {
        console.log(`LLM credentials: ${credentials.ok ? "OK" : "FAIL"} (${credentials.detail})`);
        if (!credentials.ok && credentials.missing.length > 0) {
          console.log("Missing env vars:");
          for (const key of credentials.missing) {
            console.log(`  - ${key}`);
          }
        }
      } else {
        console.log(`LLM credentials: SKIPPED (${credentials.detail})`);
      }
    } catch (err: any) {
      console.error(`[config import] failed: ${err?.message ?? "unknown error"}`);
      process.exit(1);
    }
  });

configCommand
  .command("bootstrap")
  .description("Auto-import model config from external CLIs and validate")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--from <source>", "Import source: auto | opencode | claude | codex", "auto")
  .option("--force", "Override existing termite.config.json values", false)
  .option("--json", "Output as JSON", false)
  .addHelpText(
    "after",
    `
One-shot (recommended for fresh setup):
  termite-commander config bootstrap --from auto --colony .

Then validate:
  termite-commander doctor --config --runtime --colony .
`
  )
  .action((opts: { colony: string; from: string; force: boolean; json: boolean }) => {
    try {
      const source = parseImportSource(opts.from);
      const selection = importExternalConfig(opts.colony, source);
      const selected = selection.selected;
      if (!selected?.recommended) {
        const message = {
          ok: false,
          reason: "no_valid_source",
          from: source,
          candidates: selection.candidates,
        };
        if (opts.json) {
          console.log(JSON.stringify(message, null, 2));
        } else {
          console.error("Config bootstrap failed: no source provided a valid commander.model.");
          if (selection.candidates.length > 0) {
            console.error("Candidates:");
            for (const candidate of selection.candidates) {
              console.error(
                `  - ${candidate.source}: found=${candidate.found} confidence=${(candidate.confidence * 100).toFixed(1)}%` +
                  `${candidate.path ? ` path=${candidate.path}` : ""}`,
              );
              for (const diag of candidate.diagnostics) {
                console.error(`      [${diag.level.toUpperCase()}] ${diag.message}`);
              }
            }
          }
        }
        process.exit(1);
      }

      const existingLookup = readTermiteConfigWithPath(opts.colony);
      const targetPath = getTermiteConfigPath(opts.colony);
      const mergeResult = mergeImportedConfig(existingLookup.config, selected.recommended, opts.force);
      const shouldWrite = mergeResult.changes.length > 0;
      if (shouldWrite) {
        writeTermiteConfig(targetPath, mergeResult.merged);
      }

      const models = resolveModels(opts.colony);
      const credentials = getCredentialStatus(models);
      const credentialsOk = !credentials.enabled || credentials.ok;
      const ok = models.issues.errors.length === 0 && credentialsOk;
      const report = {
        ok,
        from: source,
        selected,
        candidates: selection.candidates,
        targetPath,
        applied: shouldWrite,
        merge: mergeResult,
        doctor: {
          issues: models.issues,
          credentials,
          resolved: {
            commanderModel: models.commanderModel,
            commanderProvider: models.commanderProvider,
            defaultWorkerCli: models.defaultWorkerCli,
            defaultWorkerModel: models.defaultWorkerModel,
            workers: models.workers,
            resolution: models.resolution,
          },
        },
      };

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Config bootstrap source: ${source}`);
        console.log(
          `Selected: ${selected.source} (confidence ${(selected.confidence * 100).toFixed(1)}%)` +
            `${selected.path ? ` from ${selected.path}` : ""}`,
        );
        console.log(
          shouldWrite
            ? `Applied merged config to ${targetPath}`
            : "No file changes needed (existing config already satisfies merge policy).",
        );
        if (mergeResult.changes.length > 0) {
          console.log("Changes:");
          for (const line of mergeResult.changes) {
            console.log(`  - ${line}`);
          }
        }
        if (mergeResult.unchanged.length > 0) {
          console.log("Unchanged:");
          for (const line of mergeResult.unchanged) {
            console.log(`  - ${line}`);
          }
        }
        console.log(`Doctor: ${ok ? "OK" : "FAIL"}`);
        if (models.issues.errors.length > 0) {
          console.log("Errors:");
          for (const error of models.issues.errors) {
            console.log(`  - ${error}`);
          }
        }
        if (models.issues.warnings.length > 0) {
          console.log("Warnings:");
          for (const warning of models.issues.warnings) {
            console.log(`  - ${warning}`);
          }
        }
        if (credentials.enabled) {
          console.log(`Credentials: ${credentials.ok ? "OK" : "FAIL"} (${credentials.detail})`);
          if (!credentials.ok && credentials.missing.length > 0) {
            console.log("Missing env vars:");
            for (const key of credentials.missing) {
              console.log(`  - ${key}`);
            }
          }
        } else {
          console.log(`Credentials: SKIPPED (${credentials.detail})`);
        }
      }

      if (!ok) {
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`[config bootstrap] failed: ${err?.message ?? "unknown error"}`);
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Run diagnostics for commander runtime and config")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--config", "Run model configuration diagnostics", false)
  .option("--runtime", "Run worker runtime/model smoke diagnostics", false)
  .option("--runtime-timeout <sec>", "Runtime/model smoke timeout per probe (seconds)", "30")
  .option("--json", "Output as JSON", false)
  .addHelpText(
    "after",
    `
Use this before plan --run to catch missing model/credentials/runtime issues.

Example:
  termite-commander doctor --config --runtime --colony .
`
  )
  .action(async (opts: {
    colony: string;
    config: boolean;
    runtime: boolean;
    runtimeTimeout: string;
    json: boolean;
  }) => {
    const runConfig = opts.config || !opts.runtime;
    const runRuntime = opts.runtime;
    const timeoutSecRaw = parseInt(opts.runtimeTimeout, 10);
    const timeoutMs = Number.isNaN(timeoutSecRaw) || timeoutSecRaw <= 0 ? 30_000 : timeoutSecRaw * 1000;

    const models = resolveModels(opts.colony);
    const configOk = !runConfig || models.issues.errors.length === 0;
    const credentials = getCredentialStatus(models);
    const credentialsOk = !runConfig || !credentials.enabled || credentials.ok;

    let commanderProbe: { enabled: boolean; ok: boolean; detail: string } = {
      enabled: false,
      ok: true,
      detail: "Skipped (runtime check disabled).",
    };
    let runtimeResult: Awaited<ReturnType<typeof runWorkerRuntimePreflight>> | null = null;
    let runtimeOk = true;
    if (runRuntime) {
      commanderProbe = await probeCommanderModel(models, timeoutMs);
      runtimeResult = await runWorkerRuntimePreflight(opts.colony, models, timeoutMs);
      const failedProbes = runtimeResult.probes.filter((probe) => !probe.ok && !probe.skipped);
      runtimeOk =
        runtimeResult.missing.length === 0 &&
        failedProbes.length === 0 &&
        commanderProbe.ok;
    }

    const ok = configOk && credentialsOk && runtimeOk;
    const report = {
      colony: opts.colony,
      ok,
      checks: {
        config: {
          enabled: runConfig,
          ok: configOk,
          issues: models.issues,
          resolved: {
            commanderModel: models.commanderModel,
            commanderProvider: models.commanderProvider,
            defaultWorkerCli: models.defaultWorkerCli,
            defaultWorkerModel: models.defaultWorkerModel,
            workers: models.workers,
            resolution: models.resolution,
          },
        },
        credentials: {
          enabled: runConfig && credentials.enabled,
          ok: credentialsOk,
          provider: credentials.provider,
          detail: credentials.detail,
          missing: credentials.missing,
        },
        runtime: {
          enabled: runRuntime,
          ok: runtimeOk,
          commanderProbe,
          required: runtimeResult?.required ?? [],
          available: runtimeResult?.available ?? [],
          missing: runtimeResult?.missing ?? [],
          probes: runtimeResult?.probes ?? [],
        },
      },
    };

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Doctor: ${ok ? "OK" : "FAIL"}`);
      console.log(`  colony: ${opts.colony}`);
      if (runConfig) {
        console.log(`  config: ${configOk ? "OK" : "FAIL"}`);
        if (credentials.enabled) {
          console.log(`  credentials: ${credentialsOk ? "OK" : "FAIL"} (${credentials.detail})`);
        } else {
          console.log(`  credentials: SKIPPED (${credentials.detail})`);
        }
        console.log(
          `  resolved commander=${models.commanderModel || "<missing>"} provider=${models.commanderProvider}` +
            ` defaultWorkerCli=${models.defaultWorkerCli} defaultWorkerModel=${models.defaultWorkerModel}`,
        );
      } else {
        console.log("  config: SKIPPED");
      }

      if (runRuntime && runtimeResult) {
        console.log(
          `  runtime binaries: ${runtimeResult.missing.length === 0 ? "OK" : `FAIL (${runtimeResult.missing.join(", ")})`}`,
        );
        console.log(`  commander probe: ${commanderProbe.ok ? "OK" : "FAIL"} (${commanderProbe.detail})`);
        for (const probe of runtimeResult.probes) {
          console.log(`  runtime probe: ${formatRuntimeProbeLabel(probe)}`);
        }
      } else {
        console.log("  runtime: SKIPPED (use --runtime)");
      }

      if (runConfig && models.issues.errors.length > 0) {
        console.log("  errors:");
        for (const error of models.issues.errors) {
          console.log(`    - ${error}`);
        }
      }
      if (runConfig && models.issues.warnings.length > 0) {
        console.log("  warnings:");
        for (const warning of models.issues.warnings) {
          console.log(`    - ${warning}`);
        }
      }
      if (runConfig && credentials.enabled && !credentials.ok && credentials.missing.length > 0) {
        console.log("  missing env vars:");
        for (const key of credentials.missing) {
          console.log(`    - ${key}`);
        }
      }
      if (!ok) {
        console.log("Suggested fix flow:");
        console.log("  1) termite-commander config bootstrap --from auto --colony .");
        console.log("  2) Export required API credentials for the selected provider");
        console.log("  3) termite-commander doctor --config --runtime --colony .");
      }
    }

    if (!ok) {
      process.exit(1);
    }
  });

program
  .command("resume")
  .description("Resume from a halted state")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .addHelpText(
    "after",
    `
Example:
  termite-commander resume --colony .
`
  )
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
  .addHelpText(
    "after",
    `
Example:
  termite-commander watch --colony . --interval 3000
`
  )
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
  .option("--force", "Force cleanup lock/status and try killing orphan commander pid", false)
  .addHelpText(
    "after",
    `
Example:
  termite-commander stop --colony .
  termite-commander stop --colony . --force
`
  )
  .action(async (opts: { colony: string; force: boolean }) => {
    const lockPath = join(opts.colony, "commander.lock");
    const statusFilePath = join(opts.colony, ".commander-status.json");

    let lockData: { pid: number; startedAt: string; objective: string } | null = null;
    let statusPid: number | null = null;

    if (existsSync(statusFilePath)) {
      try {
        const parsed = JSON.parse(readFileSync(statusFilePath, "utf-8"));
        if (typeof parsed?.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0) {
          statusPid = parsed.pid;
        }
      } catch {}
    }

    if (!existsSync(lockPath)) {
      if (!opts.force) {
        console.log("No commander.lock found. Commander is not running.");
        return;
      }
      console.log("No commander.lock found. --force enabled: cleaning stale status files.");
    } else {
      try {
        lockData = JSON.parse(readFileSync(lockPath, "utf-8"));
      } catch {
        if (!opts.force) {
          console.error("Failed to parse commander.lock.");
          return;
        }
        console.warn("Failed to parse commander.lock. --force enabled: continuing cleanup.");
      }
    }

    if (lockData?.pid) {
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
    }

    if (opts.force && statusPid && (!lockData || statusPid !== lockData.pid)) {
      try {
        process.kill(statusPid, "SIGTERM");
        console.log(`Force cleanup: sent SIGTERM to orphan status PID ${statusPid}.`);
      } catch {}
    }

    // Clean up lock file and stale status
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
        console.log("commander.lock removed.");
      }
    } catch {}
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
  .addHelpText(
    "after",
    `
Examples:
  termite-commander workers --colony .
  termite-commander workers --colony . --json
`
  )
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
    console.log("  ID                              CLI      MODEL                     STATUS    SESSION             STARTED");
    console.log("  " + "-".repeat(120));
    for (const w of workers) {
      const sid = w.sessionId ? w.sessionId.slice(0, 16) + "..." : "-";
      const started = w.startedAt ? new Date(w.startedAt).toLocaleTimeString() : "-";
      const cli = (w.cli ?? "-").toString();
      const model = (w.model ?? "-").toString();
      console.log(`  ${w.id.padEnd(34)}${cli.padEnd(9)}${model.padEnd(26)}${w.status.padEnd(10)}${sid.padEnd(20)}${started}`);
    }
  });

if (process.argv.length <= 2) {
  const { startTUI } = await import("./tui/index.js");
  await startTUI(process.cwd());
} else {
  program.parse();
}
