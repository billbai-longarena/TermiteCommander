# Termite Commander 健壮性评估报告

**日期**: 2026-03-05
**版本**: commander@0.1.2 (HEAD `afa0574` + local changes)
**状态**: 89 tests passing, 12 suites, build clean

---

## 1. 项目规模概览

| 维度 | 数值 |
|------|------|
| 生产代码 | 5,088 行 TypeScript/TSX（不含测试） |
| 源文件数 | 34 个 |
| 测试代码 | 1,557 行 |
| 测试套件 | 12 个（89 个测试用例） |
| 直接依赖 | 8 个 npm 包 |
| CLI 命令 | 顶层 9 个 + `config` 子命令 2 个 + TUI 无参入口 |

### 源码分布

```
commander/src/ （生产代码，不含 __tests__）
├── config/            1,241 行  # 模型解析、配置导入
├── engine/              639 行  # Pipeline、分类器、分解器
├── colony/              858 行  # Worker 启动、信号桥接、工作区隔离
├── heartbeat/           258 行  # Commander/Colony 循环、熔断器
├── llm/                 206 行  # LLM Provider 抽象 + 凭证预检
├── tui/                 986 行  # Ink 只读仪表盘
├── input/                54 行  # 指令文件监听
├── audit/                57 行  # 审计包采集
└── index.ts             789 行  # CLI 入口
```

---

## 2. 依赖清单

### 核心依赖

| 包名 | 版本 | 用途 | 健康度 |
|------|------|------|--------|
| `@ai-sdk/anthropic` | ^1.0.0 | Anthropic API 客户端 | 活跃维护 |
| `@ai-sdk/openai` | ^1.0.0 | OpenAI/Azure API 客户端 | 活跃维护 |
| `ai` | ^4.0.0 | Vercel AI SDK (统一 LLM 接口) | 活跃维护，API 可能变动 |
| `chokidar` | ^4.0.0 | 文件监听 (directive-watcher) | 成熟稳定 |
| `commander` | ^12.0.0 | CLI 框架 | 成熟稳定 |
| `ink` | ^5.2.1 | CLI React 渲染 (TUI) | 活跃维护 |
| `ink-spinner` | ^5.0.0 | 加载动画组件 | 稳定 |
| `react` | ^18.3.1 | React 运行时 (Ink 依赖) | 成熟稳定 |

### 外部系统依赖

| 依赖 | 必需 | 用途 | 风险 |
|------|------|------|------|
| Bash shell | 是 | termite-db.sh 脚本执行 | Windows 不可用 |
| Git | 是 | genesis、commit 追踪 | 几乎所有开发环境都有 |
| SQLite | 是 | 信号状态存储 (通过 termite-db.sh) | 通过 Bash 封装，无直接 binding |
| OpenCode/Claude/Codex CLI | 是 (至少一个) | Worker 运行时 | 需预装，Commander 会做可用性检查 |

### 依赖风险评估

- Vercel AI SDK v4 相对较新，API 未来可能变动
- Ink 5 使用 alternate screen buffer，部分终端模拟器可能不兼容
- 无 vendored 依赖，首次安装需要网络访问

---

## 3. 类型安全与工程规范

### TypeScript 配置

```json
{
  "strict": true,
  "target": "ES2022",
  "module": "ESNext",
  "moduleResolution": "bundler",
  "jsx": "react-jsx",
  "declaration": true,
  "sourceMap": true
}
```

### 类型安全评估

| 检查项 | 状态 |
|--------|------|
| strict mode | 全量启用 |
| `any` 类型 | 未发现无标注的 `any` |
| `@ts-ignore` / `@ts-expect-error` | 未发现 |
| 接口定义 | 完整、有文档 |
| 类型断言 | 少量、用途合理 |
| Discriminated unions | 用于 status/reason 类型 |
| Literal union types | 用于 worker runtime (`"opencode" \| "claude" \| "codex"`) |

**结论**: 类型安全做得扎实，是项目最强的基础设施之一。

---

## 4. 模块逐项评估

### 4.1 Model Resolver (`config/model-resolver.ts`) — 成熟度: 高

