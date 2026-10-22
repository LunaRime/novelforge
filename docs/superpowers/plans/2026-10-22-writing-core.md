# 写作核心闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有 AI 流水线的前提下，让用户能不经过 AI 直接新建空白章节并开始写作；AI 自审产生新版本时不丢用户未保存的编辑；切换 Tab 后恢复滚动位置与光标。

**Architecture:** 桌面端渲染层新增一个“空白章节”入口：复用 `db:blueprint-upsert` + `db:draft-create` 建蓝图与空草稿，再走现有 DraftEditor。AI 新版本通过新增的 `DRAFT_VERSION_CREATED` 事件通知 EditorArea：Tab 干净则原位切换到新版本，Tab 脏则只提示、不覆盖。编辑器视图状态（selection + scrollTop）按“项目路径 + filePath”缓存到 localStorage，在 CodeMirror 挂载/卸载时恢复与保存。AI 工作流代码路径不改语义，只增加一个事件发射点。

**Tech Stack:** Electron 41 / React 19 / TypeScript 6 / Zustand / CodeMirror 6（@uiw/react-codemirror）/ Vitest。

**Spec:** 本文件（范围来自 2026-10-22 的代码审查 + 真机冒烟报告；无独立 spec）。

## Global Constraints

- 项目使用 CJS（`"type": "commonjs"`），Electron 主进程与 preload 的构建方式不变。
- TypeScript strict：`noUnusedLocals` / `noUnusedParameters` 必须通过。
- ESLint `--max-warnings 0`；任何新增文件不得留下 warning。
- 所有用户可见文本必须走 `t()`，并在 `src/shared/locale-data/*` 提供 `zh-CN` / `en-US` / `ru-RU` 三语。
- 禁止硬编码颜色：只用 `var(--color-*)` 语义令牌。
- 不新增 IPC 通道；本计划只使用已有的 `db:draft-*`、`db:blueprint-*` 通道。
- 不改 AI 流水线的写稿/审稿/定稿语义；`self-review.command.ts` 只增加结果捕获与事件发射。
- `.test-artifacts/` 不进入提交；本计划产生的临时截图/令牌文件留在该目录。

## Review Focus

- **已有草稿的章节再次“新建空白章节”**：必须打开已有草稿，绝不能创建重复的 v1。
- **AI 新版本到达时 Tab 是脏的**：绝不能静默覆盖用户未保存的正文；只能提示并保留当前编辑。
- **内容变短后恢复视图状态**：保存的 selection 偏移必须 clamp 到新文档长度，否则 CodeMirror 会抛 RangeError。
- **项目切换**：视图状态必须按项目路径隔离；A 项目的滚动位置不得恢复到 B 项目同名 filePath。
- **没有蓝图/蓝图被删**：空白章节仍应能创建并保存草稿；蓝图创建失败必须给出可见错误，不能留下“幽灵 Tab”。

---

### Task 1: 空白章节创建服务

