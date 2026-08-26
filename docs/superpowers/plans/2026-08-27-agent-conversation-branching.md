# Agent 对话分支实施计划（fork + rewind，阶段 B）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对话支持 fork（从任意消息派生新会话，原路径保留）与 rewind（回退到某消息重写，被截断内容归档可恢复），历史面板显示 fork 层级。

**Architecture:** 数据层（agent-store 扩展 `parentId`/`forkMessageId`/`rewound` 字段 + 3 个 action）+ UI 层（AgentMessage hover 分支/回退按钮 + AgentHistoryPanel fork 缩进标注）。archive-codec 全量 stringify/展开式 parse 自动透传新字段（无需改动）。

**Tech Stack:** TypeScript + Zustand + Tailwind CSS 4 + vitest

**Spec:** `docs/superpowers/specs/2026-08-26-agent-conversation-upgrade-design.md` §5

## Global Constraints

- ESLint strict（--max-warnings 0）、TypeScript strict（noUnusedLocals/Parameters）
- 所有用户可见文本走 `t()`——新增键集中在 `agent.*`，三语（zh-CN/en-US/ru-RU）
- 提交规范：`feat:` 前缀、一个提交一件事、`git commit -F - <<'EOF'` 消息文件
- v1 边界（已裁决 D2）：**所有可见消息均可 fork/rewind**——CCR 压缩时旧消息已移出 messages（agent-store.ts:543-549），messages 中不存在 compressed.original 内的消息，无需禁用态判定
- 测试用 vitest，无 @testing-library/react——用 createRoot + act 模式（参照 AgentMessage.test.tsx）；agent-store 测试 mock 用 window.velaAPI.invoke 通道路由（既有模式）
- **UI 改动遵循 C1 教训：hover 显隐用 opacity 过渡 + 固定容器，禁止 display 切换导致布局跳动**

---

### Task B1: 数据模型 + store actions

**Files:**
- Modify: `src/stores/agent-store.ts`（AgentConversation 类型 + 接口 + 3 个 action 实现）
- Test: `src/stores/agent-store.test.ts`（追加 describe）

**Interfaces:**
- Produces:
  - `AgentConversation` 新增 `parentId?: string`、`forkMessageId?: string`、`rewound?: RewoundBranch[]`
  - `RewoundBranch = { messageId: string; messages: AgentMessage[]; rewoundAt: number }`
  - `forkFromMessage(messageId: string): string | null`（返回新会话 id）
  - `rewindToMessage(messageId: string): boolean`
  - `restoreRewound(entryIndex: number): boolean`
- Consumes: 现有 `genId` / `persistCurrent` / `set` / `get`

- [ ] **Step 1: 写失败测试**

```ts
// agent-store.test.ts 追加 describe
describe('对话分支 fork/rewind', () => {
  // 构造：会话 A 有 messages [u1, a1, u2, a2]（含 system 消息需过滤——参照现有过滤模式）

  it('forkFromMessage：复制到起点（含）的历史，新会话独立 id + parentId/forkMessageId 标记', () => {
    const newId = useAgentStore.getState().forkFromMessage('u2')
    const forked = useAgentStore.getState().conversations.find(c => c.id === newId)!
    expect(forked.parentId).toBe(convId)
    expect(forked.forkMessageId).toBe('u2')
    expect(forked.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2'])  // 不含 u2 之后
    expect(forked.id).not.toBe(convId)
    expect(useAgentStore.getState().activeConversationId).toBe(newId)
  })

  it('fork 复制 compressed/rollingSummary/mode/roleplay，rewound 不复制', () => {
    // 原会话带 compressed/rollingSummary/roleplayCharacter/rewound
    // 断言 forked 继承前三者、rewound 为 undefined
  })

  it('rewindToMessage：截断到起点（含），被截断消息入 rewound 归档', () => {
    const ok = useAgentStore.getState().rewindToMessage('a1')
    expect(ok).toBe(true)
    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.messages.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(conv.rewound?.length).toBe(1)
    expect(conv.rewound![0].messages.map(m => m.id)).toEqual(['u2', 'a2'])
  })

  it('restoreRewound：归档 append 回 messages（rewind 可逆）', () => {
    useAgentStore.getState().rewindToMessage('a1')
    const ok = useAgentStore.getState().restoreRewound(0)
    expect(ok).toBe(true)
    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(conv.rewound?.length).toBe(0)  // 恢复后归档清空
  })

  it('无效 messageId：fork/rewind 返回 null/false 不改变状态', () => {
    expect(useAgentStore.getState().forkFromMessage('not-exist')).toBeNull()
    expect(useAgentStore.getState().rewindToMessage('not-exist')).toBe(false)
  })

  it('archive 透传：serialize→parse 后 parentId/rewound 保留', () => {
    // fork 后 serializeArchive(新会话) → parseArchive → parentId/forkMessageId 存在
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch src/stores/agent-store.test.ts`
Expected: FAIL（类型/action 不存在）。

