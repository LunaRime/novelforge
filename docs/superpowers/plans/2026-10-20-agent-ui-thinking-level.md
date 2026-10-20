# Agent UI 整合 + 全局四档思考等级 + 状态栏更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全应用统一四档思考等级，删除模型 temperature 字段，整合 Agent 输入框的提及/命令/模型入口，并把更新提示与前后台下载移到状态栏。

**Architecture:** 新增 `thinking-level` 共享规格 + `thinking-store`（持久化到 `GlobalConfig`）；`llm-store` 为所有调用注入默认温度；Agent 运行时把四档映射到现有六个 `AgentMode` 提示词分支。UI 复用同一个四档温度计组件；状态栏独占更新下载/重启动作。

**Tech Stack:** Electron 41、React 19、TypeScript 6、Zustand、Vitest、Tailwind CSS 4。

**Spec:** `docs/superpowers/specs/2026-10-20-agent-ui-thinking-level-design.md`

## Global Constraints

- 所有用户可见文本必须走 `t()`，zh-CN / en-US / ru-RU 三语齐全。
- 颜色只用 `var(--color-*)` / `rgba(var(--color-*-rgb), …)`，禁止硬编码色值与 Tailwind 调色板类。
- IPC 通道类型只在 `src/shared/ipc-channels.ts` 定义；`update:` 前缀已在 preload 白名单内。
- 不做数据库 schema 迁移；旧 `models.json` / 会话归档中的 `temperature`、`mode` 字段只需被忽略。
- 删除模型 `temperature` 时，**保留**调用点显式传入的温度（结构化任务低温覆盖）。
- 每个任务结束必须通过对应测试，并提交一次。
- 最终门禁：`pnpm run typecheck`、`pnpm run lint`、`pnpm run test` 全部零错误零警告。

## Review Focus

- Max 档下所有 JSON/审稿调用必须仍是低温（0.2–0.3），不能因为全局档位变成 1.2。
- 安装包下载超过 30 秒时，状态栏不能误报失败；重复点击不能启动第二个下载。
- 旧会话归档带 `mode`、旧模型条目带 `temperature` 时，加载/保存不得崩溃。
- Agent 面板窄宽度 + ru-RU 长文案时，工具栏和合并弹窗不得溢出/换行变形。
- 后台下载完成且弹窗已关闭时，只能出现一次重启提示，且状态栏可直接操作。

---

## Part 0 — 前置文案

### Task 0: 新增三语文案

**Files:**
- Modify: `src/shared/locale-data/agent.ts`
- Modify: `src/shared/locale-data/project.ts`
- Modify: `src/shared/locale-data/settings.ts`

**Interfaces:**
- Produces: Task 7–12 使用的全部新 i18n key（三语齐全）。

- [ ] **Step 1: Add all new keys**

`agent.ts`：

- `agent.thinkingLevelTitle` — 思考等级 / Thinking level / Уровень мышления
- `agent.thinkingOff` — 关闭 / Off / Выкл.
- `agent.thinkingOffDesc` — 直接执行，不做额外推演 / Execute directly, no extra reasoning / Выполнять сразу, без дополнительных рассуждений
- `agent.thinkingLow` — 低 / Low / Низкий
- `agent.thinkingLowDesc` — 先快速分析再执行 / Quick analysis before acting / Сначала быстрый анализ, затем действие
- `agent.thinkingHigh` — 高 / High / Высокий
- `agent.thinkingHighDesc` — 深度规划后执行 / Plan deeply before acting / Глубокое планирование, затем действие
- `agent.thinkingMax` — 最高 / Max / Макс.
- `agent.thinkingMaxDesc` — 多轮推演与自我验证，追求最佳结果 / Multi-pass reasoning and verification for the best result / Многораундовые рассуждения и проверка ради лучшего результата
- `agent.thinkingGlobalHint` — 所有对话与 AI 调用共用 / Shared by all conversations and AI calls / Общий для всех диалогов и вызовов ИИ
- `agent.modelSectionTitle` — 本对话模型 / Conversation model / Модель диалога
- `agent.commandsBuiltin` — 内置命令 / Built-in commands / Встроенные команды
- `agent.commandsSkills` — 技能 / Skills / Навыки

`project.ts`：

- `update.newVersionShort` — 新版本 {version} / New version {version} / Новая версия {version}
- `update.downloadForeground` — 下载 / Download / Скачать
- `update.downloadBackground` — 后台下载 / Download in background / Скачать в фоне
- `update.backgroundStarted` — 已开始后台下载 / Background download started / Загрузка в фоне начата
- `update.backgroundDone` — 更新已下载完成 / Update downloaded / Обновление загружено
- `update.restartPrompt` — 是否重启以完成更新？ / Restart to finish updating? / Перезапустить для завершения обновления?
- `update.restartLater` — 稍后 / Later / Позже
- `update.latest` — 已是最新版本 / You're up to date / У вас последняя версия
- `update.downloadFailed` — 下载失败：{error} / Download failed: {error} / Ошибка загрузки: {error}
- `update.checkingShort` — 检查中 / Checking / Проверка
- `update.availableShort` — 新版本 {version} / v{version} available / Доступна версия {version}
- `update.downloadingShort` — 下载中 {percent}% / Downloading {percent}% / Загрузка {percent}%
- `update.downloadedShort` — 可重启更新 / Restart to update / Перезапустите для обновления

`settings.ts`：

- `settings.updateInStatusBar` — 请在底部状态栏下载或安装更新 / Download or install from the status bar / Скачайте или установите обновление в строке состояния

- [ ] **Step 2: Run i18n guards**

Run:

```bash
pnpm exec vitest run src/shared/i18n-structure-guard.test.ts src/shared/i18n-key-guard.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/shared/locale-data
git commit -m "chore: 新增思考等级与状态栏更新三语文案"
```

---

## Part A — 全局思考等级与温度链路

### Task 1: 思考等级规格模块

**Files:**
- Create: `src/shared/thinking-level.ts`
- Test: `src/shared/thinking-level.test.ts`

**Interfaces:**
- Consumes: `TextKey` from `src/shared/locale.ts`（仅类型）。
- Produces: `ThinkingLevel`、`THINKING_LEVELS`、`DEFAULT_THINKING_LEVEL`、`isThinkingLevel()`、`thinkingLevelSpec()`。

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/thinking-level.test.ts
import { describe, it, expect } from 'vitest'
import {
  THINKING_LEVELS, DEFAULT_THINKING_LEVEL, isThinkingLevel, thinkingLevelSpec,
} from './thinking-level'

