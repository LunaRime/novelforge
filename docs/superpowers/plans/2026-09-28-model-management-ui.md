# 模型管理 UI 改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按对照 dsh 后的四项决策改进 NF 模型管理 UI——操作按钮规范化、行内编辑、拉取体验对齐、刻度核对。

**Architecture:** 先从 `SettingsModal.tsx` 拆出 `ModelListSection.tsx`（纯搬迁，获得可测边界），随后所有改动都落在新文件 + `ProviderAccountsSection.tsx`；状态模型由「整列表被表单替换」改为「列表常驻 + 单卡原地展开」。

**Tech Stack:** React 19 + TypeScript strict + zustand + Vitest（jsdom pragma）+ Tailwind 4 + CSS 变量令牌；测试用 `createRoot/act` + `vi.hoisted` store mock（模板见 `ModelRoutingSection.test.tsx`）。

**Spec:** `docs/superpowers/specs/2026-09-28-model-management-ui-design.md`

> **2026-10-02 标注：已执行；形态已被新文档取代** —— 本计划按 v1 落地（行内编辑 / 按钮规范 / 搜索全选 / 获取面板）；随后 v2（一体卡）→ v3（行列表 + 行内编辑卡 + 完整凭据层）两轮重构，**现行实现 = v3**（`2026-10-01-model-management-v3-execution.md`）。

## Global Constraints

- 三门禁全绿：`npx tsc --noEmit`、`npx eslint . --ext ts,tsx --max-warnings 0`、`npx vitest run`（提交前每任务都跑）
- 数据层 / IPC / `llm-store` / `ModelProfile` 结构**不动**；`listProviderModels({ provider, protocol, apiKey, baseUrl })` 已存在，直接用
- 一切颜色走 `var(--color-*)` 令牌；不用 Tailwind palette 类；`--color-hover` 等叠加令牌不写死值
- 单图标按钮热区 **32×32**（固定 px，`style={{ width: 32, height: 32 }}`）；操作按钮**常驻**（禁止 `opacity-0 group-hover:opacity-100` 显隐）
- 新增用户可见文案一律入 `src/shared/locale-data/`（本计划用 `ui.ts` 的 `provider.*` 与 `model.*` 前缀），三语 zh-CN / en-US / ru-RU
- 组件注释中文、不留死代码；`__APP_VERSION__` 等既有约定不涉及

## Review Focus

1. **保存失败时草稿的行为**：现状 `handleSave` 无条件 `setEditing(null)`——IPC 拒绝时草稿也收回（等同丢弃）。本次**保持现状**，但用测试钉住「reject → 收回 + toast.error」，避免以后有人误以为会保留。
2. **新增草稿与空态共存**：`isNew` 编辑态存在时，列表空态（虚线框）必须隐藏，否则出现"空态 + 编辑卡"同屏。
3. **切换保护只在有实际改动时拦**：进入编辑后未改任何字段就点另一张卡，不弹 `confirm`；改过才弹（快照 JSON 对比）。
4. **拉取面板关闭不丢字段**：Esc / 点击外部关闭面板后，表单里已填的 key/地址/模型名原样保留。
5. **候选搜索大小写**：输入大写（如 `BGE-`）也能过滤出小写模型名。

---

### Task 1: 拆出 `ModelListSection.tsx`（纯搬迁 + 测试基座）

**Files:**
- Create: `src/components/settings/ModelListSection.tsx`
- Create: `src/components/settings/ModelListSection.test.tsx`
- Modify: `src/components/settings/SettingsModal.tsx`（删三段迁移代码 + 改 import/调用点）

**Interfaces:**
- Consumes: `useLLMStore`（models / defaultModelId / defaultEmbeddingModelId / loaded / loadModels / saveModel / deleteModel / setDefaultModel / setDefaultEmbeddingModel）、`BUILTIN_PRESETS`、`tokenSpec`（本文件私有）
- Produces: `export function ModelListSection({ purposes, purposeLabel }: { purposes: ModelProfile['purposes']; purposeLabel: string })`——后续 Task 2–4、6 都在此文件内演进

- [ ] **Step 1: 建新文件，整体搬入四段代码**

从 `SettingsModal.tsx` **原样移动**（不做任何逻辑修改）：
- `tokenSpec`（约 237–243 行）
- `LLMSection`（约 245–414 行）→ 改名为 `ModelListSection` 并**加 export**
- `ModelCard`（约 627–703 行）
- `ModelForm`（约 709–1033 行）

新文件头部与 import：

