import React from "react";
import { Box } from "ink";
import { Dashboard } from "../components/Dashboard.js";
import { CommandPrompt } from "../components/CommandPrompt.js";
import { useColonyState } from "../hooks/useColonyState.js";
import { parseCommand } from "../utils/commandParser.js";

interface DashboardViewProps {
  colonyRoot: string;
  onViewChange: (view: "repl" | "signals" | "workers") => void;
  onQuit: () => void;
}

export function DashboardView({
  colonyRoot,
  onViewChange,
  onQuit,
}: DashboardViewProps) {
  const colonyState = useColonyState(colonyRoot, 2000);

  const handleSubmit = (input: string) => {
    const cmd = parseCommand(input);
    switch (cmd.type) {
      case "quit":
        onQuit();
        return;
      case "view":
        if (cmd.target === "repl") onViewChange("repl");
        else if (cmd.target === "signals") onViewChange("signals");
        else if (cmd.target === "workers") onViewChange("workers");
        return;
      default:
        // For other commands, switch to REPL
        onViewChange("repl");
        return;
    }
  };

  return (
    <Box flexDirection="column">
      <Dashboard colonyState={colonyState} colonyRoot={colonyRoot} />
      <Box marginTop={1}>
        <CommandPrompt onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
}
