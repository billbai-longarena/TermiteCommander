# OpenClaw + 白蚁协议互补集成设计

**日期**: 2026-03-05
**状态**: 设计草案
**前置文档**: `2026-03-05-openclaw-integration-assessment.md`

---

## 1. 设计哲学

### 1.1 各自的强项

```
白蚁协议                              OpenClaw
─────────                            ────────
去中心化自组织                         中心化精确调度
环境自动代谢                           实时 Presence 广播
知识涌现 (observation → rule)          语义记忆搜索
Shepherd Effect (模板行为传播)          多通道投递 (Slack/Discord/Telegram)
原子 claim (无瓶颈并发)                层级 subagent 编排 (spawn/steer/kill)
.birth 个性化简报 (800 token)          Bootstrap 模板系统
信号衰减 + ALARM 升级                  Followup queue + debounce 批处理
Shell 脚本 (sqlite3 + bash)            Node.js 全栈 (hooks/plugins/tools)
```

### 1.2 互补原则

**不是让 OpenClaw "变成" 白蚁，而是让白蚁的环境智能流过 OpenClaw 的通道。**

```
                   ┌─────────────────────────────────────┐
                   │         白蚁协议 (环境层)             │
                   │  .termite.db  .birth  .pheromone     │
                   │  signals  observations  rules        │
                   │  field-arrive  field-cycle  field-*   │
                   └──────────┬──────────────┬────────────┘
                              │              │
              ┌───────────────┤              ├───────────────┐
              ▼               ▼              ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ opencode │   │  claude   │   │  codex   │   │ openclaw │
        │ (直接)   │   │ (直接)   │   │ (直接)   │   │ (网关)   │
        └──────────┘   └──────────┘   └──────────┘   └────┬─────┘
                                                          │
                                              ┌───────────┼───────────┐
                                              ▼           ▼           ▼
                                         多通道投递    语义记忆     Subagent
                                         (Slack等)    (向量搜索)    编排
```

**三层集成**:

| 层级 | 名称 | 含义 |
|------|------|------|
| L1 | Worker Runtime | OpenClaw 作为 Commander 的第四种 Worker CLI |
| L2 | Protocol Native | OpenClaw Agent 原生执行白蚁协议生命周期 |
| L3 | Capability Fusion | OpenClaw 的独有能力反哺白蚁协议 |

---

## 2. L1: Worker Runtime（已设计，见前置文档）

Commander 通过 `openclaw agent --agent <id> --message <prompt> --json` 分发信号给 OpenClaw worker。

详见 `2026-03-05-openclaw-integration-assessment.md` 第 5-6 节。

---

## 3. L2: Protocol Native — OpenClaw Agent 原生执行白蚁生命周期

### 3.1 核心思路

利用 OpenClaw 的 **Plugin Hook 系统** 在 Agent 生命周期的关键节点注入白蚁协议操作。

```
OpenClaw Agent 生命周期          注入的白蚁协议操作
─────────────────────          ──────────────────
agent:bootstrap         →      field-arrive.sh → 生成 .birth → 注入 bootstrapFiles
before_agent_start      →      读 .birth → 注入 prependContext (caste/signal/rules)
before_tool_call        →      field-claim.sh check (防止两个 agent 抢同一个 signal)
after_tool_call         →      记录 tool 调用到 observation trail
agent_end               →      field-deposit.sh --pheromone (写 .pheromone 离场)
session_end             →      field-cycle.sh (触发环境代谢)
```

### 3.2 Plugin 结构

