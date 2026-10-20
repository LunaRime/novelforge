/**
 * 通知中心 Store（状态栏「消息收纳」）—— 2026-10 六项 UI 改进 · 第 1 项
 *
 * **设计口径：派生式，不 push。**
 * 不在 workflow 各处埋点 `pushNotice()` —— 那样每加一个通知源就要改业务代码，
 * 且状态与 UI 会两头漂移。这里只暴露 `sync()`：从 `workflow-store` 的
 * **当前状态**重新派生条目列表，按稳定 id 去重。谁变了谁触发 sync（见 `NotificationCenter`），
 * 派生逻辑本身无状态、可反复调用（幂等；结果无变化时**不写 state**，避免每帧日志都重渲染）。
 *
 * 条目 id 约定（已读 / 移除集合以 id 为键，跨重启仍能对上）：
 * - `run:<runId>:running`   → 运行中（activeRuns 实时派生）**永远置顶、不可移除、不计未读**
 * - `run:<runId>:completed` / `run:<runId>:failed` → 任务结果（history）
 *
 * 应用更新不再进入通知中心（2026-10-20）：状态栏更新段是唯一操作面，
 * 避免出现第二套下载/重启入口。
 *
 * 已读 + 已移除集合持久化到 localStorage `vela-notice`（读写都 try/catch：隐私模式 / 配额
 * 满 / JSON 损坏都只是「回到全未读」，绝不让一条坏数据把界面打白屏）。集合在 `sync()` 时
 * 按当前候选 id **剪枝**，否则跑几百个任务后这两个数组会无限增长。
 *
 * **首次运行 seed**：`vela-notice` 键**不存在**（真正首次运行）时，`sync()` 会先把
 * **本次会话之前就存在**的派生条目（任务结果，不含运行中条目）一次性记为已读并落盘 ——
 * 否则装完本轮改动第一次打开会凭空冒出一串未读角标。键一旦写下（哪怕内容是空数组）就不再 seed，
 * 故之后新产生的条目照常未读。
 * 两个条件各管一段，缺一不可：**「键是否存在」**是持久化判据（跨重启也成立，且用户点过
 * 「全部已读」后 read 为空数组时不能被当成首次——那是已被尊重的用户状态）；state 里的
 * `seeded` 则保证一次会话内只判定一次（localStorage 不可用时 getItem 每次抛错，没有它就会反复 seed）。
 */
import { create } from 'zustand'
import { useWorkflowStore } from './workflow-store'

/** 已读 / 已移除集合的持久化 key */
const STORAGE_KEY = 'vela-notice'

/** 未读数位上限：超过显示 `notice.unreadMany`（99+） */
export const UNREAD_BADGE_MAX = 99

/** 运行中条目的状态（activeRuns 里 running/waiting/paused 三种才算「正在执行」） */
export type RunningNoticeStatus = 'running' | 'waiting' | 'paused'

/** 运行中条目：置顶、不可移除、不计未读 */
export interface RunningNotice {
  id: string
  kind: 'running'
  pinned: true
  unread: false
  runId: string
  title: string
  status: RunningNoticeStatus
  /** 当前步骤名（run.steps[currentStepIndex]） */
  stepName: string
  stepDone: number
  stepTotal: number
  /** 0–100：已完成步骤 + 当前步骤步内进度 */
  percent: number
}

/** 任务结果条目：完成 / 失败的工作流（workflow-store.history） */
export interface ResultNotice {
  id: string
  kind: 'result'
  pinned: false
  unread: boolean
  runId: string
  title: string
  variant: 'completed' | 'failed'
}

export type NoticeItem = RunningNotice | ResultNotice

/** 未读条目数 —— 运行中条目不计未读（它没有「已读」语义） */
export function countUnread(items: NoticeItem[]): number {
  let n = 0
  for (const item of items) {
    if (!item.pinned && item.unread) n++
  }
  return n
}

// ===== 持久化（localStorage：已读 / 已移除集合） =====

interface NoticePersisted {
  read: string[]
  dismissed: string[]
}

