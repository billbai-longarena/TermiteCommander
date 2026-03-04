// commander/src/colony/__tests__/signal-bridge.test.ts
import { describe, it, expect } from "vitest";
import { SignalBridge } from "../signal-bridge.js";

describe("SignalBridge", () => {
  it("should detect colony root by finding scripts/ directory", () => {
    const bridge = new SignalBridge("/Users/bingbingbai/Desktop/TermiteCommander/TermiteProtocol/templates");
    expect(bridge.colonyRoot).toBe("/Users/bingbingbai/Desktop/TermiteCommander/TermiteProtocol/templates");
    expect(bridge.hasScripts()).toBe(true);
  });

  it("should return false for hasScripts when no scripts/ directory", () => {
    const bridge = new SignalBridge("/tmp/nonexistent-path-xyz");
    expect(bridge.hasScripts()).toBe(false);
  });

  it("should execute a command and return stdout", async () => {
    const bridge = new SignalBridge("/Users/bingbingbai/Desktop/TermiteCommander/TermiteProtocol/templates");
    const result = await bridge.exec("ls", ["scripts/field-arrive.sh"]);
    expect(result.stdout).toContain("field-arrive.sh");
    expect(result.exitCode).toBe(0);
  });

  it("should handle command failure gracefully", async () => {
    const bridge = new SignalBridge("/tmp");
    const result = await bridge.exec("ls", ["nonexistent-file-xyz"]);
    expect(result.exitCode).not.toBe(0);
  });
});
