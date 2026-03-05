// commander/src/config/model-resolver.ts
// Reads model configuration from environment variables and opencode.json,
// supporting mixed-model worker fleets.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export type WorkerRuntime = "opencode" | "claude" | "codex";

export interface WorkerSpec {
  cli: WorkerRuntime;
  model: string | undefined;
  count: number;
}

export type ResolutionSource = "config" | "env" | "default";

export interface ResolutionField {
  source: ResolutionSource;
  detail: string;
}

export interface ModelResolutionStatus {
  commanderModel: ResolutionField;
  defaultWorkerCli: ResolutionField;
  defaultWorkerModel: ResolutionField;
  workers: ResolutionField;
}

export interface ResolvedModels {
  commanderModel: string;
  commanderProvider: "anthropic" | "openai" | "azure-openai";
  workers: WorkerSpec[];
  defaultWorkerCli: WorkerRuntime;
  defaultWorkerModel: string;
  resolution: ModelResolutionStatus;
}

export interface OpenCodeConfig {
  model?: string;
  small_model_cli?: WorkerRuntime;
  small_model?: string;
  commander?: {
    default_worker_cli?: WorkerRuntime;
    workers?: Array<{ cli?: WorkerRuntime; model?: string; count: number }>;
  };
}

interface OpenCodeConfigLookup {
  config: OpenCodeConfig | null;
  path: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the provider from a model ID string.
 *
 * Explicit prefix:
 *   "anthropic/claude-sonnet-4-5" -> "anthropic"
 *   "openai/gpt-4"               -> "openai"
 *   "azure/gpt-5"                -> "azure-openai"
 *
 * Heuristic (no prefix):
 *   /claude/  -> "anthropic"
 *   /gpt|codex/ -> "azure-openai"
 *   otherwise -> "anthropic" (safe default)
 */
export function extractProvider(
  modelId: string,
): "anthropic" | "openai" | "azure-openai" {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex > 0) {
    const prefix = modelId.slice(0, slashIndex).toLowerCase();
    if (prefix === "anthropic") return "anthropic";
    if (prefix === "openai") return "openai";
    if (prefix === "azure") return "azure-openai";
    // Unknown prefix -- fall through to heuristic on the full string
  }

  // Heuristic based on model name keywords
  const lower = modelId.toLowerCase();
  if (/claude/.test(lower)) return "anthropic";
  if (/gpt|codex/.test(lower)) return "azure-openai";

  // Default to anthropic
  return "anthropic";
}

/**
 * Strip the provider prefix from a model ID.
 *   "anthropic/claude-sonnet-4-5" -> "claude-sonnet-4-5"
 *   "claude-sonnet-4-5"           -> "claude-sonnet-4-5"
 */
export function extractModelName(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex > 0) {
    return modelId.slice(slashIndex + 1);
  }
  return modelId;
}

export function normalizeWorkerRuntime(
  value: string | undefined,
  fallback: WorkerRuntime = "opencode",
): WorkerRuntime {
  if (!value) return fallback;
  const normalized = value.toLowerCase().trim();
  if (normalized === "opencode" || normalized === "claude" || normalized === "codex") {
    return normalized;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// parseWorkerSpec
// ---------------------------------------------------------------------------

/**
 * Parse a worker specification string into an array of WorkerSpec.
 *
 * Formats:
 *   "3"                               -> [{ cli: "opencode", model: undefined, count: 3 }]
 *   "sonnet:1,haiku:2"                -> legacy syntax with default runtime
 *   "codex@gpt-5-codex:1,claude@sonnet:1" -> explicit per-worker runtime
 */
export function parseWorkerSpec(
  spec: string,
  defaultCli: WorkerRuntime = "opencode",
): WorkerSpec[] {
  const trimmed = spec.trim();
  if (!trimmed) {
    return [];
  }

  // Simple count-only: the entire spec is a positive integer
  if (/^\d+$/.test(trimmed)) {
    return [{ cli: defaultCli, model: undefined, count: parseInt(trimmed, 10) }];
  }

  // Comma-separated entries:
  //   model:count
  //   runtime@model:count
  //   runtime@model
  //   runtime:count (uses default model)
  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const runtimeModelMatch = entry.match(/^(opencode|claude|codex)@(.+?)(?::(\d+))?$/i);
      if (runtimeModelMatch) {
        const cli = normalizeWorkerRuntime(runtimeModelMatch[1], defaultCli);
        const model = runtimeModelMatch[2].trim();
        const countRaw = runtimeModelMatch[3];
        const count = countRaw ? parseInt(countRaw, 10) : 1;
        return { cli, model, count: isNaN(count) ? 1 : count };
      }

      const runtimeCountMatch = entry.match(/^(opencode|claude|codex):(\d+)$/i);
      if (runtimeCountMatch) {
        const cli = normalizeWorkerRuntime(runtimeCountMatch[1], defaultCli);
        const count = parseInt(runtimeCountMatch[2], 10);
        return { cli, model: undefined, count: isNaN(count) ? 1 : count };
      }

      const parts = entry.split(":");
      if (parts.length === 2) {
        const model = parts[0].trim();
        const count = parseInt(parts[1].trim(), 10);
        return { cli: defaultCli, model, count: isNaN(count) ? 1 : count };
      }

      // Single model name without a count -> count defaults to 1
      return { cli: defaultCli, model: entry.trim(), count: 1 };
    });
}

