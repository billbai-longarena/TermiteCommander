import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../utils/formatters.js";
import type { GitCommit } from "../hooks/useGitCommits.js";

interface CommitFeedProps {
  commits: GitCommit[];
}

export function CommitFeed({ commits }: CommitFeedProps) {
  return (
    <Box flexDirection="column">
      {commits.map((c) => (
        <Box key={c.hash}>
          <Text>{"  "}</Text>
          <Text dimColor>{c.timeAgo.padEnd(14)}</Text>
          <Text color="yellow">{c.hash} </Text>
          <Text>{truncate(c.message, 50)}</Text>
        </Box>
      ))}
      {commits.length === 0 && <Text dimColor>{"  No commits yet."}</Text>}
    </Box>
  );
}
