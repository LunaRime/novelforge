# 模型供应商账户：一次配置 + 勾选模型 + 自动获取可用模型（2026-09-25）

> **状态：✅ 已实施（2026-09-25，后端层 + UI 层两个提交）**
> 来源：用户指出前一版模型表单**缺两件事** ——
> **A** 没有「自动获取供应商有哪些模型可添加」；
> **B（主要）** 应该「添加一个模型供应商 → 勾选旗下的模型 → 之后直接切换，不必再添加」。
> B 即上一版设计里被推迟的「步骤 3」（provider → 1:N）。本文件把它补上。
> 相关：`docs/superpowers/specs/2026-09-25-model-form-restructure-design.md`（已实施）、
> `provider.interface.ts`、`config-utils.ts`、`SettingsModal` 的 `LLMSection`

---

## 一、现状与痛点

**数据模型**：`~/.novelforge/models.json` 是**扁平数组**，每条 `ModelProfile` **自带凭据**：

```ts
{ id, name, provider: 'deepseek', protocol: 'openai',
  apiKey: 'sk-…', baseUrl: 'https://…',      // ← 凭据在**模型**上
  modelName: 'deepseek-v4-pro', temperature, maxTokens, contextWindow, purposes }
```

**痛点（用户原话）**：同一家加第二个模型，要把 **API Key、地址、协议再填一遍**。

**改动面实测**（决定了本设计选哪条路）：

| 事实 | 数字 |
|---|---|
| 读 `models.json` 的地方 | **10 处**（llm/embedding/kb-controller + config-utils） |
| `.apiKey` / `.baseUrl` / `.protocol` 引用 | **27 / 39 / 25 = 91 处** |
| ModelRouter / 默认模型 / 会话引用模型的方式 | **只按 `id`** ✅ |

→ 只要**模型 `id` 稳定**，路由、默认模型、会话历史**一行都不用改**。

---

## 二、设计取舍：把「账户」做成派生层，而不是改存储形状

### 备选

| 方案 | 做法 | 代价 |
|---|---|---|
| ❌ 改存储形状 | `models.json` → `{ providers[], models[] }`，凭据从 provider 解析 | 10 个读点 + 91 处引用全要改成解析；存量迁移 |
| ✅ **账户 + 派生**（本设计） | 新增 `providers.json` 存**账户**（凭据）；`models.json` **形状不变**，其中由账户派生的条目持有凭据**副本** | 仅新增一个文件 + 一组同步规则；读点与引用**零改动** |

**选后者**：用户的痛点是**录入流程**（同一个 Key 填 N 遍），不是存储形状。
派生方案用最小的改动面解决它。

### 数据

```ts
// 新增 ~/.novelforge/providers.json
interface ProviderAccount {
  id: string                       // uuid，账户标识
  provider: string                 // 'openai' | 'deepseek' | 'custom' | …
  protocol: 'openai' | 'gemini'
  apiKey: string
  baseUrl: string
  /** 已勾选的模型名（勾选清单的唯一真相） */
  modelNames: string[]
}
```

`models.json` **不变**。由账户派生的条目遵守两条约定：

1. **`id` 用确定性规则**：`` `${accountId}::${modelName}` ``
   —— 重新勾选/取消勾选后 `id` 可重现，故**路由、默认模型、会话历史里的引用不会失效**
   （手工添加的条目仍用 `randomUUID()`，与账户无关）
2. **`apiKey` / `baseUrl` / `protocol` 是账户的副本**，不单独编辑（UI 只读或隐藏）

### 同步规则（唯一需要小心的地方）

⚠️ **同步一律是「合并」而不是「覆盖」**：派生条目上有一批**逐模型设置**
（`name` / `temperature` / `maxTokens` / `contextWindow` / `purposes`），
它们是用户在「模型卡片」里改的，**账户同步必须原样保留**。

> 反例（本设计早期版本的漏洞）：曾打算把显示名也存进账户（`displayNames`）——
> 那样 `name` 就有了**两个真相源**，同步时必然有一方被冲掉。**显示名只住在 ModelProfile 上**
> （`ModelProfile.name`），勾选时初值取模型名，之后用户改的就是权威值。

| 操作 | 对 `models.json` 的影响 |
|---|---|
| 勾选模型 M | upsert 一条 `id = accountId::M`；**已存在则只补缺失字段**，不动用户改过的逐模型设置 |
| 取消勾选 M | 删除该条 —— ⚠️ **若它是默认模型或被路由引用，先阻止并提示**（见 §五） |
| 改账户的 Key/地址/协议 | **只更新凭据三个字段**，逐模型设置（name/温度/上限/窗口/用途）**全部保留** |
| 删账户 | 删除其全部派生条目（同样先检查引用） |
| 手工添加的模型 | **完全不受影响**（无账户，凭据自带） |

