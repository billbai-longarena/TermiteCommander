# Commander UX Layer Design — 对话式 TUI + 跨平台集成

**Date**: 2026-03-04
**Status**: Draft
**Depends on**: `2026-03-04-termite-commander-design.md` (core engine, done)

---

## 1. 设计目标

1. **Claude Code / OpenCode 无缝调用** — 用户在 Claude Code 或 OpenCode 中可以直接操作 Commander，体验与原生命令一致
2. **独立 REPL 交互** — Commander 直接运行时，对话体验类似 Claude Code：输入自然语言，Commander 理解并执行
3. **蚁群 Dashboard** — 实时可视化蚁群状态（信号进度、工人状态、心跳健康度）
4. **技能迁移** — 会用 Claude Code 的人立刻会用 Commander，无学习成本

## 2. 三个入口的交互设计

### 2.1 入口 1: Claude Code 内调用

**实现方式**: Claude Code Plugin (hooks + commands)

```
用户在 Claude Code 中:
  > /commander 分析sage项目的架构并改进

Claude Code 识别 /commander skill:
  → 调用 termite-commander 进程
  → 实时输出 Commander 的规划过程
  → 后台启动心跳和工人
  → 回到 Claude Code 会话，工人在后台工作

用户继续在 Claude Code 中:
  > /commander status
  → 显示 Dashboard 快照

  > /commander stop
  → 停止所有工人和心跳
```

**Plugin 文件结构:**

```
.claude/plugins/termite-commander/
├── plugin.json
├── hooks/
│   └── hooks.json          # UserPromptSubmit: 检测 /commander 前缀
└── scripts/
    └── commander-bridge.sh  # 调用 termite-commander 进程
```

**关键设计**: Commander 进程在后台持续运行（detached），Claude Code 会话关闭不影响工人工作。用户下次打开 Claude Code 时可以 `/commander status` 查看进度。

### 2.2 入口 2: OpenCode 内调用

**实现方式**: OpenCode Skill + Command

```
用户在 OpenCode 中:
  > /commander 调研新能源行业趋势

OpenCode 加载 commander skill:
  → 调用 termite-commander 进程
  → 实时流式输出规划过程
  → 后台启动心跳和工人

  > /commander status
  > /commander stop
```

**Skill 文件:**

```
.opencode/skill/commander/
├── SKILL.md              # /commander 命令定义
└── dashboard.md          # 状态查询指令
```

### 2.3 入口 3: Commander 独立 REPL (TUI)

**实现方式**: Ink (React for Terminal) + blessed-contrib 风格 Dashboard

```bash
$ termite-commander
```

启动后进入 TUI：

```
┌─ Termite Commander v0.1.0 ────────────────────────────────┐
│                                                            │
│  Colony: /Users/bingbingbai/Desktop/sage                   │
│  Protocol: v5.1 │ Workers: 0 │ Signals: 0                 │
│                                                            │
│  > _                                                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

用户输入后：

```
┌─ Termite Commander v0.1.0 ────────────────────────────────┐
│                                                            │
│  > 分析sage项目的代码结构并给出改进计划                     │
│                                                            │
│  [Phase 0] 任务分类: ANALYZE                               │
│  [Phase 1] 调研中... ━━━━━━━━━━━━━━━━━━━━ 完成             │
│  [Phase 2] 模拟用户场景... ━━━━━━━━━━━━━━ 完成             │
│  [Phase 3] 设计架构分析... ━━━━━━━━━━━━━━ 完成             │
│  [Phase 4] 信号分解: 13 个信号                              │
│  [Phase 5] 质量标准: 已定义                                 │
│                                                            │
│  ┌─ Colony Dashboard ─────────────────────────────────┐    │
│  │                                                     │    │
│  │  Signals    ████████████░░░░░░░░ 7/13 (54%)        │    │
│  │  Workers    ●●●○  3 active, 1 idle                 │    │
│  │  Commits    12 total, last: 45s ago                │    │
│  │  Heartbeat  ♥ Commander: 60s │ Colony: 15s         │    │
│  │                                                     │    │
│  │  Recent Activity:                                   │    │
│  │  ✓ S-001 收集仓库结构         done    (worker-1)   │    │
│  │  ✓ S-003 前端架构现状         done    (worker-2)   │    │
│  │  ✓ S-004 后端架构现状         done    (worker-3)   │    │
│  │  ● S-006 架构5分制打分        claimed (worker-1)   │    │
│  │  ● S-007 技术债Top10          claimed (worker-2)   │    │
│  │  ○ S-010 Phase1改进计划       open                 │    │
│  │  ○ S-011 Phase2重构计划       open                 │    │
│  │                                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                            │
│  > _                                                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 2.4 Commander 对话能力范围

