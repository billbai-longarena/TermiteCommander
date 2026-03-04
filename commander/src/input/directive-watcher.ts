import { watch } from "chokidar";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DirectiveWatcherConfig {
  colonyRoot: string;
  onDirective: (content: string) => Promise<void>;
}

export class DirectiveWatcher {
  private config: DirectiveWatcherConfig;
  private watcher: ReturnType<typeof watch> | null = null;

  constructor(config: DirectiveWatcherConfig) {
    this.config = config;
  }

  start(): void {
    const directivePath = join(this.config.colonyRoot, "DIRECTIVE.md");

    this.watcher = watch(directivePath, {
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher.on("add", async (path) => {
      console.log(`[directive-watcher] DIRECTIVE.md detected: ${path}`);
      await this.processDirective(path);
    });

    this.watcher.on("change", async (path) => {
      console.log(`[directive-watcher] DIRECTIVE.md changed: ${path}`);
      await this.processDirective(path);
    });

    console.log(`[directive-watcher] Watching for DIRECTIVE.md in ${this.config.colonyRoot}`);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    console.log("[directive-watcher] Stopped.");
  }

  private async processDirective(path: string): Promise<void> {
    try {
      const content = await readFile(path, "utf-8");
      if (content.trim().length === 0) return;
      await this.config.onDirective(content);
    } catch (err) {
      console.error("[directive-watcher] Error processing directive:", err);
    }
  }
}
