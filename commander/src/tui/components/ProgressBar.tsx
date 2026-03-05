import React from "react";
import { Box, Text } from "ink";
import { formatProgressBar, formatPercent } from "../utils/formatters.js";

interface ProgressBarProps {
  label: string;
  done: number;
  total: number;
  width?: number;
  termWidth?: number;
}

export function ProgressBar({ label, done, total, width, termWidth = 80 }: ProgressBarProps) {
  // Dynamic bar width: subtract padding(2) + label(12) + space + stats(~18)
  const barWidth = width ?? Math.max(10, Math.min(termWidth - 30, 40));
  const bar = formatProgressBar(done, total, barWidth);
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
