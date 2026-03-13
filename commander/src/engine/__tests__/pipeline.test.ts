import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Plan } from "../../colony/plan-writer.js";

const internalExecution = {
  adapter: "generic" as const,
  executionClass: "internal" as const,
  target: "workspace",
  policy: {
    status: "allowed" as const,
    requiresApproval: false,
    reviewRequired: false,
    reasons: ["internal action is allowed"],
  },
};

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
  readTermiteConfig: () => null,
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
      .mockResolvedValueOnce("RESEARCH")
      .mockRejectedValueOnce(new Error("network down"));

    const pipeline = createPipeline();
    const plan = await pipeline.plan("Research top competitors in AI browser testing");

    expect(plan.taskType).toBe("RESEARCH");
    expect(plan.deliverableFormat).toBe("Report");
    expect(plan.signals).toHaveLength(1);
    expect(plan.signals[0].id).toBe("S-001");
    expect(plan.signals[0].parentId).toBeNull();
    expect(plan.signals[0].type).toBe("RESEARCH");
    expect(plan.signals[0].title).toContain("Research objective");
    expect(plan.signals[0].execution.adapter).toBe("generic");
  });

  it("blocks planning when model config is invalid", () => {
    assertPlanningModelConfiguredMock.mockImplementation(() => {
      throw new Error("Model configuration invalid");
    });

    expect(() => createPipeline()).toThrow("Model configuration invalid");
  });

  it("remaps parentId correctly after signal reordering", async () => {
    callLLMMock
      .mockResolvedValueOnce("MARKET")
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            type: "CONTENT",
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
            type: "CAMPAIGN",
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
    const plan = await pipeline.plan("Prepare a launch campaign");

    expect(plan.signals).toHaveLength(2);
    expect(plan.deliverableFormat).toBe("Content");
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
          module: "src/root",
          nextHint: "Do root task",
          acceptanceCriteria: "Root completed",
          execution: internalExecution,
        },
        {
          id: "S-002",
          type: "HOLE",
          title: "Child task",
          weight: 75,
          parentId: "S-001",
          status: "open",
          module: "src/child",
          nextHint: "Do child task",
          acceptanceCriteria: "Child completed",
          execution: internalExecution,
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
          module: "src/orphan",
          nextHint: "Resolve orphan",
          acceptanceCriteria: "Resolved",
          execution: internalExecution,
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

  it("maps iterate tasks to mixed deliverables", async () => {
    callLLMMock
      .mockResolvedValueOnce("ITERATE")
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            type: "FEEDBACK",
            title: "Cluster onboarding complaints",
            weight: 82,
            source: "directive",
            parentId: null,
            childHint: null,
            module: "feedback/onboarding",
            nextHint: "Summarize recurring complaints from support tickets.",
            acceptanceCriteria: "Themes are grouped and prioritized.",
          },
        ]),
      );

    const pipeline = createPipeline();
    const plan = await pipeline.plan("Review user complaints and propose onboarding improvements");

    expect(plan.taskType).toBe("ITERATE");
    expect(plan.deliverableFormat).toBe("Mixed");
    expect(plan.signals[0]).toMatchObject({
      type: "FEEDBACK",
      title: "Cluster onboarding complaints",
    });
    expect(plan.signals[0].execution.adapter).toBe("support");
  });
});
