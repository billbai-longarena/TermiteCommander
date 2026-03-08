import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureTermiteProtocolInstalled } from "../protocol-installer.js";

describe("ensureTermiteProtocolInstalled", () => {
  let rootDir: string;
  let colonyRoot: string;
  let skillSourceDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "protocol-installer-test-"));
    colonyRoot = join(rootDir, "colony");
    skillSourceDir = join(rootDir, "pkg", "skills", "termite");

    mkdirSync(colonyRoot, { recursive: true });
    mkdirSync(skillSourceDir, { recursive: true });
    mkdirSync(join(rootDir, "TermiteProtocol"), { recursive: true });

    const installScript = join(rootDir, "TermiteProtocol", "install.sh");
    writeFileSync(
      installScript,
      [
        "#!/usr/bin/env bash",
        'set -euo pipefail',
        'target="$1"',
        'echo "[termite:install] installing to $target"',
        'mkdir -p "$target/scripts"',
        'echo "#!/usr/bin/env bash" > "$target/scripts/termite-db.sh"',
      ].join("\n"),
      "utf-8",
    );
    chmodSync(installScript, 0o755);
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("pipes installer output to logger without using console stdout", () => {
    const logs: string[] = [];
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = ensureTermiteProtocolInstalled({
      colonyRoot,
      skillSourceDir,
      logger: (message) => logs.push(message),
      stdioMode: "pipe",
    });

    expect(result).toEqual({ installed: true, source: "local-script" });
    expect(logs.some((line) => line.includes("[termite:install] installing to"))).toBe(true);
    expect(readFileSync(join(colonyRoot, "scripts", "termite-db.sh"), "utf-8")).toContain("bash");
    expect(consoleLogSpy).not.toHaveBeenCalled();

    consoleLogSpy.mockRestore();
  });
});
