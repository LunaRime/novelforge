# UI 重构批 0（侧栏样板）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「项目结构」侧边栏做成新形态样板：菜单行片化（32px 高 / 10px 圆角 / 悬停片底色）、分组卡片去边框减重（纯间距分组）、悬停态图标置换（功能图标 → 指示箭头），并提炼三个共享件供后续批次复用。

**Architecture:** 先落地两个共享原语（`HoverSwapIcon` 组件 + `MenuRow` 行片组件）与基础样式（`menu-chip` / `.tree-item` 片化），再把 `SidebarGroup` 与各卡片组迁移到 `MenuRow` / `menu-chip`。纯 CSS 驱动悬停置换（`group-hover` + `group-focus-within`），不引入 JS hover 状态。

**Tech Stack:** Electron 41 + React 19 + TypeScript + Tailwind CSS 4（`html{font-size:14px}` → 1 spacing = 3.5px）+ vitest/jsdom。

**Spec:** `docs/superpowers/specs/2026-09-28-ui-refactor-design.md`（批 0 规格见 §二～§四；批次 1–9 不在本计划内，各自另立计划）

## Global Constraints

- **范围**：只碰 `src/components/panels/sidebar/**`、新建 `src/components/ui/HoverSwapIcon.tsx`、`src/components/ui/MenuRow.tsx`（+ 各自测试）、`src/index.css`。不动其余目录。
- **箭头语言（用户 2026-09-28 拍板，随后更新：全部统一）**：**全侧栏统一 ›/⌄**（lucide `ChevronRight` = 收起/折叠态，`ChevronDown` = 展开态）——卡片头的悬停置换箭头、常驻折叠按钮、内层行全部使用；**不使用 `⌃`（ChevronUp）**。
- **置换语义**：跳转/滑出 → `›`；原地展开 → 收起态 `›`、展开态 `⌄`（与行语言同一套；两语义下收起态同形 `›` 为用户确认的取舍）。
- **命中区**：本批落地的所有单图标按钮热区 **≥32×32px**（视觉图标 10/12px 不变，用 `style={{ width: 32, height: 32 }}` 固定像素写；标准 §5.2）。
- **形态**：行 = `.menu-chip`（高 32 / 圆角 `--radius-lg`10px / 左右 margin 4px）；分组 = 去边框去卡片底、由容器 `space-y-3` 间距分组；**选中态**沿用 `--color-active` 底 + 左 2px accent 竖线。
- **不变量**：配色令牌（禁止硬编码色）、字号（13px 行 / `text-micro`）、图标档位、i18n 文案、信息架构、操作按钮**常驻**（不引入 hover 才显形的新站）。
- **契约必须保持**：`button button` = 0；行主按钮可 `focus()`；点击外层 div 不触发主行为；`SidebarGroup` 四类分支的按钮数契约（1/1/2/0）。
- **门禁**：每个任务收尾跑该文件相关测试；批次收尾跑全量 `pnpm run typecheck`、`pnpm run lint`、`pnpm run test`（三绿）。⚠️ 本机沙箱禁子进程：跑 `pnpm` 命令时 Bash 工具需 `dangerouslyDisableSandbox: true`。
- **不做真机测试**（用户明令）；不 push（提交留本地）。

## Review Focus

1. **键盘等价**：置换必须由 `group-focus-within` 触发（Tab 聚焦主按钮时同 hover 效果）——Task 2/4 的测试钉住两个类都在。
2. **快速划过不闪烁**：两图层同时存在（`opacity` 交叉渐隐），禁止条件渲染 `{hover ? A : B}`——Task 2 测试断言「同一容器内两个 svg 同时存在」。
3. **纯展示行不得有悬停暗示**：`.menu-chip`/`.tree-item` 的 hover 只对「本身是 button 或含 button」的行生效——Task 1 的 CSS 用 `:where(button, :has(button))` 门控；Task 6 验证 `LeafItem` 无 onClick 变体不含按钮、因而无 hover。
4. **折叠状态切换时箭头方向正确**：收起 → `ChevronRight`(›)、展开 → `ChevronDown`(⌄)——Task 2 测两态，Task 4 测 nav+fold 常驻按钮两态。
5. **窄栏长文本不换行**：标题保持 `truncate`、计数保持 `flex-shrink-0`——Task 4 断言标题 span 带 `truncate` 类。

---

### Task 1: 行片基础样式（`menu-chip` + `.tree-item` 片化）

**Files:**
- Modify: `src/index.css`（`.tree-item` 定义 ~L714-740；`.tree-item:hover` ~L731-734）

**Interfaces:**
- Consumes: 无
- Produces: `.menu-chip` 类（供 Task 3 `MenuRow`、Task 5 各行、Task 7 角色行使用）；`.tree-item` 片化后的几何（供 Task 4-7 的既有行自动生效）

