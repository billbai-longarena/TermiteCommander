# Commander Usability Audit — CLI 易用性审计

**Date**: 2026-03-08
**Status**: Completed
**Scope**: `commander` CLI 的首次使用、配置导入、诊断、监控入口与自动化输出

**Follow-up**: 2026-03-08 当天已完成首轮修复：`claude` runtime smoke test 兼容、`init --json` 纯 JSON 输出、`config import` 预览诊断、低成本默认舰队推荐、空仓库/非 TTY 引导统一。

---

## 1. 结论摘要

整体判断：**可用，但首轮上手和自动化集成还有明显优化空间**。

优点：

- `init` 把协议安装、skills 安装、配置导入、doctor 预检串成了一条完整链路，方向是对的。
- 工作区边界（`.termite/human` / `.termite/worker`）很清晰，能减少误用。
- `status` / `doctor` / `dashboard` / `watch` 命令覆盖了运行期观察需求。
- 现有测试基础扎实：本次执行 `npm test`，**101/101** 通过。

主要问题：

1. **Claude 运行时 smoke test 与真实 CLI 参数契约不匹配**，会导致 `init` / `doctor --runtime` 出现假阴性失败。
2. **`init --json` 不是纯 JSON 输出**，不利于脚本、插件或 CI 集成。
3. **`config import` dry-run 的“健康检查”看的是旧配置，不是候选合并结果**，容易误导用户。
4. **自动导入会把 Claude/Codex 当前强模型直接推成 worker 默认配置**，和项目“廉价工人 + 强模型指挥”的产品承诺不完全一致。
5. **监控入口默认行为不稳定**：在 agent 会话里无参数直接阻塞进入 watch；在非 TTY / 非 agent 场景下 `dashboard --mode auto` 会静默退出。
6. **新仓库空状态缺少明确引导**：`status` 在协议缺失时提示用户跑 `plan --run`，而不是推荐的 `init`。

---

## 2. 审计方法

本次审计结合了代码阅读与真实命令体验：

- 阅读根文档、`commander/README.md`、CLI 入口和核心模块
- 运行帮助命令：`--help`、`init --help`、`plan --help`、`doctor --help`
- 在临时目录执行：`init`、`config import`、`config bootstrap`、`doctor`、`status`
- 验证默认入口行为：无参数启动、`dashboard --mode auto`
- 执行测试：`cd commander && npm test`

说明：

- 本机存在 `~/.claude/settings.json` 与 `~/.codex/config.toml`，因此自动配置导入路径被真实触发。
- 本次观测到的 `Claude` smoke test 失败，错误信息来自真实 CLI 返回，不是纯静态推断。

---

## 3. 重点问题与建议

### P1. Claude 运行时 smoke test 假阴性，直接伤害首轮上手

**现象**

- `init`/`doctor --runtime` 在检测 `claude` worker 时失败。
- 真实报错为：`When using --print, --output-format=stream-json requires --verbose`。

**影响**

- 用户已经装好了 `claude` CLI，但仍会被 Commander 判断为“runtime probe failed”。
- 首次初始化流程在“协议安装成功、配置导入成功”后仍以失败结束，破坏信心。
- 当前测试均通过，说明测试没有覆盖真实 CLI 参数契约变化。

**根因判断**

- `smokeTestRuntimeModel()` 对 `claude` 使用了固定参数组合：`-p ... --output-format stream-json --permission-mode bypassPermissions --session-id ...`。
- 该组合与当前 `claude` CLI 的实际要求不一致。

**建议**

1. 为 `claude` smoke test 增加兼容层：根据版本或错误信息自动补 `--verbose`，或改用更稳定的探针方式。
2. 把 smoke test 失败区分为“CLI 可执行但契约不兼容”和“运行时缺失”，减少误导。
3. 增加一条最小真实集成测试（至少校验参数拼装与已知 CLI 约束）。

---

### P1. `init --json` 不是纯 JSON，自动化接入不可靠

**现象**

- `init --json` 仍会输出协议安装日志和 skills 安装日志，然后才打印 JSON。
- 这会让插件、脚本、CI 无法直接把 stdout 当结构化结果消费。

**影响**

- JSON 模式失去机器可读性。
- 上层集成方必须额外做非稳健的“剥离前缀日志”处理。

**根因判断**

- 协议安装走 `stdio: "inherit"`。
- skills 安装过程直接 `console.log()`。

**建议**

1. 约定 `--json` 时：stdout 只输出 JSON；进度日志全部走 stderr。
2. 给安装器和 launcher 增加 `quiet/json` 模式，避免分散判断。
3. 为 `init --json` 增加一条回归测试，确保 stdout 可被 `JSON.parse()`。

---

### P2. `config import` dry-run 会给出自相矛盾的信息

**现象**

- dry-run 已经选出可用的导入候选并显示拟写入字段。
- 紧接着又打印：`Missing decomposition model (commander model)`。

**影响**

- 用户会误以为“导入推荐本身是错的”。
- 降低 `config import` 作为预览命令的可信度。

**根因判断**