```tsx
/**
 * ModelListSection — 模型列表 + 卡片 + 编辑表单（自 SettingsModal 拆出，2026-09-28）
 *
 * 拆出目的：① 给「行内编辑」重构一个可独立测试的边界；② SettingsModal 已 1460 行。
 * 行为与拆分前完全一致，后续改动（按钮规范化/行内编辑/拉取面板）均在本文件内进行。
 */
import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Plus, Save, Settings2, Trash2, Zap } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useLLMStore } from '../../stores/llm-store'
import type { ModelProfile } from '../../shared/ipc-channels'
import type { ModelPreset, ProviderPreset } from '../../shared/provider-presets'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { randomUUID } from '../../utils/id'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Badge } from '../ui/Badge'
import { Spinner } from '../ui/Spinner'
import { Disclosure } from '../ui/Disclosure'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { useTranslation } from '../../hooks/useTranslation'
import { MAX_TOKENS_CAP } from '../../shared/llm-constants'
import { renderLog } from '../../services/render-logger'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
```

- [ ] **Step 2: SettingsModal 侧改引用**

```tsx
import { ModelListSection } from './ModelListSection'
```

把原 `<LLMSection purposes={...} purposeLabel={...} />` 调用点改为 `<ModelListSection purposes={...} purposeLabel={...} />`。删除已迁走的四段定义。

- [ ] **Step 3: 跑 typecheck 清理 SettingsModal 的未用 import**

Run: `npx tsc --noEmit`
Expected: 因 `noUnusedLocals` 报出仅被迁走代码使用的 import（如 `randomUUID`、`BUILTIN_PRESETS`、`ModelPreset`、`maxTokens` 相关常量等），逐个删除；**保留**仍被文件其它区使用的（`Input`/`Disclosure`/`Button` 等会被 tsc 正确放过）。
再 Run: `npx eslint src/components/settings/SettingsModal.tsx --max-warnings 0`，Expected: exit 0。

- [ ] **Step 4: 写测试基座（failing test 不需要——基座测试直接针对既有行为，先跑应绿）**

`src/components/settings/ModelListSection.test.tsx`：

```tsx
// @vitest-environment jsdom
/**
 * ModelListSection — 模型列表 + 编辑（拆分基座 + 后续任务契约）
 * store mock 模板参照 ModelRoutingSection.test.tsx（selector 直调）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelListSection } from './ModelListSection'
import type { ModelProfile } from '../../shared/ipc-channels'

const state = vi.hoisted(() => ({
  models: [] as ModelProfile[],
  defaultModelId: null as string | null,
  defaultEmbeddingModelId: null as string | null,
  loaded: true,
  loadModels: vi.fn(),
  saveModel: vi.fn(async () => {}),
  deleteModel: vi.fn(async () => {}),
  setDefaultModel: vi.fn(async () => {}),
  setDefaultEmbeddingModel: vi.fn(async () => {}),
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: (selector: (s: typeof state) => unknown) => selector(state),
}))

const makeModel = (id: string, name: string): ModelProfile => ({
  id, name, provider: 'openai', protocol: 'openai',
  modelName: `${id}-model`, apiKey: 'sk-x', baseUrl: 'https://api.openai.com',
  temperature: 0.7, maxTokens: 4096, contextWindow: 4096, purposes: ['generation'],
})

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<ModelListSection purposes={['generation']} purposeLabel="生成模型" />)
  })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  state.models = []
})

describe('ModelListSection 基座', () => {
  it('渲染已配置卡片（名称 + provider 信息）与添加按钮', () => {
    state.models = [makeModel('m1', 'GPT-4o'), makeModel('m2', 'Claude')]
    const el = render()
    expect(el.textContent).toContain('GPT-4o')
    expect(el.textContent).toContain('Claude')
    expect(el.textContent).toContain('生成模型') // 添加按钮/计数文案含 label
  })

  it('空列表 → 空态（虚线框）与"添加第一个"按钮', () => {
    const el = render()
    expect(el.textContent).toContain('还没有')   // 文案含"还没有配置…"（i18n zh-CN）
  })
})
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run src/components/settings/ModelListSection.test.tsx`
Expected: 2 PASS。若文案断言与 zh-CN 实际文案不符，以 `t('model.noLabelConfig')` 的实际输出为准修正断言字符串。

- [ ] **Step 6: 全量门禁 + 提交**

```bash
npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run
git add src/components/settings/ModelListSection.tsx src/components/settings/ModelListSection.test.tsx src/components/settings/SettingsModal.tsx
git commit -m "refactor(settings): 模型列表/卡片/表单拆出 ModelListSection（纯搬迁 + 测试基座）"
```

---

### Task 2: ① `ModelCard` 操作按钮规范化