- [ ] **Step 3: 类型扩展**

```ts
/** fork/rewind 分支：rewind 归档（可恢复） */
export interface RewoundBranch {
  messageId: string
  messages: AgentMessage[]
  rewoundAt: number
}

export interface AgentConversation {
  // ...现有字段
  /** fork 自哪个会话（无此字段为根会话） */
  parentId?: string
  /** fork 起点消息 id（该消息及之前的历史已复制进新会话） */
  forkMessageId?: string
  /** rewind 归档：被截断消息，可 restoreRewound 恢复 */
  rewound?: RewoundBranch[]
}
```

- [ ] **Step 4: 实现 3 个 action**

```ts
// store 接口新增：
forkFromMessage: (messageId: string) => string | null
rewindToMessage: (messageId: string) => boolean
restoreRewound: (entryIndex: number) => boolean

// 实现：
forkFromMessage: (messageId) => {
  const conv = get().getActiveConversation()
  if (!conv) return null
  const idx = conv.messages.findIndex(m => m.id === messageId)
  if (idx < 0) return null
  // 复制到起点（含）——system 消息按主流程规则过滤（messages 中 role!=='system' 的保留）
  const forkMsgs = conv.messages.slice(0, idx + 1).map(m => ({ ...m }))
  const newConv: AgentConversation = {
    ...conv,
    id: genId(),
    title: `${conv.title}${t('agent.forkSuffix')}`,
    messages: forkMsgs,
    parentId: conv.id,
    forkMessageId: messageId,
    // rewound 不复制（新会话无归档）
    rewound: undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  set(s => ({
    conversations: [...s.conversations, newConv],
    activeConversationId: newConv.id,
  }))
  get().persistCurrent(newConv.id)
  return newConv.id
},

rewindToMessage: (messageId) => {
  const conv = get().getActiveConversation()
  if (!conv) return false
  const idx = conv.messages.findIndex(m => m.id === messageId)
  if (idx < 0) return false
  const truncated = conv.messages.slice(idx + 1)
  const entry: RewoundBranch = { messageId, messages: truncated, rewoundAt: Date.now() }
  set(s => ({
    conversations: s.conversations.map(c =>
      c.id === conv.id
        ? { ...c, messages: c.messages.slice(0, idx + 1), rewound: [...(c.rewound ?? []), entry] }
        : c
    ),
  }))
  get().persistCurrent(conv.id)
  return true
},

restoreRewound: (entryIndex) => {
  const conv = get().getActiveConversation()
  if (!conv || !conv.rewound || entryIndex < 0 || entryIndex >= conv.rewound.length) return false
  const entry = conv.rewound[entryIndex]
  set(s => ({
    conversations: s.conversations.map(c =>
      c.id === conv.id
        ? { ...c, messages: [...c.messages, ...entry.messages], rewound: c.rewound?.filter((_, i) => i !== entryIndex) }
        : c
    ),
  }))
  get().persistCurrent(conv.id)
  return true
},
```

  说明：fork 的 `persistCurrent` 会走 serializeArchive 全量 stringify——新字段自动落盘；旧归档 parse 展开式无新字段则 undefined，兼容。

- [ ] **Step 5: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿（新增 6 用例）。

- [ ] **Step 6: Commit**

```bash
git add src/stores/agent-store.ts src/stores/agent-store.test.ts
git commit -F - <<'EOF'
feat: 对话分支数据层（forkFromMessage/rewindToMessage/restoreRewound + parentId/rewound 字段）
EOF
```

---

### Task B2: AgentMessage hover 分支/回退入口 + AgentConversation 接线

**Files:**
- Modify: `src/components/panels/agent/AgentMessage.tsx`（新增可选的 onFork/onRewind props + hover 按钮）
- Modify: `src/components/panels/agent/AgentConversation.tsx`（ActiveConversation 传回调 + 确认弹窗）
- Test: `src/components/panels/agent/AgentMessage.test.tsx`（追加用例）

**Interfaces:**
- Consumes: `forkFromMessage` / `rewindToMessage`（B1）；`confirm`（ui/Confirm，已用于 AgentHeader）
- Produces: AgentMessage 新增 props `onFork?: (messageId: string) => void`、`onRewind?: (messageId: string) => void`

