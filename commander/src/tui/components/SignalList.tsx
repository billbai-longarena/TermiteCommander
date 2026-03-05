import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../utils/formatters.js";
import type { SignalDetail } from "../../colony/signal-bridge.js";

interface SignalListProps {
  signals: SignalDetail[];
  maxItems?: number;
  termWidth?: number;
}

function statusIcon(status: string): { char: string; color: string } {
  switch (status) {
    case "done": case "completed": return { char: "\u2713", color: "green" };
    case "claimed": return { char: "\u25CF", color: "yellow" };
    case "open": return { char: "\u25CB", color: "gray" };
    default: return { char: "?", color: "gray" };
  }
}

export function SignalList({ signals, maxItems = 15, termWidth = 80 }: SignalListProps) {
  // Dynamic title width: total - padding(2) - id(8) - type(10) - status(12) - claimedBy(~12)
  const fixedCols = 2 + 8 + 10 + 12 + 12;
  const titleMaxLen = Math.max(15, termWidth - fixedCols - 2); // -2 for padEnd gap
  const titleColW = titleMaxLen + 2;
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
            <Text>{truncate(s.title, titleMaxLen).padEnd(titleColW)}</Text>
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
