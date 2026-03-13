# WIP — Termite Commander 开发交接

**Last updated**: 2026-03-09
**Session**: Commander runtime 兼容修复 + TR1 宿主项目真机验证

---

## 本次会话完成的工作

### 0. 2026-03-09 Commander runtime 兼容修复（已完成）
- 修复打包资源路径：`commander/src/index.ts` 改为基于 `import.meta.url` 定位 `skills/termite`，不再依赖当前 cwd；从任意目录执行 `node .../dist/index.js init ...` 都能找到内置 skills/plugins
- 修复 Codex worker/runtime 的模型透传：`commander/src/colony/providers/native-cli-provider.ts` 与 `commander/src/colony/opencode-launcher.ts` 现在会像 Claude 一样对 Codex 运行时剥离 provider 前缀；`azure/gpt-5-codex` 传给 `codex` CLI 时变成 `gpt-5-codex`
- 修复 Codex runtime probe 兼容性：对 `codex exec` 统一追加 `-c model_reasoning_effort="high"`，规避用户全局 `~/.codex/config.toml` 中 `model_reasoning_effort = "xhigh"` 导致的 `unsupported_value`
- 增加 Codex MCP 隔离：读取 `~/.codex/config.toml` 中的 `[mcp_servers.*]`，在 Commander 的 Codex 子进程里按命令级覆盖为 `enabled=false`，避免本机失效的 `unityMCP` 502 / UnexpectedContentType 让 `doctor --runtime` 和 `--run` 前置检查失败
- 测试补充：
  - `commander/src/colony/__tests__/providers.test.ts` 新增 Codex args 与 MCP-disable 覆盖
  - `commander/src/colony/__tests__/opencode-launcher.test.ts` 新增 Codex smoke test，并更新 worker args 断言
- 本机验证（真实宿主项目 `~/Desktop/OpenAgentEngine`）：
  - `cd commander && npx vitest run src/colony/__tests__/providers.test.ts src/colony/__tests__/opencode-launcher.test.ts` ✅
  - `cd commander && npm run build` ✅
  - 从 **非 `commander/dist` 目录** 执行：`node /Users/bingbingbai/Desktop/TermiteCommander/commander/dist/index.js init --colony /Users/bingbingbai/Desktop/OpenAgentEngine --from codex --dashboard off` ✅
  - `node /Users/bingbingbai/Desktop/TermiteCommander/commander/dist/index.js doctor --runtime --colony /Users/bingbingbai/Desktop/OpenAgentEngine` ✅
- 当前结论：Commander 在 `OpenAgentEngine` 上的 `init` 与 `doctor --runtime` blocker 已清除，`plan --run` 的前置门槛已打通；本轮**未主动启动 live worker fleet**，因为当前宿主项目仍有真实 open signals，启动后会让 termite workers 直接 claim/修改/提交

### 1. Commander v1 TUI (已完成，后被 v2 替换)
- 实现了 Ink/React 交互式 TUI (REPL + Dashboard + Detail Views)
- 16 个新文件，ink-text-input/ink-spinner 依赖
- Commit: `d3fe747`

### 2. Commander v2 全面重构 (已完成)

**设计** (`docs/plans/2026-03-04-commander-v2-redesign.md`):
- Pipeline 从 6 阶段精简为 2 阶段 (classify + decompose)
- 去掉 research/simulate/design/quality 阶段
- TUI 改为只读仪表盘
- 新增 model-resolver (opencode.json + 环境变量)
- 支持混合模型工人舰队

**实现** (7 个 task，subagent-driven development):

| Task | Commit | 内容 |
|------|--------|------|
| 1. model-resolver | `75a1416` | `src/config/model-resolver.ts` + 26 tests |
| 2. listSignals | `dcc7e2d` | SignalBridge.listSignals() 从 DB 查全量信号 |
| 3. Pipeline 精简 | `9e511c4` | 2 阶段 + --plan/--context + 弱模型分解 prompt |
| 4. 模型联动 | `5d70886` | model-resolver → provider + launcher + mixed fleet |
| 5. 只读 TUI | `9676b5f` | 删交互组件，新建 MonitorApp/CommitFeed/useGitCommits |
| 6. Skills 重写 | `587d463` | 聚焦信号分解标准 + 协议控制 + 多触发词 |
| 7. 文档更新 | `93a9c38` | CLAUDE.md 更新 |

