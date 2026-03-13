import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ColonyStatus {
  total: number;
  open: number;
  claimed: number;
  done: number;
  blocked: number;
}

export interface StallStatus {
  stalled: boolean;
  lastCommitMinutesAgo: number;
  openSignals: number;
  claimedSignals: number;
}

export interface SignalDetail {
  id: string;
  type: string;
  title: string;
  status: string;
  weight: number;
  owner: string;
  claimedBy: string;
  module: string;
  tags: string;
  nextHint: string;
  touchCount: number;
  source: string;
  parentId: string;
  childHint: string;
  depth: number;
  parkedReason: string;
  parkedConditions: string;
  createdAt: string;
  updatedAt: string;
}

export class SignalBridge {
  readonly colonyRoot: string;
  private scriptsDir: string;

  constructor(colonyRoot: string) {
    this.colonyRoot = resolve(colonyRoot);
    this.scriptsDir = join(this.colonyRoot, "scripts");
  }

  hasScripts(): boolean {
    return existsSync(this.scriptsDir);
  }

  async exec(command: string, args: string[] = [], cwd?: string): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: cwd ?? this.colonyRoot,
        timeout: 30_000,
        env: {
          ...process.env,
          COLONY_ROOT: this.colonyRoot,
          PROJECT_ROOT: this.colonyRoot,
          SCRIPT_DIR: this.scriptsDir,
        },
      });
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout?.trim() ?? "",
        stderr: err.stderr?.trim() ?? err.message,
        exitCode: err.code ?? 1,
      };
    }
  }

  async fieldScript(name: string, args: string[] = []): Promise<ExecResult> {
    const scriptPath = join(this.scriptsDir, name);
    if (!existsSync(scriptPath)) {
      return { stdout: "", stderr: `Script not found: ${name}`, exitCode: 127 };
    }
    return this.exec("bash", [scriptPath, ...args]);
  }

  /**
   * Build the preamble that every DB-touching bash snippet needs:
   * sets PROJECT_ROOT, SCRIPT_DIR, sources termite-db.sh, calls db_ensure.
   */
  private dbPreamble(): string {
    return [
      `export PROJECT_ROOT="${this.colonyRoot}"`,
      `export SCRIPT_DIR="${this.scriptsDir}"`,
      `source "${join(this.scriptsDir, "field-lib.sh")}" 2>/dev/null || true`,
      `source "${join(this.scriptsDir, "termite-db.sh")}"`,
      `db_ensure`,
    ].join(" && ");
  }

  async status(): Promise<ColonyStatus> {
    const script =
      `${this.dbPreamble()} && ` +
      `LIVE_OPEN=$(db_signal_count "status='open'") && ` +
      `LIVE_CLAIMED=$(db_signal_count "status='claimed'") && ` +
      `LIVE_BLOCKED=$(db_signal_count "status='blocked'") && ` +
      `LIVE_DONE=$(db_signal_count "status IN ('done','completed')") && ` +
      `ARCHIVED_DONE=$(db_exec "SELECT COUNT(*) FROM archive WHERE original_table='signals' AND archive_reason='done';" 2>/dev/null || echo 0) && ` +
      `ACTIONABLE=$(db_signal_count "status NOT IN ('parked','done','completed')") && ` +
      `echo "$LIVE_OPEN|$LIVE_CLAIMED|$LIVE_BLOCKED|$LIVE_DONE|$ARCHIVED_DONE|$ACTIONABLE"`;

    const result = await this.exec("bash", ["-c", script]);

    if (result.exitCode !== 0) {
      return { total: 0, open: 0, claimed: 0, done: 0, blocked: 0 };
    }

    const [open, claimed, blocked, liveDone, archivedDone, actionable] = result.stdout
      .split("|")
      .map(Number);
    const done = (liveDone || 0) + (archivedDone || 0);
    const total = (actionable || 0) + done;
    return {
      total: total || 0,
      open: open || 0,
      claimed: claimed || 0,
      done: done || 0,
      blocked: blocked || 0,
    };
  }

  async listSignals(): Promise<SignalDetail[]> {
    const script =
      `${this.dbPreamble()} && sqlite3 -separator '|' "$TERMITE_DB" ` +
      `"SELECT id, type, title, status, weight, owner, module, tags, next_hint, touch_count, source, parent_id, child_hint, depth, parked_reason, parked_conditions, created, last_touched FROM signals ORDER BY CASE status WHEN 'claimed' THEN 1 WHEN 'open' THEN 2 ELSE 3 END, created ASC"`;

    const result = await this.exec("bash", ["-c", script]);
    if (result.exitCode !== 0 || !result.stdout.trim()) return [];

    return result.stdout.split("\n").filter(Boolean).map((line) => {
      const [
        id,
        type,
        title,
        status,
        weight,
        owner,
        module,
        tags,
        nextHint,
        touchCount,
        source,
        parentId,
        childHint,
        depth,
        parkedReason,
        parkedConditions,
        createdAt,
        updatedAt,
      ] = line.split("|");
      return {
        id: id ?? "",
        type: type ?? "",
        title: title ?? "",
        status: status ?? "open",
        weight: parseInt(weight ?? "0", 10),
        owner: owner ?? "",
        claimedBy: owner ?? "",
        module: module ?? "",
        tags: tags ?? "",
        nextHint: nextHint ?? "",
        touchCount: parseInt(touchCount ?? "0", 10),
        source: source ?? "",
        parentId: parentId ?? "",
        childHint: childHint ?? "",
        depth: parseInt(depth ?? "0", 10),
        parkedReason: parkedReason ?? "",
        parkedConditions: parkedConditions ?? "",
        createdAt: createdAt ?? "",
        updatedAt: updatedAt ?? "",
      };
    });
  }

  async createSignal(params: {
    type: string;
    title: string;
    weight: number;
    source: string;
    parentId?: string;
    childHint?: string;
    module?: string;
    nextHint?: string;
    tags?: string[];
  }): Promise<ExecResult> {
    // Escape values at JS level to avoid bash injection
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const type = esc(params.type || "HOLE");
    const title = esc(params.title);
    const weight = String(params.weight || 80);
    const source = esc(params.source || "directive");
    const module = esc(params.module ?? "");
    const nextHint = esc(params.nextHint ?? "");
    const parentId = esc(params.parentId ?? "");
    const childHint = esc(params.childHint ?? "");
    const tags = esc(JSON.stringify(params.tags ?? []));
    const depth = params.parentId ? "1" : "0";

    const script = `${this.dbPreamble()} && ID=$(db_next_signal_id S) && NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ) && db_signal_create "$ID" '${type}' '${title}' 'open' '${weight}' '14' "$NOW" "$NOW" 'commander' '${module}' '${tags}' '${nextHint}' '0' '${source}' '${parentId}' '${childHint}' '${depth}' && echo "$ID"`;

    return this.exec("bash", ["-c", script]);
  }

  async checkStall(sinceMinutes: number): Promise<StallStatus> {
    const script = `${this.dbPreamble()} && LAST_COMMIT=$(git -C "${this.colonyRoot}" log -1 --format=%ct 2>/dev/null || echo 0) && NOW=$(date +%s) && AGE=$(( (NOW - LAST_COMMIT) / 60 )) && OPEN=$(db_signal_count "status='open'") && CLAIMED=$(db_signal_count "status='claimed'") && echo "$AGE|$OPEN|$CLAIMED"`;

    const result = await this.exec("bash", ["-c", script]);
    if (result.exitCode !== 0) {
      return { stalled: false, lastCommitMinutesAgo: 0, openSignals: 0, claimedSignals: 0 };
    }
    const [age, open, claimed] = result.stdout.split("|").map(Number);
    return {
      stalled: age > sinceMinutes,
      lastCommitMinutesAgo: age || 0,
      openSignals: open || 0,
      claimedSignals: claimed || 0,
    };
  }
}
