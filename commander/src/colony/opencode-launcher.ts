import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface OpenCodeWorker {
  id: string;
  process: ChildProcess;
  startedAt: Date;
  status: "running" | "stopped" | "errored";
}

export interface LauncherConfig {
  colonyRoot: string;
  skillSourceDir: string; // commander/skills/termite/
  maxWorkers: number;
}

export class OpenCodeLauncher {
  private config: LauncherConfig;
  private workers: Map<string, OpenCodeWorker> = new Map();

  constructor(config: LauncherConfig) {
    this.config = config;
  }

  /**
   * Install termite skill files into the colony so OpenCode can discover them.
   * Copies from commander/skills/termite/ to <colonyRoot>/.opencode/skill/termite/
   */
  installSkills(): void {
    const destDir = join(this.config.colonyRoot, ".opencode", "skill", "termite");
    mkdirSync(destDir, { recursive: true });

    const files = ["SKILL.md", "arrive.md", "deposit.md", "molt.md"];
    for (const file of files) {
      const src = join(this.config.skillSourceDir, file);
      const dst = join(destDir, file);
      if (existsSync(src)) {
        copyFileSync(src, dst);
      }
    }
    console.log(`[launcher] Installed termite skills to ${destDir}`);
  }

  /**
   * Launch an OpenCode worker as a termite.
   * Sends "\u767D\u8681\u534F\u8BAE" as initial prompt to trigger colony arrival.
   */
  async launchWorker(workerId?: string): Promise<OpenCodeWorker> {
    const id = workerId ?? `termite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (this.workers.size >= this.config.maxWorkers) {
      throw new Error(`Max workers (${this.config.maxWorkers}) reached`);
    }

    console.log(`[launcher] Starting OpenCode worker: ${id}`);

    // Launch opencode in non-interactive mode with initial prompt
    const child = spawn("opencode", [], {
      cwd: this.config.colonyRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENCODE_SESSION: id,
        TERMITE_WORKER_ID: id,
      },
    });

    const worker: OpenCodeWorker = {
      id,
      process: child,
      startedAt: new Date(),
      status: "running",
    };

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.log(`[worker:${id}] ${text.slice(0, 200)}`);
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.error(`[worker:${id}:err] ${text.slice(0, 200)}`);
    });

    child.on("exit", (code) => {
      console.log(`[worker:${id}] Exited with code ${code}`);
      worker.status = code === 0 ? "stopped" : "errored";
    });

    this.workers.set(id, worker);

    // Wait a moment for the process to start, then inject initial prompt
    await new Promise((resolve) => setTimeout(resolve, 2000));
    this.injectPrompt(id, "\u767D\u8681\u534F\u8BAE");

    return worker;
  }

  /**
   * Inject a prompt into a running OpenCode worker's stdin.
   * This is how the heartbeat triggers continued work.
   */
  injectPrompt(workerId: string, prompt: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker || worker.status !== "running") {
      return false;
    }

    try {
      worker.process.stdin?.write(prompt + "\n");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Inject heartbeat into all running workers.
   */
  pulseAllWorkers(): number {
    let count = 0;
    for (const [id, worker] of this.workers) {
      if (worker.status === "running") {
        if (this.injectPrompt(id, "\u767D\u8681\u534F\u8BAE")) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Stop a specific worker.
   */
  stopWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker && worker.status === "running") {
      worker.process.kill("SIGTERM");
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
   * Get count of active workers.
   */
  activeCount(): number {
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
