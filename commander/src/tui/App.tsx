import React from "react";
import { Box } from "ink";
import { MonitorApp } from "./MonitorApp.js";
import { resolve } from "node:path";

interface AppProps {
  colonyRoot: string;
}

export function App({ colonyRoot }: AppProps) {
  return (
    <Box flexDirection="column">
      <MonitorApp colonyRoot={resolve(colonyRoot)} />
    </Box>
  );
}
