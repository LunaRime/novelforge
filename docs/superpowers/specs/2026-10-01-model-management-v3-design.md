# 模型管理 v3 设计：dsh 对齐（形态重构 + 完整凭据层）

> 2026-10-01 · 状态：待审
> 依据：用户对 v2「学习 dsh 模型管理」的三点不满意——**形态做岔了 / 凭据与身份层没学到 / 机制漏学**；
> 用户拍板：**完整凭据层**（独立存储方案）+ **交互与信息架构照 dsh，视觉一律 NF 家族风格**（用户原话：「就是这样不过风格要保存NF的风格」）。
> 前序：v2 `2026-09-28-model-management-v2-design.md`（一体卡）。**本设计取代 v2 的信息架构**；
> v2 已对齐的能力（保存前探测 / 批量采纳 / 搜索全选 / 失败非死路）保留。
> dsh 事实来源：`D:\Code\deepseek-harness` @ 0.2.0-rc.2——`ui-settings-models`（ModelsSection / ProviderEditor /
> ModelListEditor / ModelRow / ModelInputTypes / CustomProviderCard / DeepSeekModelsEditor / store / operations /
> apiKey / protocol-label）、`ui-model-selection`（catalog / directory / service / provider-order）、
> 凭据 seam（`packages/credentials/credentials`）、settings seam（`packages/settings/settings`）、
> `llm-pi-ai/src/discovery.ts`、以及 `apps/web/tests/expected/models-settings/*` 快照断言。

## 0. 一句话

设置页模型管理改为 dsh 形态——**紧凑提供商行 + 一次只开一张的行内编辑卡 + 卡内一等区的模型目录
（默认/已自定义/恢复默认 三态）+ 保存前「获取可用模型」**；配套**完整凭据层**（独立存储、只写、引用名、
环境变量优先、迁移存量明文）；机制逐条对齐 dsh；**视觉与交互组件全部使用 NF 家族**。

## 1. 硬约束：视觉与交互风格 = NF 家族

「照 dsh」只指**信息架构与交互语义**。所有视觉一律 NF：

| 面 | 采用（NF 既有标准） |
|---|---|
| 颜色 | 只用 `--color-*` 语义令牌；凭据灯 = success / error / muted 三色，不引入新色 |
| 行与列表 | 行片几何：**高 32px 固定 px**、圆角 `--radius-lg`、左右 4px / 片间距 2px（ui-layout-standard §13）；行片纪律见 card-affordance-standard（视觉边界=点击边界=响应反馈） |
| 按钮 | `ui/Button`（outline/ghost/sm）+ 单图标按钮 **32×32** 规范 + aria-label；「编辑/删除」用 NF 按钮族而非 dsh 的 secondaryButton/dangerButton 样式 |
| 展开/折叠 | 统一走既有 `ui/Disclosure` 惯例（d837439「折叠控件统一走 ui/Disclosure」） |
| 输入 | `ui/Input`；K/M 容量为同一 Input 的文本形态；复选框沿用 NF 原生 `accent-[var(--color-accent)]` 惯例（ui/ 无 Checkbox，**勿新建**） |
| 弹层 | 候选 Modal 走 `ui/Dialog`（Radix，焦点陷阱/背景锁自带）——「新弹窗一律 ui/Dialog」（overlay-standard 弹窗行为章） |
| 悬停 | 相对叠加令牌 `--color-hover`（2026-09-28 终选方案）；不给嵌套按钮另造固定色 |
| 文案 | 全部 `t()` 三语；新 key 就近进 locale 分片 |
| 可达性 | 关闭口径 / 键盘可达两形态 / hover-only 补 `group-focus-within` / disabled 三件套（ui-interaction-standard） |

⚠️ 反例（勿搬）：dsh 的 CSS Modules、`ui-primitives` 组件、字重字号约定、`--dsw-*` 变量——那些是 dsh 的风格。

## 2. 目标形态（信息架构）

