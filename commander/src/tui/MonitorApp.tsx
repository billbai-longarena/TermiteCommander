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
  const stateLabel = isRunning ? "RUNNING" : lockData ? "STALE LOCK" : "IDLE";
  const stateColor = isRunning ? "green" : lockData ? "red" : "gray";

  // Duration since commander started
  let durationStr = "";
  if (lockData?.startedAt) {
    const elapsed = Date.now() - new Date(lockData.startedAt).getTime();
    durationStr = formatDuration(elapsed);
  }

  // Workers from status file
  const workers = statusData?.workers ?? [];

  // Model info from status file
  const commanderModel = statusData?.taskType ?? "unknown";

  // Build worker fleet composition string
  const modelCounts: Record<string, number> = {};
  for (const w of workers) {
    const m = (w as any).model ?? "unknown";
    modelCounts[m] = (modelCounts[m] ?? 0) + 1;
  }
  const fleetStr = Object.entries(modelCounts)
    .map(([m, n]) => `${n}x ${m}`)
    .join(", ") || "no workers";

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
          {durationStr && <Text dimColor>{`  (${durationStr})`}</Text>}
        </Box>

        {/* Objective */}
        {lockData?.objective && (
          <Box>
            <Text>{"  Objective: "}</Text>
            <Text>{lockData.objective}</Text>
          </Box>
        )}

        {/* Model info */}
        <Box>
          <Text dimColor>{"  Commander: "}</Text>
          <Text dimColor>{commanderModel}</Text>
          <Text dimColor>{"  | Fleet: "}</Text>
          <Text dimColor>{fleetStr}</Text>
        </Box>
      </Box>

      {/* Progress */}
      <Box flexDirection="column" marginTop={1}>
        <ProgressBar label="Signals" done={status.done} total={status.total} />
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
            <Text dimColor>{"  Heartbeat: "}{formatTimeAgo(statusData.updatedAt)}</Text>
          </Box>
        )}
      </Box>

      {/* Signal list */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{" Signals"}</Text>
        <SignalList signals={signals} />
      </Box>

      {/* Recent commits */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{" Recent Commits"}</Text>
        <CommitFeed commits={commits} />
      </Box>

      {/* Workers */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{" Workers"}</Text>
        <WorkerTable workers={workers} />
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          {"  Ctrl+C to exit | /commander in Claude Code/OpenCode to control"}
        </Text>
      </Box>
    </Box>
  );
}
