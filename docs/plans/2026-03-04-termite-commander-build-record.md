# Termite Commander — 完整构建记录

**日期**: 2026-03-04
**参与者**: Human (产品方向/架构决策) + Claude Opus 4.6 (设计/实现)
**耗时**: 单次会话完成（设计 + 实现 + 调试 + 端到端验证）

---

## 一、项目背景

TermiteCommander 仓库下有两个已有项目：

1. **TermiteProtocol**（白蚁协议 v5.1）—— 一个跨会话 AI Agent 协作框架，通过信号系统、信息素沉淀、种姓机制实现多 Agent 自主协作。核心理念："所有白蚁是无状态的，环境承载智能。"

2. **OpenCode**（v1.2.16）—— 开源 AI 编码 Agent 平台，支持 40+ 模型，有 skill/plugin 扩展系统。

**问题**：两者独立存在，没有东西把它们串起来。人类用户需要手动规划任务、手动启动 Agent、手动监控进度。

**目标**：构建 Termite Commander —— 一个自主编排引擎，让用户只需输入一句话方向（无论是技术任务还是业务调研），Commander 自主完成从调研到规划到执行的全链路。

---

## 二、设计过程

### 2.1 需求澄清（5 轮交互式问答）

| # | 问题 | 用户选择 | 影响 |
|---|------|---------|------|
| 1 | Commander 运行在什么环境？ | **混合模式**：独立引擎 + 协议接口层 | 不绑定任何 Agent 平台 |
| 2 | 触发方式？ | **混合触发**：CLI + 交互式 + 文件监听 | 适配不同复杂度任务 |
| 3 | 信号优先级？ | **指令信号优先** | Commander 信号权重高于白蚁自发现 |
| 4 | OpenCode 改造程度？ | **Skill/Plugin 层接入** | 零侵入，保持 OpenCode 可独立升级 |
| 5 | Commander 自主范围？ | **全能自主** | 调研、模拟、架构、质量标准全部自主 |

### 2.2 方案选择

提出 3 种架构方案：

- **方案 A: Commander-as-Shell** —— 独立进程，通过文件系统和信号交互
- **方案 B: Commander-as-Agent** —— 作为 OpenCode 内部 Agent
- **方案 C: Commander-as-Protocol-Extension** —— 白蚁协议 v6 扩展

**用户选择：A+C 融合** —— Commander 核心是独立编排引擎，但接口层完全通过白蚁协议的字段脚本和信号系统工作。

### 2.3 关键设计补充

用户提出两个关键修改：

1. **持续心跳机制**：OpenCode 中的 Agent 不会自动连续工作，需要外部持续触发。设计了双心跳（Commander 60s 战略循环 + Colony 15s 执行循环）+ 双层熔断（信号耗尽正常退出 + 停滞异常熔断）。

2. **信号载体防崩坏**：区分 MD（Agent 可自由写）/ SQLite（唯一结构化写入入口）/ YAML（只读导出）/ JSON（原子写入机器状态）四层载体，防止弱模型写坏结构化数据。

3. **非开发者用户支持**：Commander 用户可能是业务人员（"调研新能源行业前十大客户的财报"），不只是开发者。设计了 RESEARCH/BUILD/ANALYZE/HYBRID 四条规划管线。

### 2.4 设计文档

最终设计包含 9 个 Section，逐段确认通过后写入 `docs/plans/2026-03-04-termite-commander-design.md`（578 行）。

---

## 三、实现过程

### 3.1 实现计划

15 个 Task，分 8 个 Phase，TDD 方式，写入 `docs/plans/2026-03-04-termite-commander-implementation.md`（2310 行）。

### 3.2 Subagent-Driven Development

采用 subagent 驱动开发模式：每个 Task 分配独立 subagent 实现，实现后由 spec reviewer 验证合规性。

### 3.3 实现详情

**Phase 1: 项目基础 + 协议桥接**（Tasks 1-5）