**Files:**
- Modify: `src/components/settings/ModelListSection.tsx`（`ModelCard` 内操作区）
- Modify: `src/components/settings/ModelListSection.test.tsx`

**Interfaces:**
- Produces: `ModelCard` 操作按钮统一形态——`<button type="button" style={{ width: 32, height: 32 }} aria-label={…} title={…} className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] …">`；后续 Task 3/4 的渲染改动不动这些按钮

- [ ] **Step 1: 写 failing test**

追加到 `ModelListSection.test.tsx`：

```tsx
describe('ModelCard 操作按钮（常驻 32×32 + aria-label）', () => {
  it('设默认/编辑/删除三按钮常驻（无 hover 显形门控）、热区 32×32、带 aria-label', () => {
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    const ops = Array.from(el.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
      .filter(b => ['设为默认模型', '编辑模型', '删除模型'].includes(b.getAttribute('aria-label') ?? ''))
    expect(ops).toHaveLength(3)
    for (const b of ops) {
      expect(b.className, '不得再用 hover 显形门控').not.toContain('opacity-0')
      expect(b.style.width).toBe('32px')
      expect(b.style.height).toBe('32px')
    }
  })
})
```

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/components/settings/ModelListSection.test.tsx`
Expected: FAIL——`ops` 长度为 0（现在按钮只有 `title` 无 `aria-label`，且外层有 `opacity-0 group-hover:opacity-100`）。

- [ ] **Step 3: 实现**

`ModelListSection.tsx` 的 `ModelCard`：删除操作区外层的 `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity`（保留 `flex items-center gap-1`）；三个按钮统一为：

```tsx
<button
  type="button"
  onClick={onSetDefault}                    /* 按各自职责 */
  title={t('model.setDefault')}
  aria-label={t('model.setDefault')}        /* 现有 key；编辑/删除同理用 action.edit / action.delete */
  className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
  style={{ width: 32, height: 32 }}
>
  <Check size={14} />
</button>
```

删除按钮保留其 error 色 hover 类与 `disabled={deleting}`、Spinner 分支，只替换尺寸与补 `aria-label`。

- [ ] **Step 4: 跑测试看绿 + 全量**

Run: `npx vitest run src/components/settings/ModelListSection.test.tsx`（Expected: PASS）
Run: `npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run`（Expected: 全绿）

- [ ] **Step 5: 提交**

```bash
git add src/components/settings/ModelListSection.tsx src/components/settings/ModelListSection.test.tsx
git commit -m "fix(settings): 模型卡操作按钮常驻 32×32 + aria-label（对齐操作按钮不变量）"
```

---

### Task 3: ②-a 行内编辑——编辑现有卡 + 切换保护

**Files:**
- Modify: `src/components/settings/ModelListSection.tsx`
- Modify: `src/components/settings/ModelListSection.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `ModelListSection` 结构
- Produces: 状态 `editing: { draft: ModelProfile; isNew: boolean; baseline: string } | null`（Task 4 复用）；`ModelForm` 增加 `onDiscardCheck` 无——**不新增 props**，切换保护在 `ModelListSection` 内实现

- [ ] **Step 1: 写 failing tests**

追加：

```tsx
describe('行内编辑（列表常驻 + 单展开 + 切换保护）', () => {
  it('点「编辑」→ 该位展开表单，其余卡仍在 DOM（列表不被替换）', () => {
    state.models = [makeModel('m1', 'GPT-4o'), makeModel('m2', 'Claude')]
    const el = render()
    act(() => { (el.querySelector('button[aria-label="编辑模型"]') as HTMLButtonElement).click() })
    expect(el.textContent).toContain('编辑配置')       // ModelForm 标题
    expect(el.textContent).toContain('Claude')          // 另一张卡仍在
  })

  it('取消 → 表单收回，列表恢复', () => {
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    act(() => { (el.querySelector('button[aria-label="编辑模型"]') as HTMLButtonElement).click() })
    act(() => {
      ;[...el.querySelectorAll('button')].find(b => b.textContent?.includes('取消'))!.click()
    })
    expect(el.textContent).not.toContain('编辑配置')
  })

  it('未改动直接切换编辑 → 不弹确认；改动后切换 → 弹确认，取消则保持原编辑态', async () => {
    state.models = [makeModel('m1', 'GPT-4o'), makeModel('m2', 'Claude')]
    const el = render()
    const editBtns = () => Array.from(el.querySelectorAll<HTMLButtonElement>('button[aria-label="编辑模型"]'))

    // ① 未改动直接切换 → 不弹确认（此时编辑按钮只剩 Claude 的一个）
    act(() => { editBtns()[0].click() })
    await act(async () => { editBtns()[0].click() })
    expect(document.body.textContent).not.toContain('放弃未保存的修改')

    // ② 改动显示名称字段 → 切换时弹确认
    const nameInput = [...el.querySelectorAll('input')].find(i => i.value === 'Claude') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(nameInput, 'Claude 改')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      editBtns()[0].click()   // 现在只剩 GPT-4o 的编辑按钮
      await new Promise(r => setTimeout(r, 10))
    })
    expect(document.body.textContent).toContain('放弃未保存的修改')

    // ③ 取消 → 仍停在「Claude 改」的原编辑态（未切走）
    await act(async () => {
      ;[...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === '取消')!.click()
      await new Promise(r => setTimeout(r, 10))
    })
    expect([...el.querySelectorAll('input')].some(i => i.value === 'Claude 改')).toBe(true)
  })

  it('保存失败（IPC reject）→ 表单收回 + toast.error（现状行为钉住）', async () => {
    state.saveModel.mockRejectedValueOnce(new Error('disk full'))
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    act(() => { (el.querySelector('button[aria-label="编辑模型"]') as HTMLButtonElement).click() })
    await act(async () => {
      ;[...el.querySelectorAll('button')].find(b => b.textContent?.includes('保存'))!.click()
      await new Promise(r => setTimeout(r, 10))
    })
    expect(el.textContent).not.toContain('编辑配置') // 收回（保持现状语义）
  })
})
```

