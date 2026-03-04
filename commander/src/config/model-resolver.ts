// commander/src/config/model-resolver.ts
// Reads model configuration from environment variables and opencode.json,
// supporting mixed-model worker fleets.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface WorkerSpec {
  model: string | undefined;
  count: number;
}

export interface ResolvedModels {
  commanderModel: string;
  commanderProvider: "anthropic" | "openai" | "azure-openai";
  workers: WorkerSpec[];
  defaultWorkerModel: string;
}

export interface OpenCodeConfig {
  model?: string;
  small_model?: string;
  commander?: { workers?: Array<{ model: string; count: number }> };
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

// ---------------------------------------------------------------------------
// parseWorkerSpec
// ---------------------------------------------------------------------------

/**
 * Parse a worker specification string into an array of WorkerSpec.
 *
 * Formats:
 *   "3"                             -> [{ model: undefined, count: 3 }]
 *   "sonnet:1,haiku:2,gemini-flash:1" -> [{ model: "sonnet", count: 1 }, ...]
 *   "haiku:2"                       -> [{ model: "haiku", count: 2 }]
 */
export function parseWorkerSpec(spec: string): WorkerSpec[] {
  const trimmed = spec.trim();
  if (!trimmed) {
    return [];
  }

  // Simple count-only: the entire spec is a positive integer
  if (/^\d+$/.test(trimmed)) {
    return [{ model: undefined, count: parseInt(trimmed, 10) }];
  }

  // Comma-separated entries of the form "model:count"
  return trimmed.split(",").map((entry) => {
    const parts = entry.trim().split(":");
    if (parts.length === 2) {
      const model = parts[0].trim();
      const count = parseInt(parts[1].trim(), 10);
      return { model, count: isNaN(count) ? 1 : count };
    }
    // Single model name without a count -> count defaults to 1
    return { model: parts[0].trim(), count: 1 };
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
export function readOpenCodeConfig(colonyRoot: string): OpenCodeConfig | null {
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
        return JSON.parse(stripped) as OpenCodeConfig;
      } catch {
        // Malformed JSON -- try next candidate
        continue;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// resolveModels
// ---------------------------------------------------------------------------

const DEFAULT_COMMANDER_MODEL = "claude-sonnet-4-5";
const DEFAULT_WORKER_MODEL = "claude-haiku-3-5";
const DEFAULT_WORKER_COUNT = 3;

/**
 * Resolve model configuration from env vars, opencode.json, and defaults.
 *
 * Priority (highest wins):
 *   Commander model:       COMMANDER_MODEL env > opencode.json "model" > "claude-sonnet-4-5"
 *   Default worker model:  TERMITE_MODEL env > opencode.json "small_model" > "claude-haiku-3-5"
 *   Workers:               TERMITE_WORKERS env > opencode.json "commander.workers" > 3x default
 *   Commander provider:    extracted from resolved commander model string
 */
export function resolveModels(colonyRoot: string): ResolvedModels {
  const config = readOpenCodeConfig(colonyRoot);

  // Commander model
  const commanderModelRaw =
    process.env.COMMANDER_MODEL ??
    config?.model ??
    DEFAULT_COMMANDER_MODEL;

  const commanderModel = extractModelName(commanderModelRaw);
  const commanderProvider = extractProvider(commanderModelRaw);

  // Default worker model
  const defaultWorkerModelRaw =
    process.env.TERMITE_MODEL ??
    config?.small_model ??
    DEFAULT_WORKER_MODEL;

  const defaultWorkerModel = extractModelName(defaultWorkerModelRaw);

  // Workers
  let workers: WorkerSpec[];

  const workersEnv = process.env.TERMITE_WORKERS;
  if (workersEnv) {
    workers = parseWorkerSpec(workersEnv);
  } else if (config?.commander?.workers && config.commander.workers.length > 0) {
    workers = config.commander.workers.map((w) => ({
      model: w.model,
      count: w.count,
    }));
  } else {
    workers = [{ model: undefined, count: DEFAULT_WORKER_COUNT }];
  }

  return {
    commanderModel,
    commanderProvider,
    workers,
    defaultWorkerModel,
  };
}