```
openclaw-termite-plugin/
├── plugin.json                    # 插件清单
├── hooks/
│   ├── on-bootstrap.ts            # agent:bootstrap → field-arrive.sh
│   ├── on-agent-start.ts          # before_agent_start → 读 .birth 注入上下文
│   ├── on-tool-call.ts            # before_tool_call → claim 防冲突
│   ├── on-agent-end.ts            # agent_end → field-deposit.sh --pheromone
│   └── on-session-end.ts          # session_end → field-cycle.sh
├── tools/
│   ├── termite-claim.ts           # 封装 field-claim.sh 为 OpenClaw tool
│   ├── termite-deposit.ts         # 封装 field-deposit.sh 为 OpenClaw tool
│   ├── termite-status.ts          # 封装 signal 状态查询
│   └── termite-decompose.ts       # 封装 field-decompose.sh
└── lib/
    ├── field-runner.ts            # 执行 field-*.sh 的 Node 封装
    └── birth-parser.ts            # 解析 .birth 文件为结构化数据
```

### 3.3 各 Hook 详细设计

#### Hook 1: `agent:bootstrap` → field-arrive.sh

**触发时机**: Agent workspace 初始化时
**OpenClaw 接口**: `registerInternalHook('agent:bootstrap', handler)` (`bootstrap-hooks.ts:7-31`)

```typescript
// hooks/on-bootstrap.ts
import { runFieldScript } from '../lib/field-runner.ts';

export async function onBootstrap(event: InternalHookEvent) {
  const { workspaceDir, bootstrapFiles, agentId } = event.context;

  // 1. 检测是否在白蚁蚁群中 (有 scripts/field-arrive.sh)
  const colonyRoot = detectColonyRoot(workspaceDir);
  if (!colonyRoot) return; // 非蚁群项目，跳过

  // 2. 运行 field-arrive.sh，生成 .birth
  await runFieldScript(colonyRoot, 'field-arrive.sh', {
    env: {
      TERMITE_WORKER_ID: `openclaw-${agentId}`,
      TERMITE_TRIGGER_TYPE: 'directive',
    },
  });

  // 3. 读取 .birth，注入到 bootstrapFiles
  const birthContent = await readFile(join(colonyRoot, '.birth'), 'utf-8');
  bootstrapFiles.push({
    name: 'TERMITE_BIRTH.md',
    content: birthContent,
  });
}
```

**效果**: OpenClaw Agent 启动时自动获得白蚁 .birth 简报——包含 caste 分配、top signal、行为模板、rules。

#### Hook 2: `before_agent_start` → 注入白蚁上下文

**触发时机**: Model 解析和 prompt 构建之前
**OpenClaw 接口**: Plugin hook `before_agent_start` (`plugins/hooks.ts:293-310`)

```typescript
// hooks/on-agent-start.ts
export async function onAgentStart(context: BeforeAgentStartContext) {
  const colonyRoot = detectColonyRoot(context.workspaceDir);
  if (!colonyRoot) return {};

  // 解析 .birth 获取结构化信息
  const birth = parseBirth(await readFile(join(colonyRoot, '.birth'), 'utf-8'));

  // 注入蚁群上下文到 system prompt 前缀
  const termiteContext = [
    `[Termite Colony] Caste: ${birth.caste} | Signal: ${birth.taskId} | Phase: ${birth.phase}`,
    birth.situation,
    birth.rules.map(r => `Rule ${r.id}: ${r.trigger} → ${r.action}`).join('\n'),
  ].join('\n\n');

  return {
    prependContext: termiteContext,
    // 如果 .birth 指定了 caste=soldier 且有 ALARM，可覆盖 model
    // modelOverride: birth.caste === 'soldier' ? 'claude-sonnet-4' : undefined,
  };
}
```

**效果**: Agent 的 system prompt 开头自动包含蚁群状态、分配的 signal、适用规则。Agent 不需要自己读 .birth。

#### Hook 3: `before_tool_call` → 原子 claim 防冲突

**触发时机**: Agent 调用任何 tool 之前
**OpenClaw 接口**: Plugin hook `before_tool_call` (`plugins/hooks.ts:429-443`)