describe('thinking-level', () => {
  it('四档温度映射固定', () => {
    expect(THINKING_LEVELS.map(l => [l.id, l.temperature])).toEqual([
      ['off', 0.1], ['low', 0.3], ['high', 0.7], ['max', 1.2],
    ])
  })

  it('默认 High', () => {
    expect(DEFAULT_THINKING_LEVEL).toBe('high')
  })

  it('isThinkingLevel 拒绝旧六档值与非法值', () => {
    expect(isThinkingLevel('high')).toBe(true)
    expect(isThinkingLevel('deep')).toBe(false)
    expect(isThinkingLevel(3)).toBe(false)
  })

  it('映射到现有 AgentMode', () => {
    expect(thinkingLevelSpec('off').agentMode).toBe('quick')
    expect(thinkingLevelSpec('low').agentMode).toBe('balanced')
    expect(thinkingLevelSpec('high').agentMode).toBe('deep')
    expect(thinkingLevelSpec('max').agentMode).toBe('max')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/shared/thinking-level.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/shared/thinking-level.ts`**

Export exactly:

```ts
export type ThinkingLevel = 'off' | 'low' | 'high' | 'max'
export type ThinkingAgentMode = 'quick' | 'balanced' | 'deep' | 'max'

export interface ThinkingLevelSpec {
  id: ThinkingLevel
  temperature: number
  agentMode: ThinkingAgentMode
  labelKey: TextKey
  descKey: TextKey
}

export const THINKING_LEVELS: readonly ThinkingLevelSpec[]
export const DEFAULT_THINKING_LEVEL: ThinkingLevel
export function isThinkingLevel(v: unknown): v is ThinkingLevel
export function thinkingLevelSpec(level: ThinkingLevel): ThinkingLevelSpec
```

`thinkingLevelSpec` 对非法输入回退 `DEFAULT_THINKING_LEVEL` 的规格（防御旧值）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/shared/thinking-level.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/thinking-level.ts src/shared/thinking-level.test.ts
git commit -m "feat: 四档思考等级规格与温度映射"
```

---

### Task 2: 全局配置 + thinking-store

**Files:**
- Modify: `src/shared/ipc-channels.ts`（`GlobalConfig`）
- Modify: `electron/utils/config-utils.ts`（`DEFAULT_GLOBAL_CONFIG`）
- Create: `src/stores/thinking-store.ts`
- Modify: `src/App.tsx`（启动 init）
- Test: `src/stores/thinking-store.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ThinkingLevel` / `DEFAULT_THINKING_LEVEL` / `isThinkingLevel` / `thinkingLevelSpec`。
- Produces: `useThinkingStore`，状态 `{ level, initialized }`，动作 `init()` / `setLevel(level)`；`getThinkingTemperature(): number`。

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../services/ipc-client', () => ({ ipc: { invoke: invokeMock, isElectron: true } }))
vi.mock('../services/render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../components/ui/Toast', () => ({ toast: { error: vi.fn() } }))

import { useThinkingStore, getThinkingTemperature } from './thinking-store'

beforeEach(() => {
  invokeMock.mockReset()
  useThinkingStore.setState({ level: 'high', initialized: false })
})

afterEach(() => { vi.useRealTimers() })

describe('thinking-store', () => {
  it('init 读取 config.thinkingLevel', async () => {
    invokeMock.mockResolvedValue({ thinkingLevel: 'low' })
    await useThinkingStore.getState().init()
    expect(useThinkingStore.getState().level).toBe('low')
    expect(useThinkingStore.getState().initialized).toBe(true)
  })

  it('非法/旧值回退 High', async () => {
    invokeMock.mockResolvedValue({ thinkingLevel: 'deep' })
    await useThinkingStore.getState().init()
    expect(useThinkingStore.getState().level).toBe('high')
  })

  it('setLevel 乐观更新并 300ms 防抖写盘', async () => {
    vi.useFakeTimers()
    useThinkingStore.getState().setLevel('max')
    expect(useThinkingStore.getState().level).toBe('max')
    expect(invokeMock).not.toHaveBeenCalledWith('config:set', expect.anything())
    await vi.advanceTimersByTimeAsync(300)
    expect(invokeMock).toHaveBeenCalledWith('config:set', { thinkingLevel: 'max' })
  })

  it('getThinkingTemperature 反映当前档位', () => {
    useThinkingStore.setState({ level: 'max' })
    expect(getThinkingTemperature()).toBe(1.2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/stores/thinking-store.test.ts`
Expected: FAIL — `thinking-store` not found.

- [ ] **Step 3: Implement config field + store**

`GlobalConfig` 增加 `thinkingLevel?: ThinkingLevel`（`import type`）。
`DEFAULT_GLOBAL_CONFIG` 增加 `thinkingLevel: DEFAULT_THINKING_LEVEL`。
`App.tsx` 初始化 effect 中调用 `void useThinkingStore.getState().init()`（与 `initLLM()` 同批）。

Store 行为：

```ts
interface ThinkingState {
  level: ThinkingLevel
  initialized: boolean
  init: () => Promise<void>
  setLevel: (level: ThinkingLevel) => void
}

export function getThinkingTemperature(): number {
  return thinkingLevelSpec(useThinkingStore.getState().level).temperature
}
```

- `init()`：`ipc.invoke('config:get')` → `isThinkingLevel(config.thinkingLevel)` 校验；失败/非法回退 High；最终 `initialized: true`。
- `setLevel()`：`isThinkingLevel` 守卫；立即 `set({ level })`；300ms 防抖 `ipc.invoke('config:set', { thinkingLevel })`；失败时 `toast.error(t('save.failed').replace('{error}', …))` + `renderLog('error', 'Save:ThinkingLevel', …)`。
- 模块级 `let persistTimer`，组件/store 重载时清理旧 timer。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/stores/thinking-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-channels.ts electron/utils/config-utils.ts src/stores/thinking-store.ts src/stores/thinking-store.test.ts src/App.tsx
git commit -m "feat: 全局思考等级持久化 store"
```

---

### Task 3: llm-store 注入全局温度

**Files:**
- Modify: `src/stores/llm-store.ts`（`generate` / `generateStream`）
- Test: `src/stores/llm-store.temperature.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `getThinkingTemperature()`。
- Produces: 所有未显式传 `temperature` 的 `llm:generate` / `llm:generate-stream` 请求携带全局档位温度。

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../services/ipc-client', () => ({ ipc: { invoke: invokeMock, isElectron: true } }))
vi.mock('../services/render-logger', () => ({ renderLog: vi.fn() }))

import { useLLMStore } from './llm-store'
import { useThinkingStore } from './thinking-store'

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue({ success: true, content: '', fullText: '' })
  useLLMStore.setState({
    defaultModelId: 'm1',
    models: [{ id: 'm1', name: 'M1', modelName: 'm1', provider: 'openai', protocol: 'openai', baseUrl: '', maxTokens: 4096, contextWindow: 128000, purposes: ['generation'] }] as never,
  })
  useThinkingStore.setState({ level: 'max' })
})

describe('llm-store 全局温度注入', () => {
  it('未显式传温度时使用全局档位', async () => {
    await useLLMStore.getState().generate([{ role: 'user', content: 'hi' }])
    const call = invokeMock.mock.calls.find(c => c[0] === 'llm:generate')
    expect((call?.[1] as { temperature?: number }).temperature).toBe(1.2)
  })

  it('显式温度优先', async () => {
    await useLLMStore.getState().generate([{ role: 'user', content: 'hi' }], undefined, { temperature: 0.2 })
    const call = invokeMock.mock.calls.find(c => c[0] === 'llm:generate')
    expect((call?.[1] as { temperature?: number }).temperature).toBe(0.2)
  })

  it('流式请求同样注入', async () => {
    await useLLMStore.getState().generateStream([{ role: 'user', content: 'hi' }], {}, 'm1')
    const call = invokeMock.mock.calls.find(c => c[0] === 'llm:generate-stream')
    expect((call?.[2] as { temperature?: number }).temperature).toBe(1.2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/stores/llm-store.temperature.test.ts`
Expected: FAIL — `temperature` undefined.

- [ ] **Step 3: Implement injection**

在 `generate` / `generateStream` 的请求对象中：

```ts
temperature: options?.temperature ?? getThinkingTemperature(),
```

导入 `getThinkingTemperature` from `./thinking-store`。不要改变其他请求字段。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/stores/llm-store.temperature.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/llm-store.ts src/stores/llm-store.temperature.test.ts
git commit -m "feat: LLM 请求默认注入全局思考等级温度"
```

---

### Task 4: 工作流结构化温度覆盖

**Files:**
- Modify: `src/services/workflows/commands/base-command.ts`
- Test: `src/services/workflows/commands/base-command.temperature.test.ts`

**Interfaces:**
- Consumes: `CallPurpose` from `src/services/llm/model-router.ts`。
- Produces: `callLLM` 温度解析规则 `显式 > JSON 模式 0.3 > STRUCTURED_TEMPERATURE[purpose] > undefined`。

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CallPurpose } from '../../llm/model-router'

const captured = vi.hoisted(() => ({ options: undefined as { temperature?: number } | undefined }))
vi.mock('../../../stores/llm-store', () => ({
  useLLMStore: {
    getState: () => ({
      defaultModelId: 'm1',
      models: [{ id: 'm1', name: 'M1', modelName: 'm1' }],
      getModelForPurpose: () => 'm1',
      cancelGeneration: vi.fn(),
      generateStream: (_m: unknown, cb: { onDone: (t: string) => void }, _id: string, opts: { temperature?: number }) => {
        captured.options = opts
        queueMicrotask(() => cb.onDone('ok'))
        return Promise.resolve('req-1')
      },
    }),
  },
}))
vi.mock('../../render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../../../services/ipc-client', () => ({ ipc: { invoke: vi.fn(async () => ({ success: true })) } }))

import { BaseWorkflowCommand } from './base-command'

type CallOpts = { responseFormat?: { type: string }; purpose?: CallPurpose; temperature?: number }
class TempCommand extends BaseWorkflowCommand<string> {
  async execute() { return '' }
  call(prompt: string, options?: CallOpts): Promise<string> {
    return this.callLLM(prompt, 'system', { log: () => {}, setProgress: () => {}, appendText: () => {} }, options)
  }
}

beforeEach(() => { captured.options = undefined })

describe('base-command 温度解析', () => {
  it('无选项 → 交给 llm-store 注入全局档位', async () => {
    await new TempCommand().call('x')
    expect(captured.options?.temperature).toBeUndefined()
  })

  it('结构化 purpose → 低温', async () => {
    await new TempCommand().call('x', { purpose: 'review_chapter' })
    expect(captured.options?.temperature).toBe(0.2)
  })

  it('创作类 purpose → 不覆盖全局', async () => {
    await new TempCommand().call('x', { purpose: 'draft_chapter' })
    expect(captured.options?.temperature).toBeUndefined()
  })

  it('JSON 模式且无 purpose → 0.3', async () => {
    await new TempCommand().call('x', { responseFormat: { type: 'json_object' } })
    expect(captured.options?.temperature).toBe(0.3)
  })

  it('显式温度优先', async () => {
    await new TempCommand().call('x', { temperature: 0.6 })
    expect(captured.options?.temperature).toBe(0.6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/services/workflows/commands/base-command.temperature.test.ts`
Expected: FAIL — current map returns 0.9/undefined/undefined/undefined.

- [ ] **Step 3: Implement temperature resolution**

替换 `PURPOSE_TEMPERATURE`：

```ts
private static readonly STRUCTURED_JSON_TEMPERATURE = 0.3
private static readonly STRUCTURED_TEMPERATURE: Partial<Record<CallPurpose, number>> = {
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

解析顺序：

```ts
const temperature = options?.temperature
  ?? (options?.responseFormat?.type === 'json_object'
    ? BaseWorkflowCommand.STRUCTURED_JSON_TEMPERATURE
    : undefined)
  ?? BaseWorkflowCommand.STRUCTURED_TEMPERATURE[options?.purpose ?? 'default']
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/services/workflows/commands/base-command.temperature.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/workflows/commands/base-command.ts src/services/workflows/commands/base-command.temperature.test.ts
git commit -m "fix: JSON/结构化工作流调用保留低温覆盖"
```

---

### Task 5: 删除 ModelProfile.temperature

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/provider-presets.ts`
- Modify: `src/shared/provider-accounts.ts`
- Modify: `electron/controllers/llm-controller.ts`
- Modify: `electron/llm/openai-provider.ts`
- Modify: `electron/llm/gemini-provider.ts`
- Modify: `electron/llm/anthropic-provider.ts`
- Modify: 所有 ModelProfile fixture（见 Step 3）
- Test: 现有 provider/controller/store/settings 测试

**Interfaces:**
- Consumes: 无。
- Produces: `ModelProfile` 不再含 `temperature`；provider 只用显式 `opts.temperature`。

- [ ] **Step 1: Run typecheck to capture the blast radius**

Run: `pnpm run typecheck`
Expected: PASS（此时尚未删字段）。记录 `temperature` 的引用文件：

```bash
rg -l "temperature" src electron | sort
```

- [ ] **Step 2: Delete the field and fallbacks**

- `ModelProfile` 删除 `temperature: number`。
- `presetModelDefaults()` 返回类型与返回值删除 `temperature`。
- `provider-accounts.ts` 的字段联合与注释删除 `temperature`。
- `llm-controller.ts`：`request.temperature ?? model.temperature` → `request.temperature ?? DEFAULT_REQUEST_TEMPERATURE`，文件顶部加 `const DEFAULT_REQUEST_TEMPERATURE = 0.7`。
- 三个 provider：`opts.temperature ?? model.temperature` → `opts.temperature`（`LLMGenerateOptions.temperature` 仍是必填）。
- **不要删除**调用点的显式温度：`chapter-memory.ts`、`ccr-summary.ts`、`automation-store.ts`、`CodeMirrorEditor.tsx`、`DraftEditor.tsx`。

- [ ] **Step 3: Remove temperature from ModelProfile fixtures**

Run: `pnpm run typecheck`
Remove `temperature: …` only from objects typed/asserted as `ModelProfile`（模型 fixture）。Known files:

- `electron/controllers/llm-controller.keys.test.ts`
- `electron/controllers/llm-controller.providers.test.ts`
- `electron/credentials/migrate.test.ts`
- `electron/llm/anthropic-provider.test.ts`
- `src/shared/provider-accounts.test.ts`
- `src/components/settings/ModelForm.test.tsx`
- `src/components/settings/ModelCatalogEditor.test.tsx`
- `src/components/settings/ModelListSection.test.tsx`
- `src/components/settings/ProviderRowList.test.tsx`
- `src/stores/agent-store.test.ts`
- `src/stores/llm-store.credentials.test.ts`
- `src/services/agent/context-policy.test.ts`

Keep explicit call options in `ccr-summary.test.ts` (`temperature: 0.2`).

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm exec vitest run electron/llm electron/controllers/llm-controller electron/credentials/migrate.test.ts src/shared/provider-accounts.test.ts src/stores/llm-store.credentials.test.ts src/components/settings
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: 删除模型 temperature 字段，统一由全局思考等级决定"
```

---

### Task 6: Agent 运行时使用全局思考等级

**Files:**
- Modify: `src/stores/agent-store.ts`
- Modify: `src/components/panels/agent/AgentConversation.tsx`
- Test: `src/stores/agent-store.test.ts`（新增用例）

**Interfaces:**
- Consumes: Task 1 `thinkingLevelSpec()`；Task 2 `useThinkingStore`。
- Produces: Agent 动态路由与 system prompt 按全局档位；会话 `mode` 不再是运行时输入。

- [ ] **Step 1: Write the failing test**

在 `src/stores/agent-store.test.ts` 的 `describe` 中新增：

```ts
it('动态路由按全局思考等级选层', async () => {
  useLLMStore.setState({
    defaultModelId: 'test-model',
    modelRoutes: { elite: [], standard: [], budget: [], strategy: 'dynamic' },
  })
  const tierSpy = vi.spyOn(useLLMStore.getState(), 'getModelForTier').mockReturnValue('test-model')
  useThinkingStore.setState({ level: 'max' })

  await useAgentStore.getState().sendMessage('你好')

  expect(tierSpy).toHaveBeenCalledWith('elite')
  tierSpy.mockRestore()
})
```

`beforeEach` 中补 `useThinkingStore.setState({ level: 'high' })`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/stores/agent-store.test.ts -t "动态路由按全局思考等级选层"`
Expected: FAIL — `getModelForTier` 未按 `max` 调 `elite`（当前读 `currentConv.mode`）。

- [ ] **Step 3: Replace conversation mode reads**

`agent-store.ts`：

- 导入 `useThinkingStore`、`thinkingLevelSpec`。
- 路由处 `agentModeToTier(currentConv.mode)` → `agentModeToTier(thinkingLevelSpec(useThinkingStore.getState().level).agentMode)`。
- system prompt 处 `buildAgentSystemPromptAsync(currentConv.mode, …)` → 用同一映射。
- `AgentConversation.mode` 改为可选并标注“仅归档兼容，运行时不再读取”；`createConversation` 可继续写入或删除，但不得被读取。

`AgentConversation.tsx`：

- `useAsyncSegments(activeConv)` 内部订阅 `const level = useThinkingStore(s => s.level)`，`const mode = thinkingLevelSpec(level).agentMode`。
- `key` 用 `level`（不是 `mode`），确保切档后重新计算。
- `syncSegments` 的 `useMemo` 依赖改为 `level`。
- 移除对 `activeConv.mode` 的读取。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/stores/agent-store.test.ts -t "动态路由按全局思考等级选层"`
Expected: PASS.

- [ ] **Step 5: Run the full agent suites**

Run: `pnpm exec vitest run src/stores/agent-store.test.ts src/components/panels/agent/AgentConversation.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/stores/agent-store.ts src/components/panels/agent/AgentConversation.tsx src/stores/agent-store.test.ts
git commit -m "feat: Agent 运行时使用全局思考等级"
```

---

## Part B — Agent 输入框与状态栏

### Task 7: 共享四档温度计组件

**Files:**
- Create: `src/components/ui/ThinkingLevelSlider.tsx`
- Test: `src/components/ui/ThinkingLevelSlider.test.tsx`

**Interfaces:**
- Consumes: Task 1 `THINKING_LEVELS`、Task 2 `useThinkingStore`（仅由调用方传入 value/onChange，组件本身不碰 store）。
- Produces: `<ThinkingLevelSlider value onChange showDescription? />`。

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import ThinkingLevelSlider from './ThinkingLevelSlider'

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

describe('ThinkingLevelSlider', () => {
  it('渲染四个档位节点，拖动到 Max 回调 max', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const onChange = vi.fn()
    act(() => { createRoot(container).render(<ThinkingLevelSlider value="low" onChange={onChange} />) })
    expect(container.querySelectorAll('[data-thinking-node]').length).toBe(4)
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    act(() => {
      input.value = '4'
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('max')
  })

  it('showDescription 时显示当前档位描述', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<ThinkingLevelSlider value="high" onChange={() => {}} showDescription />) })
    expect(container.textContent).toContain('深度规划')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/ui/ThinkingLevelSlider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

复用现有六档温度计的视觉与 `.depth-slider` / `.depth-thumb` / `.depth-thumb--max` 样式：

- `TRACK_H = 18`、`INSET = 9`，位置 = `INSET + (100% - 2*INSET) * (index / 3)`。
- 四个节点加 `data-thinking-node={level.id}`。
- 透明 `<input type="range" min=1 max=4 step=1>`，`aria-label={t('agent.thinkingLevelTitle')}`。
- `onChange` 中调用 `onChange(THINKING_LEVELS[index].id)` 并同帧直写 thumb/fill。
- 档位图标：Off `Zap`、Low `Gauge`、High `BrainCircuit`、Max `Flame`；Max 用 warning 色。
- `showDescription` 时渲染当前 `descKey`（固定两行高度，避免弹层跳动）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/ui/ThinkingLevelSlider.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ThinkingLevelSlider.tsx src/components/ui/ThinkingLevelSlider.test.tsx
git commit -m "feat: 共享四档思考等级温度计组件"
```

---

### Task 8: Agent `+` 菜单收口与命令展开

**Files:**
- Modify: `src/components/panels/agent/AgentInputBox.tsx`
- Modify: `src/hooks/useFloatingPosition.ts`（内容尺寸变化重新定位）
- Test: `src/components/panels/agent/AgentInputBox.menu.test.tsx`

**Interfaces:**
- Consumes: `getAllSlashCommands()` / `SlashCommand` from `src/services/agent/intent-router.ts`；现有 `handleSlashSelect`。
- Produces: `+` 菜单三项；工作流命令展开列表；工具栏不再有常驻 `@` / `/`。

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('../../../services/agent/intent-router', () => ({
  getAllSlashCommands: () => [
    { name: 'clear', displayName: '清空对话', description: '清空当前对话', source: 'builtin_command' },
    { name: 'novel-writing', displayName: '小说创作', description: '写小说', source: 'skill' },
  ],
  searchSlashCommands: () => [],
}))

import AgentInputBox from './AgentInputBox'
import { useAgentStore } from '../../../stores/agent-store'
import { useLLMStore } from '../../../stores/llm-store'

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} }
})

beforeEach(() => {
  document.body.innerHTML = ''
  useAgentStore.setState({ conversations: [], activeConversationId: null, generating: false })
  useLLMStore.setState({ models: [], defaultModelId: null })
})

describe('AgentInputBox + 菜单', () => {
  it('展开工作流命令并选择内置命令', () => {
    const sendMessage = vi.fn()
    useAgentStore.setState({ sendMessage } as never)
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<AgentInputBox />) })

    const plus = container.querySelector('button[title]') as HTMLButtonElement
    act(() => { plus.click() })
    const workflowRow = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('工作流命令'))
    act(() => { workflowRow!.click() })

    expect(container.textContent).toContain('清空对话')
    const clearRow = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('/clear'))
    act(() => { clearRow!.click() })
    expect(sendMessage).toHaveBeenCalledWith('/clear')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/panels/agent/AgentInputBox.menu.test.tsx`
Expected: FAIL — 工作流命令仍只插入 `/`，无展开列表。

- [ ] **Step 3: Implement the menu**

- 删除工具栏两个常驻 `ToolbarIconBtn`（`AtSign` / `Slash`），保留 `+`。
- `+` 菜单宽度 240；三项：添加文件 / @ 提及 / 工作流命令。
- 工作流命令行带 `ChevronDown`（展开时旋转 180°）。
- 新增 `showCommands` state；展开后渲染：

```tsx
const commands = getAllSlashCommands()
const builtin = commands.filter(c => c.source === 'builtin_command')
const skills = commands.filter(c => c.source === 'skill')
```

- 分组标题用 `agent.commandsBuiltin` / `agent.commandsSkills`；列表 `maxHeight: 240, overflowY: auto`。
- 行显示 `/${name}` + description；点击调用现有 `handleSlashSelect(cmd)` 并关闭菜单。
- `useFloatingPosition` 增加 `ResizeObserver` 监听菜单元素，内容高度变化时重新 `position()`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/panels/agent/AgentInputBox.menu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/agent/AgentInputBox.tsx src/hooks/useFloatingPosition.ts src/components/panels/agent/AgentInputBox.menu.test.tsx
git commit -m "feat: Agent 加号菜单收口并支持工作流命令展开"
```

---

### Task 9: 模型与思考等级合并弹窗

**Files:**
- Modify: `src/components/panels/agent/AgentInputBox.tsx`
- Modify: `src/stores/agent-store.ts`（删除不再使用的 `defaultMode` / `setMode`）
- Test: `src/components/panels/agent/AgentInputBox.model-thinking.test.tsx`

**Interfaces:**
- Consumes: Task 7 `ThinkingLevelSlider`；Task 2 `useThinkingStore`。
- Produces: 单一触发器 + 弹窗；模型按对话、思考等级全局。

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import AgentInputBox from './AgentInputBox'
import { useAgentStore } from '../../../stores/agent-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useThinkingStore } from '../../../stores/thinking-store'

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} }
})

