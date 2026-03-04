import React, { useState, useCallback, useMemo } from "react";
import { Box, useApp, useInput } from "ink";
import { REPLView } from "./views/REPLView.js";
import { DashboardView } from "./views/DashboardView.js";
import { DetailView } from "./views/DetailView.js";
import { resolve } from "node:path";
import type { PipelineConfig } from "../engine/pipeline.js";

type ViewState =
  | { type: "repl" }
  | { type: "dashboard" }
  | { type: "signals" }
  | { type: "workers" };

interface AppProps {
  colonyRoot: string;
}

function detectPlatform(): "opencode" | "claude-code" | "unknown" {
  if (process.env.CLAUDE_PROJECT_DIR) return "claude-code";
  if (process.env.OPENCODE_SESSION) return "opencode";
  return "unknown";
}

export function App({ colonyRoot }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<ViewState>({ type: "repl" });

  const absColonyRoot = resolve(colonyRoot);

  const pipelineConfig = useMemo<PipelineConfig>(
    () => ({
      colonyRoot: absColonyRoot,
      platform: detectPlatform(),
      llmConfig: {
        provider:
          (process.env.COMMANDER_LLM_PROVIDER as any) ?? "azure-openai",
        model: process.env.COMMANDER_LLM_MODEL,
      },
      skillSourceDir: resolve(
        import.meta.dirname ?? ".",
        "../../skills/termite",
      ),
      maxWorkers: parseInt(process.env.COMMANDER_MAX_WORKERS ?? "3", 10),
    }),
    [absColonyRoot],
  );

  const handleViewChange = useCallback(
    (target: "repl" | "dashboard" | "signals" | "workers") => {
      setView({ type: target });
    },
    [],
  );

  const handleQuit = useCallback(() => {
    exit();
  }, [exit]);

  // Global keyboard shortcuts (only when not in text input)
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      handleQuit();
    }
  });

  return (
    <Box flexDirection="column">
      {view.type === "repl" && (
        <REPLView
          colonyRoot={absColonyRoot}
          pipelineConfig={pipelineConfig}
          onViewChange={handleViewChange}
          onQuit={handleQuit}
        />
      )}
      {view.type === "dashboard" && (
        <DashboardView
          colonyRoot={absColonyRoot}
          onViewChange={handleViewChange}
          onQuit={handleQuit}
        />
      )}
      {(view.type === "signals" || view.type === "workers") && (
        <DetailView
          mode={view.type}
          colonyRoot={absColonyRoot}
          onViewChange={handleViewChange}
          onQuit={handleQuit}
        />
      )}
    </Box>
  );
}
