# OpenClaw Worker Runtime 兼容性评估

**日期**: 2026-03-05
**状态**: 调研完成，待决策
**依赖**: openclaw CLI (`~/Desktop/openclaw`)

---

## 1. 背景

TermiteCommander 当前支持三种 Worker 运行时：

| Runtime | 二进制 | 本质 | 模型传入方式 |
|---------|--------|------|-------------|
| opencode | `opencode` | 编码 Agent | `--model <id>` |
| claude | `claude` | 编码 Agent (Claude Code CLI) | `--model <id>` |
| codex | `codex` | 编码 Agent (Codex CLI) | `-m <id>` |

用户希望增加对 **OpenClaw** 的兼容，使 Commander 能将 openclaw 作为第四种 Worker 运行时。

---

## 2. OpenClaw 概览

### 2.1 项目定位

OpenClaw 是一个**个人 AI 助手平台**（版本 2026.3.3），核心能力：

- 运行在本地设备 (macOS, Linux, Windows/WSL2, iOS, Android)
- 连接多种消息通道 (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams 等 20+)
- 本地优先的 Gateway 控制面，管理 session/channel/tool
- 多 Agent 路由，隔离 workspace，per-agent 认证
- 支持语音唤醒、Canvas UI、完整工具访问

**与其他三个 runtime 的本质区别**: opencode/claude/codex 都是**直接编码 Agent**，openclaw 是**多通道 AI 网关**。

### 2.2 技术栈

| 维度 | 详情 |
|------|------|
| 运行时 | Node.js >= 22.12.0 |
| 语言 | TypeScript, ESM (ES2022) |
| 构建 | tsdown (基于 Oxlint/Oxfmt) |
| 包管理 | pnpm v10.23.0+ |
| CLI 框架 | commander v14 |
| Agent 核心 | @mariozechner/pi-agent-core, pi-coding-agent, pi-tui (v0.55.3) |
| LLM 支持 | Anthropic, OpenAI, Azure, AWS Bedrock, 及多种第三方 |
| 数据库 | SQLite (shell), Sessions 存 JSON |
| TUI | Ink 5 + React 18 |
| 配置格式 | JSON5 (支持注释、尾逗号) |

### 2.3 CLI 命令清单

```bash
openclaw setup              # 初始化本地配置和 workspace
openclaw onboard            # 交互式引导
openclaw configure          # 交互式设置凭证、通道、gateway、agent 默认值
openclaw config             # 非交互式配置操作 (get/set/unset/file/validate)
openclaw doctor             # 健康检查
openclaw dashboard          # 打开 Control UI
openclaw agent              # 运行一轮 agent 交互 ← 核心工作命令
openclaw agents             # 管理隔离 agents (list/bind/unbind/add/set-identity)
openclaw message            # 消息管理
openclaw memory             # 记忆搜索和索引
openclaw sessions           # 会话管理
openclaw status             # 通道健康和最近会话
openclaw health             # Gateway 健康检查
openclaw browser            # 管理 OpenClaw 专用浏览器
openclaw reset              # 重置本地配置
openclaw uninstall          # 卸载 gateway + 本地数据
```

---

## 3. OpenClaw 的 Worker 相关接口

### 3.1 `agent` 命令（核心工作命令）

```bash
openclaw agent --message "<prompt>" [options]
```

| 标志 | 说明 |
|------|------|
| `-m, --message <text>` | 发送给 agent 的消息/提示 (必需) |
| `-t, --to <number>` | E.164 格式的接收方号码 (推导 session key) |
| `--session-id <id>` | 使用显式 session ID |
| `--agent <id>` | Agent ID (覆盖路由绑定) |
| `--thinking <level>` | 思考级别: off / minimal / low / medium / high |
| `--verbose <on\|off>` | 持久化 verbose 级别 |
| `--channel <channel>` | 投递通道 |
| `--local` | 本地运行嵌入式 agent (需 shell 中有 API key) |
| `--deliver` | 将回复发回所选通道 |
| `--json` | JSON 格式输出 |
| `--timeout <seconds>` | 覆盖 agent 超时 (默认 600s) |