beforeEach(() => {
  document.body.innerHTML = ''
  useAgentStore.setState({
    conversations: [{ id: 'c1', title: 't', messages: [], createdAt: 0, updatedAt: 0, modelId: 'm1' }],
    activeConversationId: 'c1',
    generating: false,
  })
  useLLMStore.setState({
    defaultModelId: 'm1',
    models: [
      { id: 'm1', name: 'Model One', provider: 'openai', protocol: 'openai', modelName: 'm1', baseUrl: '', maxTokens: 4096, contextWindow: 128000, purposes: ['generation'] },
      { id: 'm2', name: 'Model Two', provider: 'openai', protocol: 'openai', modelName: 'm2', baseUrl: '', maxTokens: 4096, contextWindow: 128000, purposes: ['generation'] },
    ] as never,
  })
  useThinkingStore.setState({ level: 'high' })
})

describe('AgentInputBox 模型+思考等级弹窗', () => {
  it('一个入口同时显示模型与四档等级', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<AgentInputBox />) })

    expect(container.textContent).toContain('Model One')
    expect(container.textContent).toContain('高')
    const trigger = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Model One'))
    act(() => { trigger!.click() })
    expect(container.textContent).toContain('本对话模型')
    expect(container.textContent).toContain('全局思考等级')
    expect(container.querySelectorAll('[data-thinking-node]').length).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/panels/agent/AgentInputBox.model-thinking.test.tsx`
Expected: FAIL — 仍是两个独立按钮。

- [ ] **Step 3: Implement the merged popover**

- 删除 `DEPTH_LEVELS`、`depthIcon`、`showModeMenu`、`showModelMenu`、`modeRef`、`modelRef`、`setMode`、`defaultMode` 使用。
- 新增 `showModelThinkingMenu` + `modelThinkingRef`。
- 触发器：模型名（truncate）+ 档位徽章（图标 + `thinkingLevelSpec(level).labelKey`），不使用 `·` 分隔。
- `PopoverSurface` 宽 260：上半“本对话模型”列表（沿用 `MenuItem` + provider Badge）；分隔线；下半“全局思考等级” `<ThinkingLevelSlider value={level} onChange={setLevel} showDescription />` + `agent.thinkingGlobalHint`。
- 选择模型调用 `setModelId`；选择档位调用 `useThinkingStore.getState().setLevel`。
- `agent-store` 删除 `defaultMode` / `setMode` 接口与实现；`createConversation` 不再写 `mode`；`AgentConversation.mode` 保持可选仅作归档兼容。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/panels/agent/AgentInputBox.model-thinking.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run agent suites**

Run: `pnpm exec vitest run src/stores/agent-store.test.ts src/components/panels/agent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/agent/AgentInputBox.tsx src/stores/agent-store.ts src/components/panels/agent/AgentInputBox.model-thinking.test.tsx
git commit -m "feat: 模型选择与全局思考等级合并弹窗"
```

---

### Task 10: 状态栏思考等级控件

**Files:**
- Create: `src/components/layout/StatusBarSegment.tsx`（从 StatusBar 抽出）
- Create: `src/components/layout/StatusBarThinking.tsx`
- Modify: `src/components/layout/StatusBar.tsx`
- Test: `src/components/layout/StatusBarThinking.test.tsx`

**Interfaces:**
- Consumes: Task 7 `ThinkingLevelSlider`；Task 2 `useThinkingStore`。
- Produces: `StatusBarSegment` 共享组件；`StatusBarThinking` 控件。

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import StatusBarThinking from './StatusBarThinking'
import { useThinkingStore } from '../../stores/thinking-store'

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  document.body.innerHTML = ''
  useThinkingStore.setState({ level: 'high', initialized: true })
})

describe('StatusBarThinking', () => {
  it('显示当前档位，切换后写入全局 store', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<StatusBarThinking />) })
    expect(container.textContent).toContain('高')

    act(() => { (container.querySelector('button') as HTMLButtonElement).click() })
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    act(() => {
      input.value = '4'
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(useThinkingStore.getState().level).toBe('max')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/layout/StatusBarThinking.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- 把 `StatusBarSegment` / `StatusBarDivider` 从 `StatusBar.tsx` 抽到 `StatusBarSegment.tsx` 并导出；StatusBar 改为 import。
- 新建 `StatusBarThinking`：`StatusBarSegment`（档位图标 + `labelKey`）→ 点击弹出 `PopoverSurface`（宽 210）内含 `ThinkingLevelSlider` + 描述。
- Task 5 已按裁定删除 `TemperatureControl` 及其 `Thermometer` / `SegmentedControl` 引用；本任务只需确认无残留引用，不要重复删除。
- 在 StatusBar 中挂载 `<StatusBarThinking />`（原来 `TemperatureControl` 的位置）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/layout/StatusBarThinking.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/StatusBarSegment.tsx src/components/layout/StatusBarThinking.tsx src/components/layout/StatusBar.tsx src/components/layout/StatusBarThinking.test.tsx
git commit -m "feat: 状态栏改用全局四档思考等级控件"
```

