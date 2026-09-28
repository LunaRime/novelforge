# 模型管理整合 v2 实施计划（计划 B）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（Native，用户已指定"执行"）。checkbox 跟踪。
> **代码密度说明（有意偏离 writing-plans 全代码惯例）**：executor 与作者同一会话、spec 精确到契约级；本计划给**契约 + 完整测试代码 + 关键实现片段**，样板 JSX 由 executor 按 spec §一/§三 与既有一体卡契约写出。

**Goal:** dsh 式一体卡：一个「模型」区 = 供应商卡列表（第三方/自定义 API/「其他」兜底），卡内模型行（生成/向量混排、倒序、行内编辑沿用）；拉取改多选 Modal 批量采纳；IPC 带规格；pi-ai 目录移植；设置段重组 + 删温度。

**Architecture:** `ModelProviderCard`（卡）+ `ModelPickerDialog`（拉取 Modal）+ `ProviderCardForm`（两模式建卡）三新组件；`ModelListSection` 改组为卡列表容器（`ModelForm` 行内编辑保留）；数据仍走 `ProviderAccount` + `syncAccountModels`（唯一数据层改动 = §五 IPC 两处）。

**Tech Stack:** React 19 + zustand + Radix Dialog + Vitest（createRoot/act + vi.hoisted store mock，模板照 `ModelListSection.test.tsx`）。

**Spec:** `docs/superpowers/specs/2026-09-28-model-management-v2-design.md`（§一~§九）

## Global Constraints

- 三门禁每任务提交前跑，**退出码直查**（`> /tmp/x.log 2>&1; echo $?`）
- 存储结构（models.json / 账户）不动；不自动迁移无归属模型
- 一切颜色走令牌；单图标按钮 32×32；操作按钮常驻
- 新增文案三语入 `locale-data`；协议/模型标识等枚举从既有单源引用
- Modal 用既有 `ui/Dialog`（Radix：焦点陷阱/Esc/遮罩自带）；Esc 冲突风险点按下文各任务注释处理

## Review Focus

1. **采纳竞态**：ModelPickerDialog 提交（saveProvider）期间卡上其他操作（再点添加/删除）→ 以 `saving` 门控 + 按钮禁用
2. **已添加禁用**：候选中已在卡内的模型必须 disabled 且默认勾选态不误导（勾选集合 = 待新增集合，不含已有）
3. **倒序稳定性**：行倒序为**显示层**（`[...list].reverse()`）；编辑/删除按 **id** 定位不得用显示索引
4. **「其他」卡边界**：仅当存在无归属模型时渲染；其行编辑保存走 `llm:save-model`（不经过账户派生）
5. **两模式表单**：目录模式切到自定义时 baseUrl 保留用户已改值（沿用 `handleProviderChange` 的既有保护规则）

---

### Task 1: IPC 扩展（候选带规格 + save-provider 可选 spec）

**Files:**
- Modify: `src/shared/ipc-channels.ts`（`llm:list-provider-models` 返回类型；`llm:save-provider` args 加 `modelSpecs?`）
- Modify: `electron/llm/provider.interface.ts`（listModels 返回 `{ id, contextWindow?, maxTokens? }[]`）
- Modify: `electron/llm/openai-provider.ts` / `gemini-provider.ts` / `anthropic-provider.ts`（listModels 解析容量字段：`context_length`/`max_input_tokens`/`max_tokens`/`context_window`/`limit.context` 等多拼写；无 id 行跳过；按 id 去重；保持端点顺序——照 dsh `readListing`）
- Modify: `electron/controllers/llm-controller.ts`（save-provider 把 `modelSpecs` 并入 `newModelDefaults`）
- Test: 既有 provider 测试文件各加解析用例（多拼写/去重/无 id 跳过）

**Interfaces:**
- Produces: `LLMModelCandidate = { id: string; contextWindow?: number; maxTokens?: number }`；`listModels(): Promise<LLMModelCandidate[]>`；`saveProvider(account, modelSpecs?: Record<string, {contextWindow?: number; maxTokens?: number}>)`
- 调用点连锁：`ProviderAccountsSection` 的 handleFetch `res.models`（名字数组 `.map(m => m.id)`）+ `ModelListSection` 的 doFetchModels —— 同步适配