**职责**: 多源模型配置解析，优先级链 `termite.config.json > opencode.json > env > default`

**测试覆盖**: 29 个测试用例

**优点**:
- 多源解析，优先级规则清晰且有测试保障
- JSONC 注释剥离容错处理
- 从模型名推断 Provider (anthropic/openai/azure)
- Worker spec 支持多种格式解析 (`"3"`, `"model:count"`, `"cli@model:count"`)
- 解析过程可追踪 (`ModelResolutionStatus` 含 source/detail)
- Issues 区分 errors (阻断) vs warnings (非阻断)
- 错误消息附带修复建议
- `assertPlanningModelConfigured()` 在昂贵操作前提前抛出

**不足**:
- 无 JSON Schema 验证（仅运行时检查）
- 无模型名格式校验（可能接受无效值，到 API 调用时才发现）
- 解析结果无缓存（每次命令都重新解析）
- 多个配置文件共存时无告警（静默使用最高优先级）

### 4.2 Config Importer (`config/importer.ts`) — 成熟度: 高

**职责**: 从 OpenCode/Claude/Codex 环境导入配置到 termite.config.json

**测试覆盖**: 10 个测试用例

**优点**:
- 自动检测已有配置 (OpenCode/Claude/Codex)
- 置信度打分机制
- Dry-run 模式
- 合并已有配置 (支持 force 覆盖)
- 三级诊断 (info/warning/error)

**不足**:
- 导入值无语义验证
- 覆盖前不备份已有配置

### 4.3 Pipeline (`engine/pipeline.ts`) — 成熟度: 高

**职责**: 2 阶段信号分解 (classify → decompose)，自动安装协议，自动创世

**测试覆盖**: 5 个测试用例

**优点**:
- LLM 调用失败 fallback 到单一 HOLE 信号
- JSON 解析错误捕获并记录日志
- 预检查 Worker 运行时可用性
- 进程退出时清理 (lock file 删除)
- 信号依赖链拓扑排序
- 自动安装 Termite Protocol (若缺失)
- 自动运行 genesis (field-arrive.sh)
- Lock file 防止并发运行
- SIGINT/SIGTERM 处理器做清理

**不足**:
- 部分失败后无法恢复（Commander 中途崩溃不能续传）
- Objective 字符串长度未校验（可能超 LLM 上下文限制）
- 进度状态未持久化

### 4.4 Decomposer (`engine/decomposer.ts`) — 成熟度: 高

**职责**: 将目标分解为信号集，含弱模型执行标准

**测试覆盖**: 4 个测试用例

**优点**:
- 信号深度限制 (MAX_DEPTH=3)
- 循环依赖检测 (validateTree)
- 拓扑排序保证执行顺序
- Prompt 设计考虑弱模型执行能力

**不足**:
- Prompt 未经大量实测（WIP.md 记录）
- `nextHint` 字段对弱模型执行质量影响最大，缺乏量化验证

### 4.5 Classifier (`engine/classifier.ts`) — 成熟度: 中

**职责**: BUILD / HYBRID 分类

**测试覆盖**: 7 个测试用例

**优点**:
- 分类逻辑简洁
- 与 pipeline 解耦

**不足**:
- 测试偏少，仅覆盖两种基本分类

### 4.6 OpenCode Launcher (`colony/opencode-launcher.ts`) — 成熟度: 中高

**职责**: 多运行时 Worker 进程管理 (opencode/claude/codex)

**测试覆盖**: 12 个测试用例 (400 行代码)

**优点**:
- 支持三种运行时 (OpenCode, Claude Code, Codex)
- 从 JSON stream 提取 Session ID
- Worker 脉冲机制 (re-trigger idle workers)
- Skill 安装集成
- Worker 数量上限控制
- 二进制可用性检查 (`--version` 探测)
- 进程退出码监控

**不足**:
- Worker 进程无超时机制 — 可能无限挂起
- 无重试逻辑 — 失败的 Worker spawn 不会自动重试
- Worker 崩溃不自动恢复
- Session ID 提取失败静默忽略
- Worker 输出格式不做验证