---

## Part C — 状态栏更新与前后台下载

### Task 11: update:download 改为启动即返回

**Files:**
- Modify: `src/shared/ipc-channels.ts`（`update:download` 返回类型）
- Modify: `electron/controllers/update-controller.ts`
- Modify: `src/stores/update-store.ts`
- Test: `electron/controllers/update-controller.download.test.ts`
- Test: `src/stores/update-store.test.ts`

**Interfaces:**
- Consumes: 现有 `downloadInstaller` / `sendStatusToRenderer`。
- Produces: `beginDownloadOnce(start): boolean`（导出）；`downloadUpdate()` 返回值语义 = 是否成功启动。

- [ ] **Step 1: Write the failing test**

```ts
// electron/controllers/update-controller.download.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.7-beta.2', getName: () => 'NovelForge', getPath: () => '' },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  shell: { openExternal: () => {} },
}))
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), close: vi.fn() } }))
vi.mock('../security/ipc-guard', () => ({ guardedHandle: vi.fn() }))
vi.mock('../ollama-registry', () => ({ downloadBlob: vi.fn(), probePath: vi.fn() }))
vi.mock('../net-path', () => ({ buildPathCandidates: vi.fn(() => []), rankPaths: vi.fn(() => []) }))

import { beginDownloadOnce, resetDownloadStateForTest } from './update-controller'

describe('beginDownloadOnce', () => {
  it('并发调用只启动一次', () => {
    resetDownloadStateForTest()
    const start = vi.fn(() => new Promise<void>(() => {}))
    expect(beginDownloadOnce(start)).toBe(true)
    expect(beginDownloadOnce(start)).toBe(false)
    expect(start).toHaveBeenCalledTimes(1)
  })
})
```