### 3.2 配置文件

**路径优先级**:
```
OPENCLAW_CONFIG_PATH env var → OPENCLAW_STATE_DIR/openclaw.json → ~/.openclaw/openclaw.json → 旧版目录
```

**格式**: JSON5

**关键配置段**:
```json5
{
  "gateway": {
    "mode": "local|cloud",
    "port": 18789
  },
  "agents": {
    "defaults": {
      "workspace": "~/.openclaw/workspace",
      "heartbeat": { "prompt": "..." }
    },
    "<agent-id>": {
      "workspace": "<path>",
      "model": "<model-id>",
      "authProfileOverride": "<profile>"
    }
  },
  "models": {
    "anthropic": { "apiKey": "sk-..." },
    "openai": { "apiKey": "..." }
  },
  "backends": {
    "claude": {
      "command": "claude",
      "args": ["-p", "--output-format", "json"],
      "modelArg": "--model",
      "sessionArg": "--session-id",
      "output": "json"
    },
    "codex": {
      "command": "codex",
      "args": ["exec", "--json", "--color", "never"],
      "modelArg": "--model",
      "output": "jsonl"
    }
  }
}
```

### 3.3 模型选择机制

OpenClaw **没有 `--model` CLI 标志**。模型通过以下方式选择（优先级从高到低）：

1. Session override: `sessions.<key>.modelOverride`
2. Agent 配置: `agents.<id>.model`
3. Provider failover 链
4. 全局默认

### 3.4 输出格式 (`--json`)

```json
{
  "sessionId": "uuid",
  "sessionKey": "derived-key",
  "output": "agent response text",
  "thinking": "thinking block (if enabled)",
  "tools": ["tool call history"],
  "events": ["structured event stream"],
  "metadata": {
    "timing": {},
    "model": "model-used",
    "provider": "provider-name"
  }
}
```

Session ID 使用 `sessionId` 字段，已在 Commander 的 `SESSION_ID_KEYS` 集合中（`opencode-launcher.ts:310`），无需额外适配。

---

## 4. 与现有 Runtime 的接口对比

| 能力 | opencode | claude | codex | openclaw |
|------|----------|--------|-------|----------|
| **任务命令** | `run <prompt>` | `-p <prompt>` | `exec <prompt>` | `agent -m <prompt>` |
| **模型标志** | `--model` | `--model` | `-m` | **无** ← 关键差异 |
| **工作目录** | `--dir <path>` | CWD | `-C <path>` | **无** ← 关键差异 |
| **会话恢复** | `--session <id>` | `--session-id <id>` | `resume <id>` | `--session-id <id>` |
| **JSON 输出** | `--format json` | `--output-format stream-json` | `--json` | `--json` |
| **Session ID 提取** | JSON stdout | JSON stdout | JSON stdout | JSON `sessionId` 字段 |
| **超时** | 无 | 无 | 无 | `--timeout <s>` |
| **权限模式** | 无 | `--permission-mode` | `--full-auto` | 由 agent config 控制 |
| **本地模式** | N/A (始终本地) | N/A (始终本地) | N/A (始终本地) | `--local` (跳过 gateway) |

### 关键差异

**差异 1: 无 `--model` 标志**

Commander 当前架构假设所有 Worker CLI 接受 `--model <id>` 动态指定模型。OpenClaw 打破了这个假设——模型绑定在 openclaw config 的 agent 配置或 session override 里。

**差异 2: 无工作目录标志**

opencode 有 `--dir`，codex 有 `-C`，claude 用 CWD。OpenClaw 的 `agent` 命令没有工作目录参数——由 agent workspace 配置决定。但 `spawnWorkerProcess` 的 `cwd` 参数可以部分解决（`--local` 模式下 agent 应使用 CWD）。

