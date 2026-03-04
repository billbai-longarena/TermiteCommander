import React from "react";
import { Box, Text } from "ink";
import { ProgressBar } from "./ProgressBar.js";
import { WorkerStatus } from "./WorkerStatus.js";
import { ActivityFeed } from "./ActivityFeed.js";
import { formatDuration, formatTimeAgo } from "../utils/formatters.js";
import type { ColonyState } from "../hooks/useColonyState.js";

interface DashboardProps {
  colonyState: ColonyState;
  colonyRoot: string;
}

export function Dashboard({ colonyState, colonyRoot }: DashboardProps) {
  const { status, lockData, statusData, isRunning } = colonyState;

  const colonyName = colonyRoot.split("/").pop() ?? colonyRoot;
  const stateLabel = isRunning ? "RUNNING" : lockData ? "STALE LOCK" : "STOPPED";
  const stateColor = isRunning ? "green" : "red";

  // Calculate duration if running
  let durationStr = "";
  if (lockData?.startedAt) {
    const elapsed = Date.now() - new Date(lockData.startedAt).getTime();
    durationStr = formatDuration(elapsed);
  }

  // Build signal entries for activity feed
  const signals = statusData
    ? [] // We don't have individual signal data from status file — use counts
    : [];

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text bold>
          {" Colony: "}
          <Text color="cyan">{colonyName}</Text>
        </Text>

        {/* Status line */}
        <Box marginTop={1}>
          <Text>{"  Status      "}</Text>
          <Text color={stateColor} bold>
            {stateLabel}
          </Text>
          {durationStr && <Text dimColor>{`  (${durationStr})`}</Text>}
        </Box>

        {/* Objective */}
        {lockData?.objective && (
          <Box>
            <Text>{"  Objective   "}</Text>
            <Text>{lockData.objective}</Text>
          </Box>
        )}

        {/* Signal progress */}
        <Box marginTop={1} flexDirection="column">
          <ProgressBar
            label="Signals"
            done={status.done}
            total={status.total}
          />
        </Box>

        {/* Workers */}
        {statusData && (
          <WorkerStatus
            workers={statusData.workers}
            activeWorkers={statusData.heartbeat.activeWorkers}
            runningWorkers={statusData.heartbeat.runningWorkers}
          />
        )}

        {/* Counts summary */}
        <Box marginTop={1}>
          <Text>{"  "}</Text>
          <Text color="green">{`\u2713 done(${status.done})`}</Text>
          <Text>{"  "}</Text>
          <Text color="yellow">{`\u25CF claimed(${status.claimed})`}</Text>
          <Text>{"  "}</Text>
          <Text dimColor>{`\u25CB open(${status.open})`}</Text>
        </Box>

        {/* Last update */}
        {statusData?.updatedAt && (
          <Box marginTop={1}>
            <Text dimColor>
              {"  Updated: "}
              {formatTimeAgo(statusData.updatedAt)}
            </Text>
          </Box>
        )}
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text dimColor>
          {"  [d] dashboard  [s] signals  [w] workers  [r] repl  [q] quit"}
        </Text>
      </Box>
    </Box>
  );
}
