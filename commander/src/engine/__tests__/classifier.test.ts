import { describe, it, expect } from "vitest";
import { TaskClassifier } from "../classifier.js";

describe("TaskClassifier", () => {
  it("should classify research-oriented input as RESEARCH", () => {
    expect(TaskClassifier.classify("调研新能源行业前十大客户的财报趋势")).toBe("RESEARCH");
    expect(TaskClassifier.classify("Research top 10 competitors in the market")).toBe("RESEARCH");
  });

  it("should classify build-oriented input as BUILD", () => {
    expect(TaskClassifier.classify("构建用户认证系统，支持 OAuth 和 JWT")).toBe("BUILD");
    expect(TaskClassifier.classify("Build a REST API for user management")).toBe("BUILD");
  });

  it("should classify analysis input as ANALYZE", () => {
    expect(TaskClassifier.classify("分析现有代码库的性能瓶颈")).toBe("ANALYZE");
    expect(TaskClassifier.classify("Analyze the database query performance")).toBe("ANALYZE");
  });

  it("should classify mixed input as HYBRID", () => {
    expect(TaskClassifier.classify("调研竞品的推荐算法并实现我们的版本")).toBe("HYBRID");
  });
});
