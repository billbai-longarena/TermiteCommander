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
    expect(parseWorkerSpec("3")).toEqual([{ model: undefined, count: 3 }]);
  });

  it("parses a mixed model spec", () => {
    const result = parseWorkerSpec("sonnet:1,haiku:2,gemini-flash:1");
    expect(result).toEqual([
      { model: "sonnet", count: 1 },
      { model: "haiku", count: 2 },
      { model: "gemini-flash", count: 1 },
    ]);
  });

  it("parses a single model spec", () => {
    expect(parseWorkerSpec("haiku:2")).toEqual([{ model: "haiku", count: 2 }]);
  });

  it("handles empty string", () => {
    expect(parseWorkerSpec("")).toEqual([]);
  });

  it("handles whitespace around entries", () => {
    const result = parseWorkerSpec(" sonnet : 1 , haiku : 2 ");
    expect(result).toEqual([
      { model: "sonnet", count: 1 },
      { model: "haiku", count: 2 },
    ]);
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
  const envKeys = ["COMMANDER_MODEL", "TERMITE_MODEL", "TERMITE_WORKERS"];

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
    expect(result.defaultWorkerModel).toBe("claude-haiku-3-5");
    expect(result.workers).toEqual([{ model: undefined, count: 3 }]);
  });

  it("uses env vars when set", () => {
    process.env.COMMANDER_MODEL = "openai/gpt-4";
    process.env.TERMITE_MODEL = "anthropic/claude-haiku-3-5";
    process.env.TERMITE_WORKERS = "haiku:2,sonnet:1";

    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("gpt-4");
    expect(result.commanderProvider).toBe("openai");
    expect(result.defaultWorkerModel).toBe("claude-haiku-3-5");
    expect(result.workers).toEqual([
      { model: "haiku", count: 2 },
      { model: "sonnet", count: 1 },
    ]);
  });

  it("falls back to opencode.json when env vars not set", () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({
        model: "anthropic/claude-sonnet-4-5",
        small_model: "anthropic/claude-haiku-3-5",
        commander: {
          workers: [{ model: "haiku", count: 4 }],
        },
      }),
    );

    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("claude-sonnet-4-5");
    expect(result.commanderProvider).toBe("anthropic");
    expect(result.defaultWorkerModel).toBe("claude-haiku-3-5");
    expect(result.workers).toEqual([{ model: "haiku", count: 4 }]);
  });

  it("env vars take priority over opencode.json", () => {
    process.env.COMMANDER_MODEL = "azure/gpt-5";

    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({ model: "claude-sonnet-4-5" }),
    );

    const result = resolveModels(tempDir);
    expect(result.commanderModel).toBe("gpt-5");
    expect(result.commanderProvider).toBe("azure-openai");
  });

  it("uses count-only TERMITE_WORKERS", () => {
    process.env.TERMITE_WORKERS = "5";

    const result = resolveModels(tempDir);
    expect(result.workers).toEqual([{ model: undefined, count: 5 }]);
  });
});
