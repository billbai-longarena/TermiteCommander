import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getTermiteConfigPath,
  importExternalConfig,
  mergeImportedConfig,
  writeTermiteConfig,
} from "../importer.js";
import type { TermiteConfig } from "../model-resolver.js";

describe("importExternalConfig", () => {
  let tempDir: string;
  let homeDir: string;
  const savedHome = process.env.HOME;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "importer-test-"));
    homeDir = mkdtempSync(join(tmpdir(), "importer-home-"));
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
    if (savedHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = savedHome;
    }
  });

  it("imports from opencode.json with normalized commander fields", () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify(
        {
          model: "anthropic/claude-sonnet-4-5",
          small_model_cli: "codex",
          small_model: "openai/gpt-4.1-mini",
          commander: {
            workers: [
              { cli: "codex", model: "openai/gpt-5-codex", count: 1 },
              { cli: "opencode", count: 2 },
              { cli: "claude", model: "anthropic/claude-haiku-3-5", count: 0 },
            ],
          },
        },
        null,
        2,
      ),
    );

    const result = importExternalConfig(tempDir, "opencode");
    expect(result.selected?.source).toBe("opencode");
    expect(result.selected?.recommended).toEqual({
      commander: {
        model: "anthropic/claude-sonnet-4-5",
        default_worker_cli: "codex",
        default_worker_model: "openai/gpt-4.1-mini",
        workers: [
          { cli: "codex", model: "openai/gpt-5-codex", count: 1 },
          { cli: "opencode", count: 2 },
        ],
      },
    });
    expect(result.selected?.confidence).toBe(0.98);
  });

  it("imports from Claude config using extended model field keys", () => {
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    writeFileSync(
      join(tempDir, ".claude", "settings.json"),
      `{
        // user-level default
        "default_model": "claude-sonnet-4-5"
      }`,
    );

    const result = importExternalConfig(tempDir, "claude");
    expect(result.selected?.source).toBe("claude");
    expect(result.selected?.recommended?.commander?.model).toBe("anthropic/claude-sonnet-4-5");
  });

  it("imports from Codex TOML using defaults section", () => {
    mkdirSync(join(tempDir, ".codex"), { recursive: true });
    writeFileSync(
      join(tempDir, ".codex", "config.toml"),
      `
model_provider = "openai"

[defaults]
model = "gpt-5-codex"
`,
    );

    const result = importExternalConfig(tempDir, "codex");
    expect(result.selected?.source).toBe("codex");
    expect(result.selected?.recommended?.commander?.model).toBe("openai/gpt-5-codex");
  });

  it("auto selection prefers opencode when multiple valid sources are present", () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({ model: "anthropic/claude-sonnet-4-5" }, null, 2),
    );
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    writeFileSync(
      join(tempDir, ".claude", "settings.json"),
      JSON.stringify({ model: "claude-opus-4-1" }, null, 2),
    );
    mkdirSync(join(tempDir, ".codex"), { recursive: true });
    writeFileSync(
      join(tempDir, ".codex", "config.toml"),
      `model_provider = "openai"\nmodel = "gpt-5-codex"\n`,
    );

    const result = importExternalConfig(tempDir, "auto");
    expect(result.selected?.source).toBe("opencode");
    expect(result.selected?.recommended?.commander?.model).toBe("anthropic/claude-sonnet-4-5");
  });

  it("auto selection skips sources without commander model and chooses a valid fallback", () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({ small_model: "anthropic/claude-haiku-3-5" }, null, 2),
    );
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    writeFileSync(
      join(tempDir, ".claude", "settings.json"),
      JSON.stringify({ model: "claude-sonnet-4-5" }, null, 2),
    );

    const result = importExternalConfig(tempDir, "auto");
    expect(result.selected?.source).toBe("claude");
    expect(result.selected?.recommended?.commander?.model).toBe("anthropic/claude-sonnet-4-5");

    const opencodeCandidate = result.candidates.find((c) => c.source === "opencode");
    expect(opencodeCandidate?.found).toBe(true);
    expect(opencodeCandidate?.diagnostics.some((d) => d.level === "warning")).toBe(true);
  });

  it("returns diagnostics for malformed Claude config", () => {
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    writeFileSync(join(tempDir, ".claude", "settings.json"), "{ not-valid-json ");

    const result = importExternalConfig(tempDir, "claude");
    expect(result.selected).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].diagnostics.some((d) => d.level === "error")).toBe(true);
  });
});

describe("mergeImportedConfig", () => {
  const imported: TermiteConfig = {
    commander: {
      model: "anthropic/claude-sonnet-4-5",
      default_worker_cli: "opencode",
      default_worker_model: "anthropic/claude-haiku-3-5",
      workers: [{ cli: "opencode", model: "anthropic/claude-haiku-3-5", count: 2 }],
    },
  };

  it("preserves existing values when force is false", () => {
    const existing: TermiteConfig = {
      commander: {
        model: "openai/gpt-4.1",
        workers: [{ cli: "codex", model: "openai/gpt-5-codex", count: 1 }],
      },
    };

    const merged = mergeImportedConfig(existing, imported, false);
    expect(merged.merged.commander?.model).toBe("openai/gpt-4.1");
    expect(merged.merged.commander?.default_worker_model).toBe("anthropic/claude-haiku-3-5");
    expect(merged.merged.commander?.workers).toEqual([
      { cli: "codex", model: "openai/gpt-5-codex", count: 1 },
    ]);
    expect(merged.unchanged.some((line) => line.includes("commander.model"))).toBe(true);
  });

  it("overrides existing values when force is true", () => {
    const existing: TermiteConfig = {
      commander: {
        model: "openai/gpt-4.1",
        workers: [{ cli: "codex", model: "openai/gpt-5-codex", count: 1 }],
      },
    };

    const merged = mergeImportedConfig(existing, imported, true);
    expect(merged.merged.commander?.model).toBe("anthropic/claude-sonnet-4-5");
    expect(merged.merged.commander?.workers).toEqual([
      { cli: "opencode", model: "anthropic/claude-haiku-3-5", count: 2 },
    ]);
    expect(merged.changes.some((line) => line.includes("commander.model"))).toBe(true);
  });
});

describe("termite config path and writes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "importer-config-path-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns existing termite config path when found", () => {
    const configPath = join(tempDir, "termite.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ commander: { model: "anthropic/claude-sonnet-4-5" } }, null, 2),
    );
    expect(getTermiteConfigPath(tempDir)).toBe(configPath);
  });

  it("writes termite config with trailing newline", () => {
    const outPath = join(tempDir, ".termite", "config.json");
    writeTermiteConfig(outPath, {
      commander: {
        model: "anthropic/claude-sonnet-4-5",
      },
    });

    const written = readFileSync(outPath, "utf-8");
    expect(written.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(written) as TermiteConfig;
    expect(parsed.commander?.model).toBe("anthropic/claude-sonnet-4-5");
  });
});