```
设置 → AI 模型
┌ 模型 ────────────────────────────────────────────────┐
│ OpenAI                                   ●    [编辑][删除] │  ← 紧凑行：名称 +（自定义标签）+ 凭据灯 + 操作
│ DeepSeek                                 ●    [编辑][删除] │
│ Acme Gateway（自定义）                     ○    [编辑][删除] │
│                                                          │
│ （点「编辑」→ 该行下方行内展开编辑卡，一次只开一张）           │
│  ┌────────────────────────────────────────────────┐       │
│  │ API 密钥 [____________]（只写，永不回显）            │       │
│  │  ▸ 自定义设置（折叠）                               │       │
│  │     显示名称（自定义） / API 地址 / API 协议（产品名）  │       │
│  │     模型目录     默认 / 已自定义   [恢复默认模型][获取可用模型]│
│  │       模型行：id + 显示名 + 用途标签   ⌄   🗑          │       │
│  │       （⌄ 行内展开：上下文窗口 / 最大输出 token / 输入类型）│       │
│  │       [+ 添加模型]                                │       │
│  │ [取消] [应用]                                      │       │
│  └────────────────────────────────────────────────┘       │
│                                                          │
│ [＋ 添加模型提供商] → 底部一张卡：                             │
│    （ 第三方模型提供商 | 自定义模型 API ）分段两模式 + 说明行     │
│    切模式不丢草稿（面板保持挂载）；写入/探测中锁定切换            │
└──────────────────────────────────────────────────────────┘
```

行为要点（照 dsh）：

1. **紧凑行**：名称 +（`自定义` 标签）+ 凭据灯 + [编辑][删除]；模型不常驻行上。
2. **单开编辑卡**：行内展开、一次只开一张；切换到别的行/关闭有未保存改动先确认（沿用 v2 的切换保护与
   「保存失败保留草稿」语义）。**卡片各自持有草稿**——添加卡的草稿不因关闭编辑行而丢。
3. **添加卡**：底部按钮展开一张卡：分段两模式（第三方目录 / 自定义 API）+ 说明行；**面板首访后保持挂载**
   （切模式不丢草稿）；写入或端点探测进行中锁定切换；只剩一种模式可用时以该模式为标题直接显示表单。
4. **首次运行**：无任何账户 → 保留现空态；点开添加卡时默认选中第一家**有内置目录**的预设、密钥框
   自动聚焦（dsh setup 卡的 NF 适配版，不做 dsh 的"整分节 setup 卡"渲染）。
5. **倒序显示**（用户已确认保留）：目录行仅显示层 reverse（新行/新采纳在上），存储顺序与操作定位均按
   `id`/行号语义不受影响。
6. **确认删除账户**：Modal 指名账户 + 提示「会移除其配置与存储的 API 密钥」（凭据一并删除；dsh 同款文案结构）。
7. **保存通知**：应用成功后 aria-live「已保存 {name}」（从刷新后的行取最新名称）。
8. **「其他」卡**：无归属手工条目保留（兼容层）：行 + 行编辑（沿用 ModelForm，凭据只写化）+ 删除。
9. **只读姿态**：`readOnly`（配置不可写）时所有写控件禁用 + 说明文案（现状保留）。

## 3. 数据模型

### 3.1 ProviderAccount（`~/.novelforge/providers.json`）

- **删** `apiKey`；**新增** `apiKeyRef: string`（创建时分配、**不可改**，见 §4.3）；
  **新增** `displayName?: string`（自定义账户可设；缺省=预设名/`provider`）。
- `modelNames` 语义扩展：**`undefined` 或空数组 = 继承内置目录；非空数组 = 自定义**（对应用户已配账户的
  现状语义；存量账户保持数组，**不自动切换**到继承——只有新建账户默认 undefined）。
- 文件形状升级 **v2**：`{ "version": 2, "revision": number, "accounts": [...] }`；
  读取兼容旧数组形（视 revision = 0，读时升级、写时写新形）。
