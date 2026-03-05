// commander/src/config/model-resolver.ts
// Reads model configuration from termite config, opencode.json, and env vars.
// Supports mixed-model worker fleets and exposes config health diagnostics.

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

export interface ModelResolutionIssues {
  warnings: string[];
  errors: string[];
}

export interface ResolvedModels {
  commanderModel: string;
  commanderProvider: "anthropic" | "openai" | "azure-openai";
  workers: WorkerSpec[];
  defaultWorkerCli: WorkerRuntime;
  defaultWorkerModel: string;
  resolution: ModelResolutionStatus;
  issues: ModelResolutionIssues;
}

interface WorkerConfigEntry {
  cli?: WorkerRuntime;
  model?: string;
  count?: number | string;
}

export interface OpenCodeConfig {
  model?: string;
  small_model_cli?: WorkerRuntime;
  small_model?: string;
  commander?: {
    default_worker_cli?: WorkerRuntime;
    workers?: WorkerConfigEntry[];
  };
}

export interface TermiteConfig {
  commander_model?: string;
  default_worker_cli?: WorkerRuntime;
  default_worker_model?: string;
  workers?: WorkerConfigEntry[];
  commander?: {
    model?: string;
    default_worker_cli?: WorkerRuntime;
    default_worker_model?: string;
    workers?: WorkerConfigEntry[];
  };
}

interface ConfigLookup<TConfig> {
  config: TConfig | null;
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
 *   /claude/    -> "anthropic"
 *   /gpt|codex/ -> "azure-openai"
 *   otherwise   -> "anthropic" (safe default)
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
  }

  const lower = modelId.toLowerCase();
  if (/claude/.test(lower)) return "anthropic";
  if (/gpt|codex/.test(lower)) return "azure-openai";

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

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (Number.isInteger(value) && value > 0) return value;
    return undefined;
  }
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return undefined;
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

function normalizeWorkerConfigEntries(
  entries: WorkerConfigEntry[],
  defaultCli: WorkerRuntime,
  issues: ModelResolutionIssues,
  origin: string,
): WorkerSpec[] {
  const normalized: WorkerSpec[] = [];

  for (const entry of entries) {
    const cli = normalizeWorkerRuntime(entry.cli, defaultCli);
    const model = asNonEmptyString(entry.model);
    const count = parsePositiveInt(entry.count);

    if (!count) {
      issues.warnings.push(
        `Ignored worker entry with invalid count in ${origin}. Each worker count must be a positive integer.`,
      );
      continue;
    }

    normalized.push({ cli, model, count });
  }

  return normalized;
}

