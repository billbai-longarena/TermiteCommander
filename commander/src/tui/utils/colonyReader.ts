import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LockData {
  pid: number;
  startedAt: string;
  objective: string;
}

export interface WorkerData {
  id: string;
  status: "running" | "idle" | "stopped" | "errored";
  sessionId: string | null;
  startedAt: string;
}

export interface StatusFileData {
  updatedAt: string;
  pid: number;
  objective: string;
  taskType: string;
  signals: { total: number; open: number; done: number };
  workers: WorkerData[];
  heartbeat: { activeWorkers: number; runningWorkers: number };
}

export function readLockFile(colonyRoot: string): LockData | null {
  const lockPath = join(colonyRoot, "commander.lock");
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch {
    return null;
  }
}

export function readStatusFile(colonyRoot: string): StatusFileData | null {
  const statusPath = join(colonyRoot, ".commander-status.json");
  if (!existsSync(statusPath)) return null;
  try {
    return JSON.parse(readFileSync(statusPath, "utf-8"));
  } catch {
    return null;
  }
}

export function isCommanderRunning(colonyRoot: string): boolean {
  const lock = readLockFile(colonyRoot);
  if (!lock) return false;
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}