Commander **只做两件事**：

1. **把人类指令转化为蚁群行动** — 规划、分解、dispatch、启动工人
2. **向人类说明蚁群状况** — Dashboard、信号状态、工人状态、建议

Commander **不做**：
- 不直接写代码（那是工人的事）
- 不直接读文件做分析（那是工人的事）
- 不做 Claude Code 能做的一切通用任务

**对话示例：**

```
> 分析sage项目的架构           → 规划 + dispatch + 启动工人
> 再加2个工人                   → 启动额外工人
> S-007 什么情况？              → 查询信号状态 + 工人活动
> 暂停一下                      → 停止心跳，工人完成当前任务后闲置
> 继续                          → 恢复心跳
> 这批信号质量不行，重新规划    → 停止当前 + 重新 plan
> 把结果汇总给我                → 读取已完成信号的产出，生成摘要
```

## 3. Dashboard 模板设计

### 3.1 总览 Dashboard (默认)

```
┌─ Colony: sage ──────────────────────────────────────────┐
│                                                          │
│  Progress   ████████████████░░░░░░░░░░░░ 11/18 (61%)   │
│  Workers    ●●●○○  3 running, 2 idle                    │
│  Commits    23 total │ last: 30s ago                    │
│  Heartbeat  ♥ cmd:60s col:15s │ stall: 0/10            │
│  Duration   12m 34s                                     │
│                                                          │
│  ✓ done(11)  ● claimed(3)  ○ open(4)  ⊘ blocked(0)    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 3.2 信号列表 Dashboard

```
┌─ Signals ────────────────────────────────────────────────┐
│                                                           │
│  ID     Type      Title                    Status  Worker │
│  ─────  ────────  ───────────────────────  ──────  ────── │
│  S-001  RESEARCH  收集仓库结构与技术栈      ✓ done  wk-1  │
│  S-002  EXPLORE   绘制前后端数据流图        ✓ done  wk-2  │
│  S-003  RESEARCH  前端架构现状证据          ✓ done  wk-3  │
│  S-004  RESEARCH  后端架构现状证据          ✓ done  wk-1  │
│  S-005  RESEARCH  工程化与质量保障现状      ✓ done  wk-2  │
│  S-006  REVIEW    架构5分制打分             ● wk-1  8m    │
│  S-007  REPORT    技术债Top10              ● wk-2  5m    │
│  S-008  HOLE      前后端接口契约缺口        ● wk-3  2m    │
│  S-009  HOLE      可观测性体系缺口          ○ open        │
│  S-010  REPORT    Phase1改进计划           ○ open        │
│  S-011  REPORT    Phase2重构计划           ○ open        │
│  S-012  REPORT    Phase3架构升级           ○ open        │
│  S-013  REVIEW    可执行性校验             ○ open        │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### 3.3 工人状态 Dashboard

