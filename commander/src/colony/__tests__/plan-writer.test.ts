import { describe, it, expect } from "vitest";
import { PlanWriter, type Plan } from "../plan-writer.js";

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

describe("PlanWriter", () => {
  it("should generate valid PLAN.md content from a plan object", () => {
    const plan: Plan = {
      objective: "调研新能源行业前十大客户的财报趋势",
      taskType: "RESEARCH",
      audience: "Business analyst, non-technical",
      researchFindings: "Found 10 companies with public financials...",
      userScenarios: "Analyst needs comparative dashboard...",
      architecture: null,
      synthesis: "Three key trends identified: 1) ...",
      signals: [
        { id: "S-001", type: "EXPLORE", title: "Collect Top 10 company data", weight: 80, parentId: null, status: "open", module: "research/data", nextHint: "Collect annual reports", acceptanceCriteria: "Data gathered", execution: internalExecution },
        { id: "S-002", type: "REPORT", title: "Cross-company comparison", weight: 75, parentId: "S-001", status: "open", module: "research/report", nextHint: "Summarize differences", acceptanceCriteria: "Report written", execution: internalExecution },
      ],
      qualityCriteria: "Each finding must cite data source",
      deliverableFormat: "Markdown report",
    };

    const md = PlanWriter.render(plan);
    expect(md).toContain("# Plan:");
    expect(md).toContain("调研新能源行业");
    expect(md).toContain("## Task Type");
    expect(md).toContain("RESEARCH");
    expect(md).toContain("## Signal Map");
    expect(md).toContain("S-001");
    expect(md).toContain("S-002");
    expect(md).toContain("## Quality Criteria");
    expect(md).toContain("execution: adapter=generic class=internal");
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

  it("should render expanded task types without narrowing to build-only semantics", () => {
    const plan: Plan = {
      objective: "Review support backlog and identify top incident themes",
      taskType: "OPERATE",
      audience: "Support lead",
      researchFindings: "",
      userScenarios: "",
      architecture: null,
      synthesis: "Top incidents cluster around onboarding latency.",
      signals: [],
      qualityCriteria: "Summary should be concise and actionable",
      deliverableFormat: "Ops",
    };

    const md = PlanWriter.render(plan);
    expect(md).toContain("OPERATE");
    expect(md).toContain("Ops");
    expect(md).toContain("## Synthesis");
  });
});
