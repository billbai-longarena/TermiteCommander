export interface DecomposedSignal {
  type: "HOLE" | "EXPLORE" | "REPORT" | "REVIEW";
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
    designContext: string,
  ): string {
    return `You are decomposing a task into atomic signals that WEAK language models (haiku-class) can execute.

Objective: ${objective}
Task Type: ${taskType}

Design Context:
${designContext}

CRITICAL: Each signal must be completable by a weak model in a single session.

Signal Standards for Weak Models:
- ATOMIC: one clear action, one file/module, completable in ~10 minutes
- SELF-CONTAINED: title + nextHint must contain ALL context needed (file paths, function names, expected behavior)
- VERIFIABLE: explicit acceptance criteria the model can check itself
- SPECIFIC PATHS: always specify exact file paths, don't let the model guess
- MAX DEPTH 3: keep dependencies flat, maximize parallelism (parentId: null)

Signal types: HOLE (write/modify code), EXPLORE (investigate code), REPORT (write docs), REVIEW (check quality)
Weight: 70-90 for directive signals (higher = more urgent)

BAD signal (too vague for weak model):
  "Implement authentication" — weak model won't know where to start

GOOD signal (atomic, self-contained):
  title: "Create src/middleware/auth.ts: JWT verification middleware"
  nextHint: "Create file src/middleware/auth.ts. Import jsonwebtoken. Export function verifyToken(req, res, next) that reads Authorization header, verifies JWT with process.env.JWT_SECRET, calls next() on success or res.status(401).json({error:'unauthorized'}) on failure."
  acceptanceCriteria: "File exists, exports verifyToken, has basic test"

Output as JSON array:
[
  {
    "type": "HOLE",
    "title": "Brief but specific description with file path",
    "weight": 80,
    "parentId": null,
    "module": "relevant/path/",
    "nextHint": "Detailed step-by-step instructions for a weak model",
    "acceptanceCriteria": "How to verify this is done"
  }
]

Respond with ONLY the JSON array.`;
  }
}
