export const TASK_TYPES = [
  "BUILD",
  "RESEARCH",
  "MARKET",
  "SALES",
  "OPERATE",
  "ITERATE",
  "HYBRID",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

type PrimaryTaskType = Exclude<TaskType, "HYBRID">;

export type DeliverableFormat = "Code + tests" | "Report" | "Content" | "Ops" | "Mixed";

const DOMAIN_PATTERNS: Record<PrimaryTaskType, RegExp> = {
  BUILD: /构建|开发|实现|创建|添加|编写代码|重构|迁移|测试|部署|build|create|implement|develop|code|coding|api|endpoint|function|component|refactor|migrate|test|deploy/i,
  RESEARCH: /调研|研究|分析|探索|评估|比较|竞品|趋势|explore|research|investigate|analyze|assess|benchmark|compare|competitor|trend/i,
  MARKET: /市场|营销|推广|增长|发布|渠道|文案|品牌|定位|活动|着陆页|product hunt|launch|campaign|channel|copy|content|messaging|positioning|seo|social|landing page|brand|growth/i,
  SALES: /销售|客户开发|线索|商机|潜客|跟进|外呼|外联|账号画像|报价|演示|成交|crm|icp|lead|prospect|outbound|account brief|pipeline|follow-up|follow up|proposal|demo/i,
  OPERATE: /运营|客服|支持工单|工单|值班|发布协调|监控|指标|告警|流程|队列|知识库|backlog|support queue|support backlog|ticket|incident|runbook|monitor|kpi|dashboard|triage|workflow|release coordination/i,
  ITERATE: /反馈|迭代|留存|流失|投诉|建议|痛点|nps|问卷|激活|转化|优化|改进|onboarding|feedback|iterate|retention|churn|complaint|survey|pain point|activation|conversion|improve|optimize/i,
};

export function deliverableFormatForTaskType(taskType: TaskType): DeliverableFormat {
  switch (taskType) {
    case "BUILD":
      return "Code + tests";
    case "RESEARCH":
      return "Report";
    case "MARKET":
    case "SALES":
      return "Content";
    case "OPERATE":
      return "Ops";
    case "ITERATE":
    case "HYBRID":
      return "Mixed";
  }
}

function detectTaskDomains(input: string): PrimaryTaskType[] {
  return (Object.entries(DOMAIN_PATTERNS) as Array<[PrimaryTaskType, RegExp]>)
    .filter(([, pattern]) => pattern.test(input))
    .map(([taskType]) => taskType);
}

export class TaskClassifier {
  static classify(input: string): TaskType {
    const domains = detectTaskDomains(input);
    const nonResearchDomains = domains.filter((domain) => domain !== "RESEARCH");
    const domainsExcludingBuild = nonResearchDomains.filter((domain) => domain !== "BUILD");

    if (domains.includes("BUILD") && domains.some((domain) => domain !== "BUILD")) {
      return "HYBRID";
    }

    if (domainsExcludingBuild.length >= 2) {
      return "HYBRID";
    }

    if (domainsExcludingBuild.length === 1) {
      return domainsExcludingBuild[0];
    }

    if (domains.includes("BUILD")) {
      return "BUILD";
    }

    if (domains.includes("RESEARCH")) {
      return "RESEARCH";
    }

    return "BUILD";
  }

  static extractTaskType(raw: string): TaskType | null {
    const normalized = raw.trim().toUpperCase();
    return TASK_TYPES.find((taskType) => new RegExp(`\\b${taskType}\\b`).test(normalized)) ?? null;
  }

  static async classifyWithLLM(
    input: string,
    generateText: (prompt: string) => Promise<string>,
  ): Promise<TaskType> {
    const prompt = `Classify this task. Reply with ONLY one of:
BUILD
RESEARCH
MARKET
SALES
OPERATE
ITERATE
HYBRID

BUILD: creating or modifying software, tests, docs, or internal technical systems
RESEARCH: gathering information, comparing options, or producing analysis/reporting
MARKET: marketing strategy, launch planning, messaging, campaigns, channels, or growth work
SALES: lead/account research, outbound drafts, CRM follow-up, or sales collateral
OPERATE: support, triage, release/process coordination, KPI monitoring, or project operations
ITERATE: analyzing user feedback/metrics and proposing or driving product or messaging improvements
HYBRID: spans 2 or more primary domains, especially BUILD plus another domain

Task: "${input}"

Category:`;

    try {
      const result = await generateText(prompt);
      const cleaned = this.extractTaskType(result);
      if (cleaned) return cleaned;
    } catch {}
    return this.classify(input);
  }
}