```ts
// src/stores/update-store.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../services/ipc-client', () => ({ ipc: { invoke: invokeMock, on: () => () => {}, isElectron: true } }))

import { useUpdateStore } from './update-store'

beforeEach(() => {
  invokeMock.mockReset()
  useUpdateStore.setState({ status: 'available', updateInfo: { version: '9.9.9' } as never })
})

describe('downloadUpdate 启动语义', () => {
  it('invoke 返回成功时只结束 loading，不直接置 downloaded', async () => {
    invokeMock.mockResolvedValue({ success: true })
    const ok = await useUpdateStore.getState().downloadUpdate()
    expect(ok).toBe(true)
    expect(useUpdateStore.getState().status).toBe('available')
    expect(useUpdateStore.getState().loading).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run electron/controllers/update-controller.download.test.ts src/stores/update-store.test.ts
```

Expected: FAIL — `beginDownloadOnce` 不存在；store 仍直接置 `downloaded`。

- [ ] **Step 3: Implement**

`ipc-channels.ts`：

```ts
'update:download': {
  args: []
  return: { success: boolean; error?: string }
}
```

`update-controller.ts`：

```ts
let downloadInProgress = false

export function resetDownloadStateForTest(): void { downloadInProgress = false }

export function beginDownloadOnce(start: () => Promise<void>): boolean {
  if (downloadInProgress) return false
  downloadInProgress = true
  void start().finally(() => { downloadInProgress = false })
  return true
}
```

