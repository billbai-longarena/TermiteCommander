import { readTermiteConfig } from "../config/model-resolver.js";
import type {
  ExecutionAdapterName,
  ExecutionClass,
  PolicyDecision,
} from "./contract.js";

export interface ExecutionPolicyConfig {
  allowAdapters: ExecutionAdapterName[];
  blockedAdapters: ExecutionAdapterName[];
  requireApprovalForGuardedExternal: boolean;
  support: {
    enabled: boolean;
    requireApproval: boolean;
  };
  crm: {
    enabled: boolean;
    requireApproval: boolean;
  };
}

interface PolicyInput {
  adapter: ExecutionAdapterName;
  executionClass: ExecutionClass;
  title: string;
  nextHint: string;
}

const DEFAULT_POLICY: ExecutionPolicyConfig = {
  allowAdapters: ["git", "generic", "content", "support", "crm", "analytics"],
  blockedAdapters: [],
  requireApprovalForGuardedExternal: true,
  support: {
    enabled: true,
    requireApproval: true,
  },
  crm: {
    enabled: true,
    requireApproval: true,
  },
};

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function toAdapterList(value: unknown): ExecutionAdapterName[] | undefined {
  const items = asStringArray(value);
  if (!items) return undefined;
  return items.filter((item): item is ExecutionAdapterName =>
    ["git", "generic", "content", "support", "crm", "analytics"].includes(item),
  );
}

export function loadExecutionPolicy(colonyRoot: string): ExecutionPolicyConfig {
  const termiteConfig = readTermiteConfig(colonyRoot) as any;
  const rootConfig = termiteConfig?.execution ?? {};
  const commanderConfig = termiteConfig?.commander?.execution ?? {};
  const merged = {
    ...rootConfig,
    ...commanderConfig,
  };

  const supportConfig = {
    ...(rootConfig?.support ?? {}),
    ...(commanderConfig?.support ?? {}),
  };
  const crmConfig = {
    ...(rootConfig?.crm ?? {}),
    ...(commanderConfig?.crm ?? {}),
  };

  return {
    allowAdapters: toAdapterList(merged.allow_adapters) ?? DEFAULT_POLICY.allowAdapters,
    blockedAdapters: toAdapterList(merged.blocked_adapters) ?? DEFAULT_POLICY.blockedAdapters,
    requireApprovalForGuardedExternal:
      typeof merged.require_approval_for_guarded_external === "boolean"
        ? merged.require_approval_for_guarded_external
        : DEFAULT_POLICY.requireApprovalForGuardedExternal,
    support: {
      enabled:
        typeof supportConfig.enabled === "boolean"
          ? supportConfig.enabled
          : DEFAULT_POLICY.support.enabled,
      requireApproval:
        typeof supportConfig.require_approval === "boolean"
          ? supportConfig.require_approval
          : DEFAULT_POLICY.support.requireApproval,
    },
    crm: {
      enabled:
        typeof crmConfig.enabled === "boolean"
          ? crmConfig.enabled
          : DEFAULT_POLICY.crm.enabled,
      requireApproval:
        typeof crmConfig.require_approval === "boolean"
          ? crmConfig.require_approval
          : DEFAULT_POLICY.crm.requireApproval,
    },
  };
}

export function evaluateExecutionPolicy(
  policy: ExecutionPolicyConfig,
  input: PolicyInput,
): PolicyDecision {
  const reasons: string[] = [];

  if (policy.blockedAdapters.includes(input.adapter)) {
    reasons.push(`adapter ${input.adapter} is blocked by policy`);
    return {
      status: "blocked",
      requiresApproval: false,
      reviewRequired: false,
      reasons,
    };
  }

  if (!policy.allowAdapters.includes(input.adapter)) {
    reasons.push(`adapter ${input.adapter} is not in the allowlist`);
    return {
      status: "blocked",
      requiresApproval: false,
      reviewRequired: false,
      reasons,
    };
  }

  if (input.adapter === "support" && !policy.support.enabled) {
    reasons.push("support adapter is disabled");
    return {
      status: "blocked",
      requiresApproval: false,
      reviewRequired: false,
      reasons,
    };
  }

  if (input.adapter === "crm" && !policy.crm.enabled) {
    reasons.push("crm adapter is disabled");
    return {
      status: "blocked",
      requiresApproval: false,
      reviewRequired: false,
      reasons,
    };
  }

  if (input.executionClass === "guarded-external") {
    const adapterRequiresApproval =
      input.adapter === "support"
        ? policy.support.requireApproval
        : input.adapter === "crm"
          ? policy.crm.requireApproval
          : policy.requireApprovalForGuardedExternal;
    if (adapterRequiresApproval) {
      reasons.push(`guarded external action via ${input.adapter} requires approval`);
      return {
        status: "needs-approval",
        requiresApproval: true,
        reviewRequired: true,
        reasons,
      };
    }

    reasons.push(`guarded external action via ${input.adapter} is allowed`);
    return {
      status: "allowed",
      requiresApproval: false,
      reviewRequired: true,
      reasons,
    };
  }

  if (input.executionClass === "proposed") {
    reasons.push("proposal artifact should be reviewed before external publication");
    return {
      status: "allowed",
      requiresApproval: false,
      reviewRequired: true,
      reasons,
    };
  }

  reasons.push("internal action is allowed");
  return {
    status: "allowed",
    requiresApproval: false,
    reviewRequired: false,
    reasons,
  };
}