（确认弹窗为 `Confirm` 组件渲染——若它 Portal 到 body，用 `document.body.textContent` 断言。）

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/components/settings/ModelListSection.test.tsx`
Expected: 第一例 FAIL（现在点编辑整列表被替换，"Claude"不在 DOM）。

- [ ] **Step 3: 实现**

`ModelListSection` 内：

```tsx
// 状态模型：列表常驻，编辑器在对应位置原地展开（替代旧的 editingModel「整列表替换」）
const [editing, setEditing] = useState<{ draft: ModelProfile; isNew: boolean; baseline: string } | null>(null)

/** 进入编辑：已有草稿且**有实际改动**（与 baseline 快照不一致）时先确认 */
const startEdit = async (m: ModelProfile) => {
  if (editing && JSON.stringify(editing.draft) !== editing.baseline) {
    const ok = await confirm(t('model.discardEdit'), { danger: true, confirmText: t('action.discard') })
    if (!ok) return
  }
  setEditing({ draft: { ...m }, isNew: false, baseline: JSON.stringify(m) })
}
```

`handleSave` 改用 `editing.draft`（`saveModel(editing.draft)`、`renderLog`/`toast` 的 id 同源），末尾 `setEditing(null)`（**保持现状**：失败也收回——Review Focus 1）。

保存判定 `countBefore === 0` 保持（`filtered.length` 在渲染闭包内可用）。

渲染改为（替换旧 `editingModel ? <ModelForm/> : 列表` 两态）：

```tsx
<div className="space-y-2">
  {filtered.map((model) => (
    editing && !editing.isNew && editing.draft.id === model.id ? (
      <ModelForm
        key={model.id}
        model={editing.draft}
        onChange={(m) => setEditing((e) => (e ? { ...e, draft: m } : e))}
        onSave={handleSave}
        onCancel={() => setEditing(null)}
        saving={saving}
        purposeOptions={purposes}
        presets={presets}
      />
    ) : (
      <ModelCard
        key={model.id}
        model={model}
        isDefault={…现逻辑不变…}
        onSetDefault={…}
        onEdit={() => void startEdit(model)}
        onDelete={…现逻辑不变…}
        deleting={deletingId === model.id}
      />
    )
  ))}
</div>
```

计数行与添加按钮保持；空态条件 `filtered.length === 0` 在 Task 4 再补 `&& !editing?.isNew`。

- [ ] **Step 4: 跑测试看绿 + 全量**

Run: `npx vitest run src/components/settings/ModelListSection.test.tsx`（Expected: PASS）
Run: `npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run`（Expected: 全绿）

- [ ] **Step 5: i18n 新增 key（`src/shared/locale-data/ui.ts`）**

```ts
'model.discardEdit': { 'zh-CN': '放弃未保存的修改？', 'en-US': 'Discard unsaved changes?', 'ru-RU': 'Отменить несохранённые изменения?' },
'action.discard': { 'zh-CN': '放弃', 'en-US': 'Discard', 'ru-RU': 'Отменить' },
```

- [ ] **Step 6: 提交**

```bash
git add src/components/settings/ModelListSection.tsx src/components/settings/ModelListSection.test.tsx src/shared/locale-data/ui.ts
git commit -m "feat(settings): 模型卡行内编辑——列表常驻 + 单展开 + 切换保护"
```

---

### Task 4: ②-b 新增草稿卡（列表头部展开）

**Files:**
- Modify: `src/components/settings/ModelListSection.tsx`
- Modify: `src/components/settings/ModelListSection.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `editing` 状态与 `ModelForm` 渲染路径
- Produces: `handleAdd` 改为进入 `{ isNew: true }` 编辑态——此后再无 `editingModel` 术语