- [ ] Step 1: 三 provider 的解析测试（RED：多拼写 JSON fixture → 断言解析出规格）
- [ ] Step 2: 实现解析（共享小工具 `pickCapacity(obj)` 放 `electron/llm/url-utils.ts` 或新 `model-listing.ts`）
- [ ] Step 3: 类型与 controller 改造（save-provider 合并 specs；`syncAccountModels` 的 `newModelDefaults` 签名不变，controller 侧组装"传入规格优先、回落 presetModelDefaults"）
- [ ] Step 4: 两处渲染层调用点适配（名字数组 → 候选对象）
- [ ] Step 5: 三门禁 + 提交 `feat(llm): 候选带规格（多拼写解析）+ save-provider 可选 modelSpecs`

### Task 2: pi-ai 目录移植

**Files:**
- Create: `scripts/migrate-pi-ai-catalog.cjs`（一次性；读 `D:/Code/deepseek-harness/node_modules/.pnpm/@earendil-works+pi-ai@0.85.*/…/providers/data/*.json` → 生成合并片段）
- Modify: `src/shared/provider-presets.ts`（现有 17 家补规格 + 新增 9 家：minimax / zai-coding-cn / kimi-coding / qwen-token-plan-cn / xiaomi-token-plan-cn / cerebras / together / fireworks / nvidia）
- Test: `src/shared/provider-presets.test.ts`（新）抽查：deepseek 条目带 contextWindow、新增家齐、protocol 值全部 ∈ LLMProtocol

**Interfaces:**
- 每个新家：`{ provider, displayName, baseUrl, protocol: 'openai', models: [{name, maxTokens, contextWindow?}], embeddingModels: [] }`
- 规格写入遵守既有约定：`contextWindow` 仅在与 maxTokens 不同时显式写
- ⚠️ 脚本运行需 D 盘 dsh 存在（写死不合适）→ 脚本接受 `--source <dir>` 参数，默认 `D:/Code/deepseek-harness`；README 注释注明一次性与 MIT 出处

- [ ] Step 1: 测试（RED：抽查断言）
- [ ] Step 2: 写脚本 + 跑生成 + 人工抽查 diff（模型数、规格合理性）
- [ ] Step 3: 三门禁 + 提交 `feat(presets): 移植 pi-ai 目录（规格补全 + 9 家新供应商，MIT）`

### Task 3: `ModelPickerDialog`（拉取多选 Modal）

**Files:**
- Create: `src/components/settings/ModelPickerDialog.tsx` + `.test.tsx`
- Modify: `src/shared/locale-data/ui.ts`（新 key：标题/采用所选（N）/已添加/手工输入 placeholder/空态）

**Interfaces:**
- Props: `{ open: boolean; credentials: { provider, protocol, apiKey, baseUrl }; existing: string[]; onClose(): void; onAdopt(names: string[], specs: Record<string, {contextWindow?, maxTokens?}>): void }`
- 打开即 `listProviderModels(credentials)`；loading/失败（沿用分类文案）/候选三态；候选 checkbox + 搜索 + 全选反选（对可见项）；`existing` 项 disabled + 「已添加」标；底部手工输入（回车入勾选集）；footer：取消 / **采用所选（N）**（N=勾选数，0 禁用）

- [ ] Step 1: 测试（RED）——收集器 helper（照 ModelListSection.test 的 store mock + Dialog 在 jsdom 的 render，Confirm 式 body 断言）：
  - 打开即拉取（invoke mock 断言参数 = credentials）
  - 勾选 2 个 → 采用 → `onAdopt(['a','b'], {…specs})` 恰好一次
  - existing 项 disabled
  - 搜索过滤 + 全选只作用可见项
  - 失败文案 + 手工输入仍可用
- [ ] Step 2: 实现（Dialog + 列表；`saving` 门控防重复采纳——Review Focus 1）
- [ ] Step 3: 三门禁 + 提交 `feat(settings): ModelPickerDialog——拉取候选多选 Modal 批量采纳`

### Task 4: `ModelProviderCard` + 一体卡列表

**Files:**
- Create: `src/components/settings/ModelProviderCard.tsx` + `.test.tsx`
- Modify: `src/components/settings/ModelListSection.tsx`（改组为卡列表容器：账户卡（`useLLMStore.providers`）+ 「其他」卡；`ModelForm` 行内编辑保留为卡内编辑态）

