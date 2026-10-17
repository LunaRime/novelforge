# 上下文档位改造（300K / 600K / 1M，2026-10-17）

> **用户裁决**：模型进入百万上下文时代，程序内的上下文预算上限不再固定 32K/64K/128K，
> 改为**按模型窗口自动分三档**：`<600K → 300K`、`600K–1M → 600K`、`≥1M → 1M`。
>
> **状态**：✅ 已实现；门禁全绿（tsc 0 / eslint 0 / 全量测试见 §五）。

---

## 一、改的到底是哪一层

改造前，一次 Agent 请求的**可发送历史**被三道闸门共同夹住：

1. `budgetPercent`（设置页「上下文预算百分比」，默认 80 / 强档 90）= 窗口 × 百分比；
2. `historyCeilingTokens`（W1 档位策略，强 128K / 标准 64K / 弱 32K）= **绝对上限**；
3. 引擎 `MAX_MESSAGE_BUDGET_TOKENS`（64K 兜底）。

所以即便模型窗口 1M，第 2 道闸门也只让用 128K——百万上下文是摆设。本次**只改第 2/3 道
闸门的取值来源**，百分比与档位（强/标准/弱）的其它语义不动。

## 二、新规则（B 方案：按窗口自动分档，用户不选）

```ts
// context-policy.ts
resolveContextBudgetCeiling(contextWindow):
  窗口 < 600_000        → 300_000
  600_000 ≤ 窗口 < 1e6  → 600_000
  窗口 ≥ 1_000_000      → 1_000_000
  无窗口 / 非法窗口     → 300_000（最小挡位，保守）
```

- 挡位与强/标准/弱档**正交**：档位只由客观窗口决定，档位决定历史百分比/摘要/工具预算；
- **有效历史预算 = min(挡位, 窗口 × historyPercent%)**，实现仍走
  `computeHistoryBudget(prefs, window, ceiling)`：
  - 1M 窗口 × 80% = 800K（默认标准档）；
  - 1M 窗口 × 90% = 900K（强档：窗口 ≥200K 或路由 elite）；
  - 600K 窗口 × 90% = 540K；
  - 500K 窗口 × 80% = 400K → 被 300K 挡位夹到 **300K**；
  - 32K 窗口 × 60% = 19.2K（挡位 300K 不会让小窗口超窗）。
- 无窗口信息时仍回退设置页的「历史预算」（默认 4000）——与旧行为一致。
- 引擎兜底上限 `MAX_MESSAGE_BUDGET_TOKENS` 64K → **300K**（最小挡位），并继续由
  `AgentEngineOptions.maxMessageBudgetTokens` 按实际挡位覆盖。
- `computeHistoryBudget` 的缺省 ceiling 也同步 64K → 300K（正常链路都显式传策略值，
  缺省只影响直调方）。

## 三、改动文件

| 文件 | 改动 |
|---|---|
| `src/services/agent/context-policy.ts` | 新增 `resolveContextBudgetCeiling` + 挡位常量；`historyCeilingTokens` 改为按窗口计算（与档位正交）；头注释表更新 |
| `src/services/agent/agent-engine.ts` | `MAX_MESSAGE_BUDGET_TOKENS` 64K→300K；`computeMessageBudget` 文档更新（默认上限=最小挡位） |
| `src/services/agent/compaction-prefs.ts` | `computeHistoryBudget` 缺省 ceiling 64K→300K + 文档 |
| `src/stores/agent-store.ts` | 注释更新（上限来源改为窗口挡位） |
| `src/shared/locale-data/ui.ts` | 「历史预算」「上下文预算百分比」说明补上挡位口径与公式（三语） |
| 对应 4 个测试文件 | 断言从 128K/64K/32K 改为 300K/600K/1M；新增挡位边界与 600K/1M 接线用例 |

## 四、刻意不做

| 项 | 理由 |
|---|---|
| 在设置页让用户手选 300K/600K/1M | 用户选的是 B 方案（按模型能力自动分档）；多一个全局挡位会与模型真实窗口冲突（选 1M 但模型只有 128K） |
| 改动强/标准/弱档的历史百分比（90/80/60） | 本次只放绝对上限；百分比是用户可写偏好，语义不动（既有「用户显式配置优先」不变量保持） |
| 抬高 `MAX_TOKENS_CAP`（131072 输出上限） | 输出上限是独立风险决策（低上限模型会 400），不在「上下文档位」范围 |
| 子 agent 预算接线 | 子 agent 当前不传 `modelContextWindow`，引擎走 16K 默认预算（既有行为）；如要继承父挡位需另批传参 |

## 五、验证

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx eslint . --ext ts,tsx --max-warnings 0` | ✅ 0 错误 0 警告 |
| 定向测试（context-policy / agent-engine / compaction-prefs / agent-store / i18n guard） | ✅ 5 文件 165 测试全过 |
| 全量测试 | ✅ 见最终提交记录（240 文件） |
| 挡位边界 | `<600K→300K（含 599_999）/ 600_000→600K / 999_999→600K / 1_000_000→1M` 全部用例锁定 |
| 接线 | store → engine 的 `maxMessageBudgetTokens` 对 200K/600K/1M 窗口分别得到 300K/600K/1M |

## 六、风险与后续

1. **成本/延迟**：1M 窗口强档 90% = 900K 历史上限，单次请求成本显著上升。用户明确要百万
   上下文，故按裁决放开；如费用敏感可把 `budgetPercent` 调低（用户偏好仍优先）。
2. **超窗余量**：1M 窗口 × 90% 只留 10% 给系统提示/当前输入/输出，极端长输出仍可能触发
   「context length exceeded」→ 引擎既有 recoverable 路径会压缩后重试（不丢会话）。
3. **挡位与窗口的边界以 `ModelProfile.contextWindow` 为准**：模型管理里若把窗口填错
   （如 1M 模型填 128K），挡位会落到 300K —— 先修正模型窗口。
4. `subagent` 仍走默认 16K 预算（未传窗口信息），与本次改造无关；若要子 agent 同样吃挡位，
   需在 `SubAgentDeps` 增加 engineOptions 并接线，另批立项。