```typescript
// hooks/on-tool-call.ts
export async function onToolCall(context: BeforeToolCallContext) {
  // 只拦截文件写入类 tool
  if (!isFileWriteTool(context.toolName)) return {};

  const colonyRoot = detectColonyRoot(context.workspaceDir);
  if (!colonyRoot) return {};

  // 检查目标文件是否在其他 agent 的 claim 范围内
  const targetPath = extractTargetPath(context.params);
  const claimCheck = await runFieldScript(colonyRoot, 'field-claim.sh', {
    args: ['check', targetPath, 'work'],
  });

  if (claimCheck.exitCode !== 0) {
    return {
      block: true,
      blockReason: `File ${targetPath} is claimed by another worker. Wait or pick a different signal.`,
    };
  }

  return {};
}
```

**效果**: 多个 OpenClaw Agent 并发工作时，file write 自动检查 claim 锁，防止冲突。

#### Hook 4: `agent_end` → 写 pheromone 离场

**触发时机**: Agent 完成任务时
**OpenClaw 接口**: Plugin hook `agent_end` (`plugins/hooks.ts:317-322`)

```typescript
// hooks/on-agent-end.ts
export async function onAgentEnd(context: AgentEndContext) {
  const colonyRoot = detectColonyRoot(context.workspaceDir);
  if (!colonyRoot) return;

  const birth = parseBirth(await readFile(join(colonyRoot, '.birth'), 'utf-8'));

  // 从 agent 的对话历史中提取完成情况
  const summary = extractCompletionSummary(context.conversation);

  // 写 pheromone
  await runFieldScript(colonyRoot, 'field-deposit.sh', {
    args: [
      '--pheromone',
      '--caste', birth.caste,
      '--completed', summary.completed.join(', '),
      '--unresolved', summary.unresolved.join(', '),
      '--predecessor-useful', String(summary.foundBirthUseful),
      '--platform', 'openclaw',
      '--strength', inferStrengthTier(context.model),
    ],
  });

  // 如果有高质量观察，也存入
  for (const obs of summary.observations) {
    await runFieldScript(colonyRoot, 'field-deposit.sh', {
      args: [
        '--pattern', obs.pattern,
        '--context', obs.context,
        '--confidence', obs.confidence,
        '--detail', obs.detail,
      ],
    });
  }
}
```

**效果**: Agent 离场时自动在环境中留下痕迹。后续 Agent 到达时通过 .birth 获知前任的工作。

#### Hook 5: `session_end` → 触发环境代谢

**触发时机**: Session 关闭时
**OpenClaw 接口**: Plugin hook `session_end` (`plugins/hooks.ts:611-616`)

```typescript
// hooks/on-session-end.ts
export async function onSessionEnd(context: SessionEndContext) {
  const colonyRoot = detectColonyRoot(context.workspaceDir);
  if (!colonyRoot) return;

  // 触发 field-cycle.sh 代谢
  // 异步执行，不阻塞 session 关闭
  runFieldScript(colonyRoot, 'field-cycle.sh', { detached: true });
}
```

**效果**: 每次 session 结束触发一轮代谢——signal 衰减、observation 晋升、stale 归档。

### 3.4 白蚁 Tools 注册

将白蚁协议操作封装为 OpenClaw 原生 tool，让 Agent 可以主动调用。

#### Tool: `termite_claim`

```typescript
// tools/termite-claim.ts
export function createTermiteClaimTool(colonyRoot: string) {
  return {
    name: 'termite_claim',
    description: 'Claim a termite signal for exclusive work, or release a claim',
    parameters: {
      action: { type: 'string', enum: ['claim', 'release', 'check', 'list'] },
      signalId: { type: 'string', description: 'Signal ID (e.g. S-001)' },
      operation: { type: 'string', enum: ['work', 'audit', 'review'], default: 'work' },
    },
    async execute({ action, signalId, operation }) {
      return runFieldScript(colonyRoot, 'field-claim.sh', {
        args: [action, signalId, operation, agentId].filter(Boolean),
      });
    },
  };
}
```

#### Tool: `termite_deposit`

