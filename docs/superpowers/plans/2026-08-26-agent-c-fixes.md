# Agent C 群修复实施计划（hover 抖动 / 加粗 / 撤销 / 思考折叠 / 历史条数）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 对话与编辑器 UI 的 5 个问题（C1-C5），全部为独立 bounded 修复，不改数据模型。

**Architecture:** 纯渲染层/配置层修复：AgentConversation 列表项 hover 布局、CodeMirrorEditor 的 markdown 渲染与撤销栈、AgentMessage 思考块折叠 + ToolCallBlock 摘要、EmptyState 历史条数配置化。

**Tech Stack:** React 19 + Zustand + CodeMirror 6（@uiw/react-codemirror）+ Tailwind CSS 4 + vitest

**Spec:** `docs/superpowers/specs/2026-08-26-agent-conversation-upgrade-design.md` §3（阶段 C）

## Global Constraints

- ESLint strict（--max-warnings 0）、TypeScript strict（noUnusedLocals/Parameters）
- 所有用户可见文本走 `t()`（本项目无新增 i18n 键：C4 复用 `agent.thinkingPrefix`）
- 颜色一律 CSS 变量，禁止硬编码（`#ef4444` 类仅存量容错）
- 组件测试用 vitest + @testing-library/react（参照 `AgentConversation.test.tsx` 既有模式）
- 提交信息遵循 git-submission-standard：`fix:` 前缀、一个提交一件事、`-F` 消息文件

---

### Task 1: C3 撤销根因验证与修复（C 群第一项）

**Files:**
- Read: `node_modules/@uiw/react-codemirror` 的 useCodeMirror value 同步实现（确认 value prop 变化时 dispatch 是否进 undo 栈）
- Create: `src/components/editor/CodeMirrorEditor.test.tsx`
- Modify: `src/components/editor/CodeMirrorEditor.tsx`（外部内容同步路径）

**Interfaces:**
- Consumes: 无（本任务独立验证）
- Produces: 若根因确认——CodeMirrorEditor 外部 content 同步不再污染 undo 历史栈（后续 C2 任务在同一文件修改时不得回退该行为）

**背景（已验证的链路）**：`DraftEditor.tsx:375` 与 `ArchFileViewer.tsx:104` 的 onChange → `updateTabContent(filePath, text)`（editor-store.ts:118）→ store 更新 → content prop → CodeMirrorEditor `useEffect`（:69-82）`content !== lastEmittedContentRef.current` 时 `setEditorContent(content)`。正常输入回路被 `lastEmittedContentRef` 阻断（handleUpdate:133 已同步），**怀疑点**：切换文件/外部刷新时 content prop 真变化 → ReactCodeMirror 受控 value 同步 dispatch 进入 undo 栈 → 用户 Ctrl+Z 先撤销"整文替换"而非自身编辑。

- [ ] **Step 1: 阅读 ReactCodeMirror 的 value 同步实现**

  打开 `node_modules/@uiw/react-codemirror/esm/useCodeMirror.js`，定位 updateListener 中 value 同步逻辑（`docChanged && state.doc.toString() !== prevValue` 分支），确认其 dispatch 是否带 `addToHistory`。记录结论到任务注释。

- [ ] **Step 2: 写验证测试（模拟外部 content 变化后的 undo 行为）**

```tsx
// src/components/editor/CodeMirrorEditor.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import CodeMirrorEditor from './CodeMirrorEditor'

// CodeMirror 在 jsdom 需要这些 polyfill
beforeEach(() => {
  // ResizeObserver 缺失防护
  if (!('ResizeObserver' in globalThis)) {
    // @ts-expect-error 测试 polyfill
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
})

describe('CodeMirrorEditor 撤销行为', () => {
  it('外部 content 同步不应让撤销回到旧内容', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<CodeMirrorEditor content="旧内容" onChange={onChange} />)

    // 通过 textarea 输入模拟用户编辑（ReactCodeMirror 的 onChange 桥接）
    // 第一步：用户输入 "编辑一"（append）
    // 第二步：外部回写相同内容（模拟 updateTabContent 链路）
    rerender(<CodeMirrorEditor content="旧内容编辑一" onChange={onChange} />)
    // 第三步：用户再输入 "编辑二"
    // 第四步：按一次 Ctrl+Z
    // 期望：内容为 "旧内容编辑一"（撤销的是编辑二，而非外部回写）
    // 若测试失败且内容是 "旧内容"（或旧内容编辑一编辑二），根因确认
  })
})
```

  注：jsdom 中 CodeMirror 完整交互可能受限（无法精确模拟 dispatch）。若该测试无法在 jsdom 可靠执行（如内容变化不触发），改为**手动验证清单**（在 `pnpm run dev` 中执行并在任务注释记录结论）：
  1. 打开草稿 → 输入两段文字 → Ctrl+Z 一次 → 期望只撤销最后一段
  2. 打开草稿 → 输入 → 切到另一 Tab → 切回 → Ctrl+Z → 观察是否跳回旧内容（若跳回 → 根因确认）
  3. 打开架构文件（ArchFileViewer 路径）→ 编辑 → Ctrl+Z → 观察

