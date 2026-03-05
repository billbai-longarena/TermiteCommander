import { useState, useEffect } from "react";
import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";

export function useLogTail(
  colonyRoot: string,
  maxLines = 8,
  refreshMs = 2000,
): string[] {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const logPath = join(colonyRoot, ".commander.log");

    const poll = () => {
      try {
        if (!existsSync(logPath)) {
          setLines([]);
          return;
        }
        const stat = statSync(logPath);
        if (stat.size === 0) {
          setLines([]);
          return;
        }
        const readSize = Math.min(stat.size, 4096);
        const fd = openSync(logPath, "r");
        const buffer = Buffer.alloc(readSize);
        readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
        closeSync(fd);
        const text = buffer.toString("utf-8");
        const allLines = text.split("\n").filter(Boolean);
        setLines(allLines.slice(-maxLines));
      } catch {
        // File might be locked or not exist
      }
    };

    poll();
    const timer = setInterval(poll, refreshMs);
    return () => clearInterval(timer);
  }, [colonyRoot, maxLines, refreshMs]);

  return lines;
}
