import React from "react";
import { render } from "ink";
import { App } from "./App.js";

export async function startTUI(colonyRoot: string): Promise<void> {
  const { waitUntilExit } = render(<App colonyRoot={colonyRoot} />);

  await waitUntilExit();
}
