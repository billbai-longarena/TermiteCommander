import { describe, it, expect } from "vitest";
import { HaltWriter, type HaltInfo } from "../halt-writer.js";

describe("HaltWriter", () => {
  it("should generate HALT.md for normal completion", () => {
    const info: HaltInfo = {
      reason: "complete",
      commanderCycles: 47,
      colonyCycles: 230,
      signalsTotal: 15,
      signalsCompleted: 15,
      remainingSignals: [],
      lastCommitHash: "abc1234",
      lastCommitAge: "2 min ago",
      lastSignalChange: "S-015 -> done (5 min ago)",
      recommendation: "All work completed successfully.",
    };
    const md = HaltWriter.render(info);
    expect(md).toContain("# Colony Halted");
    expect(md).toContain("**Reason**: complete");
    expect(md).toContain("Completed: 15");
    expect(md).toContain("commander resume");
  });

  it("should generate HALT.md for stall with remaining signals", () => {
    const info: HaltInfo = {
      reason: "stall",
      commanderCycles: 20,
      colonyCycles: 80,
      signalsTotal: 10,
      signalsCompleted: 7,
      remainingSignals: ["S-008", "S-009", "S-010"],
      lastCommitHash: "def5678",
      lastCommitAge: "25 min ago",
      lastSignalChange: "S-007 -> done (30 min ago)",
      recommendation: "S-008 may be blocked. Check signal dependencies.",
    };
    const md = HaltWriter.render(info);
    expect(md).toContain("**Reason**: stall");
    expect(md).toContain("S-008, S-009, S-010");
    expect(md).toContain("25 min ago");
  });
});