- [ ] **Step 1: 写 failing tests**

```tsx
describe('新增草稿卡', () => {
  it('点「添加」→ 列表头部出现编辑表单，且空态被隐藏', () => {
    const el = render() // 空列表
    act(() => {
      ;[...el.querySelectorAll('button')].find(b => b.textContent?.includes('添加') && b.textContent?.includes('生成模型'))!.click()
    })
    expect(el.textContent).toContain('新建配置')
    expect(el.textContent).not.toContain('还没有') // 空态不与之同屏（Review Focus 2）
  })

  it('取消新增 → 表单消失且不产生卡片', () => {
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    act(() => { [...el.querySelectorAll('button')].find(b => b.textContent?.includes('添加'))!.click() })
    act(() => { [...el.querySelectorAll('button')].find(b => b.textContent?.includes('取消'))!.click() })
    expect(el.textContent).not.toContain('新建配置')
    expect(el.querySelectorAll('button[aria-label="编辑模型"]')).toHaveLength(1) // 仍只有原卡
  })

  it('保存新增 → saveModel 收到草稿并入列', async () => {
    const el = render()
    act(() => { [...el.querySelectorAll('button')].find(b => b.textContent?.includes('添加'))!.click() })
    // 填必填名（显示名称，Input 无 label 关联时按 placeholder 找）——用 displayName placeholder
    const nameInput = el.querySelector('input[placeholder]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(nameInput, '我的模型')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent?.includes('保存'))!.click() })
    expect(state.saveModel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/components/settings/ModelListSection.test.tsx`
Expected: 第一例 FAIL（`新建配置` 标题不出现——`handleAdd` 还是旧行为/或列表被替换语义）。

- [ ] **Step 3: 实现**

```tsx
const handleAdd = () => {
  // 原构造逻辑整体保留（openaiPreset 缺省、tokenSpec 等），只是不再 setEditingModel
  const draft: ModelProfile = { /* …原 handleAdd 的对象字面量逐字段保留… */ }
  setEditing({ draft, isNew: true, baseline: JSON.stringify(draft) })
}
```

渲染在列表**头部**插入（isNew 分支）：

```tsx
<div className="space-y-2">
  {editing?.isNew && (
    <ModelForm
      model={editing.draft}
      onChange={(m) => setEditing((e) => (e ? { ...e, draft: m } : e))}
      onSave={handleSave}
      onCancel={() => setEditing(null)}
      saving={saving}
      purposeOptions={purposes}
      presets={presets}
    />
  )}
  {filtered.map(/* Task 3 的渲染 */)}
</div>
```

空态条件补 `&& !editing?.isNew`。

- [ ] **Step 4: 跑测试看绿 + 全量门禁**

Run: `npx vitest run src/components/settings/ModelListSection.test.tsx`（PASS）
Run: `npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run`（全绿）

- [ ] **Step 5: 提交**

```bash
git add src/components/settings/ModelListSection.tsx src/components/settings/ModelListSection.test.tsx
git commit -m "feat(settings): 新增模型改为列表头部草稿卡（取消即消失，不整列表替换）"
```

---

### Task 5: ③-a 供应商区候选清单——搜索 + 全选/反选

**Files:**
- Modify: `src/components/settings/ProviderAccountsSection.tsx`（约 367–429 的「模型勾选」区）
- Create: `src/components/settings/ProviderAccountsSection.test.tsx`

**Interfaces:**
- Consumes: 现 `candidates` / `selected: Set<string>` / `toggle(name)` / `fetched` / `fetchError`
- Produces: `query` 状态 + `visibleCandidates` 派生 + `toggleAllVisible()`；新增 i18n key（见 Step 4）

- [ ] **Step 1: 写 failing tests**

`ProviderAccountsSection.test.tsx`（组件的编辑卡需点击才进入——测试直接驱动 `ProviderAccountForm`？**否**：`ProviderAccountForm` 未导出。测试策略：导出 `ProviderAccountForm` 供测试（与 `ModelRoutingSection` 同先例），测试直接渲染它。）

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ProviderAccountForm } from './ProviderAccountsSection'

