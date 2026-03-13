import { describe, it, expect } from "vitest";
import { TaskClassifier } from "../classifier.js";

describe("TaskClassifier", () => {
  it("should classify build-oriented input as BUILD", () => {
    expect(TaskClassifier.classify("构建用户认证系统，支持 OAuth 和 JWT")).toBe("BUILD");
    expect(TaskClassifier.classify("Build a REST API for user management")).toBe("BUILD");
  });

  it("should classify research-only input as RESEARCH", () => {
    expect(TaskClassifier.classify("research financial reports")).toBe("RESEARCH");
    expect(TaskClassifier.classify("Research top 10 competitors in the market")).toBe("RESEARCH");
  });

  it("should classify mixed build+research input as HYBRID", () => {
    expect(TaskClassifier.classify("调研竞品的推荐算法并实现我们的版本")).toBe("HYBRID");
    expect(TaskClassifier.classify("Research the auth libraries and implement JWT login")).toBe("HYBRID");
  });

  it("should classify go-to-market work into MARKET", () => {
    expect(TaskClassifier.classify("Prepare a Product Hunt launch plan and landing page copy")).toBe("MARKET");
  });

  it("should classify sales workflow work into SALES", () => {
    expect(TaskClassifier.classify("Find 50 ICP accounts and draft outbound follow-up")).toBe("SALES");
  });

  it("should classify project operations work into OPERATE", () => {
    expect(TaskClassifier.classify("Summarize the support backlog and triage the top incidents")).toBe("OPERATE");
  });

  it("should classify feedback-driven work into ITERATE", () => {
    expect(TaskClassifier.classify("Review user complaints from the past 14 days and propose onboarding improvements")).toBe("ITERATE");
  });

  it("should classify multi-domain business work as HYBRID", () => {
    expect(TaskClassifier.classify("Analyze churn reasons, update onboarding copy, and implement top fixes")).toBe("HYBRID");
  });

  it("should default to BUILD for generic input", () => {
    expect(TaskClassifier.classify("do something")).toBe("BUILD");
  });

  describe("classifyWithLLM", () => {
    it("should use LLM result when valid", async () => {
      const result = await TaskClassifier.classifyWithLLM(
        "build a feature",
        async () => "Category: MARKET",
      );
      expect(result).toBe("MARKET");
    });

    it("should fall back to heuristic on invalid LLM result", async () => {
      const result = await TaskClassifier.classifyWithLLM(
        "build a feature",
        async () => "SOMETHING ELSE",
      );
      expect(result).toBe("BUILD");
    });

    it("should fall back to heuristic on LLM error", async () => {
      const result = await TaskClassifier.classifyWithLLM(
        "build a feature",
        async () => { throw new Error("LLM failed"); },
      );
      expect(result).toBe("BUILD");
    });
  });
});
