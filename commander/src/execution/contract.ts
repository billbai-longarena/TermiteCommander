import type { TaskType } from "../engine/classifier.js";

export type ExecutionClass = "internal" | "proposed" | "guarded-external";

export type ExecutionAdapterName =
  | "git"
  | "generic"
  | "content"
  | "support"
  | "crm"
  | "analytics";

export type PolicyStatus = "allowed" | "needs-approval" | "blocked";

export interface PolicyDecision {
  status: PolicyStatus;
  requiresApproval: boolean;
  reviewRequired: boolean;
  reasons: string[];
}

export interface SignalExecutionMetadata {
  adapter: ExecutionAdapterName;
  executionClass: ExecutionClass;
  target: string;
  policy: PolicyDecision;
}

export interface ExecutionSignalLike {
  id: string;
  type: string;
  title: string;
  module: string;
  nextHint: string;
  acceptanceCriteria: string;
  execution: SignalExecutionMetadata;
}

export interface ExecutionPlanLike {
  objective: string;
  taskType: TaskType;
  signals: ExecutionSignalLike[];
}

export interface ExecutionActionProposal {
  summary: string;
  artifactPath?: string;
  payload?: Record<string, unknown>;
}

export type ExecutionActionStatus =
  | "planned"
  | "proposed"
  | "awaiting-approval"
  | "approved"
  | "ready"
  | "executed"
  | "blocked"
  | "failed";

export interface ExecutionActionRecord {
  id: string;
  signalId: string;
  signalDbId?: string;
  objective: string;
  taskType: TaskType;
  title: string;
  adapter: ExecutionAdapterName;
  executionClass: ExecutionClass;
  status: ExecutionActionStatus;
  target: string;
  summary: string;
  proposalArtifactPath?: string;
  payload?: Record<string, unknown>;
  policy: PolicyDecision;
  createdAt: string;
  updatedAt: string;
  result?: {
    ok: boolean;
    message: string;
    artifactPath?: string;
  };
}

export interface ExecutionContext {
  colonyRoot: string;
  objective: string;
  taskType: TaskType;
  signal: ExecutionSignalLike;
}

export interface ExecutionApplyResult {
  ok: boolean;
  message: string;
  artifactPath?: string;
}

export interface ExecutionAdapter {
  readonly id: ExecutionAdapterName;
  proposeAction(context: ExecutionContext): Promise<ExecutionActionProposal>;
  executeAction?(action: ExecutionActionRecord): Promise<ExecutionApplyResult>;
}

export interface ExecutionSummary {
  total: number;
  byStatus: Record<string, number>;
  byClass: Record<ExecutionClass, number>;
  byAdapter: Record<string, number>;
  awaitingApproval: number;
  ready: number;
  executed: number;
  blocked: number;
}