### 3. TUI 修复 (已完成)
- 僵尸工人检测: workers 显示 "dead" 当 Commander 已退出 (`8c4632c`)
- 全屏模式: alternate screen buffer 防止状态堆叠 (`e5cb09e`)
- Activity Log: tail `.commander.log` 实时日志 (`e5cb09e`)
- 自适应宽度: useStdout().columns 动态列宽 (`e5cb09e`)

### 4. 流程完善 (已完成)
- `termite-commander install` 命令: 一键安装 skills (`810a679`)
- 自动检测白蚁协议 + 从 GitHub 安装 (`810a679`, `96930c4`)
- 自动创世 field-arrive.sh (`810a679`)
- Worker 模型传递: `--model` flag 传给 opencode run (`234be2e`)
- OpenCode 可用性预检查 (`234be2e`)
- Skill 模型配置: 引导用户通过 Claude Code 读写 opencode.json (`234be2e`)

### 5. README 重写 (已完成)
- Commander README: 咨询结构 (Problem → Why → How → When) + 竞品对比 + 生产数据 (`2d526cb`)
- Protocol README: 同样结构，Shepherd Effect 数据，Commander 推荐 (`ebec9f2`)
- 安装指南: Step 0 详细说明 Commander 放哪里，不放项目里 (`96930c4`)

### 6. README 中英文分离 (已完成)
- Commander: 混合 README.md 拆分为纯英文 README.md + 纯中文 README.zh-CN.md (`6c61fed`)
- Protocol: 同样拆分 (`1b564f4`)
- 两个版本章节结构一致，顶部互有语言切换链接
- 英文版无中文内容（导航链接除外），中文版无英文段落（技术术语/代码块除外）
- 已推送到两个仓库

### 7. 2026-03-05 收口变更 (已完成)
- 模型解析改为 **配置优先**：`opencode.json > env > default`，并在 `plan/status` 清晰输出来源与细节 (`25ec66a`)
- 修复关键稳定性问题：OpenAI provider 路由、分解失败 fallback、信号 parentId 映射 (`25ec66a`)
- 支持混合工人运行时：`opencode` / `claude` / `codex`，统一 `WorkerSpec`，兼容旧 `TERMITE_WORKERS` 写法 (`02ce74b`)
- 文档同步：`README.md`、`README.zh-CN.md`、`CLAUDE.md` 已覆盖新配置和混合 CLI (`518c724`, `02ce74b`)
- npm 发布：`termite-commander@0.1.1` 已发布；`commander/package.json` 当前本地版本为 `0.1.2`（待下一次发布）

### 8. 2026-03-05 issue 收敛（已完成）
- GitHub issue #2（模型配置）已对齐：新增 `termite.config.json` 主配置流，解析优先级升级为  
  `termite.config.json > opencode.json > env > default`
- 分解模型改为**硬性必配**：若缺失 `commander.model`（或等价来源）直接阻断 `plan`，不再允许带缺模型继续分解
- 新增配置诊断：`resolveModels()` 输出 `issues.errors/warnings`，`install/status` 可见
- 新增工作区边界隔离：自动初始化 `.termite/human`（草稿区）和 `.termite/worker`（工人上下文区），并写入策略文件与 `.gitignore` 规则
- 默认设计文档路径优化：`plan` 无 `--plan` 时优先使用 `.termite/worker/PLAN.md`
- 测试覆盖扩展：新增 workspace-boundary tests；model-resolver tests 重写覆盖新优先级与必配校验；总测试数增至 63

### 9. 2026-03-05 外部 CLI 配置导入与诊断（已完成）
- 新增 `commander/src/config/importer.ts`：支持从 `opencode` / `claude` / `codex` 配置读取模型信息并给出推荐
- 新增 CLI：
  - `termite-commander config import --from auto|opencode|claude|codex [--apply] [--force] [--json]`
  - `termite-commander doctor --config [--json]`
- 自动来源选择：按置信度+优先级选择最佳来源，并输出候选来源的诊断信息（info/warning/error）
- 合并策略：默认“配置优先”保留现有 `termite.config.json` 字段；`--force` 可覆盖
- Codex/Claude 兼容增强：
  - Claude 支持 `model/defaultModel/default_model/defaults.model/...` 等字段
  - Codex 支持 top-level + section TOML 字段读取（`model/default_model/defaults` 等）
