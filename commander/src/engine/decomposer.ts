export interface DecomposedSignal {
  type: "HOLE" | "EXPLORE" | "RESEARCH" | "REPORT" | "REVIEW" | "FEEDBACK";
  title: string;
  weight: number;
  source: "directive" | "autonomous";
  parentId: string | null;
  childHint: string | null;
  module: string;
  nextHint: string;
  acceptanceCriteria: string;
}

const MAX_DEPTH = 3;

export class SignalDecomposer {
  static validate(signal: DecomposedSignal): boolean {
    if (!signal.title || signal.title.trim().length === 0) return false;
    if (signal.weight < 0 || signal.weight > 100) return false;
    return true;
  }

  static validateTree(signals: DecomposedSignal[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Assign temporary IDs for depth calculation
    const tempIds = signals.map((_, i) => `S-${String(i + 1).padStart(3, "0")}`);

    // Build parentId -> index mapping
    for (let i = 0; i < signals.length; i++) {
      const signal = signals[i];
      if (!signal.parentId) continue;

      // Calculate depth by walking up parent chain
      let depth = 0;
      let currentParentId: string | null = signal.parentId;
      const visited = new Set<string>();

      while (currentParentId) {
        if (visited.has(currentParentId)) {
          errors.push(`Circular dependency detected at: ${signal.title}`);
          break;
        }
        visited.add(currentParentId);
        depth++;

        // Find parent index
        const parentIdx = tempIds.indexOf(currentParentId);
        if (parentIdx === -1) break;
        currentParentId = signals[parentIdx].parentId;
      }

      if (depth >= MAX_DEPTH) {
        errors.push(`Signal depth exceeds maximum of ${MAX_DEPTH}: ${signal.title}`);
      }
    }

    // Validate each signal individually
    for (const signal of signals) {
      if (!this.validate(signal)) {
        errors.push(`Invalid signal: ${signal.title || "(empty title)"}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static topologicalSort(signals: DecomposedSignal[]): DecomposedSignal[] {
    const roots = signals.filter((s) => !s.parentId);
    const children = signals.filter((s) => s.parentId);
    return [...roots, ...children];
  }

  static buildDecompositionPrompt(
    objective: string,
    taskType: string,
    researchFindings: string,
  ): string {
    return `You are a software architect decomposing a task into atomic work signals.

Task Type: ${taskType}
Objective: ${objective}

Research Context:
${researchFindings}

Decompose this into a list of atomic signals. Each signal should be ONE verifiable deliverable.

Rules:
- Signal types: HOLE (code gap), EXPLORE (investigation), RESEARCH (data collection), REPORT (writing), REVIEW (quality check)
- Weight: 70-90 for directive signals (higher = more urgent)
- Max tree depth: 3
- Independent signals should have parentId: null (they can run in parallel)
- Dependent signals should reference their parent's title
- Each signal MUST have clear acceptance criteria

Output as JSON array:
[
  {
    "type": "HOLE",
    "title": "Brief, specific description",
    "weight": 80,
    "parentId": null,
    "module": "relevant/path/",
    "nextHint": "Specific next action for the termite",
    "acceptanceCriteria": "How to verify this is done"
  }
]

Respond with ONLY the JSON array, no other text.`;
  }
}
