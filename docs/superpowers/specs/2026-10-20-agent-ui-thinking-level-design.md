# Agent UI 整合 + 全局四档思考等级 + 状态栏更新 — 设计

日期：2026-10-20
范围：Agent 输入框、状态栏、模型配置、LLM 温度链路、更新提示
状态：待用户确认

## 1. 背景

当前存在三套分散的“投入/发散”控制：

1. `AgentInputBox` 的六档思考等级（`DEPTH_LEVELS`，quick → max），写入 `agent-store` 的 `conv.mode` / `defaultMode`，只影响 Agent。
2. 状态栏的模型 `temperature` 快捷调节（0–2），写入默认模型的 `ModelProfile.temperature`，影响所有 LLM 调用。
3. `+` 菜单、工具栏常驻 `@` / `/` 按钮、`/` 输入触发菜单，三处能力入口重复。

同时更新提示以窗口顶部横幅（`UpdateNotification`）呈现，与 IDE 状态栏不统一；下载只有前台等待一种方式。

## 2. 目标

1. **统一思考等级**：全应用只有一个四档思考等级 `Off / Low / High / Max`，持久化，Agent 与状态栏读写同一个值。
2. **统一温度来源**：删除 `ModelProfile.temperature`；全局思考等级成为所有 LLM 调用的默认温度来源。结构化任务保留内部低温覆盖。
3. **Agent 输入框收口**：`@ 提及` 与 `工作流命令` 收进 `+` 菜单；工作流命令可在菜单内展开；移除工具栏常驻的 `@` / `/` 图标按钮。
4. **模型与思考等级合并弹窗**：一个入口、一个弹窗，上半选模型（本对话），下半调思考等级（全局）。
5. **更新提示移入状态栏**：移除顶部横幅；状态栏显示检查/可用/下载中/可重启/错误；下载支持“前台下载”和“后台下载”两种入口；下载完成后询问是否重启。

## 3. 非目标

- 不改变写作类工作流的业务 DAG、提示词和工具可用性。
- 不改变更新检查机制（GitHub Releases、启动后 10s、每 6 小时）。
- 不把模型选择变成全局设置；模型仍按对话选择。
- 不移除输入框的 `/`、`@` 键入快捷方式；只移除常驻图标按钮。
- 不新增第五档；不改变 Agent 六个内部 `AgentMode` 提示词分支。
- 不做 DB schema 迁移。

## 4. 已确认的产品决策

| 决策 | 内容 |
|---|---|
| 作用范围 | 全局思考等级影响 Agent 对话与所有非 Agent 的 AI 调用 |
| 档位 | 4 档：Off / Low / High / Max |
| 温度映射 | Off 0.1、Low 0.3、High 0.7、Max 1.2 |
| 默认档位 | High |
| 结构化例外 | 审稿、JSON 提取、一致性检查等保留内部显式低温覆盖 |
| 模型字段 | 从模型配置中删除 `temperature` 字段 |
| 工具可用性 | 四档都可用全部工具；档位只影响规划/推演/验证强度 |
| 更新确认 | 发现新版本后由用户选择是否下载；下载完成后再询问是否重启 |
| 后台更新 | “下载”= 前台进度可见；“后台下载”= 关闭弹窗、状态栏静默显示进度，完成后提示重启 |

## 5. 详细设计

### 5.1 全局思考等级

新增 `src/shared/thinking-level.ts`：

```ts
export type ThinkingLevel = 'off' | 'low' | 'high' | 'max'

export interface ThinkingLevelSpec {
  id: ThinkingLevel
  /** 温度（所有 LLM 调用的默认值） */
  temperature: number
  /** 映射到现有 AgentMode（保持六个内部提示词分支不变） */
  agentMode: 'quick' | 'balanced' | 'deep' | 'max'
  labelKey: TextKey
  descKey: TextKey
}

export const THINKING_LEVELS: readonly ThinkingLevelSpec[] = [
  { id: 'off',  temperature: 0.1, agentMode: 'quick',    labelKey: 'agent.thinkingOff',  descKey: 'agent.thinkingOffDesc' },
  { id: 'low',  temperature: 0.3, agentMode: 'balanced', labelKey: 'agent.thinkingLow',  descKey: 'agent.thinkingLowDesc' },
  { id: 'high', temperature: 0.7, agentMode: 'deep',     labelKey: 'agent.thinkingHigh', descKey: 'agent.thinkingHighDesc' },
  { id: 'max',  temperature: 1.2, agentMode: 'max',      labelKey: 'agent.thinkingMax',  descKey: 'agent.thinkingMaxDesc' },
]

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'high'
export function isThinkingLevel(v: unknown): v is ThinkingLevel
export function thinkingLevelSpec(level: ThinkingLevel): ThinkingLevelSpec
```