```typescript
// tools/termite-deposit.ts
export function createTermiteDepositTool(colonyRoot: string) {
  return {
    name: 'termite_deposit',
    description: 'Deposit an observation or dispute a rule in the termite colony',
    parameters: {
      pattern: { type: 'string', description: 'Observed pattern or convention' },
      context: { type: 'string', description: 'File path or module where observed' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], default: 'medium' },
      detail: { type: 'string', description: 'Extended description' },
      disputeRuleId: { type: 'string', description: 'If disputing a rule, the rule ID' },
      disputeReason: { type: 'string', description: 'Why the rule is inapplicable' },
    },
    async execute(params) {
      if (params.disputeRuleId) {
        return runFieldScript(colonyRoot, 'field-deposit.sh', {
          args: ['--dispute', params.disputeRuleId, '--reason', params.disputeReason],
        });
      }
      return runFieldScript(colonyRoot, 'field-deposit.sh', {
        args: [
          '--pattern', params.pattern,
          '--context', params.context,
          '--confidence', params.confidence,
          '--detail', params.detail || '',
        ],
      });
    },
  };
}
```

#### Tool: `termite_status`

```typescript
// tools/termite-status.ts
export function createTermiteStatusTool(colonyRoot: string) {
  return {
    name: 'termite_status',
    description: 'Query termite colony status: signals, rules, claims',
    parameters: {
      query: { type: 'string', enum: ['signals', 'rules', 'claims', 'health'] },
    },
    async execute({ query }) {
      const db = join(colonyRoot, '.termite.db');
      switch (query) {
        case 'signals':
          return sqliteQuery(db, `SELECT id, type, title, status, weight, owner FROM signals WHERE status IN ('open','claimed') ORDER BY weight DESC`);
        case 'rules':
          return sqliteQuery(db, `SELECT id, trigger_text, action_text, hit_count, disputed_count FROM rules ORDER BY hit_count DESC LIMIT 10`);
        case 'claims':
          return sqliteQuery(db, `SELECT signal_id, operation, owner, claimed_at FROM claims`);
        case 'health':
          return sqliteQuery(db, `SELECT key, value FROM colony_state`);
      }
    },
  };
}
```

#### Tool: `termite_decompose`

```typescript
// tools/termite-decompose.ts
export function createTermiteDecomposeTool(colonyRoot: string) {
  return {
    name: 'termite_decompose',
    description: 'Decompose a complex signal into child signals',
    parameters: {
      parentId: { type: 'string', description: 'Parent signal ID' },
      children: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            module: { type: 'string' },
            hint: { type: 'string' },
          },
        },
      },
    },
    async execute({ parentId, children }) {
      const args = ['--parent', parentId];
      for (const child of children) {
        args.push('--child', child.title, '--module', child.module || '');
        if (child.hint) args.push('--hint', child.hint);
      }
      return runFieldScript(colonyRoot, 'field-decompose.sh', { args });
    },
  };
}
```

---

## 4. L3: Capability Fusion — OpenClaw 独有能力反哺白蚁协议

这一层是真正的互补——白蚁协议做不到但 OpenClaw 能做到的事。

### 4.1 多通道 ALARM 投递

**问题**: 白蚁协议的 ALARM.md 只是一个文件。人类不看就错过了。

**方案**: OpenClaw 的多通道系统把 ALARM 推送到人类实际使用的通道。

```
ALARM.md 生成
    ↓
OpenClaw file watcher (chokidar)
    ↓
┌───────────────────────────────────────┐
│ 解析 ALARM.md 内容                    │
│ 生成紧急消息                          │
│   → Slack #ops-alerts                │
│   → Discord @admin                   │
│   → Telegram 管理员群                 │
│   → 浮窗/通知 (Desktop)              │
└───────────────────────────────────────┘
```

**实现**: 在 OpenClaw cron 中注册一个文件监控 job：

```typescript
// 通过 cron tool 注册
{
  action: 'add',
  label: 'termite-alarm-watch',
  schedule: { type: 'every', interval: '30s' },
  payload: {
    type: 'systemEvent',
    task: 'Check for ALARM.md in colony root. If exists and is new, send alert to configured channels.',
  },
  delivery: 'announce',  // 广播到所有绑定通道
}
```