// ---------------------------------------------------------------------------
// stripJsoncComments
// ---------------------------------------------------------------------------

/**
 * Strip single-line (//) and block comments from a JSONC string.
 * Respects string literals so comments inside strings are preserved.
 */
function stripJsoncComments(text: string): string {
  let result = "";
  let i = 0;
  const len = text.length;

  while (i < len) {
    // String literal
    if (text[i] === '"') {
      const start = i;
      i++; // skip opening quote
      while (i < len && text[i] !== '"') {
        if (text[i] === "\\") i++; // skip escaped char
        i++;
      }
      i++; // skip closing quote
      result += text.slice(start, i);
      continue;
    }

    // Single-line comment
    if (text[i] === "/" && i + 1 < len && text[i + 1] === "/") {
      // Skip until newline
      while (i < len && text[i] !== "\n") i++;
      continue;
    }

    // Block comment
    if (text[i] === "/" && i + 1 < len && text[i + 1] === "*") {
      i += 2;
      while (i < len && !(text[i] === "*" && i + 1 < len && text[i + 1] === "/")) {
        i++;
      }
      i += 2; // skip closing */
      continue;
    }

    result += text[i];
    i++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// readOpenCodeConfig
// ---------------------------------------------------------------------------

/**
 * Search for opencode.json in standard locations and return parsed config.
 *
 * Search order:
 *   1. $colonyRoot/opencode.json
 *   2. $colonyRoot/.opencode/opencode.json
 *   3. ~/.config/opencode/opencode.json
 *
 * Returns null if none found or if parsing fails.
 */
export function readOpenCodeConfigWithPath(colonyRoot: string): OpenCodeConfigLookup {
  const candidates = [
    join(colonyRoot, "opencode.json"),
    join(colonyRoot, ".opencode", "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf-8");
        const stripped = stripJsoncComments(raw);
        return {
          config: JSON.parse(stripped) as OpenCodeConfig,
          path: candidate,
        };
      } catch {
        // Malformed JSON -- try next candidate
        continue;
      }
    }
  }

  return { config: null, path: null };
}

export function readOpenCodeConfig(colonyRoot: string): OpenCodeConfig | null {
  return readOpenCodeConfigWithPath(colonyRoot).config;
}

// ---------------------------------------------------------------------------
// resolveModels
// ---------------------------------------------------------------------------

const DEFAULT_COMMANDER_MODEL = "claude-sonnet-4-5";
const DEFAULT_WORKER_CLI: WorkerRuntime = "opencode";
const DEFAULT_WORKER_MODEL = "claude-haiku-3-5";
const DEFAULT_WORKER_COUNT = 3;

/**
 * Resolve model configuration from env vars, opencode.json, and defaults.
 *
 * Priority (highest wins):
 *   Commander model:       opencode.json "model" > COMMANDER_MODEL env > "claude-sonnet-4-5"
 *   Default worker CLI:    opencode.json "commander.default_worker_cli" > opencode.json "small_model_cli" > TERMITE_WORKER_CLI env > "opencode"
 *   Default worker model:  opencode.json "small_model" > TERMITE_MODEL env > "claude-haiku-3-5"
 *   Workers:               opencode.json "commander.workers" > TERMITE_WORKERS env > 3x default
 *   Commander provider:    extracted from resolved commander model string
 */
