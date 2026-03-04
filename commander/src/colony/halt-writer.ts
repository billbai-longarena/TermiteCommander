export interface HaltInfo {
  reason: "complete" | "stall" | "commander_stall" | "colony_stall";
  commanderCycles: number;
  colonyCycles: number;
  signalsTotal: number;
  signalsCompleted: number;
  remainingSignals: string[];
  lastCommitHash: string;
  lastCommitAge: string;
  lastSignalChange: string;
  recommendation: string;
}

export class HaltWriter {
  static render(info: HaltInfo): string {
    const now = new Date().toISOString();
    const remaining =
      info.remainingSignals.length > 0
        ? info.remainingSignals.join(", ")
        : "None";

    return `# Colony Halted

- **Time**: ${now}
- **Reason**: ${info.reason}
- **Commander cycles**: ${info.commanderCycles}
- **Colony cycles**: ${info.colonyCycles}

## Signal Summary
- Total: ${info.signalsTotal}
- Completed: ${info.signalsCompleted}
- Remaining open: ${remaining}

## Last Progress
- Last commit: ${info.lastCommitHash} (${info.lastCommitAge})
- Last signal state change: ${info.lastSignalChange}

## Recommendation
${info.recommendation}

## To Resume
Edit DIRECTIVE.md with new instructions, or run:
\`\`\`
commander resume
\`\`\`
`;
  }

  static async writeToDisk(info: HaltInfo, colonyRoot: string): Promise<string> {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const content = this.render(info);
    const path = join(colonyRoot, "HALT.md");
    await writeFile(path, content, "utf-8");
    return path;
  }
}
