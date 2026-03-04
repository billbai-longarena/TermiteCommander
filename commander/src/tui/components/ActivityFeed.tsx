import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../utils/formatters.js";

interface SignalEntry {
  id: string;
  type: string;
  title: string;
  status: string;
  worker?: string;
}

interface ActivityFeedProps {
  signals: SignalEntry[];
  maxItems?: number;
}

function statusIcon(status: string): { char: string; color: string } {
  switch (status) {
    case "done":
    case "completed":
      return { char: "\u2713", color: "green" };
    case "claimed":
      return { char: "\u25CF", color: "yellow" };
    case "open":
      return { char: "\u25CB", color: "gray" };
    case "blocked":
      return { char: "\u2298", color: "red" };
    default:
      return { char: "?", color: "gray" };
  }
}

export function ActivityFeed({ signals, maxItems = 8 }: ActivityFeedProps) {
  // Sort: done first, then claimed, then open
  const sorted = [...signals].sort((a, b) => {
    const order: Record<string, number> = { done: 0, completed: 0, claimed: 1, open: 2, blocked: 3 };
    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
  });

  const display = sorted.slice(0, maxItems);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{"  Recent Activity:"}</Text>
      {display.map((s) => {
        const icon = statusIcon(s.status);
        const workerStr = s.worker ? ` (${s.worker})` : "";
        return (
          <Box key={s.id}>
            <Text>{"  "}</Text>
            <Text color={icon.color}>{icon.char}</Text>
            <Text>{` ${s.id} `}</Text>
            <Text>{truncate(s.title, 28).padEnd(28)}</Text>
            <Text dimColor>{s.status.padEnd(8)}</Text>
            <Text dimColor>{workerStr}</Text>
          </Box>
        );
      })}
      {signals.length === 0 && (
        <Text dimColor>{"  No signals yet."}</Text>
      )}
    </Box>
  );
}
