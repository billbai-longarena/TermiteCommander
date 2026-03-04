# Commander v2 Redesign — 信号分解器 + 只读仪表盘 + 模型联动

**Date**: 2026-03-04
**Status**: Approved
**Depends on**: `2026-03-04-termite-commander-design.md` (v1 core engine)

---

## 1. 设计目标

Commander 从"全能规划器"精简为三个核心职能：

1. **信号分解器** — 把设计方案翻译成弱模型能执行的原子信号
2. **蚁群编排器** — 心跳、工人管理、熔断（保留 v1 不变）
3. **状态监视器** — 只读 TUI 仪表盘，展示丰富的蚁群状态

**不做的事**：调研、模拟、架构设计、质量标准定义 — 这些由 Claude Code/OpenCode 完成。

## 2. 整体架构

```
Claude Code / OpenCode
  ├── 用户做调研、设计、产出方案
  ├── /commander 或 "让蚁群干活" 触发 skill
  └── skill 收集设计上下文，调用 termite-commander CLI
         │
         ▼
   termite-commander plan "<目标>" --plan PLAN.md --run
         │
         ├── 读取设计文档 (PLAN.md 或 --context)
         ├── 信号分解 (强模型, 一次 LLM 调用)
         ├── 验证信号树 (max depth 3, 原子性检查)
         ├── Dispatch → SQLite DB
         ├── 启动混合模型工人 (sonnet×1 + haiku×2 + ...)
         └── 双心跳监控
                │
                ▼
         termite-commander (无参数)
         └── 只读 TUI 仪表盘 (2s 刷新)
              ├── 信号进度 + 完整信号列表 (从 DB)
              ├── 工人状态 + 模型标注
              ├── git commit 实时追踪
              └── Ctrl+C 退出
```

## 3. Pipeline 精简

### 改变前 (6 个阶段)

```
Phase 0: 分类 (RESEARCH/BUILD/ANALYZE/HYBRID)
Phase 1: 调研 (LLM 调用)
Phase 2: 用户模拟 (LLM 调用)
Phase 3: 架构设计 (LLM 调用)
Phase 4: 信号分解 (LLM 调用)
Phase 5: 质量标准 (LLM 调用)
```

### 改变后 (2 个阶段)

```
Phase 0: 分类 (BUILD/HYBRID 两类, 去掉 RESEARCH/ANALYZE)
Phase 1: 信号分解 (强模型, 一次 LLM 调用, 带设计上下文)
```

### CLI 变化

```bash
# 新增 --plan 和 --context 参数
termite-commander plan "<objective>" --plan PLAN.md --colony . --run
termite-commander plan "<objective>" --context "设计摘要文本" --colony . --run

# 无参数 → 只读仪表盘 (替代旧的 REPL)
termite-commander

# 其他命令不变
termite-commander status/stop/workers/resume/watch
```

### 信号分解标准 (核心)

Commander 的唯一 LLM 调用：把设计方案翻译成弱模型能执行的原子信号。

**弱模型信号标准**:
- **原子性**: 单个会话可完成，不需要多轮协调
- **自包含**: title + nextHint 包含所有执行所需信息
- **可验证**: 明确的 acceptanceCriteria
- **扁平依赖**: max depth 3，尽量并行（parentId: null）
- **具体路径**: 指明要改的文件/模块，不要让弱模型自己找
- **类型明确**: HOLE (写代码), EXPLORE (调查), REPORT (写文档), REVIEW (检查)

**好信号 vs 坏信号**:
```
BAD:  "实现认证系统" (太大, haiku 无法一次完成)
GOOD: "创建 src/middleware/auth.ts: JWT 验证中间件，
       检查 Authorization header，有效则 next()，无效返回 401。
       参考 jsonwebtoken 库。验收: 中间件导出且有基础测试。"

BAD:  "优化性能" (含糊, 没有具体方向)
GOOD: "在 src/api/users.ts 的 getUsers 函数中添加 Redis 缓存，
       TTL 300s，key 格式 users:page:{n}。
       验收: 重复请求返回缓存数据，响应时间 <10ms。"
```

## 4. TUI 只读仪表盘

### 数据源

| 数据 | 来源 | 获取方式 |
|------|------|----------|
| 信号完整列表 | termite.db | SignalBridge.listSignals() — 新增 |
| 信号计数 | termite.db | SignalBridge.status() — 已有 |
| Commander 状态 | commander.lock | 文件读取 — 已有 |
| Worker 详情 | .commander-status.json | 文件读取 — 已有 |
| Git commits | git log | child_process.exec — 新增 |
| 模型配置 | 解析结果 | 写入 .commander-status.json — 新增 |

### 布局

```
┌─ Termite Commander ─────────────────────────────────────────┐
│ Colony: sage  |  RUNNING  |  12m 34s                        │
│ Objective: 按照设计文档实现OAuth认证系统                      │
│ Model: sonnet (commander)                                   │
│ Workers: sonnet ×1 | haiku ×2 | gemini-flash ×1            │
├─────────────────────────────────────────────────────────────┤
│ Progress  ████████████░░░░░░░░ 7/13 (54%)                  │
│ Heartbeat ♥ cmd:60s col:15s | stall: 0/10                  │
├─ Signals ───────────────────────────────────────────────────┤
│ S-001  HOLE     创建auth middleware        ✓ done   wk-1   │
│ S-002  HOLE     实现JWT token生成           ✓ done   wk-2   │
│ S-003  EXPLORE  调研OAuth provider接口      ● wk-3   3m     │
│ S-004  HOLE     添加登录路由               ○ open          │
│ ...                                                         │
├─ Recent Commits ────────────────────────────────────────────┤
│ 2m ago  feat: add JWT token generation [termite:worker]     │
│ 5m ago  feat: create auth middleware    [termite:worker]     │
├─ Workers ───────────────────────────────────────────────────┤
│ wk-1  ● running  S-003  sonnet   ses_347a...  12m 34s      │
│ wk-2  ○ idle     —      haiku    ses_347b...  idle 30s     │
│ wk-3  ● running  S-004  haiku    ses_347c...   2m 45s      │
│ wk-4  ● running  S-005  gemini   ses_347d...   1m 12s      │
└─────────────────────────────────────────────────────────────┘
  Ctrl+C to exit | /commander in Claude Code/OpenCode to control
```

