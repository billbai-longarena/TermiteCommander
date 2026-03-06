# termite-commander

Autonomous orchestration CLI for the Termite Protocol.

## Install

```bash
npm install -g termite-commander
```

## Update

```bash
npm update -g termite-commander
```

## Verify

```bash
termite-commander --version
termite-commander --help
```

## Quick Start (First Run)

```bash
cd /path/to/your-project
termite-commander init --colony .
termite-commander plan "Build <objective>" --plan .termite/worker/PLAN.md --colony . --run
```

`init` performs: protocol install (if missing) + skills install + config bootstrap + doctor preflight.

## Requirements

- Node.js >= 18
- Git
- OpenCode / Claude Code / Codex / OpenClaw CLI (based on your worker runtime)

## Required Model Config

Commander decomposition model is required before `plan`:

```json
// termite.config.json (recommended)
{
  "commander": {
    "model": "anthropic/claude-sonnet-4-5"
  }
}
```

Fallbacks: `opencode.json` field `model`, or `COMMANDER_MODEL` env var.

## Config Import and Doctor

```bash
# Dry-run import recommendation
termite-commander config import --from auto

# One-shot bootstrap (recommended for skills)
termite-commander config bootstrap --from auto

# Apply to termite.config.json
termite-commander config import --from auto --apply

# Validate resolved config + provider credentials + worker runtime/model compatibility
termite-commander doctor --config --runtime
```

## Fleet Safety (Stop + Autostart Guard)

```bash
# One-shot stop (daemon + commander + known worker pids)
termite-commander fleet stop --colony .

# macOS launchd autostart check/disable
termite-commander fleet autostart --match termite
termite-commander fleet autostart --match termite --disable
```

Daemon mode is detached-process based by default (not launchd/systemd managed).

## Full Documentation

- English: https://github.com/billbai-longarena/TermiteCommander/blob/master/README.md
- 中文: https://github.com/billbai-longarena/TermiteCommander/blob/master/README.zh-CN.md
