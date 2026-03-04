// commander/src/colony/signal-bridge.ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

export class SignalBridge {
  readonly colonyRoot: string;
  private scriptsDir: string;

  constructor(colonyRoot: string) {
    this.colonyRoot = colonyRoot;
    this.scriptsDir = join(colonyRoot, "scripts");
  }

  hasScripts(): boolean {
    return existsSync(this.scriptsDir);
  }

  async exec(command: string, args: string[] = [], cwd?: string): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: cwd ?? this.colonyRoot,
        timeout: 30_000,
        env: { ...process.env, COLONY_ROOT: this.colonyRoot },
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

  async status(): Promise<ColonyStatus> {
    const result = await this.exec("bash", [
      "-c",
      `source ${join(this.scriptsDir, "termite-db.sh")} && db_init "${this.colonyRoot}" && echo "$(db_signal_count "status='open'")|$(db_signal_count "status='claimed'")|$(db_signal_count "status IN ('done','completed')")|$(db_signal_count)"`,
    ]);

    if (result.exitCode !== 0) {
      return { total: 0, open: 0, claimed: 0, done: 0, blocked: 0 };
    }

    const [open, claimed, done, total] = result.stdout.split("|").map(Number);
    return {
      total: total || 0,
      open: open || 0,
      claimed: claimed || 0,
      done: done || 0,
      blocked: 0,
    };
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
  }): Promise<ExecResult> {
    const script = `
      source ${join(this.scriptsDir, "termite-db.sh")}
      db_init "${this.colonyRoot}"
      ID=$(db_next_signal_id S)
      db_signal_create "$ID" "${params.type}" "$(db_escape "${params.title}")" "open" "${params.weight}" "14" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "commander" "${params.module || ""}" "[]" "$(db_escape "${params.nextHint || ""}")" "0" "${params.source}" "${params.parentId || ""}" "$(db_escape "${params.childHint || ""}")" "${params.parentId ? 1 : 0}"
    `;
    return this.exec("bash", ["-c", script]);
  }

  async checkStall(sinceMinutes: number): Promise<StallStatus> {
    const script = `
      source ${join(this.scriptsDir, "termite-db.sh")}
      db_init "${this.colonyRoot}"
      LAST_COMMIT=$(git -C "${this.colonyRoot}" log -1 --format=%ct 2>/dev/null || echo 0)
      NOW=$(date +%s)
      AGE=$(( (NOW - LAST_COMMIT) / 60 ))
      OPEN=$(db_signal_count "status='open'")
      CLAIMED=$(db_signal_count "status='claimed'")
      echo "$AGE|$OPEN|$CLAIMED"
    `;
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
