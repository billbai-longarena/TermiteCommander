import type { TaskType } from "../engine/classifier.js";
import type { SignalExecutionMetadata } from "../execution/contract.js";

export interface SignalEntry {
  id: string;
  type: string;
  title: string;
  weight: number;
  parentId: string | null;
  status: string;
  module: string;
  nextHint: string;
  acceptanceCriteria: string;
  execution: SignalExecutionMetadata;
}

export interface Plan {
  objective: string;
  taskType: TaskType;
  audience: string;
  researchFindings: string;
  userScenarios: string;
  architecture: string | null;
  synthesis: string | null;
  signals: SignalEntry[];
  qualityCriteria: string;
  deliverableFormat: string;
}

export class PlanWriter {
  static render(plan: Plan): string {
    const sections: string[] = [];

    sections.push(`# Plan: ${plan.objective.slice(0, 80)}\n`);
    sections.push(`## Objective\n\n${plan.objective}\n`);
    sections.push(`## Task Type\n\n${plan.taskType}\n`);
    sections.push(`## Audience\n\n${plan.audience}\n`);
    sections.push(`## Research Findings\n\n${plan.researchFindings}\n`);
    sections.push(`## User Scenarios\n\n${plan.userScenarios}\n`);

    if (plan.architecture) {
      sections.push(`## Architecture\n\n${plan.architecture}\n`);
    }
    if (plan.synthesis) {
      sections.push(`## Synthesis\n\n${plan.synthesis}\n`);
    }

    sections.push(this.renderSignalMap(plan.signals));
    sections.push(`## Quality Criteria\n\n${plan.qualityCriteria}\n`);
    sections.push(`## Deliverable Format\n\n${plan.deliverableFormat}\n`);
    sections.push(`## Execution Status\n\n_Pending — signals not yet dispatched._\n`);

    return sections.join("\n");
  }

  private static renderSignalMap(signals: SignalEntry[]): string {
    if (signals.length === 0) {
      return "## Signal Map\n\n_No signals generated yet._\n";
    }

    const lines = ["## Signal Map\n"];
    const roots = signals.filter((s) => !s.parentId);
    const children = signals.filter((s) => s.parentId);

    for (const root of roots) {
      lines.push(`- **${root.id}** [${root.type}] ${root.title} (weight: ${root.weight}, status: ${root.status})`);
      lines.push(`  - module: ${root.module || "-"}`);
      lines.push(
        `  - execution: adapter=${root.execution.adapter} class=${root.execution.executionClass} policy=${root.execution.policy.status} target=${root.execution.target}`,
      );
      for (const child of children.filter((c) => c.parentId === root.id)) {
        lines.push(`  - **${child.id}** [${child.type}] ${child.title} (weight: ${child.weight}, status: ${child.status})`);
        lines.push(`    - module: ${child.module || "-"}`);
        lines.push(
          `    - execution: adapter=${child.execution.adapter} class=${child.execution.executionClass} policy=${child.execution.policy.status} target=${child.execution.target}`,
        );
      }
    }
    lines.push("");
    return lines.join("\n");
  }

  static async writeToDisk(plan: Plan, colonyRoot: string): Promise<string> {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const content = this.render(plan);
    const path = join(colonyRoot, "PLAN.md");
    await writeFile(path, content, "utf-8");
    return path;
  }
}
