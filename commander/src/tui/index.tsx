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

  // Enter alternate screen buffer (like vim/htop)
  process.stdout.write("\x1B[?1049h");
  process.stdout.write("\x1B[H"); // Move cursor to top-left

  const { waitUntilExit } = render(<App colonyRoot={colonyRoot} />);

  try {
    await waitUntilExit();
  } finally {
    // Exit alternate screen buffer
    process.stdout.write("\x1B[?1049l");
  }
}
