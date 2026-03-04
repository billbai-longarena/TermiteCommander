import { describe, it, expect } from "vitest";
import { SignalDecomposer, type DecomposedSignal } from "../decomposer.js";

describe("SignalDecomposer", () => {
  it("should validate signal structure", () => {
    const signal: DecomposedSignal = {
      type: "HOLE",
      title: "Implement JWT token validation",
      weight: 80,
      source: "directive",
      parentId: null,
      childHint: null,
      module: "src/auth/",
      nextHint: "Create middleware that validates JWT tokens on every request",
      acceptanceCriteria: "Token validation middleware passes all test cases",
    };
    expect(SignalDecomposer.validate(signal)).toBe(true);
  });

  it("should reject signals with empty title", () => {
    const signal: DecomposedSignal = {
      type: "HOLE",
      title: "",
      weight: 80,
      source: "directive",
      parentId: null,
      childHint: null,
      module: "",
      nextHint: "",
      acceptanceCriteria: "",
    };
    expect(SignalDecomposer.validate(signal)).toBe(false);
  });

  it("should enforce max depth of 3", () => {
    const signals: DecomposedSignal[] = [
      { type: "HOLE", title: "Root", weight: 80, source: "directive", parentId: null, childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
      { type: "HOLE", title: "Child", weight: 75, source: "directive", parentId: "S-001", childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
      { type: "HOLE", title: "Grandchild", weight: 70, source: "directive", parentId: "S-002", childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
      { type: "HOLE", title: "Too deep", weight: 65, source: "directive", parentId: "S-003", childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
    ];
    const { valid, errors } = SignalDecomposer.validateTree(signals);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes("depth exceeds maximum"))).toBe(true);
  });

  it("should build dependency-ordered signal list", () => {
    const signals: DecomposedSignal[] = [
      { type: "HOLE", title: "B depends on A", weight: 70, source: "directive", parentId: "root", childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
      { type: "HOLE", title: "A is root", weight: 80, source: "directive", parentId: null, childHint: null, module: "", nextHint: "", acceptanceCriteria: "" },
    ];
    const ordered = SignalDecomposer.topologicalSort(signals);
    expect(ordered[0].title).toBe("A is root");
    expect(ordered[1].title).toBe("B depends on A");
  });
});
