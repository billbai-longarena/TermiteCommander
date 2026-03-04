import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SignalBridge } from "../colony/signal-bridge.js";
import { CircuitBreaker, type CycleSnapshot } from "./circuit-breaker.js";

export type Platform = "opencode" | "claude-code" | "unknown";

export interface ColonyLoopConfig {
  colonyRoot: string;
  platform: Platform;
  baseIntervalMs: number;
  maxIntervalMs: number;
  stallThreshold: number;
  onCycle?: (snapshot: CycleSnapshot, intervalMs: number) => void;
  onHalt?: (reason: string) => void;
}

export class ColonyLoop {
  private bridge: SignalBridge;
  private breaker: CircuitBreaker;
  private config: ColonyLoopConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private currentInterval: number;
  private lastCommitHash: string = "";

  constructor(config: ColonyLoopConfig) {
    this.config = config;
    this.bridge = new SignalBridge(config.colonyRoot);
    this.breaker = new CircuitBreaker({ stallThreshold: config.stallThreshold });
    this.currentInterval = config.baseIntervalMs;
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[colony-heartbeat] Started. Platform: ${this.config.platform}. Interval: ${this.currentInterval}ms`);
    await this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[colony-heartbeat] Stopped.");
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      const status = await this.bridge.status();

      if (status.open === 0 && status.claimed === 0) {
        console.log("[colony-heartbeat] Signal drain — no work remaining.");
        this.config.onHalt?.("signal_drain");
        this.stop();
        return;
      }

      const commitResult = await this.bridge.exec("git", [
        "-C", this.config.colonyRoot, "log", "-1", "--format=%H",
      ]);
      const currentHash = commitResult.stdout.trim();
      const hasNewCommit = currentHash !== this.lastCommitHash && this.lastCommitHash !== "";
      this.lastCommitHash = currentHash;

      const snapshot: CycleSnapshot = {
        openSignals: status.open,
        claimedSignals: status.claimed,
        newCommits: hasNewCommit ? 1 : 0,
        signalChanges: 0,
      };

      const result = this.breaker.evaluate(snapshot);
      this.config.onCycle?.(snapshot, this.currentInterval);

      if (result.halt && result.reason === "stall") {
        console.log("[colony-heartbeat] Stall detected — circuit break.");
        this.config.onHalt?.("stall");
        this.stop();
        return;
      }

      if (hasNewCommit) {
        this.currentInterval = this.config.baseIntervalMs;
      } else if (status.claimed > 0) {
        this.currentInterval = Math.min(this.currentInterval * 1.2, this.config.maxIntervalMs * 0.5);
      } else {
        this.currentInterval = Math.min(this.currentInterval * 1.5, this.config.maxIntervalMs);
      }

      await this.injectHeartbeat();

    } catch (err) {
      console.error("[colony-heartbeat] Cycle error:", err);
    }

    this.timer = setTimeout(() => this.tick(), Math.round(this.currentInterval));
  }

  private async injectHeartbeat(): Promise<void> {
    const pulsePath = join(this.config.colonyRoot, ".commander-pulse");
    const now = new Date().toISOString();
    writeFileSync(pulsePath, now, "utf-8");
    console.log(`[colony-heartbeat] Pulse written at ${now}`);
  }
}
