import { describe, it, expect } from "vitest";
import { CircuitBreaker, type CycleSnapshot } from "../circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("should not trip on first cycle", () => {
    const cb = new CircuitBreaker({ stallThreshold: 3 });
    const snap: CycleSnapshot = { openSignals: 5, claimedSignals: 2, newCommits: 1, signalChanges: 1 };
    expect(cb.evaluate(snap)).toEqual({ halt: false, reason: null });
  });

  it("should trip on signal drain (all done)", () => {
    const cb = new CircuitBreaker({ stallThreshold: 3 });
    const snap: CycleSnapshot = { openSignals: 0, claimedSignals: 0, newCommits: 0, signalChanges: 0 };
    expect(cb.evaluate(snap)).toEqual({ halt: true, reason: "complete" });
  });

  it("should trip after N consecutive stall cycles", () => {
    const cb = new CircuitBreaker({ stallThreshold: 3 });
    const stall: CycleSnapshot = { openSignals: 3, claimedSignals: 1, newCommits: 0, signalChanges: 0 };

    expect(cb.evaluate(stall).halt).toBe(false);
    expect(cb.evaluate(stall).halt).toBe(false);
    expect(cb.evaluate(stall).halt).toBe(true);
    expect(cb.evaluate(stall).reason).toBe("stall");
  });

  it("should reset stall counter on progress", () => {
    const cb = new CircuitBreaker({ stallThreshold: 3 });
    const stall: CycleSnapshot = { openSignals: 3, claimedSignals: 1, newCommits: 0, signalChanges: 0 };
    const progress: CycleSnapshot = { openSignals: 2, claimedSignals: 1, newCommits: 1, signalChanges: 1 };

    cb.evaluate(stall);
    cb.evaluate(stall);
    cb.evaluate(progress);
    expect(cb.evaluate(stall).halt).toBe(false);
  });

  it("should track total cycles", () => {
    const cb = new CircuitBreaker({ stallThreshold: 3 });
    const snap: CycleSnapshot = { openSignals: 5, claimedSignals: 2, newCommits: 1, signalChanges: 1 };
    cb.evaluate(snap);
    cb.evaluate(snap);
    cb.evaluate(snap);
    expect(cb.totalCycles).toBe(3);
  });
});
