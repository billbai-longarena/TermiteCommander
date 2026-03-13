import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { TaskType } from "../engine/classifier.js";
import type { DecomposedSignal } from "../engine/decomposer.js";
import type {
  ExecutionActionProposal,
  ExecutionActionRecord,
  ExecutionActionStatus,
  ExecutionAdapter,
  ExecutionAdapterName,
  ExecutionApplyResult,
  ExecutionClass,
  ExecutionContext,
  ExecutionPlanLike,
  ExecutionSignalLike,
  ExecutionSummary,
  SignalExecutionMetadata,
} from "./contract.js";
import { evaluateExecutionPolicy, loadExecutionPolicy } from "./policy.js";

interface StorePaths {
  root: string;
  actionsFile: string;
  proposalsDir: string;
  appliedDir: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "action";
}

function ensureStorePaths(colonyRoot: string): StorePaths {
  const root = join(colonyRoot, ".termite", "execution");
  const proposalsDir = join(root, "proposals");
  const appliedDir = join(root, "applied");
  mkdirSync(proposalsDir, { recursive: true });
  mkdirSync(appliedDir, { recursive: true });
  return {
    root,
    actionsFile: join(root, "actions.json"),
    proposalsDir,
    appliedDir,
  };
}

function readActionStore(paths: StorePaths): ExecutionActionRecord[] {
  if (!existsSync(paths.actionsFile)) return [];
  try {
    const parsed = JSON.parse(readFileSync(paths.actionsFile, "utf-8"));
    return Array.isArray(parsed) ? parsed as ExecutionActionRecord[] : [];
  } catch {
    return [];
  }
}

function writeActionStore(paths: StorePaths, actions: ExecutionActionRecord[]): void {
  writeFileSync(paths.actionsFile, JSON.stringify(actions, null, 2), "utf-8");
}

function createActionSummary(actions: ExecutionActionRecord[]): ExecutionSummary {
  const byStatus: Record<string, number> = {};
  const byClass: Record<ExecutionClass, number> = {
    internal: 0,
    proposed: 0,
    "guarded-external": 0,
  };
  const byAdapter: Record<string, number> = {};

  for (const action of actions) {
    byStatus[action.status] = (byStatus[action.status] ?? 0) + 1;
    byClass[action.executionClass] += 1;
    byAdapter[action.adapter] = (byAdapter[action.adapter] ?? 0) + 1;
  }

  return {
    total: actions.length,
    byStatus,
    byClass,
    byAdapter,
    awaitingApproval: byStatus["awaiting-approval"] ?? 0,
    ready: byStatus.ready ?? 0,
    executed: byStatus.executed ?? 0,
    blocked: byStatus.blocked ?? 0,
  };
}

class InternalAdapter implements ExecutionAdapter {
  readonly id: ExecutionAdapterName = "generic";

  async proposeAction(context: ExecutionContext): Promise<ExecutionActionProposal> {
    return {
      summary: `Route internally via colony workers: ${context.signal.title}`,
      payload: {
        mode: "internal-route",
        target: context.signal.execution.target,
      },
    };
  }
}

class ContentAdapter implements ExecutionAdapter {
  readonly id: ExecutionAdapterName = "content";

  constructor(private readonly paths: StorePaths, private readonly colonyRoot: string) {}

  async proposeAction(context: ExecutionContext): Promise<ExecutionActionProposal> {
    const filePath = join(
      this.paths.proposalsDir,
      `${context.signal.id}-${toSlug(context.signal.title)}.md`,
    );
    const content = [
      `# Proposal: ${context.signal.title}`,
      "",
      `- Objective: ${context.objective}`,
      `- Task Type: ${context.taskType}`,
      `- Adapter: ${context.signal.execution.adapter}`,
      `- Execution Class: ${context.signal.execution.executionClass}`,
      `- Target: ${context.signal.execution.target}`,
      "",
      "## Instructions",
      "",
      context.signal.nextHint || "_No instructions provided._",
      "",
      "## Acceptance Criteria",
      "",
      context.signal.acceptanceCriteria || "_No acceptance criteria provided._",
      "",
      "## Policy",
      "",
      ...context.signal.execution.policy.reasons.map((reason) => `- ${reason}`),
      "",
    ].join("\n");
    writeFileSync(filePath, content, "utf-8");
    return {
      summary: `Proposal artifact created for content workflow: ${relative(this.colonyRoot, filePath)}`,
      artifactPath: filePath,
      payload: {
        mode: "proposal-artifact",
      },
    };
  }
}

class SupportAdapter implements ExecutionAdapter {
  readonly id: ExecutionAdapterName = "support";

  constructor(private readonly paths: StorePaths, private readonly colonyRoot: string) {}