Agent 行为描述（不涉及工具可用性）：

- Off：直接执行，不做额外推演。
- Low：先快速分析再执行。
- High：深度规划后执行。
- Max：多轮推演与自我验证，追求最佳结果。

`AgentMode` 仍保留六值（quick/swift/balanced/reflective/deep/max），四档映射只使用其中四个分支；现有六个提示词分支与测试不需要重写。

新增 `src/stores/thinking-store.ts`：

```ts
interface ThinkingState {
  level: ThinkingLevel
  initialized: boolean
  init: () => Promise<void>
  setLevel: (level: ThinkingLevel) => void
}
```

- `init()`：`ipc.invoke('config:get')` → 用 `isThinkingLevel` 校验 `config.thinkingLevel`，否则回退 `DEFAULT_THINKING_LEVEL`。
- `setLevel()`：乐观更新 store，随后 `ipc.invoke('config:set', { thinkingLevel })`；失败时 `toast.error` + `renderLog('error', 'Save:ThinkingLevel', ...)`。滑块拖动时 300ms 防抖写盘（与旧温度控制一致），成功不弹 toast。
- App 启动时调用一次 `init()`（放在现有初始化 effect 中）。

`GlobalConfig`（`src/shared/ipc-channels.ts`）新增：

```ts
thinkingLevel?: ThinkingLevel
```

`DEFAULT_GLOBAL_CONFIG`（`electron/utils/config-utils.ts`）新增 `thinkingLevel: DEFAULT_THINKING_LEVEL`。

### 5.2 温度链路

`src/stores/llm-store.ts` 的 `generate` / `generateStream`：

```ts
temperature: options?.temperature ?? thinkingLevelSpec(useThinkingStore.getState().level).temperature
```

这覆盖所有经 `llm-store` 的调用（Agent、工作流命令、自动化、记忆等）。显式传入的 `temperature` 优先，因此以下内部低温覆盖保持不变：

- `chapter-memory.ts` 0.2
- `ccr-summary.ts` 0.2
- `automation-store.ts` 0
- `CodeMirrorEditor.tsx` JSON 提取 0.2
- `DraftEditor.tsx` 0.3

`src/services/workflows/commands/base-command.ts`：

- 删除 `PURPOSE_TEMPERATURE` 中创作类用途的条目（draft/first_draft/refine/blueprint/architecture/config）。
- 保留结构化用途的低温表，并改名为 `STRUCTURED_TEMPERATURE`：

```ts
const STRUCTURED_TEMPERATURE: Partial<Record<CallPurpose, number>> = {
  review_chapter: 0.2,
  consistency_check: 0.2,
  mutual_eval: 0.2,
  style_analysis: 0.3,
  character_extract: 0.3,
  extract_json: 0.3,
  summarize: 0.3,
  classify: 0.1,
}
```

- **JSON 模式兜底**：`callLLM` 的 temperature 解析顺序改为
  `显式 temperature > JSON 模式（0.3） > STRUCTURED_TEMPERATURE[purpose] > undefined（由 llm-store 注入全局档位）`。
  这样所有 `responseFormat: { type: 'json_object' }` 的调用（`spawn-reviewers`、
  `generate-multi-drafts` 的评分、`architecture-workflow` 的角色卡提取、
  `character-archive-workflow`、`architecture.command`、`import-novel` 等）
  即使没有传 `purpose`，也不会在 Max 档被拉到 1.2。
- 其余创作类用途不传 temperature，由 `llm-store` 注入全局档位温度。

`electron/controllers/llm-controller.ts`：

- `temperature: request.temperature ?? DEFAULT_REQUEST_TEMPERATURE`（常量 0.7，仅作安全兜底）。
- 移除 `model.temperature` 读取。