- [ ] **Step 3: 运行测试确认失败（或手动验证确认根因）**

Run: `pnpm run test:watch src/components/editor/CodeMirrorEditor.test.tsx`
Expected: 撤销回到旧内容（根因成立）或测试通过（根因不在此——回到 systematic-debugging 重查，不硬套方案）。

- [ ] **Step 4: 根因成立则实现修复——外部同步改为手动 dispatch（不进历史）**

在 `CodeMirrorEditor.tsx` 的 useEffect（:69-82）中，把 `setEditorContent(content)` 改为手动 dispatch：

```tsx
useEffect(() => {
  if (!hasEmittedInitialCount.current) {
    onCharCountChange?.(countWords(content))
    hasEmittedInitialCount.current = true
  }

  if (content !== lastEmittedContentRef.current) {
    lastEmittedContentRef.current = content
    const view = editorRef.current?.view
    if (view) {
      // 外部内容同步（切文件/AI 刷新）：手动 dispatch 且不进 undo 历史栈，
      // 否则用户 Ctrl+Z 会先撤销"整文替换"而非自身编辑
      // 不带 selection：CodeMirror 自动 clamp 越界光标，保留原有受控同步的光标语义，
      // 避免强制 anchor:0 导致切文件后光标跳文件头（用户可感知回归）
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        addToHistory: false,
        scrollIntoView: true,
      })
    } else {
      setEditorContent(content)
    }
    onCharCountChange?.(countWords(content))
  }
}, [content, onCharCountChange])
```

  关键点：`editorContent` state 保持不变 → ReactCodeMirror 的 value prop 不变 → 不会再次 dispatch；手动 dispatch 触发的 handleUpdate 会把 `lastEmittedContentRef` 同步为相同内容，回路防护自然成立。

- [ ] **Step 5: 运行测试与既有编辑器相关测试**

Run: `pnpm run test src/components/editor/` + `pnpm run typecheck`
Expected: 全部通过。

- [ ] **Step 6: 手动回归（dev 环境按 Step 2 清单重复实验 1-3）**

Expected: 撤销只影响用户自身编辑；切换文件后 Ctrl+Z 不再跳回旧内容。

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/CodeMirrorEditor.tsx src/components/editor/CodeMirrorEditor.test.tsx
git commit -F - <<'EOF'
fix: 外部 content 同步不进 undo 栈（切文件后撤销不再跳回旧内容）
EOF
```

---

### Task 2: C1 历史项 hover 抖动

**Files:**
- Modify: `src/components/panels/agent/AgentConversation.tsx`（RecentConversationItem，:400-454）
- Test: `src/components/panels/agent/AgentConversation.test.tsx`（追加用例）

**Interfaces:**
- Consumes: 无
- Produces: RecentConversationItem 右侧区域行为变更（EmptyState 与 AgentHistoryPanel 共用，两处同时受益）

**根因**：`:439` `hidden group-hover:flex` 删除按钮与 `:446` `group-hover:hidden` 时间文本做 display 切换，两者宽度不同（时间文本可变 vs 24px 按钮）→ hover 时布局跳动。

- [ ] **Step 1: 写失败测试（断言右侧区域结构固定、无 display 切换）**

```tsx
// AgentConversation.test.tsx 追加
describe('RecentConversationItem hover 行为', () => {
  it('右侧区域为固定宽度容器且时间/删除按钮无 hidden 切换类', () => {
    // 渲染空状态视图（含 RecentConversationItem）
    // 断言 1：删除按钮元素不含 'hidden' 类（当前实现含 'hidden group-hover:flex'）
    // 断言 2：时间元素不含 'group-hover:hidden' 类（当前实现含）
    // 断言 3：删除按钮的祖先容器有固定宽度 style（style.width 为数值/字符串，
    //         当前实现无固定宽度——修复前此断言失败，防假绿）
  })
})
```

  ⚠️ 注意：jsdom 不做 CSS 布局计算，`hidden` 类本身不隐藏元素——**必须断言类名/结构而非可见性**，否则测试假绿（当前实现也能通过"按钮存在"断言）。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm run test:watch src/components/panels/agent/AgentConversation.test.tsx`