| Task | 产物 | 关键点 |
|------|------|--------|
| 1. 项目脚手架 | `commander/package.json`, `tsconfig.json`, `src/index.ts` | ESM + TypeScript + Commander.js CLI |
| 2. Signal Bridge | `src/colony/signal-bridge.ts` + 4 tests | 封装所有 field-*.sh 脚本调用，唯一协议桥接层 |
| 3. field-commander.sh | `TermiteProtocol/templates/scripts/field-commander.sh` | 6 个子命令：status/create-signal/create-signals/update-signal/check-stall/pulse |
| 4. PLAN.md Writer | `src/colony/plan-writer.ts` + 2 tests | 将 Plan 对象渲染为人可读 Markdown |
| 5. HALT.md Writer | `src/colony/halt-writer.ts` + 2 tests | 熔断时生成停机报告 |

**Phase 2: 大脑层**（Tasks 6-7）

| Task | 产物 | 关键点 |
|------|------|--------|
| 6. Task Classifier | `src/engine/classifier.ts` + 4 tests | 启发式 + LLM 双模分类（RESEARCH/BUILD/ANALYZE/HYBRID），中英文 pattern |
| 7. Signal Decomposer | `src/engine/decomposer.ts` + 4 tests | 信号验证、深度限制(max 3)、拓扑排序、LLM decomposition prompt |

**Phase 3: 心跳引擎**（Tasks 8-10）

| Task | 产物 | 关键点 |
|------|------|--------|
| 8. Circuit Breaker | `src/heartbeat/circuit-breaker.ts` + 5 tests | 双层熔断：信号耗尽(complete) + 停滞检测(stall)，进度重置 |
| 9. Commander Loop | `src/heartbeat/commander-loop.ts` | 慢节奏(60s)战略监控，感知→评估→熔断 |
| 10. Colony Loop | `src/heartbeat/colony-loop.ts` | 快节奏(15-60s)自适应，驱动工人持续工作 |

**Phase 4: OpenCode Skill**（Task 11）

| Task | 产物 | 关键点 |
|------|------|--------|
| 11. Termite Skill | `skills/termite/{SKILL,arrive,deposit,molt}.md` | 让 OpenCode Agent 成为协议合规白蚁，零 OpenCode 核心修改 |

**Phase 5: 全局连通**（Task 12）

| Task | 产物 | 关键点 |
|------|------|--------|
| 12. Pipeline + CLI | `src/engine/pipeline.ts` + `src/index.ts` 重写 | 5 阶段规划管线 + 4 个 CLI 命令（plan/status/resume/watch） |

**Phase 6-8: DB/监听/审计**（Tasks 13-15）

| Task | 产物 | 关键点 |
|------|------|--------|
| 13. DB Schema | `commander_state` + `halt_log` 表 | 追踪 Commander 状态和每次熔断记录 |
| 14. DIRECTIVE.md Watcher | `src/input/directive-watcher.ts` | chokidar 文件监听，支持文件驱动指令 |
| 15. Audit Collector | `src/audit/collector.ts` | 审计包导出 + 归档到协议源仓库 |

### 3.4 集成阶段（计划外但必要的工作）

15 个计划内 Task 完成后，进入集成调试阶段：

**问题 1：LLM 还是假的**

用户指出 `generateText` 返回占位符。创建了 3 个新文件：

- `src/llm/provider.ts` —— 封装 Vercel AI SDK，支持 Azure OpenAI + Anthropic Foundry
- `src/colony/opencode-launcher.ts` —— 管理 OpenCode 工人进程
- 更新 `pipeline.ts` + `index.ts` 移除占位符

**问题 2：Azure OpenAI Codex 模型不支持 Chat Completions**

`gpt-5.3-codex` 只支持 Responses API。修复：
- 自动检测 provider（优先 Anthropic）
- Codex 模型自动用 `openai.responses()` 而非 `openai()`
- 支持 Anthropic Foundry（Azure 托管 Claude）动态 base URL

