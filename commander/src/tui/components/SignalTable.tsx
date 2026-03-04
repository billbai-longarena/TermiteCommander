import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../utils/formatters.js";

interface SignalEntry {
  id: string;
  type: string;
  title: string;
  status: string;
  worker?: string;
  duration?: string;
}

interface SignalTableProps {
  signals: SignalEntry[];
}

function statusDisplay(status: string): { icon: string; color: string } {
  switch (status) {
    case "done":
    case "completed":
      return { icon: "\u2713 done", color: "green" };
    case "claimed":
      return { icon: "\u25CF claimed", color: "yellow" };
    case "open":
      return { icon: "\u25CB open", color: "gray" };
    case "blocked":
      return { icon: "\u2298 blocked", color: "red" };
    default:
      return { icon: status, color: "gray" };
  }
}

export function SignalTable({ signals }: SignalTableProps) {
  return (
    <Box flexDirection="column">
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text bold>{" Signals"}</Text>
        <Box marginTop={1}>
          <Text bold>
            {"  "}
            {"ID".padEnd(8)}
            {"Type".padEnd(10)}
            {"Title".padEnd(30)}
            {"Status".padEnd(12)}
            {"Worker"}
          </Text>
        </Box>
        <Text>{"  " + "\u2500".repeat(72)}</Text>
        {signals.map((s) => {
          const st = statusDisplay(s.status);
          return (
            <Box key={s.id}>
              <Text>{"  "}</Text>
              <Text>{s.id.padEnd(8)}</Text>
              <Text dimColor>{s.type.padEnd(10)}</Text>
              <Text>{truncate(s.title, 28).padEnd(30)}</Text>
              <Text color={st.color}>{st.icon.padEnd(12)}</Text>
              <Text dimColor>{s.worker ?? ""}</Text>
            </Box>
          );
        })}
        {signals.length === 0 && (
          <Text dimColor>{"  No signals found."}</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {"  [d] dashboard  [s] signals  [w] workers  [r] repl  [q] quit"}
        </Text>
      </Box>
    </Box>
  );
}