或更优雅地：用 `chokidar` watch ALARM.md，通过 OpenClaw internal hook 触发 `sessions_send`。

### 4.2 语义记忆索引蚁群知识

**问题**: 白蚁协议的 observations 和 rules 只能通过 SQL 查询或 .birth 中的 top-5 获取。Agent 无法语义搜索历史知识。

**方案**: 将蚁群知识导入 OpenClaw Memory 系统，支持向量语义搜索。

```
.termite.db
├── observations 表 (pattern, context, detail)
├── rules 表 (trigger_text, action_text)
├── pheromone_history 表 (completed, unresolved, observation_example)
    ↓
    导出为 markdown 文件
    ↓
OpenClaw Memory Sync
    ↓
SQLite 向量索引 (~/.openclaw/state/memory/termite.sqlite)
    ↓
Agent 可用 memory_search tool 语义搜索
```

**同步策略**:

```typescript
// memory sync config 扩展
{
  sync: {
    onSessionStart: true,     // 每次 session 开始同步
    watch: true,              // 监听 .termite.db 变化
    intervalMinutes: 5,       // 每 5 分钟增量同步
  },
  sources: [
    { type: 'memory', paths: ['MEMORY.md', 'memory/'] },         // 原有
    { type: 'termite', dbPath: '.termite.db', tables: [           // 新增
      'observations',   // pattern + context + detail → 向量化
      'rules',          // trigger + action → 向量化
      'pheromone_history',  // observation_example → 向量化
    ]},
  ],
}
```

**效果**: Agent 可以这样搜索蚁群知识：

```
memory_search("organizationId parsing issues")
→ Returns:
  1. Rule R-003: "When encountering organizationId..." → "Never use parseInt()..."
  2. Observation O-025: "organizationId parsing bug in filter logic" (quality: 0.8)
  3. Pheromone: Agent worker-7 completed "Fix organizationId tenant routing"
```

这比 .birth 里的 top-5 rules 强大得多——Agent 可以在需要时按语义精确检索任何历史知识。

### 4.3 Subagent 编排 → Signal 分解树

**问题**: 白蚁协议的 signal 分解需要 Commander 或强模型手动调用 field-decompose.sh。

**方案**: OpenClaw 的 subagent spawn 系统天然映射到 signal 分解。

```
OpenClaw Agent (scout caste) 收到复杂 signal S-001
    ↓
调用 termite_decompose tool，创建 S-001-1, S-001-2, S-001-3
    ↓
调用 sessions_spawn 为每个子 signal 创建 subagent
    ├── Subagent-1: --agent coding-fast --message "S-001-1: ..."
    ├── Subagent-2: --agent coding-fast --message "S-001-2: ..."
    └── Subagent-3: --agent coding-deep --message "S-001-3: ..."
    ↓
每个 subagent 的 agent:bootstrap hook 自动运行 field-arrive.sh
    → 自动获得对应子 signal 的 .birth
    ↓
Subagent 完成 → agent_end hook 自动写 pheromone
    ↓
subagent_ended hook 触发 field-cycle.sh
    → 自动聚合：S-001-1 done + S-001-2 done + S-001-3 done → S-001 done
```

**关键映射**:

| OpenClaw 概念 | 白蚁协议概念 | 映射关系 |
|--------------|-------------|---------|
| Parent agent | Scout caste | 分解复杂 signal |
| `sessions_spawn` | `field-decompose.sh` | 创建子任务 |
| Subagent | Worker caste | 执行子 signal |
| `subagent_ended` | 子 signal done | 触发聚合 |
| `steer` | Signal re-weight | 运行时调整方向 |
| `kill` | Signal park | 放弃某个方向 |

**新能力**: 这让白蚁协议获得了**运行时转向**能力。当前协议中，signal 一旦 claimed 就只能等完成或超时。通过 OpenClaw 的 steer 机制，Parent 可以在子 signal 执行过程中改变方向。

### 4.4 Presence 广播 → Colony Dashboard