- `provider` 字段：**编辑态锁定**（身份 = 凭据词干来源）；换家 = 删除重建。
- 多账户同 provider：**允许**（NF 既有能力，保留；dsh 是一路由一家，此处按 NF 现状适配——ref 去重即为此）。

### 3.2 ModelProfile（`models.json` 条目）

- **删** `apiKey`；**新增** `apiKeyRef?: string`（派生条目=账户 ref；手工条目=迁移/新建时分配）；
  **新增** `inputTypes?: ('text' | 'image')[]`（缺省=继承规格 → `['text']`）。
- **落盘类型不含 apiKey**——「配置文件永不携带明文」由类型层保证；主进程内部新增
  `ResolvedModelProfile = ModelProfile & { apiKey: string }`（resolve 后的运行时形态），provider 实现签名收前者。
- 派生 id 规则**不变**（`accountId::modelName`）→ 三层路由 / 默认模型 / 会话引用**零变化**。

### 3.3 内置目录（继承源）

- `BUILTIN_PRESETS[p].models + embeddingModels`（手写）+ `PI_AI_MODEL_SPECS[p]` 的键（生成表）；
  规格缺失走 `presetModelDefaults(provider, modelName)` 三级补全（已有：字面量 → 生成表 → 兜底）。
- 继承物化：首次任何增删行 → 把「当前有效目录」整组物化进 `modelNames`（此后该账户进入自定义态）。
- 「恢复默认模型」= `modelNames` 清为 undefined（回继承）。
- purposes/temperature/容量：一律走 `presetModelDefaults`；embedding 判定沿用其 `embeddingModels` 清单逻辑。

### 3.4 同步函数（`src/shared/provider-accounts.ts`）

- `syncAccountModels(account, existing, defaults)`：
  - `modelNames` undefined/空 → wanted = 内置目录全集（models + embeddingModels）；
  - 非空 → 现语义（**合并**：保留用户逐模型设置，只换凭据字段——改成传递 `apiKeyRef`）。
- 不变量不变：派生 id 确定性、不碰手工/他家条目、保持既有顺序、新条目追加。

## 4. 凭据层（完整建层）

### 4.1 模块与 IPC

- 新增 `electron/credentials/store.ts`（读写；**加解密复用既有 `electron/utils/secure-config.ts` 的
  `ENC:` 格式**）、`resolve.ts`（resolve / describe）、`refs.ts`（派生与去重）、
  `electron/controllers/credential-controller.ts`（走 `guardedHandle`）。
- IPC（`src/shared/ipc-channels.ts` 定义、`preload.ts` 白名单加 `credential:` 前缀）：
  - `credential:describe`：`(refs: string[]) => Record<string, CredentialInfo>`
  - `credential:set`：`(ref, value) => { success } | { success:false, error }`
  - `credential:unset`：`(ref) => { success } | { success:false, error }`
  - `CredentialInfo = { configured: boolean; source?: 'env' | 'store'; writable: boolean }`——**永不回传值**。

### 4.2 存储

- `~/.novelforge/credentials.json`：`{ "version": 1, "refs": { [ref]: "<ENC:…> 密文串" } }`
  （沿用 `ENC:` 前缀格式）。
- 加解密：**复用既有 `secure-config`**（safeStorage/DPAPI；不可用时 `ENC:B64:` 降级——已有行为，
  非明文）+ 启动告警。**现状 key 本就以 `ENC:` 密文存在两配置文件中**（`loadModelConfigs`/`saveModelConfigs`
  就地加解密），本层的增量是把它**搬出配置文件**并叠加只写/引用/环境变量语义；迁移原样搬运 `ENC:` 值。
- 原子写复用 `writeJsonFile`（tmp+rename，已有）；本进程为唯一写者：启动加载一次 + set/unset 后更新缓存；
  不追求外部手改文件的热感知（记录为已知限制）。

### 4.3 引用名（不可改）