### 存量迁移：**不做**

现有 `models.json` 的条目保持原样、继续可用（它们是「手工模型」）。
理由：用户当前的痛点在**新增**流程；把旧条目改写成派生条目属纯风险、零收益。
→ 旧条目在 UI 里归入「未归入供应商」一组，可继续编辑凭据（维持现状）。

---

## 三、A：自动获取供应商可用模型

### 能力层

`ILLMProvider` 加一个方法（三种协议各自的列举端点）：

```ts
/** 列出该账户凭据下可用的模型名（失败时 throw，由调用方转成用户可读错误） */
listModels(model: ModelProfile): Promise<string[]>
```

| 协议 | 端点 | 取名字段 |
|---|---|---|
| OpenAI 兼容 | `GET {baseUrl}/v1/models` | `data[].id` |
| Gemini 原生 | `GET {baseUrl}/v1beta/models` | `models[].name`（去掉 `models/` 前缀） |
| Ollama | `GET {baseUrl}/api/tags` | `models[].name` |

⚠️ **Ollama 那条已经存在**（`electron/ollama-embedding.ts:97` 的 `listOllamaModels` 走 `/api/tags`）
—— 复用它，不要另写一份。

### 通道与实现

- 新 IPC：`llm:list-provider-models`（前缀 `llm:` 已在白名单；按 CLAUDE.md 的规矩登记进
  `IPC_CHANNEL_POLICY` + `ipc-channels.ts` 类型）
- 主进程内实现，**必须走已有的 `proxyFetch` + 超时**（`fetchWithTimeout`）——
  与其它出站调用同一套代理/超时纪律
- 返回 `{ success, models?: string[], error? }`（不 throw 到渲染层）
- ⚠️ 端点差异要**实测**：中转/自建服务对 `/v1/models` 的支持不一（有的返回 404 或空列表）
  → 失败时给出可操作提示（「该服务未提供模型列表，请手工填写模型 ID」），**不是死路**

### UI

供应商表单里 `[获取可用模型]` 按钮 → 拉取 → **勾选清单**（默认勾选已配的模型）。

---

## 四、B：供应商 → 勾选模型（主流程）

```
【供应商账户】
   OpenAI ▾   调用协议 ▾
   API Key  [··············]
   API 地址  ⌄自定义设置（默认收起，同前一版设计）

   [获取可用模型]  ← §三

   【模型】已勾选 3 个                      ← 唯一入口
     ☑ deepseek-v4-pro     显示名 [DeepSeek-V4-Pro]
     ☑ deepseek-v4-flash   显示名 [DeepSeek-V4-Flash]
     ☐ deepseek-r1         显示名 [deepseek-r1]
     …（拉取失败时：手工输入模型 ID + [添加]）

   [取消] [保存]
```

- **一次填凭据，勾选任意多个模型** ✓ 解决用户痛点
- 勾选清单是 `ProviderAccount.modelNames` 的唯一真相
- 每个模型的 `temperature / maxTokens / contextWindow` 仍逐模型可调
  （在已有的 `ModelCard` 列表里编辑，**沿用现状**）

**外观**：按用户定调 —— 走本仓令牌与 `ui/` 组件（`ui/Disclosure` 复用），
不照搬参考图的观感。

---

## 五、引用保护（勾选取消 / 删账户时）

取消勾选或删账户会**删掉模型条目**，而模型 id 可能被引用：

| 引用处 | 存在形式 |
|---|---|
| 默认生成/向量模型 | `global config` 的 `defaultModelId` / `defaultEmbeddingModelId` |
| 三层路由 | `modelRoutes`（elite/standard/budget 各自一串 modelId） |
| 会话 | 每个会话的 `modelId` |
| 向量配置 | `llmEmbeddingSettings.modelId` |

**规则**：删除前检查上述引用；命中则**阻止并提示具体位置**
（「该模型正被『三层路由 · 标准』使用」），让用户先改引用。
—— 与既有的「删除模型配置要二次确认」一致，但更强：这里是**引用约束**而非确认。

⚠️ 会话里指向已删模型的 `modelId` 属**历史数据**，不阻止删除，但该会话应能优雅回落到默认模型
（需确认现状是否已如此；若否，属本设计要补的一处）。

---

## 六、测试计划

1. **同步规则**（纯函数优先）：勾选 → upsert 且 id 稳定；取消 → 删除；改凭据 → 全量同步；
   删账户 → 全删。**重点：id 的确定性**（同 `accountId::modelName` 反复勾选/取消后仍一致）