**Interfaces:**
- `ModelProviderCard` props: `{ account?: ProviderAccount; models: ModelProfile[]; …编辑/删除/添加回调 }`；「其他」卡传 `account=undefined` + 无归属 models
- 卡头：`displayName（preset 查）| provider` + baseUrl + 凭据状态（key 非空 ✓）+ [编辑]；体内：行倒序（`[...models].reverse()`）+ 每行（类型标签：purposes 含 embedding → 「向量」否则「生成」；默认标记）+ 「+ 添加模型」
- 行内编辑沿用 `ModelForm`（v1 成果）；「+ 添加模型」打开 Task 3 的 Dialog；采纳 → `saveProvider({...account, modelNames: [...existing, ...adopted]}, specs)`（Review Focus 1：saving 门控）

- [ ] Step 1: 测试（RED）——卡渲染/倒序/类型标签/已添加 disabled 传参/「其他」卡仅在有孤儿时出现/采纳调用参数
- [ ] Step 2: 实现（ModelListSection 改组：**保留**行内编辑/切换保护/空态逻辑，替换列表渲染为卡列表）
- [ ] Step 3: 三门禁 + 提交 `feat(settings): 模型一体卡（供应商卡列表 + 倒序 + 类型标签 + 其他兜底卡）`

### Task 5: `ProviderCardForm`（两模式建卡）

**Files:**
- Modify: `src/components/settings/ProviderAccountsSection.tsx`（表单改造：SegmentedControl「从供应商目录 / 自定义 API」；目录模式选家 + 勾选初始模型（预设 models+embeddingModels）；自定义模式手填地址；协议下拉单源沿用）——**或**抽成 `ProviderCardForm.tsx`（若 ProviderAccountsSection 结构不适配则拆出，执行时定）

**Interfaces:**
- 目录模式保存：`saveProvider({id: randomUUID(), provider, protocol, apiKey, baseUrl(预设), modelNames: 勾选}, undefined)`
- 切换模式/服务商的 baseUrl 保留规则沿用 `handleProviderChange`（Review Focus 5）

- [ ] Step 1: 测试（RED）——目录模式勾选初始模型 → saveProvider 参数断言；自定义模式 protocol 可选 anthropic（复用 Task 1 已单源的下拉）
- [ ] Step 2: 实现
- [ ] Step 3: 三门禁 + 提交 `feat(settings): 建卡表单两模式（供应商目录 / 自定义 API）`

### Task 6: 设置段重组 + 删温度 + 收尾

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx`（llm 段 = 一体卡区 + 路由区；embedding 段移除 ProviderAccountsSection/ModelListSection 挂载，保留 VectorConfigSection）
- Modify: `src/components/settings/ModelListSection.tsx`（`ModelForm` 移除 temperature 字段——存储默认 0.7 保留）
- Test: 既有 `ModelListSection.test.tsx` 的映射（fixture 有 temperature 字段——保留即可）+ 删温度渲染断言

- [ ] Step 1: 删温度（RED：断言表单不再渲染 temperature 输入）
- [ ] Step 2: 段重组（embedding 段挂载点清理；llm 段顺序 = 模型区在上——「置顶」需求）
- [ ] Step 3: i18n 全量自查（locale/i18n guards）+ 全量三门禁
- [ ] Step 4: 提交 `feat(settings): 设置段重组（模型区置顶）+ 移除温度字段`

---

## Self-Review 记录

- **Spec 覆盖**：§一→T4；§二→全任务（零存储改动）；§三→T3/T4/T5；§四→T3；§五→T1；§六→T2；§七（四点）→T4（倒序/一体）/T5（两模式）/T6（删温度/置顶）；§八 测试→各任务。
- **Placeholder 扫描**：无 TBD；实现给契约与关键片段（头部已声明该有意偏离及理由）。
- **类型一致性**：`LLMModelCandidate` T1 定义、T3/T4 消费；`onAdopt(names, specs)` 在 T3 定义与 T4 调用一致；`saveProvider` 第二参数可选。
- **Review Focus**：5 条 → T3（竞态/已添加）、T4（倒序 id 定位/其他卡）、T5（两模式 baseUrl）分别挂测试。