**问题 3：Azure endpoint 硬编码 + 没有全局安装**

- 改为 `AZURE_OPENAI_ENDPOINT` 环境变量
- `npm link` 全局安装为 `termite-commander` 命令

**问题 4：SignalBridge 调用了不存在的 `db_init`**

白蚁协议的真实函数是 `db_ensure`，且需要 `PROJECT_ROOT` + `SCRIPT_DIR` 环境变量。修复：
- 所有 bash snippet 使用统一的 `dbPreamble()`
- 设置正确的环境变量
- `colonyRoot` 解析为绝对路径
- JS 层转义值防止 bash 注入

**问题 5：OpenCode TUI 无法通过 stdin pipe 驱动**

OpenCode 是 TUI 应用（Ink/React），stdin 被终端渲染器消费。调研发现 `opencode run` 命令支持非交互运行。重写 OpenCodeLauncher：
- `opencode run "白蚁协议" --format json --dir <colony>` 替代 `spawn + stdin pipe`
- 首次创建 session，后续通过 `--session <id>` 继续
- 只 pulse idle 状态的 worker（不重复触发 running 的）

---

## 四、端到端验证

### 4.1 测试环境

- **宿主项目**: `~/Desktop/sage` —— 一个简单的类 ChatGPT 对话平台（Vue3 + Express），未安装白蚁协议
- **Commander LLM**: Anthropic claude-sonnet-4-5（通过 Foundry，自动检测）
- **OpenCode 工人 LLM**: OpenCode 默认配置的模型

### 4.2 执行命令

```bash
# 1. 安装白蚁协议到 sage
bash ~/Desktop/TermiteCommander/TermiteProtocol/install.sh ~/Desktop/sage

# 2. 初始化蚁丘
cd ~/Desktop/sage && ./scripts/field-arrive.sh

# 3. Commander 全自动执行
termite-commander plan "分析sage项目代码结构和前后端架构，给出改进计划" --colony . --run
```

### 4.3 执行日志

```
Phase 0: Classifying task...     → ANALYZE
Phase 1: Researching...          → Anthropic claude-sonnet-4-5 调用
Phase 2: Simulating...           → 用户场景推演
Phase 3: Designing...            → 架构分析
Phase 4: Decomposing...          → 13 个原子信号
Phase 5: Quality criteria...     → 验收标准定义

=== PLAN ===
Type: ANALYZE
Signals: 13
  S-001 [RESEARCH] 收集 Sage 仓库结构与技术栈清单
  S-002 [EXPLORE]  绘制 Sage 当前前后端-数据流-部署关系图
  S-003 [RESEARCH] 采集前端架构现状证据
  S-004 [RESEARCH] 采集后端架构现状证据
  S-005 [RESEARCH] 采集工程化与质量保障现状
  S-006 [REVIEW]   按评估框架对架构进行5分制打分
  S-007 [REPORT]   输出技术债 Top 10 与优先级矩阵
  S-008 [HOLE]     识别前后端接口契约治理缺口
  S-009 [HOLE]     识别可观测性体系缺口
  S-010 [REPORT]   制定 Phase 1（0-4周）改进计划
  S-011 [REPORT]   制定 Phase 2（1-3个月）重构计划
  S-012 [REPORT]   制定 Phase 3（3-6个月）架构升级计划
  S-013 [REVIEW]   校验改进计划可执行性与指标闭环

Writing PLAN.md...                → 写入 sage 根目录
Creating 13 directive signals...  → 写入蚁丘 SQLite DB
Installed termite skills          → .opencode/skill/termite/
Launching 1 OpenCode worker...    → opencode run "白蚁协议" --format json

Heartbeat running:
  [colony-hb] open=42 claimed=0  → 初始
  [colony-hb] open=41 claimed=1  → 工人认领信号！
  ... (工人工作中，约 8 分钟) ...
  [colony-hb] open=42 claimed=0  → 工人完成一轮，释放认领
```

### 4.4 工人产出