`electron/llm/openai-provider.ts` / `gemini-provider.ts` / `anthropic-provider.ts`：

- 使用 `opts.temperature`，移除 `model.temperature` 兜底。
- Anthropic 仍钳制到 `[0, 1]`；`Max` 档 1.2 在 Anthropic 上实际为 1.0（保持现有行为）。

### 5.3 删除模型 temperature 字段

- `ModelProfile` 删除 `temperature: number`（`src/shared/ipc-channels.ts`）。
- `presetModelDefaults()` 返回值删除 `temperature`（`src/shared/provider-presets.ts`）。
- `provider-accounts.ts` 的字段联合与注释删除 `temperature`。
- 所有测试 fixture 中的 `temperature: 0.7` 删除或改为不传。
- 已存在的 `~/.novelforge/models.json` 中的 `temperature` 字段不做迁移：读取时忽略，下次保存时自然丢弃。
- `form.temperature`、`statusbar.temperature*` 等 i18n key 变为未使用；实现时统一清理，或在 i18n key guard 允许的情况下保留（实现者决定，优先清理）。

### 5.4 Agent 输入框

#### `+` 菜单

- 移除工具栏常驻的 `@` 与 `/` 图标按钮（`AgentInputBox.tsx` 两个 `ToolbarIconBtn`）。
- `+` 菜单宽度 220–240px，条目：
  1. 添加文件（现有 FilePickerMenu）
  2. @ 提及（插入 `@` 并打开 MentionMenu）
  3. 工作流命令（可展开，带 Chevron）
- 工作流命令展开后：
  - 在同一个 `PopoverSurface` 内显示可滚动列表（`maxHeight ≈ 240px`），分组：内置命令 / 技能。
  - 数据来源：`getAllSlashCommands()`（`src/services/agent/intent-router.ts`）。
  - 内置命令点击后直接执行（沿用 `handleSlashSelect`）。
  - 技能点击后插入 `/技能名 `（沿用 `handleSlashSelect`）。
  - 分组标题使用新 i18n key；空列表显示空态文案。
- 键入 `/`、`@` 的快捷方式继续保留，对应菜单不变。
- `+` 菜单展开后高度变化时，浮层需重新定位；实现时监听内容尺寸（ResizeObserver）或改用 CSS anchor 定位，避免向上展开时超出窗口顶部。

#### 模型 + 思考等级合并弹窗

- 一个触发器替换原“思考等级”和“模型选择”两个按钮：
  - 显示当前模型名（`min-w-0 truncate`），右侧一个档位徽章（图标 + 档位名），不使用 `·` 分隔。
  - 无模型时显示 `statusbar.noModel`。
- 弹窗宽 260px，分两段：
  1. **本对话模型**：可滚动模型列表（`MenuItem`，选中态 + provider 徽章）。选择后调用 `setModelId`（保持按对话）。
  2. **全局思考等级**：复用 `ThinkingLevelSlider`；显示当前档位、描述，以及“所有对话与 AI 调用共用”的提示。
- 移除旧的 `showModeMenu` / `showModelMenu` 两个独立浮层。
- 模型为空时，思考等级段仍可用。

新增共享组件 `src/components/panels/agent/ThinkingLevelSlider.tsx`：

- 复刻现有六档温度计的视觉：18px 轨道、内嵌 4 节点、渐变填充、大圆球头、拖动同帧 DOM 直写。
- Props：`value: ThinkingLevel`、`onChange: (level: ThinkingLevel) => void`、`showDescription?: boolean`。
- 四档图标：Off = Zap、Low = Gauge、High = BrainCircuit、Max = Flame。
- 档位位置按 `index / 3` 计算；首末节点与轨道内切。
- 状态栏与 Agent 弹窗共用，避免两套实现漂移。

### 5.5 状态栏思考等级

- 删除 `StatusBar.tsx` 的 `TemperatureControl`。
- 新增 `ThinkingLevelControl`（或在 StatusBar 内实现）：
  - 分段：档位图标 + 档位名；与默认模型无关，始终显示。
  - 点击弹出 `PopoverSurface`，内含共享 `ThinkingLevelSlider` + 当前档位描述。
  - 读写 `useThinkingStore`。
