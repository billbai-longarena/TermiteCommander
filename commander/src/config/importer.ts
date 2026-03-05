import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  readOpenCodeConfigWithPath,
  readTermiteConfigWithPath,
  type OpenCodeConfig,
  type TermiteConfig,
  type WorkerRuntime,
} from "./model-resolver.js";

export type ExternalConfigSource = "auto" | "opencode" | "claude" | "codex";

export interface ImportDiagnostic {
  level: "info" | "warning" | "error";
  message: string;
}

export interface ExternalImportResult {
  source: "opencode" | "claude" | "codex";
  found: boolean;
  path: string | null;
  confidence: number;
  recommended: TermiteConfig | null;
  diagnostics: ImportDiagnostic[];
}

export interface ImportSelectionResult {
  selected: ExternalImportResult | null;
  candidates: ExternalImportResult[];
}

export interface MergeResult {
  merged: TermiteConfig;
  changes: string[];
  unchanged: string[];
}

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

function readJsonc(path: string): unknown | null {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(stripJsoncComments(raw)) as unknown;
  } catch {
    return null;
  }
}

function getStringAtPath(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== "string") return undefined;
  const trimmed = current.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getFirstStringAtPaths(value: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    const candidate = getStringAtPath(value, path);
    if (candidate) return candidate;
  }
  return undefined;
}