Expected: 断言 3 失败（当前实现无固定宽度容器）——证明测试能区分新旧实现。

- [ ] **Step 3: 实现修复——右侧固定宽度容器 + 绝对定位 + opacity 过渡**

替换 RecentConversationItem 的右侧区块（:432-451）：

```tsx
{/* 右侧：固定宽度容器，时间与删除按钮绝对定位重叠，hover 时 opacity 过渡（零布局跳动） */}
<div className="flex-shrink-0 ml-2 relative" style={{ width: 72, height: 16 }}>
  <span
    className="absolute right-0 top-0 text-[0.7rem] whitespace-nowrap transition-opacity duration-150 group-hover:opacity-0"
    style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}
  >
    {formatRelativeTime(updatedAt)}
  </span>
  <button
    onClick={e => {
      e.stopPropagation()
      onDelete()
    }}
    className="absolute right-0 top-0 flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150"
    style={{ color: 'var(--color-text-secondary)' }}
    title={t('agent.deleteConversation')}
  >
    <Trash2 size={12} />
  </button>
</div>
```

  宽度 72px 依据：`formatRelativeTime` 最长形态（zh「N 天前」/日期「8月26日」@ 0.7rem ≈ 60px，en 更短），72px 留安全余量；两元素始终渲染（仅 opacity 变化），DOM 结构稳定。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm run test src/components/panels/agent/AgentConversation.test.tsx`
Expected: PASS。

- [ ] **Step 5: 手动验证（dev 环境）**

Expected: 鼠标在历史列表项上来回移动，右侧时间淡出/删除按钮淡入，整行无位移跳动；历史面板与空状态两处均生效。

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/agent/AgentConversation.tsx src/components/panels/agent/AgentConversation.test.tsx
git commit -F - <<'EOF'
fix: 历史列表项 hover 零布局跳动（固定宽度容器 + opacity 过渡替代 display 切换）
EOF
```

---

### Task 3: C2 加粗即见粗体（prose 模式 markdown 渲染）

**Files:**
- Modify: `src/components/editor/CodeMirrorEditor.tsx`（extensions :261-310、cmTheme :231-258、加粗按钮 :597-616）
- Test: `src/components/editor/CodeMirrorEditor.test.tsx`（Task 1 已建文件，追加用例）

**Interfaces:**
- Consumes: Task 1 的外部同步修复（同一文件，不得回退）
- Produces: prose 模式具备 markdown 高亮（`**文字**` 显示为粗体）+ 加粗按钮可用

**根因**：`markdown()` 扩展仅 `mode === 'document'` 添加（:306-308）；加粗按钮仅 document 显示（:597）；DraftEditor/EditorArea 均用 prose → 插入的 `**` 无高亮渲染。

- [ ] **Step 1: 写失败测试（prose 模式有加粗按钮、点击后输出 `**包裹**`）**

