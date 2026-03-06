import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

export const COMMANDER_EVENT_LOG = ".commander.events.log";
export const COMMANDER_LEGACY_LOG = ".commander.log";

export function getCommanderLogPath(
  colonyRoot: string,
  preference: "auto" | "events" | "legacy" = "auto",
): string {
  const eventPath = join(colonyRoot, COMMANDER_EVENT_LOG);
  const legacyPath = join(colonyRoot, COMMANDER_LEGACY_LOG);

  if (preference === "events") return eventPath;
  if (preference === "legacy") return legacyPath;

  if (existsSync(eventPath)) return eventPath;
  return legacyPath;
}

export function readTailLines(
  filePath: string,
  maxLines: number,
  maxBytes = 64 * 1024,
): string[] {
  if (!existsSync(filePath)) return [];

  try {
    const stat = statSync(filePath);
    if (stat.size <= 0) return [];

    const readSize = Math.min(stat.size, maxBytes);
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(readSize);
    try {
      readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
    } finally {
      closeSync(fd);
    }

    const text = buffer.toString("utf-8");
    const lines = text.split("\n").filter((line) => line.trim().length > 0);
    if (maxLines <= 0) return lines;
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}