### 4.7 Signal Bridge (`colony/signal-bridge.ts`) — 成熟度: 中高

**职责**: Bash/SQLite 桥接层，信号状态查询与更新

**测试覆盖**: 4 个测试用例

**优点**:
- Bash 脚本执行带 30s 超时
- 退出码检查 + stderr 捕获
- 脚本存在性验证
- DB preamble 注入 (source termite-db.sh)
- SQL 注入防护 (转义处理)

**不足**:
- DB 查询失败静默回退零值 — 可能掩盖数据库损坏
- 每次查询 spawn 新 Bash 进程（无连接池）
- 无预编译语句缓存
- 测试覆盖可以更深

### 4.8 Workspace Boundary (`colony/workspace-boundary.ts`) — 成熟度: 中高

**职责**: 人类/工人工作区隔离 (`.termite/human` vs `.termite/worker`)

**测试覆盖**: 2 个测试用例

**优点**:
- 自动创建目录结构
- 策略文档生成 (WORKSPACE_POLICY.md, READMEs)
- .gitignore 集成
- 示例配置生成

**不足**:
- 隔离仅为约定，无强制机制（Worker 仍可读取 `.termite/human`）
- 无运行时验证 Worker 是否尊重边界

### 4.9 Heartbeat 模块 (`heartbeat/`) — 成熟度: 中

**职责**: Commander/Colony 心跳循环 + 熔断器

**测试覆盖**: Circuit Breaker 5 个测试用例；循环逻辑零测试

**优点**:
- Circuit Breaker 模式：追踪连续停滞次数
- Commander loop: 监控信号、检测停滞
- Colony loop: 自适应间隔 (无进展时 backoff)
- 终止时生成 HALT.md
- 错误日志记录但不崩溃循环

**不足**:
- 循环逻辑 (commander-loop.ts 92 行, colony-loop.ts 109 行) 无测试
- tick() 中的错误被捕获但不升级
- 无告警/通知机制
- 停滞检测基于时间而非语义进度

### 4.10 LLM Provider (`llm/provider.ts`) — 成熟度: 中高

**职责**: 统一 LLM 调用接口 (Anthropic / OpenAI / Azure OpenAI)

**测试覆盖**: 7 个测试用例

**优点**:
- Vercel AI SDK 统一接口
- 支持 Anthropic, OpenAI, Azure OpenAI
- 支持 Anthropic Foundry (Azure 托管)
- Codex 模型使用 Responses API
- API key 验证

**不足**:
- 无重试逻辑（依赖 SDK 默认行为）
- 无速率限制
- 无 token 用量追踪
- 无 streaming 支持 (使用 generateText，非 streamText)

### 4.11 TUI (`tui/`) — 成熟度: 低

**职责**: Ink 5 只读全屏仪表盘

**测试覆盖**: 零测试 (986 行代码)

**优点**:
- 全屏 alternate screen buffer 模式
- 自适应终端宽度
- 实时更新 (5s 轮询)
- Git commit feed
- Worker 状态表
- Activity log tail
- 过期 Lock file 检测

**不足**:
- **完全无测试** — UI 回归风险
- 无错误状态展示
- 轮询而非事件驱动
- 无自定义选项 (刷新频率、日志行数等)
- 部分终端模拟器可能不兼容

### 4.12 CLI 入口 (`index.ts`) — 成熟度: 低

**职责**: 所有 CLI 命令注册与执行

**测试覆盖**: 零测试 (789 行代码)

**优点**:
- 所有命令已实现
- 每个命令有 try-catch

**不足**:
- **完全无测试** — 用户直接接触的 API 层
- 多数命令缺少输入验证
- 破坏性操作无确认提示
- 长时间操作无进度指示

---

## 5. 错误处理模式分析

### 全局统计

| 模式 | 数量 |
|------|------|
| try-catch 块 | 35 个 try / 34 个 catch |
| 显式 throw | 17 个 `throw new Error` |
| 进程信号处理 | SIGINT + SIGTERM (pipeline.ts) |
| 超时机制 | execFileAsync 30s (signal-bridge) |
| 重试机制 | 无 |
| 结构化日志 | 无 (全部 console.log/error) |

