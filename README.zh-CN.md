[English](README.md)

# Termite Commander

**让一群便宜的 AI 模型替你写代码，由一个聪明的模型指挥。**

---

## 概述

Termite Commander 是一个**多模型编排引擎**，将 AI 编码工作分配给强模型（规划）和廉价模型（执行）。你在 Claude Code 中做设计，Commander 把设计方案分解为原子信号，然后一群 Haiku/Gemini 级别的工人并行执行。

基于 [白蚁协议（Termite Protocol）](https://github.com/billbai-longarena/Termite-Protocol) 构建——一套经过 **6 个生产蚁丘、900+ 次提交、4 次多模型审计实验**验证的实战框架。

**核心指标**：在 touchcli A-005 实验中，1 个 Codex 牧羊人 + 2 个 Haiku 工人的配置实现了 **96.4% 的观察质量**——几乎与纯强模型产出持平——我们称之为 **Shepherd Effect（牧羊效应）**。

---

## 要解决的问题

### 单模型编码 Agent 的成本结构有问题

```
人类 → Claude Code (Sonnet/Opus) → 串行工作 → $$$
```

你在为 Haiku 就能完成的工作支付强模型价格——**前提是任务被精确定义到位**。

### 现有多 Agent 方案没抓住真正的问题

| 框架 | 协调方式 | 为什么解决不了成本问题 |
| --- | --- | --- |
| **CrewAI / AutoGen** | Agent 对话 | 所有 Agent 都需要强模型来维持对话上下文。弱模型在多轮讨论中幻觉。无持久记忆——每次会话从零开始。 |
| **LangGraph** | 静态工作流图 | 预定义流程，无法动态认领任务。不能适应并行工人的不同完成速度。 |
| **OpenAI Swarm** | Agent 间移交 | 顺序移交，不是并行执行。一次只有一个 Agent 活跃。 |
| **Devin / Codex CLI** | 单 Agent 长会话 | 无并行、无弱模型委托。一个模型做所有事。 |
| **MetaGPT** | 角色扮演模拟 | PM、架构师、工程师全需要强模型。对话开销随 Agent 数量线性增长。 |

**共同失败点**：这些框架通过**对话**或**消息传递**协调 Agent。这要求每个 Agent 理解上下文、维持连贯对话、推理其他 Agent 的状态——恰恰是弱模型做不到的事。

**我们的洞察**：瓶颈不是"Agent 怎么对话"——而是**"如何把工作精确定义到让廉价模型不需要理解任何其他东西就能执行"**。

---

## 为什么选择 Termite Commander + 白蚁协议

### 1. 环境承载智能，而非 Agent 承载智能

这是与所有对话式多 Agent 框架的根本区别。

在 CrewAI/AutoGen 中，智能在 **Agent 内部**——它们推理、讨论、规划。在白蚁协议中，智能在**环境里**——SQLite 中的信号、文件中的信息素、信息素链中的行为模板。Agent 是无状态的执行器，感知环境并行动。

```
CrewAI:    聪明Agent ↔ 聪明Agent ↔ 聪明Agent（对话协调）
白蚁协议:   Agent → 环境 → Agent → 环境 → Agent（环境协调）
```

为什么这很重要：**弱模型不需要"聪明"。它只需要感知信号并遵循模板。** 环境负责协调。

### 2. 牧羊效应（Shepherd Effect）— 实测 18 倍质量提升

我们最重要的发现，经过 4 次审计实验验证：

| 配置 | 观察质量 | 交接质量 | 来源 |
| --- | --- | --- | --- |
| 2 Haiku 独立工作 | **35.7%** | 0% | A-003 ReactiveArmor |
| 1 Codex + 2 Haiku | **96.4%** | 99% | A-005 touchcli |
| 5 模型混合群（稀释） | **57%** | 100% | A-006 touchcli |

**机制**：强模型（Codex/Sonnet）先在蚁丘中工作，留下高质量的信息素沉积——带有完整 pattern/context/detail 结构的观察。后续弱模型通过 `.birth` 文件中的 `observation_example` **以上下文学习（in-context learning）模仿这些模板**。

这不是训练，不是微调，而是**环境放大**——强模型改善环境，环境让弱模型变得高效。

**A-003 vs A-005 的关键发现**：弱模型不是"不能"做高质量工作，而是不能**发起**高质量模式。给它一个模板来模仿，Haiku 在 96% 的情况下产出与 Codex 无法区分的工作。

### 3. .birth 压缩：800 Token 初始化任何 Agent

其他框架让 Agent 背负整个上下文窗口的文档。白蚁协议将全部协调状态压缩进一个 `.birth` 文件——**不到 800 token**——由 `field-arrive.sh` 动态计算：

| 方案 | Agent 上下文消耗 | Agent 需要阅读什么 |
| --- | --- | --- |
| 直接阅读协议 (v2) | ~40% 上下文窗口 | 28K token TERMITE_PROTOCOL.md |
| 白蚁 .birth (v3+) | **~2%** 上下文窗口 | 800 token 动态计算快照 |
| CrewAI 角色 prompt | ~10-15% | 角色描述 + 对话历史 |
| AutoGen 系统 prompt | ~5-10% | 系统消息 + 增长的聊天记录 |

`.birth` 文件包含：蚁丘当前状态、最高优先级未认领信号、行为模板（牧羊效应示范）、4 条安全规则和恢复提示。Agent 需要知道的一切，不多不少。

### 4. 原子信号认领：无对话、无冲突、无瓶颈

Agent 之间从不交流。它们通过 SQLite 原子事务认领信号：

```
Agent 到达 → 读 .birth → 看到未认领信号 →
  field-claim.sh claim S-007 → EXCLUSIVE 锁 → 成功 →
  执行任务 → 提交 → field-deposit.sh → 完成
```

- **无调度器瓶颈**：Agent 自组织，自主认领可用工作
- **无冲突**：数据库原子认领，不会双重分配
- **崩溃恢复**：Agent 死亡后，认领超时自动释放（修复了 A-006 中发现的 63 分钟饥饿问题）
- **叶优先**：`.birth` 优先显示最深层未认领信号，最大化并行度

### 5. 真实生产数据，不是基准测试

我们没有合成基准测试。我们有**真实的多模型蚁丘审计**和详细发现：

| 蚁丘 | 模型配置 | 时长 | 提交 | 信号 | 关键发现 |
| --- | --- | --- | --- | --- | --- |
| **ReactiveArmor** (A-003) | Codex + 2 Haiku | — | 121 | 24 | 弱模型执行协议循环成功，判断行为失败（验证 F-009c） |
| **touchcli** (A-005) | Codex + 2 Haiku | 6h | 130 | 6 | **牧羊效应**：通过信息素模板实现 96.4% 质量 |
| **touchcli** (A-006) | 5 模型 | 17h | **562** | 113 | 最高吞吐；规模化后稀释退化 |
| **SalesTouch** (0227) | 生产环境 | 持续 | — | — | 稳定生产参考蚁丘 |

A-005 交付了完整 MVP：PostgreSQL（11 表）、REST API（11 端点）、React/Vite 前端、Docker 容器化——全部由 1 个 Codex 牧羊人 + 2 个 Haiku 工人完成。

### 6. Commander 的信号分解：补上最后一块拼图

白蚁协议提供协调基础设施。Commander 补上**分解智能**：

```
PLAN.md（你的设计方案）
  ↓ Commander（1 次强模型 LLM 调用）
  ↓
信号 1: "创建 src/middleware/auth.ts: JWT 验证中间件。
         检查 Authorization 头，用 JWT_SECRET 验证，
         成功则 next()，失败则 401。使用 jsonwebtoken。"

信号 2: "创建 src/routes/auth.ts: POST /login 验证
         邮箱+密码，返回 {token, user}。"

信号 3: "在 .env.example 添加 JWT_SECRET，更新 README 认证部分。"
```

每个信号遵循**弱模型执行标准**：
- **一个文件、一个动作** —— 无需跨文件协调
- **所有上下文内嵌** —— 文件路径、函数签名、预期行为都写在信号文本中
- **明确的验收标准** —— 模型知道什么时候算完成
- **最大深度 3** —— 扁平依赖树，最大化并行度

---

## 适用场景

### 理想场景

| 场景 | 为什么适合 | 示例 |
| --- | --- | --- |
| **设计完成后的功能实现** | 设计已完成，执行可并行 | "按照 PLAN.md 构建认证系统" |
| **大规模重构** | 大量独立文件改动 | "把所有 API 路由从 Express 迁移到 Fastify" |
| **测试套件创建** | 每个测试文件独立 | "为所有 service 模块添加单元测试" |
| **文档生成** | 每个文档独立 | "为所有 API 端点生成文档" |
| **依赖迁移** | 重复的逐文件改动 | "把所有 React class 组件升级为 hooks" |
| **多模块脚手架** | 并行文件创建 | "为 8 个数据库模型创建 CRUD 端点" |

### 不理想场景

| 场景 | 为什么不适合 | 建议 |
| --- | --- | --- |
| **探索性调研** | 需要强模型判断，不是并行执行 | 直接用 Claude Code |
| **架构设计** | 需要跨代码库的整体理解 | 直接用 Claude Code |
| **调试跨模块问题** | 需要跨文件追踪依赖 | 直接用 Claude Code |
| **单文件深度重构** | 没有并行收益 | 直接用 Claude Code |
| **需求不明确** | 弱模型无法消解歧义 | 先做设计，再用 Commander |

**经验法则**：如果你能在开始前就把工作分解为独立的文件级任务——Commander 能加速它。如果工作需要边做边发现该做什么——直接用 Claude Code。

---

## 工作原理

```
┌─────────────────────────────────────────────────────┐
│  你 + Claude Code / OpenCode                         │
│  调研、设计、架构（强模型）                              │
│  产出: PLAN.md                                       │
└────────────────────┬────────────────────────────────┘
                     │ /commander
                     ▼
┌─────────────────────────────────────────────────────┐
│  Commander 引擎（2 次 LLM 调用）                      │
│  1. 分类任务（BUILD / HYBRID）                        │
│  2. 分解 → 弱模型可执行的原子信号                       │
│  3. 自动安装协议 + 创世（如需要）                        │
│  4. 发布信号 → SQLite 数据库                           │
│  5. 启动混合模型工人舰队                                │
│  6. 双层心跳 + 熔断器                                  │
└────────────────────┬────────────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐
     │ Sonnet  │ │ Haiku   │ │ Haiku   │
     │（难任务）│ │（常规） │ │（常规） │
     └────┬────┘ └────┬────┘ └────┬────┘
          │          │          │
     认领 → 执行 → 提交 → 沉积信息素
     （牧羊效应：强模型的沉积
      成为弱模型模仿的模板）
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  TUI 仪表盘（全屏，类 htop 风格）                      │
│  信号 • 工人 • Git 提交 • 活动日志                     │
└─────────────────────────────────────────────────────┘
```

---

## 快速开始

### 前置条件

- **Node.js 18+**
- **OpenCode** — [github.com/nicepkg/opencode](https://github.com/nicepkg/opencode)（驱动工人 Agent）
- **OpenClaw** — [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)（可选，仅在使用 `openclaw` 工人时需要）
- **LLM 凭证**（按分解模型 provider 选择）：
  - Anthropic：`ANTHROPIC_API_KEY`（或 Foundry 组合 `ANTHROPIC_FOUNDRY_API_KEY` + `ANTHROPIC_FOUNDRY_RESOURCE`）
  - OpenAI：`OPENAI_API_KEY`
  - Azure OpenAI：`AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT`
- **Git**

### 第 0 步：安装 Commander（一次性，全局）

Commander 是全局 CLI 工具，安装一次，任何项目都能用。

```bash
# 推荐：npm 一键安装
npm install -g termite-commander

# 或：一键脚本（优先 npm，失败则 git checkout + 全局安装）
curl -fsSL https://raw.githubusercontent.com/billbai-longarena/TermiteCommander/master/install.sh | bash
```

验证安装：
```bash
termite-commander --version
```

升级到最新版本：
```bash
npm update -g termite-commander
```

查看全局包是否过期：
```bash
npm outdated -g --depth=0
```

> **关于白蚁协议**：不需要手动安装。Commander 首次运行 `--run` 时自动检测，如果目标项目没有白蚁协议，Commander 会自动从 GitHub 克隆并安装。

### 7 步工作流

**第 1 步** — 进入项目，启动 Claude Code（或 OpenCode）：
```bash
cd ~/your-project
claude    # 或: opencode
```

**第 2 步** — 一键初始化（推荐）：
```bash
termite-commander init --colony .
```
会自动完成：
- 白蚁协议安装（缺失时）：创建 `AGENTS.md` / `CLAUDE.md` + scripts/signals
- Commander skills/plugin 安装
- 从 opencode/claude/codex 配置导入模型配置
- doctor 预检（`config + credentials + runtime/model smoke`）

安装到项目的内容：
- `.claude/plugins/termite-commander/` — Claude Code 插件（SessionStart hook + /commander skill）
- `.opencode/skill/commander/` — OpenCode 的 commander skill
- `.opencode/skill/termite/` — 白蚁协议 skill（工人用来认领信号、沉积信息素）
- `.termite/human/` — 人类草稿区（默认不作为工人上下文）
- `.termite/worker/` — 工人上下文区（默认 `PLAN.md` 位置）

安装后 Claude Code 识别 `/commander` 和自然语言触发（"让蚁群干活"、"deploy termites"）。

**第 3 步** — 在 Claude Code 中做设计：
```
> 帮我设计一个 OAuth2 认证系统。
> 把最终可执行方案写到 .termite/worker/PLAN.md。
```
设计质量直接决定蚁群产出质量。花时间在这步。

**第 4 步** — 配置工人运行时 + 模型（可选，有默认值）：
```bash
# 默认: opencode + 3 个 Haiku 工人，Sonnet 做信号分解
export TERMITE_WORKER_CLI=opencode

# 推荐混合舰队（支持 opencode / claude / codex / openclaw）
export TERMITE_WORKERS=opencode@haiku:2,claude@sonnet:1,codex@gpt-5-codex:1

# OpenClaw 工人（model 字段 = OpenClaw agent-id）
export TERMITE_WORKERS=openclaw@main:1
```

**第 5 步** — 启动蚁群：
```
> /commander 按照 .termite/worker/PLAN.md 开始施工
```
Commander 自动完成全链路：检测白蚁协议（没有则从 GitHub 安装）→ 创世 → 信号分解 → 发布 → 启动工人 → 心跳监控。

**第 6 步** — 另开终端看仪表盘：
```bash
cd ~/your-project && termite-commander dashboard --mode auto
```

**第 7 步** — 蚁群完成后自动停止。查看结果：
```
> /commander status
> 读 HALT.md，总结蚁群完成了什么
```

---

## 模型配置

**优先级**：`termite.config.json` > `opencode.json` > 环境变量 > 默认值  
（`commander` 分解模型**没有默认值**，必须配置）

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `COMMANDER_MODEL` | 强模型（信号分解，环境变量兜底） | `（必填）` |
| `TERMITE_WORKER_CLI` | 默认工人运行时（`opencode` / `claude` / `codex` / `openclaw`） | `opencode` |
| `TERMITE_MODEL` | 默认弱模型（工人） | `claude-haiku-3-5` |
| `TERMITE_WORKERS` | 舰队配置（`count`、`model:count`、`cli@model:count`） | `3`（3 个默认模型） |

建议先做配置导入与诊断（自动读取 opencode / claude / codex 配置并推荐）：
```bash
# 仅预览候选配置和置信度
termite-commander config import --from auto

# 一键工具（适合 skill 触发）：导入 + 合并 + 诊断
termite-commander config bootstrap --from auto

# 应用到 termite.config.json（默认保留已存在字段）
termite-commander config import --from auto --apply

# 强制覆盖 termite.config.json 中已有字段
termite-commander config import --from auto --apply --force

# 诊断配置（缺失分解模型或 provider 凭证时返回非 0）
termite-commander doctor --config --runtime
```

```bash
# 推荐主配置：termite.config.json
# {
#   "commander": {
#     "model": "anthropic/claude-sonnet-4-5",
#     "default_worker_cli": "opencode",
#     "default_worker_model": "anthropic/claude-haiku-3-5",
#     "workers": [
#       {"cli":"opencode","model":"anthropic/claude-sonnet-4-5","count":1},
#       {"cli":"opencode","model":"anthropic/claude-haiku-3-5","count":2}
#     ]
#   }
# }

# 统一舰队
export TERMITE_WORKERS=3

# 旧语法（仅默认运行时）
export TERMITE_WORKERS=sonnet:1,haiku:2,gemini-flash:1

# 混合 CLI 舰队
export TERMITE_WORKERS=opencode@haiku:2,claude@sonnet:1,codex@gpt-5-codex:1

# OpenClaw 工人（model 表示 agent-id）
export TERMITE_WORKERS=openclaw@main:1

# 通过 opencode.json 配置
# {
#   "model": "anthropic/claude-sonnet-4-5",
#   "small_model_cli": "opencode",
#   "small_model": "anthropic/claude-haiku-3-5",
#   "commander": {
#     "default_worker_cli": "opencode",
#     "workers": [
#       {"cli":"opencode","model":"haiku","count":2},
#       {"cli":"claude","model":"sonnet","count":1},
#       {"cli":"codex","model":"gpt-5-codex","count":1}
#     ]
#   }
# }
```

OpenClaw 说明：`openclaw agent` 必须具备路由上下文（`--agent` / `--to` / `--session-id`）。Commander 现在会保证路由参数合法，并跟踪 OpenClaw 工人的 session ID。

**推荐配置**：1 个强模型工人 (Sonnet) + N 个弱模型工人 (Haiku)。强模型工人的信息素沉积成为模板，通过牧羊效应放大弱模型工人的产出质量。

---

## CLI 参考

```
termite-commander                      仪表盘自动模式（TTY 起 TUI，agent 会话可退化 watch）
termite-commander dashboard            显式仪表盘命令（auto/tui/watch/off）
termite-commander init                 一键初始化（协议 + skills + 配置导入 + 诊断）
termite-commander install              安装 skills 到项目
termite-commander plan <目标>          分解并执行
  --plan <文件>                          设计文档作为上下文
  --context <文本>                       直接文本上下文
  --colony <路径>                        蚁丘根目录（默认: 当前目录）
  --run                                  完整执行模式
  --dispatch                             仅发布信号
termite-commander status [--json]      蚁丘状态
termite-commander config import         从其他 CLI 配置导入/推荐模型配置
  --from <auto|opencode|claude|codex>    来源选择（默认 auto）
  --apply                                 写入 termite.config.json
  --force                                 覆盖已有字段
termite-commander config bootstrap      一键导入+合并+诊断（适合 skill 触发）
  --from <auto|opencode|claude|codex>    来源选择（默认 auto）
  --force                                 覆盖已有字段
termite-commander doctor [--config] [--credentials] [--runtime]  运行诊断（配置/凭证/运行时错误时非 0 退出）
termite-commander daemon start <目标>    后台启动 Commander（继承当前 shell 的 env + PATH）
termite-commander daemon status        查看 daemon 元数据与存活状态
termite-commander daemon stop          停止 daemon 与 Commander 运行
termite-commander workers [--json]     工人状态
termite-commander logs                 输出 issue 诊断日志（优先 `.commander.events.log`）
termite-commander stop                 停止所有 + 清理过期状态
termite-commander resume               从暂停恢复
termite-commander watch                轮询状态（非 TUI）
```

---

## TUI 仪表盘

全屏终端仪表盘（alternate screen buffer）：

- **信号进度** — 进度条 + 数据库全量信号列表（状态/类型/工人）
- **信号详情** — 完整信号内容（`next_hint`、父子关系、module/tags、parked 元信息）
- **工人状态** — 模型标签、会话 ID、运行时长、过期检测（死亡工人标记清理指引）
- **Git 提交** — 工人提交的实时动态
- **活动日志** — 优先跟踪 `.commander.events.log`（无则回退 `.commander.log`）
- **自适应宽度** — 根据终端宽度动态调整

---

## 后台 / Daemon 模式

推荐使用内置 daemon 命令做持续后台运行：

```bash
termite-commander daemon start "实现 OAuth2 认证" --plan .termite/worker/PLAN.md --colony .
termite-commander daemon status --colony .
termite-commander daemon stop --colony .
```

daemon 日志路径：
- `.termite/logs/commander-daemon.out.log`
- `.termite/logs/commander-daemon.err.log`

### launchd/systemd 注意事项

- 服务托管不会自动继承交互 shell 的环境变量。
- daemon 场景下的 API Key 缺失通常是环境注入问题，不是 Commander 逻辑问题。
- 服务上下文中的 `PATH` 往往与交互终端不同；要确保 `opencode` / `codex` / `claude` 可执行。
- 推荐启动前检查：
  1. `termite-commander doctor --config --credentials --runtime --colony .`
  2. `termite-commander daemon start "<目标>" --colony .`

---

## 架构

```
commander/src/
  config/model-resolver.ts     # termite.config + opencode + env → 模型解析
  config/importer.ts           # 从 opencode/claude/codex 导入与推荐配置
  engine/
    pipeline.ts                # 2 阶段：分类 → 分解
    classifier.ts              # BUILD / HYBRID
    decomposer.ts              # 弱模型信号标准
  colony/
    signal-bridge.ts           # SQLite DB，通过白蚁协议场脚本访问
    opencode-launcher.ts       # 混合模型工人舰队（opencode/claude/codex/openclaw）
    providers/                 # Provider 合约 + native-cli/openclaw 适配器
    plan-writer.ts / halt-writer.ts
  heartbeat/
    commander-loop.ts          # 60 秒战略监控
    colony-loop.ts             # 15-60 秒自适应工人脉冲
    circuit-breaker.ts         # 双层熔断（完成 + 停滞）
  tui/
    MonitorApp.tsx             # 全屏 Ink/React 仪表盘
    components/                # ProgressBar, SignalList, WorkerTable, CommitFeed, ActivityLog
    hooks/                     # useColonyState, useGitCommits, useLogTail
```

97 个测试，13 个测试套件。`npm run build && npm test`。

---

## 协议集成

| 功能 | 提供方 | 实现方式 |
| --- | --- | --- |
| 信号数据库 + 原子认领 | 白蚁协议 | SQLite + field-claim.sh |
| Agent 初始化 | 白蚁协议 | field-arrive.sh → .birth（<800 token） |
| 跨会话记忆 | 白蚁协议 | 信息素沉积 + 衰减 |
| 牧羊效应模板 | 白蚁协议 | .birth 中的 observation_example |
| **信号分解** | **Commander** | 强模型 → 原子信号 |
| **工人舰队编排** | **Commander** | 混合模型启动 + 心跳 |
| **监控** | **Commander** | TUI + 状态文件 + 活动日志 |

---

## 许可证

MIT
