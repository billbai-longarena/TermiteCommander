import React from "react";
import { Box, Text } from "ink";
import type { WorkerData } from "../utils/colonyReader.js";

interface WorkerStatusProps {
  workers: WorkerData[];
  activeWorkers: number;
  runningWorkers: number;
}

export function WorkerStatus({
  workers,
  activeWorkers,
  runningWorkers,
}: WorkerStatusProps) {
  const idleCount = activeWorkers - runningWorkers;

  const dots = workers.map((w) => {
    if (w.status === "running") return { char: "\u25CF", color: "green" as const };
    if (w.status === "idle") return { char: "\u25CF", color: "yellow" as const };
    if (w.status === "errored") return { char: "\u25CF", color: "red" as const };
    return { char: "\u25CB", color: "gray" as const };
  });

  return (
    <Box>
      <Text>{"  "}</Text>
      <Text>{"Workers     "}</Text>
      {dots.map((d, i) => (
        <Text key={i} color={d.color}>
          {d.char}
        </Text>
      ))}
      <Text>
        {"  "}
        {runningWorkers} running, {idleCount > 0 ? `${idleCount} idle` : "0 idle"}
      </Text>
    </Box>
  );
}