**差异 3: Gateway vs 直接执行**

其他三个 runtime 都是直接在本地执行编码任务。OpenClaw 默认走 gateway 路由，需要 `--local` 标志才能直接本地执行。

---

## 5. 适配方案

### 方案 A: `--local` 模式 + 预配置

**思路**: 用 `--local` 跳过 gateway，模型由 openclaw.json 预设。

```bash
openclaw agent --message "<prompt>" --local --json --timeout 600 [--session-id <id>]
```

**优点**:
- 实现简单，改动最小
- 行为接近其他三个 runtime（本地执行）

**缺点**:
- Commander 无法动态指定模型
- 混合模型编排（`"openclaw@haiku:2, openclaw@sonnet:1"`）不可行
- 用户需在 openclaw config 里预设好默认模型
- `--local` 需要 shell 里有 API key

**Worker spec 格式**: `openclaw:3`（只有数量，模型固定）

### 方案 B: Gateway 模式 + Agent Binding（推荐）

**思路**: 预先在 openclaw 里配好多个 agent（不同模型/workspace），Commander 通过 `--agent <id>` 选择。

```bash
openclaw agent --agent <agent-id> --message "<prompt>" --json --session-id <id> --timeout 600
```

**优点**:
- 利用 openclaw 核心能力（多 agent 管理、failover、session 管理）
- `worker.model` 字段复用为 `agent-id`，不破坏数据结构
- Worker spec `"openclaw@coding-haiku:2"` 语义清晰（`coding-haiku` = openclaw agent 名）
- 用户可在 openclaw 侧精细控制每个 agent 的模型、workspace、权限
- 支持混合编排：`"openclaw@fast-coder:2, openclaw@deep-thinker:1"`

**缺点**:
- 用户需预配置 openclaw agents，上手成本较高
- `model` 字段语义在 openclaw runtime 下变为 `agent-id`，需文档明确
- 依赖 gateway 运行

**Worker spec 格式**: `openclaw@<agent-id>:<count>`

### 方案对比

| 维度 | 方案 A (--local) | 方案 B (Agent Binding) |
|------|-----------------|----------------------|
| 实现复杂度 | 低 | 中 |
| 模型灵活性 | 无（固定单模型） | 高（多 agent = 多模型） |
| 用户配置成本 | 低 | 中（需预建 openclaw agents） |
| 混合编排 | 不支持 | 支持 |
| Gateway 依赖 | 不需要 | 需要 |
| 离线可用 | 是（只需 API key） | 否（需 gateway 运行） |

**推荐方案 B**，原因：与 Commander 的混合模型编排理念一致，充分利用 openclaw 的多 agent 能力。

---

## 6. 实现改动清单

以下是将 `openclaw` 加入 `WorkerRuntime` 需要改动的所有位置：

### 6.1 类型定义

**文件**: `commander/src/config/model-resolver.ts:13`

```typescript
// 当前
export type WorkerRuntime = "opencode" | "claude" | "codex";

// 改为
export type WorkerRuntime = "opencode" | "claude" | "codex" | "openclaw";
```

### 6.2 二进制注册

**文件**: `commander/src/colony/opencode-launcher.ts:18-22`

```typescript
// 当前
const RUNTIME_BINARIES: Record<WorkerRuntime, string> = {
  opencode: "opencode",
  claude: "claude",
  codex: "codex",
};

// 加入
//   openclaw: "openclaw",
```

### 6.3 Runtime 规范化

**文件**: `commander/src/config/model-resolver.ts:150-160`

```typescript
// 当前 (line 156)
if (normalized === "opencode" || normalized === "claude" || normalized === "codex") {

// 改为
if (normalized === "opencode" || normalized === "claude" || normalized === "codex" || normalized === "openclaw") {
```

### 6.4 Worker Spec 解析正则

