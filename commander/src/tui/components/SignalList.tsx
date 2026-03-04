import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../utils/formatters.js";
import type { SignalDetail } from "../../colony/signal-bridge.js";

interface SignalListProps {
  signals: SignalDetail[];
  maxItems?: number;
}

function statusIcon(status: string): { char: string; color: string } {
  switch (status) {
    case "done": case "completed": return { char: "\u2713", color: "green" };
    case "claimed": return { char: "\u25CF", color: "yellow" };
    case "open": return { char: "\u25CB", color: "gray" };
    default: return { char: "?", color: "gray" };
  }
}

export function SignalList({ signals, maxItems = 15 }: SignalListProps) {
  const display = signals.slice(0, maxItems);
  return (
    <Box flexDirection="column">
      {display.map((s) => {
        const icon = statusIcon(s.status);
        return (
          <Box key={s.id}>
            <Text>{"  "}</Text>
            <Text>{s.id.padEnd(8)}</Text>
            <Text dimColor>{s.type.padEnd(10)}</Text>
            <Text>{truncate(s.title, 30).padEnd(32)}</Text>
            <Text color={icon.color}>{`${icon.char} ${s.status}`.padEnd(12)}</Text>
            <Text dimColor>{s.claimedBy}</Text>
          </Box>
        );
      })}
      {signals.length > maxItems && (
        <Text dimColor>{`  ... and ${signals.length - maxItems} more`}</Text>
      )}
      {signals.length === 0 && <Text dimColor>{"  No signals."}</Text>}
    </Box>
  );
}