OpenCode 工人在 sage 项目中提交了一个 commit：

```
0396d41 docs(roadmap): create Phase 1-3 roadmap based on requirements [WIP]
[termite:2026-03-04:worker]

修改文件:
  .gitignore     +12 行
  BLACKBOARD.md  +45 行
  CLAUDE.md      重构（-285 +253）
  ROADMAP.md     +71 行（新建）
  WIP.md         +22 行（新建）
```

工人创建的 `ROADMAP.md` 包含：
- **Phase 1（0-4周）**：工程化基建 —— ESLint/Prettier 统一、Vitest 测试基础设施、接口规范化、日志打底
- **Phase 2（1-3月）**：结构性重构 —— 后端领域驱动拆分、前端分层架构、Axios 统一封装
- **Phase 3（3-6月）**：架构升级 —— 微服务化、RAG/向量检索、可观测性体系

---

## 五、最终产物统计

### 代码

| 类别 | 文件数 | 行数 |
|------|--------|------|
| Commander TypeScript 源码 | 20 | ~860 |
| Commander 编译输出 (dist/) | 20 | ~750 |
| Commander 测试文件 | 6 | ~210 |
| OpenCode Termite Skill | 4 | ~150 |
| Shell 脚本 (field-commander.sh) | 1 | ~130 |
| DB Schema 扩展 | 2 | ~30 |
| 设计文档 | 2 | ~2,900 |

### Commits

Commander 仓库：25 commits

```
98c53d8 Add Termite Commander design document
72f906d Add Termite Commander implementation plan
2188dfc feat: scaffold commander TypeScript project with CLI entry
9fa800f feat: add SignalBridge for colony communication via field scripts
94f263d feat: add field-commander.sh protocol interface script
f6bce75 feat: add PlanWriter for generating PLAN.md
26f3755 feat: add HaltWriter for generating HALT.md on circuit break
163d51e feat: add TaskClassifier with heuristic + LLM classification
8c9884a feat: add SignalDecomposer with validation, depth checking, and sort
304a606 feat: add dual-layer CircuitBreaker with signal drain + stall detection
cf0d638 feat: add CommanderLoop with periodic sensing + circuit breaker
251cb40 feat: add ColonyLoop with adaptive interval + heartbeat injection
7ae5fd2 feat: add termite protocol skill for OpenCode agents
4a602df feat: wire pipeline + heartbeats into CLI
80c559e feat: add commander_state and halt_log tables
c4fa147 feat: add DirectiveWatcher for file-based commander input
8a6c284 feat: add AuditCollector for exporting and archiving audit data
6a7738c Add .gitignore
393b3fc feat: add LLM provider with Azure OpenAI and Anthropic support
4d2843b feat: add OpenCodeLauncher for spawning and managing workers
0d43418 feat: wire real LLM + OpenCode launcher into pipeline and CLI
bc03937 Make Azure endpoint configurable + global install via npm link
90d8eee Fix LLM provider: auto-detect Anthropic, support Foundry + Codex
ecdf0e3 Fix SignalBridge: use db_ensure, set PROJECT_ROOT/SCRIPT_DIR
1c73033 Rewrite OpenCodeLauncher: use opencode run instead of TUI stdin
```

Sage 宿主项目：1 commit（白蚁工人自主产出）

```
0396d41 docs(roadmap): create Phase 1-3 roadmap [termite:2026-03-04:worker]
```

### 测试

21 tests, 6 test files, all passing.

### CLI 命令

```bash
termite-commander plan <objective> [--colony <path>] [--dispatch] [--run]
termite-commander status [--colony <path>]
termite-commander watch [--colony <path>] [--interval <ms>]
termite-commander resume [--colony <path>]
```

---

## 六、架构图（最终实现）