```
┌─ Workers ────────────────────────────────────────────────┐
│                                                           │
│  ID      Status    Signal  Session           Duration    │
│  ──────  ────────  ──────  ────────────────  ─────────   │
│  wk-1   ● running  S-006   ses_347a...3ffel  12m 34s    │
│  wk-2   ● running  S-007   ses_347b...8ak2x   5m 12s    │
│  wk-3   ● running  S-008   ses_347c...9pq3z   2m 45s    │
│  wk-4   ○ idle     —       ses_347d...1bc4y   idle 30s   │
│  wk-5   ○ idle     —       ses_347e...5de6w   idle 15s   │
│                                                           │
│  Total: 3 running, 2 idle, 0 errored                    │
│  Pulse interval: 15s (active)                            │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## 4. 技术选型

### 4.1 TUI 框架

| 选项 | 优点 | 缺点 |
|------|------|------|
| **Ink (React)** | OpenCode 用的同一个框架，生态丰富 | 依赖 React |
| blessed / blessed-contrib | 经典 TUI，dashboard 组件成熟 | API 老旧 |
| @clack/prompts | Claude Code 风格，极简 | 不支持持续 Dashboard |

**推荐: Ink**
- 与 OpenCode 技术栈一致
- 支持 React 组件化（Dashboard 可以作为组件）
- 支持实时更新（setState 驱动重渲染）
- 有 ink-table, ink-spinner, ink-progress-bar 等成熟组件

### 4.2 依赖

```json
{
  "ink": "^5.0.0",
  "ink-text-input": "^6.0.0",
  "ink-spinner": "^5.0.0",
  "ink-table": "^4.0.0",
  "react": "^18.0.0"
}
```

### 4.3 目录结构扩展

```
commander/
├── src/
│   ├── index.ts              # CLI 入口 (已有)
│   ├── tui/                  # 新增: TUI 层
│   │   ├── App.tsx           # 根组件
│   │   ├── CommanderREPL.tsx  # 对话输入框
│   │   ├── PlanningView.tsx   # 规划过程展示
│   │   ├── Dashboard.tsx      # 总览 Dashboard
│   │   ├── SignalList.tsx     # 信号列表
│   │   ├── WorkerList.tsx     # 工人状态
│   │   └── StatusBar.tsx      # 底部状态栏
│   ├── engine/               # 已有: 规划引擎
│   ├── heartbeat/            # 已有: 心跳引擎
│   ├── colony/               # 已有: 蚁丘桥接
│   ├── llm/                  # 已有: LLM 提供方
│   └── audit/                # 已有: 审计
│
├── skills/                   # 已有: OpenCode 白蚁 skill
│   └── termite/
│
├── plugins/                  # 新增: 跨平台集成
│   ├── claude-code/          # Claude Code plugin
│   │   ├── plugin.json
│   │   ├── hooks/hooks.json
│   │   └── scripts/commander-bridge.sh
│   └── opencode/             # OpenCode commander skill
│       └── SKILL.md
│
└── package.json
```

## 5. Claude Code Plugin 设计

### 5.1 plugin.json

```json
{
  "name": "termite-commander",
  "version": "0.1.0",
  "description": "Colony orchestration — plan, dispatch, and monitor termite workers",
  "commands": [
    {
      "name": "commander",
      "description": "Orchestrate colony work: plan objectives, manage workers, view status",
      "arguments": [
        {
          "name": "instruction",
          "description": "What to do (objective, status, stop, etc.)",
          "required": true
        }
      ]
    }
  ]
}
```

### 5.2 hooks.json

```json
{
  "hooks": [
    {
      "event": "UserPromptSubmit",
      "script": "scripts/commander-detect.sh",
      "description": "Detect /commander prefix and route to Commander"
    },
    {
      "event": "SessionStart",
      "script": "scripts/commander-status-check.sh",
      "description": "Check if Commander is running and show status"
    }
  ]
}
```

### 5.3 交互流

```
Claude Code 会话启动:
  SessionStart hook → 检查 commander.lock
    → 如果有: "[Commander] 蚁群正在工作中。输入 /commander status 查看。"
    → 如果没有: 静默

用户输入 /commander <指令>:
  Claude Code 加载 commander skill
    → skill 内容指导 Claude Code:
      1. 解析指令类型 (plan / status / stop / 自然语言)
      2. 调用 termite-commander CLI (nohup 后台)
      3. 流式读取输出返回给用户
      4. 对于 status: 读取蚁丘 DB 生成 Dashboard 文本

用户输入普通内容:
  → Claude Code 正常工作，不受影响
```

## 6. OpenCode Commander Skill 设计

### 6.1 SKILL.md

```markdown
---
name: commander
description: |
  Invoke Termite Commander to orchestrate colony work.
  Use when the user says /commander or asks to plan/manage multi-agent work.
