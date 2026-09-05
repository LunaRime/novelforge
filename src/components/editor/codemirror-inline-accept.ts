/**
 * codemirror-inline-accept — L1 inline 接受的 CodeMirror 内核（Task 4，无 React）
 *
 * 职责：hunk 区间 StateField + decorations、会话区间动态注入（setHunkRanges）、
 * pending/rejected 区编辑冻结（changeFilter）、接受事务唯一 doc 改写入口
 * （dispatchAcceptChange：显式递增 Transaction.time + userEvent 标注）与
 * 重挂载重建辅助（deriveRangesFromDoc）/ 浮层命中（findPendingRangeAt）。
 *
 * 行为兼容（R3）：本模块扩展常驻 CodeMirrorEditor（inlineAcceptExtensions 无条件挂载），
 * 无会话时 field 空、无装饰、changeFilter 直通 —— 对编辑器零可感知影响。
 *
 * 冻结语义（R6，实测 @codemirror/commands@6.10.4 history 源）：
 * - 真实 CM 用户输入均带 userEvent（input.type / delete.* / move.* / indent 等前缀）；
 *   undo/redo 事务只带内部 fromHistory 标注（无 userEvent），程序化 dispatch 亦无。
 * - 故 changeFilter 只拦「输入类 userEvent 事务 ∩ pending/rejected 区间」：
 *   自身接受事务（INLINE_ACCEPT_EVENT）、undo/redo、外部同步（addToHistory:false）、
 *   其它程序化事务一律放行 —— 保证接受可被逐步 Ctrl+Z 还原且不被自己的冻结拦截。
 * - 区间外的手动编辑放行后由组件 handleUpdate 的「手动编辑退出」兜底（R6 简化策略）。
 */
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
} from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { DiffSession } from '../../services/diff/hunk-model'

/** 接受事务的 userEvent 标注值（handleUpdate / changeFilter 区分自身接受） */
export const INLINE_ACCEPT_EVENT = 'input.inline.accept'

/** doc 当前坐标的会话区间（accepted 子句已替换入 doc 不保留区间；rejected 原文仍在 doc） */
export interface InlineHunkRange {
  id: string
  decision: 'pending' | 'rejected'
  from: number
  to: number
}

/** 会话区间动态注入（begin / 决策变更 / 重挂载时由组件 dispatch） */
export const setHunkRanges = StateEffect.define<InlineHunkRange[]>()

/** accepted 视觉类名（供测试/主题引用；本期 doc 内不画 accepted 装饰） */
export const ACCEPTED_DECO_CLASS = 'nf-ia-accepted'

const pendingMark = Decoration.mark({ class: 'nf-ia-pending' })
const rejectedMark = Decoration.mark({ class: 'nf-ia-rejected' })