**Files:**
- Create: `src/services/blank-chapter-service.ts`
- Test: `src/services/blank-chapter-service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BlankChapterRequest {
    chapterNumber: number
    title?: string
  }

  export type BlankChapterResult =
    | { kind: 'created'; chapterNumber: number; draftId: number; version: number; title: string }
    | { kind: 'existing'; chapterNumber: number; draftId: number; version: number; title: string }

  export async function createBlankChapter(request: BlankChapterRequest): Promise<BlankChapterResult>
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/services/blank-chapter-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('./ipc-client', () => ({ ipc: { invoke } }))

import { createBlankChapter } from './blank-chapter-service'

describe('createBlankChapter', () => {
  beforeEach(() => invoke.mockReset())

  it('无草稿时创建蓝图与 v1 空草稿', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'db:draft-list') return []
      if (ch === 'db:blueprint-get') return null
      if (ch === 'db:blueprint-upsert') return { success: true }
      if (ch === 'db:draft-create') return { success: true, id: 42 }
      throw new Error('unexpected ' + ch)
    })
    const r = await createBlankChapter({ chapterNumber: 3, title: '雨夜' })
    expect(r).toEqual({ kind: 'created', chapterNumber: 3, draftId: 42, version: 1, title: '雨夜' })
    expect(invoke).toHaveBeenCalledWith('db:draft-create', {
      chapterNumber: 3, version: 1, source: 'write', content: '', wordCount: 0,
    })
  })

  it('已有非归档草稿时直接返回最新版本，不创建', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'db:draft-list') return [
        { id: 7, version: 2, status: 'draft' },
        { id: 6, version: 1, status: 'archived' },
      ]
      throw new Error('unexpected ' + ch)
    })
    const r = await createBlankChapter({ chapterNumber: 2 })
    expect(r).toEqual({ kind: 'existing', chapterNumber: 2, draftId: 7, version: 2, title: '' })
    expect(invoke).not.toHaveBeenCalledWith('db:draft-create', expect.anything())
  })

  it('已有蓝图时不覆盖标题', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'db:draft-list') return []
      if (ch === 'db:blueprint-get') return { chapterNumber: 1, title: '旧标题' }
      if (ch === 'db:draft-create') return { success: true, id: 9 }
      throw new Error('unexpected ' + ch)
    })
    await createBlankChapter({ chapterNumber: 1, title: '新标题' })
    expect(invoke).not.toHaveBeenCalledWith('db:blueprint-upsert', expect.anything())
  })

  it('章号非法时抛错且不写库', async () => {
    await expect(createBlankChapter({ chapterNumber: 0 })).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('draft-create 失败时把错误抛出', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'db:draft-list') return []
      if (ch === 'db:blueprint-get') return { chapterNumber: 1, title: 'x' }
      if (ch === 'db:draft-create') return { success: false, error: 'disk full' }
      throw new Error('unexpected ' + ch)
    })
    await expect(createBlankChapter({ chapterNumber: 1 })).rejects.toThrow('disk full')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/services/blank-chapter-service.test.ts`
Expected: FAIL — module `./blank-chapter-service` not found.

- [ ] **Step 3: 实现 `createBlankChapter`**

实现要点：
1. `Number.isInteger(chapterNumber) && chapterNumber >= 1`，否则 `throw new Error('invalid chapter number')`。
2. `const drafts = await ipc.invoke('db:draft-list', chapterNumber)`；取 `status !== 'archived'` 中 `version` 最大的一条。若存在，返回 `{ kind:'existing', chapterNumber, draftId: d.id, version: d.version, title: '' }`。
3. `const bp = await ipc.invoke('db:blueprint-get', chapterNumber)`；若为 null，调用 `db:blueprint-upsert`，默认值：
   ```ts
   {
     chapterNumber,
     title: title?.trim() || t('chapter.label').replace('{n}', String(chapterNumber)),
     role: '发展',
     purpose: '',
     keyEvents: '',
     characters: [],
     suspenseHook: '',
     userGuidance: '',
     notes: '',
     notesUpdatedAt: '',
     sortOrder: chapterNumber,
     priority: 1,
     volumeNumber: null,
   }
   ```
   如果 upsert 返回 `success:false`，`throw new Error(error)`。
4. `const created = await ipc.invoke('db:draft-create', { chapterNumber, version: 1, source: 'write', content: '', wordCount: 0 })`；失败抛错。
5. `globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts', 'blueprints'] })`。
6. 返回 `created`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/services/blank-chapter-service.test.ts`
Expected: PASS（5 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/services/blank-chapter-service.ts src/services/blank-chapter-service.test.ts
git commit -m "feat: 空白章节创建服务"
```

---

### Task 2: 草稿 Tab 构造与打开入口

**Files:**
- Create: `src/services/draft-tab.ts`
- Test: `src/services/draft-tab.test.ts`
- Modify: `src/components/panels/sidebar/SidebarShared.tsx`（新增 `openDraftById`，`openDraftByChapter` 改为调用它）
- Modify: `src/components/panels/sidebar/DraftBoxGroup.tsx`（`DraftItem.openDraft` 改用 `openDraftById` 并写入 `chapterNumber`）

**Interfaces:**
- Produces:
  ```ts
  export interface DraftTabInput {
    draftId: number
    chapterNumber: number
    chapterTitle?: string
    version: number
    content: string
  }
  export function buildDraftTab(input: DraftTabInput): EditorTab
  ```
- Produces（`SidebarShared.tsx`）:
  ```ts
  export async function openDraftById(input: {
    draftId: number
    chapterNumber: number
    chapterTitle?: string
    version: number
    content?: string
  }): Promise<boolean>
  ```

