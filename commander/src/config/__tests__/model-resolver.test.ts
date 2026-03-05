import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkerSpec,
  readOpenCodeConfig,
  readTermiteConfig,
  resolveModels,
  extractProvider,
  extractModelName,
  assertPlanningModelConfigured,
} from "../model-resolver.js";

describe("parseWorkerSpec", () => {
  it("parses a count-only spec", () => {
    expect(parseWorkerSpec("3")).toEqual([{ cli: "opencode", model: undefined, count: 3 }]);
  });

  it("parses a mixed model spec", () => {
    const result = parseWorkerSpec("sonnet:1,haiku:2,gemini-flash:1");
    expect(result).toEqual([
      { cli: "opencode", model: "sonnet", count: 1 },
      { cli: "opencode", model: "haiku", count: 2 },
      { cli: "opencode", model: "gemini-flash", count: 1 },
    ]);
  });

  it("parses explicit runtime syntax", () => {
    const result = parseWorkerSpec("codex@gpt-5-codex:1,claude@sonnet:2,opencode@haiku,openclaw@coding-fast:3");
    expect(result).toEqual([
      { cli: "codex", model: "gpt-5-codex", count: 1 },
      { cli: "claude", model: "sonnet", count: 2 },
      { cli: "opencode", model: "haiku", count: 1 },
      { cli: "openclaw", model: "coding-fast", count: 3 },
    ]);
  });

  it("uses provided default runtime for legacy syntax", () => {
    const result = parseWorkerSpec("haiku:2", "codex");
    expect(result).toEqual([{ cli: "codex", model: "haiku", count: 2 }]);
  });

  it("clamps invalid or non-positive counts to 1", () => {
    expect(parseWorkerSpec("haiku:0")).toEqual([{ cli: "opencode", model: "haiku", count: 1 }]);
  });
});

describe("extractProvider", () => {
  it("extracts anthropic from explicit prefix", () => {
    expect(extractProvider("anthropic/claude-sonnet-4-5")).toBe("anthropic");
  });

  it("extracts openai from explicit prefix", () => {
    expect(extractProvider("openai/gpt-4")).toBe("openai");
  });

  it("extracts azure-openai from azure prefix", () => {
    expect(extractProvider("azure/gpt-5")).toBe("azure-openai");
  });

  it("infers anthropic from claude in model name", () => {
    expect(extractProvider("claude-sonnet-4-5")).toBe("anthropic");
  });

  it("infers azure-openai from gpt in model name", () => {
    expect(extractProvider("gpt-4o")).toBe("azure-openai");
  });
});

describe("extractModelName", () => {
  it("strips provider prefix", () => {
    expect(extractModelName("anthropic/claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
  });

  it("returns model as-is when no prefix", () => {
    expect(extractModelName("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
  });
});

describe("readOpenCodeConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "model-resolver-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null for nonexistent path", () => {
    expect(readOpenCodeConfig("/tmp/definitely-does-not-exist-xyz")).toBeNull();
  });

  it("reads opencode.json from colony root", () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({ model: "claude-sonnet-4-5", small_model: "claude-haiku-3-5" }),
    );
    const config = readOpenCodeConfig(tempDir);
    expect(config).not.toBeNull();
    expect(config!.model).toBe("claude-sonnet-4-5");
    expect(config!.small_model).toBe("claude-haiku-3-5");
  });

  it("reads from .opencode subdirectory", () => {
    mkdirSync(join(tempDir, ".opencode"));
    writeFileSync(join(tempDir, ".opencode", "opencode.json"), JSON.stringify({ model: "gpt-4" }));
    const config = readOpenCodeConfig(tempDir);
    expect(config).not.toBeNull();
    expect(config!.model).toBe("gpt-4");
  });

  it("strips JSONC comments before parsing", () => {
    const jsonc = `{
      // This is a comment
      "model": "claude-sonnet-4-5",
      /* block comment */
      "small_model": "claude-haiku-3-5"
    }`;
    writeFileSync(join(tempDir, "opencode.json"), jsonc);
    const config = readOpenCodeConfig(tempDir);
    expect(config).not.toBeNull();
    expect(config!.model).toBe("claude-sonnet-4-5");
  });
});

describe("readTermiteConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "termite-config-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads termite.config.json from root", () => {
    writeFileSync(
      join(tempDir, "termite.config.json"),
      JSON.stringify({
        commander: { model: "anthropic/claude-sonnet-4-5" },
      }),
    );
    const config = readTermiteConfig(tempDir);
    expect(config?.commander?.model).toBe("anthropic/claude-sonnet-4-5");
  });

  it("reads .termite/config.json", () => {
    mkdirSync(join(tempDir, ".termite"), { recursive: true });
    writeFileSync(
      join(tempDir, ".termite", "config.json"),
      JSON.stringify({
        commander_model: "openai/gpt-4.1",
      }),
    );
    const config = readTermiteConfig(tempDir);
    expect(config?.commander_model).toBe("openai/gpt-4.1");
  });
});