### 各层错误处理质量

```
配置层      ████████████████████  优秀 — 必配校验、诊断报告、修复建议
引擎层      ████████████████░░░░  良好 — LLM fallback、JSON 解析容错、依赖验证
Colony 层   ████████████░░░░░░░░  基本 — 二进制检查、退出码监控；缺超时、重试、恢复
心跳层      ████████████████░░░░  良好 — 熔断器、自适应间隔、优雅终止
TUI 层      ████████░░░░░░░░░░░░  基本 — 安全渲染空数据；无错误展示
CLI 层      ██████░░░░░░░░░░░░░░  薄弱 — 仅 try-catch，缺输入验证
```

### 未覆盖的错误场景

| 场景 | 影响 |
|------|------|
| 无全局 uncaught exception 处理器 | 未捕获异常导致进程静默退出 |
| Worker 进程崩溃无自动重启 | 工人静默消失，无恢复 |
| 文件写入非原子操作 | 并发读写可能损坏状态文件 |
| LLM 调用无重试 | 网络抖动直接失败，无 exponential backoff |
| 磁盘满未处理 | 写入失败可能产生不可预期的行为 |
| Git 命令失败静默忽略 | Commit feed 可能缺失数据 |
| 文件 I/O 无权限错误处理 | 权限不足时异常消息不友好 |
| Symlink 未考虑 | 可能跟随链接到工作目录外 |

---

## 6. 潜在竞态条件与边界问题

### 已防护的

- 信号分发使用顺序循环，尊重依赖关系
- Lock file 防止并发 Commander 实例
- 循环依赖在 validateTree() 中检测

### 未防护的

| 问题 | 风险等级 | 说明 |
|------|----------|------|
| 多 Commander 实例竞争 | 中 | Lock file 存在但无 advisory locking，极端情况下两实例可同时获取 |
| Worker 进程并发访问 DB | 中 | SQLite 通过 Bash 脚本访问，无显式锁定 |
| 状态文件写入竞态 | 中 | 非原子写入 (write)，并发读可能读到不完整数据 |
| Objective 长度无上限 | 低 | 超长目标可能超出 LLM 上下文限制 |
| 文件路径未清理 | 低 | 用户输入路径无 sanitize，潜在 path traversal |
| 信号 title/nextHint 长度无限制 | 低 | 可能导致 DB 字段溢出或 TUI 渲染异常 |

---

## 7. 平台兼容性

| 平台 | 支持度 | 限制 |
|------|--------|------|
| macOS | 完全支持 | 主开发平台 |
| Linux | 应可支持 | 未做专项测试 |
| Windows | 不支持 | 依赖 Bash 脚本 (termite-db.sh)、Unix date 命令、SIGTERM/SIGINT 行为差异 |
| 非 TTY 环境 | 部分支持 | TUI 有 guard 但 sage 测试中遇到过问题 (WIP.md 记录) |

---

## 8. 测试覆盖全景

### 有测试的模块

| 模块 | 测试数 | 覆盖评价 |
|------|--------|----------|
| config/model-resolver.ts | 29 | 全面：解析、优先级、fallback、校验 |
| engine/decomposer.ts | 4 | 基本：分解结果约束与解析 |
| config/importer.ts | 10 | 良好：多源导入、诊断、合并 |
| llm/provider.ts | 7 | 良好：Provider 路由、凭证校验 |
| heartbeat/circuit-breaker.ts | 5 | 良好：停滞检测、完成判定 |
| engine/pipeline.ts | 5 | 基本：fallback、重映射、分发、依赖解析 |
| colony/signal-bridge.ts | 4 | 基本：exec 封装、状态查询 |
| colony/workspace-boundary.ts | 2 | 基本：目录/文件创建 |
| engine/classifier.ts | 7 | 良好：分类分支覆盖 |
| colony/plan-writer.ts | 2 | 最低限度：渲染 |
| colony/halt-writer.ts | 2 | 最低限度：渲染 |
| colony/opencode-launcher.ts | 12 | 良好：运行时检查、参数组装、session 提取、状态迁移 |