export function resolveModels(colonyRoot: string): ResolvedModels {
  const configLookup = readOpenCodeConfigWithPath(colonyRoot);
  const config = configLookup.config;
  const configPath = configLookup.path;

  // Commander model
  let commanderModelRaw: string;
  let commanderModelResolution: ResolutionField;
  if (config?.model) {
    commanderModelRaw = config.model;
    commanderModelResolution = {
      source: "config",
      detail: configPath ?? "opencode.json",
    };
  } else if (process.env.COMMANDER_MODEL) {
    commanderModelRaw = process.env.COMMANDER_MODEL;
    commanderModelResolution = {
      source: "env",
      detail: "COMMANDER_MODEL",
    };
  } else {
    commanderModelRaw = DEFAULT_COMMANDER_MODEL;
    commanderModelResolution = {
      source: "default",
      detail: DEFAULT_COMMANDER_MODEL,
    };
  }

  const commanderModel = extractModelName(commanderModelRaw);
  const commanderProvider = extractProvider(commanderModelRaw);

  // Default worker CLI runtime
  let defaultWorkerCliRaw: string;
  let defaultWorkerCliResolution: ResolutionField;
  if (config?.commander?.default_worker_cli) {
    defaultWorkerCliRaw = config.commander.default_worker_cli;
    defaultWorkerCliResolution = {
      source: "config",
      detail: configPath ?? "opencode.json",
    };
  } else if (config?.small_model_cli) {
    defaultWorkerCliRaw = config.small_model_cli;
    defaultWorkerCliResolution = {
      source: "config",
      detail: configPath ?? "opencode.json",
    };
  } else if (process.env.TERMITE_WORKER_CLI) {
    defaultWorkerCliRaw = process.env.TERMITE_WORKER_CLI;
    defaultWorkerCliResolution = {
      source: "env",
      detail: "TERMITE_WORKER_CLI",
    };
  } else {
    defaultWorkerCliRaw = DEFAULT_WORKER_CLI;
    defaultWorkerCliResolution = {
      source: "default",
      detail: DEFAULT_WORKER_CLI,
    };
  }
  const defaultWorkerCli = normalizeWorkerRuntime(defaultWorkerCliRaw, DEFAULT_WORKER_CLI);

  // Default worker model
  let defaultWorkerModelRaw: string;
  let defaultWorkerResolution: ResolutionField;
  if (config?.small_model) {
    defaultWorkerModelRaw = config.small_model;
    defaultWorkerResolution = {
      source: "config",
      detail: configPath ?? "opencode.json",
    };
  } else if (process.env.TERMITE_MODEL) {
    defaultWorkerModelRaw = process.env.TERMITE_MODEL;
    defaultWorkerResolution = {
      source: "env",
      detail: "TERMITE_MODEL",
    };
  } else {
    defaultWorkerModelRaw = DEFAULT_WORKER_MODEL;
    defaultWorkerResolution = {
      source: "default",
      detail: DEFAULT_WORKER_MODEL,
    };
  }

  const defaultWorkerModel = extractModelName(defaultWorkerModelRaw);

  // Workers
  let workers: WorkerSpec[];
  let workersResolution: ResolutionField;

  const workersEnv = process.env.TERMITE_WORKERS;
  if (config?.commander?.workers && config.commander.workers.length > 0) {
    workers = config.commander.workers.map((w) => ({
      cli: normalizeWorkerRuntime(w.cli, defaultWorkerCli),
      model: w.model,
      count: w.count,
    }));
    workersResolution = {
      source: "config",
      detail: configPath ?? "opencode.json",
    };
  } else if (workersEnv) {
    workers = parseWorkerSpec(workersEnv, defaultWorkerCli);
    workersResolution = {
      source: "env",
      detail: "TERMITE_WORKERS",
    };
  } else {
    workers = [{ cli: defaultWorkerCli, model: undefined, count: DEFAULT_WORKER_COUNT }];
    workersResolution = {
      source: "default",
      detail: `${DEFAULT_WORKER_COUNT} x ${defaultWorkerCli}@${DEFAULT_WORKER_MODEL}`,
    };
  }

  return {
    commanderModel,
    commanderProvider,
    workers,
    defaultWorkerCli,
    defaultWorkerModel,
    resolution: {
      commanderModel: commanderModelResolution,
      defaultWorkerCli: defaultWorkerCliResolution,
      defaultWorkerModel: defaultWorkerResolution,
      workers: workersResolution,
    },
  };
}
