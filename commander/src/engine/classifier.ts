export type TaskType = "BUILD" | "HYBRID";

export class TaskClassifier {
  static classify(input: string): TaskType {
    const hasBuild = /构建|开发|实现|创建|添加|build|create|implement|develop|add|code|api|function|test|deploy/i.test(input);
    const hasResearch = /调研|研究|分析|explore|research|investigate|analyze/i.test(input);
    if (hasBuild && hasResearch) return "HYBRID";
    return "BUILD";
  }

  static async classifyWithLLM(
    input: string,
    generateText: (prompt: string) => Promise<string>,
  ): Promise<TaskType> {
    const prompt = `Classify this task. Reply with ONLY: BUILD or HYBRID.

BUILD: creating/modifying code, features, systems
HYBRID: building + investigating existing systems

Task: "${input}"

Category:`;

    try {
      const result = await generateText(prompt);
      const cleaned = result.trim().toUpperCase() as TaskType;
      if (["BUILD", "HYBRID"].includes(cleaned)) return cleaned;
    } catch {}
    return this.classify(input);
  }
}
