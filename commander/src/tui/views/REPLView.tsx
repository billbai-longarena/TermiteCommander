import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { CommandPrompt } from "../components/CommandPrompt.js";
import { PlanningProgress } from "../components/PlanningProgress.js";
import { parseCommand } from "../utils/commandParser.js";
import { usePipelineStreaming } from "../hooks/usePipelineStreaming.js";
import { useColonyState } from "../hooks/useColonyState.js";
import { isCommanderRunning } from "../utils/colonyReader.js";
import type { PipelineConfig } from "../../engine/pipeline.js";

interface REPLViewProps {
  colonyRoot: string;
  pipelineConfig: PipelineConfig;
  onViewChange: (view: "dashboard" | "signals" | "workers") => void;
  onQuit: () => void;
}

interface HistoryEntry {
  input: string;
  output: string;
}

export function REPLView({
  colonyRoot,
  pipelineConfig,
  onViewChange,
  onQuit,
}: REPLViewProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const colonyState = useColonyState(colonyRoot, 5000);
  const streaming = usePipelineStreaming(pipelineConfig);

  const addOutput = useCallback((input: string, output: string) => {
    setHistory((prev) => [...prev.slice(-20), { input, output }]);
  }, []);

  const handleSubmit = useCallback(
    async (input: string) => {
      const cmd = parseCommand(input);

      switch (cmd.type) {
        case "quit":
          onQuit();
          return;

        case "help":
          addOutput(input, [
            "Commands:",
            "  <objective>     Plan and execute an objective",
            "  plan <text>     Explicitly plan an objective",
            "  status          Show colony status",
            "  stop            Stop Commander",
            "  workers         Show worker status",
            "  resume          Resume from halt",
            "  dashboard       Switch to dashboard view",
            "  signals         Switch to signal list view",
            "  help            Show this help",
            "  quit            Exit",
          ].join("\n"));
          return;

        case "status": {
          const { status, lockData, isRunning } = colonyState;
          const running = isRunning ? `YES (PID ${lockData?.pid})` : "NO";
          addOutput(
            input,
            [
              `Commander: ${running}`,
              lockData ? `  Objective: ${lockData.objective}` : "",
              `Signals: total=${status.total} open=${status.open} claimed=${status.claimed} done=${status.done}`,
            ]
              .filter(Boolean)
              .join("\n"),
          );
          return;
        }

        case "stop": {
          if (!isCommanderRunning(colonyRoot)) {
            addOutput(input, "Commander is not running.");
            return;
          }
          const { lockData } = colonyState;
          if (lockData) {
            try {
              process.kill(lockData.pid, "SIGTERM");
              addOutput(input, `SIGTERM sent to PID ${lockData.pid}.`);
            } catch {
              addOutput(input, "Failed to stop Commander.");
            }
          }
          return;
        }

        case "workers": {
          const { statusData } = colonyState;
          if (!statusData || statusData.workers.length === 0) {
            addOutput(input, "No workers found.");
            return;
          }
          const lines = statusData.workers.map(
            (w) =>
              `  ${w.id.slice(0, 12).padEnd(14)} ${w.status.padEnd(10)} ${(w.sessionId ?? "-").slice(0, 16)}`,
          );
          addOutput(input, `Workers (${statusData.workers.length}):\n${lines.join("\n")}`);
          return;
        }

        case "resume":
          addOutput(input, "Resume: Use 'termite-commander resume' CLI command.");
          return;

        case "watch":
          addOutput(input, "Switching to dashboard view...");
          onViewChange("dashboard");
          return;

        case "view":
          onViewChange(cmd.target as "dashboard" | "signals" | "workers");
          return;

        case "plan": {
          addOutput(input, `Planning: "${cmd.objective}"`);
          const plan = await streaming.executePlan(cmd.objective, cmd.run);
          if (plan) {
            onViewChange("dashboard");
          }
          return;
        }
      }
    },
    [colonyState, colonyRoot, streaming, addOutput, onViewChange, onQuit],
  );

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" paddingX={1}>
        <Text bold color="cyan">
          Termite Commander v0.1.0
        </Text>
        <Text dimColor>
          {"  |  Colony: "}
          {colonyRoot.split("/").pop() ?? colonyRoot}
          {"  |  "}
          {colonyState.isRunning ? (
            <Text color="green">RUNNING</Text>
          ) : (
            <Text dimColor>IDLE</Text>
          )}
        </Text>
      </Box>

      {/* History */}
      <Box flexDirection="column" marginY={1}>
        {history.slice(-10).map((entry, i) => (
          <Box key={i} flexDirection="column">
            <Text color="green">{`> ${entry.input}`}</Text>
            <Text>{entry.output}</Text>
          </Box>
        ))}
      </Box>

      {/* Planning progress (if running) */}
      {streaming.phase >= 0 && (
        <PlanningProgress
          phase={streaming.phase}
          messages={streaming.messages}
          error={streaming.error}
        />
      )}

      {/* Input */}
      <CommandPrompt onSubmit={handleSubmit} disabled={streaming.isRunning} />

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor>
          {"  Type an objective to start planning, or 'help' for commands."}
        </Text>
      </Box>
    </Box>
  );
}
