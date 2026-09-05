/**
 * selection-session — A 入口会话构建（纯函数，L1 Task 5）
 *
 * 把 (docText, selFrom, selTo) 的选区文本与 AI 输出（气泡 AI 改写结果）对齐成
 * DiffSession，交 editor-store.beginInlineSession 进入 inline 会话（Task 6 验收
 * 对象 1/2/4）。v1 采用「选区级对齐」（设计 §4.1「整文对齐后只保留选区 hunk」
 * 的 v1 精化）：
 * ① 选区边界不落在段界时，整文段对齐会把整段判为 MATCH（段级相似度 >
 *    SIM_THRESH），句内差异无法产出 hunk——选区级对齐保证句级子 hunk 必然覆盖
 *    实际改动（对齐基准 = 选区文本，非整 doc）；
 * ② 全量接受后的 doc 与旧「整体替换」语义逐字节一致（验收 3）。
 * 整文对齐仍保留给 v1.1 B 入口——computeParagraphHunks 在此仅作用于选区文本。
 *
 * 对齐语义：
 * - 选区文本视作独立文档（草稿正文无 frontmatter，splitFrontmatter 零偏移）；
 * - hunk 与子 hunk 的 origRange 均 + selFrom 折算回 doc 坐标（sub 由
 *   refineHunkWithSentences 产 doc 坐标后叠加；hunk 级不持 origRange——
 *   hunk-model Task 2 契约，定位挂在子 hunk）；
 * - AI 输出与选区文本 trim 等价（仅空白/换行差异）→ null（Task 1 reviewer
 *   归一化零重叠用例在此消费）；
 * - 无对齐 hunk（段级全同）或细分无子 hunk → null；返回的会话 decisions 为空表、
 *   SessionHunk.decision 全 pending（Task 3/4 单写路径接管）。
 */
import { computeParagraphHunks } from './paragraph-align'
import { refineHunkWithSentences } from './sentence-split'
import type { DiffSession, SessionHunk } from './hunk-model'

export function buildSelectionSession(
  docText: string,
  selFrom: number,
  selTo: number,
  aiText: string,
): DiffSession | null {
  const selText = docText.slice(selFrom, selTo)
  if (aiText.trim() === selText.trim()) return null

  // 选区文本当独立文档对齐（段内偏移在 refine 后 + selFrom 折算回 doc 坐标）
  const hunks = computeParagraphHunks(selText, aiText)
  if (hunks.length === 0) return null

  const sessionHunks: SessionHunk[] = hunks.map((h, i) => ({
    id: h.id,
    kind: h.kind,
    modText: h.modText,
    sub: refineHunkWithSentences(h).map(s => ({
      ...s,
      // 并入外层命名空间：refine 产 id 形如 h0.s0（Task 2），前缀 sel{i}. 防与
      // v1.1 B 入口会话 id 冲突；确定性由 Task 2 id 契约 + 本层索引共同保证
      id: `sel${i}.${s.id}`,
      parentId: h.id,
      origRange: { from: s.origRange.from + selFrom, to: s.origRange.to + selFrom },
    })),
    decision: 'pending',
  }))

  if (sessionHunks.some(h => h.sub.length === 0)) return null
  return {
    sessionId: `sel-${selFrom}-${selTo}-${Date.now()}`,
    sourceKind: 'selection',
    baseDocSnapshot: docText,
    hunks: sessionHunks,
    decisions: {},
  }
}
