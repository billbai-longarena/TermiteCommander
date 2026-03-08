import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const {
  spawnMock,
  execFileMock,
  randomUUIDMock,
  fakeChildren,
} = vi.hoisted(() => {
  const fakeChildren: Array<EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> }> = [];
  const spawnMock = vi.fn((_command: string, _args: string[], _opts: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    fakeChildren.push(child);
    return child;
  });

  const execFileMock = vi.fn((...args: any[]) => {
    const cb = args[args.length - 1];
    cb(null, "ok", "");
    return {};
  });

  const randomUUIDMock = vi.fn(() => "uuid-fixed-123");

  return {
    spawnMock,
    execFileMock,
    randomUUIDMock,
    fakeChildren,
  };
});

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("node:crypto", () => ({
  randomUUID: (...args: unknown[]) => randomUUIDMock(...args),
}));

import { OpenCodeLauncher } from "../opencode-launcher.js";

describe("OpenCodeLauncher", () => {
  let colonyRoot: string;

  const createLauncher = (workerSpecs = [{ cli: "opencode" as const, model: undefined, count: 3 }]) =>
    new OpenCodeLauncher({
      colonyRoot,
      skillSourceDir: colonyRoot,
      workerSpecs,
      defaultWorkerCli: "opencode",
      defaultWorkerModel: "anthropic/claude-haiku-3-5",
    });

  beforeEach(() => {
    colonyRoot = mkdtempSync(join(tmpdir(), "opencode-launcher-test-"));
    vi.clearAllMocks();
    fakeChildren.splice(0, fakeChildren.length);
    randomUUIDMock.mockReturnValue("uuid-fixed-123");
    execFileMock.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1];
      cb(null, "ok", "");
      return {};
    });
  });

  afterEach(() => {
    rmSync(colonyRoot, { recursive: true, force: true });
  });

  it("checks runtime availability via execFile --version", async () => {
    const launcher = createLauncher();
    await expect(launcher.checkRuntime("opencode")).resolves.toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      "opencode",
      ["--version"],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it("returns false when runtime check fails", async () => {
    execFileMock.mockImplementationOnce((...args: any[]) => {
      const cb = args[args.length - 1];
      const err: any = new Error("missing binary");
      err.code = 1;
      cb(err, "", "not found");
      return {};
    });

    const launcher = createLauncher();
    await expect(launcher.checkRuntime("claude")).resolves.toBe(false);
  });

  it("resolves required runtimes from worker specs with dedupe", async () => {
    const launcher = createLauncher([
      { cli: "opencode", model: undefined, count: 1 },
      { cli: "claude", model: "anthropic/claude-sonnet-4-5", count: 1 },
      { cli: "openclaw", model: "coding-fast", count: 1 },
      { cli: "opencode", model: "anthropic/claude-haiku-3-5", count: 2 },
    ]);

    vi.spyOn(launcher, "checkRuntime").mockImplementation(async (runtime) => runtime !== "claude");
    const result = await launcher.checkRequiredRuntimes();

    expect(result.required).toEqual(["opencode", "claude", "openclaw"]);
    expect(result.available).toEqual(["opencode", "openclaw"]);
    expect(result.missing).toEqual(["claude"]);
  });

  it("falls back to default runtime when worker specs are empty", async () => {
    const launcher = new OpenCodeLauncher({
      colonyRoot,
      skillSourceDir: colonyRoot,
      workerSpecs: [],
      defaultWorkerCli: "codex",
      defaultWorkerModel: "openai/gpt-5-codex",
    });

    vi.spyOn(launcher, "checkRuntime").mockResolvedValue(true);
    const result = await launcher.checkRequiredRuntimes();
    expect(result.required).toEqual(["codex"]);
  });

  it("builds deduped runtime/model targets from worker specs", () => {
    const launcher = createLauncher([
      { cli: "opencode", model: "anthropic/claude-haiku-3-5", count: 2 },
      { cli: "opencode", model: "anthropic/claude-haiku-3-5", count: 1 },
      { cli: "codex", model: "openai/gpt-5-codex", count: 1 },
    ]);
    expect(launcher.getRuntimeModelTargets()).toEqual([
      { runtime: "opencode", model: "anthropic/claude-haiku-3-5" },
      { runtime: "codex", model: "openai/gpt-5-codex" },
    ]);
  });

  it("runs opencode runtime smoke test with model", async () => {
    const launcher = createLauncher([{ cli: "opencode", model: "opencode/gpt-5-nano", count: 1 }]);
    const probe = await launcher.smokeTestRuntimeModel("opencode", "opencode/gpt-5-nano", 12000);
    expect(probe.ok).toBe(true);
    expect(probe.skipped).toBe(false);
    expect(probe.detail).toContain("timeout auto-raised");
    expect(execFileMock).toHaveBeenCalledWith(
      "opencode",
      expect.arrayContaining(["run", "Reply with exactly: OK", "--format", "json", "--model", "opencode/gpt-5-nano"]),
      expect.objectContaining({ timeout: 60000 }),
      expect.any(Function),
    );
  });

  it("skips openclaw runtime smoke test in doctor preflight", async () => {
    const launcher = createLauncher([{ cli: "openclaw", model: "coding-fast", count: 1 }]);
    const probe = await launcher.smokeTestRuntimeModel("openclaw", "coding-fast");
    expect(probe.ok).toBe(true);
    expect(probe.skipped).toBe(true);
    expect(probe.detail).toContain("Skipped");
  });

  it("runs claude runtime smoke test with verbose stream-json args", async () => {
    const launcher = createLauncher([{ cli: "claude", model: "anthropic/claude-sonnet-4-5", count: 1 }]);
    const probe = await launcher.smokeTestRuntimeModel("claude", "anthropic/claude-sonnet-4-5", 12000);

    expect(probe.ok).toBe(true);
    expect(probe.skipped).toBe(false);
    expect(execFileMock).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        "claude-sonnet-4-5",
        "Reply with exactly: OK",
      ]),
      expect.objectContaining({ timeout: 12000 }),
      expect.any(Function),
    );
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args[args.length - 1]).toBe("Reply with exactly: OK");
  });

  it("returns explicit timeout detail for runtime smoke probe timeout", async () => {
    execFileMock.mockImplementationOnce((...args: any[]) => {
      const cb = args[args.length - 1];
      const err: any = new Error("Command failed: timed out");
      err.killed = true;
      err.signal = "SIGTERM";
      cb(err, "", "");
      return {};
    });

    const launcher = createLauncher([{ cli: "opencode", model: "opencode/gpt-5-nano", count: 1 }]);
    const probe = await launcher.smokeTestRuntimeModel("opencode", "opencode/gpt-5-nano", 30000);
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain("timed out");
    expect(probe.detail).toContain("60s");
  });

  it("launches opencode worker with title and model args", async () => {
    const launcher = createLauncher();
    await launcher.launchWorker("anthropic/claude-haiku-3-5", "opencode", "worker-1");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, opts] = spawnMock.mock.calls[0] as [string, string[], any];
    expect(command).toBe("opencode");
    expect(args[0]).toBe("run");
    expect(args).toContain("--format");
    expect(args).toContain("json");
    expect(args).toContain("--model");
    expect(args).toContain("anthropic/claude-haiku-3-5");
    expect(args).toContain("--title");
    expect(args).toContain("Termite: worker-1");
    expect(opts.cwd).toBe(resolve(colonyRoot));
    expect(opts.env.TERMITE_WORKER_ID).toBe("worker-1");
  });

  it("reuses opencode session on pulse and avoids title", async () => {
    const launcher = createLauncher();
    const worker = await launcher.launchWorker("anthropic/claude-haiku-3-5", "opencode", "worker-2");
    worker.status = "idle";
    worker.sessionId = "sess-opencode-1";

    const pulsed = await launcher.pulseWorker(worker.id);
    expect(pulsed).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(2);

    const args = spawnMock.mock.calls[1][1] as string[];
    expect(args).toContain("--session");
    expect(args[args.indexOf("--session") + 1]).toBe("sess-opencode-1");
    expect(args).not.toContain("--title");
  });

  it("launches claude worker with generated session id", async () => {
    const launcher = createLauncher([{ cli: "claude", model: "anthropic/claude-sonnet-4-5", count: 1 }]);
    const worker = await launcher.launchWorker("anthropic/claude-sonnet-4-5", "claude", "worker-claude");

    const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(command).toBe("claude");
    expect(worker.sessionId).toBe("uuid-fixed-123");
    expect(args).toContain("--session-id");
    expect(args).toContain("--verbose");
    expect(args[args.indexOf("--session-id") + 1]).toBe("uuid-fixed-123");
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-5");
    expect(args).not.toContain("anthropic/claude-sonnet-4-5");
    expect(args[args.length - 1]).toBeTruthy();
  });

  it("launches codex worker and resumes existing codex session on pulse", async () => {
    const launcher = createLauncher([{ cli: "codex", model: "openai/gpt-5-codex", count: 1 }]);
    const worker = await launcher.launchWorker("openai/gpt-5-codex", "codex", "worker-codex");

    const firstArgs = spawnMock.mock.calls[0][1] as string[];
    expect(firstArgs[0]).toBe("exec");
    expect(firstArgs).toContain("--json");
    expect(firstArgs).toContain("--full-auto");
    expect(firstArgs).toContain("--skip-git-repo-check");
    expect(firstArgs).toContain("-C");
    expect(firstArgs[firstArgs.indexOf("-C") + 1]).toBe(resolve(colonyRoot));
    expect(firstArgs).toContain("-m");
    expect(firstArgs[firstArgs.indexOf("-m") + 1]).toBe("openai/gpt-5-codex");

    worker.status = "idle";
    worker.sessionId = "codex-session-xyz";
    await launcher.pulseWorker(worker.id);

    const secondArgs = spawnMock.mock.calls[1][1] as string[];
    expect(secondArgs.slice(0, 3)).toEqual(["exec", "resume", "codex-session-xyz"]);
  });

  it("launches openclaw worker with agent and session-id args", async () => {
    const launcher = createLauncher([{ cli: "openclaw", model: "coding-fast", count: 1 }]);
    const worker = await launcher.launchWorker("coding-fast", "openclaw", "worker-openclaw");

    const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(command).toBe("openclaw");
    expect(args.slice(0, 3)).toEqual(["agent", "--message", expect.any(String)]);
    expect(args).toContain("--agent");
    expect(args[args.indexOf("--agent") + 1]).toBe("coding-fast");
    expect(args).toContain("--session-id");
    expect(args[args.indexOf("--session-id") + 1]).toBe("uuid-fixed-123");
    expect(worker.sessionId).toBe("uuid-fixed-123");
  });

  it("extracts session id from nested JSON stream output", async () => {
    const launcher = createLauncher();
    const worker = await launcher.launchWorker("anthropic/claude-haiku-3-5", "opencode", "worker-3");
    const child = fakeChildren[0];

    child.stdout.emit(
      "data",
      Buffer.from('{"event":"meta","payload":{"nested":{"session_id":"sess-nested-123"}}}\n'),
    );

    expect(worker.sessionId).toBe("sess-nested-123");

    // New session IDs should not override the first captured value.
    child.stdout.emit("data", Buffer.from('{"sessionId":"sess-other"}\n'));
    expect(worker.sessionId).toBe("sess-nested-123");
  });

  it("extracts session id and run id from formatted JSON chunks", async () => {
    const launcher = createLauncher();
    const worker = await launcher.launchWorker("anthropic/claude-haiku-3-5", "opencode", "worker-formatted");
    const child = fakeChildren[0];

    child.stdout.emit(
      "data",
      Buffer.from(`{
  "runId": "run-123",
  "result": {
    "payload": {
      "sessionId": "sess-pretty-123"
    }
  }
}
`),
    );

    expect(worker.sessionId).toBe("sess-pretty-123");
    expect(worker.runId).toBe("run-123");
  });

  it("updates worker status on process exit code", async () => {
    const launcher = createLauncher();
    const okWorker = await launcher.launchWorker("anthropic/claude-haiku-3-5", "opencode", "worker-ok");
    const okChild = fakeChildren[0];
    okChild.emit("exit", 0);
    expect(okWorker.status).toBe("idle");
    expect(okWorker.process).toBeNull();

    const badWorker = await launcher.launchWorker("anthropic/claude-haiku-3-5", "opencode", "worker-bad");
    const badChild = fakeChildren[1];
    badChild.emit("exit", 2);
    expect(badWorker.status).toBe("errored");
    expect(badWorker.process).toBeNull();
  });

  it("enforces max worker count and handles stop APIs", async () => {
    const launcher = new OpenCodeLauncher({
      colonyRoot,
      skillSourceDir: colonyRoot,
      workerSpecs: [{ cli: "opencode", model: undefined, count: 1 }],
      defaultWorkerCli: "opencode",
      defaultWorkerModel: "anthropic/claude-haiku-3-5",
    });

    await launcher.launchWorker(undefined, "opencode", "worker-max");
    await expect(
      launcher.launchWorker(undefined, "opencode", "worker-over"),
    ).rejects.toThrow("Max workers (1) reached");

    expect(launcher.runningCount()).toBe(1);
    expect(launcher.activeCount()).toBe(1);

    launcher.stopAll();
    expect(fakeChildren[0].kill).toHaveBeenCalledWith("SIGTERM");
    expect(launcher.runningCount()).toBe(0);
    expect(launcher.activeCount()).toBe(0);
  });

  it("returns false when pulsing missing/running/errored workers", async () => {
    const launcher = createLauncher();
    expect(await launcher.pulseWorker("missing")).toBe(false);

    const runningWorker = await launcher.launchWorker(undefined, "opencode", "worker-running");
    expect(await launcher.pulseWorker(runningWorker.id)).toBe(false);

    runningWorker.status = "errored";
    expect(await launcher.pulseWorker(runningWorker.id)).toBe(false);
  });
});
