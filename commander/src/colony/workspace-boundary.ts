import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WORKSPACE_MARKER = "# Termite Commander — workspace boundary";
const WORKSPACE_IGNORE_RULES = [
  ".termite/human/**",
  "!.termite/human/README.md",
];

function ensureFile(path: string, content: string): boolean {
  if (existsSync(path)) return false;
  writeFileSync(path, content, "utf-8");
  return true;
}

function ensureWorkspaceGitignore(colonyRoot: string): boolean {
  const gitignorePath = join(colonyRoot, ".gitignore");
  const block = `${WORKSPACE_MARKER}\n${WORKSPACE_IGNORE_RULES.join("\n")}\n`;

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${block}`, "utf-8");
    return true;
  }

  const current = readFileSync(gitignorePath, "utf-8");
  if (current.includes(WORKSPACE_MARKER)) {
    return false;
  }

  const suffix = current.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignorePath, `${current}${suffix}\n${block}`, "utf-8");
  return true;
}

export interface WorkspaceBoundarySetupResult {
  createdFiles: string[];
  createdDirs: string[];
  gitignoreUpdated: boolean;
}

export function ensureWorkspaceBoundary(colonyRoot: string): WorkspaceBoundarySetupResult {
  const termiteRoot = join(colonyRoot, ".termite");
  const workerRoot = join(termiteRoot, "worker");
  const humanRoot = join(termiteRoot, "human");

  const createdDirs: string[] = [];
  for (const dir of [termiteRoot, workerRoot, humanRoot]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      createdDirs.push(dir);
    }
  }

  const createdFiles: string[] = [];
  if (
    ensureFile(
      join(termiteRoot, "WORKSPACE_POLICY.md"),
      [
        "# Termite Workspace Policy",
        "",
        "- `.termite/worker/` is the worker-visible context zone.",
        "- `.termite/human/` is the human draft zone. Workers must not use it unless a signal explicitly references those files.",
        "- Copy finalized design docs into `.termite/worker/PLAN.md` before launching the colony.",
        "",
      ].join("\n"),
    )
  ) {
    createdFiles.push(join(termiteRoot, "WORKSPACE_POLICY.md"));
  }

  if (
    ensureFile(
      join(termiteRoot, "config.example.json"),
      [
        "{",
        '  "commander": {',
        '    "model": "anthropic/claude-sonnet-4-5",',
        '    "default_worker_cli": "opencode",',
        '    "default_worker_model": "anthropic/claude-haiku-3-5",',
        '    "workers": [',
        '      { "cli": "opencode", "model": "anthropic/claude-sonnet-4-5", "count": 1 },',
        '      { "cli": "opencode", "model": "anthropic/claude-haiku-3-5", "count": 2 }',
        "    ]",
        "  }",
        "}",
        "",
      ].join("\n"),
    )
  ) {
    createdFiles.push(join(termiteRoot, "config.example.json"));
  }

  if (
    ensureFile(
      join(workerRoot, "README.md"),
      [
        "# Worker Zone",
        "",
        "Put worker-facing context here, for example:",
        "- `PLAN.md` (finalized implementation plan)",
        "- stable requirements docs meant for colony execution",
        "",
      ].join("\n"),
    )
  ) {
    createdFiles.push(join(workerRoot, "README.md"));
  }

  if (
    ensureFile(
      join(workerRoot, "PLAN.md"),
      [
        "# PLAN",
        "",
        "Place finalized design context for colony decomposition here.",
        "This file is safe for worker ingestion.",
        "",
      ].join("\n"),
    )
  ) {
    createdFiles.push(join(workerRoot, "PLAN.md"));
  }

  if (
    ensureFile(
      join(humanRoot, "README.md"),
      [
        "# Human Draft Zone",
        "",
        "Store drafts, brainstorming notes, and unstable docs here.",
        "These files are excluded from worker context by policy.",
        "",
      ].join("\n"),
    )
  ) {
    createdFiles.push(join(humanRoot, "README.md"));
  }

  const gitignoreUpdated = ensureWorkspaceGitignore(colonyRoot);

  return {
    createdFiles,
    createdDirs,
    gitignoreUpdated,
  };
}
