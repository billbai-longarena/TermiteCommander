import React from "react";
import { Box, Text } from "ink";
import { formatProgressBar, formatPercent } from "../utils/formatters.js";

interface ProgressBarProps {
  label: string;
  done: number;
  total: number;
  width?: number;
}

export function ProgressBar({ label, done, total, width = 24 }: ProgressBarProps) {
  const bar = formatProgressBar(done, total, width);
  const pct = formatPercent(done, total);

  return (
    <Box>
      <Text>{"  "}</Text>
      <Text>{label.padEnd(12)}</Text>
      <Text color="green">{bar}</Text>
      <Text>{` ${done}/${total} (${pct})`}</Text>
    </Box>
  );
}
