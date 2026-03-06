import { spawn, execFile, type ChildProcess, type ExecFileOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorkerRuntime } from "../config/model-resolver.js";
import { NativeCliProvider } from "./providers/native-cli-provider.js";
import { OpenClawProvider } from "./providers/openclaw-provider.js";

const TERMITE_WORKER_PROMPT = [
  "Execute the Termite Protocol worker loop.",
  "Run ./scripts/field-arrive.sh, read .birth, claim the assigned signal, implement it, run tests, commit, and complete the claim via ./scripts/field-claim.sh complete <signal-id> work.",
  "If there is no claimable work, exit cleanly.",
  "Workspace boundary: use .termite/worker/ as worker context and treat .termite/human/ as human draft zone.",
  "Do not read or use .termite/human/ unless the current signal explicitly references a file there.",
].join(" ");

const RUNTIME_BINARIES: Record<WorkerRuntime, string> = {
  opencode: "opencode",
  claude: "claude",
  codex: "codex",
  openclaw: "openclaw",
};

export interface OpenCodeWorker {
  id: string;
  cli: WorkerRuntime;
  model: string;
  sessionId: string | null;
  runId: string | null;
  process: ChildProcess | null;
  startedAt: Date;
  status: "running" | "stopped" | "errored" | "idle";
}

export interface WorkerModelSpec {
  cli: WorkerRuntime;
  model: string | undefined;
  count: number;
}

export interface LauncherConfig {
  colonyRoot: string;
  skillSourceDir: string;
  workerSpecs: WorkerModelSpec[];
  defaultWorkerCli: WorkerRuntime;
  defaultWorkerModel: string;
}

export interface RuntimeSmokeProbe {
  runtime: WorkerRuntime;
  model: string | null;
  ok: boolean;
  skipped: boolean;
  detail: string;
  stdout: string;
  stderr: string;
}

export class OpenCodeLauncher {
  private config: LauncherConfig;
  private workers: Map<string, OpenCodeWorker> = new Map();
  private nativeCliProvider: NativeCliProvider;
  private openClawProvider: OpenClawProvider;

  constructor(config: LauncherConfig) {
    this.config = config;
    this.nativeCliProvider = new NativeCliProvider();
    this.openClawProvider = new OpenClawProvider();
  }