/** 只接受字符串数组：坏数据（对象 / 数字 / 嵌套）一律丢弃，不做任何类型断言 */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function loadPersisted(): NoticePersisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { read: [], dismissed: [] }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { read: [], dismissed: [] }
    const obj = parsed as { read?: unknown; dismissed?: unknown }
    return { read: asStringArray(obj.read), dismissed: asStringArray(obj.dismissed) }
  } catch {
    // JSON 损坏 / localStorage 不可用：视为全未读，不影响启动
    return { read: [], dismissed: [] }
  }
}

function savePersisted(read: string[], dismissed: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ read, dismissed }))
  } catch {
    /* 配额满 / 隐私模式：本次不持久化，内存态仍然正确 */
  }
}

/**
 * `vela-notice` 键是否存在 —— 「真正首次运行」的判据。
 * ⚠️ 用「键是否存在」而不是「键内容是否为空」：用户点过「全部已读」后 `read` 可能是空数组，
 * 那是**已被尊重的用户状态**，不能再 seed 一次。
 * localStorage 不可用（getItem 抛错）时按「无键」处理，配合 `seeded` 保证一次会话只 seed 一次。
 */
function hasPersistedKey(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}

// ===== 派生 =====

/** 扫描用的候选集：去重后的全部条目（含被移除的，供剪枝用） */
interface Derived {
  /** 去重后的候选条目（已计算 unread；未过滤「已移除」） */
  candidates: NoticeItem[]
  /** 展示用列表（已剔除「已移除」；运行中条目永不被剔除） */
  items: NoticeItem[]
}

function deriveRunning(): RunningNotice[] {
  const runs = useWorkflowStore.getState().activeRuns
  const out: RunningNotice[] = []
  for (const run of runs) {
    if (run.status !== 'running' && run.status !== 'waiting' && run.status !== 'paused') continue
    const step = run.steps[run.currentStepIndex] ?? run.steps[0]
    const stepDone = run.steps.filter((s) => s.status === 'completed').length
    const stepTotal = run.steps.length
    const inner = Math.min(100, Math.max(0, step?.progress ?? 0)) / 100
    const percent = stepTotal > 0
      ? Math.min(100, Math.round(((stepDone + inner) / stepTotal) * 100))
      : 0
    out.push({
      id: `run:${run.id}:running`,
      kind: 'running',
      pinned: true,
      unread: false,
      runId: run.id,
      title: run.title,
      status: run.status,
      stepName: step?.name ?? '',
      stepDone,
      stepTotal,
      percent,
    })
  }
  return out
}

