import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureWorkspaceBoundary } from "../workspace-boundary.js";

describe("ensureWorkspaceBoundary", () => {
  it("creates workspace boundary dirs/files and gitignore block", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "workspace-boundary-test-"));
    try {
      const result = ensureWorkspaceBoundary(tempDir);
      expect(result.createdDirs.length).toBeGreaterThanOrEqual(3);
      expect(result.createdFiles.length).toBeGreaterThanOrEqual(4);
      expect(result.gitignoreUpdated).toBe(true);

      const gitignore = readFileSync(join(tempDir, ".gitignore"), "utf-8");
      expect(gitignore).toContain("Termite Commander — workspace boundary");
      expect(gitignore).toContain(".termite/human/**");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("is idempotent and does not duplicate gitignore marker", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "workspace-boundary-test-"));
    try {
      ensureWorkspaceBoundary(tempDir);
      const second = ensureWorkspaceBoundary(tempDir);
      expect(second.gitignoreUpdated).toBe(false);

      const gitignore = readFileSync(join(tempDir, ".gitignore"), "utf-8");
      const markerCount = gitignore.split("Termite Commander — workspace boundary").length - 1;
      expect(markerCount).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
