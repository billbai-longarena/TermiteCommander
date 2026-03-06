#!/usr/bin/env node

import { program } from "commander";
import { Pipeline, type PipelineConfig } from "./engine/pipeline.js";
import { SignalBridge } from "./colony/signal-bridge.js";
import { resolve, join } from "node:path";
import {
  existsSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { homedir } from "node:os";
import {
  readTermiteConfigWithPath,
  resolveModels,
  extractProvider,
  type ResolvedModels,
  type WorkerRuntime,
} from "./config/model-resolver.js";
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
import { startConsoleCapture } from "./logging/capture.js";
import { getCommanderLogPath, readTailLines } from "./logging/files.js";

function detectPlatform(): "opencode" | "claude-code" | "unknown" {
  if (process.env.CLAUDE_PROJECT_DIR) return "claude-code";
  if (process.env.OPENCODE_SESSION) return "opencode";
  return "unknown";
}

type DashboardMode = "auto" | "tui" | "watch" | "off";

function isAgentSession(): boolean {
  const markers = [
    process.env.CODEX_CLI,
    process.env.CODEX_CI,
    process.env.CODEX_THREAD_ID,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.OPENCODE_SESSION,
  ];
  return markers.some((value) => Boolean(value));
}

function parseDashboardMode(value: string): DashboardMode {
  const normalized = value.toLowerCase().trim();
  if (["auto", "tui", "watch", "off"].includes(normalized)) {
    return normalized as DashboardMode;
  }
  throw new Error("Invalid --dashboard mode. Use: auto | tui | watch | off");
}

async function startWatchMonitor(colonyRoot: string, intervalMs: number): Promise<void> {
  const bridge = new SignalBridge(colonyRoot);

  const tick = async () => {
    const status = await bridge.status();
    const stall = await bridge.checkStall(5);
    process.stdout.write(
      `\r[${new Date().toISOString()}] total=${status.total} open=${status.open} claimed=${status.claimed} done=${status.done} stall=${stall.stalled}   `,
    );
  };

  await tick();
  setInterval(() => {
    void tick().catch((err: any) => {
      console.error(`[watch] tick failed: ${err?.message ?? "unknown error"}`);
    });
  }, intervalMs);
}

async function launchDashboard(
  colonyRoot: string,
  mode: DashboardMode,
  opts?: { intervalMs?: number; announce?: boolean; json?: boolean },
): Promise<void> {
  if (mode === "off") return;

  const stdoutTty = Boolean(process.stdout.isTTY);
  const fallbackToWatch = mode === "watch" || (mode === "auto" && isAgentSession());
  const shouldTryTui = mode === "tui" || (mode === "auto" && stdoutTty);
  const intervalMs = opts?.intervalMs ?? 5000;
  const announce = opts?.announce ?? false;

  if (shouldTryTui) {
    if (!stdoutTty) {
      if (mode === "tui") {
        throw new Error("TUI requires a TTY-enabled stdout terminal.");
      }
    } else {
      if (announce && !opts?.json) {
        console.log("\nStarting TUI dashboard (Ctrl+C to exit)...");
      }
      const { startTUI } = await import("./tui/index.js");
      await startTUI(colonyRoot);
      return;
    }
  }

  if (fallbackToWatch) {
    if (announce && !opts?.json) {
      console.log("\nStarting watch monitor (Ctrl+C to exit)...");
    }
    await startWatchMonitor(colonyRoot, intervalMs);
  }
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

type WorkerCredentialState = "ok" | "fail" | "unknown";

interface WorkerCredentialStatus {
  runtime: WorkerRuntime;
  model: string;
  provider: string;
  state: WorkerCredentialState;
  detail: string;
  missing: string[];
}

interface DaemonMetadata {
  pid: number;
  startedAt: string;
  objective: string;
  colonyRoot: string;
  command: string[];
  outLog: string;
  errLog: string;
}

function getDaemonMetaPath(colonyRoot: string): string {
  return join(colonyRoot, ".commander-daemon.json");
}

function readDaemonMetadata(colonyRoot: string): DaemonMetadata | null {
  const metaPath = getDaemonMetaPath(colonyRoot);
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as DaemonMetadata;
  } catch {
    return null;
  }
}

function removeDaemonMetadata(colonyRoot: string): void {
  const metaPath = getDaemonMetaPath(colonyRoot);
  try {
    if (existsSync(metaPath)) unlinkSync(metaPath);
  } catch {
    // best effort cleanup
  }
}

function getCommanderLockData(colonyRoot: string): { pid: number; startedAt: string; objective: string } | null {
  const lockPath = join(colonyRoot, "commander.lock");
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch {
    return null;
  }
}

function resolveWorkerCredentialStatuses(models: ResolvedModels): WorkerCredentialStatus[] {
  const seen = new Set<string>();
  const baseSpecs =
    models.workers.length > 0
      ? models.workers
      : [{ cli: models.defaultWorkerCli, model: models.defaultWorkerModel, count: 1 }];
  const results: WorkerCredentialStatus[] = [];

  for (const spec of baseSpecs) {
    const runtime = spec.cli;
    const model = (spec.model ?? models.defaultWorkerModel ?? "").trim() || models.defaultWorkerModel;
    const key = `${runtime}|${model}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (runtime === "openclaw") {
      results.push({
        runtime,
        model,
        provider: "openclaw",
        state: "unknown",
        detail: "OpenClaw credentials are managed by OpenClaw route/session context; static env validation is not available.",
        missing: [],
      });
      continue;
    }

    if (runtime === "claude") {
      const cred = checkProviderCredentials("anthropic");
      results.push({
        runtime,
        model,
        provider: "anthropic",
        state: cred.ok ? "ok" : "fail",
        detail: cred.detail,
        missing: cred.missing,
      });
      continue;
    }

    if (runtime === "opencode" && model.toLowerCase().startsWith("github-copilot/")) {
      results.push({
        runtime,
        model,
        provider: "github-copilot",
        state: "unknown",
        detail:
          "GitHub Copilot credentials are managed by OpenCode auth/session state. Use runtime smoke tests for readiness.",
        missing: [],
      });
      continue;
    }

    const provider = extractProvider(model);
    const cred = checkProviderCredentials(provider);
    results.push({
      runtime,
      model,
      provider,
      state: cred.ok ? "ok" : "fail",
      detail: cred.detail,
      missing: cred.missing,
    });
  }

  return results;
}

function runLaunchctl(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("launchctl", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err: any) {
    return {
      ok: false,
      stdout: err?.stdout?.toString?.() ?? "",
      stderr: err?.stderr?.toString?.() ?? err?.message ?? "unknown error",
    };
  }
}

function parseWorkerPids(statusFilePath: string): number[] {
  if (!existsSync(statusFilePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(statusFilePath, "utf-8"));
    const workers = Array.isArray(parsed?.workers) ? parsed.workers : [];
    const pids = workers
      .map((worker: any) => worker?.pid)
      .filter((pid: unknown) => typeof pid === "number" && Number.isInteger(pid) && pid > 0) as number[];
    return [...new Set(pids)];
  } catch {
    return [];
  }
}

function signalProcess(
  pid: number,
  signal: NodeJS.Signals,
  label: string,
  opts?: { force?: boolean },
): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return false;
  try {
    process.kill(pid, signal);
    console.log(`${label}: sent ${signal} to PID ${pid}.`);
    return true;
  } catch (err: any) {
    if (err?.code === "ESRCH") {
      if (!opts?.force) {
        console.log(`${label}: PID ${pid} already exited.`);
      }
      return false;
    }
    console.warn(`${label}: failed to signal PID ${pid}: ${err?.message ?? "unknown error"}`);
    return false;
  }
}

interface LaunchdPlistMatch {
  path: string;
  label: string;
}

interface LaunchdGuardResult {
  platform: string;
  supported: boolean;
  token: string;
  loadedLabels: string[];
  plistMatches: LaunchdPlistMatch[];
  disabledPlists: string[];
  errors: string[];
}

function parseLaunchdLabel(plistContent: string, fallback: string): string {
  const m = plistContent.match(/<key>\s*Label\s*<\/key>\s*<string>\s*([^<]+)\s*<\/string>/i);
  return (m?.[1] ?? fallback).trim();
}

function collectLaunchdMatches(token: string): LaunchdGuardResult {
  const tokenNormalized = token.trim().toLowerCase() || "termite";
  const result: LaunchdGuardResult = {
    platform: process.platform,
    supported: process.platform === "darwin",
    token: tokenNormalized,
    loadedLabels: [],
    plistMatches: [],
    disabledPlists: [],
    errors: [],
  };

  if (!result.supported) {
    return result;
  }

  const list = runLaunchctl(["list"]);
  if (!list.ok) {
    result.errors.push(`launchctl list failed: ${list.stderr || "unknown error"}`);
  } else {
    const lines = list.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines.slice(1)) {
      const cols = line.split(/\s+/);
      if (cols.length < 3) continue;
      const label = cols.slice(2).join(" ");
      if (label.toLowerCase().includes(tokenNormalized)) {
        result.loadedLabels.push(label);
      }
    }
  }

  const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
  if (!existsSync(launchAgentsDir)) {
    return result;
  }

  for (const file of readdirSync(launchAgentsDir)) {
    if (!file.endsWith(".plist")) continue;
    const path = join(launchAgentsDir, file);
    let content = "";
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    const label = parseLaunchdLabel(content, file.replace(/\.plist$/, ""));
    const haystack = `${file}\n${label}\n${content}`.toLowerCase();
    if (haystack.includes(tokenNormalized)) {
      result.plistMatches.push({ path, label });
    }
  }

  return result;
}

function printLaunchdGuard(result: LaunchdGuardResult): void {
  if (!result.supported) {
    console.log(`Autostart guard: launchd scan is only available on macOS (current: ${result.platform}).`);
    return;
  }
  console.log(`Autostart guard token: "${result.token}"`);
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.warn(`  - ${err}`);
    }
  }
  if (result.loadedLabels.length === 0) {
    console.log("  Loaded launchd jobs: none");
  } else {
    console.log("  Loaded launchd jobs:");
    for (const label of result.loadedLabels) {
      console.log(`    - ${label}`);
    }
  }
  if (result.plistMatches.length === 0) {
    console.log("  LaunchAgents plists: none");
  } else {
    console.log("  LaunchAgents plists:");
    for (const item of result.plistMatches) {
      console.log(`    - ${item.label} (${item.path})`);
    }
  }
}

function disableLaunchdAutostart(result: LaunchdGuardResult): LaunchdGuardResult {
  if (!result.supported) return result;
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "";
  for (const item of result.plistMatches) {
    if (uid) {
      const byPath = runLaunchctl(["bootout", `gui/${uid}`, item.path]);
      if (!byPath.ok) {
        const byLabel = runLaunchctl(["bootout", `gui/${uid}/${item.label}`]);
        if (!byLabel.ok) {
          runLaunchctl(["remove", item.label]);
        }
      }
    } else {
      runLaunchctl(["remove", item.label]);
    }

    const disabledPath = `${item.path}.disabled`;
    try {
      if (!existsSync(disabledPath)) {
        renameSync(item.path, disabledPath);
      }
      result.disabledPlists.push(disabledPath);
    } catch (err: any) {
      result.errors.push(`Failed to disable ${item.path}: ${err?.message ?? "unknown error"}`);
    }
  }
  return result;
}

function stopCommanderProcess(
  colonyRoot: string,
  force: boolean,
  opts?: { stopWorkers?: boolean },
): void {
  const lockPath = join(colonyRoot, "commander.lock");
  const statusFilePath = join(colonyRoot, ".commander-status.json");
  const stopWorkers = opts?.stopWorkers ?? true;

  let lockData: { pid: number; startedAt: string; objective: string } | null = null;
  let statusPid: number | null = null;

  const workerPids = stopWorkers ? parseWorkerPids(statusFilePath) : [];

  if (existsSync(statusFilePath)) {
    try {
      const parsed = JSON.parse(readFileSync(statusFilePath, "utf-8"));
      if (typeof parsed?.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0) {
        statusPid = parsed.pid;
      }
    } catch {}
  }

  if (!existsSync(lockPath)) {
    if (!force && !statusPid && workerPids.length === 0) {
      console.log("No commander.lock found. Commander is not running.");
      return;
    }
    console.log("No commander.lock found. Continuing with status/worker cleanup.");
  } else {
    try {
      lockData = JSON.parse(readFileSync(lockPath, "utf-8"));
    } catch {
      if (!force) {
        console.error("Failed to parse commander.lock.");
        return;
      }
      console.warn("Failed to parse commander.lock. --force enabled: continuing cleanup.");
    }
  }

  const commanderPids = new Set<number>();
  if (lockData?.pid) commanderPids.add(lockData.pid);
  if (statusPid && (!lockData || statusPid !== lockData.pid)) commanderPids.add(statusPid);

  if (commanderPids.size > 0) {
    for (const pid of commanderPids) {
      signalProcess(pid, "SIGTERM", "Commander");
      if (force && isProcessAlive(pid)) {
        signalProcess(pid, "SIGKILL", "Commander", { force: true });
      }
    }
  }

  if (stopWorkers && workerPids.length > 0) {
    console.log(`Stopping worker fleet (${workerPids.length})...`);
    for (const pid of workerPids) {
      signalProcess(pid, "SIGTERM", "Worker");
      if (force && isProcessAlive(pid)) {
        signalProcess(pid, "SIGKILL", "Worker", { force: true });
      }
    }
  }

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

  removeDaemonMetadata(colonyRoot);
  console.log("Colony cleaned up. Ready for next run.");
}

function startDaemonPlan(params: {
  colonyRoot: string;
  objective: string;
  planFile?: string;
  contextText?: string;
  runtimeTimeoutSec: number;
  skipRuntimeSmoke: boolean;
}): DaemonMetadata {
  const colonyRoot = resolve(params.colonyRoot);
  const existingLock = getCommanderLockData(colonyRoot);
  if (existingLock && isProcessAlive(existingLock.pid)) {
    throw new Error(`Commander is already running (PID ${existingLock.pid}). Stop it first.`);
  }

  const logsDir = join(colonyRoot, ".termite", "logs");
  mkdirSync(logsDir, { recursive: true });
  const outLog = join(logsDir, "commander-daemon.out.log");
  const errLog = join(logsDir, "commander-daemon.err.log");
  const outFd = openSync(outLog, "a");
  const errFd = openSync(errLog, "a");

  const commandArgs = [
    process.argv[1],
    "plan",
    params.objective,
    "--colony",
    colonyRoot,
    "--run",
    "--runtime-timeout",
    String(params.runtimeTimeoutSec),
  ];
  if (params.planFile) {
    commandArgs.push("--plan", params.planFile);
  } else if (params.contextText) {
    commandArgs.push("--context", params.contextText);
  }
  if (params.skipRuntimeSmoke) {
    commandArgs.push("--skip-runtime-smoke");
  }

  const child = spawn(process.execPath, commandArgs, {
    cwd: colonyRoot,
    detached: true,
    stdio: ["ignore", outFd, errFd],
    env: {
      ...process.env,
      TERMITE_DAEMON_MODE: "1",
      TERMITE_DAEMON_OUT_LOG: outLog,
      TERMITE_DAEMON_ERR_LOG: errLog,
    },
  });
  if (!child.pid || child.pid <= 0) {
    try {
      closeSync(outFd);
      closeSync(errFd);
    } catch {}
    throw new Error("Failed to spawn daemon process.");
  }
  child.unref();
  closeSync(outFd);
  closeSync(errFd);

  const metadata: DaemonMetadata = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    objective: params.objective,
    colonyRoot,
    command: [process.execPath, ...commandArgs],
    outLog,
    errLog,
  };
  writeFileSync(getDaemonMetaPath(colonyRoot), JSON.stringify(metadata, null, 2), "utf-8");
  return metadata;
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
  - No args: opens dashboard (auto mode: TUI if terminal supports it, otherwise watch in agent sessions).
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
  5) Optionally start dashboard monitor (auto: TUI on TTY, otherwise watch in agent sessions)

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
    const capture = startConsoleCapture(opts.colony);
    try {
      const source = parseImportSource(opts.from);
      const timeoutMs = parsePositiveInt(opts.runtimeTimeout, 30) * 1000;
      const dashboardMode = parseDashboardMode(opts.dashboard ?? "auto");

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

      if (!opts.json) {
        await launchDashboard(opts.colony, dashboardMode, {
          intervalMs: 5000,
          announce: true,
          json: opts.json,
        });
      }
    } catch (err: any) {
      console.error(`[init] failed: ${err?.message ?? "unknown error"}`);
      process.exit(1);
    } finally {
      capture.stop();
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
    const capture = startConsoleCapture(opts.colony);
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
        console.log("[commander] Open another terminal and run 'termite-commander dashboard --mode auto' for the live dashboard.");
        const runtimeSmokeTimeoutMs = parsePositiveInt(opts.runtimeTimeout, 30) * 1000;
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
    } finally {
      capture.stop();
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
  .option("--credentials", "Run credential diagnostics (commander + worker providers)", false)
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
    credentials: boolean;
    runtime: boolean;
    runtimeTimeout: string;
    json: boolean;
  }) => {
    const runConfig = opts.config || opts.credentials || !opts.runtime;
    const runRuntime = opts.runtime;
    const timeoutSecRaw = parseInt(opts.runtimeTimeout, 10);
    const timeoutMs = Number.isNaN(timeoutSecRaw) || timeoutSecRaw <= 0 ? 30_000 : timeoutSecRaw * 1000;

    const models = resolveModels(opts.colony);
    const configOk = !runConfig || models.issues.errors.length === 0;
    const credentials = getCredentialStatus(models);
    const workerCredentialStatuses = runConfig ? resolveWorkerCredentialStatuses(models) : [];
    const workerCredentialsOk = workerCredentialStatuses.every((status) => status.state !== "fail");
    const credentialsOk = (!runConfig || !credentials.enabled || credentials.ok) && workerCredentialsOk;

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
          workerProviders: workerCredentialStatuses,
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
        if (workerCredentialStatuses.length > 0) {
          for (const workerCred of workerCredentialStatuses) {
            const stateLabel =
              workerCred.state === "ok" ? "OK" : workerCred.state === "fail" ? "FAIL" : "UNKNOWN";
            console.log(
              `  worker credential: ${stateLabel} runtime=${workerCred.runtime} model=${workerCred.model} provider=${workerCred.provider} (${workerCred.detail})`,
            );
            if (workerCred.state === "fail" && workerCred.missing.length > 0) {
              console.log(`    missing: ${workerCred.missing.join(", ")}`);
            }
          }
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

const daemonCommand = program
  .command("daemon")
  .description("Manage commander daemon mode for long-running background execution");

daemonCommand
  .command("start <objective>")
  .description("Start commander in background with plan --run")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("-p, --plan <file>", "Design document to use as decomposition context")
  .option("--context <text>", "Direct text context for decomposition")
  .option("--skip-runtime-smoke", "Skip worker runtime/model smoke tests before --run", false)
  .option("--runtime-timeout <sec>", "Runtime/model smoke timeout per probe (seconds)", "60")
  .addHelpText(
    "after",
    `
Examples:
  termite-commander daemon start "Implement OAuth2 auth" --plan .termite/worker/PLAN.md --colony .
  termite-commander daemon start "Fix flaky CI" --context "root cause summary" --colony .
`
  )
  .action((objective: string, opts: {
    colony: string;
    plan?: string;
    context?: string;
    skipRuntimeSmoke: boolean;
    runtimeTimeout: string;
  }) => {
    if (opts.plan && opts.context) {
      console.error("Use either --plan or --context, not both.");
      process.exit(1);
    }
    const timeoutSec = parsePositiveInt(opts.runtimeTimeout, 60);
    const metadata = startDaemonPlan({
      colonyRoot: opts.colony,
      objective,
      planFile: opts.plan,
      contextText: opts.context,
      runtimeTimeoutSec: timeoutSec,
      skipRuntimeSmoke: opts.skipRuntimeSmoke,
    });
    console.log(`Daemon started: PID ${metadata.pid}`);
    console.log(`Objective: ${metadata.objective}`);
    console.log(`Out log:   ${metadata.outLog}`);
    console.log(`Err log:   ${metadata.errLog}`);
    console.log("Daemon mode uses a detached Commander process (not launchd/systemd managed).");
    console.log("Use 'termite-commander daemon status --colony .' to inspect runtime health.");
  });

daemonCommand
  .command("status")
  .description("Show daemon metadata and liveness")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .action((opts: { colony: string }) => {
    const metadata = readDaemonMetadata(opts.colony);
    if (!metadata) {
      console.log("No daemon metadata found.");
      return;
    }
    const alive = isProcessAlive(metadata.pid);
    console.log(`Daemon: ${alive ? "RUNNING" : "STALE"}`);
    console.log(`  PID: ${metadata.pid}`);
    console.log(`  Started: ${metadata.startedAt}`);
    console.log(`  Objective: ${metadata.objective}`);
    console.log(`  Out log: ${metadata.outLog}`);
    console.log(`  Err log: ${metadata.errLog}`);
    console.log("  Mode: detached process (not launchd/systemd managed)");

    const lockData = getCommanderLockData(opts.colony);
    if (lockData) {
      const commanderAlive = isProcessAlive(lockData.pid);
      console.log(`Commander lock: ${commanderAlive ? "RUNNING" : "STALE"} (pid=${lockData.pid})`);
    } else {
      console.log("Commander lock: not found");
    }
  });

daemonCommand
  .command("stop")
  .description("Stop daemon + commander runtime")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--force", "Force cleanup lock/status and orphan daemon pid", false)
  .action((opts: { colony: string; force: boolean }) => {
    const metadata = readDaemonMetadata(opts.colony);
    if (metadata && isProcessAlive(metadata.pid)) {
      console.log(`Stopping daemon launcher process (PID ${metadata.pid})...`);
      try {
        process.kill(metadata.pid, "SIGTERM");
      } catch {}
    }
    stopCommanderProcess(opts.colony, opts.force);
  });

const fleetCommand = program
  .command("fleet")
  .description("Fleet safety controls: one-shot stop + launchd autostart guard");

fleetCommand
  .command("stop")
  .description("One-shot stop commander + workers + daemon metadata")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--force", "Force SIGKILL for stubborn commander/worker processes", false)
  .option("--no-check-autostart", "Skip launchd autostart check after stop")
  .option("--disable-autostart", "Disable matched launchd jobs and .plist files", false)
  .option("--match <token>", "launchd match token (default: termite)", "termite")
  .addHelpText(
    "after",
    `
Examples:
  termite-commander fleet stop --colony .
  termite-commander fleet stop --colony . --force --check-autostart --match termite
  termite-commander fleet stop --colony . --disable-autostart --match termite
`
  )
  .action((opts: {
    colony: string;
    force: boolean;
    checkAutostart: boolean;
    disableAutostart: boolean;
    match: string;
  }) => {
    const metadata = readDaemonMetadata(opts.colony);
    if (metadata && isProcessAlive(metadata.pid)) {
      console.log(`Stopping daemon launcher process (PID ${metadata.pid})...`);
      signalProcess(metadata.pid, "SIGTERM", "Daemon");
      if (opts.force && isProcessAlive(metadata.pid)) {
        signalProcess(metadata.pid, "SIGKILL", "Daemon", { force: true });
      }
    }

    stopCommanderProcess(opts.colony, opts.force, { stopWorkers: true });

    if (!opts.checkAutostart) {
      return;
    }

    let guard = collectLaunchdMatches(opts.match);
    if (opts.disableAutostart) {
      guard = disableLaunchdAutostart(guard);
    }
    printLaunchdGuard(guard);
    if (guard.disabledPlists.length > 0) {
      console.log("Autostart guard: disabled LaunchAgents:");
      for (const path of guard.disabledPlists) {
        console.log(`  - ${path}`);
      }
    }
  });

fleetCommand
  .command("autostart")
  .description("Check (or disable) launchd autostart jobs matching a token")
  .option("--match <token>", "launchd match token (default: termite)", "termite")
  .option("--disable", "Disable matched launchd jobs and .plist files", false)
  .addHelpText(
    "after",
    `
Examples:
  termite-commander fleet autostart --match termite
  termite-commander fleet autostart --match termite --disable
`
  )
  .action((opts: { match: string; disable: boolean }) => {
    let guard = collectLaunchdMatches(opts.match);
    if (opts.disable) {
      guard = disableLaunchdAutostart(guard);
    }
    printLaunchdGuard(guard);
    if (guard.disabledPlists.length > 0) {
      console.log("Disabled LaunchAgents:");
      for (const path of guard.disabledPlists) {
        console.log(`  - ${path}`);
      }
    }
  });

program
  .command("dashboard")
  .description("Open dashboard monitor (auto | tui | watch)")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--mode <mode>", "Dashboard mode: auto | tui | watch | off", "auto")
  .option("-i, --interval <ms>", "Refresh interval in ms (watch mode)", "5000")
  .addHelpText(
    "after",
    `
Examples:
  termite-commander dashboard --colony . --mode auto
  termite-commander dashboard --colony . --mode watch --interval 2000
`
  )
  .action(async (opts: { colony: string; mode: string; interval: string }) => {
    const mode = parseDashboardMode(opts.mode ?? "auto");
    const interval = parsePositiveInt(opts.interval, 5000);
    await launchDashboard(opts.colony, mode, {
      intervalMs: interval,
      announce: mode !== "off",
    });
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
    const interval = parsePositiveInt(opts.interval, 5000);
    await startWatchMonitor(opts.colony, interval);
  });

program
  .command("logs")
  .description("Show recent commander logs for issue reporting")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("-n, --lines <count>", "Number of lines to print", "200")
  .option("--source <name>", "Log source: auto | events | legacy", "auto")
  .addHelpText(
    "after",
    `
Examples:
  termite-commander logs --colony .
  termite-commander logs --colony . --source events --lines 400
`
  )
  .action((opts: { colony: string; lines: string; source: string }) => {
    const source = (opts.source ?? "auto").toLowerCase().trim();
    if (!["auto", "events", "legacy"].includes(source)) {
      console.error("Invalid --source value. Use: auto | events | legacy");
      process.exit(1);
    }
    const lineCount = parsePositiveInt(opts.lines, 200);
    const logPath = getCommanderLogPath(opts.colony, source as "auto" | "events" | "legacy");
    const lines = readTailLines(logPath, lineCount, 256 * 1024);
    if (lines.length === 0) {
      console.log(`No logs found at ${logPath}`);
      return;
    }
    console.log(`# ${logPath}`);
    for (const line of lines) {
      console.log(line);
    }
  });

program
  .command("stop")
  .description("Stop commander runtime and known worker processes")
  .option("-c, --colony <path>", "Colony root directory", process.cwd())
  .option("--force", "Force cleanup lock/status and SIGKILL stubborn commander/worker pids", false)
  .addHelpText(
    "after",
    `
Example:
  termite-commander stop --colony .
  termite-commander stop --colony . --force
`
  )
  .action(async (opts: { colony: string; force: boolean }) => {
    stopCommanderProcess(opts.colony, opts.force);
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
    console.log("  ID                              CLI      MODEL                     PID      STATUS    SESSION             STARTED");
    console.log("  " + "-".repeat(128));
    for (const w of workers) {
      const sid = w.sessionId ? w.sessionId.slice(0, 16) + "..." : "-";
      const started = w.startedAt ? new Date(w.startedAt).toLocaleTimeString() : "-";
      const cli = (w.cli ?? "-").toString();
      const model = (w.model ?? "-").toString();
      const pid = typeof w.pid === "number" ? String(w.pid) : "-";
      console.log(`  ${w.id.padEnd(34)}${cli.padEnd(9)}${model.padEnd(26)}${pid.padEnd(9)}${w.status.padEnd(10)}${sid.padEnd(20)}${started}`);
    }
  });

if (process.argv.length <= 2) {
  await launchDashboard(process.cwd(), "auto", {
    intervalMs: 5000,
    announce: false,
  });
} else {
  program.parse();
}