- dry-run 阶段的 `resolveModels()` 读取的是当前项目现状，而不是“合并候选后的预期配置”。

**建议**

1. dry-run 默认展示“候选合并后的有效配置与诊断”。
2. 如果要保留当前项目现状，也必须明确标注为 `current config` / `proposed config` 两栏。

---

### P2. 自动导入偏向“沿用外部 CLI 当前模型”，不偏向 Commander 的成本模型

**现象**

- 从 `Claude`/`Codex` 配置导入时，`commander.model` 与 `default_worker_model` 被设成同一个强模型。
- 同时 `workers` 会被设成单 worker（`count: 1`）。

**影响**

- 新用户会直接得到“1 个强模型 worker”的配置，而不是 README 里强调的“便宜 worker fleet”。
- 成本结构、并行收益和产品心智模型都被悄悄改写。

**建议**

1. 把“分解模型导入”和“worker fleet 模板”拆开。
2. `init`/`bootstrap` 后给出显式选择：
   - 兼容当前 CLI（最少改动）
   - 低成本默认舰队（推荐）
   - 混合舰队模板
3. 若仍自动推导 worker，至少在 summary 里高亮“你当前会启动 1 个强模型 worker，成本可能偏高”。

---

### P2. Dashboard 入口的默认行为不一致，容易让人摸不着头脑

**现象**

- 在 agent 会话里，直接执行 `termite-commander` 会进入 watch 并持续阻塞。
- 在非 TTY 且非 agent 环境里，`dashboard --mode auto` 会直接退出且没有任何提示。

**影响**

- 同一个“auto”概念，在不同环境下的反馈差异过大。
- 用户可能以为程序卡住，也可能以为命令没有生效。

**建议**

1. `dashboard --mode auto` 无法进入 TUI 时，优先回退到 watch，至少不要静默成功退出。
2. 无参数启动建议改成：
   - termite 仓库中：显示短帮助 + 询问式引导（或至少打印下一步）
   - 非 termite 仓库中：默认显示 help，而不是直接阻塞监控
3. watch 模式启动前始终打印一句提示，例如 `Starting watch monitor...`。

---

### P3. 新仓库空状态的提示语不够“推荐路径优先”

**现象**

- 在未安装协议的目录执行 `status`，提示是运行 `plan --run` 来自动安装协议。
- 但文档推荐的一站式入口其实是 `init`。

**影响**

- 用户会跳过最完整的 onboarding 路径。
- 容易错过配置导入、skills 安装和 doctor 预检。

**建议**

1. fresh repo 下统一优先推荐 `termite-commander init --colony .`。
2. `status` / `dashboard` / 无参数入口都应该共享同一套“空仓库引导文案”。

---

### P3. 默认文本输出对首次用户偏重内部实现细节

**现象**

- `status` 默认会输出 `Model Sources`、provider 解析细节、默认 worker 解析链。

**影响**

- 对已经熟悉系统的人有帮助。
- 对首次用户来说，信息密度偏高，真正重要的“下一步该做什么”反而不突出。

**建议**

1. 默认输出保留健康摘要、协议状态、下一步建议。
2. 把来源链、解析细节下沉到 `--verbose` 或 `--json`。

---

## 4. 建议的修复优先级

建议按以下顺序处理：

1. **先修 `claude` smoke test** —— 它直接影响 `init`、`doctor` 和 `plan --run` 的可信度。
2. **再修 `init --json` 纯度** —— 这是插件化、自动化接入的基础。
3. **修 `config import` dry-run 诊断语义** —— 这是配置 onboarding 的第一印象。
4. **调整 auto-import 的 fleet 策略** —— 这决定产品是否真正体现“强模型指挥 + 弱模型执行”。
5. **统一 dashboard / 空仓库入口行为** —— 降低首次使用的困惑成本。

---

## 5. 附：本次实际复现到的关键现象

### 5.1 `init` 成功安装但最终失败

- 协议安装成功
- skills 安装成功
- 配置导入成功
- doctor 阶段因 `claude` runtime probe 参数不兼容而失败

这类结果应该在 UX 上明确区分为：

- **setup completed**
- **validation failed**

而不是让用户只看到一个整体失败状态。

### 5.2 `dashboard --mode auto` 在非 TTY / 非 agent 环境静默退出

- 退出码是 0
- 没有任何 stdout/stderr 提示

这属于典型“命令看起来执行成功，但用户没有得到反馈”的体验问题。

---

## 6. 总评

Commander 的**功能链路设计是对的**，而且已经有不错的文档和测试基础；当前短板主要集中在：

- 首次使用时的**反馈一致性**
- 自动化场景下的**输出契约稳定性**
- 配置导入策略与产品成本定位的**一致性**

如果只做一轮小而准的 UX 修复，我建议优先完成下面 3 件事：

1. 修掉 `claude` smoke test 参数兼容问题
2. 保证 `init --json` 的 stdout 只有 JSON
3. 让 `config import` dry-run 展示“候选配置的真实诊断结果”

这样就能明显提升首次上手成功率，也能让 Commander 更适合作为插件/脚本的底层能力。