- 移除不再使用的 `Thermometer`、`SegmentedControl`、`tempDraft` 等。

### 5.6 更新提示移入状态栏

- `App.tsx` 移除 `<UpdateNotification />`；删除 `src/components/UpdateNotification.tsx`。
- 新增 `src/components/layout/StatusBarUpdate.tsx`（或 StatusBar 内组件）：
  - 挂载时调用 `useUpdateStore.getState().init()`，并监听 `menu:check-update`。
  - 状态：
    - `idle`：不显示。
    - `checking`：Spinner + “检查中”。
    - `no-update`：静默显示“已是最新”（muted），或短暂显示后隐藏。
    - `available`：accent 徽章“新版本 vX”；点击打开弹窗。
    - `downloading`：小进度条 + 百分比；点击打开弹窗。
    - `downloaded`：success 徽章“可重启”；点击打开弹窗。
    - `error`：warning 徽章；点击打开弹窗显示错误。
  - 弹窗内容：
    - available：版本号、发布日期、release notes（可滚动）；按钮“下载”（前台）、“后台下载”、“查看详情”。
    - downloading：进度条、百分比、速度；后台模式下也可重新打开查看。
    - downloaded：“是否重启更新？”+“立即重启”+“稍后”。
    - error：错误信息 + “重试”+“查看详情”。
  - 前台 / 后台：
    - 点击“下载”：保持弹窗打开，进度在弹窗与状态栏同时显示。
    - 点击“后台下载”：关闭弹窗，调用 `downloadUpdate()`；状态栏继续显示进度。
    - 下载完成：
      - 前台：弹窗切换为重启确认。
      - 后台：`toast.show`（success，带“立即重启 / 稍后”动作），状态栏徽章变为“可重启”。
    - 用 `useRef` 记录下载模式与上一次状态，避免重复 toast。
  - “立即重启”调用 `installUpdate()`（运行已下载的 NSIS 安装包）。
- **下载 IPC 契约修正（必要）**：现有 `update:download` 在整包下载完成后才返回，
  而渲染层 `ipc-client` 有 30 秒超时——安装包下载通常远超 30 秒，会误报失败且可能重复下载。
  改为“启动即返回”：
  - 主进程 `update:download` 启动下载后立即返回 `{ success: true }`；完成/失败/进度一律走
    `update:status-changed` / `update:download-progress` 事件。
  - 主进程增加 `downloadInProgress` 守卫：重复调用返回 `{ success: false, error: 'already-downloading' }`，
    不启动第二个下载。
  - `update-store.downloadUpdate()` 不再在 invoke 返回时置 `downloaded`；只置 `loading: false`，
    状态完全由事件驱动。`downloadUpdate()` 的返回值语义变为“是否成功启动”。
  - 设置页与通知中心若保留下载入口，必须按新语义适配；本设计决定由状态栏独占下载/重启动作（见下）。
- **其他更新入口收敛**：
  - `SettingsModal` 的“关于”区保留版本信息与“检查更新”按钮，移除下载/重启按钮；
    可用更新时提示“请在底部状态栏下载/安装”。
  - `NotificationCenter` 移除应用更新条目（不再从 `update-store` 派生 update notice），
    避免第二套下载/重启入口；`notice-store` 中相关派生逻辑与测试一并清理。
  - 状态栏是唯一的下载/重启操作面。
- 手动“检查更新”仍从设置页触发；无更新时状态栏显示“已是最新”作为反馈。

### 5.7 i18n

新增/调整 key（三语齐全）：

- `agent.thinkingOff` / `agent.thinkingOffDesc`
- `agent.thinkingLow` / `agent.thinkingLowDesc`
- `agent.thinkingHigh` / `agent.thinkingHighDesc`
- `agent.thinkingMax` / `agent.thinkingMaxDesc`
- `agent.thinkingLevelTitle`
- `agent.thinkingGlobalHint`
- `agent.modelSectionTitle`
- `agent.commandsBuiltin` / `agent.commandsSkills`
- `statusbar.thinkingLevel`
- `update.newVersionShort`
- `update.downloadForeground` / `update.downloadBackground`
- `update.backgroundStarted` / `update.backgroundDone`
- `update.restartPrompt` / `update.restartNow` / `update.restartLater`
- `update.latest`
- `update.downloadFailed`（如无现成 key）