**问题**: 白蚁协议的状态只能通过 `termite-commander status` 或 TUI 查看。

**方案**: OpenClaw 的 Gateway Presence 系统实时广播蚁群状态到 Web UI 和所有连接方。

```
.termite.db (signal status)
    ↓
OpenClaw cron job (every 15s)
    ↓ 查询 signal status
    ↓
broadcastPresenceSnapshot({
  termite: {
    phase: 'active',
    signals: { open: 3, claimed: 2, done: 12 },
    workers: [
      { id: 'openclaw-agent-1', caste: 'worker', signal: 'S-005', status: 'running' },
      { id: 'openclaw-agent-2', caste: 'scout', signal: 'S-008', status: 'idle' },
    ],
    rules: 5,
    observations: 23,
    lastCommit: 'abc1234 (3 min ago)',
    alarm: null,
  }
})
    ↓
┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
│ Web Dashboard    │  │ Slack Bot    │  │ CLI status   │
│ (Canvas UI)      │  │ #colony-feed │  │ (terminal)   │
└──────────────────┘  └──────────────┘  └──────────────┘
```

### 4.5 Followup Queue → Signal 批处理

**问题**: 当多个外部请求同时到达时，白蚁协议每个都创建独立 signal，可能产生重复。

**方案**: 利用 OpenClaw 的 Followup Queue 的 `collect` 模式，把短时间内到达的相关请求合并。

```
T=0s  用户在 Slack: "fix the auth bug"
T=2s  用户在 Slack: "also check the token expiry"
T=5s  用户在 Discord: "auth module has issues"
    ↓
Followup Queue (collect mode, debounce=10s)
    ↓ 合并为一个 batch
    ↓
OpenClaw Agent 分析 batch:
  "Three related requests about auth module"
  → 创建 1 个 HOLE signal: "Fix auth module (token expiry + general issues)"
  而不是 3 个重复 signal
```

### 4.6 Thread Binding → Signal 讨论区

**问题**: 白蚁协议的 signal 没有讨论/反馈通道。人类只能修改 YAML 文件。

**方案**: OpenClaw 的 Thread Binding 把每个 signal 映射到一个聊天线程。

```
Signal S-005: "Implement OAuth"
    ↓
OpenClaw 自动创建 Slack thread: #colony → "🐜 S-005: Implement OAuth"
    ↓
人类在 thread 中:
  "Use PKCE flow, not implicit"
    ↓
OpenClaw 收到消息 → 更新 S-005.next_hint:
  "Scout: use PKCE flow, not implicit grant"
    ↓
下一个 Worker 到达 → .birth 中看到更新的 hint
```

**效果**: 人类可以通过聊天自然语言直接影响蚁群 signal，不需要编辑文件或用 CLI。

### 4.7 率限 Steer → 信号素浓度调整

**问题**: 白蚁协议的 signal weight 只在 field-cycle.sh 代谢时调整（被动衰减）。没有主动加权机制。

**方案**: OpenClaw 的 `steer` 机制映射为 signal weight 调整。

```typescript
// 当 parent agent steer 一个 subagent 时：
async function onSteer(parentSessionKey, childSessionKey, newTask) {
  const birth = getChildBirth(childSessionKey);
  const signalId = birth.taskId;

  // steer = 信号变得更重要 → weight 提升
  await sqliteExec(colonyDb, `
    UPDATE signals SET weight = MIN(weight + 15, 100), next_hint = ?
    WHERE id = ?
  `, [newTask, signalId]);
}
```

---

## 5. 协议扩展：OpenClaw 需要新增的白蚁概念

### 5.1 新 Platform 类型

在 field-arrive.sh 的 platform 检测中增加 OpenClaw：

```bash
# field-arrive.sh 平台检测扩展
if [ -n "${OPENCLAW_AGENT_ID:-}" ]; then
  PLATFORM="openclaw"
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  PLATFORM="claude-code"
# ...
```