function buildDeco(ranges: InlineHunkRange[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  for (const r of ranges) {
    if (r.to > r.from) b.add(r.from, r.to, r.decision === 'pending' ? pendingMark : rejectedMark)
  }
  return b.finish()
}

/**
 * 判定事务是否来自真实 CM 用户输入（键入/删除/拖行/缩进等）。
 * undo/redo 只带内部 fromHistory 标注、程序化 dispatch 无标注 —— 均不算手动编辑。
 */
const MANUAL_INPUT_EVENT = /^(input|delete|move|indent)(\.|$)/
export function isManualUserEdit(userEvent: string | undefined): boolean {
  return !!userEvent && MANUAL_INPUT_EVENT.test(userEvent)
}

/**
 * 事务改动区间是否与给定 ranges 相交（pending/rejected 区内容被触碰）。
 * changeFilter（无 view）与组件 handleUpdate（I1：无 userEvent 的程序化改动——Bold/Tab/
 * 气泡替换——落在区间内也要退出会话）共用同一判定；iterChanges 需回调形式，返回 false 提前中止。
 */
export function changesIntersectRanges(tr: Transaction, ranges: InlineHunkRange[]): boolean {
  if (ranges.length === 0) return false
  let hit = false
  tr.changes.iterChanges((fromA, toA) => {
    if (ranges.some(r => fromA < r.to && toA > r.from)) {
      hit = true
      return false
    }
    return undefined
  })
  return hit
}

/**
 * 只拦「输入类 userEvent」落在 pending/rejected 区间内的改动；其余放行。
 * 语义（I1 复审后保持）：changeFilter 负责把真实输入的区间内改动拦在 doc 外；
 * 无 userEvent 的程序化改动（Bold/Tab/气泡替换等）不由 filter 拦（doc 层面它们会
 * 真的改写区间）——漂移防护由组件 handleUpdate 的「改动触碰区间 → 退出会话」兜底。
 */
const freezeChange: (tr: Transaction) => boolean = (tr) => {
  const userEvent = tr.annotation(Transaction.userEvent)
  if (userEvent === INLINE_ACCEPT_EVENT) return true // 自身接受事务（替换 pending 区间）不拦
  if (!isManualUserEdit(userEvent)) return true // undo/redo/外部同步/程序化事务不拦
  // changeFilter 只收 Transaction（无 view）：区间状态取 startState（field 与 facet 同配置常驻）
  const { ranges } = tr.startState.field(inlineAcceptField)
  return !changesIntersectRanges(tr, ranges)
}

export const inlineAcceptField = StateField.define<{ ranges: InlineHunkRange[]; deco: DecorationSet }>({
  create: () => ({ ranges: [], deco: Decoration.none }),
  update(value, tr) {
    let ranges = value.ranges
    if (tr.docChanged) {
      // ranges 随 doc 变化映射（接受/undo/外部同步后其余 pending 区间自动平移）
      ranges = ranges
        .map(r => ({ ...r, from: tr.changes.mapPos(r.from), to: tr.changes.mapPos(r.to) }))
        .filter(r => r.to - r.from > 0)
    }
    for (const effect of tr.effects) {
      if (effect.is(setHunkRanges)) ranges = effect.value
    }
    return { ranges, deco: buildDeco(ranges) }
  },
  provide: f => EditorView.decorations.from(f, value => value.deco),
})

/**
 * 常驻扩展（无会话时 field 空 + filter 直通 = 零可见影响，R3）；
 * 会话期由组件以 setHunkRanges 动态驱动，无需 reconfigure。
 */
export function inlineAcceptExtensions(): Extension[] {
  return [inlineAcceptField, EditorState.changeFilter.of(freezeChange)]
}

/**
 * 接受 = 唯一 doc 改写入口：带显式 Transaction.time（R4，规避 CM history 500ms
 * 事件合并——实测 joinableUserEvent=/^(input\.type|delete)($|\.)/ 亦不合并本事件）
 * + userEvent 标注（供 handleUpdate 区分「自身接受事务 / 用户手动编辑」，
 * 供 changeFilter 豁免自身替换）。
 */
export function dispatchAcceptChange(
  view: EditorView, range: { from: number; to: number }, insert: string, time: number,
): void {
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from },
    annotations: [
      Transaction.time.of(time),
      Transaction.userEvent.of(INLINE_ACCEPT_EVENT),
    ],
  })
}

/**
 * 重挂载/会话重建：按 doc 序 indexOf 定位未决（pending/rejected）子句；
 * accepted 已替换入 doc → 跳过；找不到（已被手动/历史改动移除）→ 跳过不装饰。
 */
export function deriveRangesFromDoc(session: DiffSession, docText: string): InlineHunkRange[] {
  const out: InlineHunkRange[] = []
  let cursor = 0
  for (const h of session.hunks) {
    for (const s of h.sub) {
      const d = session.decisions[s.id]
      if (d === 'accepted') continue // 已替换入 doc
      const idx = docText.indexOf(s.origText, cursor)
      if (idx < 0) continue // 手动/历史改动已移除该文本 → 不装饰
      out.push({ id: s.id, decision: d ?? 'pending', from: idx, to: idx + s.origText.length })
      cursor = idx + s.origText.length
    }
  }
  return out
}

/** 浮层命中：pos 落在 pending 区间内（半开 [from, to)——段边界/空白处不算命中；
 *  rejected 划除段不可再裁决，不命中） */
export function findPendingRangeAt(view: EditorView, pos: number): InlineHunkRange | null {
  const { ranges } = view.state.field(inlineAcceptField)
  const r = ranges.find(x => pos >= x.from && pos < x.to)
  return r && r.decision === 'pending' ? r : null
}

/**
 * 浮层命中（final review I-1 误拒恢复入口）：pos 落在「未接受」区间内
 * （pending 或 rejected，半开 [from, to)）。accepted 已替换入 doc、不在 field；
 * rejected 划除段原文仍在 doc——点开浮层可经「恢复为待定」撤销误拒。
 * findPendingRangeAt 保持 pending-only 语义（既有调用方/测试不变）。
 */
export function findRestorableRangeAt(view: EditorView, pos: number): InlineHunkRange | null {
  const { ranges } = view.state.field(inlineAcceptField)
  const r = ranges.find(x => pos >= x.from && pos < x.to)
  return r && (r.decision === 'pending' || r.decision === 'rejected') ? r : null
}