function deriveResults(readIds: Set<string>, dismissedIds: Set<string>): ResultNotice[] {
  const history = useWorkflowStore.getState().history
  const out: ResultNotice[] = []
  const seen = new Set<string>()
  for (const run of history) {
    if (run.status !== 'completed' && run.status !== 'failed') continue
    const id = `run:${run.id}:${run.status}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      kind: 'result',
      pinned: false,
      unread: !readIds.has(id) && !dismissedIds.has(id),
      runId: run.id,
      title: run.title,
      variant: run.status,
    })
  }
  return out
}

/**
 * 全量派生（分区顺序即优先级）：正在执行 → 任务结果。
 * 顺序稳定，不依赖 Map/Set 的迭代顺序之外的任何东西。
 */
function derive(): Derived {
  const readIds = new Set(useNoticeStore.getState().readIds)
  const dismissedIds = new Set(useNoticeStore.getState().dismissedIds)

  const candidates = [
    ...deriveRunning(),
    ...deriveResults(readIds, dismissedIds),
  ]

  // id 去重（同一 run 反复派生 / history 里重复出现同一 run 都只留一条，首条优先）
  const byId = new Map<string, NoticeItem>()
  for (const item of candidates) {
    if (!byId.has(item.id)) byId.set(item.id, item)
  }
  const unique = [...byId.values()]

  const items = unique.filter((item) => item.pinned || !dismissedIds.has(item.id))
  return { candidates: unique, items }
}

/** 逐字段比较：state 只在真的变了才写（否则每条日志都触发一次重渲染） */
function sameItems(a: NoticeItem[], b: NoticeItem[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.id !== y.id || x.unread !== y.unread || x.kind !== y.kind) return false
    if (x.kind === 'running' && y.kind === 'running') {
      if (x.title !== y.title || x.status !== y.status || x.stepName !== y.stepName
        || x.stepDone !== y.stepDone || x.stepTotal !== y.stepTotal || x.percent !== y.percent) return false
    } else if (x.kind === 'result' && y.kind === 'result') {
      if (x.variant !== y.variant || x.title !== y.title) return false
    } else {
      return false
    }
  }
  return true
}

/** 只保留仍能派生出来的 id，防止集合随历史无限增长 */
function prune(ids: string[], live: Set<string>): string[] {
  const next = ids.filter((id) => live.has(id))
  return next.length === ids.length ? ids : next
}

// ===== Store =====

interface NoticeState {
  /** 派生条目（已剔除被移除的；运行中条目永远在列表里） */
  items: NoticeItem[]
  /** 已读 id 集合 */
  readIds: string[]
  /** 已移除 id 集合（运行中条目不会进来） */
  dismissedIds: string[]
  /** 「首次运行」判定是否已做过（进程内一次性；测试可重置以复现首次运行） */
  seeded: boolean

  /** 从 workflow-store 当前状态重新派生（幂等；无变化不写 state） */
  sync: () => void
  /** 单条标记已读（运行中条目忽略） */
  markRead: (id: string) => void
  /** 全部已读（运行中条目不计入，也不会被记进已读集合） */
  markAllRead: () => void
  /** 单条移除（运行中条目不可移除） */
  dismiss: (id: string) => void
}

const persisted = loadPersisted()

export const useNoticeStore = create<NoticeState>()((set, get) => ({
  items: [],
  readIds: persisted.read,
  dismissedIds: persisted.dismissed,
  seeded: false,

  sync: () => {
    // ① 首次运行 seed（只做一次）：把「本次会话之前就存在」的条目记为已读，避免升级后凭空一堆未读
    if (!get().seeded) {
      set({ seeded: true })
      if (!hasPersistedKey()) {
        const existing = derive().candidates
          .filter((item) => !item.pinned) // 运行中条目永远不进已读集合
          .map((item) => item.id)
        // 合并而非覆盖：内存里已有的已读状态（理论上首次运行为空，但别赌）一律保留
        const seededRead = [...new Set([...get().readIds, ...existing])]
        set({ readIds: seededRead })
        // 即使 existing 为空也要落盘：键的存在本身就是「首次运行已处理」的标记
        savePersisted(seededRead, get().dismissedIds)
      }
    }

    // ② 正常派生
    const { candidates, items } = derive()
    const live = new Set(candidates.map((item) => item.id))
    const readIds = prune(get().readIds, live)
    const dismissedIds = prune(get().dismissedIds, live)

    const itemsChanged = !sameItems(items, get().items)
    const setsChanged = readIds !== get().readIds || dismissedIds !== get().dismissedIds
    if (!itemsChanged && !setsChanged) return

    set({ items, readIds, dismissedIds })
    if (setsChanged) savePersisted(readIds, dismissedIds)
  },

  markRead: (id) => {
    const { items, readIds } = get()
    const target = items.find((item) => item.id === id)
    if (!target || target.pinned || readIds.includes(id)) return
    const nextRead = [...readIds, id]
    set({ readIds: nextRead })
    savePersisted(nextRead, get().dismissedIds)
    // 重派生而非就地改 unread：条目字段只有一个来源（派生函数），避免两处口径漂移
    get().sync()
  },

  markAllRead: () => {
    const { items, readIds } = get()
    const unread = items.filter((item) => !item.pinned && item.unread)
    if (unread.length === 0) return
    const nextRead = [...readIds, ...unread.map((item) => item.id)]
    set({ readIds: nextRead })
    savePersisted(nextRead, get().dismissedIds)
    get().sync()
  },

  dismiss: (id) => {
    const { items, dismissedIds } = get()
    const target = items.find((item) => item.id === id)
    if (!target || target.pinned || dismissedIds.includes(id)) return
    const nextDismissed = [...dismissedIds, id]
    set({ dismissedIds: nextDismissed })
    savePersisted(get().readIds, nextDismissed)
    get().sync()
  },
}))