---

# Commander — Colony Orchestration

When invoked, run the Commander CLI to orchestrate termite colony work.

## Commands

- `/commander <objective>` — Plan and execute an objective
- `/commander status` — Show colony Dashboard
- `/commander stop` — Stop all workers and heartbeats
- `/commander resume` — Resume from halted state
- `/commander workers` — Show worker details
- `/commander add <n>` — Add n more workers

## Execution

For plan commands:
  Run: `termite-commander plan "<objective>" --colony . --run`
  Stream output to user.

For status:
  Run: `termite-commander status --colony . --json`
  Format as Dashboard.

For stop:
  Run: `termite-commander stop --colony .`
```

## 7. 实现优先级

| 优先级 | 组件 | 理由 |
|--------|------|------|
| P0 | Claude Code plugin (skill) | 用户当前就在 Claude Code 中，立即可用 |
| P0 | OpenCode commander skill | 对称支持 |
| P1 | Commander REPL (纯文本先行) | 独立使用，文本对话先做 |
| P2 | TUI Dashboard (Ink/React) | 在 REPL 基础上加可视化 |
| P3 | Dashboard 模板预制 | 总览/信号/工人三种视图 |

建议先做 P0（两个 skill），因为这立刻就能让当前体验完整闭环。P1-P3 是 Commander 独立使用时的体验增强。

---

## 8. 实现记录

**日期**: 2026-03-04

### P0: Claude Code Plugin + OpenCode Skill — DONE

- `plugins/claude-code/`: plugin.json, hooks.json (SessionStart), SKILL.md, lib.sh, hook-session-start.sh
- `plugins/opencode/`: SKILL.md

### P1: Commander REPL — DONE

- `src/tui/index.tsx` — TUI 入口，Ink render
- `src/tui/App.tsx` — 根组件，视图路由 (repl/dashboard/signals/workers)
- `src/tui/views/REPLView.tsx` — 对话式交互：命令输入 + 规划进度 + 历史记录
- `src/tui/components/CommandPrompt.tsx` — ink-text-input 输入框
- `src/tui/components/PlanningProgress.tsx` — Phase 0-5 实时进度 (spinner/checkmark)
- `src/tui/hooks/usePipelineStreaming.ts` — Pipeline.plan() 包装器，console.log 截获
- `src/tui/utils/commandParser.ts` — 自然语言 → 命令解析（中英文支持）
- `src/index.ts` — 修改：无子命令时进入 TUI 模式

入口: `termite-commander` (无参数) → 进入 REPL

### P2: TUI Dashboard — DONE

- `src/tui/views/DashboardView.tsx` — 实时监控仪表盘
- `src/tui/components/Dashboard.tsx` — 总览布局：进度条 + 工人状态 + 信号统计
- `src/tui/components/ProgressBar.tsx` — `████████░░░░ 7/13 (54%)`
- `src/tui/components/WorkerStatus.tsx` — `●●●○ 3 running, 1 idle`
- `src/tui/components/ActivityFeed.tsx` — 最近信号活动列表
- `src/tui/hooks/useColonyState.ts` — 轮询 SignalBridge + 读取 lock/status 文件
- `src/tui/utils/colonyReader.ts` — commander.lock / .commander-status.json 读取
- `src/tui/utils/formatters.ts` — 时间/百分比/进度条格式化

### P3: Dashboard 模板 — DONE

- `src/tui/views/DetailView.tsx` — 信号/工人详情视图切换
- `src/tui/components/SignalTable.tsx` — 信号列表表格 (ID/Type/Title/Status/Worker)
- `src/tui/components/WorkerTable.tsx` — 工人状态表格 (ID/Status/Session/Duration)

视图切换快捷键: `d` dashboard / `s` signals / `w` workers / `r` repl / `q` quit

### 技术栈

- Ink 5 + React 18 (Terminal UI)
- ink-text-input (输入框)
- ink-spinner (加载动画)
- TypeScript + ESM + JSX (react-jsx)
