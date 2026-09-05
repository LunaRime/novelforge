/**
 * sentence-split — 段内句级细分（纯函数，L1 Task 2）
 *
 * 消费 Task 1 的 AlignedHunk（段落对齐产物），产出句级 SubHunk（Task 3/4/5 消费）。
 * v1 子 hunk 语义（模块头注释 + sentence-split.test.ts 共同锁定）：
 * - 骨架 = 段 hunk（paragraph-align 产出）；默认展示 = 句级子 hunk；
 * - kind === 'MATCH'（1:1 替换段）做句级锚 LCS：与改文某句**归一 CRLF 后全等**的
 *   原句 = 锚句（灰显，不进子 hunk——接受/拒绝只作用 changed run）；
 *   连串非锚句（changed run）→ 一个子 hunk；锚句无匹配（整段重写）→ 降级整段；
 * - SPLIT/MERGE/INSERT/DELETE 等结构类 hunk 直接整段单子 hunk——结构差异需
 *   段界分隔符协同（段落粒度），超句粒度，v1 不展开（设计 §4.2「无锚降级」延伸）；
 * - 重组校验：把 changed run 的 modText 依次替换进 h.origText 后（归一 CRLF）≠
 *   h.modText（锚句被换行/结构差异隔开）→ 降级整段单子 hunk，保证
 *   「接受后 doc == 整体替换」逐字节成立（验收 3）；
 * - id = `${h.id}.s${seq}`、parentId = `${h.id}`——全确定性（决策表跨重挂载稳定）。
 *
 * CRLF 注意：splitSentences 产出句文本按 doc 字符（\r 计入 text/offsets，
 * slice 回读自洽）；锚比较/重组校验用 norm() 归一 \r\n → \n（Task 1 评审 Note：
 * CRLF 下段文本可能含 \r，消费侧归一）。
 */
import type { AlignedHunk } from './paragraph-align'
import type { SubHunk } from './hunk-model'

export interface Sentence { text: string; start: number; end: number }

/**
 * 句子切分：边界标点 。！？…；与换行（含 CRLF）收归句尾。
 * 连续分隔符之间若 trim 为空（如空行 \n\n）不产出空句；
 * CRLF 的 \r 计入前一句 text 与 offsets（doc 字符一致），锚比较时归一化。
 */
export function splitSentences(para: string): Sentence[] {
  const out: Sentence[] = []
  let from = 0
  let i = 0
  const push = (end: number) => {
    const text = para.slice(from, end)
    if (text.trim() !== '') out.push({ text, start: from, end })
    from = end
  }
  while (i < para.length) {
    const ch = para[i]
    if (ch === '\n' || ch === '。' || ch === '！' || ch === '？' || ch === '…' || ch === '；') {
      push(i + 1)
      i = i + 1
    } else {
      i++
    }
  }
  push(para.length)
  return out
}

const norm = (t: string): string => t.replace(/\r\n/g, '\n')

/**
 * 锚句 LCS 细分（v1 语义见模块头注释）：
 * - kind === 'MATCH'：句级 LCS（全等锚句）；changed run → 子 hunk（offsets = h.origRange.from + 段内偏移）
 * - 其他结构类 kind / 无锚 / 重组校验失败 → 整段单子 hunk（origRange = h.origRange）
 */
export function refineHunkWithSentences(h: AlignedHunk): SubHunk[] {
  const degrade = (): SubHunk[] => [{
    id: `${h.id}.s0`, parentId: h.id,
    origRange: { ...h.origRange }, origText: h.origText, modText: h.modText,
  }]
  if (h.kind !== 'MATCH') return degrade()

  const origS = splitSentences(h.origText)
  const modS = splitSentences(h.modText)
  // LCS（全等锚，归一 CRLF）
  const dp: number[][] = Array.from({ length: origS.length + 1 }, () => new Array(modS.length + 1).fill(0))
  for (let i = 1; i <= origS.length; i++) {
    for (let j = 1; j <= modS.length; j++) {
      dp[i][j] = norm(origS[i - 1].text) === norm(modS[j - 1].text)
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  // 回溯：匹配 = 锚句（不产出）；origS-only / modS-only 汇入当前 changed run
  interface Run { orig: Sentence[]; mod: Sentence[] }
  const runs: Run[] = []
  let run: Run | null = null
  let i = origS.length
  let j = modS.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && norm(origS[i - 1].text) === norm(modS[j - 1].text)) {
      run = null // 锚句：闭合 run（锚句不被接受/替换）
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      if (!run) { run = { orig: [], mod: [] }; runs.unshift(run) }
      run.mod.unshift(modS[j - 1]); j--
    } else {
      if (!run) { run = { orig: [], mod: [] }; runs.unshift(run) }
      run.orig.unshift(origS[i - 1]); i--
    }
  }
  // ---- run → SubHunk 换算（doc 坐标 = h.origRange.from + 段内偏移） ----
  // 降级条件（任一命中 → 整段单子 hunk，见模块头 v1 语义）：
  //  a) 存在纯 mod run（orig 侧为空 = AI 在锚句之间插了新句，无替换区间可锚——v1 不拆解，整段接受兜底）
  //  b) runs 为空且 h.origText !== h.modText（句子全同但段界/换行结构变了，LCS 无 changed run）
  //  c) 重组校验失败：把各 run 的 modText 依次替换进 h.origText 后 ≠ h.modText（归一 CRLF）——
  //     锚句被换行/结构差异隔开时 LCS 无法表达，降级保证「接受后 doc == 整体替换」（验收 3）
  const composeByRuns = (): string => {
    let out = h.origText
    let cursor = 0
    for (const r of runs) {
      if (r.orig.length === 0) return out // 纯插 run 由 (a) 降级兜底，此处不可能到达
      const origText = r.orig.map(s => s.text).join('')
      const idx = out.indexOf(origText, cursor)
      if (idx < 0) return out // 理论不可达（runs 来自 h.origText 的句切分）
      const modText = r.mod.map(s => s.text).join('')
      out = out.slice(0, idx) + modText + out.slice(idx + origText.length)
      cursor = idx + modText.length
    }
    return out
  }
  if (runs.some(r => r.orig.length === 0)) return degrade()
  if (runs.length === 0) return h.origText === h.modText ? [] : degrade()
  if (norm(composeByRuns()) !== norm(h.modText)) return degrade()
  return runs.map((r, k) => {
    const from = h.origRange.from + r.orig[0].start
    const to = h.origRange.from + r.orig[r.orig.length - 1].end
    return {
      id: `${h.id}.s${k}`, parentId: h.id,
      origRange: { from, to },
      origText: r.orig.map(s => s.text).join(''),
      modText: r.mod.map(s => s.text).join(''),
    } as SubHunk
  })
}