const listModels = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  models: ['bge-m3', 'bge-large-zh', 'nomic-embed-text', 'BGE-Reranker'],
})))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ providers: [], models: [], listProviderModels: listModels, saveProvider: vi.fn(async () => true) }),
    { getState: () => ({ providers: [], models: [], listProviderModels: listModels, saveProvider: vi.fn(async () => true), deleteProvider: vi.fn() }) },
  ),
}))
vi.mock('../../stores/agent-store', () => ({ useAgentStore: Object.assign(() => [], { getState: () => ({ conversations: [] }) }) }))
vi.mock('../../stores/vector-config-store', () => ({ useVectorConfigStore: Object.assign(() => ({}), { getState: () => ({ llmEmbeddingSettings: { modelId: null } }) }) }))

let container: HTMLDivElement | null = null
let root: Root | null = null
const render = () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<ProviderAccountForm account={{ id: 'p1', provider: 'ollama', protocol: 'openai', apiKey: '', baseUrl: 'http://localhost:11434', modelNames: [] }} onCancel={() => {}} onDone={() => {}} />)
  })
  return container
}

async function fetchList(el: HTMLElement) {
  await act(async () => {
    ;[...el.querySelectorAll('button')].find(b => b.textContent?.includes('获取模型'))!.click()
    await new Promise(r => setTimeout(r, 10))
  })
}

afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null })

