# OpenClaw Runtime Integration Record

- Date: 2026-03-05
- Scope: Commander runtime support for `openclaw` without modifying OpenClaw upstream source.
- Owner: termite-commander

## 1. Delivered Changes

1. Added Provider Contract v1 and provider adapters:
   - `commander/src/colony/providers/contract.ts`
   - `commander/src/colony/providers/native-cli-provider.ts`
   - `commander/src/colony/providers/openclaw-provider.ts`
2. Extended worker runtime to include `openclaw`:
   - `WorkerRuntime = "opencode" | "claude" | "codex" | "openclaw"`
   - `parseWorkerSpec` supports `openclaw@<agent-id>:<count>` and `openclaw:<count>`.
3. Launcher integration:
   - `OpenCodeLauncher` now dispatches `openclaw` workers via `OpenClawProvider`.
   - Runtime checks include the `openclaw` binary.
   - Session extraction supports OpenClaw JSON output and tracks `runId` where available.
4. Config and docs support:
   - `importer.ts` accepts `openclaw` worker entries from `opencode.json` commander workers.
   - README (EN/ZH) updated with OpenClaw runtime usage notes.

## 2. Tests

- Commander tests pass:
  - `npm test` => `97 passed`
  - `npm run build` => success
- Added test coverage for:
  - Provider contract handshake and runtime boundaries
  - OpenClaw route validation
  - Launcher runtime detection and OpenClaw spawn argument construction

## 3. Local Smoke Validation

### 3.1 OpenClaw CLI availability

- Initial machine state: `openclaw` not found on `PATH`.
- Built local OpenClaw source at `/Users/bingbingbai/Desktop/openclaw`:
  - `pnpm install`
  - `pnpm build`
- Verified:
  - `openclaw --version` => `2026.3.3`
  - `openclaw agent --help` works.

### 3.2 Commander install path with OpenClaw runtime

- Temporary colony config:
  - `default_worker_cli: "openclaw"`
  - `workers: [{ "cli": "openclaw", "model": "main", "count": 1 }]`
- Ran:
  - `termite-commander install --colony <tmp-colony>`
- Result:
  - Runtime preflight: `Worker CLIs ready: openclaw`

### 3.3 Worker launch path

- Launched one OpenClaw worker through `OpenCodeLauncher`.
- Observed:
  - Worker process starts.
  - Session ID assigned and persisted in launcher worker state.
- Failure reason (expected environment issue, not integration wiring):
  - Missing Anthropic API key in OpenClaw agent auth profile.

## 4. Operational Notes

1. OpenClaw runtime semantic:
   - Worker `model` field is treated as OpenClaw `agent-id` (not LLM model slug).
2. OpenClaw command requirements:
   - `openclaw agent` requires route context (`--agent` or `--to` or `--session-id`).
   - Commander now guarantees valid route args in launcher path.
3. To run OpenClaw workers in real tasks:
   - Configure provider credentials in OpenClaw agent auth (`openclaw agents ...` / auth profile).
   - Optional: run gateway service; otherwise OpenClaw may fall back to embedded mode.