- 测试新增：
  - `src/config/__tests__/importer.test.ts`（10 tests）
  - 总测试数提升到 **73 tests / 11 suites**

### 10. 2026-03-05 用户体验可靠性复查（已完成）
- 端到端冒烟路径复测：`install -> config bootstrap -> doctor -> status -> plan`
- 关键修复：增加 **LLM 凭证预检**
  - `doctor --config` 现在同时检查"模型配置 + provider 凭证"，缺失时非 0 退出并给出缺失 env var
  - `config bootstrap` 现在内置 doctor 凭证检查，避免"导入成功但无法运行"的假阳性
  - `Pipeline` 在执行前做凭证断言，缺失凭证时直接阻断 `plan`（不再静默退化）
- 状态可见性增强：
  - `status` 新增 `Protocol: INSTALLED/MISSING`，协议缺失时给出 auto-install 提示
  - `status --json` 新增 `protocolInstalled` 字段
- 文档同步：
  - 中英文 README、CLAUDE、skills、commander README 均更新凭证检查与新行为说明
- 测试补充：
  - `src/llm/__tests__/provider.test.ts` 扩展凭证检查用例
  - 总测试数提升到 **77 tests / 11 suites**

### 11. 2026-03-05 健壮性评估（已完成）
- 对项目全部 ~4,800 行生产代码逐模块评估，输出详细报告
- 核心发现：
  - **优势**: 类型安全彻底 (strict + 无 any)、配置系统成熟 (26 tests)、容错设计贯穿 (fallback + circuit breaker)
  - **关键缺口**: opencode-launcher.ts (400 行零测试)、CLI 入口 (575 行零测试)、TUI (710 行零测试)
  - **成熟度判定**: Beta 阶段，核心引擎可靠，集成层需补测试
- 输出文档: `docs/plans/2026-03-05-robustness-assessment.md`

### 12. 2026-03-05 OpenClaw 兼容性调研（已完成）
- 深度探索 `~/Desktop/openclaw` 项目（多通道 AI 网关，Node.js >= 22.12.0）
- 关键发现：
  - CLI 核心命令: `openclaw agent --message "<prompt>" [--agent <id>] [--json]`
  - **两个关键差异**: 无 `--model` 标志（模型绑定在 agent config）、无工作目录标志
  - 本质区别: openclaw 是**多通道 AI 网关**，非直接编码 Agent
- 适配方案评估：
  - 方案 A: `--local` 模式 + 预配置（简单但不灵活）
  - 方案 B: Gateway + Agent Binding（**推荐**，model 字段复用为 agent-id）
- 10 个代码扩展点已标注（类型定义 → 二进制注册 → 正则 → dispatch → 实现）
- 输出文档: `docs/plans/2026-03-05-openclaw-integration-assessment.md`

### 13. 2026-03-05 白蚁协议 vs OpenClaw 协调机制对比（已完成）
- 白蚁协议: **Stigmergy（间接协调）** — Agent 之间永不通信，通过共享环境交流
- OpenClaw: **Actor Model（直接协调）** — Agent 发消息、spawn 子 Agent、级联管理
- OpenClaw 没有白蚁协议的三个核心能力: 环境自动代谢、知识涌现 (observation → rule)、Shepherd Effect
- 结论: 两者互补而非替代——OpenClaw 当 Worker 运行时，白蚁协议负责协调

### 14. 2026-03-05 OpenClaw + 白蚁协议互补集成设计（已完成）
- 三层集成架构:
  - **L1 Worker Runtime**: Commander 通过 `openclaw agent` 分发信号
  - **L2 Protocol Native**: 利用 OpenClaw 5 个 Plugin Hook 在 Agent 生命周期注入白蚁操作（arrive → .birth → claim → pheromone → cycle）
  - **L3 Capability Fusion**: OpenClaw 独有能力反哺协议（ALARM 多通道推送、蚁群知识语义搜索、Subagent 映射 Signal 分解树、Thread Binding 变 Signal 讨论区）