**UI 设计**（遵循 C1 教训：hover 用 opacity 过渡 + 固定容器，零布局跳动）：
- 助手消息与用户消息右下角各一个「操作区」（固定宽度 48px 容器）：默认 opacity-0，group-hover 淡入两个小图标按钮（ForkRight = 从此分支 / Undo2 = 回退到此处）
- 按钮点击 → 回调 → ActiveConversation 层调 store action；rewind 前弹 confirm 确认

- [ ] **Step 1: 写失败测试**

```tsx
// AgentMessage.test.tsx 追加
describe('AgentMessage 分支操作', () => {
  it('hover 操作区默认不可见（opacity-0 + 无 display 切换），提供 onFork/onRewind 回调时渲染按钮', () => {
    const onFork = vi.fn(), onRewind = vi.fn()
    const msg = { id: 'm1', role: 'assistant' as const, content: '正文', createdAt: 0 }
    const { container } = renderAgentMessage(msg, { onFork, onRewind })
    // 断言：操作区容器存在且 class 含 opacity-0 group-hover:opacity-100（无 hidden）
    // 断言：两个按钮 title 存在（t('agent.forkConversation') / t('agent.rewindToHere')）
  })

  it('点击 fork 按钮回调携带 messageId', () => {
    const onFork = vi.fn()
    // 渲染 + 点击 ForkRight 按钮
    expect(onFork).toHaveBeenCalledWith('m1')
  })

  it('无 onFork/onRewind props 时不渲染操作区', () => {
    // 断言：无操作区（旧渲染行为兼容——只读历史/归档视图不显示操作）
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch src/components/panels/agent/AgentMessage.test.tsx`
Expected: FAIL（无操作区）。

- [ ] **Step 3: AgentMessage 操作区实现**

```tsx
import { ForkRight, Undo2 } from 'lucide-react'

interface Props {
  message: AgentMessageType
  /** 从此消息 fork 新分支（v1：所有可见消息均可——CCR 压缩区无 UI 入口，无需禁用态） */
  onFork?: (messageId: string) => void
  /** 回退到该消息（截断后续，可恢复） */
  onRewind?: (messageId: string) => void
}
```

用户消息气泡内追加（消息容器加 `group` 类）：

```tsx
{onFork || onRewind ? (
  <div className="flex items-center gap-0.5 mr-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
    {onFork && (
      <button
        onClick={() => onFork(message.id)}
        className="p-1 rounded hover:opacity-80"
        style={{ color: 'var(--color-text-muted)' }}
        title={t('agent.forkConversation')}
      >
        <ForkRight size={12} />
      </button>
    )}
    {onRewind && (
      <button
        onClick={() => onRewind(message.id)}
        className="p-1 rounded hover:opacity-80"
        style={{ color: 'var(--color-text-muted)' }}
        title={t('agent.rewindToHere')}
      >
        <Undo2 size={12} />
      </button>
    )}
  </div>
) : null}
```

  助手消息：操作区放消息左下角（MarkdownContent 之后、toolCalls 之前）；用户消息：放气泡右下角。
  ⚠️ 操作区是「行内 flex」而非绝对定位——消息区是 `flex-col`，行内追加不会引起整行位移（按钮 hover 时仅自身透明度变化，无尺寸变化，满足零跳动）。

- [ ] **Step 4: AgentConversation 接线**

```tsx
// ActiveConversation 中渲染 AgentMessage 处：
<AgentMessage
  key={msg.id}
  message={msg}
  onFork={handleFork}
  onRewind={handleRewind}
/>

const handleFork = (messageId: string) => {
  useAgentStore.getState().forkFromMessage(messageId)
  // 自动滚动到新会话底部
  requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
}

const handleRewind = async (messageId: string) => {
  const ok = await confirm(t('agent.confirmRewind'), {
    title: t('agent.confirmRewindTitle'),
    confirmText: t('dialog.confirmRewind'),
    danger: true,
  })
  if (ok) useAgentStore.getState().rewindToMessage(messageId)
}
```

  注意：fork 后 activeConversationId 变化 → ActiveConversation 自动切换；滚动处理在切换后 effect 中（现有 scroll effect 依赖 messages 变化）。

