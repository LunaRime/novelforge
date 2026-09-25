# 模型配置：拆出 contextWindow + 表单重排（2026-09-25）

> **状态：✅ 已实施（2026-09-25，步骤 1+2）**
> 来源：用户提供的参考设计截图（DeepSeek Harness 的模型/插件管理界面）+ 一条约束：
> **「风格按本程序，UI 排布可参考图片」**
> 相关：`provider-presets.ts`、`llm-store`、`agent-engine`（D7-1 压缩预算）、`ui/Disclosure`（新建）

---

## 一、来源与取舍原则

参考设计（三张 dsh 截图）提供的**排布**：

```
【Tab】第三方提供商 | 自定义 API        ← 本仓用「描边分段条」，不用参考图的浮起白药丸*
【提供商】下拉 + 说明
【API 密钥】
⌄ 自定义设置（默认收起）→ API 地址 + 说明
【模型目录】标题 + 右侧「获取可用模型」
   └ 每模型卡片：ID / 显示名 / 删除 · 上下文窗口 / 最大输出 token · 输入类型(文本·图片)
【+ 添加模型】
[取消] [保存]
```

\* ⚠️ 参考图顶部切换控件是「药丸容器 + 浮起白药丸」，正是本仓 2026-09-25 刚否掉的一派
（已统一为描边分段条，理由：4/5 处现状 + 无硬编码阴影）。**本设计不采纳该外观。**

**取舍原则（用户明确定调）**：外观一律走本仓设计系统（`var(--color-*)` 令牌 + `ui/` 组件）；
只借参考图的**信息分组与顺序**。

---

## 二、现状与问题

### 2.1 核心缺陷：`maxTokens` 一词两用

`ModelProfile` **没有**「上下文窗口」字段，而同一个 `maxTokens` 被当成两种语义使用：

| 用途 | 位置 | 期望语义 |
|---|---|---|
| 上下文占用条的分母 | `AgentConversation.tsx:260`（`?? 131072`） | **窗口** |
| 动态压缩预算（D7-1） | `agent-store.ts:888` → `computeMessageBudget` | **窗口** |
| 类型注释 | `agent-engine.ts:92`「模型上下文窗口（来自 ModelProfile.maxTokens）」 | **窗口** |
| 发给 API 的 `max_tokens` | `openai-provider.ts:28`、`gemini-provider.ts:66` | **输出** |
| 输出预算 | `directory.command.ts:55`（`× 0.6` 留 40% 给 prompt） | **输出** |

预设里 `maxTokens` 一律 `131072`（恰好等于 `MAX_TOKENS_CAP`），UI 标签只写「最大 Tokens」
（`form.maxTokens`）——**两个语义谁都没被区分**。

参考设计把「上下文窗口 / 最大输出 token 数」**拆成两个字段**，正指向此处。

### 2.2 表单排布

`ModelForm`（`SettingsModal.tsx:620+`）当前把 6 组字段平铺：显示名称 / 服务商+协议 /
模型标识 / API 地址 / API Key / 温度+MaxTokens。**没有「基础 / 高级」分层**——
API 地址这类多数用户不必看见的项与主要输入混在一起。

### 2.3 折叠范式已有但未复用

`VectorConfigSection.tsx:1071-1109` 有一处「默认收起的高级设置」，用原生 `<details>/<summary>`，
且已修过一次真机缺陷（2026-09-22：「看起来不能点击」→ 补箭头 + hover 底色 + 加大点击区）。
本仓 `ui/` 下**没有**对应组件，其他需要折叠的地方只能各自手搓。

---

## 三、目标与非目标

**目标**
1. 把「上下文窗口」与「最大输出」拆成两个字段，**零行为变化**
2. `ModelForm` 按参考图分组重排（基础 / 高级折叠 / 模型参数）
3. 抽出 `ui/Disclosure`，让折叠只有一个实现

**非目标**（明确不做，理由见 §七）
- provider → 1:N 模型（配一次 Key 挂多个模型）
- 「输入类型（文本/图片）」复选框
- 修正预设里的窗口**真值**

