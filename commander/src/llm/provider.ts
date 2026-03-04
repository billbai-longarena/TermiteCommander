import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

export interface LLMConfig {
  provider: "azure-openai" | "anthropic";
  model?: string;
}

function getAzureOpenAI() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("AZURE_OPENAI_API_KEY not set");
  }

  const baseURL = process.env.AZURE_OPENAI_ENDPOINT;
  if (!baseURL) {
    throw new Error("AZURE_OPENAI_ENDPOINT not set (e.g. https://your-resource.cognitiveservices.azure.com/openai/v1)");
  }

  return createOpenAI({
    apiKey,
    baseURL,
  });
}

function getAnthropic() {
  const apiKey = process.env.ANTHROPIC_FOUNDRY_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_FOUNDRY_API_KEY or ANTHROPIC_API_KEY not set");
  }

  return createAnthropic({
    apiKey,
  });
}

export async function callLLM(prompt: string, config?: LLMConfig): Promise<string> {
  const provider = config?.provider ?? "azure-openai";

  try {
    if (provider === "azure-openai") {
      const openai = getAzureOpenAI();
      const model = config?.model ?? "gpt-5.3-codex";
      const result = await generateText({
        model: openai(model),
        prompt,
        maxTokens: 4096,
      });
      return result.text;
    } else {
      const anthropic = getAnthropic();
      const model = config?.model ?? "claude-sonnet-4-5";
      const result = await generateText({
        model: anthropic(model),
        prompt,
        maxTokens: 4096,
      });
      return result.text;
    }
  } catch (err: any) {
    console.error(`[llm] Error calling ${provider}:`, err.message);
    throw err;
  }
}