**文件**: `commander/src/config/model-resolver.ts:231`

```typescript
// 当前
const runtimeModelMatch = entry.match(/^(opencode|claude|codex)@(.+?)(?::(\d+))?$/i);

// 改为
const runtimeModelMatch = entry.match(/^(opencode|claude|codex|openclaw)@(.+?)(?::(\d+))?$/i);
```

**文件**: `commander/src/config/model-resolver.ts:241`

```typescript
// 当前
const runtimeCountMatch = entry.match(/^(opencode|claude|codex):(\d+)$/i);

// 改为
const runtimeCountMatch = entry.match(/^(opencode|claude|codex|openclaw):(\d+)$/i);
```

### 6.5 Worker 分发

**文件**: `commander/src/colony/opencode-launcher.ts:212-224`

```typescript
// 在 switch 中加入
case "openclaw":
  await this.runOpenClaw(worker, prompt);
  return;
```

### 6.6 Runtime 实现

**文件**: `commander/src/colony/opencode-launcher.ts` (新方法)

```typescript
private async runOpenClaw(worker: OpenCodeWorker, prompt: string): Promise<void> {
  const args = [
    "agent",
    "--message", prompt,
    "--json",
    "--timeout", "600",
  ];

  // 方案 B: worker.model 复用为 openclaw agent-id
  if (worker.model) {
    args.push("--agent", worker.model);
  }

  if (worker.sessionId) {
    args.push("--session-id", worker.sessionId);
  }

  this.spawnWorkerProcess(worker, "openclaw", args);
}
```

### 6.7 导入验证

**文件**: `commander/src/config/importer.ts:152-156`

```typescript
// 当前 (line 154)
if (cli === "opencode" || cli === "claude" || cli === "codex") {

// 改为
if (cli === "opencode" || cli === "claude" || cli === "codex" || cli === "openclaw") {
```

### 6.8 预检查安装提示

**文件**: `commander/src/engine/pipeline.ts:394-398`

```typescript
// 在 installHints 字典中加入
openclaw: "OpenClaw CLI (https://github.com/...openclaw)",
```

### 6.9 CLI 安装提示

**文件**: `commander/src/index.ts:76-82`

```typescript
// 加入分支
} else if (runtime === "openclaw") {
  console.warn("  - openclaw: install OpenClaw CLI");
}
```

### 6.10 配置读取（新增）

若要从 `openclaw.json` 导入配置（类似当前从 `opencode.json` 导入），需要在 `importer.ts` 中新增 openclaw 配置源：

**文件**: `commander/src/config/importer.ts` (新增 source)

需要支持读取 `~/.openclaw/openclaw.json` (JSON5 格式)，提取：
- `agents.defaults.model` → 默认 worker model
- `agents.<id>.model` → 可用 agent 列表
- `models.*` → 可用 provider 信息

---

## 7. 注意事项

### 7.1 `model` 字段语义变化

对于 openclaw runtime，`WorkerModelSpec.model` 字段的含义从 **LLM model name** 变为 **openclaw agent-id**。

```
# 其他三个 runtime: model = LLM 模型名
opencode@claude-haiku-3-5:2     → model = "claude-haiku-3-5"

# openclaw runtime: model = agent-id
openclaw@coding-haiku:2         → model = "coding-haiku" (openclaw 中的 agent 名)
```

这需要在文档和 `--json` 状态输出中明确说明。

### 7.2 JSON5 解析

OpenClaw 使用 JSON5 配置格式（支持注释、尾逗号、无引号 key）。若要从 openclaw.json 导入配置，需要引入 JSON5 解析：

- 当前 Commander 使用手写 JSONC 注释剥离 (`model-resolver.ts` 的 `stripJsoncComments`)
- JSON5 是 JSONC 的超集，当前方法无法处理无引号 key 等语法
- 建议引入 `json5` npm 包 (1.5KB，零依赖)

