# 自适应信号调度实验设计

**Date**: 2026-03-06
**Type**: 实验设计
**Status**: 待实施
**Prerequisite**: [白蚁协议 vs 群智能论文对比分析](./2026-03-06-swarm-intelligence-comparative-analysis.md)

---

## 一、背景与动机

对比分析（2026-03-06）发现白蚁协议相对于经典群智能理论有两个可借鉴方向：

1. **连续适应空间**：论文用性格特征向量 γ ∈ ℝⁿ 让同构 agent 产生异构行为，白蚁协议当前依赖离散 caste（worker/scout/soldier）和已弃用的 T0/T1/T2 tier
2. **博弈论信号竞争**：论文的回报函数间接依赖其他 agent 行为，白蚁协议的 claim 是纯"先到先得"，未考虑 agent-signal 匹配度

本文设计两组实验，将上述理论洞察转化为**可测量的假设**，在真实蚁群运行中验证。

---

## 二、实验假设

### H1：行为参数 β（连续适应空间）

> 如果 `.birth` 生成算法根据蚁群当前状态动态计算行为偏向参数 β ∈ [0, 1]（0=执行倾向, 1=探索倾向），并通过 `.birth` 指令措辞引导 agent 行为，那么蚁群的**模块覆盖均匀度**将优于固定 caste 分配，且**信号完成速率**不下降。

**理论依据**：论文式 6.4-6.6 定义了性格特征如何影响行为选择的回报函数。β 是该框架在无状态 agent 环境中的简化映射——不要求 agent 自我学习，而是由环境（field-arrive.sh）代为计算。

### H2：Affinity 推荐（信号竞争最优分配）

> 如果 claim 推荐策略从"纯 weight 排序"改为"weight + 模块亲和度加权"，那么 signal 的**首次完成率**（claim 后直接 done，未被 park/stale/expire）将提高。

**理论依据**：论文式 6.1 的势场模型中，每个机器人对同一环境的感知不同。Affinity 推荐让每个 agent 看到"个性化的势场"——weight 是全局吸引力，affinity 是个体吸引力。

---

## 三、协议层变更（最小侵入）

### 3.1 新增字段

**signals 表**：

| 字段 | 类型 | 默认值 | 用途 |
|------|------|--------|------|
| `module_affinity` | TEXT | `'{}'` | JSON dict，推荐执行此 signal 的模块专长分布 |

**pheromone_history 表**：

| 字段 | 类型 | 默认值 | 用途 |
|------|------|--------|------|
| `module_stats` | TEXT | `'{}'` | JSON dict，agent 历史完成信号的模块分布统计 |
| `behavior_bias` | REAL | 0.5 | 本次会话注入的 β 值（审计回溯用） |

### 3.2 .birth 新增注入

```yaml
# field-arrive.sh 新增输出
behavior_bias: 0.7              # β ∈ [0,1], 0=execute, 1=explore
bias_reason: "high_concentration" # 计算依据
recommended_signal: S-042        # affinity 匹配最高的 signal
affinity_match: 0.85             # 匹配度 [0,1]
```

### 3.3 不变的部分

- signal 生命周期（open → claimed → done）
- claim 原子锁机制（先到先得，affinity 仅为推荐）
- caste waterfall（β 是额外维度，不替代 caste）
- 信号类型、权重范围
- pheromone chain 结构

**设计原则**：所有新增都是增量数据（新字段、新记录）。实验关闭时忽略新字段即可回退。

---

## 四、行为参数 β 的计算

### 4.1 公式

```
β = clamp(0, 1, w_c × C + w_d × D + w_s × S)
```

| 变量 | 定义 | 语义 |
|------|------|------|
| C | `1 - max_module_share` | 信号集中度的反面。集中 → C 小 → β 偏执行 |
| D | `done_signals / total_signals` | 完成率。高 → D 大 → β 偏探索（快做完了，探索新方向） |
| S | `stale_signals / open_signals` | 停滞比。高 → S 大 → β 偏探索（当前路径走不通） |

初始权重：w_c = 0.4, w_d = 0.3, w_s = 0.3

### 4.2 β 对 .birth 的影响

