import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutionCoordinator } from "../coordinator.js";
import type { ExecutionPlanLike } from "../contract.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "execution-coordinator-"));
}

describe("ExecutionCoordinator", () => {
  it("routes content and outreach signals into proposed and guarded execution classes", () => {
    const tempDir = makeTempDir();
    try {
      const coordinator = new ExecutionCoordinator(tempDir);

      const content = coordinator.resolveSignalExecution("MARKET", {
        type: "CONTENT",
        module: "marketing/product-hunt",
        title: "Draft launch page copy",
        nextHint: "Prepare launch page messaging",
      });
      const outreach = coordinator.resolveSignalExecution("SALES", {
        type: "OUTREACH",
        module: "crm/pipeline",
        title: "Prepare outbound follow-up",
        nextHint: "Draft a follow-up sequence for ICP accounts",
      });

      expect(content.adapter).toBe("content");
      expect(content.executionClass).toBe("proposed");
      expect(content.policy.status).toBe("allowed");

      expect(outreach.adapter).toBe("crm");
      expect(outreach.executionClass).toBe("guarded-external");
      expect(outreach.policy.status).toBe("needs-approval");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("creates proposal artifacts and applies approved guarded actions", async () => {
    const tempDir = makeTempDir();
    try {
      const coordinator = new ExecutionCoordinator(tempDir);
      const plan: ExecutionPlanLike = {
        objective: "Operate support queue and prepare sales follow-up",
        taskType: "HYBRID",
        signals: [
          {
            id: "S-001",
            type: "OPS",
            title: "Tag onboarding incidents",
            module: "support/queue",
            nextHint: "Tag onboarding-related incidents for weekly review.",
            acceptanceCriteria: "Action is prepared for support review.",
            execution: coordinator.resolveSignalExecution("OPERATE", {
              type: "OPS",
              module: "support/queue",
              title: "Tag onboarding incidents",
              nextHint: "Tag onboarding-related incidents for weekly review.",
            }),
          },
          {
            id: "S-002",
            type: "OUTREACH",
            title: "Update CRM follow-up queue",
            module: "crm/follow-up",
            nextHint: "Prepare follow-up notes for dormant accounts.",
            acceptanceCriteria: "CRM action is ready for review.",
            execution: coordinator.resolveSignalExecution("SALES", {
              type: "OUTREACH",
              module: "crm/follow-up",
              title: "Update CRM follow-up queue",
              nextHint: "Prepare follow-up notes for dormant accounts.",
            }),
          },
        ],
      };

      const prepared = await coordinator.preparePlan(plan);
      expect(prepared).toHaveLength(2);
      expect(prepared.every((action) => action.status === "awaiting-approval")).toBe(true);
      expect(existsSync(join(tempDir, ".termite", "execution", "proposals"))).toBe(true);

      const approved = coordinator.approveActions();
      expect(approved.every((action) => action.status === "approved")).toBe(true);

      const applied = await coordinator.applyActions();
      expect(applied.every((action) => action.status === "executed")).toBe(true);
      expect(existsSync(join(tempDir, ".termite", "execution", "applied", "ACT-S-001.support.json"))).toBe(true);
      expect(existsSync(join(tempDir, ".termite", "execution", "applied", "ACT-S-002.crm.json"))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("honors execution policy overrides from termite.config.json", async () => {
    const tempDir = makeTempDir();
    try {
      writeFileSync(
        join(tempDir, "termite.config.json"),
        JSON.stringify({
          commander: {
            execution: {
              blocked_adapters: ["crm"],
            },
          },
        }, null, 2),
        "utf-8",
      );

      const coordinator = new ExecutionCoordinator(tempDir);
      const plan: ExecutionPlanLike = {
        objective: "Prepare CRM follow-up",
        taskType: "SALES",
        signals: [
          {
            id: "S-003",
            type: "OUTREACH",
            title: "Queue CRM follow-up",
            module: "crm/follow-up",
            nextHint: "Prepare follow-up for inactive accounts.",
            acceptanceCriteria: "Blocked by policy.",
            execution: coordinator.resolveSignalExecution("SALES", {
              type: "OUTREACH",
              module: "crm/follow-up",
              title: "Queue CRM follow-up",
              nextHint: "Prepare follow-up for inactive accounts.",
            }),
          },
        ],
      };

      const actions = await coordinator.preparePlan(plan);
      expect(actions[0].status).toBe("blocked");
      const saved = JSON.parse(
        readFileSync(join(tempDir, ".termite", "execution", "actions.json"), "utf-8"),
      ) as Array<{ status: string }>;
      expect(saved[0].status).toBe("blocked");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
