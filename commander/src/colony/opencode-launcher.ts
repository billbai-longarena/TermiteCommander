import { spawn, execFile, type ChildProcess } from "node:child_process";
import { existsSync, copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface OpenCodeWorker {
  id: string;
  model: string;
  sessionId: string | null;
  process: ChildProcess | null;
  startedAt: Date;
  status: "running" | "stopped" | "errored" | "idle";
}

export interface WorkerModelSpec {
  model: string;
  count: number;
}

export interface LauncherConfig {
  colonyRoot: string;
  skillSourceDir: string;
  workerSpecs: WorkerModelSpec[];
  defaultWorkerModel: string;
}

export class OpenCodeLauncher {
  private config: LauncherConfig;
  private workers: Map<string, OpenCodeWorker> = new Map();

  constructor(config: LauncherConfig) {
    this.config = config;
  }

  /**
   * Recursively copy a directory tree.
   */
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

  /**
   * Install termite skill files into the colony so OpenCode can discover them.
   * Also installs Commander OpenCode skill and Claude Code plugin.
   */
  installSkills(): void {
    // 1. Existing: copy termite protocol skills → .opencode/skill/termite/
    const termiteDest = join(this.config.colonyRoot, ".opencode", "skill", "termite");
    mkdirSync(termiteDest, { recursive: true });

    const files = ["SKILL.md", "arrive.md", "deposit.md", "molt.md"];
    for (const file of files) {
      const src = join(this.config.skillSourceDir, file);
      const dst = join(termiteDest, file);
      if (existsSync(src)) {
        copyFileSync(src, dst);
      }
    }
    console.log(`[launcher] Installed termite skills to ${termiteDest}`);

    // Resolve plugins base dir (relative to skillSourceDir: ../plugins)
    const pluginsBase = resolve(this.config.skillSourceDir, "../../plugins");

    // 2. Copy OpenCode commander skill → .opencode/skill/commander/
    const opencodeSrc = join(pluginsBase, "opencode");
    if (existsSync(opencodeSrc)) {
      const opencodeDest = join(this.config.colonyRoot, ".opencode", "skill", "commander");
      this.copyDirRecursive(opencodeSrc, opencodeDest);
      console.log(`[launcher] Installed commander skill to ${opencodeDest}`);
    }

    // 3. Copy Claude Code plugin → .claude/plugins/termite-commander/
    const claudeCodeSrc = join(pluginsBase, "claude-code");
    if (existsSync(claudeCodeSrc)) {
      const claudeCodeDest = join(this.config.colonyRoot, ".claude", "plugins", "termite-commander");
      this.copyDirRecursive(claudeCodeSrc, claudeCodeDest);
      console.log(`[launcher] Installed Claude Code plugin to ${claudeCodeDest}`);
    }
  }

  /**
   * Launch an OpenCode worker using `opencode run` (non-interactive mode).
   * The first call creates a new session; subsequent pulses continue it.
   */
  async launchWorker(model?: string, workerId?: string): Promise<OpenCodeWorker> {
    const id = workerId ?? `termite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const totalMax = this.config.workerSpecs.reduce((sum, s) => sum + s.count, 0);
    if (this.workers.size >= totalMax) {
      throw new Error(`Max workers (${totalMax}) reached`);
    }

    const worker: OpenCodeWorker = {
      id,
      model: model ?? this.config.defaultWorkerModel,
      sessionId: null,
      process: null,
      startedAt: new Date(),
      status: "idle",
    };
    this.workers.set(id, worker);

    console.log(`[launcher] Starting worker: ${id} (model: ${worker.model})`);

    await this.runOpenCode(worker, "白蚁协议");

    return worker;
  }

  async launchFleet(): Promise<void> {
    for (const spec of this.config.workerSpecs) {
      for (let i = 0; i < spec.count; i++) {
        await this.launchWorker(spec.model);
      }
    }
  }

  /**
   * Run opencode for a worker. First call creates session, subsequent calls continue it.
   */
  private async runOpenCode(worker: OpenCodeWorker, prompt: string): Promise<void> {
    const args = ["run", prompt, "--format", "json", "--dir", resolve(this.config.colonyRoot)];

    // Continue existing session if we have one
    if (worker.sessionId) {
      args.push("--session", worker.sessionId);
    } else {
      args.push("--title", `Termite: ${worker.id}`);
    }

    worker.status = "running";

    const child = spawn("opencode", args, {
      cwd: resolve(this.config.colonyRoot),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TERMITE_WORKER_ID: worker.id,
      },
    });

    worker.process = child;

    let stdout = "";
    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      // Extract session ID from JSON output
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.sessionID && !worker.sessionId) {
            worker.sessionId = obj.sessionID;
            console.log(`[worker:${worker.id}] Session: ${worker.sessionId}`);
          }
        } catch {
          // Not JSON, skip
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.error(`[worker:${worker.id}:err] ${text.slice(0, 300)}`);
    });

    child.on("exit", (code) => {
      console.log(`[worker:${worker.id}] Run exited with code ${code}`);
      worker.status = code === 0 ? "idle" : "errored";
      worker.process = null;
    });
  }

  /**
   * Pulse a single worker: send "白蚁协议" via opencode run --continue.
   * Only pulses idle workers (not currently running).
   */
  async pulseWorker(workerId: string): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    // Skip if already running a task
    if (worker.status === "running") {
      return false;
    }

    // Skip errored workers
    if (worker.status === "errored") {
      return false;
    }

    await this.runOpenCode(worker, "白蚁协议");
    return true;
  }

  /**
   * Pulse all idle workers.
   */
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

  /**
   * Stop a specific worker.
   */
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

  /**
   * Stop all workers.
   */
  stopAll(): void {
    for (const [id] of this.workers) {
      this.stopWorker(id);
    }
  }

  /**
   * Get count of active workers (running or idle with session).
   */
  activeCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.status === "running" || worker.status === "idle") count++;
    }
    return count;
  }

  /**
   * Get count of currently executing workers.
   */
  runningCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.status === "running") count++;
    }
    return count;
  }

  /**
   * Get all worker statuses.
   */
  getWorkers(): OpenCodeWorker[] {
    return [...this.workers.values()];
  }
}