- [ ] **Step 1: 改写 `.tree-item` 块为片形态，并新增 `.menu-chip`**

把 `src/index.css` 中 `.tree-item { ... }` / `.tree-item:hover { ... }` 两段替换为（保留原注释中「刻意不给 cursor-pointer」的说明）：

```css
  /* ===== 行片（menu-chip）——菜单行/列表行的统一形态（2026-09-28 UI 重构批 0） =====
     行高 32px / 圆角 --radius-lg / 左右 4px / 悬停片底色。
     hover 只对「本身是 <button> 或行内含 <button>」的行生效 —— 纯展示行不得有悬停暗示。 */
  .menu-chip,
  .tree-item {
    height: 32px;
    border-radius: var(--radius-lg);
    margin: 0 4px;
    transition: background var(--transition-fast);
  }
  .menu-chip:where(button, :has(button)):hover,
  .tree-item:where(button, :has(button)):hover {
    background: var(--color-hover);
  }

  /* ===== 树节点 — 32px 行高行片；点击由行内主按钮承担 ===== */
  .tree-item {
    /* ⚠️ 刻意不给 cursor-pointer：点击由行内的主按钮承担，手型光标应由那个 <button> 提供
       （它自带 enabled:cursor-pointer）。容器再带手型会让「不可点的右侧留白」也显示手型，
       即假可供性——批次 3 已把 4 处行的左缩进移到主按钮上，正是为了让光标与可点区重合。 */
    @apply flex items-center gap-1.5 px-2;
    font-size: 13px;
    color: var(--color-text);
    position: relative;
  }

  /* 激活节点：背景 + 左侧 2px 品牌色竖线 */
  .tree-item.active {
    background: var(--color-active);
    box-shadow: inset 2px 0 0 var(--color-accent);
  }
```

要点：删掉旧 `height: 26px`、`border-radius: var(--radius-sm)`、`margin: 0 4px`（并入共享块）、`:hover` 的 `translateX(2px)`。

- [ ] **Step 2: 跑侧栏测试（应全绿——类名未变、断言不涉 CSS 值）**

Run: `pnpm run test -- panels/sidebar`
Expected: PASS（DraftBoxGroup/ManuscriptGroup/MemoryGroup/PublicationGroup/SidebarGroup 相关套件）

- [ ] **Step 3: grep 自检（确认旧值清除）**