- `deriveCredentialRef(provider, taken)`：`<PROVIDER>_API_KEY`（大写、非字母数字 → `_`；`custom` → `CUSTOM`），
  已占用则 `_2`、`_3`…；分配发生在**创建账户时**，写入 `apiKeyRef` 后不可改（provider 锁定同因）。
- 环境变量优先即 `process.env[ref]`——用户可直接用 `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` 等标准名。

### 4.4 语义（对齐 dsh）

- **resolve(ref)**：env 非空 → `{ value, source: 'env' }`；否则 store 非空 → `'store'`；否则 undefined。
  **每次使用前解析**（热轮换：改动在下一次请求生效）。
- **describe**：configured = 上述非空；writable = env 未影子（env 命中 → false）。
- **set**：拒绝 纯空白 / 非可打印 ASCII（`^[\x21-\x7E]+$`）/ `NAME=value` 形（`^[A-Z][A-Z0-9_]*=[^=]`）/
  引号包裹；env 影子时拒绝（提示由环境变量提供、不可覆盖）。
- **unset**：幂等；env 影子时同样拒绝。
- 空输入 = 不提供（保留已存值；新账户 = 无密钥/原生，如 Ollama）。

### 4.5 三态灯与 placeholder

- 灯（行上圆点 + `role="img"` + aria-label + tooltip）：绿=configured；红=ref 已分配且 env/store 皆无；
  无灯=describe 未完成 / 失败（凭据是增强信息，失败只降级灯不阻塞行）。
- 密钥框 **placeholder 三态**（只写、永不回显）：「由环境变量 X 提供（只读）」/「已配置（留空保持不变）」/
  「输入 API 密钥」；Ollama 等原生：「留空 = 不使用密钥」。

### 4.6 迁移（一次性、幂等、可回退）

- 触发：`app.whenReady` 后、controller 注册前 `runCredentialMigration()`；失败仅 log、不阻断启动，下次续跑。
- 步骤：① 两文件中已无非空 `apiKey` → 直接完成；② 首次执行先备份 `providers.json` / `models.json` →
  `*.pre-credentials.bak`；③ 账户逐个（已有 ref 优先、否则分配）→ 加密入库；④ 手工条目逐条分配 refs；
  ⑤ 清两文件明文、写入 `apiKeyRef`。
- 幂等判据 = 「是否还存在非空 apiKey」；中途崩溃 → 每文件原子写、下次从判据续跑。

### 4.7 接线（关键改动面）

- **主进程**：所有「把 profile 变成请求」的入口先 resolve——LLM 生成路径 / `llm:test-model` /
  `llm:list-provider-models` / embedding 调用；provider 实现签名收 `ResolvedModelProfile`（编译驱动全量修正，
  预计 ~91 处凭据引用逐一过）。
- **测试连接 / 拉取模型**：接受「本次草稿 key」（一次性，来自表单输入）**优先于** ref 解析（dsh 同款
  typed key wins）——保住 v2 已对齐的「保存前探测」。
- **渲染层剥离**：`llm:get-models*` 等回传的 profile **不含 apiKey**（类型天然保证），带 `apiKeyRef`；
  凭据状态一律走 `credential:describe` 批量（设置段打开时一次拉全）。
- **删除账户**：先 `credential:unset(ref)`（失败 → 中止、行保留、可重试）→ 再删 providers.json 条目 + 同步派生；
  两步分别幂等。
- **「应用」顺序照 dsh**：先落账户配置（含 revision 校验），成功后写凭据；凭据阶段失败 → 账户已存、
  提示仅重试凭据（下次应用只补凭据写）。

## 5. 机制落法（对照表）