`guardedHandle('update:download', async () => { … })`：

- 无 `currentInfo` → 返回错误。
- `beginDownloadOnce(async () => { sendStatusToRenderer('downloading'); try { await downloadInstaller(...); sendStatusToRenderer('downloaded') } catch { sendStatusToRenderer('error', …) } })`。
- 启动成功立即返回 `{ success: true }`；已在下载返回 `{ success: false, error: 'already-downloading' }`。

`update-store.downloadUpdate()`：

```ts
const result = await ipc.invoke('update:download')
set({ loading: false })
if (!result.success && result.error !== 'already-downloading') {
  set({ error: result.error ?? null, status: 'error' })
}
return result.success
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run electron/controllers/update-controller.download.test.ts src/stores/update-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-channels.ts electron/controllers/update-controller.ts src/stores/update-store.ts electron/controllers/update-controller.download.test.ts src/stores/update-store.test.ts
git commit -m "fix: 更新下载改为启动即返回并加并发守卫"
```

---

### Task 12: 状态栏更新指示 + 后台下载

**Files:**
- Create: `src/components/layout/StatusBarUpdate.tsx`
- Modify: `src/components/layout/StatusBar.tsx`（挂载）
- Modify: `src/App.tsx`（移除横幅）
- Delete: `src/components/UpdateNotification.tsx`
- Test: `src/components/layout/StatusBarUpdate.test.tsx`