  async proposeAction(context: ExecutionContext): Promise<ExecutionActionProposal> {
    const filePath = join(
      this.paths.proposalsDir,
      `${context.signal.id}-${toSlug(context.signal.title)}.support.json`,
    );
    const payload = {
      mode: "support-triage",
      target: context.signal.execution.target,
      title: context.signal.title,
      instruction: context.signal.nextHint,
      acceptanceCriteria: context.signal.acceptanceCriteria,
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return {
      summary: `Support action prepared for review: ${relative(this.colonyRoot, filePath)}`,
      artifactPath: filePath,
      payload,
    };
  }

  async executeAction(action: ExecutionActionRecord): Promise<ExecutionApplyResult> {
    const filePath = join(this.paths.appliedDir, `${action.id}.support.json`);
    const payload = {
      ...action.payload,
      appliedAt: nowIso(),
      signalId: action.signalId,
      signalDbId: action.signalDbId ?? null,
      title: action.title,
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return {
      ok: true,
      message: `Support action recorded at ${relative(this.colonyRoot, filePath)}`,
      artifactPath: filePath,
    };
  }
}

class CrmAdapter implements ExecutionAdapter {
  readonly id: ExecutionAdapterName = "crm";

  constructor(private readonly paths: StorePaths, private readonly colonyRoot: string) {}

  async proposeAction(context: ExecutionContext): Promise<ExecutionActionProposal> {
    const filePath = join(
      this.paths.proposalsDir,
      `${context.signal.id}-${toSlug(context.signal.title)}.crm.json`,
    );
    const payload = {
      mode: "crm-update",
      target: context.signal.execution.target,
      title: context.signal.title,
      instruction: context.signal.nextHint,
      acceptanceCriteria: context.signal.acceptanceCriteria,
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return {
      summary: `CRM action prepared for review: ${relative(this.colonyRoot, filePath)}`,
      artifactPath: filePath,
      payload,
    };
  }

  async executeAction(action: ExecutionActionRecord): Promise<ExecutionApplyResult> {
    const filePath = join(this.paths.appliedDir, `${action.id}.crm.json`);
    const payload = {
      ...action.payload,
      appliedAt: nowIso(),
      signalId: action.signalId,
      signalDbId: action.signalDbId ?? null,
      title: action.title,
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return {
      ok: true,
      message: `CRM action recorded at ${relative(this.colonyRoot, filePath)}`,
      artifactPath: filePath,
    };
  }
}

export class ExecutionCoordinator {
  private readonly paths: StorePaths;
  private readonly adapters: Map<ExecutionAdapterName, ExecutionAdapter>;
  private readonly policy;

  constructor(private readonly colonyRoot: string) {
    this.paths = ensureStorePaths(colonyRoot);
    this.policy = loadExecutionPolicy(colonyRoot);
    this.adapters = new Map<ExecutionAdapterName, ExecutionAdapter>([
      ["generic", new InternalAdapter()],
      ["analytics", new InternalAdapter()],
      ["git", new InternalAdapter()],
      ["content", new ContentAdapter(this.paths, colonyRoot)],
      ["support", new SupportAdapter(this.paths, colonyRoot)],
      ["crm", new CrmAdapter(this.paths, colonyRoot)],
    ]);
  }

  private inferAdapter(taskType: TaskType, signal: Pick<DecomposedSignal, "type" | "module" | "title" | "nextHint">): ExecutionAdapterName {
    const text = `${signal.type} ${signal.module} ${signal.title} ${signal.nextHint}`.toLowerCase();

    if (signal.type === "OUTREACH") return "crm";
    if (signal.type === "CONTENT" || signal.type === "CAMPAIGN") return "content";
    if (/support|ticket|incident|backlog|queue|triage/.test(text)) return "support";
    if (/crm|lead|prospect|account|outbound|follow-up|follow up|pipeline|sales/.test(text)) return "crm";
    if (signal.type === "FEEDBACK" || signal.type === "EXPERIMENT") return "analytics";
    if (signal.type === "HOLE" || signal.type === "EXPLORE") return "git";
    if (taskType === "MARKET") return "content";
    return "generic";
  }

  private inferExecutionClass(adapter: ExecutionAdapterName, signal: Pick<DecomposedSignal, "type">): ExecutionClass {
    if (signal.type === "OUTREACH") return "guarded-external";
    if (signal.type === "CONTENT" || signal.type === "CAMPAIGN") return "proposed";
    if (adapter === "support" && (signal.type === "OPS" || signal.type === "FEEDBACK" || signal.type === "REVIEW")) {
      return "guarded-external";
    }
    if (adapter === "crm") return "guarded-external";
    return "internal";
  }

  private inferTarget(adapter: ExecutionAdapterName, signal: Pick<DecomposedSignal, "module" | "title">): string {
    if (signal.module?.trim()) return signal.module.trim();
    switch (adapter) {
      case "git":
        return "repository";
      case "content":
        return "content/workspace";
      case "support":
        return "support/queue";
      case "crm":
        return "crm/pipeline";
      case "analytics":
        return "analytics/workspace";
      default:
        return toSlug(signal.title);
    }
  }

  resolveSignalExecution(
    taskType: TaskType,
    signal: Pick<DecomposedSignal, "type" | "module" | "title" | "nextHint">,
  ): SignalExecutionMetadata {
    const adapter = this.inferAdapter(taskType, signal);
    const executionClass = this.inferExecutionClass(adapter, signal);
    const policy = evaluateExecutionPolicy(this.policy, {
      adapter,
      executionClass,
      title: signal.title,
      nextHint: signal.nextHint,
    });
    return {
      adapter,
      executionClass,
      target: this.inferTarget(adapter, signal),
      policy,
    };
  }

  private buildActionStatus(signal: ExecutionSignalLike): ExecutionActionStatus {
    if (signal.execution.policy.status === "blocked") return "blocked";
    if (signal.execution.executionClass === "internal") return "planned";
    if (signal.execution.executionClass === "proposed") return "proposed";
    if (signal.execution.policy.requiresApproval) return "awaiting-approval";
    return "ready";
  }

  async preparePlan(plan: ExecutionPlanLike): Promise<ExecutionActionRecord[]> {
    const existing = readActionStore(this.paths);
    const existingBySignalId = new Map(existing.map((action) => [action.signalId, action]));
    const nextActions: ExecutionActionRecord[] = [];

    for (const signal of plan.signals) {
      const adapter = this.adapters.get(signal.execution.adapter) ?? this.adapters.get("generic")!;
      const proposal = await adapter.proposeAction({
        colonyRoot: this.colonyRoot,
        objective: plan.objective,
        taskType: plan.taskType,
        signal,
      });
      const prev = existingBySignalId.get(signal.id);
      const timestamp = nowIso();
      nextActions.push({
        id: prev?.id ?? `ACT-${signal.id}`,
        signalId: signal.id,
        signalDbId: prev?.signalDbId,
        objective: plan.objective,
        taskType: plan.taskType,
        title: signal.title,
        adapter: signal.execution.adapter,
        executionClass: signal.execution.executionClass,
        status: this.buildActionStatus(signal),
        target: signal.execution.target,
        summary: proposal.summary,
        proposalArtifactPath: proposal.artifactPath,
        payload: proposal.payload,
        policy: signal.execution.policy,
        createdAt: prev?.createdAt ?? timestamp,
        updatedAt: timestamp,
        result: prev?.result,
      });
    }

    writeActionStore(this.paths, nextActions);
    return nextActions;
  }

  linkDispatchedSignals(mapping: Map<string, string>): ExecutionActionRecord[] {
    const actions = readActionStore(this.paths).map((action) => ({
      ...action,
      signalDbId: mapping.get(action.signalId) ?? action.signalDbId,
      updatedAt: nowIso(),
    }));
    writeActionStore(this.paths, actions);
    return actions;
  }

  listActions(): ExecutionActionRecord[] {
    return readActionStore(this.paths);
  }

  approveActions(ids?: string[]): ExecutionActionRecord[] {
    const targetIds = ids && ids.length > 0 ? new Set(ids) : null;
    const updated = readActionStore(this.paths).map((action) => {
      if (action.status !== "awaiting-approval") return action;
      if (targetIds && !targetIds.has(action.id)) return action;
      return {
        ...action,
        status: "approved" as const,
        updatedAt: nowIso(),
      };
    });
    writeActionStore(this.paths, updated);
    return updated;
  }

  async applyActions(ids?: string[]): Promise<ExecutionActionRecord[]> {
    const targetIds = ids && ids.length > 0 ? new Set(ids) : null;
    const actions = readActionStore(this.paths);
    const updated: ExecutionActionRecord[] = [];

    for (const action of actions) {
      if (targetIds && !targetIds.has(action.id)) {
        updated.push(action);
        continue;
      }

      if (!["approved", "ready"].includes(action.status)) {
        updated.push(action);
        continue;
      }

      const adapter = this.adapters.get(action.adapter);
      if (!adapter?.executeAction) {
        updated.push({
          ...action,
          status: "failed",
          updatedAt: nowIso(),
          result: {
            ok: false,
            message: `Adapter ${action.adapter} does not support apply`,
          },
        });
        continue;
      }

      const result = await adapter.executeAction(action);
      updated.push({
        ...action,
        status: result.ok ? "executed" : "failed",
        updatedAt: nowIso(),
        result: {
          ok: result.ok,
          message: result.message,
          artifactPath: result.artifactPath,
        },
      });
    }

    writeActionStore(this.paths, updated);
    return updated;
  }

  summarize(plan?: ExecutionPlanLike): ExecutionSummary {
    const actions = readActionStore(this.paths);
    if (actions.length > 0) return createActionSummary(actions);

    if (!plan) {
      return createActionSummary([]);
    }

    const synthetic = plan.signals.map((signal) => ({
      id: `ACT-${signal.id}`,
      signalId: signal.id,
      objective: plan.objective,
      taskType: plan.taskType,
      title: signal.title,
      adapter: signal.execution.adapter,
      executionClass: signal.execution.executionClass,
      status: this.buildActionStatus(signal),
      target: signal.execution.target,
      summary: signal.title,
      policy: signal.execution.policy,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })) as ExecutionActionRecord[];
    return createActionSummary(synthetic);
  }

  actionStorePath(): string {
    return this.paths.actionsFile;
  }
}
