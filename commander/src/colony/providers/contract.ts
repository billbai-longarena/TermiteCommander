export type ProviderId = "openclaw" | "native-cli";

export type Capability =
  | "stream_text"
  | "tool_calls"
  | "session_resume"
  | "structured_json"
  | "bootstrap_context"
  | "cron_task";

export type ProviderStatus = "running" | "completed" | "failed" | "cancelled";

export interface ProviderInfo {
  contractVersion: "1.0";
  provider: ProviderId;
  providerVersion: string;
  capabilities: Capability[];
}

export interface RouteContext {
  agent?: string;
  to?: string;
  sessionId?: string;
}

export interface StartRequest {
  workspace: string;
  prompt: string;
  model?: string;
  route?: RouteContext;
  metadata?: Record<string, string>;
}

export interface StartResult {
  sessionId: string;
  providerSessionId?: string;
  runId?: string;
}

export interface SendRequest {
  sessionId: string;
  prompt: string;
  metadata?: Record<string, string>;
}

export type StreamEvent =
  | { type: "text.delta"; text: string }
  | { type: "tool.call"; name: string; args: unknown }
  | { type: "tool.result"; name: string; output: unknown }
  | { type: "status"; status: ProviderStatus }
  | { type: "error"; code: ErrorCode; message: string; retryable: boolean };

export type ErrorCode =
  | "INVALID_REQUEST"
  | "NOT_SUPPORTED"
  | "SESSION_NOT_FOUND"
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "CONFLICT"
  | "UPSTREAM_ERROR";

export class ProviderError extends Error {
  code: ErrorCode;
  retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface Provider {
  handshake(): ProviderInfo;
  start(req: StartRequest): Promise<StartResult>;
  send(req: SendRequest): AsyncIterable<StreamEvent>;
  cancel(sessionId: string): Promise<void>;
  status(sessionId: string): Promise<ProviderStatus>;
  resume(sessionId: string): Promise<StartResult>;
}