describe("resolveModels", () => {
  let tempDir: string;
  let homeDir: string;

  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = ["COMMANDER_MODEL", "TERMITE_MODEL", "TERMITE_WORKERS", "TERMITE_WORKER_CLI", "HOME"];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "model-resolver-test-"));
    homeDir = mkdtempSync(join(tmpdir(), "model-resolver-home-"));
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("requires commander model and reports config errors when missing", () => {
    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("");
    expect(result.issues.errors.length).toBeGreaterThan(0);
    expect(result.resolution.commanderModel.detail).toContain("MISSING");
    expect(result.workers).toEqual([{ cli: "opencode", model: undefined, count: 3 }]);
  });

  it("uses COMMANDER_MODEL from env when config is missing", () => {
    process.env.COMMANDER_MODEL = "openai/gpt-4.1";
    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("gpt-4.1");
    expect(result.commanderProvider).toBe("openai");
    expect(result.resolution.commanderModel.source).toBe("env");
    expect(result.issues.errors).toEqual([]);
  });

  it("uses opencode.json model before env (config-first)", () => {
    process.env.COMMANDER_MODEL = "openai/gpt-4.1";
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({ model: "anthropic/claude-sonnet-4-5" }),
    );
    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("claude-sonnet-4-5");
    expect(result.commanderProvider).toBe("anthropic");
    expect(result.resolution.commanderModel.source).toBe("config");
  });

  it("uses termite.config.json commander.model with highest priority", () => {
    process.env.COMMANDER_MODEL = "openai/gpt-4.1";
    writeFileSync(join(tempDir, "opencode.json"), JSON.stringify({ model: "azure/gpt-5" }));
    writeFileSync(
      join(tempDir, "termite.config.json"),
      JSON.stringify({
        commander: { model: "anthropic/claude-opus-4-1" },
      }),
    );

    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("claude-opus-4-1");
    expect(result.resolution.commanderModel.detail).toContain("termite.config.json");
    expect(result.issues.errors).toEqual([]);
  });

  it("supports legacy termite commander_model field", () => {
    writeFileSync(
      join(tempDir, "termite.config.json"),
      JSON.stringify({
        commander_model: "openai/gpt-4.1-mini",
      }),
    );

    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("gpt-4.1-mini");
    expect(result.commanderProvider).toBe("openai");
  });

  it("resolves worker defaults from termite config", () => {
    writeFileSync(
      join(tempDir, "termite.config.json"),
      JSON.stringify({
        commander: {
          model: "anthropic/claude-sonnet-4-5",
          default_worker_cli: "codex",
          default_worker_model: "openai/gpt-4.1-mini",
        },
        workers: [{ model: "openai/gpt-5-codex", count: 2 }],
      }),
    );

    const result = resolveModels(tempDir);
    expect(result.defaultWorkerCli).toBe("codex");
    expect(result.defaultWorkerModel).toBe("gpt-4.1-mini");
    expect(result.workers).toEqual([{ cli: "codex", model: "openai/gpt-5-codex", count: 2 }]);
  });

  it("warns when opencode has small_model but no model", () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({
        small_model: "anthropic/claude-haiku-3-5",
      }),
    );

    const result = resolveModels(tempDir);
    expect(result.issues.errors.length).toBeGreaterThan(0);
    expect(result.issues.warnings.some((w) => w.includes("small_model"))).toBe(true);
  });

  it("parses TERMITE_WORKERS with mixed runtimes", () => {
    process.env.COMMANDER_MODEL = "anthropic/claude-sonnet-4-5";
    process.env.TERMITE_WORKERS = "codex@gpt-5-codex:1,claude@sonnet:1,opencode@haiku:2,openclaw@coding-fast:1";
    const result = resolveModels(tempDir);
    expect(result.workers).toEqual([
      { cli: "codex", model: "gpt-5-codex", count: 1 },
      { cli: "claude", model: "sonnet", count: 1 },
      { cli: "opencode", model: "haiku", count: 2 },
      { cli: "openclaw", model: "coding-fast", count: 1 },
    ]);
  });

  it("falls back to default workers when config workers are invalid", () => {
    writeFileSync(
      join(tempDir, "termite.config.json"),
      JSON.stringify({
        commander: {
          model: "anthropic/claude-sonnet-4-5",
          workers: [{ model: "haiku", count: 0 }],
        },
      }),
    );

    const result = resolveModels(tempDir);
    expect(result.workers).toEqual([{ cli: "opencode", model: undefined, count: 3 }]);
    expect(result.issues.warnings.some((w) => w.includes("invalid count"))).toBe(true);
  });
});

describe("assertPlanningModelConfigured", () => {
  it("throws when model resolution has errors", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "model-check-"));
    const homeDir = mkdtempSync(join(tmpdir(), "model-check-home-"));
    const savedHome = process.env.HOME;
    const savedCommanderModel = process.env.COMMANDER_MODEL;
    try {
      process.env.HOME = homeDir;
      delete process.env.COMMANDER_MODEL;
      const models = resolveModels(tempDir);
      expect(() => assertPlanningModelConfigured(models)).toThrow("Model configuration invalid");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
      if (savedHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = savedHome;
      }
      if (savedCommanderModel === undefined) {
        delete process.env.COMMANDER_MODEL;
      } else {
        process.env.COMMANDER_MODEL = savedCommanderModel;
      }
    }
  });

  it("does not throw when commander model is configured", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "model-check-"));
    const previous = process.env.COMMANDER_MODEL;
    try {
      process.env.COMMANDER_MODEL = "anthropic/claude-sonnet-4-5";
      const models = resolveModels(tempDir);
      expect(() => assertPlanningModelConfigured(models)).not.toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      if (previous === undefined) {
        delete process.env.COMMANDER_MODEL;
      } else {
        process.env.COMMANDER_MODEL = previous;
      }
    }
  });
});
