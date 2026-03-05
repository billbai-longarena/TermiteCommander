import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { WorkerRuntime } from "../config/model-resolver.js";

const execFileAsync = promisify(execFile);

const TERMITE_WORKER_PROMPT = [
  "Execute the Termite Protocol worker loop.",
  "Run ./scripts/field-arrive.sh, read .birth, claim the assigned signal, implement it, run tests, commit, and release the claim.",
  "If there is no claimable work, exit cleanly.",
].join(" ");

const RUNTIME_BINARIES: Record<WorkerRuntime, string> = {
  opencode: "opencode",
  claude: "claude",
  codex: "codex",
};

const SESSION_ID_KEYS = new Set([
  "sessionID",
  "sessionId",
  "session_id",
  "conversation_id",
  "conversationId",
]);

export interface OpenCodeWorker {
  id: string;
  cli: WorkerRuntime;
  model: string;
  sessionId: string | null;
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

export class OpenCodeLauncher {
  private config: LauncherConfig;
  private workers: Map<string, OpenCodeWorker> = new Map();

  constructor(config: LauncherConfig) {
    this.config = config;
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

  async checkRuntime(runtime: WorkerRuntime): Promise<boolean> {
    const binary = RUNTIME_BINARIES[runtime];
    try {
      await execFileAsync(binary, ["--version"], { timeout: 5000 });
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

  private async runWorker(worker: OpenCodeWorker, prompt: string): Promise<void> {
    switch (worker.cli) {
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

  private async runOpenCode(worker: OpenCodeWorker, prompt: string): Promise<void> {
    const args = ["run", prompt, "--format", "json", "--dir", resolve(this.config.colonyRoot)];
    if (worker.model) {
      args.push("--model", worker.model);
    }
    if (worker.sessionId) {
      args.push("--session", worker.sessionId);
    } else {
      args.push("--title", `Termite: ${worker.id}`);
    }
    this.spawnWorkerProcess(worker, "opencode", args);
  }

  private async runClaude(worker: OpenCodeWorker, prompt: string): Promise<void> {
    if (!worker.sessionId) {
      worker.sessionId = randomUUID();
    }

    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--permission-mode",
      "bypassPermissions",
      "--session-id",
      worker.sessionId,
    ];
    if (worker.model) {
      args.push("--model", worker.model);
    }
    this.spawnWorkerProcess(worker, "claude", args);
  }

  private async runCodex(worker: OpenCodeWorker, prompt: string): Promise<void> {
    const args = worker.sessionId
      ? ["exec", "resume", worker.sessionId, prompt]
      : ["exec", prompt];

    args.push("--json", "--full-auto", "--skip-git-repo-check", "-C", resolve(this.config.colonyRoot));
    if (worker.model) {
      args.push("-m", worker.model);
    }
    this.spawnWorkerProcess(worker, "codex", args);
  }

  private spawnWorkerProcess(worker: OpenCodeWorker, command: string, args: string[]): void {
    worker.status = "running";

    const child = spawn(command, args, {
      cwd: resolve(this.config.colonyRoot),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TERMITE_WORKER_ID: worker.id,
      },
    });

    worker.process = child;
    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      for (const line of text.split("\n")) {
        const sessionId = this.extractSessionId(line);
        if (sessionId && !worker.sessionId) {
          worker.sessionId = sessionId;
          console.log(`[worker:${worker.id}] Session: ${worker.sessionId}`);
        }
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

  private extractSessionId(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return this.findSessionId(parsed);
    } catch {
      return null;
    }
  }

  private findSessionId(value: unknown): string | null {
    if (typeof value === "string") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = this.findSessionId(item);
        if (nested) return nested;
      }
      return null;
    }
    if (!value || typeof value !== "object") return null;

    const obj = value as Record<string, unknown>;
    for (const [key, nested] of Object.entries(obj)) {
      if (SESSION_ID_KEYS.has(key) && typeof nested === "string" && nested.trim()) {
        return nested.trim();
      }
      const discovered = this.findSessionId(nested);
      if (discovered) return discovered;
    }
    return null;
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
