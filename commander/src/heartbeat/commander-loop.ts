import { SignalBridge } from "../colony/signal-bridge.js";
import { CircuitBreaker, type CycleSnapshot } from "./circuit-breaker.js";
import { HaltWriter, type HaltInfo } from "../colony/halt-writer.js";

export interface CommanderLoopConfig {
  colonyRoot: string;
  intervalMs: number;
  stallThreshold: number;
  onCycle?: (snapshot: CycleSnapshot) => void;
  onHalt?: (info: HaltInfo) => void;
}

export class CommanderLoop {
  private bridge: SignalBridge;
  private breaker: CircuitBreaker;
  private config: CommanderLoopConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastSignalSnapshot: string = "";

  constructor(config: CommanderLoopConfig) {
    this.config = config;
    this.bridge = new SignalBridge(config.colonyRoot);
    this.breaker = new CircuitBreaker({ stallThreshold: config.stallThreshold });
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[commander-heartbeat] Started. Interval: ${this.config.intervalMs}ms`);
    await this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[commander-heartbeat] Stopped.");
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      const status = await this.bridge.status();
      const currentSnapshot = JSON.stringify(status);
      const signalChanges = currentSnapshot !== this.lastSignalSnapshot ? 1 : 0;
      this.lastSignalSnapshot = currentSnapshot;

      const stall = await this.bridge.checkStall(1);
      const newCommits = stall.stalled ? 0 : 1;

      const snapshot: CycleSnapshot = {
        openSignals: status.open,
        claimedSignals: status.claimed,
        newCommits,
        signalChanges,
      };

      this.config.onCycle?.(snapshot);

      const result = this.breaker.evaluate(snapshot);

      if (result.halt) {
        const haltInfo: HaltInfo = {
          reason: result.reason === "complete" ? "complete" : "stall",
          commanderCycles: this.breaker.totalCycles,
          colonyCycles: 0,
          signalsTotal: status.total,
          signalsCompleted: status.done,
          remainingSignals: [],
          lastCommitHash: "unknown",
          lastCommitAge: `${stall.lastCommitMinutesAgo} min ago`,
          lastSignalChange: "see colony logs",
          recommendation: result.reason === "complete"
            ? "All directive signals completed successfully."
            : `No progress for ${this.config.stallThreshold} cycles. Check for blocked signals.`,
        };

        await HaltWriter.writeToDisk(haltInfo, this.config.colonyRoot);
        this.config.onHalt?.(haltInfo);
        this.stop();
        return;
      }
    } catch (err) {
      console.error("[commander-heartbeat] Cycle error:", err);
    }

    this.timer = setTimeout(() => this.tick(), this.config.intervalMs);
  }
}
