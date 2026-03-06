import { useState, useEffect } from "react";
import { getCommanderLogPath, readTailLines } from "../../logging/files.js";

export function useLogTail(
  colonyRoot: string,
  maxLines = 20,
  refreshMs = 2000,
): string[] {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const poll = () => {
      const logPath = getCommanderLogPath(colonyRoot, "auto");
      setLines(readTailLines(logPath, maxLines));
    };

    poll();
    const timer = setInterval(poll, refreshMs);
    return () => clearInterval(timer);
  }, [colonyRoot, maxLines, refreshMs]);

  return lines;
}
