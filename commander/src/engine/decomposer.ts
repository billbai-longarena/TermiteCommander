export interface DecomposedSignal {
  type:
    | "HOLE"
    | "EXPLORE"
    | "RESEARCH"
    | "REPORT"
    | "REVIEW"
    | "CONTENT"
    | "OUTREACH"
    | "CAMPAIGN"
    | "OPS"
    | "FEEDBACK"
    | "EXPERIMENT";
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
- ATOMIC: one clear action, one file/module/channel/system/output, completable in ~10 minutes
- SELF-CONTAINED: title + nextHint must contain ALL context needed (file paths, audience, channel, system name, expected behavior, metric, or output format)
- VERIFIABLE: explicit acceptance criteria the model can check itself
- SPECIFIC SURFACE: always specify the exact file path, workstream, audience, channel, or system surface
- MAX DEPTH 3: keep dependencies flat, maximize parallelism (parentId: null)

Signal types:
- HOLE: write or modify code/config/docs in a concrete file or technical surface
- EXPLORE: inspect existing code or workflow before acting
- RESEARCH: gather facts, sources, comparisons, or raw evidence
- REPORT: synthesize findings into a report, brief, plan, or summary
- REVIEW: validate quality, risk, compliance, or readiness
- CONTENT: draft messaging, copy, launch assets, or customer-facing content
- OUTREACH: prepare a scoped outbound or follow-up artifact for human review
- CAMPAIGN: define or update a marketing experiment or launch checklist
- OPS: execute or document an operational triage / maintenance / coordination task
- FEEDBACK: cluster or summarize user feedback into actionable themes
- EXPERIMENT: define a measurable hypothesis, metric, and treatment

Task-type guidance:
- BUILD: prefer HOLE / EXPLORE / REVIEW with exact file paths and validation steps
- RESEARCH: prefer RESEARCH / REPORT / REVIEW with source expectations and deliverable audience
- MARKET: prefer CONTENT / CAMPAIGN / REVIEW with channel, target segment, and KPI
- SALES: prefer RESEARCH / OUTREACH / REVIEW with segment, account, or sequence goal
- OPERATE: prefer OPS / REPORT / REVIEW with queue, runbook, KPI, or owner
- ITERATE: prefer FEEDBACK / EXPERIMENT / HOLE / CONTENT with feedback source and success metric
- HYBRID: combine only the minimum required signal types and keep cross-domain dependencies explicit

Weight: 70-90 for directive signals (higher = more urgent)

BAD signal (too vague for weak model):
  "Implement authentication" — weak model won't know where to start

GOOD signal (atomic, self-contained):
  title: "Create src/middleware/auth.ts: JWT verification middleware"
  nextHint: "Create file src/middleware/auth.ts. Import jsonwebtoken. Export function verifyToken(req, res, next) that reads Authorization header, verifies JWT with process.env.JWT_SECRET, calls next() on success or res.status(401).json({error:'unauthorized'}) on failure."
  acceptanceCriteria: "File exists, exports verifyToken, has basic test"

GOOD non-code signal:
  title: "Draft Product Hunt launch page copy for technical founders"
  nextHint: "Create a markdown brief for the Product Hunt launch page. Audience: technical founders evaluating AI developer tools. Include tagline, 5 bullet benefits, maker comment draft, and 3 proof points grounded in the provided context."
  acceptanceCriteria: "Brief exists, all requested sections are present, claims stay within provided context"

Output as JSON array:
[
  {
    "type": "HOLE",
    "title": "Brief but specific description with file path",
    "weight": 80,
    "parentId": null,
    "module": "relevant/path/or/workstream",
    "nextHint": "Detailed step-by-step instructions for a weak model",
    "acceptanceCriteria": "How to verify this is done"
  }
]

Respond with ONLY the JSON array.`;
  }
}