**Interfaces:**
- Consumes: Task 10 `StatusBarSegment`；`useUpdateStore`；`update-store.init()`。
- Produces: 状态栏更新段与弹窗；前台/后台下载；完成重启提示。

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import StatusBarUpdate from './StatusBarUpdate'
import { useUpdateStore } from '../../stores/update-store'

const toastShow = vi.hoisted(() => vi.fn())
vi.mock('../../components/ui/Toast', () => ({
  toast: {
    show: toastShow,
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    workflowComplete: vi.fn(),
  },
}))

const downloadUpdate = vi.fn(async () => true)
const installUpdate = vi.fn(async () => true)

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} }
})

beforeEach(() => {
  document.body.innerHTML = ''
  downloadUpdate.mockClear()
  installUpdate.mockClear()
  toastShow.mockClear()
  useUpdateStore.setState({
    status: 'available',
    updateInfo: { version: '9.9.9', releaseDate: '2026-10-20' } as never,
    downloadProgress: null,
    error: null,
    downloadUpdate,
    installUpdate,
    init: () => () => {},
  } as never)
})

describe('StatusBarUpdate', () => {
  it('发现更新时可选择前台/后台下载', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<StatusBarUpdate />) })
    expect(container.textContent).toContain('9.9.9')
    act(() => { (container.querySelector('button') as HTMLButtonElement).click() })
    expect(container.textContent).toContain('后台下载')
  })

  it('下载完成后提供重启动作', () => {
    useUpdateStore.setState({ status: 'downloaded' } as never)
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<StatusBarUpdate />) })
    act(() => { (container.querySelector('button') as HTMLButtonElement).click() })
    expect(container.textContent).toContain('立即重启')
  })

  it('后台下载完成后只弹一次重启提示', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<StatusBarUpdate />) })
    act(() => { (container.querySelector('button') as HTMLButtonElement).click() })

    const bg = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('后台下载'))
    await act(async () => { bg!.click(); await Promise.resolve() })

    act(() => { useUpdateStore.setState({ status: 'downloaded' } as never) })
    act(() => { useUpdateStore.setState({ status: 'downloaded' } as never) })

    expect(toastShow).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/layout/StatusBarUpdate.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- 删除 `App.tsx` 的 `UpdateNotification` import 与渲染；删除文件。
- `StatusBarUpdate`：
  - 挂载 `useEffect(() => useUpdateStore.getState().init(), [])`；监听 `ipc.on('menu:check-update')`。
  - `idle` 返回 null；`checking` / `no-update` / `available` / `downloading` / `downloaded` / `error` 渲染 `StatusBarSegment`。
  - `available` 弹窗：版本/日期/release notes（`maxHeight: 180, overflowY: auto`）+ “下载”（前台）+ “后台下载” + “查看详情”。
  - `handleDownload(background)`：记录 `downloadModeRef`；`background` 时关闭弹窗；调用 `downloadUpdate()`。
  - `downloading`：状态栏显示 `ProgressBar` + 百分比；弹窗显示进度与速度。
  - `downloaded`：状态栏 success 徽章；弹窗显示“是否重启更新？”+“立即重启”/“稍后”。
  - 后台完成：`useEffect` 监听 `status` 从 `downloading` → `downloaded`，若 `downloadModeRef === 'background'`，`toast.show({ type:'success', message: t('update.backgroundDone'), actions:[{label:'Restart', i18nKey:'action.restart', onClick: installUpdate}, {label:'Later', i18nKey:'update.restartLater', variant:'ghost'}] })`；用 ref 去重。
  - `error`：warning 徽章；弹窗显示错误 + “重试” + “查看详情”。