### 无测试的模块

| 模块 | 代码量 | 风险 |
|------|--------|------|
| index.ts (CLI) | 789 行 | **高** — 用户直接接触的入口 |
| tui/* (全部组件) | 986 行 | **中** — UI 回归，但非核心逻辑 |
| heartbeat/commander-loop.ts | 92 行 | **中** — 心跳核心循环 |
| heartbeat/colony-loop.ts | 109 行 | **中** — 自适应间隔逻辑 |
| input/directive-watcher.ts | 54 行 | **低** — 逻辑简单 |
| audit/collector.ts | 57 行 | **低** — 逻辑简单 |

### 覆盖率总结

```
已测试代码:  3,001 行  (约 59%)
未测试代码:  2,087 行  (约 41%)
```

核心引擎（配置 + 分解 + Provider + 熔断）测试扎实。集成层中 Worker 管理已补关键用例，但 CLI/TUI/心跳循环仍是主要薄弱点。

---

## 9. 风险矩阵

### 高优先级 (生产使用前必须解决)

| # | 风险 | 影响 | 建议措施 |
|---|------|------|----------|
| H1 | Worker 进程无超时 | 挂起的 Worker 永远不会被回收 | 添加可配置超时 + 强制终止 |
| H2 | Worker 崩溃无自动恢复 | 工人静默消失，蚁群无法完成任务 | 添加带 backoff 的自动重启机制 |
| H3 | 无端到端测试 | 完整流程未被验证 | 在真实项目上运行 install → plan → dispatch → worker → 完成 |
| H4 | 状态文件写入非原子 | 并发访问可能损坏状态 | 改为 temp file + rename 模式 |
| H5 | CLI 输出契约无测试 | `status/doctor --json` 字段漂移会破坏自动化 | 增加 JSON schema/snapshot 测试并纳入 CI |

### 中优先级 (稳定性提升)

| # | 风险 | 影响 | 建议措施 |
|---|------|------|----------|
| M1 | CLI 入口零测试 | 用户体验问题难以发现 | 添加命令输出快照测试 |
| M2 | TUI 零测试 | UI 回归 | 添加组件渲染测试 |
| M3 | 心跳循环零测试 | 循环逻辑回归 | Mock SignalBridge 做隔离测试 |
| M4 | LLM 调用无重试 | 网络抖动直接失败 | 添加 exponential backoff |
| M5 | 无结构化日志 | 生产排查困难 | 引入 Winston 或 Pino |
| M6 | DB 查询失败静默回退 | 数据库损坏被掩盖 | 至少记录 warning 日志 |
| M7 | 无 uncaught exception 处理 | 进程静默退出 | 添加 process.on('uncaughtException') |
| M8 | 孤儿 Worker 进程无清理 | 资源泄漏 | Commander 启动时扫描并清理残留进程 |

### 低优先级 (长期改进)

| # | 风险 | 影响 | 建议措施 |
|---|------|------|----------|
| L1 | 无 JSON Schema 配置验证 | 错误配置到运行时才发现 | 添加 zod/ajv schema 验证 |
| L2 | 无 token 用量追踪 | LLM 成本不可控 | 添加 generateText 返回值的 usage 记录 |
| L3 | 无速率限制 | 突发请求可能触发 API 限制 | 添加 token bucket 或依赖 SDK rate limiter |
| L4 | TUI 轮询而非事件驱动 | 响应延迟 ~5s | 改用 chokidar watch 状态文件 |
| L5 | opencode-launcher.ts 文件名 | 现已承载三种运行时，名字误导 | 重命名为 worker-launcher.ts |
| L6 | Windows 不支持 | 用户群受限 | Bash 脚本用 Node.js 等价实现替代 |
| L7 | 信号 DB 无归档/清理 | 长期运行可能无限增长 | 添加已完成信号的归档/清理策略 |
| L8 | 无遥测 | 无生产可观测性 | 引入 OpenTelemetry tracing |

---

## 10. 架构优势总结

1. **配置系统成熟** — 多源解析 + 优先级链 + 诊断报告 + 修复建议，是项目中最完善的子系统
2. **类型安全彻底** — strict mode + 无 any + discriminated unions + literal types
3. **容错设计贯穿** — Pipeline LLM fallback, Circuit Breaker, 自适应心跳间隔, 多级配置 fallback + 凭证预检
4. **混合模型编排** — 支持 opencode/claude/codex 三种运行时混合调度
5. **自动化部署流程** — 协议自动安装 + 自动创世 + Skill 安装
6. **工作区隔离概念** — 人类/工人边界清晰（虽然仅为约定）
7. **只读 TUI** — 非侵入式监控，不干扰工作流

---

## 11. 总体成熟度判定

**阶段: Beta**

```
                    当前位置
                       ↓
Alpha ──────── Beta ──────── RC ──────── Stable
               ████░░░░░░░░░░░░░░░░░░░░░░░░░
```

**核心引擎** (配置 → 分解 → Provider) 质量可靠，测试覆盖充分，可以信赖。

**集成层** (Worker 管理 → CLI → TUI → 心跳) 功能已实现。Worker 管理测试已补齐关键路径，但 CLI/TUI/心跳与进程恢复机制仍是项目从 Beta 进入 RC 的主要障碍。

**关键断裂带**: 从信号生成到 CLI 命令面与长期运行恢复能力（超时/重启/E2E）仍缺少系统性保障。

### 进入 RC 的前置条件

1. Worker 超时 + 崩溃恢复机制
2. 至少一次成功的端到端实战验证
3. 状态文件原子写入
4. 结构化日志
5. CLI 命令基础测试（含 JSON 契约）

---

## 12. 现在最值得做（按 ROI 排序）

### P0（本周内）

1. **`opencode-launcher.ts` 单测骨架（已完成）**
   - 结果: 已新增 `colony/__tests__/opencode-launcher.test.ts`，覆盖 `checkRequiredRuntimes()`、sessionId 提取、spawn 参数组装、状态迁移（12 用例）

2. **`status`/`doctor` JSON 增加 schema 快照测试**
   - 目标: 防止 CLI 输出结构被无意破坏
   - 验收: `index` 层新增最小快照测试，保证 `protocolInstalled`、`checks.credentials` 字段稳定

3. **状态文件原子写入**
   - 目标: 减少并发读写造成的损坏风险
   - 验收: `.commander-status.json` 采用 `tmp + rename`，异常中断不产生半写文件

4. **Worker 运行超时 + 崩溃重启（带 backoff）**
   - 目标: 避免工人挂死和静默消失
   - 验收: 超时可配置（如 20~30min），连续失败触发指数退避与上限保护

### P1（两周内）

5. **heartbeat 循环补隔离测试**
   - 目标: 稳定 `commander-loop` / `colony-loop` 的停滞判定与节流逻辑
   - 验收: Mock `SignalBridge` + fake timers，覆盖关键分支

6. **补一条真实 E2E 金路径**
   - 目标: 固化 `install -> config bootstrap -> doctor -> plan --dispatch` 的可用性
   - 验收: 在 CI 跑 smoke（可 mock LLM），至少验证命令链可执行与关键文件产出

### P2（后续优化）

7. **结构化日志与错误码规范**
   - 目标: 提升线上排障速度
   - 验收: 核心流程输出统一 JSON 日志（level, scope, event, errorCode）

8. **配置 schema 校验（zod/ajv）**
   - 目标: 把错误前置到读取配置时
   - 验收: `termite.config.json` 和导入结果都有 schema 级错误定位

---

## 附录 A: 已知问题 (来自 WIP.md)

- Commander v2 的完整流程还没有在真实项目上跑过
- `listSignals()` 的 SQLite 查询可能需要适配不同版本的 termite.db schema
- `opencode-launcher.ts` 文件名与职责不一致
- decomposer prompt 未经大量实测
- opencode.json 的 `commander.workers` 字段是自定义扩展，需确认 OpenCode 是否报错
- 从 GitHub clone 安装协议需要网络访问
- Shepherd Effect 需要顺序启动强/弱模型工人（当前未实现）