---

## 四、设计

### 4.1 数据模型

```ts
export interface ModelProfile {
  // …既有字段不动…
  /** 单次请求最大**输出** token 数（发给 API 的 max_tokens） */
  maxTokens: number
  /** 上下文窗口：输入+输出**总容量**（占用条分母、压缩预算用）— 2026-09-25 新增 */
  contextWindow: number
}
```

**语义边界（写进类型注释）**：`maxTokens` 只用于「输出」，`contextWindow` 只用于「容量」。
两者**不可互相推导**。

### 4.2 收口点：只在 `llm-store.loadModels()` 归一化

三个消费点**全部在渲染进程**，且都吃 `llm-store` 的 `models`（`agent-engine` 的
`modelContextWindow` 由 `agent-store` 从同一份数据传入）。

**已核实收口成立**：`models` 在全仓**只有一个写入点** —— `llm-store.ts:120`
（`loadModels()` 内）；增删改模型的三个入口（`:131` / `:171` 等）在写完后都
`await get().loadModels()` **重新加载** → 所有路径都流经归一化。故只需一处：

```ts
// llm-store.loadModels()：旧配置缺字段时兜底
const normalized = raw.map((m) => ({ ...m, contextWindow: m.contextWindow ?? m.maxTokens }))
```

⚠️ **兜底值取 `maxTokens` 而非某个常量**：今天两个消费点读的就是 `maxTokens`，
映射后**取到的值完全相同 → 零行为变化**。这是「忠实搬运」，**不代表它是真实窗口**。

⚠️ 主进程**不消费** `contextWindow`（`llm-controller` 只用 `maxTokens` 发请求）。
若将来主进程也要用，必须在 config 读取处做同样归一化 —— 否则会读到 `undefined`。

### 4.3 三个消费点改读 `contextWindow`

| 位置 | 现在 | 改为 |
|---|---|---|
| `AgentConversation.tsx:260` | `?.maxTokens ?? 131072` | `?.contextWindow`（归一化后必有值，去掉魔法兜底） |
| `agent-store.ts:888` | `{ modelContextWindow: ...?.maxTokens }` | `...?.contextWindow` |
| `agent-engine.ts:92` | 注释「来自 ModelProfile.maxTokens」 | 「来自 ModelProfile.contextWindow」 |

**`maxTokens` 的所有输出路径不动**（两个 provider、`resolveMaxTokens` 钳制、
`directory.command` 输出预算）→ 输出长度不受影响。

### 4.4 预设补值策略

`provider-presets.ts` 的每个模型加 `contextWindow`。**两条硬要求**：

1. **不瞎填**：新增字段的取值必须有出处（厂商文档或既有 `maxTokens` 的忠实搬运）
2. **迁移期与 `maxTokens` 同值**（搬运），真值**另开一批**按厂商文档核对后填
   —— 那批要单独验证，因为它会**真的改变占用条分母**

### 4.5 `ModelForm` 重排（外观全用本仓组件）

```
【服务商 + 协议】            ui/Select ×2（并排，维持现状）
【API 密钥】                 ui/Input + 眼睛切换（从「模型标识」之后提前到此处）
⌄ 自定义设置（默认收起）      ui/Disclosure（新）
    API 地址                 ui/Input
    模型标识                 有预设时 ui/Select，否则纯输入（维持现状）
【模型参数】
    上下文窗口 / 最大输出     ui/Input 并排两列 ← 参考图的并排布局
    温度                     仅生成模型（维持现状）
[取消] [保存]                （维持现状）
```

**保持不变**：字段在校验、钳制（`maxTokens ∈ [1, 131072]`）、保存流程上的既有行为。

### 4.6 `ui/Disclosure`（新建）

从 `VectorConfigSection.tsx:1071` 的既有范式抽取，**把那次的修复一起带走**：

```tsx
<Disclosure label={t('…advanced')}>
  {/* 内容 */}
</Disclosure>
```