### 7.3 Gateway 生命周期

方案 B 依赖 openclaw gateway 运行。Commander 需要考虑：

- 预检查中验证 gateway 是否运行 (`openclaw health`)
- 或在 `checkRuntime()` 中除了 `--version` 还检查 gateway 可达性
- 若 gateway 不可用，降级到方案 A (`--local`) 或报错

### 7.4 超时对齐

OpenClaw 自带 `--timeout 600` (10 分钟默认)。这与 Commander 当前无 worker 超时的现状形成对比——实际上 openclaw 是唯一内置超时的 runtime，可作为其他 runtime 补全超时机制的参考。

### 7.5 文件名 & 重命名

当前 worker launcher 文件名为 `opencode-launcher.ts`，已经不准确（承载 3 种 runtime）。加入 openclaw 后更应重命名：

```
opencode-launcher.ts → worker-launcher.ts
OpenCodeWorker → Worker
OpenCodeLauncher → WorkerLauncher
```

此重命名建议已记录在健壮性评估报告中 (L5)。

---

## 8. 测试计划

### 新增测试用例

| 测试 | 描述 |
|------|------|
| `normalizeWorkerRuntime("openclaw")` | 返回 `"openclaw"` |
| `parseWorkerSpec("openclaw:3")` | 解析为 3 个 openclaw worker |
| `parseWorkerSpec("openclaw@coding-agent:2")` | 解析为 2 个指定 agent 的 worker |
| `checkRuntime("openclaw")` | 验证 openclaw 二进制可用性 |
| `runOpenClaw()` args 构造 | 验证 `--agent`, `--session-id`, `--json` 标志正确传入 |
| Session ID 提取 | 从 openclaw `--json` 输出中提取 `sessionId` |

### 现有测试影响

- `model-resolver.test.ts`: 需新增 openclaw 相关解析测试
- `pipeline.test.ts`: 需更新 installHints 和 runtime check mock
- `importer.test.ts`: 若加入 openclaw config 导入，需新增测试

---

## 9. 配置示例

### termite.config.json

```json
{
  "commander": {
    "model": "claude-sonnet-4",
    "default_worker_cli": "openclaw",
    "default_worker_model": "coding-fast",
    "workers": [
      { "cli": "openclaw", "model": "coding-fast", "count": 2 },
      { "cli": "openclaw", "model": "coding-deep", "count": 1 },
      { "cli": "claude", "model": "claude-haiku-3-5", "count": 1 }
    ]
  }
}
```

### 对应的 openclaw.json 配置

```json5
{
  agents: {
    "coding-fast": {
      workspace: "/path/to/colony",
      model: "claude-haiku-3-5",
      // 快速编码 agent，低 thinking
    },
    "coding-deep": {
      workspace: "/path/to/colony",
      model: "claude-sonnet-4",
      // 深度编码 agent，高 thinking
    }
  }
}
```

### 环境变量

```bash
TERMITE_WORKER_CLI=openclaw
TERMITE_WORKERS="openclaw@coding-fast:2,openclaw@coding-deep:1"
```

### CLI 调用

```bash
termite-commander plan "Implement user auth" \
  --colony /path/to/colony \
  --run
```

---

## 10. 决策待定

| 问题 | 选项 | 建议 |
|------|------|------|
| 适配方案选择 | A: --local / B: Agent Binding | **B** — 与混合编排理念一致 |
| model 字段语义 | 保持 model name / 复用为 agent-id | **复用** — 最少改动 |
| Gateway 不可用时 | 报错 / 降级到 --local | 先报错，后续可加降级 |
| JSON5 解析 | 引入 json5 包 / 手写解析 | **引入 json5** — 1.5KB，零依赖 |
| 文件重命名 | 现在做 / 延后 | **延后** — 避免与功能改动混合 |
| 是否同步读取 openclaw config | 是 / 否 | **是** — 用于 config import 和 doctor |
