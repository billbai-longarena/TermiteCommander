import React from "react";
import { Box, Text } from "ink";
import { formatDuration, truncate } from "../utils/formatters.js";
import type { WorkerData } from "../utils/colonyReader.js";

interface WorkerTableProps {
  workers: WorkerData[];
}

function statusDisplay(status: string): { color: string } {
  switch (status) {
    case "running":
      return { color: "green" };
    case "idle":
      return { color: "yellow" };
    case "errored":
      return { color: "red" };
    default:
      return { color: "gray" };
  }
}

export function WorkerTable({ workers }: WorkerTableProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>
          {"  "}
          {"ID".padEnd(14)}
          {"Status".padEnd(12)}
          {"Model".padEnd(18)}
          {"Session".padEnd(22)}
          {"Duration"}
        </Text>
      </Box>
      <Text>{"  " + "\u2500".repeat(72)}</Text>
      {workers.map((w) => {
        const st = statusDisplay(w.status);
        const sessionStr = w.sessionId
          ? truncate(w.sessionId, 18)
          : "\u2014";
        const dur = w.startedAt
          ? formatDuration(Date.now() - new Date(w.startedAt).getTime())
          : "\u2014";
        const model = (w as any).model ?? "\u2014";
        return (
          <Box key={w.id}>
            <Text>{"  "}</Text>
            <Text>{truncate(w.id, 12).padEnd(14)}</Text>
            <Text color={st.color}>
              {`\u25CF ${w.status}`.padEnd(12)}
            </Text>
            <Text dimColor>{truncate(model, 16).padEnd(18)}</Text>
            <Text dimColor>{sessionStr.padEnd(22)}</Text>
            <Text>{dur}</Text>
          </Box>
        );
      })}
      {workers.length === 0 && (
        <Text dimColor>{"  No workers found."}</Text>
      )}
    </Box>
  );
}