- 原生 `<details>/<summary>`（键盘可达免费获得，无需 JS 状态）
- 箭头 `ChevronRight` + `group-open:rotate-90` + hover 底色 + 加大点击区 —— **不可省**（那次的缺陷就是缺这些）
- ⚠️ 抽取后 `VectorConfigSection` 的那处有一个**位置约束**：其卡片内上方已有若干
  「原始详情」`<details>`（U4/U5），既有用例按 DOM 顺序取首个 `details`，**迁移时不得改变 DOM 顺序**

---

## 五、迁移与兼容

| 场景 | 行为 |
|---|---|
| 旧配置（`config.json` 无 `contextWindow`） | `loadModels()` 兜底为 `maxTokens` → 与今天完全一致 |
| 新配置（UI 保存） | 显式写入 `contextWindow` |
| 直改 `config.json` 缺字段 | 同上兜底 ✓ |
| 主进程读取 | 不消费该字段，无影响 |

**无 schema 版本号变更**（模型配置不在 `vela.db`，在 `~/.novelforge/config.json`，
按字段存在性兜底即可）。

---

## 六、测试计划（TDD）

1. **先写**：`loadModels` 的归一化 —— 旧配置缺 `contextWindow` → 取到 `maxTokens`；
   已带该字段 → 保持原值（**不覆盖**）
2. **先写**：`ui/Disclosure` —— 原生 details 语义、`label` 渲染、默认收起、
   展开后内容可见；**并断言箭头类存在**（那次真机缺陷的回归守卫）
3. 改三个消费点后跑全量（1717 测试）
4. `ModelForm` 重排：字段分组/顺序（可测 DOM 顺序），阈值钳制行为不变

**验收口径**：步骤 1 完成后，**上下文占用条显示的数值与改动前逐一相同**
（用同一份配置对拍），以证明「零行为变化」。

---

## 七、非目标（明确不做）

| 项 | 理由 |
|---|---|
| **provider → 1:N**（参考图核心结构） | 动 `config.json` 数据结构 + `ModelRouter`/`llm-factory` 的引用方式 + 存量迁移 —— **单独出 spec** |
| **输入类型（文本/图片）复选框** | 本仓**无任何消费方**（无多模态路由）→ 加了就是死字段（参考图有是因为 dsh 支持图片输入） |
| **修正预设窗口真值** | 需要厂商文档出处，不能臆造；且会真改占用条分母 → 单独立项 |
| 顶部「第三方 / 自定义」Tab | 本仓用 provider 下拉已覆盖同一需求；再加一层 Tab 是重复分流 |
| 参考图的**观感**（配色/圆角/阴影/浮起药丸） | 用户定调：风格按本仓 |

---

## 八、风险与回退

| 风险 | 缓解 |
|---|---|
| 消费点漏改（仍读 `maxTokens`） | 全仓 grep `maxTokens` 逐一判定语义；**输出路径必须保持读 `maxTokens`** |
| `loadModels` 之外还有模型来源 | 已确认三个消费点均来自 `llm-store.models`；实施时再核一遍 |
| `ui/Disclosure` 抽取改变 DOM 顺序 | 迁移 `VectorConfigSection` 那处时逐一比对既有 `<details>` 顺序 |
| 表单重排改动保存行为 | 重排**只动 JSX 结构与顺序**，不碰 `up()`/校验/钳制逻辑 |

回退：本设计为「加字段 + 改读点 + 重排 JSX」，无删除性操作；`git revert` 即可。

---

## 九、待确认

1. **「上下文窗口」的呈现**：**建议自由输入框 + 单位提示**（对齐参考图），不加档位快捷。
   理由：窗口值跨度大（4K～1M+）且本仓预设种类多，档位会变成第二套需要维护的枚举；
   输入框 + `ui/Input` 的 number 模式已自带步进与钳制。
