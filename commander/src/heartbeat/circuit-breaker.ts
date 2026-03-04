export interface CycleSnapshot {
  openSignals: number;
  claimedSignals: number;
  newCommits: number;
  signalChanges: number;
}

export interface CircuitBreakerConfig {
  stallThreshold: number;
}

export interface CircuitBreakerResult {
  halt: boolean;
  reason: "complete" | "stall" | null;
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private consecutiveStalls: number = 0;
  private _totalCycles: number = 0;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  get totalCycles(): number {
    return this._totalCycles;
  }

  evaluate(snapshot: CycleSnapshot): CircuitBreakerResult {
    this._totalCycles++;

    if (snapshot.openSignals === 0 && snapshot.claimedSignals === 0) {
      return { halt: true, reason: "complete" };
    }

    const hasProgress = snapshot.newCommits > 0 || snapshot.signalChanges > 0;

    if (hasProgress) {
      this.consecutiveStalls = 0;
      return { halt: false, reason: null };
    }

    this.consecutiveStalls++;

    if (this.consecutiveStalls >= this.config.stallThreshold) {
      return { halt: true, reason: "stall" };
    }

    return { halt: false, reason: null };
  }

  reset(): void {
    this.consecutiveStalls = 0;
    this._totalCycles = 0;
  }
}
