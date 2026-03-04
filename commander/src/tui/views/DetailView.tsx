import React from "react";
import { Box } from "ink";
import { SignalTable } from "../components/SignalTable.js";
import { WorkerTable } from "../components/WorkerTable.js";
import { CommandPrompt } from "../components/CommandPrompt.js";
import { useColonyState } from "../hooks/useColonyState.js";
import { parseCommand } from "../utils/commandParser.js";

interface DetailViewProps {
  mode: "signals" | "workers";
  colonyRoot: string;
  onViewChange: (view: "repl" | "dashboard" | "signals" | "workers") => void;
  onQuit: () => void;
}

export function DetailView({
  mode,
  colonyRoot,
  onViewChange,
  onQuit,
}: DetailViewProps) {
  const colonyState = useColonyState(colonyRoot, 2000);

  // Build signal list from status data
  // Note: The current status file only has counts, not individual signals.
  // For a full signal list, we would need to query the DB directly.
  // For now, show what we have from the status file.
  const signals = colonyState.statusData
    ? Array.from({ length: colonyState.status.total }, (_, i) => {
        const id = `S-${String(i + 1).padStart(3, "0")}`;
        let status = "open";
        if (i < colonyState.status.done) status = "done";
        else if (i < colonyState.status.done + colonyState.status.claimed)
          status = "claimed";
        return { id, type: "—", title: "—", status };
      })
    : [];

  const workers = colonyState.statusData?.workers ?? [];

  const handleSubmit = (input: string) => {
    const cmd = parseCommand(input);
    switch (cmd.type) {
      case "quit":
        onQuit();
        return;
      case "view":
        onViewChange(cmd.target as any);
        return;
      default:
        onViewChange("repl");
        return;
    }
  };

  return (
    <Box flexDirection="column">
      {mode === "signals" ? (
        <SignalTable signals={signals} />
      ) : (
        <WorkerTable workers={workers} />
      )}
      <Box marginTop={1}>
        <CommandPrompt onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
}