describe('供应商区候选清单（搜索 + 全选）', () => {
  it('搜索过滤（大小写不敏感，Review Focus 5）', async () => {
    const el = render(); await fetchList(el)
    const search = el.querySelector('input[type="search"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, 'BGE-')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(el.textContent).toContain('bge-m3')
    expect(el.textContent).not.toContain('nomic-embed-text')
  })

  it('全选 → 勾选全部可见项；再点取消全选 → 清空可见项', async () => {
    const el = render(); await fetchList(el)
    const btn = () => [...el.querySelectorAll('button')].find(b => /全选|取消全选/.test(b.textContent ?? ''))!
    act(() => btn().click())
    const checked = () => Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter(c => c.checked)
    expect(checked()).toHaveLength(4)
    act(() => btn().click())
    expect(checked()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/components/settings/ProviderAccountsSection.test.tsx`
Expected: FAIL——`ProviderAccountForm` 未导出（编译错误）→ 先在第 3 步导出；随后断言红（无搜索框/全选按钮）。

- [ ] **Step 3: 实现**

`ProviderAccountsSection.tsx`：`function ProviderAccountForm` 前加 `export`。在「模型勾选」区（`selectedCount` 行下方）加：

```tsx
const [query, setQuery] = useState('')
const visibleCandidates = candidates.filter(n => n.toLowerCase().includes(query.trim().toLowerCase()))
const allVisiblePicked = visibleCandidates.length > 0 && visibleCandidates.every(n => selected.has(n))
const toggleAllVisible = () => {
  const next = new Set(selected)
  if (allVisiblePicked) visibleCandidates.forEach(n => next.delete(n))
  else visibleCandidates.forEach(n => next.add(n))
  setSelected(next)
}
```

工具栏行（候选框上方）：

```tsx
<div className="flex items-center gap-1.5">
  <Input
    type="search"
    className="h-6 text-micro flex-1"
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    placeholder={t('provider.searchPlaceholder')}
    aria-label={t('provider.searchPlaceholder')}
  />
  <Button variant="ghost" size="sm" disabled={visibleCandidates.length === 0} onClick={toggleAllVisible}>
    {allVisiblePicked ? t('provider.deselectAll') : t('provider.selectAll')}
  </Button>
</div>
```

清单渲染改用 `visibleCandidates`（空时显示 `t('provider.fetchNoMatches')` 文本）。

- [ ] **Step 4: i18n（`ui.ts`）**

```ts
'provider.searchPlaceholder': { 'zh-CN': '搜索模型…', 'en-US': 'Search models…', 'ru-RU': 'Поиск моделей…' },
'provider.selectAll': { 'zh-CN': '全选', 'en-US': 'Select all', 'ru-RU': 'Выбрать все' },
'provider.deselectAll': { 'zh-CN': '取消全选', 'en-US': 'Deselect all', 'ru-RU': 'Снять выделение' },
'provider.fetchNoMatches': { 'zh-CN': '没有匹配的模型', 'en-US': 'No matching models', 'ru-RU': 'Нет подходящих моделей' },
```

- [ ] **Step 5: 跑测试看绿 + 全量门禁 + 提交**

Run: `npx vitest run src/components/settings/ProviderAccountsSection.test.tsx`（PASS）
Run: `npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run`（全绿）

```bash
git add src/components/settings/ProviderAccountsSection.tsx src/components/settings/ProviderAccountsSection.test.tsx src/shared/locale-data/ui.ts
git commit -m "feat(settings): 供应商模型候选清单加搜索与全选/反选（对可见项生效）"
```

---

### Task 6: ③-b `ModelForm` 获取模型面板

**Files:**
- Modify: `src/components/settings/ModelListSection.tsx`（`ModelForm` 的「模型标识」行）
- Modify: `src/components/settings/ModelListSection.test.tsx`

**Interfaces:**
- Consumes: `useLLMStore.getState().listProviderModels({ provider, protocol, apiKey, baseUrl })`（已存在，返回 `{ success, models?, error? }`）；`PopoverSurface`（`anchorName` 模式）、`useOutsideClick`、`useEscapeKey`
- Produces: 面板状态 `fetchPanelOpen` / `fetchCandidates` / `fetching` / `fetchError` / `fetchQuery`（全部 `ModelForm` 私有）

- [ ] **Step 1: 写 failing tests**

```tsx
describe('模型表单「获取模型」面板', () => {
  it('点击 → 用当前表单值调 listProviderModels；选中候选 → 填入模型标识', async () => {
    const listProviderModels = vi.fn(async () => ({ success: true, models: ['qwen-max', 'qwen-plus'] }))
    // 在 llm-store mock 的 state 上加 listProviderModels（Task 1 的 state 对象扩一个字段）
    state.listProviderModels = listProviderModels
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    act(() => { (el.querySelector('button[aria-label="编辑模型"]') as HTMLButtonElement).click() })
    // 展开「自定义设置」（模型标识在其中）
    act(() => { [...el.querySelectorAll('summary')].find(s => s.textContent?.includes('自定义设置'))!.click() })
    await act(async () => {
      ;[...el.querySelectorAll('button')].find(b => b.textContent?.includes('获取模型'))!.click()
      await new Promise(r => setTimeout(r, 10))
    })
    expect(listProviderModels).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', apiKey: 'sk-x' }))
    // 面板出现候选
    expect(el.textContent).toContain('qwen-max')
    // 点选 → 模型标识输入框值更新
    act(() => { [...el.querySelectorAll('button')].find(b => b.textContent?.includes('qwen-max'))!.click() })
    const modelIdInput = [...el.querySelectorAll('input')].find(i => i.value === 'qwen-max')
    expect(modelIdInput).toBeTruthy()
  })

  it('拉取失败 → 面板内错误文案，表单字段不丢（Review Focus 4）', async () => {
    state.listProviderModels = vi.fn(async () => ({ success: false, error: 'ECONNREFUSED' }))
    state.models = [makeModel('m1', 'GPT-4o')]
    const el = render()
    act(() => { (el.querySelector('button[aria-label="编辑模型"]') as HTMLButtonElement).click() })
    await act(async () => {
      ;[...el.querySelectorAll('button')].find(b => b.textContent?.includes('获取模型'))!.click()
      await new Promise(r => setTimeout(r, 10))
    })
    expect(el.textContent).toContain('ECONNREFUSED')
    expect((el.querySelector('input[placeholder="sk-..."]') as HTMLInputElement).value).toBe('sk-x') // key 未丢
  })
})
```

（Task 1 的 `state` 增补 `listProviderModels: vi.fn(async () => ({ success: true, models: [] }))`，并在 `vi.mock` 的 state 类型中带上。）

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/components/settings/ModelListSection.test.tsx`
Expected: FAIL——无「获取模型」按钮。

- [ ] **Step 3: 实现**

`ModelForm` 内新增状态与 handler：

```tsx
const [fetchPanelOpen, setFetchPanelOpen] = useState(false)
const [fetching, setFetching] = useState(false)
const [fetchCandidates, setFetchCandidates] = useState<string[]>([])
const [fetchError, setFetchError] = useState<string | null>(null)
const [fetchQuery, setFetchQuery] = useState('')

const doFetchModels = async () => {
  setFetching(true)
  setFetchError(null)
  const res = await useLLMStore.getState().listProviderModels({
    provider: model.provider, protocol: model.protocol, apiKey: model.apiKey, baseUrl: model.baseUrl,
  })
  setFetching(false)
  setFetchPanelOpen(true)
  if (!res.success) { setFetchError(res.error ?? t('status.unknown')); setFetchCandidates([]); return }
  setFetchCandidates(res.models ?? [])
}
```

「模型标识」行（`form.modelId` Label 行）右侧、现有"手动输入/从列表选择"切换旁加：

```tsx
<button
  type="button"
  onClick={() => void doFetchModels()}
  disabled={fetching || !model.baseUrl}
  className="text-xs transition-colors"
  style={{ color: 'var(--color-accent)' }}
  aria-label={t('provider.fetchModels')}
>
  {fetching ? t('provider.fetching') : t('provider.fetchModels')}
</button>
```

面板（锚点模式，锚在小按钮上；关闭用两个既有 hook）：

```tsx
const panelRef = useRef<HTMLDivElement | null>(null)   // useOutsideClick 需要
useOutsideClick(panelRef, () => setFetchPanelOpen(false), fetchPanelOpen)
useEscapeKey(() => setFetchPanelOpen(false), fetchPanelOpen)

{fetchPanelOpen && (
  <PopoverSurface anchorName="--model-fetch" placement="below-end" className="p-1.5" style={{ width: 260 }}>
    <div ref={panelRef}>
      <Input type="search" className="h-6 text-micro mb-1" value={fetchQuery}
        onChange={(e) => setFetchQuery(e.target.value)}
        placeholder={t('provider.searchPlaceholder')} aria-label={t('provider.searchPlaceholder')} />
      {fetchError && <p className="text-2xs px-1 py-0.5" style={{ color: 'var(--color-error)' }}>{fetchError}</p>}
      {!fetchError && fetchCandidates.length === 0 && (
        <p className="text-2xs px-1 py-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('provider.fetchNoMatches')}</p>
      )}
      <div className="max-h-48 overflow-y-auto">
        {fetchCandidates
          .filter(n => n.toLowerCase().includes(fetchQuery.trim().toLowerCase()))
          .map(n => (
            <button key={n} type="button"
              className="w-full text-left px-2 py-1 rounded text-xs hover:bg-[var(--color-hover)] cursor-pointer"
              onClick={() => { up('modelName', n); setFetchPanelOpen(false) }}
            >
              {n}
            </button>
          ))}
      </div>
    </div>
  </PopoverSurface>
)}
```

（按钮 `style={{ anchorName: '--model-fetch' }}`——CSS 锚点模式的锚点在**触发按钮**上，与 `CharacterEditor.tsx:306` 的用法一致。）

- [ ] **Step 4: 跑测试看绿 + 全量门禁**

Run: `npx vitest run src/components/settings/ModelListSection.test.tsx`（PASS）
Run: `npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run`（全绿）

- [ ] **Step 5: 提交**

```bash
git add src/components/settings/ModelListSection.tsx src/components/settings/ModelListSection.test.tsx
git commit -m "feat(settings): 模型表单接入「获取模型」面板（当前表单值探测端点 + 搜索 + 点选填入）"
```

---

### Task 7: ④ 刻度核对 + 收尾

**Files:**
- Modify: `src/components/settings/ModelListSection.tsx`（图标容器）

- [ ] **Step 1: 图标容器半像素修正**

`ModelCard` 的图标容器从 `w-9 h-9`（= 31.5px）改为固定 32：

```tsx
<div
  className="rounded-lg flex items-center justify-center flex-shrink-0 text-lg"
  style={{ width: 32, height: 32, backgroundColor: 'var(--color-hover)' }}
>
```

- [ ] **Step 2: i18n 三语自查**

Run: `npx vitest run src/shared/locale.test.ts src/shared/i18n-key-guard.test.ts src/shared/i18n-structure-guard.test.ts`
Expected: PASS（本次新增 key 均三语；structure/key guard 不吐新违规）。

- [ ] **Step 3: 全量门禁**

Run: `npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add src/components/settings/ModelListSection.tsx
git commit -m "style(settings): 模型卡图标容器 32×32 固定 px（半像素修正）"
```

---

## Self-Review 记录

- **Spec 覆盖**：§二→Task 1；§三→Task 2；§四→Task 3+4；§五→Task 5+6；§六→Task 2/7；§七→各任务测试步骤 + Task 5 的 i18n 步骤；§八 非目标未触碰（无任务涉及数据层）。
- **Placeholder 扫描**：无 TBD/TODO；所有代码步骤给了完整代码或精确行段与替换代码。
- **类型一致性**：`editing: { draft, isNew, baseline }` 在 Task 3/4 一致；`listProviderModels` 返回形状（`{ success, models?, error? }`）与 `ProviderAccountsSection.tsx:238` 既有用法一致；i18n key 名在任务间不重名（`provider.searchPlaceholder` 被 Task 5/6 共用，同语义）。
- **Review Focus**：5 条已分别挂到 owning task 的测试（保存失败→T3、空态共存→T4、切换保护→T3、面板关闭不丢字段→T6、搜索大小写→T5）。
