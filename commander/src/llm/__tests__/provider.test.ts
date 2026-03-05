import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateTextMock,
  openaiModelMock,
  openaiResponsesMock,
  createOpenAIMock,
  anthropicModelMock,
  createAnthropicMock,
} = vi.hoisted(() => {
  const generateTextMock = vi.fn(async () => ({ text: "ok" }));
  const openaiModelMock = vi.fn((model: string) => `openai-chat:${model}`);
  const openaiResponsesMock = vi.fn((model: string) => `openai-responses:${model}`);
  const createOpenAIMock = vi.fn(() =>
    Object.assign(openaiModelMock, { responses: openaiResponsesMock }),
  );
  const anthropicModelMock = vi.fn((model: string) => `anthropic:${model}`);
  const createAnthropicMock = vi.fn(() => anthropicModelMock);

  return {
    generateTextMock,
    openaiModelMock,
    openaiResponsesMock,
    createOpenAIMock,
    anthropicModelMock,
    createAnthropicMock,
  };
});

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: createOpenAIMock,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: createAnthropicMock,
}));

import { callLLM } from "../provider.js";

describe("callLLM provider routing", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_FOUNDRY_API_KEY",
    "ANTHROPIC_FOUNDRY_RESOURCE",
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("uses OpenAI client when provider=openai", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";

    const text = await callLLM("hello", {
      provider: "openai",
      model: "gpt-4o",
    });

    expect(text).toBe("ok");
    expect(createOpenAIMock).toHaveBeenCalledTimes(1);
    expect(createAnthropicMock).not.toHaveBeenCalled();
    expect(openaiModelMock).toHaveBeenCalledWith("gpt-4o");
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai-chat:gpt-4o",
        prompt: "hello",
      }),
    );
  });

  it("uses OpenAI responses API for codex models", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";

    await callLLM("hello", {
      provider: "openai",
      model: "gpt-5-codex",
    });

    expect(openaiResponsesMock).toHaveBeenCalledWith("gpt-5-codex");
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai-responses:gpt-5-codex",
      }),
    );
  });

  it("throws a clear error when OPENAI_API_KEY is missing", async () => {
    await expect(
      callLLM("hello", { provider: "openai", model: "gpt-4o" }),
    ).rejects.toThrow("OPENAI_API_KEY not set");
  });
});
