import React from "react";
import { Box, Text } from "ink";
import { formatDuration, truncate } from "../utils/formatters.js";
import type { WorkerData } from "../utils/colonyReader.js";

interface WorkerTableProps {
  workers: WorkerData[];
  termWidth?: number;
}

function statusDisplay(status: string): { color: string; icon: string } {
  switch (status) {
    case "running":
      return { color: "green", icon: "\u25CF" };
    case "idle":
      return { color: "yellow", icon: "\u25CB" };
    case "errored":
      return { color: "red", icon: "\u2717" };
    case "dead":
      return { color: "gray", icon: "\u2620" };
    default:
      return { color: "gray", icon: "?" };
  }
}

export function WorkerTable({ workers, termWidth = 80 }: WorkerTableProps) {
  // Dynamic column widths: padding(2) + id + status(12) + model + session + duration(10)
  const fixedCols = 2 + 12 + 10; // padding + status + duration
  const flexSpace = Math.max(40, termWidth - fixedCols);
  const idW = Math.max(10, Math.floor(flexSpace * 0.2));
  const modelW = Math.max(10, Math.floor(flexSpace * 0.3));
  const sessionW = Math.max(10, Math.floor(flexSpace * 0.5));
  const lineWidth = Math.max(40, termWidth - 4);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>
          {"  "}
          {"ID".padEnd(idW)}
          {"Status".padEnd(12)}
          {"Model".padEnd(modelW)}
          {"Session".padEnd(sessionW)}
          {"Duration"}
        </Text>
      </Box>
      <Text>{"  " + "\u2500".repeat(lineWidth)}</Text>
      {workers.map((w) => {
        const st = statusDisplay(w.status);
        const sessionStr = w.sessionId
          ? truncate(w.sessionId, sessionW - 4)
          : "\u2014";
        const dur = w.startedAt
          ? formatDuration(Date.now() - new Date(w.startedAt).getTime())
          : "\u2014";
        const model = (w as any).model ?? "\u2014";
        return (
          <Box key={w.id}>
            <Text>{"  "}</Text>
            <Text>{truncate(w.id, idW - 2).padEnd(idW)}</Text>
            <Text color={st.color}>
              {`${st.icon} ${w.status}`.padEnd(12)}
            </Text>
            <Text dimColor>{truncate(model, modelW - 2).padEnd(modelW)}</Text>
            <Text dimColor>{sessionStr.padEnd(sessionW)}</Text>
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
