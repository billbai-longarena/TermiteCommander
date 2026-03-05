// commander/src/config/__tests__/model-resolver.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkerSpec,
  readOpenCodeConfig,
  resolveModels,
  extractProvider,
  extractModelName,
} from "../model-resolver.js";

// ---------------------------------------------------------------------------
// parseWorkerSpec
// ---------------------------------------------------------------------------

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

  it("parses a single model spec", () => {
    expect(parseWorkerSpec("haiku:2")).toEqual([{ cli: "opencode", model: "haiku", count: 2 }]);
  });

  it("handles empty string", () => {
    expect(parseWorkerSpec("")).toEqual([]);
  });

  it("handles whitespace around entries", () => {
    const result = parseWorkerSpec(" sonnet : 1 , haiku : 2 ");
    expect(result).toEqual([
      { cli: "opencode", model: "sonnet", count: 1 },
      { cli: "opencode", model: "haiku", count: 2 },
    ]);
  });

  it("parses explicit runtime syntax", () => {
    const result = parseWorkerSpec("codex@gpt-5-codex:1,claude@sonnet:2,opencode@haiku");
    expect(result).toEqual([
      { cli: "codex", model: "gpt-5-codex", count: 1 },
      { cli: "claude", model: "sonnet", count: 2 },
      { cli: "opencode", model: "haiku", count: 1 },
    ]);
  });

  it("uses provided default runtime for legacy syntax", () => {
    const result = parseWorkerSpec("haiku:2", "codex");
    expect(result).toEqual([{ cli: "codex", model: "haiku", count: 2 }]);
  });

  it("parses runtime with count and default model", () => {
    const result = parseWorkerSpec("codex:3");
    expect(result).toEqual([{ cli: "codex", model: undefined, count: 3 }]);
  });
});

// ---------------------------------------------------------------------------
// extractProvider
// ---------------------------------------------------------------------------

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

  it("infers azure-openai from codex in model name", () => {
    expect(extractProvider("codex-mini")).toBe("azure-openai");
  });

  it("defaults to anthropic for unknown model", () => {
    expect(extractProvider("llama-3")).toBe("anthropic");
  });
});

// ---------------------------------------------------------------------------
// extractModelName
// ---------------------------------------------------------------------------

describe("extractModelName", () => {
  it("strips provider prefix", () => {
    expect(extractModelName("anthropic/claude-sonnet-4-5")).toBe(
      "claude-sonnet-4-5",
    );
  });

  it("returns model as-is when no prefix", () => {
    expect(extractModelName("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
  });

  it("strips openai prefix", () => {
    expect(extractModelName("openai/gpt-4")).toBe("gpt-4");
  });
});

// ---------------------------------------------------------------------------
// readOpenCodeConfig
// ---------------------------------------------------------------------------

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
    writeFileSync(
      join(tempDir, ".opencode", "opencode.json"),
      JSON.stringify({ model: "gpt-4" }),
    );
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
    expect(config!.small_model).toBe("claude-haiku-3-5");
  });

  it("returns null for malformed JSON", () => {
    writeFileSync(join(tempDir, "opencode.json"), "{ this is not valid json }");
    const config = readOpenCodeConfig(tempDir);
    expect(config).toBeNull();
  });

  it("reads commander.workers array", () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({
        model: "claude-sonnet-4-5",
        commander: {
          workers: [
            { model: "haiku", count: 2 },
            { model: "sonnet", count: 1 },
          ],
        },
      }),
    );
    const config = readOpenCodeConfig(tempDir);
    expect(config).not.toBeNull();
    expect(config!.commander!.workers).toHaveLength(2);
    expect(config!.commander!.workers![0]).toEqual({ model: "haiku", count: 2 });
  });
});

// ---------------------------------------------------------------------------
// resolveModels
// ---------------------------------------------------------------------------

