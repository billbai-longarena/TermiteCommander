import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface PlanningProgressProps {
  phase: number;
  messages: string[];
  error: string | null;
}

const PHASES = [
  { label: "Task Classification", key: "classify" },
  { label: "Research", key: "research" },
  { label: "Scenario Simulation", key: "simulate" },
  { label: "Architecture Design", key: "design" },
  { label: "Signal Decomposition", key: "decompose" },
  { label: "Quality Criteria", key: "quality" },
];

export function PlanningProgress({
  phase,
  messages,
  error,
}: PlanningProgressProps) {
  if (phase < 0) return null;

  return (
    <Box flexDirection="column" marginY={1}>
      {PHASES.map((p, i) => {
        let icon: React.ReactNode;
        let color: string;

        if (i < phase) {
          icon = <Text color="green">{"✓"}</Text>;
          color = "green";
        } else if (i === phase && !error) {
          icon = (
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
          );
          color = "yellow";
        } else {
          icon = <Text dimColor>{"○"}</Text>;
          color = "gray";
        }

        return (
          <Box key={p.key}>
            <Text>{"  "}</Text>
            {icon}
            <Text color={color}>{` [Phase ${i}] ${p.label}`}</Text>
          </Box>
        );
      })}

      {error && (
        <Box marginTop={1}>
          <Text color="red">{"  Error: "}{error}</Text>
        </Box>
      )}

      {/* Show last few log messages */}
      {messages.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {messages.slice(-3).map((msg, i) => (
            <Text key={i} dimColor wrap="truncate-end">
              {"  "}{msg}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