**环境变量**: OpenClaw plugin 在 spawn 时设置 `OPENCLAW_AGENT_ID` 和 `OPENCLAW_SESSION_KEY`。

### 5.2 新 Caste: `relay`

现有 caste: scout, worker, soldier, nurse

新增 **relay** — 不执行编码任务，专门做信息桥接：

```
relay caste 职责:
├── 监控 ALARM.md → 推送到聊天通道
├── 收集聊天通道中的人类反馈 → 更新 signal hints
├── 汇总 colony 状态 → 定时广播
└── 合并重复请求 → 创建去重 signal
```

relay 不 claim signal，不提交代码，不写 observation。它只读环境、写 signal hints。

### 5.3 新 Signal Source: `channel`

现有 source: `autonomous`, `directive`, `emergent`

新增 **`channel`** — 来自聊天通道的 signal：

```yaml
id: S-015
type: HOLE
title: "Fix auth token expiry"
source: channel              # ← 来自聊天通道
channel_origin: "slack:#dev" # ← 来源通道
requestor: "@alice"          # ← 请求者
```

### 5.4 Strength Tier 扩展

现有 tier: `execution`, `judgment`, `direction`

OpenClaw 的模型 failover 链意味着同一个 agent 可能在不同时刻使用不同模型。Strength tier 应从"固定标签"变为"每次 session 动态推断"：

```typescript
function inferStrengthTier(modelUsed: string): string {
  if (/opus|o1|o3/i.test(modelUsed)) return 'direction';
  if (/sonnet|gpt-4/i.test(modelUsed)) return 'judgment';
  return 'execution';
}
```

---

## 6. 数据流总图

```
                        人类
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
           Slack      Discord    Terminal
              │          │          │
              └──────────┼──────────┘
                         │
                   OpenClaw Gateway
                    ┌────┴────┐
                    │ Routing │
                    │ Hooks   │
                    │ Cron    │
                    │ Memory  │
                    └────┬────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    relay agent    scout agent    worker agents
    (监控/桥接)    (分解/规划)    (编码/执行)
          │              │              │
          │    ┌─────────┼─────────┐    │
          │    ▼         ▼         ▼    │
          │  termite   termite   termite │
          │  _decompose _claim   _deposit│
          │    │         │         │     │
          └────┼─────────┼─────────┼────┘
               ▼         ▼         ▼
        ┌─────────────────────────────────┐
        │       白蚁协议环境层              │
        │                                 │
        │  .termite.db                    │
        │  ├─ signals (任务池)             │
        │  ├─ observations (模式观察)      │
        │  ├─ rules (涌现知识)            │
        │  ├─ claims (原子锁)             │
        │  └─ pheromone_history (痕迹链)   │
        │                                 │
        │  .birth (Agent 简报)            │
        │  .pheromone (离场痕迹)           │
        │  ALARM.md → OpenClaw 多通道推送  │
        │  BLACKBOARD.md → Memory 索引    │
        │                                 │
        │  field-cycle.sh (自动代谢)       │
        │  └→ 衰减、归档、晋升、压缩       │
        │     每次 session 结束触发        │
        └─────────────────────────────────┘
               ▲         ▲         ▲
               │         │         │
        opencode     claude      codex
        workers      workers     workers
        (也参与同一个环境)
```

---

## 7. 新涌现的能力（两者都做不到的）

| # | 能力 | 白蚁单独 | OpenClaw 单独 | 组合后 |
|---|------|---------|-------------|--------|
| 1 | 人类通过聊天影响 signal | 不行（需编辑文件） | 不行（无 signal 概念） | Slack 消息 → 更新 signal hint |
| 2 | 蚁群知识语义搜索 | 不行（只有 SQL + top-5） | 不行（无蚁群知识） | Memory 向量索引 observations/rules |
| 3 | 运行时 signal 转向 | 不行（claim 后等完成） | 不行（无 signal 概念） | steer subagent → 更新 signal weight/hint |
| 4 | ALARM 实时推送 | 不行（文件等人看） | 不行（无 ALARM 概念） | ALARM.md → Slack/Discord/Telegram 推送 |
| 5 | 请求去重 | 不行（每个请求一个 signal） | 不行（无 signal 概念） | Followup queue collect → 合并为 1 个 signal |
| 6 | Signal 讨论线程 | 不行（signal 是数据库行） | 不行（thread 无 signal 绑定） | Thread binding → signal 评论区 |
| 7 | 跨运行时混合编队 | Commander 已支持 | 不行（只管自己的 agent） | Scout(openclaw) + Worker(claude) + Worker(codex) 共享环境 |