```bash
grep -n "translateX" src/index.css            # .tree-item 区域应为 0 命中
grep -n "height: 26px" src/index.css          # 行片旧高度应为 0 命中（.bottom-tool-btn 若为 26px 属另一处，保留）
```

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "style: 行片基础——menu-chip/.tree-item 片化（32px 高、圆角10、悬停门控、去位移动画）"
```

---

### Task 2: `HoverSwapIcon` 组件

**Files:**
- Create: `src/components/ui/HoverSwapIcon.tsx`
- Test: `src/components/ui/HoverSwapIcon.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `export default function HoverSwapIcon(props: { icon: ReactNode; swap: 'nav' | 'expand'; expanded?: boolean; size?: number })` —— Task 3 `MenuRow` 依赖该签名

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/ui/HoverSwapIcon.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { BookOpen } from 'lucide-react'
import HoverSwapIcon from './HoverSwapIcon'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('HoverSwapIcon — 悬停置换（ui-interaction-standard §3.1）', () => {
  it('两图层叠放（功能图标 + 箭头）同时存在——不是条件渲染，快速划过不闪烁', () => {
    const el = render(<HoverSwapIcon icon={<BookOpen size={12} />} swap="nav" />)
    // 同一时刻两个 svg 都在 DOM（交叉渐隐而非替换节点）
    expect(el.querySelectorAll('svg')).toHaveLength(2)
    expect(el.querySelector('.lucide-book-open')).toBeTruthy()
    expect(el.querySelector('.lucide-chevron-right')).toBeTruthy()
  })

  it('hover 与 focus-within 双通道触发（键盘等价）', () => {
    const el = render(<HoverSwapIcon icon={<BookOpen size={12} />} swap="nav" />)
    expect(el.innerHTML).toContain('group-hover:opacity-0')
    expect(el.innerHTML).toContain('group-focus-within:opacity-0')
    expect(el.innerHTML).toContain('group-hover:opacity-100')
    expect(el.innerHTML).toContain('group-focus-within:opacity-100')
  })

  it('expand 语义：收起 → ›（ChevronRight）；展开 → ⌄（ChevronDown）', () => {
    const a = render(<HoverSwapIcon icon={<BookOpen size={12} />} swap="expand" expanded={false} />)
    expect(a.querySelector('.lucide-chevron-right')).toBeTruthy()
    act(() => root?.unmount()); container?.remove()
    const b = render(<HoverSwapIcon icon={<BookOpen size={12} />} swap="expand" expanded />)
    expect(b.querySelector('.lucide-chevron-down')).toBeTruthy()
  })

  it('nav 语义：ChevronRight（›）', () => {
    const el = render(<HoverSwapIcon icon={<BookOpen size={12} />} swap="nav" />)
    expect(el.querySelector('.lucide-chevron-right')).toBeTruthy()
    expect(el.querySelectorAll('svg')[0].classList.contains('lucide-chevron-right')).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test -- HoverSwapIcon`
Expected: FAIL（Cannot find module './HoverSwapIcon'）

- [ ] **Step 3: 实现**

```tsx
// src/components/ui/HoverSwapIcon.tsx
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

interface HoverSwapIconProps {
  /** 功能图标（默认态显示；12px 档） */
  icon: ReactNode
  /** nav = 跳转/滑出（悬停显 ›）；expand = 原地展开（收起 ⌄ / 展开 ⌃） */
  swap: 'nav' | 'expand'
  /** swap='expand'：当前是否已展开（决定箭头方向） */
  expanded?: boolean
  /** 图标档位（ui-layout-standard 图标五档；默认 12） */
  size?: number
}

/**
 * 悬停态图标置换（ui-interaction-standard §3.1）：
 * 默认显示功能图标，父级 hover / focus-within 时交叉渐隐为指示箭头。
 * 纯 CSS 驱动（由外层容器的 group-hover / group-focus-within 触发），无 JS hover state ——
 * 快速划过不闪烁、键盘 Tab 等价；prefers-reduced-motion 降级为瞬时切换。
 * ⚠️ 使用方必须给外层可悬停容器加 `group` 类。
 */
export default function HoverSwapIcon({ icon, swap, expanded = false, size = 12 }: HoverSwapIconProps) {
  const arrow = swap === 'nav'
    ? <ChevronRight size={size} />
    : (expanded ? <ChevronDown size={size} /> : <ChevronRight size={size} />)
  return (
    <span
      className="relative inline-flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, color: 'var(--color-accent)' }}
    >
      {/* 功能图标层：悬停/聚焦时隐去 */}
      <span className="inline-flex transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-0 group-focus-within:opacity-0">
        {icon}
      </span>
      {/* 指示箭头层：与图标层叠放（绝对定位，零布局位移），悬停/聚焦时渐现 */}
      <span
        className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {arrow}
      </span>
    </span>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm run test -- HoverSwapIcon`
Expected: PASS（4 例）

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/HoverSwapIcon.tsx src/components/ui/HoverSwapIcon.test.tsx
git commit -m "feat(ui): HoverSwapIcon——悬停图标置换（纯 CSS 双通道，keyboard 等价）"
```

---

### Task 3: `MenuRow` 行片组件

**Files:**
- Create: `src/components/ui/MenuRow.tsx`
- Test: `src/components/ui/MenuRow.test.tsx`

**Interfaces:**
- Consumes: `HoverSwapIcon`（Task 2）
- Produces: `export default function MenuRow(props: MenuRowProps)`，签名：

```ts
interface MenuRowProps {
  icon?: ReactNode
  title: string
  count?: ReactNode
  onPrimary?: () => void                        // 不传 = 该行没有主行为（纯展示）
  swap?: 'nav' | 'expand'                       // 与 icon 配套；纯展示行不传
  expanded?: boolean                            // swap='expand' 用
  leadingButton?: ReactNode                     // 导航+折叠卡：左端独立折叠按钮（常驻）
  actions?: ReactNode                           // 兄弟操作按钮
  titleHint?: string
  active?: boolean
  onContextMenu?: (e: React.MouseEvent) => void
}
```
Task 4（SidebarGroup）、Task 5（三个卡片组头）依赖该签名。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/ui/MenuRow.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { BookOpen } from 'lucide-react'
import MenuRow from './MenuRow'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('MenuRow — 行片（唯一实现）', () => {
  it('主按钮包含标题与计数；点计数（冒泡）触发 onPrimary', async () => {
    const onPrimary = vi.fn()
    const el = render(
      <MenuRow icon={<BookOpen size={12} />} title="小说配置" count="已完成" swap="nav" onPrimary={onPrimary} />
    )
    const main = el.querySelector('button') as HTMLButtonElement
    expect(main).toBeTruthy()
    expect(main.textContent).toContain('小说配置')
    expect(main.textContent).toContain('已完成')
    const countSpan = [...main.querySelectorAll('span')].find(s => s.textContent === '已完成')!
    await act(async () => { countSpan.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onPrimary).toHaveBeenCalledTimes(1)
  })

  it('容器是 menu-chip 且带 group（置换触发源）；标题 truncate、计数不缩', () => {
    const el = render(<MenuRow icon={<BookOpen size={12} />} title="故事架构" count="4/4" swap="expand" onPrimary={() => {}} />)
    const chip = el.firstElementChild as HTMLElement
    expect(chip.className).toContain('menu-chip')
    expect(chip.className).toContain('group')
    expect(el.querySelector('.truncate')).toBeTruthy()
  })

  it('leadingButton 在主轴之前；actions 在主轴之后（兄弟）', () => {
    const el = render(
      <MenuRow title="混合卡" swap="nav" onPrimary={() => {}}
        leadingButton={<button type="button" data-testid="fold" />}
        actions={<button type="button" data-testid="act" />} />
    )
    const buttons = [...el.querySelectorAll('button')]
    expect(buttons.map(b => b.getAttribute('data-testid'))).toEqual(['fold', null, 'act'])
  })

  it('无 onPrimary → 不渲染按钮（纯展示行）；无嵌套 button', () => {
    const el = render(<MenuRow title="状态卡" count="—" />)
    expect(el.querySelectorAll('button')).toHaveLength(0)
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })

  it('主按钮可聚焦、无嵌套 button（键盘可达契约）', () => {
    const el = render(<MenuRow title="折叠卡" swap="expand" onPrimary={() => {}} actions={<button type="button" />} />)
    const main = el.querySelector('button') as HTMLButtonElement
    main.focus()
    expect(document.activeElement).toBe(main)
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test -- MenuRow`
Expected: FAIL（Cannot find module './MenuRow'）

- [ ] **Step 3: 实现**

```tsx
// src/components/ui/MenuRow.tsx
import type { ReactNode } from 'react'
import HoverSwapIcon from './HoverSwapIcon'

interface MenuRowProps {
  /** 功能图标（配 swap 使用；纯展示行可省略） */
  icon?: ReactNode
  /** 行标题（纯展示，进主按钮） */
  title: string
  /** 右侧计数/状态（纯展示，进主按钮） */
  count?: ReactNode
  /** 主行为：导航=进入；折叠卡=展开/折叠。不传 = 该行没有主行为 */
  onPrimary?: () => void
  /** 悬停置换语义：nav=›；expand=⌄/⌃ 随 expanded */
  swap?: 'nav' | 'expand'
  /** swap='expand'：当前是否已展开 */
  expanded?: boolean
  /** 导航+折叠卡：左端独立折叠按钮（常驻、状态可见；主按钮仍负责进入） */
  leadingButton?: ReactNode
  /** 有独立行为的操作按钮（兄弟节点，常驻） */
  actions?: ReactNode
  /** 主按钮悬停提示 */
  titleHint?: string
  /** 选中态（底色 + 左 2px accent 竖线） */
  active?: boolean
  onContextMenu?: (e: React.MouseEvent) => void
}

/**
 * MenuRow —— 行片（chip）的唯一实现（card-affordance-standard §行片形态，2026-09-28 批 0）。
 *
 * 结构与既有可供性契约一致：外层片容器（视觉/menu-chip/右键菜单）+ `flex-1` 主按钮
 * （图标置换 + 标题 + 计数）+ 操作按钮作兄弟（`button button` 恒为 0，无需 stopPropagation）。
 * 悬停置换由容器 `group` + HoverSwapIcon 的 group-hover/group-focus-within 纯 CSS 驱动。
 */
export default function MenuRow({
  icon, title, count, onPrimary, swap, expanded, leadingButton, actions, titleHint, active, onContextMenu,
}: MenuRowProps) {
  const content = (
    <>
      {swap ? <HoverSwapIcon icon={icon} swap={swap} expanded={expanded} /> : icon}
      <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{title}</span>
      {count !== undefined && (
        <span className="ml-auto text-micro flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{count}</span>
      )}
    </>
  )
  return (
    <div
      className="menu-chip group flex items-center gap-1.5 select-none"
      style={active ? { background: 'var(--color-active)', boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}
      onContextMenu={onContextMenu}
    >
      {leadingButton}
      {onPrimary ? (
        <button
          type="button"
          onClick={onPrimary}
          title={titleHint}
          className="flex items-center gap-1.5 flex-1 min-w-0 h-full text-left enabled:cursor-pointer"
        >
          {content}
        </button>
      ) : (
        /* 纯展示行：无热区、无 hover、无手型（不得渲染 disabled 按钮） */
        <div className="flex items-center gap-1.5 flex-1 min-w-0">{content}</div>
      )}
      {actions}
    </div>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm run test -- MenuRow`
Expected: PASS（5 例）

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/MenuRow.tsx src/components/ui/MenuRow.test.tsx
git commit -m "feat(ui): MenuRow——行片唯一实现（主按钮+兄弟操作，置换内置）"
```

---

### Task 4: `SidebarGroup` 迁移到 MenuRow（公开 props 不变）

**Files:**
- Modify: `src/components/panels/sidebar/SidebarGroup.tsx`（整份重写组件体）
- Test: `src/components/panels/sidebar/SidebarGroup.test.tsx`（更新 5 例 + 新增 1 例）

**Interfaces:**
- Consumes: `MenuRow`（Task 3）
- Produces: `SidebarGroup` 公开 props **完全不变**（`icon/title/count/actions/onTitleClick/titleHint/onContextMenu/defaultOpen/collapsible/children`）——所有调用点（ProjectTree / DraftBoxGroup / ManuscriptGroup）零改动

- [ ] **Step 1: 更新测试到新形态（先失败）**

`SidebarGroup.test.tsx` 按以下改：

1. 用例「折叠卡」：删除「chevron 置左（compareDocumentPosition）」两行断言，改为：

```tsx
    // 折叠卡：默认态显示功能图标；悬停置换层携带 ›（收起态）双通道类
    expect(main.querySelector('.lucide-chevron-right')).toBeTruthy()
    expect(el.innerHTML).toContain('group-hover:opacity-0')
    expect(el.innerHTML).toContain('group-focus-within:opacity-100')
```

2. 用例「导航卡」：末行 `expect(main.lastElementChild?.tagName.toLowerCase()).toBe('svg')` 改为：

```tsx
    // 无右端常驻 ›（2026-09-28 重订）：指示箭头由悬停置换承担
    expect(main.querySelector('.lucide-chevron-right')).toBeTruthy()   // 置换层的 ›
    expect(el.querySelectorAll('svg')).toHaveLength(1)                 // 不再有第二个（装饰）箭头
```

3. 用例「导航+折叠卡」：在 `const [chevBtn, main] = buttons` 之后加两态断言：

```tsx
    // 常驻折叠按钮用 ›/⌄（收起=›，展开=⌄）；主按钮只做进入（swap=›）
    expect(chevBtn.querySelector('.lucide-chevron-right')).toBeTruthy()
    await act(async () => { chevBtn.click() })
    expect(chevBtn.querySelector('.lucide-chevron-down')).toBeTruthy()
    await act(async () => { chevBtn.click() })   // 复位，保持后续断言前提
```

4. 用例「命中区」：`22px` 两处断言改为 `'32px'`，标题改为「头部图标按钮命中区固定 32×32（标准 §5.2）」。
5. 新增用例：

```tsx
  it('行片形态：头部为 menu-chip + group；标题 truncate（260px 窄栏不换行）', () => {
    const el = render(<SidebarGroup icon={<span />} title="折叠卡" count="11 章">子项</SidebarGroup>)
    const chip = el.querySelector('.menu-chip')
    expect(chip).toBeTruthy()
    expect(chip!.className).toContain('group')
    expect(el.querySelector('.truncate')).toBeTruthy()
  })
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test -- SidebarGroup`
Expected: FAIL（32px / lucide-chevron-down / menu-chip 等断言）

- [ ] **Step 3: 重写实现**

`SidebarGroup.tsx` 组件体替换为（props/接口不变，头注释同步更新）：

```tsx
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import MenuRow from '../../ui/MenuRow'
import { useTranslation } from '../../../hooks/useTranslation'

/* ... props interface 原样保留 ... */

export default function SidebarGroup({
  icon, title, count, actions, onTitleClick, titleHint, onContextMenu,
  defaultOpen = true, collapsible = true, children,
}: SidebarGroupProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const toggle = () => setOpen(v => !v)
  const iconSlot = (
    <span style={{ color: 'var(--color-accent)', flexShrink: 0, display: 'flex' }}>{icon}</span>
  )
  // 导航+折叠卡：左端独立折叠按钮（常驻、状态可见；›/⌄ 与行语言统一）
  const foldButton = (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
      style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
      title={open ? t('action.close') : t('action.open')}
    >
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
    </button>
  )
  return (
    <section>
      <MenuRow
        icon={iconSlot}
        title={title}
        count={count}
        titleHint={titleHint}
        onContextMenu={onContextMenu}
        onPrimary={onTitleClick ?? (collapsible ? toggle : undefined)}
        swap={onTitleClick || collapsible ? (onTitleClick ? 'nav' : 'expand') : undefined}
        expanded={open}
        leadingButton={onTitleClick && collapsible ? foldButton : undefined}
        actions={actions}
      />
      {collapsible ? (open ? children : null) : children}
    </section>
  )
}
```

（注意：`swap` 只在「有主行为」时传；纯状态卡不传 swap/onPrimary。）

- [ ] **Step 4: 运行确认通过 + 关联套件**

Run: `pnpm run test -- panels/sidebar`
Expected: PASS（SidebarGroup 6 例 + DraftBoxGroup/ManuscriptGroup/MemoryGroup/PublicationGroup 全部；若有断言依赖旧结构，按 Task 5/6 的方法在该任务修，但**本步必须全绿后才能提交**——若 PublicationGroup/MemoryGroup 因早于本任务断言头部结构而红，先只跑 `pnpm run test -- SidebarGroup` 通过并提交，把其余放入下一任务）

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/sidebar/SidebarGroup.tsx src/components/panels/sidebar/SidebarGroup.test.tsx
git commit -m "refactor(sidebar): SidebarGroup 接入 MenuRow（四类契约不变；去尾箭头、⌄/⌃ 置换、32×32）"
```

---

### Task 5: 三个自建卡片组迁移（VolumeGroup / PublicationGroup / MemoryGroup）

**Files:**
- Modify: `src/components/panels/sidebar/VolumeGroup.tsx`
- Modify: `src/components/panels/sidebar/PublicationGroup.tsx`
- Modify: `src/components/panels/sidebar/MemoryGroup.tsx`
- Test: `src/components/panels/sidebar/MemoryGroup.test.tsx`（改 1 例）、`src/components/panels/sidebar/PublicationGroup.test.tsx`（加 1 断言）

**Interfaces:**
- Consumes: `MenuRow`（Task 3）、`.menu-chip`（Task 1）
- Produces: 三组的头部统一为 MenuRow（swap='expand'）；行容器统一 `.menu-chip`

- [ ] **Step 1: 更新测试到新形态（先失败）**

`MemoryGroup.test.tsx` 的「行 hover 与热区重合」用例改为：

```tsx
  it('行片形态（2026-09-28）：hover 由 .menu-chip 承担，主按钮与容器均不带独立 hover 类', async () => {
    const { container, root } = render(<MemoryGroup projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    const main = rowOf(container, 'chapters-1-3.md') as HTMLButtonElement
    const rowBox = main.parentElement as HTMLElement
    expect(rowBox.className).toContain('menu-chip')      // 片 = 悬停与热区边界
    expect(main.className).not.toContain('hover:bg-')     // hover 不再挂主按钮
    expect(rowBox.className).not.toContain('hover:bg-')   // 也不挂容器（统一由 menu-chip 承接）
    // 32×32 命中区（标准 §5.2）：重建按钮
    const rebuild = [...rowBox.querySelectorAll('button')].find(b => b.title === t('memory.rebuild'))!
    expect((rebuild as HTMLButtonElement).style.width).toBe('32px')
    act(() => { root.unmount() })
  })
```

`PublicationGroup.test.tsx` 的「行容器不再有 hover 类」用例追加一行：

```tsx
    expect(rowBox.className).toContain('menu-chip')
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test -- MemoryGroup`
Expected: FAIL（menu-chip 不存在 / 主按钮仍带 hover:bg-）

- [ ] **Step 3: 实现（三个文件按同一模式）**

**通用模式**（每个自建卡片组）：
1. 外壳 `<section className="rounded-xl border p-2.5" style={{ borderColor: ..., backgroundColor: ... }}>` → `<section>`（间距由父容器 `space-y-3` 承担，Task 7 改 ProjectTree）。
2. 头部整块（`<div className="flex items-center gap-1.5 mb-1.5">…主按钮…操作按钮…</div>`）替换为：

```tsx
      <MenuRow
        icon={<Brain size={12} />}                 // 各组的功能图标（VolumeGroup=BookMarked / PublicationGroup=Satellite / MemoryGroup=Brain）
        title={t('memory.groupTitle')}              // 各组原标题
        count={…}                                   // 各组原计数表达式
        swap="expand"
        expanded={open}
        onPrimary={() => setOpen(v => !v)}
        actions={…}                                 // 原操作按钮，逐个改 32×32（见下）
      />
```

3. 操作按钮热区：`style={{ width: 22, height: 22, ... }}` → `style={{ width: 32, height: 32, ... }}`（VolumeGroup 的 Layers/Plus、PublicationGroup 的 Plus、MemoryGroup 的 RefreshCw；**图标 size 不变**）。
4. 行容器 → 片：`<div className="rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>` → `<div className="menu-chip group flex items-center gap-1.5 pr-1.5 select-none" title={…}>`（VolumeRow）；`<div className="flex items-center gap-1.5 pr-1.5 select-none" title={…}>` → 前面加 `menu-chip group`（MemoryRow）；`<div className="flex items-center gap-1.5 pr-1.5 group select-none">` → 加 `menu-chip`（PublicationGroup 行）。
5. 行主按钮去掉自带 hover/圆角、贴合片高：如 MemoryRow 主按钮 `className="flex items-center gap-1.5 flex-1 min-w-0 px-1.5 py-1.5 rounded-lg text-left cursor-pointer hover:bg-[var(--color-hover)]"` → `className="flex items-center gap-1.5 flex-1 min-w-0 h-full px-1.5 text-left cursor-pointer"`；VolumeRow 主按钮 `… h-full text-left enabled:cursor-pointer` 保持不变；PublicationGroup 行主按钮同 MemoryRow 处理。
6. 行内操作按钮 22→32（VolumeRow 的 Pencil/Trash2、MemoryRow 的 RotateCw/Trash2、PublicationGroup 的 Trash2 保留 `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` hover 显形但要 32×32）。
7. **卷内/记忆内层小行**（`rounded-lg hover:bg-…` 的章节按钮等）本批保持原样。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm run test -- panels/sidebar`
Expected: PASS（含更新后的 MemoryGroup/PublicationGroup 用例）

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/sidebar/VolumeGroup.tsx src/components/panels/sidebar/PublicationGroup.tsx src/components/panels/sidebar/MemoryGroup.tsx src/components/panels/sidebar/MemoryGroup.test.tsx src/components/panels/sidebar/PublicationGroup.test.tsx
git commit -m "refactor(sidebar): 三个自建卡片组迁移行片形态（MenuRow 头部 / menu-chip 行 / 32×32）"
```

---

### Task 6: 行族校准（草稿条目 / 正文章节导出 / LeafItem 验证）

**Files:**
- Modify: `src/components/panels/sidebar/DraftBoxGroup.tsx`（DraftItem 行）
- Modify: `src/components/panels/sidebar/ManuscriptGroup.tsx`（导出按钮 22→32）
- Verify only: `src/components/panels/sidebar/SidebarShared.tsx`（LeafItem 无需改动——见 Step 3）

**Interfaces:**
- Consumes: `.menu-chip`（Task 1）
- Produces: 草稿条目行/正文章节行的片形态；`LeafItem` 静态变体经 `:where(button, :has(button))` 门控后无悬停暗示（自动生效）

- [ ] **Step 1: DraftItem 行改片**

`DraftBoxGroup.tsx` 的 `DraftItem` 渲染：外层 `<div className="relative flex items-center" style={{ opacity: … }}>` → `<div className="menu-chip relative flex items-center" style={{ opacity: … }}>`；
主按钮 `className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer rounded-lg hover:bg-[var(--color-hover)]"` → `className="flex items-center gap-1.5 flex-1 min-w-0 h-full text-left cursor-pointer"`（`paddingLeft: 50` 内联样式保留——缩进属于可点热区）。

- [ ] **Step 2: ManuscriptGroup 导出按钮 22→32**

单章导出按钮 `style={{ width: 22, height: 22, … }}` → `style={{ width: 32, height: 32, … }}`（`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` 保留；图标 `Download size={12}` 不变）。行容器 `.tree-item group` 已由 Task 1 自动片化，无需改。

- [ ] **Step 3: LeafItem 静态变体验证（无需改代码）**

确认 `SidebarShared.tsx` 的 `LeafItem`：无 onClick 时渲染纯 `<div className="flex …">`（无 button）→ Task 1 的 `:where(button, :has(button))` 门控下**不会**有 hover 底色（纯展示行无悬停暗示 ✅）；有 onClick 时行内含主按钮 → 片 hover 生效 ✅。若发现其他「带 `.tree-item` 但无按钮」的静态行，同样自动满足。

- [ ] **Step 4: 运行 + Commit**

Run: `pnpm run test -- panels/sidebar`
Expected: PASS

```bash
git add src/components/panels/sidebar/DraftBoxGroup.tsx src/components/panels/sidebar/ManuscriptGroup.tsx
git commit -m "refactor(sidebar): 行族校准——草稿条目片化、导出按钮 32×32"
```

---

### Task 7: 其余侧栏视图（CharactersView / HomeSidebarPanel）+ 分组间距

**Files:**
- Modify: `src/components/panels/sidebar/CharactersView.tsx`（tier 头行、角色行）
- Modify: `src/components/panels/sidebar/ProjectTree.tsx`（L180 `space-y-2` → `space-y-3`）
- Verify only: `src/components/panels/sidebar/HomeSidebarPanel.tsx`

**Interfaces:**
- Consumes: `.menu-chip`（Task 1）
- Produces: 侧栏各视图行语言与项目结构一致

- [ ] **Step 1: ProjectTree 分组间距**

`ProjectTree.tsx:180` 的 `<div className="text-sm space-y-2">` → `<div className="text-sm space-y-3">`（组间距 ~10.5px，按样板规格「~10px」）。

- [ ] **Step 2: CharactersView 行改片**

- tier 头行按钮（`className="flex items-center gap-1 px-2 py-1 w-full text-micro font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] rounded cursor-pointer"`）→ `className="menu-chip flex items-center gap-1 px-2 w-full text-micro font-medium text-[var(--color-text-muted)] cursor-pointer"`（chevron 保持 ›/⌄ 不迁移）。
- 角色行按钮（`px-2.5 py-1.5 rounded-md text-xs mb-0.5 transition-colors` + 选中 `bg-[var(--color-active)]` / 未选 `hover:bg-[var(--color-hover)]`）→ 基底加 `menu-chip` 并删 `rounded-md`、`hover:bg-[var(--color-hover)]`、`mb-0.5` 与 `transition-colors`；选中分支保留 `bg-[var(--color-active)] text-[var(--color-text)]`。
- 顶部筛选条（`rounded-full` 药丸）**不动**（药丸规范另属 §1.1，非本批）。

- [ ] **Step 3: HomeSidebarPanel 验证（预计无需改）**

「当前项目」信息块是展示卡（非菜单行），本批**保持原样**；只确认其中无 `.tree-item`/`.menu-chip` 误用。

- [ ] **Step 4: 运行 + Commit**

Run: `pnpm run test -- panels/sidebar`（若无 CharactersView 测试则确认其所在套件不受影响）
Expected: PASS

```bash
git add src/components/panels/sidebar/CharactersView.tsx src/components/panels/sidebar/ProjectTree.tsx
git commit -m "refactor(sidebar): 角色视图行片化 + 分组间距 space-y-3"
```

---

### Task 8: 收尾——门禁 + 自检 + 标准/记忆同步

**Files:**
- Modify: `.agents/skills/card-affordance-standard/SKILL.md`、`.agents/skills/ui-interaction-standard/SKILL.md`、`.agents/skills/ui-layout-standard/SKILL.md`（本地技能，gitignore 不进仓库）
- Modify: 记忆文件（`C:\Users\0\.claude\projects\E--vela-11-vela-1\memory\` 下 card-affordance-standard.md / ui-interaction-standard.md / MEMORY.md）

**Interfaces:**
- Consumes: 批 0 全部产物
- Produces: 三绿门禁 + 标准与实现一致 + 记忆更新（供批次 1–9 复用）

- [ ] **Step 1: 全量门禁（三绿）**

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
```

Expected: 全部 PASS（测试总数 ≥2168；新增 HoverSwapIcon 4 例 + MenuRow 5 例 + SidebarGroup 1 例）

- [ ] **Step 2: 侧栏自检 grep**

```bash
cd src/components
grep -rn "rounded-xl border p-2.5" panels/sidebar --include=*.tsx   # 期望 0（卡片外壳已减重）
grep -rn "width: 22, height: 22" panels/sidebar --include=*.tsx     # 期望 0（全部 32×32）
grep -rn "translateX" panels/sidebar ../index.css                   # 期望 0（位移动画已移除）
grep -rn "button button" panels/sidebar --include=*.test.tsx        # 恒为 0（契约）
```

- [ ] **Step 3: 标准同步（按 spec §五）**

- `card-affordance-standard`：§1 契约表「导航卡右侧 `>` 纯装饰」→「悬停置换 `›`（无右端常驻箭头）」；补「导航+折叠卡 = 左 chevron 常驻 ›/⌄ + 主按钮置换 `›`」；新增「行片形态」小节（`menu-chip` 几何 + `MenuRow` 唯一实现 + `HoverSwapIcon`）；§5.2/§5.3 标注「侧栏站点已随批 0 核销」；§7.1 第 6 问现状更新；§8/§8.1 侧栏现状表按新形态改写。
- `ui-interaction-standard`：§3.1「本仓尚无实现」→ 已实现（范式 = `HoverSwapIcon`；触发 = `group-hover` + `group-focus-within`；两图层叠放 ≥150ms 交叉渐隐；`prefers-reduced-motion` 降级）；§3.2/§5 热区现状更新（侧栏已 32×32）。
- `ui-layout-standard`：圆角章节补「行片 = `--radius-lg`(10px)」；行高密度补「菜单行 32px」。
- 记忆：`MEMORY.md` 与 `card-affordance-standard.md` / `ui-interaction-standard.md` 记「批 0 已落地（MenuRow/HoverSwapIcon/menu-chip 三原语）+ 后续批次 1–9 待跑」。

- [ ] **Step 4: Commit（代码侧收尾；技能/记忆在 gitignore，不进提交）**

```bash
git add -A
git commit -m "chore: UI 重构批 0 收尾（门禁三绿 + 侧栏自检归零）"
```

---

## Self-Review 记录

- **Spec 覆盖**：§二几何（Task 1/3/4/5/7）、悬停置换（Task 2/4/5）、导航+折叠卡细则（Task 4）、去右端 `>`（Task 4）、32×32（Task 4/5/6）、§三 三个共享件（Task 1/2/3）、§四 迁移（Task 4/5/6/7）、§五 标准同步（Task 8）、§六 批 0 范围（全覆盖；批 1–9 不在本计划）。
- **符号一致性**：`HoverSwapIcon` 的 props（icon/swap/expanded/size）在 Task 2 定义、Task 3 消费一致；`MenuRow` props 在 Task 3 定义、Task 4/5 消费一致；类名 `menu-chip` 在 Task 1 定义、Task 4/5/6/7 消费一致。
- **Review Focus 落点**：①→Task 2/4；②→Task 2；③→Task 1（CSS 门控）+ Task 6 Step 3；④→Task 2/4；⑤→Task 4 Step 1（truncate 断言）。
