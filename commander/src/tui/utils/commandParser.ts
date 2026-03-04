export type CommandAction =
  | { type: "plan"; objective: string; run: boolean }
  | { type: "status" }
  | { type: "stop" }
  | { type: "workers" }
  | { type: "resume" }
  | { type: "watch" }
  | { type: "help" }
  | { type: "quit" }
  | { type: "view"; target: "dashboard" | "signals" | "workers" | "repl" };

const STATUS_PATTERNS = /^(status|状态|进度|怎么样了|how'?s?\s+it\s+going)/i;
const STOP_PATTERNS = /^(stop|halt|停|暂停|kill)/i;
const WORKERS_PATTERNS = /^(workers?|工人|谁在工作|who'?s?\s+working)/i;
const RESUME_PATTERNS = /^(resume|continue|继续|恢复)/i;
const WATCH_PATTERNS = /^(watch|monitor|监控)/i;
const HELP_PATTERNS = /^(help|\?|帮助|命令)/i;
const QUIT_PATTERNS = /^(quit|exit|q|退出)/i;
const PLAN_PREFIX = /^(plan|start|规划|开始|执行)\s+/i;

export function parseCommand(input: string): CommandAction {
  const trimmed = input.trim();
  if (!trimmed) return { type: "help" };

  if (QUIT_PATTERNS.test(trimmed)) return { type: "quit" };
  if (HELP_PATTERNS.test(trimmed)) return { type: "help" };
  if (STATUS_PATTERNS.test(trimmed)) return { type: "status" };
  if (STOP_PATTERNS.test(trimmed)) return { type: "stop" };
  if (WORKERS_PATTERNS.test(trimmed)) return { type: "workers" };
  if (RESUME_PATTERNS.test(trimmed)) return { type: "resume" };
  if (WATCH_PATTERNS.test(trimmed)) return { type: "watch" };

  // View switching commands
  if (/^(dashboard|仪表盘|总览)$/i.test(trimmed)) return { type: "view", target: "dashboard" };
  if (/^(signals?|信号|signal list)$/i.test(trimmed)) return { type: "view", target: "signals" };

  // Plan with explicit prefix
  const planMatch = trimmed.match(PLAN_PREFIX);
  if (planMatch) {
    const objective = trimmed.slice(planMatch[0].length).trim();
    return { type: "plan", objective, run: true };
  }

  // Default: treat as natural language objective → plan
  return { type: "plan", objective: trimmed, run: true };
}