- [ ] **Step 5: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/agent/AgentMessage.tsx src/components/panels/agent/AgentConversation.tsx src/components/panels/agent/AgentMessage.test.tsx
git commit -F - <<'EOF'
feat: 对话消息 hover 分支/回退入口（fork 直接派生、rewind 确认后截断）
EOF
```

---

### Task B3: 历史面板 fork 层级展示

**Files:**
- Modify: `src/components/panels/agent/AgentConversation.tsx`（AgentHistoryPanel 与 RecentConversationItem）
- Test: `src/components/panels/agent/AgentConversation.test.tsx`（追加用例）

**Interfaces:**
- Consumes: `parentId` / 父会话 title（B1 数据）
- Produces: 历史列表 fork 子会话缩进 + ForkRight 图标 + 「来自『父标题』」小字

- [ ] **Step 1: 写失败测试**

```tsx
// AgentConversation.test.tsx 追加 describe
describe('AgentHistoryPanel fork 层级', () => {
  it('fork 子会话缩进显示 + ForkRight 图标 + 父会话标注', () => {
    // 构造 store：根会话 R + fork 子会话 C（parentId=R, forkMessageId='m1'）
    // 渲染历史面板
    // 断言：C 的列表项含 ForkRight 图标与「来自『{R.title}』」文本
  })

  it('根会话无标注', () => {
    // 断言：R 的列表项无 ForkRight 图标
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch src/components/panels/agent/AgentConversation.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

```tsx
// AgentHistoryPanel 中：构建 title 查找表 + 传入父标题
const titleById = useMemo(() => {
  const m = new Map<string, string>()
  for (const c of sorted) m.set(c.id, c.title)
  return m
}, [sorted])

// RecentConversationItem 新增 props：
//   parentTitle?: string（有值 = fork 子会话）

// 列表项渲染（标题行内）：
{parentTitle && (
  <div className="flex items-center gap-1 min-w-0">
    <ForkRight size={10} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
    <span className="text-[0.68rem] truncate" style={{ color: 'var(--color-text-muted)' }}>
      {t('agent.forkedFrom').replace('{title}', parentTitle)}
    </span>
  </div>
)}
// 外层行：有 parentTitle 时 pl-5（缩进）——固定缩进，无布局跳动
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/agent/AgentConversation.tsx src/components/panels/agent/AgentConversation.test.tsx
git commit -F - <<'EOF'
feat: 历史面板 fork 层级展示（缩进 + 分支图标 + 父会话标注）
EOF
```

---

### Task B4: i18n 键 + 收尾

**Files:**
- Modify: `src/shared/locale-data.ts`（三语键）

**Interfaces:**
- Consumes: B2/B3 引用的全部 `agent.*` 键

- [ ] **Step 1: 核查并新增 i18n 键**

| 键 | zh-CN | en-US | ru-RU |
|---|---|---|---|
| `agent.forkConversation` | 从此处分支 | Fork from here | Ветвить отсюда |
| `agent.rewindToHere` | 回退到此处 | Rewind to here | Откатить до сюда |
| `agent.forkSuffix` | （分支） | (fork) | (ветка) |
| `agent.confirmRewind` | 将截断此消息之后的全部对话（可恢复），确定？ | This will truncate the conversation after this message (recoverable). Continue? | Диалог после этого сообщения будет обрезан (восстановимо). Продолжить? |
| `agent.confirmRewindTitle` | 回退确认 | Confirm rewind | Подтверждение отката |
| `agent.forkedFrom` | 来自「{title}」 | from "{title}" | из "{title}" |
| `dialog.confirmRewind` | 回退 | Rewind | Откатить |

- [ ] **Step 2: i18n 残留扫描 + 全量回归 + Commit**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`（+ i18n 残留扫描）
Expected: 全绿。

```bash
git add src/shared/locale-data.ts
git commit -F - <<'EOF'
feat: 对话分支 i18n 键（三语：fork/rewind 操作与确认）
EOF
```

---

## Self-Review 记录

**Spec 覆盖**：§5.1 数据模型（parentId/forkMessageId/rewound + 类型透传）→ B1/B4；§5.2 v1 边界（所有可见消息均可，无禁用态）→ B2 注释明确；§5.3 行为（fork 复制完整 + rewound 不复制、rewind 截断归档、恢复 append）→ B1 测试逐项断言；§5.4 UI（消息按钮 + 历史面板降级方案）→ B2/B3；§7 风险（archive 透传天然兼容）→ B1 Step 1 透传测试。D2（v1 限制）→ B2；D5（降级树视图）→ B3。

**占位符扫描**：无 TBD；「实现时确认 parseMentions 调用点」类表述不存在（B 计划无此依赖）；B2 操作区位置（用户消息右下/助手消息左下）为明确设计。

**类型一致性**：`RewoundBranch` 在 B1 定义、B2/B3 不直接引用（仅 store action）；`AgentMessage` props 新增 onFork/onRewind 在 B2 定义、B2 使用一致；`forkFromMessage` 返回 `string | null` 在 B1/B2 一致。

**与 C 群衔接**：AgentMessage.tsx 与 AgentConversation.tsx 已被 C1/C4 修改（hover 固定容器模式、思考折叠）——B2 的 hover 操作区沿用 C1 的 opacity 过渡模式（不破坏），splitThinking 渲染路径不受影响（操作区在消息外层）。