2. **引用保护**：命中默认 / 路由 / 向量配置时阻止，且错误信息指出位置
3. **`listModels`**：三协议各自的端点与解包（mock fetch）；失败路径返回用户可读错误
4. **手工模型不受影响**：同步操作不触碰无账户的条目
5. 全量门禁 + 真机

---

## 七、非目标 / 未决

**非目标**
- 改写存量 `models.json`（见 §二「存量迁移：不做」）
- 供应商凭据的加密方式变更（沿用现状）
- 「输入类型（文本/图片）」等本仓无消费方的字段

**未决**
1. **供应商账户是否也要管「向量模型」**：embedding 与生成模型现在共用一套 CRUD
   （`SettingsModal:186` 注释）。账户模型天然也能挂 embedding 模型名 → **建议一并纳入**
   （同一账户下 `purposes` 区分），但会扩大勾选清单的语义，需你定
2. `/v1/models` 在中转服务上的实际可用率未知 → 实施时**先真机打一遍**
   （现有可用的中转/自建服务各测一次），失败则按 §三 的降级提示走
3. 勾选后新建模型的默认 `contextWindow / maxTokens` 取预设值还是账户级默认值？
   **建议**：先取预设（`tokenSpec`），预设没有则取 `MAX_TOKENS_CAP` / 4096

---

## 八、实施记录（2026-09-25）

两个提交：`87678b4`（后端层）、`df72010`（UI 层）。

### 交付

| 层 | 内容 |
|---|---|
| 纯逻辑 | `src/shared/provider-accounts.ts`：`deriveModelId` / `isModelOfAccount` / `syncAccountModels` / `findModelReferences`（**17 条测试**） |
| 能力 | `ILLMProvider.listModels(credentials)`；openai `/v1/models`、gemini `/v1beta/models`、ollama 复用既有 `listOllamaModels`；`buildOpenAIUrl` 加 `'models'` 端点（**6 条测试**） |
| 通道 | `llm:list-providers` / `save-provider` / `delete-provider` / `list-provider-models`（凭据沿用「盘上密文、渲染层明文」） |
| 存储 | `~/.novelforge/providers.json`（新增）；`models.json` **形状未动** |
| UI | `ProviderAccountsSection` / `ProviderAccountForm`；接入生成模型区与向量模型区 |
| 顺带 | `fetchWithTimeout` 从 `electron/embedding.ts` 挪到 `net/fetch-with-timeout.ts`（它早已是共用工具、只是住错了地方；不挪则 LLM provider 要从「嵌入服务」import 网络工具） |

**门禁**：tsc 0 / eslint 0 / **1756 测试（143 文件）**（改动前 1733）。

### 四处实现决定（与本文设计的差异）

1. **未加逐行「显示名」输入框**（§四 的界面稿里有）。加了就会有**两个真相源** ——
   显示名必须只住在 `ModelProfile` 上（用户在模型卡片里改的即权威值），账户同步按合并语义只换凭据。
   否则改一次 API Key 就会把用户改过的名字冲掉。
2. **候选清单默认列出预设模型**（而不只是「获取」回来的）：这让「获取可用模型」
   从**前置条件**降级为**增强** —— 服务不支持该端点时用户照样能勾选。
3. **引用检查放在二次确认之前**：模型被引用时根本不该走到「确认删除」那一步，
   直接告诉用户「哪些位置在用」。
4. **删账户后清理三层路由**：与 `deleteModel` 那次修复同因 —— 删掉模型条目后路由里仍留着
   它的 id，`ModelRoutingSection` 会显示空白。`saveProvider` 同理重载 models。

### ⚠️ 本仓守卫抓到的错（三道，都值得记）

| 守卫 | 抓到的错 |
|---|---|
| `i18n-key-guard.test.ts` | 我**凭空用了 `error.modelNotFound`**（字典里没有）→ 新增 `error.providerNotFound` / `baseUrlRequired` / `modelListUnavailable` 三语键 |
| `TextKey` 类型 | UI 层又凭空写 `model.saveFailed`（不存在）→ 改用既有的 `save.failed` |
| `ipc-policy.ts` + `ipc-channel-parity.test.ts` | 新通道**没登记授权档位**、**没更新通道数量快照**（205→209） |

→ 四个新通道全部登记为 `network-secret`（与既有 `llm:*` 一致）。

### 遗留（未做）

- **真机未验**：整个功能都没在真机跑过（账户增删改、勾选、获取模型、引用保护）
- ⚠️ **`/v1/models` 在各中转服务上的实际可用率未知** —— 设计 §三 要求实施时真机打一遍，
  尚未做。降级路径已就绪（提示可操作文案 + 预设清单兜底 + 手工输入）
- 未决 1（向量模型并入账户）：**已按建议纳入** —— 勾选清单同时列出预设的
  `models` 与 `embeddingModels`，新条目按来源决定 `purposes`