- [ ] **Step 1: 写 `buildDraftTab` 失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { buildDraftTab } from './draft-tab'

describe('buildDraftTab', () => {
  it('生成带章节号的草稿 Tab', () => {
    const tab = buildDraftTab({
      draftId: 42, chapterNumber: 3, chapterTitle: '雨夜', version: 2, content: '正文',
    })
    expect(tab).toMatchObject({
      id: 'vela://draft/42',
      filePath: 'vela://draft/42',
      type: 'chapter',
      chapterNumber: 3,
      content: '正文',
    })
    expect(tab.name).toContain('第3章')
    expect(tab.name).toContain('雨夜')
    expect(tab.name).toContain('v2')
  })

  it('标题已带“第N章”前缀时不重复拼接', () => {
    const tab = buildDraftTab({
      draftId: 1, chapterNumber: 2, chapterTitle: '第2章 风起', version: 1, content: '',
    })
    expect(tab.name.match(/第2章/g)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/services/draft-tab.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现 `buildDraftTab`**

用 `t('chapter.label')` 生成 `chLabel`；`titlePart` 规则与 `SidebarShared.openDraftByChapter` 现有逻辑一致（标题以 `chLabel` 开头则不重复）。`name` 形如 `${chLabel}${titlePart} v${version}`。返回 `{ id: filePath, name, type: 'chapter', filePath, content, chapterNumber }`。

- [ ] **Step 4: 实现 `openDraftById` 并接入两个调用点**

`openDraftById`：
1. `const content = input.content ?? await readDraftBody(`vela://draft/${input.draftId}`)`
2. `useEditorStore.getState().openFile(buildDraftTab({ ...input, content }))`
3. 返回 `true`；读取失败返回 `false`。

`openDraftByChapter` 改为：找到最新草稿后调用 `openDraftById`。
`DraftItem.openDraft` 改为：`openDraftById({ draftId: draft.id, chapterNumber: draft.chapterNumber, chapterTitle: title, version: draft.version })`。

- [ ] **Step 5: 运行测试 + 类型检查**

Run: `pnpm exec vitest run src/services/draft-tab.test.ts && pnpm run typecheck`
Expected: PASS，tsc 0 错误。

- [ ] **Step 6: 提交**

```bash
git add src/services/draft-tab.ts src/services/draft-tab.test.ts src/components/panels/sidebar/SidebarShared.tsx src/components/panels/sidebar/DraftBoxGroup.tsx
git commit -m "feat: 草稿 Tab 统一构造与打开入口"
```

---

### Task 3: 空白章节弹窗与入口

**Files:**
- Create: `src/components/dialogs/BlankChapterDialog.tsx`
- Test: `src/components/dialogs/BlankChapterDialog.test.tsx`
- Modify: `src/stores/layout-store.ts`（`blankChapterOpen` + `openBlankChapter` + `closeBlankChapter`）
- Modify: `src/App.tsx`（挂载弹窗，包 ErrorBoundary）
- Modify: `src/components/command-palette/CommandPalette.tsx`（新增命令项）
- Modify: `src/components/panels/sidebar/DraftBoxGroup.tsx`（`SidebarGroup actions` 加 32×32 `+` 按钮）
- Modify: `src/shared/locale-data/editor.ts`（三语文案）

**Interfaces:**
- Consumes: `createBlankChapter`（Task 1）、`openDraftById`（Task 2）。
- Produces: `BlankChapterDialog({ open, onClose }: { open: boolean; onClose: () => void })`。

- [ ] **Step 1: 写弹窗测试**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

const createBlankChapter = vi.fn()
const openDraftById = vi.fn()
vi.mock('../../services/blank-chapter-service', () => ({ createBlankChapter }))
vi.mock('../panels/sidebar/SidebarShared', () => ({ openDraftById }))

import BlankChapterDialog from './BlankChapterDialog'

describe('BlankChapterDialog', () => {
  beforeEach(() => { createBlankChapter.mockReset(); openDraftById.mockReset() })

  it('提交时创建并打开新草稿', async () => {
    createBlankChapter.mockResolvedValue({ kind: 'created', chapterNumber: 3, draftId: 42, version: 1, title: '雨夜' })
    const onClose = vi.fn()
    const { container } = await render(<BlankChapterDialog open onClose={onClose} />)
    // 填章节号 3、标题 雨夜，点“创建并开始写”
    // 断言 createBlankChapter 收到 { chapterNumber: 3, title: '雨夜' }
    // 断言 openDraftById 收到 { draftId: 42, chapterNumber: 3, chapterTitle: '雨夜', version: 1 }
    // 断言 onClose 被调用
  })

  it('已有草稿时打开已有版本并关闭', async () => {
    createBlankChapter.mockResolvedValue({ kind: 'existing', chapterNumber: 3, draftId: 7, version: 2, title: '' })
    // 断言 openDraftById 收到 draftId 7、version 2，onClose 调用
  })
})
```

（`render` 辅助函数按仓库现有 React 测试写法实现：`createRoot(container)` + `act`。）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/dialogs/BlankChapterDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现弹窗**

字段：
- 章节号：`<input type="number" min={1} value={chapterNumber} onChange=... />`，默认值为 `max(蓝图最大章号, 草稿最大章号) + 1`；打开时用 `Promise.all([ipc.invoke('db:blueprint-get-all'), ipc.invoke('db:draft-get-all-chapter-numbers')])` 计算。
- 章节标题：文本输入，占位 `t('dialog.chapterTitlePlaceholder')`，可留空。
- 按钮：取消 / 创建并开始写。
- 提交：`const r = await createBlankChapter({ chapterNumber, title: title.trim() || undefined })`；然后 `await openDraftById({ draftId: r.draftId, chapterNumber: r.chapterNumber, chapterTitle: r.title || title.trim(), version: r.version })`；toast：`r.kind === 'created' ? t('blankChapter.created') : t('blankChapter.exists')`；`onClose()`。
- 失败：`toast.error(t('blankChapter.failed').replace('{error}', ...))`，保持弹窗打开。

- [ ] **Step 4: 接入 layout-store / App / 命令面板 / 侧栏**

- `layout-store.ts`：新增 `blankChapterOpen: false`、`openBlankChapter: () => set({ blankChapterOpen: true })`、`closeBlankChapter: () => set({ blankChapterOpen: false })`。
- `App.tsx`：在 `ChapterCreationDialog` 后加 `<ErrorBoundary fallbackLabel={...}><BlankChapterDialog open={blankChapterOpen} onClose={closeBlankChapter} /></ErrorBoundary>`。
- `CommandPalette.tsx`：在 `new-chapter` 后新增：
  ```tsx
  {
    id: 'new-blank-chapter', label: t('dialog.newBlankChapter'), category: t('command.group.general'),
    icon: <PenLine size={15} />, keywords: 'blank chapter write 空白 新建 章节 手写',
    run: () => layout.openBlankChapter(),
  }
  ```
  需要从 `lucide-react` 引入 `PenLine`。
- `DraftBoxGroup.tsx`：`<SidebarGroup actions={<button type="button" onClick={() => useLayoutStore.getState().openBlankChapter()} className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0" style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }} title={t('dialog.newBlankChapter')} aria-label={t('dialog.newBlankChapter')}><Plus size={12} /></button>} ...>`；引入 `Plus` 和 `useLayoutStore`。
- i18n 新增键（三语）：
  `dialog.newBlankChapter`、`dialog.blankChapterDesc`、`dialog.chapterNumber`、`dialog.chapterTitle`、`dialog.chapterTitlePlaceholder`、`dialog.createAndWrite`、`blankChapter.created`、`blankChapter.exists`、`blankChapter.failed`。

- [ ] **Step 5: 运行测试 + 类型检查 + lint**

Run: `pnpm exec vitest run src/components/dialogs/BlankChapterDialog.test.tsx && pnpm run typecheck && pnpm run lint`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/components/dialogs/BlankChapterDialog.tsx src/components/dialogs/BlankChapterDialog.test.tsx src/stores/layout-store.ts src/App.tsx src/components/command-palette/CommandPalette.tsx src/components/panels/sidebar/DraftBoxGroup.tsx src/shared/locale-data/editor.ts
git commit -m "feat: 新建空白章节入口"
```

---

### Task 4: EditorStore 原位切换版本

**Files:**
- Modify: `src/stores/editor-store.ts`
- Test: `src/stores/editor-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  retargetTab: (tabId: string, next: {
    id: string
    name: string
    filePath: string
    content: string
  }) => void
  ```
  行为：替换目标 Tab 的 `id/name/filePath/content`，`dirty: false`；若 `activeTabId === tabId`，同步改为 `next.id`；不改变 Tab 顺序和其他字段。

- [ ] **Step 1: 写失败测试**

```ts
it('retargetTab 原位切换草稿版本并清 dirty', () => {
  useEditorStore.setState({
    tabs: [{ id: 'vela://draft/1', name: '第1章 v1', type: 'chapter', filePath: 'vela://draft/1', content: '旧', dirty: true, chapterNumber: 1 }],
    activeTabId: 'vela://draft/1',
  })
  useEditorStore.getState().retargetTab('vela://draft/1', {
    id: 'vela://draft/2', name: '第1章 v2', filePath: 'vela://draft/2', content: '新',
  })
  const s = useEditorStore.getState()
  expect(s.tabs).toHaveLength(1)
  expect(s.tabs[0]).toMatchObject({ id: 'vela://draft/2', filePath: 'vela://draft/2', content: '新', dirty: false, chapterNumber: 1 })
  expect(s.activeTabId).toBe('vela://draft/2')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/stores/editor-store.test.ts -t retargetTab`
Expected: FAIL — `retargetTab is not a function`.

- [ ] **Step 3: 实现 action**

在 `EditorState` 接口与 store 实现中加入 `retargetTab`。实现：
```ts
retargetTab: (tabId, next) => {
  set((s) => ({
    tabs: s.tabs.map(t => t.id === tabId ? { ...t, ...next, dirty: false } : t),
    activeTabId: s.activeTabId === tabId ? next.id : s.activeTabId,
  }))
},
```
注意：如果目标 Tab 不存在则 no-op（`map` 天然满足）。

- [ ] **Step 4: 运行测试**

Run: `pnpm exec vitest run src/stores/editor-store.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/stores/editor-store.ts src/stores/editor-store.test.ts
git commit -m "feat: 编辑器 Tab 原位切换草稿版本"
```

---

### Task 5: AI 新版本事件与自动刷新

**Files:**
- Modify: `src/shared/event-bus.ts`
- Modify: `src/services/workflows/commands/self-review.command.ts`
- Create: `src/services/draft-version-refresh.ts`
- Test: `src/services/draft-version-refresh.test.ts`
- Modify: `src/components/panels/EditorArea.tsx`（订阅事件 + toast）
- Modify: `src/shared/locale-data/editor.ts`（三语提示）

**Interfaces:**
- Produces（event-bus）:
  ```ts
  'DRAFT_VERSION_CREATED': { chapterNumber: number; draftId: number; version: number }
  ```
- Produces（refresh service）:
  ```ts
  export type DraftVersionRefreshResult =
    | { action: 'retargeted'; tabId: string; newTabId: string; newVersion: number }
    | { action: 'dirty'; tabId: string; newVersion: number }
    | { action: 'no-tab' }
    | { action: 'missing'; draftId: number }

  export async function refreshOpenDraftVersion(
    payload: EventPayloadMap['DRAFT_VERSION_CREATED'],
  ): Promise<DraftVersionRefreshResult>
  ```

- [ ] **Step 1: 写 refresh service 失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEditorStore } from '../stores/editor-store'

const invoke = vi.fn()
vi.mock('./ipc-client', () => ({ ipc: { invoke } }))

import { refreshOpenDraftVersion } from './draft-version-refresh'

const draftTab = (id: number, chapterNumber: number, dirty = false) => ({
  id: `vela://draft/${id}`, name: `第${chapterNumber}章 v1`, type: 'chapter' as const,
  filePath: `vela://draft/${id}`, content: '旧', dirty, chapterNumber,
})

describe('refreshOpenDraftVersion', () => {
  beforeEach(() => { invoke.mockReset(); useEditorStore.setState({ tabs: [], activeTabId: null }) })

  it('干净 Tab 原位切到新版本', async () => {
    useEditorStore.setState({ tabs: [draftTab(1, 3)], activeTabId: 'vela://draft/1' })
    invoke.mockImplementation(async (ch: string, id: number) => {
      if (ch === 'db:draft-get-full') return { content: '新正文' }
      if (ch === 'db:draft-get-meta') return { id: 2, chapterNumber: 3, version: 2 }
      throw new Error('unexpected ' + ch)
    })
    const r = await refreshOpenDraftVersion({ chapterNumber: 3, draftId: 2, version: 2 })
    expect(r.action).toBe('retargeted')
    const s = useEditorStore.getState()
    expect(s.tabs[0].id).toBe('vela://draft/2')
    expect(s.tabs[0].content).toBe('新正文')
    expect(s.tabs[0].dirty).toBe(false)
  })

  it('脏 Tab 只报告，不覆盖', async () => {
    useEditorStore.setState({ tabs: [draftTab(1, 3, true)], activeTabId: 'vela://draft/1' })
    const r = await refreshOpenDraftVersion({ chapterNumber: 3, draftId: 2, version: 2 })
    expect(r.action).toBe('dirty')
    expect(useEditorStore.getState().tabs[0].content).toBe('旧')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('没有打开的章节 Tab 时 no-tab', async () => {
    useEditorStore.setState({ tabs: [], activeTabId: null })
    expect(await refreshOpenDraftVersion({ chapterNumber: 9, draftId: 2, version: 2 })).toEqual({ action: 'no-tab' })
  })

  it('新版本正文读取失败时 missing', async () => {
    useEditorStore.setState({ tabs: [draftTab(1, 3)], activeTabId: 'vela://draft/1' })
    invoke.mockResolvedValue(null)
    expect(await refreshOpenDraftVersion({ chapterNumber: 3, draftId: 2, version: 2 })).toMatchObject({ action: 'missing' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/services/draft-version-refresh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现 refresh service**

实现要点：
1. `const { tabs, retargetTab } = useEditorStore.getState()`。
2. 候选 Tab：`type === 'chapter' && filePath?.startsWith(VELA.DRAFT)`。
3. 优先 `tab.chapterNumber === payload.chapterNumber`；没有则对候选逐个 `db:draft-get-meta` 解析 id（`filePath.slice(VELA.DRAFT.length)`），找到匹配章号的 Tab。
4. 无候选 → `{ action:'no-tab' }`。
5. 目标 `dirty` → `{ action:'dirty', tabId, newVersion }`，**不读新正文**。
6. `const full = await ipc.invoke('db:draft-get-full', payload.draftId)`；`full?.content` 不是字符串 → `{ action:'missing', draftId }`。
7. 读取 `db:draft-get-meta` 拿 `version`（用于 Tab 名）；缺省用 payload.version。
8. `retargetTab(tab.id, { id: `vela://draft/${payload.draftId}`, name: buildDraftTab({...}).name, filePath: ..., content: full.content })`；返回 `retargeted`。
   - 复用 Task 2 的 `buildDraftTab` 生成 name；`chapterTitle` 从 `draftMeta` 或当前 Tab 名中取（可省略，只保证含 `v{n}`）。
9. 不要在这里弹 toast；由 EditorArea 根据结果弹。

- [ ] **Step 4: 发射事件**

`event-bus.ts` 增加事件类型与 payload。
`self-review.command.ts`：
```ts
const created = await ipc.invoke('db:draft-create', {...})
if (!created.success || !created.id) throw new Error(created.error ?? 'draft create failed')
const { globalEventBus } = await import('../../../shared/event-bus')
globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'] })
globalEventBus.emit('DRAFT_VERSION_CREATED', {
  chapterNumber: this.params.chapterNumber,
  draftId: created.id,
  version: nextVersion,
})
```
保持原有 `callbacks.log` 行为。

- [ ] **Step 5: EditorArea 订阅**

```tsx
useEffect(() => {
  return globalEventBus.on('DRAFT_VERSION_CREATED', (payload) => {
    void refreshOpenDraftVersion(payload).then(r => {
      if (r.action === 'retargeted') {
        toast.success(t('editor.switchedToVersion').replace('{version}', String(r.newVersion)))
      } else if (r.action === 'dirty') {
        toast.warning(t('editor.newVersionDirty').replace('{version}', String(r.newVersion)))
      }
    })
  })
}, [t])
```
引入 `globalEventBus`、`refreshOpenDraftVersion`、`toast`。注意 `EditorArea` 已有 `useEffect`，放在组件顶部 Hooks 区。

- [ ] **Step 6: 运行测试 + 类型检查**

Run: `pnpm exec vitest run src/services/draft-version-refresh.test.ts && pnpm run typecheck`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/shared/event-bus.ts src/services/workflows/commands/self-review.command.ts src/services/draft-version-refresh.ts src/services/draft-version-refresh.test.ts src/components/panels/EditorArea.tsx src/shared/locale-data/editor.ts
git commit -m "feat: AI 新草稿版本自动刷新编辑器"
```

---

### Task 6: Tab 滚动/光标状态缓存

**Files:**
- Create: `src/services/editor-view-state.ts`
- Test: `src/services/editor-view-state.test.ts`
- Modify: `src/components/editor/CodeMirrorEditor.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface EditorViewState {
    anchor: number
    head: number
    scrollTop: number
  }
  export function loadEditorViewState(projectPath: string, filePath: string): EditorViewState | null
  export function saveEditorViewState(projectPath: string, filePath: string, state: EditorViewState): void
  export function clearEditorViewState(projectPath: string, filePath: string): void
  /** 内容变短/换文档时把偏移 clamp 到合法范围，防 CodeMirror RangeError */
  export function clampEditorViewState(
    state: EditorViewState,
    docLength: number,
    scrollHeight: number,
  ): EditorViewState
  ```

- [ ] **Step 1: 写缓存模块失败测试**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { loadEditorViewState, saveEditorViewState, clearEditorViewState, clampEditorViewState } from './editor-view-state'

const KEY = 'novelforge:editor-view-state:v1'

describe('editor-view-state', () => {
  beforeEach(() => localStorage.clear())

  it('按项目 + filePath 往返', () => {
    saveEditorViewState('/p/a', 'vela://draft/1', { anchor: 3, head: 5, scrollTop: 120 })
    expect(loadEditorViewState('/p/a', 'vela://draft/1')).toEqual({ anchor: 3, head: 5, scrollTop: 120 })
    expect(loadEditorViewState('/p/b', 'vela://draft/1')).toBeNull()
  })

  it('坏 JSON 返回 null 且不抛', () => {
    localStorage.setItem(KEY, '{')
    expect(loadEditorViewState('/p', 'x')).toBeNull()
  })

  it('最多保留 200 条，淘汰最旧', () => {
    for (let i = 0; i < 205; i++) saveEditorViewState('/p', `f${i}`, { anchor: 0, head: 0, scrollTop: i })
    const raw = JSON.parse(localStorage.getItem(KEY)!)
    expect(Object.keys(raw.entries)).toHaveLength(200)
    expect(loadEditorViewState('/p', 'f0')).toBeNull()
    expect(loadEditorViewState('/p', 'f204')).not.toBeNull()
  })

  it('clear 只删指定项', () => {
    saveEditorViewState('/p', 'a', { anchor: 0, head: 0, scrollTop: 1 })
    saveEditorViewState('/p', 'b', { anchor: 0, head: 0, scrollTop: 2 })
    clearEditorViewState('/p', 'a')
    expect(loadEditorViewState('/p', 'a')).toBeNull()
    expect(loadEditorViewState('/p', 'b')).not.toBeNull()
  })

  it('clamp 把越界偏移与滚动量收敛到合法范围', () => {
    expect(clampEditorViewState({ anchor: 99, head: -3, scrollTop: 999 }, 20, 100))
      .toEqual({ anchor: 20, head: 0, scrollTop: 100 })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/services/editor-view-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现缓存模块**

存储结构：
```ts
{ entries: { [projectPath + '\u0000' + filePath]: EditorViewState & { updatedAt: number } } }
```
- `load`：JSON.parse 失败 → `null`；无条目 → `null`；返回去掉 `updatedAt` 的三字段。
- `save`：写入/覆盖；超过 200 条时按 `updatedAt` 升序删除最旧。
- `clear`：删除指定 key。
- 所有 localStorage 操作 try/catch（隐私模式/配额满）静默失败。

- [ ] **Step 4: 接入 CodeMirrorEditor**

在 `CodeMirrorEditor.tsx`：
1. 引入 `useProjectStore`（若尚未引入）和缓存模块。
2. `const projectPath = useProjectStore(s => s.currentProject?.path ?? '')`。
3. `saveViewStateRef`：一个 `useCallback`，从 `view.state.selection.main` 取 `anchor/head`，从 `view.scrollDOM.scrollTop` 取滚动；`if (!filePath || !projectPath) return`；写入缓存。
4. `onCreateEditor` 改为：
   ```tsx
   onCreateEditor={(view) => {
     setCmView(view)
     if (!filePath || !projectPath) return
     const saved = loadEditorViewState(projectPath, filePath)
     if (!saved) return
     requestAnimationFrame(() => {
       const clamped = clampEditorViewState(saved, view.state.doc.length, view.scrollDOM.scrollHeight)
       view.dispatch({ selection: { anchor: clamped.anchor, head: clamped.head } })
       requestAnimationFrame(() => {
         view.scrollDOM.scrollTop = clamped.scrollTop
       })
     })
   }}
   ```
5. `handleUpdate` 中，在现有逻辑后追加：`if (v.selectionSet || v.docChanged) scheduleSaveViewState(v)`。
6. 新增 `useEffect`（依赖 `cmView`）：给 `view.scrollDOM` 加 `scroll` 监听（`{ passive: true }`），回调 `scheduleSaveViewState(view)`；cleanup 时移除并 `saveViewStateRef(view)`。
7. `scheduleSaveViewState` 用 300ms `setTimeout` 去抖，`useRef` 保存 timer；组件卸载时 flush。
8. 不要在 `handleUpdate` 里直接写 localStorage（每个按键都写会卡）。

- [ ] **Step 5: 运行测试 + 类型检查 + lint**

Run: `pnpm exec vitest run src/services/editor-view-state.test.ts && pnpm run typecheck && pnpm run lint`
Expected: PASS。

- [ ] **Step 6: 真机验证**

在隔离实例中：
1. 打开一部长章节，滚到底部，记录 `scrollTop > 0`。
2. 切到章节蓝图 Tab，再切回章节 Tab。
3. 断言 `scrollTop` 与切走前一致（±2px），光标仍在原段落。
4. 修改正文使内容变短后重新打开，确认不抛 RangeError。

- [ ] **Step 7: 提交**

```bash
git add src/services/editor-view-state.ts src/services/editor-view-state.test.ts src/components/editor/CodeMirrorEditor.tsx
git commit -m "feat: 保留 Tab 滚动与光标位置"
```

---

### Task 7: 收尾验证

- [ ] **Step 1: 全量门禁**

```bash
pnpm run typecheck
pnpm run lint
pnpm exec vitest run src/services/blank-chapter-service.test.ts src/services/draft-tab.test.ts src/components/dialogs/BlankChapterDialog.test.tsx src/stores/editor-store.test.ts src/services/draft-version-refresh.test.ts src/services/editor-view-state.test.ts
```

Expected: 全部 PASS，tsc 0 错误，eslint 0 warning。

- [ ] **Step 2: 真机冒烟**

在隔离实例（端口 9223，项目 `/tmp/nf-smoke-project`）中：
1. 命令面板「新建空白章节」→ 输入章号/标题 → 创建并开始写。
2. 输入正文 → Ctrl+S → 关闭 Tab → 从草稿箱重新打开，内容仍在。
3. 对同一章启动 AI 审稿/自审产生 v2，确认干净的 Tab 自动切到 v2；脏 Tab 只提示。
4. 切换 Tab，确认滚动/光标恢复。
5. 再次执行「新建空白章节」选择同一章号，确认打开已有草稿而不是新建重复版本。

- [ ] **Step 3: 提交**

```bash
git add -A
git status --short
git commit -m "test: 写作核心闭环真机冒烟"
```

（如果 Step 2 没有代码改动，跳过这次提交。）

---

## 非目标（下一轮）

- 项目级全文搜索（跨草稿/正文/修订）。
- 阅读/预览模式（Markdown 渲染、导出前预览）。
- EPUB/DOCX/PDF 导出；GBK 等导入编码探测。
- 重启后恢复打开的 Tab（需要按项目重新加载每类 Tab 的内容，风险高于本轮收益）。
- 每日/每章写作目标体系。