import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { COMMANDER_EVENT_LOG } from "./files.js";

type ConsoleMethod = "log" | "info" | "warn" | "error";

export interface ConsoleCaptureHandle {
  logPath: string;
  stop: () => void;
}

function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function withRotation(logPath: string, maxBytes: number): (line: string) => void {
  const rotatedPath = `${logPath}.1`;
  let currentSize = 0;

  try {
    currentSize = existsSync(logPath) ? statSync(logPath).size : 0;
  } catch {
    currentSize = 0;
  }

  return (line: string) => {
    try {
      const bytes = Buffer.byteLength(line);
      if (currentSize + bytes > maxBytes) {
        try {
          if (existsSync(rotatedPath)) {
            unlinkSync(rotatedPath);
          }
        } catch {
          // ignore stale rotated log cleanup errors
        }

        try {
          if (existsSync(logPath)) {
            renameSync(logPath, rotatedPath);
          }
        } catch {
          // ignore rotation errors and continue appending
        }
        currentSize = 0;
      }

      appendFileSync(logPath, line, "utf-8");
      currentSize += bytes;
    } catch {
      // best-effort logging, never throw into command flow
    }
  };
}

export function startConsoleCapture(
  colonyRoot: string,
  opts?: { maxBytes?: number },
): ConsoleCaptureHandle {
  const maxBytes = opts?.maxBytes ?? 2 * 1024 * 1024;
  const logPath = join(colonyRoot, COMMANDER_EVENT_LOG);
  const appendLine = withRotation(logPath, maxBytes);

  const methods: ConsoleMethod[] = ["log", "info", "warn", "error"];
  const originals: Record<ConsoleMethod, (...args: unknown[]) => void> = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  let stopped = false;

  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      const level = method.toUpperCase();
      const payload = args.map(formatArg).join(" ");
      appendLine(`[${new Date().toISOString()}] [${level}] ${payload}\n`);
      originals[method](...args);
    };
  }

  return {
    logPath,
    stop: () => {
      if (stopped) return;
      stopped = true;
      for (const method of methods) {
        console[method] = originals[method] as typeof console[ConsoleMethod];
      }
    },
  };
}