- 设计了 `openclaw-termite-plugin` 结构: 5 hooks + 4 tools + 2 lib
- 7 项新涌现能力: 聊天影响 signal、语义搜索历史知识、运行时 steer 转向、ALARM 实时推送、请求去重、Signal 讨论线程、跨运行时混合编队
- 5 阶段实施路径: Plugin 骨架 → Tools 注册 → 多通道桥接 → 语义记忆 → Subagent 编排融合
- 输出文档: `docs/plans/2026-03-05-openclaw-termite-protocol-integration.md`

---

## 当前状态

- **77 tests passing**, 11 test suites（`cd commander && npm test`）
- **Build clean**（`cd commander && npm run build`）
- 最新已推送提交：`afa0574`（npm install/update/publish practices）
- Commander CLI: install / plan / status / stop / workers / resume / watch / TUI
- Commander CLI 已新增：`config import` / `doctor`
- 文档已覆盖：配置优先级、模型来源反馈、混合 CLI 工人编排、workspace 边界隔离、外部 CLI 配置导入诊断

---

## 备忘

### npm 发布
- `.env` 中存放了 npm publish token
- 发布流程：`cd commander && npm run build && npm test && npm publish`
- token 用于 `npm publish` 认证，确保 `.env` 不被提交（已在 `.gitignore`）
- 当前线上版本：`0.1.1`；本地 `package.json`：`0.1.2`（如需发布需补一次 publish）
- 长期建议：CI 改为 npm trusted publishing（OIDC），本地 token 仅作为应急方案；如果用 token，使用 granular token

---

## 已知问题 & 下一步

### 高优先级（健壮性评估发现）
- **opencode-launcher.ts 零测试** (400 行) — 进程管理、session 提取、运行时检查全部裸奔
- **Worker 进程无超时机制** — 可能无限挂起
- **Worker 崩溃无自动恢复** — 静默失败
- **状态文件写入非原子** — 并发读写可能损坏
- **端到端测试**: Commander v2 的完整流程还没有在真实项目上跑过

### 中优先级
- CLI 入口 (575 行) 和 TUI (710 行) 零测试
- Heartbeat 循环逻辑零测试
- LLM 调用无重试 (exponential backoff)
- 无结构化日志 (全部 console.log/error)
- DB 查询失败静默回退零值

### OpenClaw 集成（待决策）
- **适配方案**: 推荐方案 B (Gateway + Agent Binding)，`model` 字段复用为 `agent-id`
- **10 个扩展点已标注**: 类型定义 → 二进制注册 → 正则 → dispatch → 实现
- **互补集成设计已完成**: 三层架构 (L1 Runtime / L2 Protocol Native / L3 Capability Fusion)
- **待决策**: 是否启动实现；优先 L1 (Worker Runtime) 还是直接做 L2 (Protocol Native Plugin)

### 遗留问题
- `src/colony/opencode-launcher.ts` 文件名与职责不一致，应重命名为 `worker-launcher.ts`
- decomposer prompt 未经大量实测，弱模型信号标准需在实际蚁群中验证
- opencode.json 的 `commander.workers` 字段是自定义扩展，需确认 OpenCode 是否报错
- 从 GitHub clone 安装协议需要网络访问
- Shepherd Effect 需要顺序启动强/弱模型工人（当前未实现）
- TUI 在非 TTY 环境可能报错
- `listSignals()` 可能需要适配不同版本的 termite.db schema

---

## 设计文档位置

- `docs/plans/2026-03-04-termite-commander-design.md` — v1 核心设计
- `docs/plans/2026-03-04-termite-commander-implementation.md` — v1 实现计划
- `docs/plans/2026-03-04-commander-ux-design.md` — UX 设计 (含 v2 实现记录)
- `docs/plans/2026-03-04-commander-v2-redesign.md` — v2 重构设计
- `docs/plans/2026-03-04-commander-v2-implementation.md` — v2 实现计划
- `docs/plans/2026-03-04-termite-commander-build-record.md` — v1 构建记录
- `docs/plans/2026-03-05-robustness-assessment.md` — 健壮性评估报告
- `docs/plans/2026-03-05-openclaw-integration-assessment.md` — OpenClaw Worker Runtime 兼容性评估
- `docs/plans/2026-03-05-openclaw-termite-protocol-integration.md` — OpenClaw + 白蚁协议互补集成设计
- `docs/plans/2026-03-05-distribution-improvement-design.md` — 分发改进设计
- `docs/plans/2026-03-05-distribution-improvement.md` — 分发改进实施
