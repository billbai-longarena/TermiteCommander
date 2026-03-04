import React from "react";
import { render } from "ink";
import { App } from "./App.js";

export async function startTUI(colonyRoot: string): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error(
      "termite-commander TUI requires an interactive terminal.\n" +
        "Use 'termite-commander plan <objective> --colony .' for non-interactive mode.",
    );
    process.exit(1);
  }

  const { waitUntilExit } = render(<App colonyRoot={colonyRoot} />);

  await waitUntilExit();
}
