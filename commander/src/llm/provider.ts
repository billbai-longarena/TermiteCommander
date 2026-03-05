import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

export interface LLMConfig {
  provider: "azure-openai" | "anthropic" | "openai";
  model?: string;
}

function getAzureOpenAI() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("AZURE_OPENAI_API_KEY not set");
  }

  const baseURL = process.env.AZURE_OPENAI_ENDPOINT;
  if (!baseURL) {
    throw new Error("AZURE_OPENAI_ENDPOINT not set");
  }

  return createOpenAI({
    apiKey,
    baseURL,
  });
}

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const baseURL = process.env.OPENAI_BASE_URL;
  return createOpenAI({
    apiKey,
    baseURL,
  });
}

function getAnthropic() {
  // Support Anthropic Foundry (Azure-hosted) or standard Anthropic API
  const foundryKey = process.env.ANTHROPIC_FOUNDRY_API_KEY;
  const standardKey = process.env.ANTHROPIC_API_KEY;
  const apiKey = foundryKey || standardKey;

  if (!apiKey) {
    throw new Error("ANTHROPIC_FOUNDRY_API_KEY or ANTHROPIC_API_KEY not set");
  }

  // Foundry uses a different base URL
  const foundryResource = process.env.ANTHROPIC_FOUNDRY_RESOURCE;
  if (foundryKey && foundryResource) {
    return createAnthropic({
      apiKey: foundryKey,
      baseURL: `https://${foundryResource}.anthropic.azure.com/v1`,
    });
  }

  return createAnthropic({ apiKey });
}

export async function callLLM(prompt: string, config?: LLMConfig): Promise<string> {
  const provider = config?.provider ?? detectDefaultProvider();
  const model = config?.model ?? getDefaultModel(provider);

  try {
    if (provider === "azure-openai") {
      const openai = getAzureOpenAI();
      // Use .responses() for Codex models (Responses API), .chat() for others
      const isCodex = model.includes("codex");
      const result = await generateText({
        model: isCodex ? openai.responses(model) : openai(model),
        prompt,
        maxTokens: 4096,
      });
      return result.text;
    } else if (provider === "openai") {
      const openai = getOpenAI();
      const isCodex = model.includes("codex");
      const result = await generateText({
        model: isCodex ? openai.responses(model) : openai(model),
        prompt,
        maxTokens: 4096,
      });
      return result.text;
    } else {
      const anthropic = getAnthropic();
      const result = await generateText({
        model: anthropic(model),
        prompt,
        maxTokens: 4096,
      });
      return result.text;
    }
  } catch (err: any) {
    console.error(`[llm] Error calling ${provider} (${model}):`, err.message);
    throw err;
  }
}

function detectDefaultProvider(): LLMConfig["provider"] {
  // Prefer Anthropic if available, since Azure OpenAI Codex models
  // can have API compatibility issues with chat completions
  if (process.env.ANTHROPIC_FOUNDRY_API_KEY || process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }
  return "azure-openai";
}

function getDefaultModel(provider: LLMConfig["provider"]): string {
  if (provider === "anthropic") {
    return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "claude-sonnet-4-5";
  }
  return process.env.COMMANDER_LLM_MODEL ?? "gpt-5.3-codex";
}

export function configFromResolved(
  resolved: import("../config/model-resolver.js").ResolvedModels,
): LLMConfig {
  return {
    provider: resolved.commanderProvider,
    model: resolved.commanderModel,
  };
}