| dsh 机制 | NF 落法 |
|---|---|
| 目录三态：空=继承内置；有值=整组替换；恢复默认=清覆盖 | 照搬（§3.3/§3.4）；meta 文案「默认模型目录 / 已自定义模型目录」；「恢复默认模型」仅自定义态出现 |
| 行内展开：上下文窗口 / 最大输出 / 输入类型（文本·图片） | 照搬 + NF 附加：用途小标签（生成/向量，只读展示，来自 purposes）；输入类型回退链：行 → 内置规格（生成表补 input 字段为可选后续）→ `['text']` |
| 容量 K/M 文本（`256K`=256000；`1M`=1000000），留空=继承 | 照搬；解析/格式化复用 dsh 同型纯函数（`/^(\d+(?:\.\d+)?)([km])?$/i`，四舍五入小数点）；placeholder = 继承值格式化；**按键缓冲按字段保留**（不在输入中途重写文本） |
| 行级校验：id 非空（trim）/ trim 去重 / name 非空 / 容量正整数，坏行按行号红字 | 照搬；坏行禁提交（提交门控） |
| 获取可用模型：已装目录 provider **免网络直答**；未装的打端点 | 照搬。内置目录命中的 provider 直接答（带容量）；否则端点探测（保留 NF 多拼写解析）；补 4MB 响应上限与 401/403「检查 API 密钥」文案（实现时核对现状差距） |
| 候选：新候选**默认勾选**、已存在**默认不勾**（可勾）；采纳时**已存在行保留用户值**；复制 id/显示名/容量/输入类型；等宽 id + title 显示名；全选作用可见项、取消全选清**全部** | 照搬改造（v2 现状为「已存在禁用 + 只回填容量」） |
| 全选/取消全选 | 照搬（全选只加可见；全屏皆选时「取消全选」清空全部勾选，防误采纳隐藏项） |
| 写入：逐字段最小操作 + revision 冲突拒绝 | **适配**：providers.json v2 带 revision——`mutateProviders(expectedRevision, fn)` 在**写队列**内校 revision → 不符返回 `provider/conflict` → UI toast「配置已被其他窗口修改，请重载」+ 保持编辑卡；编辑卡打开时记 revision。models.json 全部写路径走同一**串行写队列**（核销「整份读-改-写不可并发」挂起项） |
| 保存前用未保存 key 探测 | 已有（v2），保留（§4.7） |
| 首次运行 setup 卡 | 适配（§2.4） |
| 事件驱动收敛 | 适配：沿用 NF 现有 reload/REFRESH 机制；账户/凭据写后统一触发设置段 reload + describe 重拉 |
| Provider ID 不可改；协议按产品名显示、原生 id 存储 | 适配：编辑态锁定 provider；协议下拉 label 改产品名（OpenAI Chat Completions / Google Gemini / Anthropic Messages），存储值不变；**不新增**协议实现 |

## 6. 组件清单

- **新增**：`electron/credentials/{store,resolve,refs}.ts`、`electron/controllers/credential-controller.ts`、
  `electron/utils/config-write-queue.ts`（新文件）；
  `src/components/settings/ProviderRowList.tsx`（行列表容器）、`ProviderEditorCard.tsx`（编辑卡）、
  `ModelCatalogEditor.tsx`（目录区）、`ModelCatalogRow.tsx`（目录行 + 行内展开）、`ModelInputTypes.tsx`、
  `AddProviderCard.tsx`（添加卡两模式）、`CredentialDot.tsx`（如无现成）。
- **改造**：`ModelListSection.tsx`（容器改行列表）、`ProviderAccountsSection.tsx` / `ProviderAccountForm`（拆并）、
  `ModelPickerDialog.tsx`（候选规则升级）、`ModelForm.tsx`（仅「其他」卡保留；凭据只写化 + 测试按钮 gating
  改凭据状态）、`llm-store.ts`、`llm-controller.ts`、`llm-factory.ts`、`openai/gemini/anthropic-provider.ts`
  （签名收 ResolvedModelProfile）、`provider-accounts.ts`、`config-utils.ts`（队列）、`preload.ts`、
  `ipc-channels.ts`、locale 分片（三语新 key：灯/placeholder/目录 meta/候选/校验/revision 冲突/迁移告警）。