function sanitizeModelValue(value: string): string {
  return value
    .replace(/\x1B\[[0-9;]*m/g, "")
    .replace(/\[[0-9;]*m\]/g, "")
    .trim();
}

function normalizeProvider(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim();
  if (!normalized) return undefined;
  if (normalized === "anthropic") return "anthropic";
  if (normalized === "openai") return "openai";
  if (normalized === "azure") return "azure";
  if (normalized === "azure-openai") return "azure";
  if (normalized === "codex") return "azure";
  if (normalized === "claude") return "anthropic";
  return normalized;
}

function normalizeImportedModel(value: string | undefined, providerHint?: string): string | undefined {
  if (!value) return undefined;
  const model = sanitizeModelValue(value);
  if (!model) return undefined;

  if (model.includes("/")) return model;

  const hint = normalizeProvider(providerHint);
  if (hint) return `${hint}/${model}`;

  const lower = model.toLowerCase();
  if (lower.includes("claude")) return `anthropic/${model}`;
  if (lower.includes("gpt") || lower.includes("codex")) return `azure/${model}`;
  return model;
}

function normalizeWorkersFromOpenCode(
  config: OpenCodeConfig,
): NonNullable<TermiteConfig["commander"]>["workers"] {
  const workers = config.commander?.workers;
  if (!Array.isArray(workers) || workers.length === 0) return undefined;

  return workers
    .filter((w) => w && typeof w === "object")
    .map((worker) => {
      const out: { cli?: WorkerRuntime; model?: string; count?: number } = {};
      let cliValue: WorkerRuntime | undefined;
      if (typeof worker.cli === "string") {
        const cli = worker.cli.toLowerCase().trim();
        if (cli === "opencode" || cli === "claude" || cli === "codex" || cli === "openclaw") {
          out.cli = cli;
          cliValue = cli;
        }
      }
      if (typeof worker.model === "string" && worker.model.trim()) {
        out.model = cliValue === "openclaw"
          ? worker.model.trim()
          : normalizeImportedModel(worker.model);
      }
      if (typeof worker.count === "number" && Number.isInteger(worker.count) && worker.count > 0) {
        out.count = worker.count;
      }
      return out;
    })
    .filter((w) => typeof w.count === "number" && w.count > 0);
}

interface ParsedToml {
  root: Record<string, string>;
  sections: Record<string, Record<string, string>>;
}

function parseTomlValue(rawValue: string): string | undefined {
  const value = rawValue.trim();
  if (!value) return undefined;

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (/^[A-Za-z0-9._/-]+$/.test(value)) {
    return value;
  }

  return undefined;
}

function parseSimpleToml(filePath: string): ParsedToml | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const root: Record<string, string> = {};
    const sections: Record<string, Record<string, string>> = {};
    let currentSection: string | null = null;

    for (const line of raw.split(/\r?\n/)) {
      const cleaned = line.replace(/#.*$/, "").trim();
      if (!cleaned) continue;

      const sectionMatch = cleaned.match(/^\[([A-Za-z0-9_.-]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        if (!sections[currentSection]) sections[currentSection] = {};
        continue;
      }

      if (cleaned.includes("{")) continue;
      const match = cleaned.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
      if (!match) continue;

      const key = match[1];
      const parsedValue = parseTomlValue(match[2]);
      if (!parsedValue) continue;

      if (currentSection) {
        if (!sections[currentSection]) sections[currentSection] = {};
        sections[currentSection][key] = parsedValue;
      } else {
        root[key] = parsedValue;
      }
    }

    return { root, sections };
  } catch {
    return null;
  }
}

function getFirstTomlValue(parsed: ParsedToml, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = parsed.root[key];
    if (direct && direct.trim()) return direct.trim();
  }
  return undefined;
}

function getFirstTomlSectionValue(
  parsed: ParsedToml,
  sectionNames: string[],
  keys: string[],
): string | undefined {
  for (const sectionName of sectionNames) {
    const section = parsed.sections[sectionName];
    if (!section) continue;
    for (const key of keys) {
      const value = section[key];
      if (value && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function getFirstExisting(paths: string[]): string | null {
  for (const candidate of paths) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function importFromOpenCode(colonyRoot: string): ExternalImportResult {
  const diagnostics: ImportDiagnostic[] = [];
  const lookup = readOpenCodeConfigWithPath(colonyRoot);
  if (!lookup.config) {
    return {
      source: "opencode",
      found: false,
      path: lookup.path,
      confidence: 0,
      recommended: null,
      diagnostics: [{ level: "info", message: "No opencode config found." }],
    };
  }

  const commander: NonNullable<TermiteConfig["commander"]> = {};
  const model = normalizeImportedModel(lookup.config.model);
  if (model) commander.model = model;

  if (lookup.config.commander?.default_worker_cli) {
    commander.default_worker_cli = lookup.config.commander.default_worker_cli;
  } else if (lookup.config.small_model_cli) {
    commander.default_worker_cli = lookup.config.small_model_cli;
  }

  const defaultWorkerModel = normalizeImportedModel(lookup.config.small_model);
  if (defaultWorkerModel) commander.default_worker_model = defaultWorkerModel;

  const workers = normalizeWorkersFromOpenCode(lookup.config);
  if (workers && workers.length > 0) {
    commander.workers = workers;
  }

  if (!commander.model) {
    diagnostics.push({
      level: "warning",
      message: `opencode config found at ${lookup.path ?? "unknown"} but missing 'model'.`,
    });
  } else {
    diagnostics.push({
      level: "info",
      message: `Imported commander.model from ${lookup.path ?? "opencode.json"}.`,
    });
  }

  return {
    source: "opencode",
    found: true,
    path: lookup.path,
    confidence: commander.model ? 0.98 : 0.7,
    recommended: { commander },
    diagnostics,
  };
}

function importFromClaude(colonyRoot: string): ExternalImportResult {
  const diagnostics: ImportDiagnostic[] = [];
  const candidates = [
    join(colonyRoot, ".claude", "settings.json"),
    join(colonyRoot, ".claude.json"),
    join(homedir(), ".claude", "settings.json"),
    join(homedir(), ".config", "claude", "settings.json"),
  ];
  const path = getFirstExisting(candidates);
  if (!path) {
    return {
      source: "claude",
      found: false,
      path: null,
      confidence: 0,
      recommended: null,
      diagnostics: [{ level: "info", message: "No Claude settings.json found." }],
    };
  }

  const parsed = readJsonc(path);
  if (!parsed) {
    return {
      source: "claude",
      found: true,
      path,
      confidence: 0.1,
      recommended: null,
      diagnostics: [{ level: "error", message: `Failed to parse Claude config: ${path}` }],
    };
  }

  const rawModel = getFirstStringAtPaths(parsed, [
    ["model"],
    ["defaultModel"],
    ["default_model"],
    ["defaults", "model"],
    ["model", "default"],
    ["profiles", "default", "model"],
    ["projects", "default", "model"],
  ]);
  const model = normalizeImportedModel(rawModel, "anthropic");

  if (!model) {
    diagnostics.push({
      level: "warning",
      message:
        `Claude config found at ${path} but no model field matched ` +
        "(model/defaultModel/default_model/defaults.model/model.default/profiles.default.model).",
    });
    return {
      source: "claude",
      found: true,
      path,
      confidence: 0.2,
      recommended: null,
      diagnostics,
    };
  }

  diagnostics.push({
    level: "info",
    message: `Imported commander.model from Claude config ${path}.`,
  });
  return {
    source: "claude",
    found: true,
    path,
    confidence: path.includes(`${colonyRoot}/`) ? 0.92 : 0.86,
    recommended: {
      commander: {
        model,
      },
    },
    diagnostics,
  };
}

function importFromCodex(colonyRoot: string): ExternalImportResult {
  const diagnostics: ImportDiagnostic[] = [];
  const candidates = [
    join(colonyRoot, ".codex", "config.toml"),
    join(homedir(), ".codex", "config.toml"),
    join(homedir(), ".config", "codex", "config.toml"),
  ];
  const path = getFirstExisting(candidates);
  if (!path) {
    return {
      source: "codex",
      found: false,
      path: null,
      confidence: 0,
      recommended: null,
      diagnostics: [{ level: "info", message: "No Codex config.toml found." }],
    };
  }

  const parsed = parseSimpleToml(path);
  if (!parsed) {
    return {
      source: "codex",
      found: true,
      path,
      confidence: 0.1,
      recommended: null,
      diagnostics: [{ level: "error", message: `Failed to parse Codex TOML config: ${path}` }],
    };
  }

  const providerHint =
    getFirstTomlValue(parsed, ["model_provider", "provider"]) ??
    getFirstTomlSectionValue(
      parsed,
      ["defaults", "profile.default", "profiles.default", "default"],
      ["model_provider", "provider"],
    );

  const modelRaw =
    getFirstTomlValue(parsed, ["model", "default_model"]) ??
    getFirstTomlSectionValue(
      parsed,
      [
        "defaults",
        "profile.default",
        "profiles.default",
        "default",
        "models.default",
      ],
      ["model", "default_model", "name"],
    );

  const model = normalizeImportedModel(modelRaw, providerHint);
  if (!model) {
    diagnostics.push({
      level: "warning",
      message:
        `Codex config found at ${path} but missing model in known TOML fields ` +
        "(model/default_model/default sections).",
    });
    return {
      source: "codex",
      found: true,
      path,
      confidence: 0.2,
      recommended: null,
      diagnostics,
    };
  }

  diagnostics.push({
    level: "info",
    message: `Imported commander.model from Codex config ${path}.`,
  });
  return {
    source: "codex",
    found: true,
    path,
    confidence: path.includes(`${colonyRoot}/`) ? 0.9 : 0.84,
    recommended: {
      commander: {
        model,
      },
    },
    diagnostics,
  };
}

function compareCandidatePriority(a: ExternalImportResult, b: ExternalImportResult): number {
  if (a.confidence !== b.confidence) {
    return b.confidence - a.confidence;
  }
  const priority: Record<ExternalImportResult["source"], number> = {
    opencode: 3,
    claude: 2,
    codex: 1,
  };
  return priority[b.source] - priority[a.source];
}

export function importExternalConfig(
  colonyRoot: string,
  from: ExternalConfigSource,
): ImportSelectionResult {
  const candidates: ExternalImportResult[] = [];

  const add = (source: ExternalImportResult["source"]) => {
    if (source === "opencode") candidates.push(importFromOpenCode(colonyRoot));
    if (source === "claude") candidates.push(importFromClaude(colonyRoot));
    if (source === "codex") candidates.push(importFromCodex(colonyRoot));
  };

  if (from === "auto") {
    add("opencode");
    add("claude");
    add("codex");
  } else {
    add(from);
  }

  const selected = [...candidates]
    .filter((c) => c.found && c.recommended?.commander?.model)
    .sort(compareCandidatePriority)[0] ?? null;

  return { selected, candidates };
}

export function mergeImportedConfig(
  existing: TermiteConfig | null,
  imported: TermiteConfig,
  force: boolean,
): MergeResult {
  const merged: TermiteConfig = existing ? JSON.parse(JSON.stringify(existing)) : {};
  const changes: string[] = [];
  const unchanged: string[] = [];
  const importedCommander = imported.commander ?? {};

  if (!merged.commander) merged.commander = {};

  const applyStringField = (
    key: "model" | "default_worker_cli" | "default_worker_model",
    value: string | undefined,
  ) => {
    if (!value) return;
    const current = merged.commander?.[key];
    if (!current || force) {
      merged.commander![key] = value as any;
      changes.push(`commander.${key}: ${current ?? "<unset>"} -> ${value}`);
    } else {
      unchanged.push(`commander.${key}: kept ${current}`);
    }
  };

  applyStringField("model", importedCommander.model);
  applyStringField("default_worker_cli", importedCommander.default_worker_cli);
  applyStringField("default_worker_model", importedCommander.default_worker_model);

  if (importedCommander.workers && importedCommander.workers.length > 0) {
    const current = merged.commander?.workers;
    if (!current || current.length === 0 || force) {
      merged.commander!.workers = importedCommander.workers;
      changes.push(`commander.workers: ${current?.length ?? 0} -> ${importedCommander.workers.length} entries`);
    } else {
      unchanged.push(`commander.workers: kept ${current.length} entries`);
    }
  }

  return { merged, changes, unchanged };
}

export function getTermiteConfigPath(colonyRoot: string): string {
  const current = readTermiteConfigWithPath(colonyRoot);
  return current.path ?? join(colonyRoot, "termite.config.json");
}

export function writeTermiteConfig(path: string, config: TermiteConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}
