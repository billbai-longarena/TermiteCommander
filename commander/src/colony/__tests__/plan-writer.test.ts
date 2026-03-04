import { describe, it, expect } from "vitest";
import { PlanWriter, type Plan } from "../plan-writer.js";

describe("PlanWriter", () => {
  it("should generate valid PLAN.md content from a plan object", () => {
    const plan: Plan = {
      objective: "调研新能源行业前十大客户的财报趋势",
      taskType: "BUILD",
      audience: "Business analyst, non-technical",
      researchFindings: "Found 10 companies with public financials...",
      userScenarios: "Analyst needs comparative dashboard...",
      architecture: null,
      synthesis: "Three key trends identified: 1) ...",
      signals: [
        { id: "S-001", type: "EXPLORE", title: "Collect Top 10 company data", weight: 80, parentId: null, status: "open" },
        { id: "S-002", type: "REPORT", title: "Cross-company comparison", weight: 75, parentId: "S-001", status: "open" },
      ],
      qualityCriteria: "Each finding must cite data source",
      deliverableFormat: "Markdown report",
    };

    const md = PlanWriter.render(plan);
    expect(md).toContain("# Plan:");
    expect(md).toContain("调研新能源行业");
    expect(md).toContain("## Task Type");
    expect(md).toContain("BUILD");
    expect(md).toContain("## Signal Map");
    expect(md).toContain("S-001");
    expect(md).toContain("S-002");
    expect(md).toContain("## Quality Criteria");
  });

  it("should include architecture section for BUILD tasks", () => {
    const plan: Plan = {
      objective: "Build user auth with OAuth",
      taskType: "BUILD",
      audience: "Developer",
      researchFindings: "OAuth 2.0 + JWT recommended",
      userScenarios: "User clicks login, redirected to OAuth...",
      architecture: "Three modules: auth-handler, token-store, middleware",
      synthesis: null,
      signals: [],
      qualityCriteria: "All endpoints tested, no security vulns",
      deliverableFormat: "Code + tests",
    };

    const md = PlanWriter.render(plan);
    expect(md).toContain("## Architecture");
    expect(md).toContain("Three modules");
    expect(md).not.toContain("## Synthesis");
  });
});
