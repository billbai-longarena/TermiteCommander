import { describe, expect, it } from "vitest";
import { ProviderError } from "../providers/contract.js";
import { NativeCliProvider } from "../providers/native-cli-provider.js";
import { OpenClawProvider } from "../providers/openclaw-provider.js";

describe("provider contract v1", () => {
  it("exposes native-cli provider handshake metadata", () => {
    const provider = new NativeCliProvider();
    const info = provider.handshake();
    expect(info.contractVersion).toBe("1.0");
    expect(info.provider).toBe("native-cli");
    expect(info.capabilities).toContain("session_resume");
  });

  it("builds opencode and claude launch specs with expected args", () => {
    const provider = new NativeCliProvider();

    const opencode = provider.buildStartSpec({
      runtime: "opencode",
      workspace: "/tmp/work",
      workerId: "worker-1",
      prompt: "hello",
      model: "anthropic/claude-haiku-3-5",
      sessionId: null,
    });

    expect(opencode.command).toBe("opencode");
    expect(opencode.args).toContain("--title");
    expect(opencode.args).toContain("Termite: worker-1");

    const claude = provider.buildStartSpec({
      runtime: "claude",
      workspace: "/tmp/work",
      workerId: "worker-2",
      prompt: "hello",
      model: "anthropic/claude-sonnet-4-5",
      sessionId: null,
    });

    expect(claude.command).toBe("claude");
    expect(claude.args).toContain("--session-id");
    expect(claude.preassignedSessionId).toBeTruthy();
  });

  it("extracts session and run id from formatted json output", () => {
    const provider = new NativeCliProvider();
    const snapshot = provider.extractSessionSnapshot(`{
  "runId": "run-abc-001",
  "result": {
    "meta": {
      "sessionId": "sess-xyz-123"
    }
  }
}`);

    expect(snapshot.runId).toBe("run-abc-001");
    expect(snapshot.sessionId).toBe("sess-xyz-123");
  });

  it("rejects openclaw runtime for native-cli provider", () => {
    const provider = new NativeCliProvider();
    expect(() =>
      provider.buildStartSpec({
        runtime: "openclaw",
        workspace: "/tmp/work",
        workerId: "worker-openclaw",
        prompt: "hello",
        sessionId: null,
      }),
    ).toThrowError(/OpenClawProvider/i);
  });

  it("requires route context for openclaw provider start()", async () => {
    const provider = new OpenClawProvider();
    await expect(
      provider.start({
        workspace: "/tmp/work",
        prompt: "hello",
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("builds openclaw launch spec with route + session-id", async () => {
    const provider = new OpenClawProvider();
    const spec = await provider.buildStartSpec({
      workspace: "/tmp/work",
      prompt: "solve task",
      route: { agent: "coding-fast" },
      timeoutSec: 120,
      local: true,
    });

    expect(spec.command).toBe("openclaw");
    expect(spec.args).toContain("--agent");
    expect(spec.args).toContain("coding-fast");
    expect(spec.args).toContain("--session-id");
    expect(spec.args).toContain(spec.sessionId);
    expect(spec.args).toContain("--local");
  });
});
