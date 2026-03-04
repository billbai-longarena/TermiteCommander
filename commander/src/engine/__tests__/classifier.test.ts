import { describe, it, expect } from "vitest";
import { TaskClassifier } from "../classifier.js";

describe("TaskClassifier", () => {
  it("should classify build-oriented input as BUILD", () => {
    expect(TaskClassifier.classify("构建用户认证系统，支持 OAuth 和 JWT")).toBe("BUILD");
    expect(TaskClassifier.classify("Build a REST API for user management")).toBe("BUILD");
  });

  it("should classify research-only input as BUILD (RESEARCH removed)", () => {
    expect(TaskClassifier.classify("research financial reports")).toBe("BUILD");
    expect(TaskClassifier.classify("Research top 10 competitors in the market")).toBe("BUILD");
  });

  it("should classify mixed build+research input as HYBRID", () => {
    expect(TaskClassifier.classify("调研竞品的推荐算法并实现我们的版本")).toBe("HYBRID");
    expect(TaskClassifier.classify("Research the auth libraries and implement JWT login")).toBe("HYBRID");
  });

  it("should default to BUILD for generic input", () => {
    expect(TaskClassifier.classify("do something")).toBe("BUILD");
  });

  describe("classifyWithLLM", () => {
    it("should use LLM result when valid", async () => {
      const result = await TaskClassifier.classifyWithLLM(
        "build a feature",
        async () => "BUILD",
      );
      expect(result).toBe("BUILD");
    });

    it("should fall back to heuristic on invalid LLM result", async () => {
      const result = await TaskClassifier.classifyWithLLM(
        "build a feature",
        async () => "RESEARCH",
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