### 删除的组件

- `CommandPrompt.tsx` (交互输入)
- `REPLView.tsx` (REPL 视图)
- `DashboardView.tsx` (旧 dashboard)
- `DetailView.tsx` (旧详情视图)
- `commandParser.ts` (命令解析)
- `usePipelineStreaming.ts` (规划进度流)
- `ink-text-input` 依赖

### 新增/改造的组件

- `MonitorApp.tsx` — 根组件，单一仪表盘视图
- `SignalList.tsx` — 从 DB 查询的完整信号列表（替代旧 SignalTable）
- `CommitFeed.tsx` — git log 实时追踪
- `useColonyState.ts` — 增强：新增信号详情 + git commits + 模型信息
- `WorkerTable.tsx` — 增强：新增模型列

## 5. Skills 重设计

### Claude Code Skill (`plugins/claude-code/skills/commander/SKILL.md`)

核心变化：
- 聚焦信号分解标准 + 白蚁协议控制
- 去掉调研/分析相关指引
- 支持多种触发方式
- 包含弱模型信号分解最佳实践
- 包含模型配置指引

触发词: `/commander`, "让蚁群干活", "让白蚁施工", "dispatch to colony", "termite protocol execute", "开始施工", "让白蚁协议干活"

### OpenCode Skill (`plugins/opencode/SKILL.md`)

同步更新，内容精简版。

### 两种衔接方式

1. **读取设计文档**: 用户已有 PLAN.md 或 docs/plans/*.md
   ```bash
   termite-commander plan "<目标>" --plan PLAN.md --colony . --run
   ```

2. **直接传上下文**: skill 从对话中提取设计摘要
   ```bash
   termite-commander plan "<目标>" --context "<设计摘要>" --colony . --run
   ```

## 6. 模型配置

### 两个模型角色

| 角色 | 用途 | 优先级链 |
|------|------|----------|
| Commander (强) | 信号分解 | `COMMANDER_MODEL` > opencode.json `model` > `claude-sonnet-4-5` |
| Workers (弱/混合) | 白蚁执行 | `TERMITE_WORKERS` > opencode.json `commander.workers` > 3×`small_model` |

### Worker 配置格式

**统一配置**:
```bash
TERMITE_WORKERS=3                # 3个工人，全用 TERMITE_MODEL 或 opencode small_model
TERMITE_MODEL=claude-haiku-3-5   # 统一弱模型
```

**混合配置**:
```bash
TERMITE_WORKERS=sonnet:1,haiku:2,gemini-flash:1
```

**opencode.json 配置**:
```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-3-5",
  "commander": {
    "workers": [
      { "model": "anthropic/claude-sonnet-4-5", "count": 1 },
      { "model": "anthropic/claude-haiku-3-5", "count": 2 },
      { "model": "google/gemini-3-flash", "count": 1 }
    ]
  }
}
```

### 读取 opencode.json

查找顺序:
1. `$PWD/opencode.json` 或 `$PWD/.opencode/opencode.json`
2. `~/.config/opencode/opencode.json`
3. 解析 `model` 字段 (格式: `"provider/model"`)

### Provider 映射

Commander 的 LLM provider 继续使用 Vercel AI SDK (@ai-sdk/anthropic, @ai-sdk/openai)。从 opencode.json 的 `provider/model` 格式中提取 provider 名，映射到对应 SDK:

| opencode provider | SDK |
|-------------------|-----|
| `anthropic` | @ai-sdk/anthropic |
| `openai`, `azure` | @ai-sdk/openai |
| 其他 | 抛错，要求用环境变量显式配置 |

## 7. 实现范围

### 改造文件

| 文件 | 改动 |
|------|------|
| `src/engine/pipeline.ts` | 精简为 2 阶段，新增 --plan/--context 读取 |
| `src/engine/classifier.ts` | 简化为 BUILD/HYBRID |
| `src/engine/decomposer.ts` | 增强分解 prompt，加入弱模型标准 |
| `src/llm/provider.ts` | 新增 resolveModels(), 读取 opencode.json |
| `src/colony/signal-bridge.ts` | 新增 listSignals() |
| `src/colony/opencode-launcher.ts` | 支持混合模型工人 |
| `src/index.ts` | CLI 新增 --plan/--context，TUI 改为只读 |
| `plugins/claude-code/skills/commander/SKILL.md` | 重写 |
| `plugins/opencode/SKILL.md` | 重写 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `src/tui/views/REPLView.tsx` | 交互式 REPL 不再需要 |
| `src/tui/views/DashboardView.tsx` | 合并到 MonitorApp |
| `src/tui/views/DetailView.tsx` | 合并到 MonitorApp |
| `src/tui/components/CommandPrompt.tsx` | 无交互输入 |
| `src/tui/utils/commandParser.ts` | 无命令解析 |
| `src/tui/hooks/usePipelineStreaming.ts` | 无规划进度流 |

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/tui/MonitorApp.tsx` | 只读仪表盘根组件 |
| `src/tui/components/CommitFeed.tsx` | git commit 追踪 |
| `src/tui/hooks/useGitCommits.ts` | git log 轮询 |
| `src/config/model-resolver.ts` | opencode.json 读取 + 模型解析 |