```
用户 → termite-commander plan "目标" --run
         │
         ├── LLM Brain (Anthropic claude-sonnet-4-5)
         │   ├── Phase 0: 任务分类 (RESEARCH/BUILD/ANALYZE/HYBRID)
         │   ├── Phase 1: 调研
         │   ├── Phase 2: 用户/受众模拟
         │   ├── Phase 3: 架构设计 / 综合分析
         │   ├── Phase 4: 信号分解 (atomic signals)
         │   └── Phase 5: 质量标准定义
         │
         ├── 蚁丘写入
         │   ├── SQLite DB ← field scripts (唯一写入入口)
         │   ├── PLAN.md (人可读全景)
         │   └── .opencode/skill/termite/ (技能文件)
         │
         ├── OpenCode 工人启动
         │   └── opencode run "白蚁协议" --format json --dir <colony>
         │       ├── 读取 .birth → 种姓: worker
         │       ├── 认领信号 → field-claim.sh
         │       ├── 执行任务 → 分析代码/写文档/提交
         │       └── 沉淀 → WIP.md + .pheromone
         │
         └── 双心跳监控
             ├── Commander Loop (60s) → 评估全局进度
             ├── Colony Loop (15-60s 自适应) → pulse 工人
             └── Circuit Breaker → HALT.md (信号耗尽 | 停滞熔断)
```

---

## 七、已知限制与后续方向

### 已知限制

1. **单工人效率**：当前测试只启动 1 个 OpenCode 工人，多工人并行需要更多测试
2. **心跳 pulse 时机**：工人完成一轮 `opencode run` 后变为 idle，需等下一个 colony heartbeat 才能被 pulse，有 15-60s 的空闲窗口
3. **信号认领释放**：工人的 claim 在 `opencode run` 结束后可能过期回到 open，需要更精确的 claim 生命周期管理
4. **LLM 成本**：Commander 规划阶段调用 6 次 LLM，每次全量 prompt，可以通过缓存和增量推理优化

### 后续方向

1. **多工人并行测试** —— 启动 3+ 个 OpenCode 工人同时工作
2. **Commander 自学习** —— 每次任务完成后对比预期 vs 实际，涌现 Commander 规则
3. **REPL 交互模式** —— 深度规划场景的交互式细化
4. **审计循环自动化** —— Commander 自动收集审计数据，触发协议优化提案
5. **OpenCode Server 模式** —— 用 `opencode serve` + SDK 替代 `opencode run`，降低进程启动开销

---

## 八、思维过程（Prompt Chain）

记录人类用户的原始输入序列，展示想法如何演化：

1. **初始输入**（一大段）：描述了 TermiteCommander 的愿景 —— 让白蚁协议和 OpenCode 同时工作，Commander 扮演架构师+用户代表+咨询顾问，自主规划调研/测试/设计/开发计划，通过信号系统指挥白蚁。提到改造 OpenCode 用 skill 方式、持续审计优化、持续升级白蚁能力。

2. **关于心跳和停机**：指出 OpenCode 中的 Agent 不会自动连续工作，需要"白蚁协议"关键词持续触发。需要 Commander 持续心跳完成长任务，蚁丘持续心跳完成执行。关键：什么时候停下来，避免双方空转。

3. **关于载体格式**：指出需要考虑 MD 和 JSON 载体的特征和适用场景，避免信号载体崩坏。

4. **关于非开发者用户**：指出用户不一定懂开发，可能是业务人员（"调研新能源行业前十大客户的财报趋势"），需要支持这种场景。

5. **集成阶段的提问**：
   - "这个东西目前是什么形态怎么用？" —— 促使澄清 Commander 是独立 CLI，不是 skill
   - "wire actual LLM 是什么意思？" —— 促使发现 generateText 还是占位符
   - "主启动界面是 OpenCode 吗？" —— 促使明确 Commander 是唯一用户界面
   - "Azure endpoint 硬编码了" —— 促使改为环境变量
   - "npm link 全局安装" —— 促使做全局化
   - "找个宿主项目试一下" —— 促使发现 SignalBridge 的 db_init bug 和 OpenCode TUI stdin 问题
