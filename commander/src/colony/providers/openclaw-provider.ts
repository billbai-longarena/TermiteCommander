import { randomUUID } from "node:crypto";
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

const SESSION_ID_REGEX = /"(sessionID|sessionId|session_id|conversation_id|conversationId)"\s*:\s*"([^"]+)"/g;
const RUN_ID_REGEX = /"(runId|run_id)"\s*:\s*"([^"]+)"/g;

export interface OpenClawLaunchRequest extends StartRequest {
  timeoutSec?: number;
  local?: boolean;
}

export interface OpenClawLaunchSpec {
  command: "openclaw";
  args: string[];
  sessionId: string;
}

export interface OpenClawSnapshot {
  sessionId: string | null;
  runId: string | null;
}

export class OpenClawProvider implements Provider {
  handshake(): ProviderInfo {
    return {
      contractVersion: "1.0",
      provider: "openclaw",
      providerVersion: "1.0.0",
      capabilities: ["stream_text", "structured_json", "session_resume"],
    };
  }

  async start(req: StartRequest): Promise<StartResult> {
    const prompt = req.prompt.trim();
    const workspace = req.workspace.trim();
    if (!prompt || !workspace) {
      throw new ProviderError("INVALID_REQUEST", "workspace and prompt are required for openclaw start().");
    }

    const route = req.route ?? {};
    if (!route.agent && !route.to && !route.sessionId) {
      throw new ProviderError(
        "INVALID_REQUEST",
        "openclaw start() requires at least one route key: route.agent | route.to | route.sessionId.",
      );
    }

    const sessionId = route.sessionId ?? randomUUID();
    return {
      sessionId,
      providerSessionId: route.sessionId ?? sessionId,
    };
  }

  async *send(_req: SendRequest): AsyncIterable<StreamEvent> {
    throw new ProviderError(
      "NOT_SUPPORTED",
      "openclaw provider send() is not implemented yet. Use launcher runtime execution.",
    );
  }

  async cancel(_sessionId: string): Promise<void> {
    return;
  }

  async status(_sessionId: string): Promise<ProviderStatus> {
    return "running";
  }

  async resume(_sessionId: string): Promise<StartResult> {
    throw new ProviderError("NOT_SUPPORTED", "openclaw provider resume() is not implemented yet.");
  }

  async buildStartSpec(req: OpenClawLaunchRequest): Promise<OpenClawLaunchSpec> {
    const start = await this.start(req);
    const route = req.route ?? {};
    const timeoutSec = req.timeoutSec ?? 600;

    const args = [
      "agent",
      "--message",
      req.prompt,
      "--json",
      "--timeout",
      String(timeoutSec),
    ];

    if (req.local) args.push("--local");
    if (route.agent) args.push("--agent", route.agent);
    if (route.to) args.push("--to", route.to);
    args.push("--session-id", start.sessionId);

    return {
      command: "openclaw",
      args,
      sessionId: start.sessionId,
    };
  }

  extractSessionSnapshot(text: string): OpenClawSnapshot {
    return {
      sessionId: this.findFirstRegexValue(text, SESSION_ID_REGEX),
      runId: this.findFirstRegexValue(text, RUN_ID_REGEX),
    };
  }

  private findFirstRegexValue(text: string, regex: RegExp): string | null {
    regex.lastIndex = 0;
    const match = regex.exec(text);
    if (!match) return null;
    const value = match[2];
    return value && value.trim() ? value.trim() : null;
  }
}
