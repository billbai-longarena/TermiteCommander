import React from "react";
import { Box, Text } from "ink";
import { useColonyState } from "./hooks/useColonyState.js";
import { useGitCommits } from "./hooks/useGitCommits.js";
import { ProgressBar } from "./components/ProgressBar.js";
import { SignalList } from "./components/SignalList.js";
import { CommitFeed } from "./components/CommitFeed.js";
import { WorkerTable } from "./components/WorkerTable.js";
import { formatDuration, formatTimeAgo } from "./utils/formatters.js";

interface MonitorAppProps {
  colonyRoot: string;
}

export function MonitorApp({ colonyRoot }: MonitorAppProps) {
  const colony = useColonyState(colonyRoot);
  const commits = useGitCommits(colonyRoot);

  const { status, signals, lockData, statusData, isRunning } = colony;

  const colonyName = colonyRoot.split("/").pop() ?? colonyRoot;

  // State label with stale detection
  let stateLabel: string;
  let stateColor: string;
  if (isRunning) {
    stateLabel = "RUNNING";
    stateColor = "green";
  } else if (lockData) {
    stateLabel = "STALE (Commander exited, run 'termite-commander stop' to clean up)";
    stateColor = "red";
  } else if (status.total > 0) {
    stateLabel = "IDLE (colony has signals)";
    stateColor = "yellow";
  } else {
    stateLabel = "IDLE";
    stateColor = "gray";
  }

  // Duration since commander started
  let durationStr = "";
  if (lockData?.startedAt) {
    const elapsed = Date.now() - new Date(lockData.startedAt).getTime();
    durationStr = formatDuration(elapsed);
  }

  // Workers from status file — mark as dead if Commander is not running
  const rawWorkers = statusData?.workers ?? [];
  const workers = rawWorkers.map((w) => ({
    ...w,
    status: isRunning ? w.status : ("dead" as const),
  }));

  // Model info from status file (models section added in v2)
  const modelsInfo = (statusData as any)?.models;
  const commanderModel = modelsInfo?.commander ?? "";
  const workersFleetStr = modelsInfo?.workers ?? "";

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Box>
          <Text bold>
            {" Colony: "}
            <Text color="cyan">{colonyName}</Text>
          </Text>
          <Text>{"  "}</Text>
          <Text color={stateColor} bold>
            {stateLabel}
          </Text>
          {durationStr && isRunning && (
            <Text dimColor>{`  (${durationStr})`}</Text>
          )}
        </Box>

        {/* Objective */}
        {lockData?.objective && (
          <Box>
            <Text>{"  Objective: "}</Text>
            <Text>{lockData.objective}</Text>
          </Box>
        )}

        {/* Model info — only show if we have it */}
        {commanderModel && (
          <Box>
            <Text dimColor>{"  Model: "}</Text>
            <Text>{commanderModel}</Text>
            <Text dimColor>{" (commander)"}</Text>
          </Box>
        )}
        {workersFleetStr && (
          <Box>
            <Text dimColor>{"  Workers: "}</Text>
            <Text>{workersFleetStr}</Text>
          </Box>
        )}
      </Box>

      {/* Progress */}
      <Box flexDirection="column" marginTop={1}>
        <ProgressBar
          label="Progress"
          done={status.done}
          total={status.total}
        />
        <Box>
          <Text>{"  "}</Text>
          <Text color="green">{`\u2713 done(${status.done})`}</Text>
          <Text>{"  "}</Text>
          <Text color="yellow">{`\u25CF claimed(${status.claimed})`}</Text>
          <Text>{"  "}</Text>
          <Text dimColor>{`\u25CB open(${status.open})`}</Text>
        </Box>
        {statusData?.updatedAt && (
          <Box>
            <Text dimColor>
              {"  Last heartbeat: "}
              {formatTimeAgo(statusData.updatedAt)}
            </Text>
          </Box>
        )}
      </Box>

      {/* Signal list */}
      {(signals.length > 0 || status.total > 0) && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{" Signals"}</Text>
          {signals.length > 0 ? (
            <SignalList signals={signals} />
          ) : (
            <Text dimColor>
              {"  "}
              {status.total} signals in DB (detail query unavailable)
            </Text>
          )}
        </Box>
      )}

      {/* Recent commits */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{" Recent Commits"}</Text>
        <CommitFeed commits={commits} />
      </Box>

      {/* Workers — only show if there are any */}
      {workers.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{" Workers"}</Text>
          <WorkerTable workers={workers} />
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          {"  Ctrl+C to exit | /commander in Claude Code/OpenCode to control"}
        </Text>
      </Box>

      {/* Error */}
      {colony.error && (
        <Box marginTop={1}>
          <Text color="red">{"  Error: "}{colony.error}</Text>
        </Box>
      )}
    </Box>
  );
}