describe("resolveModels", () => {
  let tempDir: string;

  // Save and restore env vars
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = ["COMMANDER_MODEL", "TERMITE_MODEL", "TERMITE_WORKERS", "TERMITE_WORKER_CLI"];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "model-resolver-test-"));
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("uses defaults when no config or env vars", () => {
    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("claude-sonnet-4-5");
    expect(result.commanderProvider).toBe("anthropic");
    expect(result.defaultWorkerCli).toBe("opencode");
    expect(result.defaultWorkerModel).toBe("claude-haiku-3-5");
    expect(result.workers).toEqual([{ cli: "opencode", model: undefined, count: 3 }]);
    expect(result.resolution.commanderModel.source).toBe("default");
    expect(result.resolution.defaultWorkerCli.source).toBe("default");
    expect(result.resolution.defaultWorkerModel.source).toBe("default");
    expect(result.resolution.workers.source).toBe("default");
  });

  it("uses env vars when set", () => {
    process.env.COMMANDER_MODEL = "openai/gpt-4";
    process.env.TERMITE_MODEL = "anthropic/claude-haiku-3-5";
    process.env.TERMITE_WORKER_CLI = "codex";
    process.env.TERMITE_WORKERS = "haiku:2,sonnet:1";

    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("gpt-4");
    expect(result.commanderProvider).toBe("openai");
    expect(result.defaultWorkerCli).toBe("codex");
    expect(result.defaultWorkerModel).toBe("claude-haiku-3-5");
    expect(result.workers).toEqual([
      { cli: "codex", model: "haiku", count: 2 },
      { cli: "codex", model: "sonnet", count: 1 },
    ]);
    expect(result.resolution.commanderModel.source).toBe("env");
    expect(result.resolution.defaultWorkerCli.source).toBe("env");
    expect(result.resolution.defaultWorkerModel.source).toBe("env");
    expect(result.resolution.workers.source).toBe("env");
  });

  it("falls back to opencode.json when env vars are not set", () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({
        model: "anthropic/claude-sonnet-4-5",
        small_model_cli: "claude",
        small_model: "anthropic/claude-haiku-3-5",
        commander: {
          workers: [{ model: "haiku", count: 4 }],
        },
      }),
    );

    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("claude-sonnet-4-5");
    expect(result.commanderProvider).toBe("anthropic");
    expect(result.defaultWorkerCli).toBe("claude");
    expect(result.defaultWorkerModel).toBe("claude-haiku-3-5");
    expect(result.workers).toEqual([{ cli: "claude", model: "haiku", count: 4 }]);
    expect(result.resolution.commanderModel.source).toBe("config");
    expect(result.resolution.defaultWorkerCli.source).toBe("config");
    expect(result.resolution.defaultWorkerModel.source).toBe("config");
    expect(result.resolution.workers.source).toBe("config");
  });

  it("opencode.json takes priority over env vars", () => {
    process.env.COMMANDER_MODEL = "azure/gpt-5";
    process.env.TERMITE_WORKER_CLI = "opencode";
    process.env.TERMITE_MODEL = "openai/gpt-4o-mini";
    process.env.TERMITE_WORKERS = "codex@gpt-5-codex:5";

    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({
        model: "anthropic/claude-sonnet-4-5",
        small_model_cli: "claude",
        small_model: "anthropic/claude-haiku-3-5",
        commander: {
          workers: [{ cli: "codex", model: "gpt-5-codex", count: 2 }],
        },
      }),
    );

    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("claude-sonnet-4-5");
    expect(result.commanderProvider).toBe("anthropic");
    expect(result.defaultWorkerCli).toBe("claude");
    expect(result.defaultWorkerModel).toBe("claude-haiku-3-5");
    expect(result.workers).toEqual([{ cli: "codex", model: "gpt-5-codex", count: 2 }]);
    expect(result.resolution.commanderModel.source).toBe("config");
    expect(result.resolution.defaultWorkerCli.source).toBe("config");
    expect(result.resolution.defaultWorkerModel.source).toBe("config");
    expect(result.resolution.workers.source).toBe("config");
  });

  it("uses count-only TERMITE_WORKERS", () => {
    process.env.TERMITE_WORKER_CLI = "claude";
    process.env.TERMITE_WORKERS = "5";

    const result = resolveModels(tempDir);
    expect(result.workers).toEqual([{ cli: "claude", model: undefined, count: 5 }]);
  });

  it("supports mixed runtime workers from TERMITE_WORKERS", () => {
    process.env.TERMITE_WORKERS = "codex@gpt-5-codex:1,claude@sonnet:1,opencode@haiku:2";

    const result = resolveModels(tempDir);
    expect(result.workers).toEqual([
      { cli: "codex", model: "gpt-5-codex", count: 1 },
      { cli: "claude", model: "sonnet", count: 1 },
      { cli: "opencode", model: "haiku", count: 2 },
    ]);
  });
});
