import React from "react";
import { Box, Text } from "ink";

interface ActivityLogProps {
  lines: string[];
}

export function ActivityLog({ lines }: ActivityLogProps) {
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Box key={i}>
          <Text>{"  "}</Text>
          <Text dimColor wrap="truncate-end">{line}</Text>
        </Box>
      ))}
      {lines.length === 0 && (
        <Text dimColor>{"  Waiting for activity..."}</Text>
      )}
    </Box>
  );
}
