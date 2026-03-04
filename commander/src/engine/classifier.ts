export type TaskType = "RESEARCH" | "BUILD" | "ANALYZE" | "HYBRID";

const RESEARCH_PATTERNS = [
  /调研|研究|分析.*报|搜索|market.*research|investigate|survey|trend|财报|report/i,
  /research|study|explore.*industry|competitor|benchmark/i,
];

const BUILD_PATTERNS = [
  /构建|开发|实现|创建|添加|build|create|implement|develop|add.*feature/i,
  /REST.*API|frontend|backend|service|module|component/i,
];

const ANALYZE_PATTERNS = [
  /分析.*代码|分析.*性能|诊断|审计|profile|analyze.*code|analyze.*performance|debug|bottleneck/i,
  /performance.*analysis|code.*review|assess/i,
];

export class TaskClassifier {
  static classify(input: string): TaskType {
    const hasResearch = RESEARCH_PATTERNS.some((p) => p.test(input));
    const hasBuild = BUILD_PATTERNS.some((p) => p.test(input));
    const hasAnalyze = ANALYZE_PATTERNS.some((p) => p.test(input));

    if (hasResearch && hasBuild) return "HYBRID";
    if (hasResearch && hasAnalyze) return "HYBRID";
    if (hasResearch) return "RESEARCH";
    if (hasBuild) return "BUILD";
    if (hasAnalyze) return "ANALYZE";

    if (/code|api|function|class|test|deploy|database/i.test(input)) return "BUILD";
    return "RESEARCH";
  }

  static async classifyWithLLM(
    input: string,
    generateText: (prompt: string) => Promise<string>,
  ): Promise<TaskType> {
    const prompt = `Classify this task into exactly one category. Reply with ONLY the category name.

Categories:
- RESEARCH: information gathering, market research, data analysis, report writing
- BUILD: software development, creating features, building systems
- ANALYZE: diagnosing existing systems, performance analysis, code review
- HYBRID: tasks that combine research/analysis with building

Task: "${input}"

Category:`;

    try {
      const result = await generateText(prompt);
      const cleaned = result.trim().toUpperCase() as TaskType;
      if (["RESEARCH", "BUILD", "ANALYZE", "HYBRID"].includes(cleaned)) {
        return cleaned;
      }
    } catch {
      // Fall through to heuristic
    }
    return this.classify(input);
  }
}