  private copyDirRecursive(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      if (statSync(srcPath).isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }

  installSkills(): void {
    let installedCount = 0;

    // 1. Copy termite protocol skills -> .opencode/skill/termite/
    const termiteDest = join(this.config.colonyRoot, ".opencode", "skill", "termite");
    mkdirSync(termiteDest, { recursive: true });

    const files = ["SKILL.md", "arrive.md", "deposit.md", "molt.md"];
    const missingFiles: string[] = [];
    for (const file of files) {
      const src = join(this.config.skillSourceDir, file);
      const dst = join(termiteDest, file);
      if (existsSync(src)) {
        copyFileSync(src, dst);
        installedCount++;
      } else {
        missingFiles.push(file);
      }
    }

    if (missingFiles.length === files.length) {
      throw new Error(
        `Termite skills source not found at ${this.config.skillSourceDir}. ` +
          "Reinstall termite-commander: npm install -g termite-commander",
      );
    }
    if (missingFiles.length > 0) {
      console.warn(`[launcher] Warning: missing skill files: ${missingFiles.join(", ")}`);
    }
    console.log(`[launcher] Installed ${installedCount} termite skills to ${termiteDest}`);

    const pluginsBase = resolve(this.config.skillSourceDir, "../../plugins");

    // 2. Copy OpenCode commander skill -> .opencode/skill/commander/
    const opencodeSrc = join(pluginsBase, "opencode");
    if (existsSync(opencodeSrc)) {
      const opencodeDest = join(this.config.colonyRoot, ".opencode", "skill", "commander");
      this.copyDirRecursive(opencodeSrc, opencodeDest);
      console.log(`[launcher] Installed commander skill to ${opencodeDest}`);
      installedCount++;
    } else {
      console.warn(`[launcher] Warning: OpenCode skill not found at ${opencodeSrc}`);
    }

    // 3. Copy Claude Code plugin -> .claude/plugins/termite-commander/
    const claudeCodeSrc = join(pluginsBase, "claude-code");
    if (existsSync(claudeCodeSrc)) {
      const claudeCodeDest = join(this.config.colonyRoot, ".claude", "plugins", "termite-commander");
      this.copyDirRecursive(claudeCodeSrc, claudeCodeDest);
      console.log(`[launcher] Installed Claude Code plugin to ${claudeCodeDest}`);
      installedCount++;
    } else {
      console.warn(`[launcher] Warning: Claude Code plugin not found at ${claudeCodeSrc}`);
    }

    console.log(`[launcher] Installation complete: ${installedCount} components installed`);
  }

  async launchWorker(
    model?: string,
    cli?: WorkerRuntime,
    workerId?: string,
  ): Promise<OpenCodeWorker> {
    const id = workerId ?? `termite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const totalMax = this.config.workerSpecs.reduce((sum, s) => sum + s.count, 0);
    if (this.workers.size >= totalMax) {
      throw new Error(`Max workers (${totalMax}) reached`);
    }

    const worker: OpenCodeWorker = {
      id,
      cli: cli ?? this.config.defaultWorkerCli,
      model: model ?? this.config.defaultWorkerModel,
      sessionId: null,
      runId: null,
      process: null,
      startedAt: new Date(),
      status: "idle",
    };
    this.workers.set(id, worker);

    console.log(`[launcher] Starting worker: ${id} (cli: ${worker.cli}, model: ${worker.model})`);
    await this.runWorker(worker, TERMITE_WORKER_PROMPT);
    return worker;
  }

  async launchFleet(): Promise<void> {
    for (const spec of this.config.workerSpecs) {
      for (let i = 0; i < spec.count; i++) {
        await this.launchWorker(spec.model, spec.cli);
      }
    }
  }

  async checkOpenCode(): Promise<boolean> {
    return this.checkRuntime("opencode");
  }

  private execFileWithClosedStdin(
    command: string,
    args: string[],
    options: ExecFileOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = execFile(command, args, options, (err, stdout, stderr) => {
        if (err) {
          (err as any).stdout = stdout;
          (err as any).stderr = stderr;
          rejectPromise(err);
          return;
        }
        resolvePromise({
          stdout: (stdout ?? "").toString(),
          stderr: (stderr ?? "").toString(),
        });
      });

      // Ensure non-interactive CLI probes receive EOF immediately.
      try {
        child.stdin?.end();
      } catch {
        // ignore stdin close errors
      }
    });
  }

  private buildProbeFailureDetail(err: any, timeoutMs: number): string {
    const timedOut =
      err?.killed === true ||
      err?.signal === "SIGTERM" ||
      /timed out/i.test(String(err?.message ?? ""));
    if (timedOut) {
      return (
        `Smoke test timed out after ${Math.floor(timeoutMs / 1000)}s. ` +
        "The runtime may still be healthy in interactive mode; retry with a larger --runtime-timeout."
      );
    }

    const tags: string[] = [];
    if (typeof err?.code !== "undefined") tags.push(`code=${String(err.code)}`);
    if (typeof err?.signal === "string" && err.signal) tags.push(`signal=${err.signal}`);
    const message = String(err?.message ?? "Smoke test failed.");
    return tags.length > 0 ? `${message} (${tags.join(", ")})` : message;
  }

  async checkRuntime(runtime: WorkerRuntime): Promise<boolean> {
    const binary = RUNTIME_BINARIES[runtime];
    try {
      await this.execFileWithClosedStdin(binary, ["--version"], {
        timeout: 5000,
        maxBuffer: 256 * 1024,
      });
      return true;
    } catch {
      return false;
    }
  }

  async checkRequiredRuntimes(): Promise<{
    required: WorkerRuntime[];
    available: WorkerRuntime[];
    missing: WorkerRuntime[];
  }> {
    const requiredSet = new Set<WorkerRuntime>();
    for (const spec of this.config.workerSpecs) {
      requiredSet.add(spec.cli);
    }
    if (requiredSet.size === 0) {
      requiredSet.add(this.config.defaultWorkerCli);
    }

    const required = [...requiredSet.values()];
    const available: WorkerRuntime[] = [];
    const missing: WorkerRuntime[] = [];

    for (const runtime of required) {
      if (await this.checkRuntime(runtime)) {
        available.push(runtime);
      } else {
        missing.push(runtime);
      }
    }

    return { required, available, missing };
  }

  getRuntimeModelTargets(): Array<{ runtime: WorkerRuntime; model: string | null }> {
    const targets = new Map<string, { runtime: WorkerRuntime; model: string | null }>();
    for (const spec of this.config.workerSpecs) {
      const runtime = spec.cli;
      const model = (spec.model ?? this.config.defaultWorkerModel)?.trim() || null;
      const key = `${runtime}|${model ?? "<none>"}`;
      if (!targets.has(key)) {
        targets.set(key, { runtime, model });
      }
    }
    if (targets.size === 0) {
      const runtime = this.config.defaultWorkerCli;
      const model = this.config.defaultWorkerModel?.trim() || null;
      targets.set(`${runtime}|${model ?? "<none>"}`, { runtime, model });
    }
    return [...targets.values()];
  }

  async smokeTestRuntimeModel(
    runtime: WorkerRuntime,
    model: string | null,
    timeoutMs = 30_000,
  ): Promise<RuntimeSmokeProbe> {
    const prompt = "Reply with exactly: OK";
    const workspace = resolve(this.config.colonyRoot);
    const effectiveTimeoutMs = runtime === "opencode" ? Math.max(timeoutMs, 60_000) : timeoutMs;

    const runExecFile = async (
      command: string,
      args: string[],
      skipped = false,
      skippedDetail?: string,
    ): Promise<RuntimeSmokeProbe> => {
      if (skipped) {
        return {
          runtime,
          model,
          ok: true,
          skipped: true,
          detail: skippedDetail ?? "Skipped runtime smoke test.",
          stdout: "",
          stderr: "",
        };
      }
      try {
        const result = await this.execFileWithClosedStdin(command, args, {
          cwd: workspace,
          timeout: effectiveTimeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          env: {
            ...process.env,
            CI: process.env.CI ?? "1",
            TERM: process.env.TERM ?? "dumb",
          },
        });
        return {
          runtime,
          model,
          ok: true,
          skipped: false,
          detail:
            effectiveTimeoutMs !== timeoutMs
              ? `Smoke test passed (timeout auto-raised to ${Math.floor(effectiveTimeoutMs / 1000)}s for ${runtime}).`
              : "Smoke test passed.",
          stdout: result.stdout.toString().trim(),
          stderr: result.stderr.toString().trim(),
        };
      } catch (err: any) {
        const detail = this.buildProbeFailureDetail(err, effectiveTimeoutMs);
        return {
          runtime,
          model,
          ok: false,
          skipped: false,
          detail,
          stdout: (err?.stdout ?? "").toString().trim(),
          stderr: (err?.stderr ?? "").toString().trim(),
        };
      }
    };

    if (runtime === "opencode") {
      const args = ["run", prompt, "--format", "json", "--dir", workspace];
      if (model) args.push("--model", model);
      return runExecFile("opencode", args);
    }

    if (runtime === "claude") {
      const args = [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--permission-mode",
        "bypassPermissions",
        "--session-id",
        randomUUID(),
      ];
      if (model) args.push("--model", model);
      return runExecFile("claude", args);
    }

    if (runtime === "codex") {
      const args = ["exec", prompt, "--json", "--full-auto", "--skip-git-repo-check", "-C", workspace];
      if (model) args.push("-m", model);
      return runExecFile("codex", args);
    }

    return runExecFile(
      "openclaw",
      [],
      true,
      "Skipped: OpenClaw smoke test requires route/session context that is not stable in doctor preflight.",
    );
  }

  async smokeTestConfiguredWorkers(timeoutMs = 30_000): Promise<RuntimeSmokeProbe[]> {
    const targets = this.getRuntimeModelTargets();
    const probes: RuntimeSmokeProbe[] = [];
    for (const target of targets) {
      probes.push(await this.smokeTestRuntimeModel(target.runtime, target.model, timeoutMs));
    }
    return probes;
  }

  private async runWorker(worker: OpenCodeWorker, prompt: string): Promise<void> {
    switch (worker.cli) {
      case "openclaw":
        await this.runOpenClaw(worker, prompt);
        return;
      case "claude":
        await this.runClaude(worker, prompt);
        return;
      case "codex":
        await this.runCodex(worker, prompt);
        return;
      case "opencode":
      default:
        await this.runOpenCode(worker, prompt);
    }
  }

  private async runOpenClaw(worker: OpenCodeWorker, prompt: string): Promise<void> {
    const agentId = worker.model && !worker.model.includes("/") ? worker.model : undefined;

    const spec = await this.openClawProvider.buildStartSpec({
      workspace: this.config.colonyRoot,
      prompt,
      route: {
        // Keep openclaw invocation valid even when no explicit route is configured.
        sessionId: worker.sessionId ?? randomUUID(),
        agent: agentId,
      },
      local: false,
      timeoutSec: 600,
    });

    if (!worker.sessionId) {
      worker.sessionId = spec.sessionId;
    }

    this.spawnWorkerProcess(worker, spec.command, spec.args);
  }

  private async runOpenCode(worker: OpenCodeWorker, prompt: string): Promise<void> {
    this.runNativeCli(worker, prompt, "opencode");
  }

  private async runClaude(worker: OpenCodeWorker, prompt: string): Promise<void> {
    this.runNativeCli(worker, prompt, "claude");
  }

  private async runCodex(worker: OpenCodeWorker, prompt: string): Promise<void> {
    this.runNativeCli(worker, prompt, "codex");
  }

  private runNativeCli(
    worker: OpenCodeWorker,
    prompt: string,
    runtime: WorkerRuntime,
  ): void {
    const spec = this.nativeCliProvider.buildStartSpec({
      runtime,
      workspace: this.config.colonyRoot,
      workerId: worker.id,
      prompt,
      model: worker.model,
      sessionId: worker.sessionId,
    });
    if (spec.preassignedSessionId && !worker.sessionId) {
      worker.sessionId = spec.preassignedSessionId;
    }
    this.spawnWorkerProcess(worker, spec.command, spec.args);
  }

  private spawnWorkerProcess(worker: OpenCodeWorker, command: string, args: string[]): void {
    worker.status = "running";

    const child = spawn(command, args, {
      cwd: resolve(this.config.colonyRoot),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TERMITE_WORKER_ID: worker.id,
        TERMITE_WORKER_CONTEXT_ROOT: ".termite/worker",
        TERMITE_HUMAN_DRAFT_ROOT: ".termite/human",
      },
    });

    worker.process = child;
    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      const snapshot =
        command === "openclaw"
          ? this.openClawProvider.extractSessionSnapshot(text)
          : this.nativeCliProvider.extractSessionSnapshot(text);
      if (snapshot.sessionId && !worker.sessionId) {
        worker.sessionId = snapshot.sessionId;
        console.log(`[worker:${worker.id}] Session: ${worker.sessionId}`);
      }
      if (snapshot.runId && !worker.runId) {
        worker.runId = snapshot.runId;
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.error(`[worker:${worker.id}:${command}:err] ${text.slice(0, 400)}`);
    });

    child.on("exit", (code) => {
      console.log(`[worker:${worker.id}] Run exited with code ${code}`);
      worker.status = code === 0 ? "idle" : "errored";
      worker.process = null;
    });
  }

  async pulseWorker(workerId: string): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker) return false;
    if (worker.status === "running") return false;
    if (worker.status === "errored") return false;

    await this.runWorker(worker, TERMITE_WORKER_PROMPT);
    return true;
  }

  async pulseAllWorkers(): Promise<number> {
    let count = 0;
    for (const [id, worker] of this.workers) {
      if (worker.status === "idle") {
        await this.pulseWorker(id);
        count++;
      }
    }
    return count;
  }

  stopWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      if (worker.process) {
        worker.process.kill("SIGTERM");
      }
      worker.status = "stopped";
      console.log(`[launcher] Stopped worker: ${workerId}`);
    }
  }

  stopAll(): void {
    for (const [id] of this.workers) {
      this.stopWorker(id);
    }
  }

  activeCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.status === "running" || worker.status === "idle") count++;
    }
    return count;
  }

  runningCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.status === "running") count++;
    }
    return count;
  }

  getWorkers(): OpenCodeWorker[] {
    return [...this.workers.values()];
  }
}
