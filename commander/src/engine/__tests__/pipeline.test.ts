import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Plan } from "../../colony/plan-writer.js";

const callLLMMock = vi.fn();
const assertPlanningModelConfiguredMock = vi.fn();
const assertProviderCredentialsMock = vi.fn();

vi.mock("../../llm/provider.js", () => ({
  callLLM: (...args: unknown[]) => callLLMMock(...args),
  configFromResolved: () => ({
    provider: "anthropic",
    model: "claude-sonnet-4-5",
  }),
  assertProviderCredentials: (...args: unknown[]) =>
    assertProviderCredentialsMock(...args),
}));

vi.mock("../../config/model-resolver.js", () => ({
  resolveModels: () => ({
    commanderModel: "claude-sonnet-4-5",
    commanderProvider: "anthropic",
    workers: [{ cli: "opencode", model: undefined, count: 1 }],
    defaultWorkerCli: "opencode",
    defaultWorkerModel: "claude-haiku-3-5",
    resolution: {
      commanderModel: { source: "default", detail: "claude-sonnet-4-5" },
      defaultWorkerCli: { source: "default", detail: "opencode" },
      defaultWorkerModel: { source: "default", detail: "claude-haiku-3-5" },
      workers: { source: "default", detail: "1 x claude-haiku-3-5" },
    },
    issues: {
      warnings: [],
      errors: [],
    },
  }),
  assertPlanningModelConfigured: (...args: unknown[]) =>
    assertPlanningModelConfiguredMock(...args),
}));

import { Pipeline } from "../pipeline.js";

describe("Pipeline", () => {
  let tempDir: string;

  const createPipeline = () =>
    new Pipeline({
      colonyRoot: tempDir,
      platform: "unknown",
      skillSourceDir: tempDir,
    });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pipeline-test-"));
    vi.clearAllMocks();
    assertPlanningModelConfiguredMock.mockImplementation(() => undefined);
    assertProviderCredentialsMock.mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("falls back to a single signal when decomposition LLM fails", async () => {
    callLLMMock
      .mockResolvedValueOnce("BUILD")
      .mockRejectedValueOnce(new Error("network down"));

    const pipeline = createPipeline();
    const plan = await pipeline.plan("Create hello world endpoint");

    expect(plan.taskType).toBe("BUILD");
    expect(plan.signals).toHaveLength(1);
    expect(plan.signals[0].id).toBe("S-001");
    expect(plan.signals[0].parentId).toBeNull();
    expect(plan.signals[0].title).toContain("Create hello world endpoint");
  });

  it("blocks planning when model config is invalid", () => {
    assertPlanningModelConfiguredMock.mockImplementation(() => {
      throw new Error("Model configuration invalid");
    });

    expect(() => createPipeline()).toThrow("Model configuration invalid");
  });

  it("remaps parentId correctly after signal reordering", async () => {
    callLLMMock
      .mockResolvedValueOnce("BUILD")
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            type: "HOLE",
            title: "Child task",
            weight: 80,
            source: "directive",
            parentId: "S-002",
            childHint: null,
            module: "",
            nextHint: "Do child task",
            acceptanceCriteria: "Child completed",
          },
          {
            type: "HOLE",
            title: "Root task",
            weight: 90,
            source: "directive",
            parentId: null,
            childHint: null,
            module: "",
            nextHint: "Do root task",
            acceptanceCriteria: "Root completed",
          },
        ]),
      );

    const pipeline = createPipeline();
    const plan = await pipeline.plan("Build feature");

    expect(plan.signals).toHaveLength(2);
    expect(plan.signals[0]).toMatchObject({
      id: "S-001",
      title: "Root task",
      parentId: null,
    });
    expect(plan.signals[1]).toMatchObject({
      id: "S-002",
      title: "Child task",
      parentId: "S-001",
    });
  });

  it("maps plan parent IDs to DB IDs when dispatching", async () => {
    const pipeline = createPipeline();
    const createSignalMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "DB-100", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "DB-101", stderr: "", exitCode: 0 });
    (pipeline as any).bridge = { createSignal: createSignalMock };

    const plan: Plan = {
      objective: "Build feature",
      taskType: "BUILD",
      audience: "",
      researchFindings: "",
      userScenarios: "",
      architecture: null,
      synthesis: null,
      signals: [
        {
          id: "S-001",
          type: "HOLE",
          title: "Root task",
          weight: 80,
          parentId: null,
          status: "open",
        },
        {
          id: "S-002",
          type: "HOLE",
          title: "Child task",
          weight: 75,
          parentId: "S-001",
          status: "open",
        },
      ],
      qualityCriteria: "",
      deliverableFormat: "Code + tests",
    };

    await pipeline.dispatch(plan);

    expect(createSignalMock).toHaveBeenCalledTimes(2);
    expect(createSignalMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ parentId: undefined, title: "Root task" }),
    );
    expect(createSignalMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ parentId: "DB-100", title: "Child task" }),
    );
  });

  it("throws when plan dependencies cannot be resolved", async () => {
    const pipeline = createPipeline();
    const createSignalMock = vi.fn();
    (pipeline as any).bridge = { createSignal: createSignalMock };

    const plan: Plan = {
      objective: "Build feature",
      taskType: "BUILD",
      audience: "",
      researchFindings: "",
      userScenarios: "",
      architecture: null,
      synthesis: null,
      signals: [
        {
          id: "S-001",
          type: "HOLE",
          title: "Orphan child",
          weight: 80,
          parentId: "S-999",
          status: "open",
        },
      ],
      qualityCriteria: "",
      deliverableFormat: "Code + tests",
    };

    await expect(pipeline.dispatch(plan)).rejects.toThrow(
      "Unable to resolve signal dependency chain",
    );
    expect(createSignalMock).not.toHaveBeenCalled();
  });
});