| β 范围 | 行为导向 | .birth 指令调整 |
|--------|----------|----------------|
| [0, 0.3) | 执行模式 | "Claim and complete the highest-weight signal. Minimize exploration. Focus on delivery." |
| [0.3, 0.7] | 标准模式 | 与当前 .birth 行为一致，无额外指令 |
| (0.7, 1.0] | 探索模式 | "Investigate uncovered modules. Create EXPLORE signals for gaps. Prioritize breadth over depth." |

### 4.3 数据来源

所有变量从现有 SQLite 表可直接查询：

```sql
-- C: max module share
SELECT MAX(cnt) * 1.0 / SUM(cnt) AS max_share
FROM (SELECT module, COUNT(*) AS cnt FROM signals WHERE status='open' GROUP BY module);

-- D: done rate
SELECT COUNT(CASE WHEN status='done' THEN 1 END) * 1.0 / COUNT(*) FROM signals;

-- S: stale ratio
SELECT COUNT(CASE WHEN status='stale' THEN 1 END) * 1.0 /
       NULLIF(COUNT(CASE WHEN status='open' THEN 1 END), 0) FROM signals;
```

---

## 五、Affinity Score 计算

### 5.1 公式

```
affinity(agent, signal) = Σ min(agent_module_freq[m], signal_module_weight[m])
                          for each module m
```

这是两个分布的**直方图交集**（histogram intersection），取值 [0, 1]。

- `agent_module_freq[m]`：从 `pheromone_history.module_stats` 统计，agent 过去完成信号中模块 m 的归一化频率
- `signal_module_weight[m]`：signal 的 `module` + `module_affinity` 字段的归一化权重

### 5.2 推荐展示

当 affinity 最高的 signal ≠ weight 最高的 signal 时，`.birth` 同时展示两个选项：

```yaml
top_task:          S-012 (weight: 80, affinity: 0.3)  # 最紧急
recommended_task:  S-017 (weight: 45, affinity: 0.9)  # 最匹配你的历史
```

Agent 自行选择。不强制——保留 agent 自主性。

### 5.3 新 agent 处理

`module_stats` 为空 → 所有 affinity = 0 → 退化为纯 weight 排序。与当前行为完全一致，零回归风险。

---

## 六、度量指标

### 6.1 主指标

| 指标 | 定义 | SQL 度量 | 关联假设 |
|------|------|----------|----------|
| 首次完成率 | claim 后直接 done 的比例 | `COUNT(done after claim) / COUNT(claimed)` | H2 |
| 模块覆盖均匀度 | 各模块 done signal 数的 1 - Gini 系数 | 外部计算 | H1 |
| 信号完成速率 | done signals / runtime hours | `COUNT(done) / hours` | H1 + H2 |

### 6.2 辅助指标

| 指标 | 定义 | 用途 |
|------|------|------|
| β 分布直方图 | 所有会话 behavior_bias 值的分布 | 验证 β 动态变化 |
| affinity 推荐采纳率 | agent 选择 recommended_task 的比例 | 验证推荐有效性 |
| park 率 | signal 被 park 的比例 | 回归指标 |
| observation quality_score 均值 | 所有 deposit 的 quality_score 平均 | 验证探索模式是否产出高质量 observation |
| 信号争抢率 | 同一 signal 被 claim → expire → re-claim 的次数 | H2 基线度量 |

### 6.3 数据采集方案

- **协议层**：`pheromone_history` 已有 append-only 记录，新增 `behavior_bias` 和 `module_stats` 字段
- **Commander 层**：heartbeat status snapshot 新增实验指标聚合
- **审计层**：audit package 导出时包含上述指标汇总

---

## 七、实验方案

### 实验 E1：β 行为参数化

| 项 | 内容 |
|----|------|
| 对照组 | 标准 caste waterfall，无 β 注入，.birth 无探索/执行指令调整 |
| 处理组 | caste waterfall + β 计算 + .birth 探索/执行指令调整 |
| 项目要求 | ≥ 15 个 signal，≥ 3 个不同模块 |
| 最小样本 | 2 次对照 + 2 次处理（不同项目或同项目不同目标） |
| 成功标准 | 处理组模块覆盖均匀度 > 对照组 10%，且信号完成速率不下降 |
| 失败退出 | 处理组信号完成速率下降 > 20% → 终止实验 |