清理不再使用的 `agent.depthL1..L6` / `agent.depthL1Desc..L6Desc`、`statusbar.temperature*`、`form.temperature`（实现时确认无其他引用后删除）。

## 6. 数据与兼容

- `GlobalConfig.thinkingLevel` 是可选字段；旧配置缺省回退 High。
- `AgentConversation.mode`：
  - 运行时不再读取；旧的 `conv.mode` / `defaultMode` 值被忽略。
  - 为兼容已存档会话，类型可暂时保留 `mode?`，但不再写入/读取；实现时优先删除字段与 `setMode`，并更新测试。
  - 无需迁移已归档 JSON。
- `ModelProfile.temperature`：
  - 类型删除；旧 `models.json` 中残留字段被忽略，下次保存丢弃。
  - 无需 DB/文件迁移。
- 更新检查的下载目录 `~/.novelforge/updates` 不变。

## 7. 测试与验收

### 单元测试

- `thinking-level.test.ts`：四档温度映射、默认值、`isThinkingLevel` 防御。
- `thinking-store.test.ts`：init 读取 config、非法值回退、setLevel 写盘、失败日志。
- `llm-store`：未显式传 temperature 时注入全局档位温度；显式覆盖优先。
- `base-command`：创作类用途不传 temperature；结构化用途仍传低温；任意 `json_object` 调用在 Max 档仍为 0.3。
- `agent-store`：动态路由按全局档位选层；Agent 提示词使用全局档位映射的 AgentMode。
- `AgentInputBox`：`+` 菜单展开命令列表、命令选择、合并弹窗、四档滑块。
- `StatusBar`：思考等级控件读写全局 store；更新状态各分支渲染。
- 更新测试：前台 / 后台下载完成后的不同提示行为；`update:download` 启动即返回、并发守卫、事件驱动的状态流转。
- `notice-store`：更新条目移除后其余通知不受影响。

### 删除/更新

- 删除所有 model fixture 的 `temperature`。
- 删除 `UpdateNotification` 相关测试与引用。
- 更新旧六档相关测试为四档。
- 更新 i18n 结构/key 引用守卫。

### 质量门禁

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
```

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 删除 `ModelProfile.temperature` 波及大量测试/fixture | 一次性全仓清扫，按文件分组提交；typecheck 兜底 |
| 高档位影响审稿/JSON 提取稳定性 | `STRUCTURED_TEMPERATURE` + JSON 模式 0.3 兜底，覆盖所有 `json_object` 调用 |
| 全局档位改变所有调用的成本/质量 | 默认 High（与旧 defaultMode deep 对齐）；结构化任务不受影响 |
| 更新下载超过 30 秒 IPC 超时 | `update:download` 改为启动即返回，状态由事件驱动；主进程加并发下载守卫 |
| 移除通知中心更新条目后遗漏 notice-store 测试 | 同步清理派生逻辑、测试与 i18n |
| `+` 菜单展开后浮层越界 | 内容尺寸变化重新定位 / CSS anchor 定位；限制 maxHeight |
| 后台下载完成 toast 重复 | 用状态转移 ref 去重 |
| 状态栏空间拥挤 | 更新段仅在有状态时渲染；图标 + 短文本，宽度受限 |
| 旧会话 mode 残留 | 运行时忽略，无需迁移 |

## 9. 实现者决定（已定，供审查）

- 四档文案使用三语本地化：zh-CN 为 关闭/低/高/最高，en-US 为 Off/Low/High/Max，ru-RU 为 Выкл./Низкий/Высокий/Макс.。
- 默认档位 High（对齐旧 `defaultMode: 'deep'`）。
- 后台下载完成提示用 toast（带“立即重启/稍后”动作），不弹模态。
- 前台下载时弹窗保持打开；用户仍可手动关闭，关闭后按后台模式处理完成提示。
- 模型选择保持按对话；思考等级全局。
- 结构化温度覆盖采用“JSON 模式 0.3 兜底 + 结构化 purpose 表”，覆盖所有 JSON/审稿调用，而不是只覆盖枚举站点。
- `update:download` 改为启动即返回 + 主进程并发守卫；状态栏独占下载/重启动作，设置页只保留检查，通知中心移除更新条目。