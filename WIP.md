# WIP — Termite Commander 开发交接

**Last updated**: 2026-03-05
**Session**: 配置优先级修复 + 混合 CLI 工人适配 + 发布收口

---

## 本次会话完成的工作

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

---

## 当前状态

- **61 tests passing**, 9 test suites（`cd commander && npm test`）
- **Build clean**（`cd commander && npm run build`）
- 最新已推送提交：`02ce74b`（mixed opencode/claude/codex worker runtimes）
- Commander CLI: install / plan / status / stop / workers / resume / watch / TUI
- 文档已覆盖：配置优先级、模型来源反馈、混合 CLI 工人编排

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

### 需要实际端到端测试
- Commander v2 的完整流程还没有在真实项目上跑过
- 需要在 sage 或其他项目上测试: install → design → /commander → TUI → 完成
- 关注点: LLM 调用是否正常、信号分解质量、worker 启动、心跳、熔断

### TUI 待改进
- `listSignals()` 的 SQLite 查询可能需要适配不同版本的 termite.db schema
- git commit feed 在大仓库可能慢（当前 `git log -5`，应该没问题）
- TUI 在非 TTY 环境报错（已有 guard，但 sage 测试时遇到过）

### 代码结构待清理
- `src/colony/opencode-launcher.ts` 现已承载多运行时启动逻辑，文件名与职责不一致
- 可考虑重命名为 `worker-launcher.ts` 并保留兼容导出

### 信号分解质量
- decomposer prompt 经过设计但未经大量实测
- 弱模型信号标准（原子性、自包含、可验证）需要在实际蚁群中验证
- 信号的 `nextHint` 字段对弱模型执行质量影响最大，需要观察

### 模型配置
- opencode.json 的 `commander.workers` 字段是自定义扩展，不是 OpenCode 官方 schema
- 需要确认 opencode.json 加了自定义字段后 OpenCode 自身是否报错

### 协议自动安装
- 从 GitHub clone 安装协议的路径需要网络访问
- 本地 TermiteProtocol 路径依赖于 TermiteCommander 仓库结构完整

### Shepherd Effect 在 Commander 中的应用
- 当前 Commander 的混合模型配置只是启动时指定不同 model
- Shepherd Effect 需要强模型工人先工作、留下信息素模板
- 可能需要让 Commander 按顺序启动: 先启强模型 worker，等它完成几个信号后再启弱模型

---

## 设计文档位置

- `docs/plans/2026-03-04-termite-commander-design.md` — v1 核心设计
- `docs/plans/2026-03-04-termite-commander-implementation.md` — v1 实现计划
- `docs/plans/2026-03-04-commander-ux-design.md` — UX 设计 (含 v2 实现记录)
- `docs/plans/2026-03-04-commander-v2-redesign.md` — v2 重构设计
- `docs/plans/2026-03-04-commander-v2-implementation.md` — v2 实现计划
- `docs/plans/2026-03-04-termite-commander-build-record.md` — v1 构建记录