### 实验 E2：Affinity 推荐

| 项 | 内容 |
|----|------|
| 对照组 | .birth 只显示 top_task（按 weight 排序） |
| 处理组 | .birth 同时显示 top_task + recommended_task（按 affinity） |
| 前置条件 | 蚁群至少运行过 2 轮（有历史 pheromone_history 可统计 module_stats） |
| 最小样本 | 3 次对照 + 3 次处理 |
| 成功标准 | 处理组首次完成率 > 对照组 15% |
| 失败退出 | 推荐采纳率 < 10%（agent 完全忽略推荐 → 机制无效） |

### 时序

```
E1 先行（不依赖历史数据）
  ↓ E1 运行积累 pheromone_history + module_stats
E2 后续（需要历史数据计算 affinity）
```

---

## 八、实施路径

### Phase 1：协议层准备

1. `termite-db-schema.sql`：新增 `module_affinity` (signals)、`module_stats` + `behavior_bias` (pheromone_history)
2. `termite-db.sh`：新增查询函数（β 三因子查询、affinity 计算）
3. `field-arrive.sh`：β 计算 + .birth 注入逻辑（可通过环境变量 `TERMITE_EXPERIMENT=E1` 开关）

### Phase 2：Commander 层适配

4. `signal-bridge.ts`：createSignal 时传入 module_affinity
5. `decomposer.ts`：分解 prompt 中要求 LLM 输出 module_affinity
6. heartbeat status snapshot 新增实验指标

### Phase 3：E1 实验执行

7. 选择 2 个项目，分别跑对照组和处理组
8. 收集数据，计算主指标和辅助指标

### Phase 4：E2 实验执行

9. `field-arrive.sh`：新增 affinity 计算 + 双 signal 推荐（`TERMITE_EXPERIMENT=E2`）
10. `field-deposit.sh`：deposit 时更新 module_stats
11. 选择 3 个项目，执行对照/处理实验

### Phase 5：分析与决策

12. 汇总实验数据，判断 H1/H2 是否成立
13. 成立 → 合入协议正式版本；不成立 → 记录负面结果，删除实验代码

---

## 九、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| β 导致 agent 过度探索，信号完成率下降 | 高 | 失败退出条件：速率下降 > 20% 终止 |
| affinity 推荐被 agent 完全忽略 | 中 | 推荐采纳率 < 10% 终止；推荐是建议非强制 |
| 新字段增加 .birth token 预算 | 低 | 4 行 YAML ≈ 30 tokens，800 token 预算内 |
| module_stats 在短蚁群中无意义 | 中 | E2 前置条件要求 ≥ 2 轮历史 |
| β 公式权重需要调优 | 中 | 初始值保守（0.4/0.3/0.3），实验中记录 β 分布用于调参 |

---

## 十、与论文概念的映射关系

| 论文概念 | 公式 | 白蚁协议映射 |
|----------|------|-------------|
| 性格特征 γᵢ | 式 6.4 | behavior_bias β |
| 效用函数 U(s, γ, a) | 式 6.6 | β = f(C, D, S) — 环境驱动，非 agent 自学习 |
| 势场 F = Σ F_attractive + F_repulsive | 式 6.1 | affinity(agent, signal) — 引力；weight — 全局吸引力 |
| 性格特征归一化 Σγᵢ = 1 | 式 6.7 | β ∈ [0, 1]，clamp 保证有界 |
| 主观环境表征差异 | 图 6-1 | 每个 agent 的 .birth 不同（top_task vs recommended_task 因 affinity 而异） |
| 回报函数 g 间接依赖其他 agent | 式 6.6 | β 的 C/D/S 因子反映了其他 agent 的累积行为效果 |

**关键差异**：论文的 γ 由 agent 通过强化学习自主演化；白蚁协议的 β 由环境（field-arrive.sh）根据全局状态计算。这是对无状态 agent 约束的务实适配——agent 没有跨会话记忆，无法自学习。