- **退役**：`ModelProviderCard.tsx`（一体卡；渲染逻辑迁入新组件）。
- SettingsModal 的 llm 段：模型管理区替换为行列表 + 添加卡；路由区（ModelRoutingSection）与并发设置**不动**。

## 7. 与 v2 的关系（superseded 清单）

- 一体卡退役；卡头/卡内行 → 紧凑行 + 行内编辑卡。
- 「+ 添加模型」→ 目录区内「添加模型」；候选 Modal 保留（规则升级）。
- 倒序保留（仅显示层）；温度字段已删（v2 完成，不动）。
- v2 保留项：保存前探测、批量采纳、搜索/全选、失败非死路（手输出路）。

## 8. 非目标

- 对话侧模型选择器（`/model` 弹窗、每模型推理档）——另一个面，另议。
- 新增协议实现（openai-responses 等）；云厂鉴权（Bedrock/Vertex/Azure）；OAuth 类。
- 嵌入/向量段其他改动；MCP；路由区与并发设置。

## 9. 测试与验收

- **单测**：凭据 store（加解密/降级/env 影子/校验规则/幂等）、refs 分配（去重、词干）、resolve/describe；
  迁移（fixture 旧文件 → 无明文 + ref 分配 + id 不变 + 幂等重跑）；syncAccountModels 三态（继承全集/自定义
  合并/恢复默认）；K/M 解析与格式化；行校验（trim 去重、容量非法、name 空）；revision 冲突拒绝。
- **组件测试**：行列表（紧凑行/灯三态/单开）、编辑卡（只写/草稿保留/切换保护/应用顺序）、目录区
  （三态 meta/行内展开/恢复默认）、候选 Modal（新默认勾/已存在不勾且保留用户值/全选与取消全选/搜索）、
  添加卡（两模式/草稿保持/锁定）、首次运行默认选中。
- **迁移实测**：真实 `~/.novelforge` 存量数据跑一遍，确认账户行为不变、key 加密入库、备份文件生成。
- **真机清单**（用户跑）：设置页全流程 / 环境变量优先与只读 / key 轮换 / 恢复默认目录 / 获取可用模型 /
  迁移后旧数据可用 / 删除账户顺序。
- **门禁**：tsc 0 / eslint 0 / vitest 全绿不回归（以实施时的当前基线为准）。

## 10. 风险

- 凭据引用 ~91 处 + 渲染层剥离改变 IPC 回传形状：机械量大，靠编译驱动逐点改；`ModelProfile` 类型删 `apiKey`
  是主抓手。
- safeStorage 不可用环境（Linux/无 keyring）走降级明文 + 告警——记为已知限制。
- providers.json 形状升级：读兼容 + 首次写升级；与迁移同批发布，测试覆盖旧形读取。
- 迁移事故预防：首次备份 `.pre-credentials.bak`；幂等判据「是否还有非空 apiKey」天然可续跑。
- 大量测试 mock 涉及 `apiKey`：随类型改造一并更新，禁局部绕过类型。

## 11. 任务拆分预告（writing-plans 输入）

T1 凭据层模块（store/resolve/refs）+ IPC + preload → T2 迁移（含备份/幂等/测试）→
T3 数据模型与同步改造（apiKeyRef / inputTypes / modelNames 三态 / providers.json v2 / syncAccountModels）→
T4 接线（主进程 resolve 全入口 + 渲染层剥离 + provider 签名）→ T5 行列表 + 编辑卡（只写密钥/灯/自定义设置）→
T6 目录区（三态 / 行内展开 / K-M / 输入类型 / 校验 / 恢复默认）→ T7 获取模型（内置直答 + 端点 + 候选规则 + Modal）→
T8 添加卡（两模式 / 草稿保持 / 首次运行 / 「其他」卡兼容）→ T9 revision + 写队列 → T10 i18n / 走查 / 真机。

> 依赖次序：T1→T2→T3→T4 为地基链；T5-T8 依赖 T3；T9 可与 T5-T8 并行；T10 收尾。