---

## 8. 实施路径

### Phase 1: Plugin 骨架（最小可行）

```
目标: OpenClaw agent 在蚁群中能自动获得 .birth 并写 .pheromone
改动: openclaw-termite-plugin 的 bootstrap + agent_end hooks
验证: 单个 openclaw agent 在蚁群目录中 arrive → work → deposit
```

### Phase 2: Tools 注册

```
目标: Agent 可主动操作蚁群 (claim, deposit, status, decompose)
改动: 注册 4 个 termite_* tools
验证: Agent 通过 tool call 完成 signal 生命周期
```

### Phase 3: 多通道桥接

```
目标: ALARM → Slack 推送, 聊天反馈 → signal hint 更新
改动: relay caste + cron job + thread binding
验证: 在 Slack 中看到蚁群状态更新和 ALARM 通知
```

### Phase 4: 语义记忆

```
目标: Agent 可通过 memory_search 搜索蚁群历史知识
改动: Memory sync 扩展 + termite db 导出
验证: memory_search("auth bug") 返回相关 observations 和 rules
```

### Phase 5: Subagent 编排融合

```
目标: Scout spawn subagents 自动映射到 signal 分解树
改动: sessions_spawn hook → field-decompose.sh + subagent_ended → auto-aggregate
验证: 复杂 signal 自动分解 → 并行 subagent 执行 → 自动聚合完成
```

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| field-*.sh 依赖 bash + sqlite3 | OpenClaw 部分环境可能没有 sqlite3 | field scripts 已有 YAML fallback；也可在 plugin 中用 better-sqlite3 npm 包直接读写 |
| Hook 执行延迟影响 agent 启动速度 | field-arrive.sh 可能耗时数百毫秒 | bootstrap hook 中做缓存：如果 .birth 存在且 <5min，直接复用 |
| 多 plugin hook 竞争 | OpenClaw 可能有其他 plugin 也修改 prependContext | 使用 priority 排序，termite plugin 优先级设为高 |
| .termite.db 并发写入 | 多个 openclaw agent 同时写 | SQLite WAL 模式已处理；claim 用 PRIMARY KEY 保证原子性 |
| Steer 与白蚁协议的被动衰减冲突 | 主动加权 vs 自动衰减可能振荡 | steer 调权量 (+15) 应大于单次衰减量 (×0.98)，保证净增 |
| OpenClaw gateway 宕机 | relay/alarm 推送中断 | Gateway 宕机不影响白蚁协议本身运作；只是失去多通道能力 |

---

## 10. 决策待定

| 问题 | 选项 | 倾向 |
|------|------|------|
| Plugin 实现语言 | TypeScript (OpenClaw 原生) / Shell wrapper | **TypeScript** — 与 OpenClaw 生态一致 |
| DB 访问方式 | 调用 field-*.sh / 直接用 better-sqlite3 读写 | **field-*.sh** — 保持协议一致性，避免双写 |
| 协议扩展是否回推到 TermiteProtocol 仓库 | 回推 / 仅在 plugin 中处理 | **回推** — platform=openclaw、caste=relay、source=channel 应成为协议标准 |
| Phase 1-5 是否需要 Commander 参与 | 需要 / OpenClaw 独立完成 | Phase 1-4 OpenClaw 独立；Phase 5 需要 Commander 协调 |
| Memory 索引更新频率 | 实时 / 5min / session start | **session start** — 平衡新鲜度和性能 |
