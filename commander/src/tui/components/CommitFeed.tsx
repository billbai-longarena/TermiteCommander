import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../utils/formatters.js";
import type { GitCommit } from "../hooks/useGitCommits.js";

interface CommitFeedProps {
  commits: GitCommit[];
  termWidth?: number;
}

export function CommitFeed({ commits, termWidth = 80 }: CommitFeedProps) {
  // Dynamic message width: total - padding(2) - timeAgo(14) - hash(8) - space(1)
  const msgMaxLen = Math.max(20, termWidth - 25);
  return (
    <Box flexDirection="column">
      {commits.map((c) => (
        <Box key={c.hash}>
          <Text>{"  "}</Text>
          <Text dimColor>{c.timeAgo.padEnd(14)}</Text>
          <Text color="yellow">{c.hash} </Text>
          <Text>{truncate(c.message, msgMaxLen)}</Text>
        </Box>
      ))}
      {commits.length === 0 && <Text dimColor>{"  No commits yet."}</Text>}
    </Box>
  );
}