function dedupeMessages(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
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

  if (/^\d+$/.test(trimmed)) {
    const parsed = parseInt(trimmed, 10);
    return [{ cli: defaultCli, model: undefined, count: parsed > 0 ? parsed : 1 }];
  }

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
        const parsed = countRaw ? parseInt(countRaw, 10) : 1;
        const count = !Number.isNaN(parsed) && parsed > 0 ? parsed : 1;
        return { cli, model, count };
      }

      const runtimeCountMatch = entry.match(/^(opencode|claude|codex):(\d+)$/i);
      if (runtimeCountMatch) {
        const cli = normalizeWorkerRuntime(runtimeCountMatch[1], defaultCli);
        const parsed = parseInt(runtimeCountMatch[2], 10);
        const count = !Number.isNaN(parsed) && parsed > 0 ? parsed : 1;
        return { cli, model: undefined, count };
      }

      const parts = entry.split(":");
      if (parts.length === 2) {
        const model = parts[0].trim();
        const parsed = parseInt(parts[1].trim(), 10);
        const count = !Number.isNaN(parsed) && parsed > 0 ? parsed : 1;
        return { cli: defaultCli, model, count };
      }

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
    if (text[i] === '"') {
      const start = i;
      i++;
      while (i < len && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      i++;
      result += text.slice(start, i);
      continue;
    }

    if (text[i] === "/" && i + 1 < len && text[i + 1] === "/") {
      while (i < len && text[i] !== "\n") i++;
      continue;
    }

    if (text[i] === "/" && i + 1 < len && text[i + 1] === "*") {
      i += 2;
      while (i < len && !(text[i] === "*" && i + 1 < len && text[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }

    result += text[i];
    i++;
  }

  return result;
}

function readJsoncFile<TConfig>(path: string): TConfig | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const stripped = stripJsoncComments(raw);
    return JSON.parse(stripped) as TConfig;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Config lookups
// ---------------------------------------------------------------------------

/**
 * Search for termite config in standard locations.
 *
 * Search order:
 *   1. $colonyRoot/termite.config.json
 *   2. $colonyRoot/.termite/config.json
 */
export function readTermiteConfigWithPath(colonyRoot: string): ConfigLookup<TermiteConfig> {
  const candidates = [
    join(colonyRoot, "termite.config.json"),
    join(colonyRoot, ".termite", "config.json"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const parsed = readJsoncFile<TermiteConfig>(candidate);
    if (parsed) {
      return { config: parsed, path: candidate };
    }
  }

  return { config: null, path: null };
}

export function readTermiteConfig(colonyRoot: string): TermiteConfig | null {
  return readTermiteConfigWithPath(colonyRoot).config;
}

/**
 * Search for opencode.json in standard locations and return parsed config.
 *
 * Search order:
 *   1. $colonyRoot/opencode.json
 *   2. $colonyRoot/.opencode/opencode.json
 *   3. ~/.config/opencode/opencode.json
 */
export function readOpenCodeConfigWithPath(colonyRoot: string): ConfigLookup<OpenCodeConfig> {
  const candidates = [
    join(colonyRoot, "opencode.json"),
    join(colonyRoot, ".opencode", "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.json"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const parsed = readJsoncFile<OpenCodeConfig>(candidate);
    if (parsed) {
      return { config: parsed, path: candidate };
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

const DEFAULT_WORKER_CLI: WorkerRuntime = "opencode";
const DEFAULT_WORKER_MODEL = "claude-haiku-3-5";
const DEFAULT_WORKER_COUNT = 3;

/**
 * Resolve model configuration from termite config, opencode.json, env vars, and defaults.
 *
 * Priority (highest wins):
 *   Commander model (required):
 *     termite.config.json "commander.model"
 *       > termite.config.json "commander_model"
 *       > opencode.json "model"
 *       > COMMANDER_MODEL env
 *       > (error)
 *
 *   Default worker CLI:
 *     termite.config.json "commander.default_worker_cli"
 *       > termite.config.json "default_worker_cli"
 *       > opencode.json "commander.default_worker_cli"
 *       > opencode.json "small_model_cli"
 *       > TERMITE_WORKER_CLI env
 *       > "opencode"
 *
 *   Default worker model:
 *     termite.config.json "commander.default_worker_model"
 *       > termite.config.json "default_worker_model"
 *       > opencode.json "small_model"
 *       > TERMITE_MODEL env
 *       > "claude-haiku-3-5"
 *
 *   Workers:
 *     termite.config.json "commander.workers"
 *       > termite.config.json "workers"
 *       > opencode.json "commander.workers"
 *       > TERMITE_WORKERS env
 *       > 3x default worker
 */
export function resolveModels(colonyRoot: string): ResolvedModels {
  const issues: ModelResolutionIssues = {
    warnings: [],
    errors: [],
  };

  const termiteLookup = readTermiteConfigWithPath(colonyRoot);
  const termiteConfig = termiteLookup.config;
  const termitePath = termiteLookup.path;

  const opencodeLookup = readOpenCodeConfigWithPath(colonyRoot);
  const opencodeConfig = opencodeLookup.config;
  const opencodePath = opencodeLookup.path;

  // Commander model (required)
  let commanderModelRaw: string | undefined;
  let commanderModelResolution: ResolutionField;
  if (asNonEmptyString(termiteConfig?.commander?.model)) {
    commanderModelRaw = asNonEmptyString(termiteConfig?.commander?.model);
    commanderModelResolution = {
      source: "config",
      detail: `${termitePath ?? "termite.config.json"}: commander.model`,
    };
  } else if (asNonEmptyString(termiteConfig?.commander_model)) {
    commanderModelRaw = asNonEmptyString(termiteConfig?.commander_model);
    commanderModelResolution = {
      source: "config",
      detail: `${termitePath ?? "termite.config.json"}: commander_model`,
    };
  } else if (asNonEmptyString(opencodeConfig?.model)) {
    commanderModelRaw = asNonEmptyString(opencodeConfig?.model);
    commanderModelResolution = {
      source: "config",
      detail: `${opencodePath ?? "opencode.json"}: model`,
    };
  } else if (asNonEmptyString(process.env.COMMANDER_MODEL)) {
    commanderModelRaw = asNonEmptyString(process.env.COMMANDER_MODEL);
    commanderModelResolution = {
      source: "env",
      detail: "COMMANDER_MODEL",
    };
  } else {
    commanderModelRaw = undefined;
    commanderModelResolution = {
      source: "default",
      detail: "MISSING (required)",
    };
  }

  if (!commanderModelRaw) {
    issues.errors.push(
      "Missing decomposition model (commander model). Configure one of: " +
        "termite.config.json -> commander.model, termite.config.json -> commander_model, " +
        "opencode.json -> model, or COMMANDER_MODEL env var.",
    );
    if (asNonEmptyString(opencodeConfig?.small_model)) {
      issues.warnings.push(
        "Found opencode.json small_model but no model. small_model is only for workers and cannot be used as the decomposition model.",
      );
    }
  }

  const commanderModel = commanderModelRaw ? extractModelName(commanderModelRaw) : "";
  const commanderProvider = commanderModelRaw
    ? extractProvider(commanderModelRaw)
    : "anthropic";

  // Default worker CLI runtime
  let defaultWorkerCliRaw: string;
  let defaultWorkerCliResolution: ResolutionField;
  if (asNonEmptyString(termiteConfig?.commander?.default_worker_cli)) {
    defaultWorkerCliRaw = asNonEmptyString(termiteConfig?.commander?.default_worker_cli)!;
    defaultWorkerCliResolution = {
      source: "config",
      detail: `${termitePath ?? "termite.config.json"}: commander.default_worker_cli`,
    };
  } else if (asNonEmptyString(termiteConfig?.default_worker_cli)) {
    defaultWorkerCliRaw = asNonEmptyString(termiteConfig?.default_worker_cli)!;
    defaultWorkerCliResolution = {
      source: "config",
      detail: `${termitePath ?? "termite.config.json"}: default_worker_cli`,
    };
  } else if (asNonEmptyString(opencodeConfig?.commander?.default_worker_cli)) {
    defaultWorkerCliRaw = asNonEmptyString(opencodeConfig?.commander?.default_worker_cli)!;
    defaultWorkerCliResolution = {
      source: "config",
      detail: `${opencodePath ?? "opencode.json"}: commander.default_worker_cli`,
    };
  } else if (asNonEmptyString(opencodeConfig?.small_model_cli)) {
    defaultWorkerCliRaw = asNonEmptyString(opencodeConfig?.small_model_cli)!;
    defaultWorkerCliResolution = {
      source: "config",
      detail: `${opencodePath ?? "opencode.json"}: small_model_cli`,
    };
  } else if (asNonEmptyString(process.env.TERMITE_WORKER_CLI)) {
    defaultWorkerCliRaw = asNonEmptyString(process.env.TERMITE_WORKER_CLI)!;
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
  if (asNonEmptyString(termiteConfig?.commander?.default_worker_model)) {
    defaultWorkerModelRaw = asNonEmptyString(termiteConfig?.commander?.default_worker_model)!;
    defaultWorkerResolution = {
      source: "config",
      detail: `${termitePath ?? "termite.config.json"}: commander.default_worker_model`,
    };
  } else if (asNonEmptyString(termiteConfig?.default_worker_model)) {
    defaultWorkerModelRaw = asNonEmptyString(termiteConfig?.default_worker_model)!;
    defaultWorkerResolution = {
      source: "config",
      detail: `${termitePath ?? "termite.config.json"}: default_worker_model`,
    };
  } else if (asNonEmptyString(opencodeConfig?.small_model)) {
    defaultWorkerModelRaw = asNonEmptyString(opencodeConfig?.small_model)!;
    defaultWorkerResolution = {
      source: "config",
      detail: `${opencodePath ?? "opencode.json"}: small_model`,
    };
  } else if (asNonEmptyString(process.env.TERMITE_MODEL)) {
    defaultWorkerModelRaw = asNonEmptyString(process.env.TERMITE_MODEL)!;
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
  let workers: WorkerSpec[] = [];
  let workersResolution: ResolutionField;

  const termiteCommanderWorkers = termiteConfig?.commander?.workers;
  const termiteWorkers = termiteConfig?.workers;
  const opencodeWorkers = opencodeConfig?.commander?.workers;
  const workersEnv = asNonEmptyString(process.env.TERMITE_WORKERS);

  if (Array.isArray(termiteCommanderWorkers) && termiteCommanderWorkers.length > 0) {
    workers = normalizeWorkerConfigEntries(
      termiteCommanderWorkers,
      defaultWorkerCli,
      issues,
      `${termitePath ?? "termite.config.json"}: commander.workers`,
    );
    workersResolution = {
      source: "config",
      detail: `${termitePath ?? "termite.config.json"}: commander.workers`,
    };
  } else if (Array.isArray(termiteWorkers) && termiteWorkers.length > 0) {
    workers = normalizeWorkerConfigEntries(
      termiteWorkers,
      defaultWorkerCli,
      issues,
      `${termitePath ?? "termite.config.json"}: workers`,
    );
    workersResolution = {
      source: "config",
      detail: `${termitePath ?? "termite.config.json"}: workers`,
    };
  } else if (Array.isArray(opencodeWorkers) && opencodeWorkers.length > 0) {
    workers = normalizeWorkerConfigEntries(
      opencodeWorkers,
      defaultWorkerCli,
      issues,
      `${opencodePath ?? "opencode.json"}: commander.workers`,
    );
    workersResolution = {
      source: "config",
      detail: `${opencodePath ?? "opencode.json"}: commander.workers`,
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
      detail: `${DEFAULT_WORKER_COUNT} x ${defaultWorkerCli}@${defaultWorkerModel}`,
    };
  }

  if (workers.length === 0) {
    issues.warnings.push(
      "No valid worker entries resolved. Falling back to default worker fleet.",
    );
    workers = [{ cli: defaultWorkerCli, model: undefined, count: DEFAULT_WORKER_COUNT }];
    workersResolution = {
      source: "default",
      detail: `${DEFAULT_WORKER_COUNT} x ${defaultWorkerCli}@${defaultWorkerModel}`,
    };
  }

  issues.errors = dedupeMessages(issues.errors);
  issues.warnings = dedupeMessages(issues.warnings);

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
    issues,
  };
}

export function assertPlanningModelConfigured(models: ResolvedModels): void {
  if (models.issues.errors.length === 0) return;

  const details = models.issues.errors.map((msg) => `  - ${msg}`).join("\n");
  const warnings = models.issues.warnings.length
    ? `\nWarnings:\n${models.issues.warnings.map((msg) => `  - ${msg}`).join("\n")}`
    : "";
  throw new Error(
    "Model configuration invalid. Commander cannot decompose tasks until fixed.\n" +
      `${details}${warnings}\n` +
      "Suggested quick fixes:\n" +
      "  1) Set termite.config.json -> commander.model\n" +
      "  2) Or set opencode.json -> model\n" +
      "  3) Or export COMMANDER_MODEL=<provider/model>",
  );
}