- StatusBar 中在合适位置挂载 `<StatusBarUpdate />`（建议在模型/思考等级附近）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/layout/StatusBarUpdate.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/StatusBarUpdate.tsx src/components/layout/StatusBar.tsx src/App.tsx
git rm src/components/UpdateNotification.tsx
git commit -m "feat: 更新提示移入状态栏并支持后台下载"
```

---

### Task 13: 设置页与通知中心收敛更新入口

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx`
- Modify: `src/components/layout/NotificationCenter.tsx`
- Modify: `src/stores/notice-store.ts`
- Test: `src/components/layout/NotificationCenter.test.tsx`
- Test: `src/components/settings/SettingsModal.test.tsx`（若不存在则新建，至少覆盖 About 区）

**Interfaces:**
- Consumes: Task 11 的下载语义；Task 12 的状态栏唯一操作面。
- Produces: 设置页只检查；通知中心无更新条目。

- [ ] **Step 1: Write the failing test**

在 `NotificationCenter.test.tsx` 增加：

```ts
it('应用更新不再进入通知中心', () => {
  setSource(() => {
    useUpdateStore.setState({ status: 'available', updateInfo: { version: '9.9.9' } as never })
  })
  const el = render()
  openPanel(el)
  expect(el.textContent).not.toContain('应用更新')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/layout/NotificationCenter.test.tsx -t "应用更新不再进入通知中心"`
Expected: FAIL — 通知中心仍派生更新条目。

- [ ] **Step 3: Implement cleanup**

- `notice-store.ts`：删除 `UpdateNotice` 类型、`useUpdateStore` 派生、`update:*` id 分支与相关注释。
- `NotificationCenter.tsx`：删除 `useUpdateStore` 订阅、`updates` 过滤、`notice.updateSection` 区块、`UpdateRow` 组件与相关 imports。
- `SettingsModal.tsx` AboutSection：
  - 保留 `checkForUpdates`、状态文案、版本号。
  - 删除 `downloadUpdate` / `installUpdate` / `downloading` state / 下载与重启按钮。
  - 可用更新时显示 `t('settings.updateInStatusBar')` 提示。
- 清理 `notice.updateSection` / `notice.updateAvailable` / `notice.updateDownloaded` / `notice.updateFailed` / `notice.downloading` / `notice.download` / `notice.restartInstall` 等不再使用的 key。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/components/layout/NotificationCenter.test.tsx src/components/settings
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SettingsModal.tsx src/components/layout/NotificationCenter.tsx src/stores/notice-store.ts src/components/layout/NotificationCenter.test.tsx
git commit -m "refactor: 状态栏独占更新操作，设置页与通知中心收敛"
```

---

## Part D — 文案与最终验证

### Task 14: i18n 与全量门禁

**Files:**
- Modify: `src/shared/locale-data/notice.ts`（删除更新条目 key）
- Modify: `src/shared/locale-data/ui.ts`（删除 `form.temperature`）
- Modify: `src/shared/locale-data/workflow.ts`（删除 `statusbar.temperature*`）
- Test: i18n 结构/key 守卫

**Interfaces:**
- Consumes: Task 0 新增的 key（本任务只做清理与验证）。
- Produces: 三语字典与实现一致。

- [ ] **Step 1: Verify Task 0 keys exist**

Run:

```bash
rg -n "agent\.thinking(LevelTitle|Off|Low|High|Max|GlobalHint)|agent\.modelSectionTitle|agent\.commands(Builtin|Skills)|update\.(newVersionShort|downloadForeground|downloadBackground|backgroundStarted|backgroundDone|restartPrompt|restartLater|latest|downloadFailed|checkingShort|availableShort|downloadingShort|downloadedShort)|settings\.updateInStatusBar" src/shared/locale-data
```

Expected: 每个 key 均在三语字典分片中出现。

- [ ] **Step 2: Remove stale keys**

确认无引用后删除：

- `agent.depthL1..L6` 与 `agent.depthL1Desc..L6Desc`
- `statusbar.temperature` / `statusbar.temperatureLow` / `statusbar.temperatureMid` / `statusbar.temperatureHigh`
- `form.temperature`
- `notice.updateSection` / `notice.updateAvailable` / `notice.updateDownloaded` / `notice.updateFailed` / `notice.downloading` / `notice.download` / `notice.restartInstall`

Run: `rg -n "depthL[1-6]|statusbar\.temperature|form\.temperature|notice\.update|notice\.downloading|notice\.download|notice\.restartInstall" src`
Expected: no matches.

- [ ] **Step 3: Run i18n guards**

Run:

```bash
pnpm exec vitest run src/shared/i18n-structure-guard.test.ts src/shared/i18n-key-guard.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full quality gates**

Run:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
```

Expected: 全部通过，零错误零警告。

- [ ] **Step 5: Manual smoke**

Run: `pnpm run dev`

Verify:

1. Agent 输入框只剩 `+`；展开工作流命令能看到内置命令与技能；选择可用。
2. 模型/思考等级为一个入口；切到 Max 后，状态栏同步显示“最高”。
3. 状态栏思考等级切换后，Agent 下一轮 system prompt/路由使用新档位。
4. 设置页“检查更新”仍可用；更新状态出现在状态栏；下载/后台下载/重启按钮行为符合设计。
5. 窄面板 + ru-RU 下工具栏不换行、弹窗不越界。

- [ ] **Step 6: Commit**

```bash
git add src/shared/locale-data
git commit -m "chore: 思考等级与状态栏更新三语文案"
```

---

## Self-Review Notes

- **Spec coverage:** 全局思考等级（Task 1–3、6）、结构化温度（Task 4）、删除模型 temperature（Task 5）、+ 菜单（Task 8）、合并弹窗（Task 9）、状态栏思考等级（Task 10）、更新契约（Task 11）、状态栏更新/后台下载（Task 12）、其他更新入口（Task 13）、i18n/门禁（Task 14）均有对应任务。
- **Review Focus tests:** Max + JSON（Task 4）、30 秒/并发下载（Task 11）、旧归档/旧模型（Task 5/6 的兼容说明 + typecheck）、窄面板/ru-RU（Task 9/14 手测）、后台完成提示（Task 12）。
- **Type consistency:** `ThinkingLevel` / `ThinkingLevelSpec` / `useThinkingStore` / `StatusBarSegment` / `beginDownloadOnce` 在首次定义后由后续任务按同一签名消费。