```tsx
// CodeMirrorEditor.test.tsx 追加
describe('CodeMirrorEditor 加粗（prose 模式）', () => {
  it('prose 模式显示加粗按钮且点击后包裹选中文本', async () => {
    const onChange = vi.fn()
    render(<CodeMirrorEditor mode="prose" content="力王虎父子冲" onChange={onChange} />)
    // 选中文本（通过 view.dispatch 设置选区）
    // 点击加粗按钮（Bold 图标 button）
    // 断言 onChange 收到包含 '**力王虎父子冲**' 的内容
  })
})
```

  若 jsdom 选区/按钮点击链路不可行，降级断言：prose 模式渲染后加粗按钮存在（`screen.getByTitle('Bold')` 或按 aria/title 定位），document 模式同样存在。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm run test:watch src/components/editor/CodeMirrorEditor.test.tsx`
Expected: prose 模式找不到加粗按钮（FAIL）。

- [ ] **Step 3: 实现修复（三处）**

a) extensions 条件（:306）：

```tsx
if (mode === 'document' || mode === 'prose') {
  exts.push(markdown({ base: markdownLanguage, codeLanguages: languages }))
}
```

b) cmTheme 增加 strong/em 显式样式（:257 之后）：

```ts
".cm-strong": { fontWeight: "bold" },
".cm-em": { fontStyle: "italic" },
```

c) 加粗按钮条件（:597）：

```tsx
{(mode === 'document' || mode === 'prose') && (
```

- [ ] **Step 4: 运行测试确认通过 + typecheck**

Run: `pnpm run test src/components/editor/CodeMirrorEditor.test.tsx && pnpm run typecheck`
Expected: PASS。

- [ ] **Step 5: 手动验证（dev 环境）**

1. 打开草稿 → 选中文字 → 点加粗 → 文字以粗体视觉显示（`**` 标记存在但渲染为粗体）
2. 中文正文/大文档滚动流畅、搜索面板正常
3. 检查编辑 Tab 中文段落无异常高亮闪烁

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/CodeMirrorEditor.tsx src/components/editor/CodeMirrorEditor.test.tsx
git commit -F - <<'EOF'
feat: 写作模式（prose）加粗即见粗体（启用 markdown 高亮 + strong 样式 + 加粗按钮双模式）
EOF
```

---

### Task 4: C4 对话思考折叠 + 工具/文件摘要

**Files:**
- Create: `src/components/panels/agent/ThinkingCollapse.tsx`
- Modify: `src/components/panels/agent/AgentMessage.tsx`（思考块拆分渲染）
- Modify: `src/components/panels/agent/ToolCallBlock.tsx`（头部 📄 摘要）
- Test: `src/components/panels/agent/AgentMessage.test.tsx`（新建）

**Interfaces:**
- Produces: `ThinkingCollapse({ thinking })` 组件（默认折叠，头部「思考过程」+ 展开按钮）；AgentMessage 对思考块的解析函数 `splitThinking(content)`
- Consumes: 无

**背景**：agent-engine.ts:205-206 拼 `_${t('agent.thinkingPrefix')}_\n> ${thinking}\n\n${cleanedOutput}`；thinkingContent 为空时不拼思考块。

- [ ] **Step 1: 写失败测试（思考块折叠渲染 + ToolCallBlock 文件摘要）**

```tsx
// src/components/panels/agent/AgentMessage.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AgentMessage from './AgentMessage'
import ToolCallBlock from './ToolCallBlock'

describe('AgentMessage 思考折叠', () => {
  it('含思考块的助手消息渲染为折叠头部（不展开思考内容）', () => {
    const msg = {
      id: '1',
      role: 'assistant' as const,
      content: '_思考过程_\n> 先构思情节走向\n\n正式正文内容',
      createdAt: 0,
    }
    render(<AgentMessage message={msg} />)
    // 断言：折叠头部存在（「思考过程」文本）
    // 断言：思考正文「先构思情节走向」默认不可见
    // 断言：正文「正式正文内容」可见
  })

  it('无思考块的普通内容不受影响', () => {
    // content 无思考前缀 → 原样渲染
  })
})

describe('ToolCallBlock 文件摘要', () => {
  it('read_file 调用显示 📄 文件名摘要', () => {
    const tc = { id: '1', toolName: 'read_file', arguments: { file_path: 'C:\\proj\\note.md' }, status: 'completed' as const }
    render(<ToolCallBlock toolCall={tc as never} />)
    expect(screen.getByText(/note\.md/)).toBeTruthy()
  })

  it('无路径参数的工具不显示文件摘要', () => {
    const tc = { id: '2', toolName: 'calculator', arguments: { expression: '1+1' }, status: 'completed' as const }
    render(<ToolCallBlock toolCall={tc as never} />)
    expect(screen.queryByText(/📄/)).toBeNull()
  })

  it('read_drafts 调用显示 📖 章节摘要（chapter_number 参数）', () => {
    const tc = { id: '3', toolName: 'read_drafts', arguments: { chapter_number: 3 }, status: 'completed' as const }
    render(<ToolCallBlock toolCall={tc as never} />)
    // chapter.label 三语：zh「第3章」/ en「Ch.3」/ ru「Гл.3」
    expect(screen.getByText(/第3章|Ch\.3|Гл\.3/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm run test:watch src/components/panels/agent/AgentMessage.test.tsx`
Expected: FAIL（思考内容平铺可见；无文件摘要）。

- [ ] **Step 3: 创建 ThinkingCollapse 组件**

```tsx
// src/components/panels/agent/ThinkingCollapse.tsx
import { useState } from 'react'
import { ChevronRight, Brain } from 'lucide-react'
import { useTranslation } from '../../../hooks/useTranslation'

interface Props {
  thinking: string  // 思考块原文（含 `_思考过程_\n> ...` 前缀）
}

export default function ThinkingCollapse({ thinking }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)  // 默认折叠（与 AIOutputPanel ThinkingBlock 语义一致）
  return (
    <div className="mb-1.5 rounded-md border" style={{ borderColor: 'var(--color-border)' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs w-full text-left transition-colors"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <Brain size={11} style={{ color: 'var(--color-accent)' }} />
        <span className="font-medium">{t('agent.thinkingPrefix')}</span>
        <span className="flex-1" />
        <ChevronRight size={11} className={expanded ? 'rotate-90' : ''} style={{ transition: 'transform 0.15s' }} />
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {thinking}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: AgentMessage 拆思考块**

```tsx
// AgentMessage.tsx 内新增
/** 拆分思考块：匹配 `_思考过程_\n> ...` 前缀，容错（不匹配按普通 markdown） */
function splitThinking(content: string): { thinking: string | null; rest: string } {
  const m = content.match(/^_[^_\n]+_\n>[\s\S]*?(?=\n\n)/)
  if (!m) return { thinking: null, rest: content }
  return { thinking: m[0], rest: content.slice(m[0].length + 2) }
}
```

渲染处（:48-54）替换为：

```tsx
{content ? (() => {
  const { thinking, rest } = splitThinking(content)
  return (
    <>
      {thinking && <ThinkingCollapse thinking={thinking} />}
      {rest && <MarkdownContent content={rest} streaming={streaming} />}
    </>
  )
})() : streaming ? (
  <span className="inline-flex items-center h-4"><StreamingCursor /></span>
) : null}
```

- [ ] **Step 5: ToolCallBlock 头部 📄 文件摘要**

```tsx
// ToolCallBlock.tsx 内新增辅助（t 取自组件内 useTranslation()，i18n 铁律：用户可见文本不走硬编码）
/** 从工具参数提取文件/对象摘要（read_file/read-drafts 等） */
function fileSummary(toolName: string, args: Record<string, unknown>, t: (key: TextKey) => string): string | null {
  const path = typeof args.file_path === 'string' ? args.file_path
    : typeof args.path === 'string' ? args.path
    : null
  if (path) {
    const base = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
    return `📄 ${base}`
  }
  // ⚠️ 验证点：read_drafts 实际参数名是 chapter_number（read-drafts.tool.ts:17），
  // 实现时确认无其他章节参数形态（如章节对象）后按实际补充分支
  if (typeof args.chapter_number === 'number') {
    return `📖 ${t('chapter.label').replace('{n}', String(args.chapter_number))}`
  }
  if (typeof args.name === 'string' && ['read_characters', 'update_character_cards'].includes(toolName)) {
    return `👤 ${args.name}`
  }
  return null
}
```

头部 `tool-call-name` 后追加（:69-75 之间）：

```tsx
{(() => {
  const summary = fileSummary(toolName, args, t)
  return summary ? (
    <span className="tool-call-file-summary text-[0.65rem] opacity-60 ml-1 truncate max-w-[160px]"
      style={{ color: 'var(--color-text-muted)' }}>
      {summary}
    </span>
  ) : null
})()}
```

- [ ] **Step 6: 运行测试确认通过 + typecheck + lint**

Run: `pnpm run test src/components/panels/agent/ && pnpm run typecheck && pnpm run lint`
Expected: 全部通过。

- [ ] **Step 7: 手动验证（dev 环境）**

1. 与 agent 对话触发一次带思考的回复（deep/max 模式）→ 思考默认折叠、点击展开
2. 触发 read_file/read-drafts 工具 → 头部显示 📄/📖 摘要
3. 旧归档会话（思考块已在 content 内）打开 → 折叠生效

- [ ] **Step 8: Commit**

```bash
git add src/components/panels/agent/ThinkingCollapse.tsx src/components/panels/agent/AgentMessage.tsx src/components/panels/agent/ToolCallBlock.tsx src/components/panels/agent/AgentMessage.test.tsx
git commit -F - <<'EOF'
feat: 对话思考块默认折叠（渲染层解析，存储不动）+ 工具调用文件摘要
EOF
```

---

### Task 5: C5 历史条数可配置

**Files:**
- Modify: `src/shared/ipc-channels.ts`（GlobalConfig 类型）
- Modify: `electron/utils/config-utils.ts`（DEFAULT_GLOBAL_CONFIG）
- Modify: `src/components/panels/agent/AgentConversation.tsx`（EmptyState，:52-54）
- Test: `src/components/panels/agent/AgentConversation.test.tsx`（追加用例）

**Interfaces:**
- Consumes: `ipc.invoke('config:get')`（config-controller.ts:44，返回 GlobalConfig）
- Produces: GlobalConfig 新增 `recentConversationCount: number`（默认 3）

**背景**：EmptyState `slice(0, 3)` 硬编码（:52-54）；渲染层读配置模式参照 `useAutoSave.ts:31`（try/catch 静默降级）。

- [ ] **Step 1: 写失败测试（mock config:get 返回值影响条数）**

```tsx
// AgentConversation.test.tsx 追加
describe('EmptyState 历史条数配置', () => {
  it('按 config recentConversationCount 显示条数（mock 5 → 显示 5 条）', async () => {
    vi.spyOn(ipc, 'invoke').mockResolvedValueOnce({ recentConversationCount: 5 })
    // 构造 6 条会话的 store 状态
    // 渲染空状态
    // 断言：5 条最近会话可见 + 「加载更多」出现
  })

  it('config 读取失败/无配置时默认 3 条', async () => {
    vi.spyOn(ipc, 'invoke').mockRejectedValueOnce(new Error('no config'))
    // 断言：3 条
  })
})
```

  注：需要 import `ipc`（`src/services/ipc-client`）并 mock；store 状态构造参照既有测试的 `useAgentStore.setState(...)` 模式。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm run test:watch src/components/panels/agent/AgentConversation.test.tsx`
Expected: FAIL（当前忽略 config，恒 3 条）。

- [ ] **Step 3: 类型与默认值**

`src/shared/ipc-channels.ts` GlobalConfig 追加：

```ts
/** Agent 空状态显示的最近会话条数（默认 3） */
recentConversationCount?: number
```

`electron/utils/config-utils.ts` DEFAULT_GLOBAL_CONFIG 追加（:60 附近）：

```ts
recentConversationCount: 3,
```

- [ ] **Step 4: EmptyState 读取配置**

```tsx
// EmptyState 内
const [recentCount, setRecentCount] = useState(3)
useEffect(() => {
  let cancelled = false
  ipc.invoke('config:get')
    .then((cfg: { recentConversationCount?: number } | null) => {
      if (!cancelled && typeof cfg?.recentConversationCount === 'number' && cfg.recentConversationCount > 0) {
        setRecentCount(cfg.recentConversationCount)
      }
    })
    .catch(() => { /* 读取失败保持默认 3 */ })
  return () => { cancelled = true }
}, [])
```

`recentConvs`（:52-54）改为：

```tsx
const recentConvs = conversations
  .filter(c => c && c.messages.length > 0)
  .slice(0, recentCount)
```

「加载更多」显示条件（:102）`> 3` 改为 `> recentCount`。

- [ ] **Step 5: 运行测试确认通过 + typecheck + lint**

Run: `pnpm run test src/components/panels/agent/AgentConversation.test.tsx && pnpm run typecheck && pnpm run lint`
Expected: 全部通过。

- [ ] **Step 6: 手动验证（dev 环境）**

1. 编辑 `~/.vela/config.json` 加 `"recentConversationCount": 5` → 空状态显示 5 条
2. 删除该字段 → 恢复 3 条
3. 无项目场景（打开应用无项目）→ 默认 3 条不报错

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc-channels.ts electron/utils/config-utils.ts src/components/panels/agent/AgentConversation.tsx src/components/panels/agent/AgentConversation.test.tsx
git commit -F - <<'EOF'
feat: 历史会话显示条数可配置（全局 config.json recentConversationCount，默认 3）
EOF
```

---

## Self-Review 记录

**Spec 覆盖**：§3 C1→Task 2、C2→Task 3、C3→Task 1、C4→Task 4、C5→Task 5，全部覆盖；§8 D3（config.json 位置）在 Task 5、D6（渲染层解析思考）在 Task 4。

**占位符扫描**：无 TBD/TODO；两处 jsdom 降级路径（Task 1 Step 2、Task 3 Step 1）均为显式替代方案而非占位。

**类型一致性**：`recentConversationCount` 在 Task 5 三处使用一致；`splitThinking`/`fileSummary` 各任务内定义即用；ThinkingCollapse props 与使用处一致。