2. **API 密钥是否提前到「提供商」下方**：**建议提前**。理由：它是本表单**唯一必填**的
   凭据，而「显示名称 / 模型标识」可从预设自动带出（`ModelForm` 已有 `handleProviderChange`
   自动填 `modelName`）；把必填项放在可见区、可自动带出的项沉入折叠区，符合参考图的分层意图。
3. 步骤 3（provider → 1:N）**本轮不写 spec**：它与本设计耦合面大（config 结构 + ModelRouter
   引用方式 + 存量迁移），先让 1+2 落地并观察真实使用反馈，再决定是否值得动结构。

---

## 十、实施记录（2026-09-25）

### 交付

| # | 内容 |
|---|---|
| 1 | `ModelProfile.contextWindow` 新字段（语义边界写进类型注释） |
| 2 | `normalizeModelProfile()`（`llm-constants.ts`，纯函数 + 6 条测试） |
| 3 | 收口点 `llm-store.loadModels()`：`(await ipc.invoke('llm:list-models')).map(normalizeModelProfile)` |
| 4 | 三个消费点改读 `contextWindow`（`AgentConversation` / `agent-store` / `agent-engine` 注释） |
| 5 | `tokenSpec()`：预设的 `maxTokens` + `contextWindow` **成对**取用（4 处调用点统一） |
| 6 | `ui/Disclosure`（新，10 条测试）+ 迁移 `VectorConfigSection` 那处手写折叠 |
| 7 | `ModelForm` 重排：API 密钥提前 → `⌄ 自定义设置`（模型标识 + API 地址）→ 模型参数（窗口 / 输出 / 温度） |
| 8 | i18n：`form.maxTokens` 改文案 + 新增 `form.maxTokensHint` / `form.contextWindow` / `form.contextWindowHint` / `form.advanced`（三语） |

**门禁**：tsc 0 / eslint 0 / **1733 测试（141 文件）**（改动前 1717）。

### ⚠️ 两处偏离原设计（据实记录）

**① 预设**不逐条写 `contextWindow`**，改为可选 + 省略**

原设计 §4.4 要求「每个模型加 `contextWindow`（= maxTokens）」。实施时改为：
`ModelPreset.contextWindow` 设为**可选**、**不逐条填**，由 `tokenSpec` / `normalizeModelProfile`
兜底取 `maxTokens`（忠实搬运的性质不变）。

两条理由：
- 逐条照抄会多出 **30+ 个必然会漂移的重复数字**（唯一作用是等于 `maxTokens`）；
  改为「**差异即例外**」：只在该模型真实窗口 ≠ maxTokens 时才显式写
- ⚠️ `provider-presets.json` 是**持久化文件**，新增**必填**字段会让旧文件读进来缺字段挂掉

**② `AgentConversation` 的兜底：`?? 131072` → `?? 0`（一处有意的行为变化）**

窗口未知时（模型列表为空、或 `modelId` 指向已删除的模型），`ContextBudgetBar` 现在**整体不渲染**
（`modelMax <= 0` 时 `return null`）；此前会拿**编造的 131072** 当分母算出百分比。

→ 这是**修正**而非回归：编造分母属于本仓一直在清理的「静默错误」。但它**确实改变了边界行为**，
故记在此处。`AgentConversation.test.tsx` 的 F3 组原先依赖这个兜底才读得到占用条，
已补一个 mock 模型（该组断言的是记忆段 token 数，与分母无关，补 fixture 不削弱用例）。

### 验收：零行为变化（对**已配置的模型**成立）

`normalizeModelProfile` 的测试直接证明了这一点：旧配置缺 `contextWindow` → 取到 `maxTokens`，
而三个消费点在改动前读的正是 `maxTokens` → **取到的值逐一相同**。
`maxTokens` 本身全程未被改写 → 发给 API 的 `max_tokens` 与输出预算不受影响。

### 遗留

- **预设的窗口真值未填**：现全部等于 `maxTokens`（迁移期忠实搬运）。按厂商文档填真值会
  **真的改变占用条分母**，须单独立项 + 单独验证
- 真机验证未做（属人工项）
