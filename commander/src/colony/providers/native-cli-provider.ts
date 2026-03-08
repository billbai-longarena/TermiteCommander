import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { extractModelName, type WorkerRuntime } from "../../config/model-resolver.js";
import {
  ProviderError,
  type Provider,
  type ProviderInfo,
  type ProviderStatus,
  type SendRequest,
  type StartRequest,
  type StartResult,
  type StreamEvent,
} from "./contract.js";

const SESSION_ID_KEYS = new Set([
  "sessionID",
  "sessionId",
  "session_id",
  "conversation_id",
  "conversationId",
]);

const RUN_ID_KEYS = new Set(["runId", "run_id"]);

const SESSION_ID_REGEX = /"(sessionID|sessionId|session_id|conversation_id|conversationId)"\s*:\s*"([^"]+)"/g;
const RUN_ID_REGEX = /"(runId|run_id)"\s*:\s*"([^"]+)"/g;

export interface NativeCliLaunchRequest {
  runtime: WorkerRuntime;
  workspace: string;
  workerId: string;
  prompt: string;
  model?: string;
  sessionId: string | null;
}

export interface NativeCliLaunchSpec {
  command: string;
  args: string[];
  preassignedSessionId: string | null;
}

export interface SessionSnapshot {
  sessionId: string | null;
  runId: string | null;
}

export class NativeCliProvider implements Provider {
  private normalizeRuntimeModel(runtime: WorkerRuntime, model: string | undefined): string | undefined {
    if (!model) return undefined;
    return runtime === "claude" ? extractModelName(model) : model;
  }

  handshake(): ProviderInfo {
    return {
      contractVersion: "1.0",
      provider: "native-cli",
      providerVersion: "1.0.0",
      capabilities: ["stream_text", "structured_json", "session_resume"],
    };
  }

  async start(req: StartRequest): Promise<StartResult> {
    const workspace = req.workspace.trim();
    const prompt = req.prompt.trim();
    if (!workspace || !prompt) {
      throw new ProviderError("INVALID_REQUEST", "workspace and prompt are required for provider start().");
    }
    const sessionId = req.route?.sessionId ?? randomUUID();
    return { sessionId, providerSessionId: sessionId };
  }

  async *send(_req: SendRequest): AsyncIterable<StreamEvent> {
    throw new ProviderError(
      "NOT_SUPPORTED",
      "native-cli provider send() is not implemented yet. Use launcher runtime execution.",
    );
  }

  async cancel(_sessionId: string): Promise<void> {
    return;
  }

  async status(_sessionId: string): Promise<ProviderStatus> {
    return "running";
  }

  async resume(_sessionId: string): Promise<StartResult> {
    throw new ProviderError("NOT_SUPPORTED", "native-cli provider resume() is not implemented yet.");
  }

  buildStartSpec(req: NativeCliLaunchRequest): NativeCliLaunchSpec {
    if (req.runtime === "openclaw") {
      throw new ProviderError(
        "INVALID_REQUEST",
        "openclaw runtime is not handled by NativeCliProvider. Use OpenClawProvider.",
      );
    }

    const workspace = resolve(req.workspace);

    if (req.runtime === "opencode") {
      const args = ["run", req.prompt, "--format", "json", "--dir", workspace];
      const runtimeModel = this.normalizeRuntimeModel(req.runtime, req.model);
      if (runtimeModel) {
        args.push("--model", runtimeModel);
      }
      if (req.sessionId) {
        args.push("--session", req.sessionId);
      } else {
        args.push("--title", `Termite: ${req.workerId}`);
      }
      return { command: "opencode", args, preassignedSessionId: req.sessionId };
    }

    if (req.runtime === "claude") {
      const sessionId = req.sessionId ?? randomUUID();
      const runtimeModel = this.normalizeRuntimeModel(req.runtime, req.model);
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--session-id",
        sessionId,
      ];
      if (runtimeModel) {
        args.push("--model", runtimeModel);
      }
      args.push(req.prompt);
      return { command: "claude", args, preassignedSessionId: sessionId };
    }

    const args = req.sessionId
      ? ["exec", "resume", req.sessionId, req.prompt]
      : ["exec", req.prompt];
    args.push("--json", "--full-auto", "--skip-git-repo-check", "-C", workspace);
    if (req.model) {
      args.push("-m", req.model);
    }
    return { command: "codex", args, preassignedSessionId: req.sessionId };
  }

  extractSessionSnapshot(text: string): SessionSnapshot {
    let sessionId: string | null = null;
    let runId: string | null = null;

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (!sessionId) {
          sessionId = this.findStringByKeys(parsed, SESSION_ID_KEYS);
        }
        if (!runId) {
          runId = this.findStringByKeys(parsed, RUN_ID_KEYS);
        }
      } catch {
        // Some runtimes output formatted JSON chunks; regex fallback below handles those.
      }
    }

    if (!sessionId) {
      sessionId = this.findFirstRegexValue(text, SESSION_ID_REGEX);
    }
    if (!runId) {
      runId = this.findFirstRegexValue(text, RUN_ID_REGEX);
    }

    return { sessionId, runId };
  }

  private findFirstRegexValue(text: string, regex: RegExp): string | null {
    regex.lastIndex = 0;
    const match = regex.exec(text);
    if (!match) return null;
    const value = match[2];
    return value && value.trim() ? value.trim() : null;
  }

  private findStringByKeys(value: unknown, keys: Set<string>): string | null {
    if (typeof value === "string") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = this.findStringByKeys(item, keys);
        if (nested) return nested;
      }
      return null;
    }
    if (!value || typeof value !== "object") return null;

    const obj = value as Record<string, unknown>;
    for (const [key, nested] of Object.entries(obj)) {
      if (keys.has(key) && typeof nested === "string" && nested.trim()) {
        return nested.trim();
      }
      const discovered = this.findStringByKeys(nested, keys);
      if (discovered) return discovered;
    }
    return null;
  }
}
