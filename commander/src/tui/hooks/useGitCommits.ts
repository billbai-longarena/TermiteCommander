import { useState, useEffect } from "react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  message: string;
  timeAgo: string;
}

export function useGitCommits(colonyRoot: string, refreshMs = 5000, maxCommits = 5): GitCommit[] {
  const [commits, setCommits] = useState<GitCommit[]>([]);

  useEffect(() => {
    const poll = async () => {
      try {
        const { stdout } = await execFileAsync("git", [
          "-C", colonyRoot,
          "log", "--oneline", "--format=%h|%s|%cr",
          `-${maxCommits}`,
        ], { timeout: 5000 });
        const parsed = stdout.trim().split("\n").filter(Boolean).map((line) => {
          const [hash, ...rest] = line.split("|");
          const timeAgo = rest.pop() ?? "";
          const message = rest.join("|");
          return { hash: hash ?? "", message, timeAgo };
        });
        setCommits(parsed);
      } catch {
        // Git not available or not a repo
      }
    };
    poll();
    const timer = setInterval(poll, refreshMs);
    return () => clearInterval(timer);
  }, [colonyRoot, refreshMs, maxCommits]);

  return commits;
}
