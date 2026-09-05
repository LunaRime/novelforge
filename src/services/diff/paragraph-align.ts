/**
 * paragraph-align — diff-core：段落抽取 + 相似度 DP 对齐 + 段级 hunk
 *
 * 从 ThreeWayMerge.tsx 抽取（L1 Task 1，R1 回归锁）：
 * - 纯函数、无 React/无副作用，可被三栏弹窗与 inline 会话（Task 2/5）共用；
 * - 弹窗路径 buildMergeSegments 与旧 computeSegments/buildSegments 语义逐字节等价
 *   （ThreeWayMerge.test.tsx 弹窗回归 4 条 + 本模块测试共同锁定）；
 * - inline 消费路径 computeParagraphHunks 额外返回带 char offsets 的 AlignedHunk，
 *   并把相邻 DELETE+INSERT 段对归一为整段替换（避免「先删后插」在段界粘连，设计 R6）。
 *
 * 迁移纪律：DP 主体（频率预计算 / dp / op 表 / 回溯）逐字保留，仅
 * 1) const enum AlignOp（数值）→ AlignOp string union（inline 会话需 JSON 序列化）；
 * 2) alignParagraphs 参数由 string[] 段落数组换成 ParaSpan[]，内部读取 p.text。
 */
export interface ParaSpan {
  text: string // 段文本（可含段内换行；CRLF 内容行的 \r 保留——与旧 extractParagraphs 语义一致）
  start: number // 段首非空行首字符在所属文本的 char offset
  end: number // 段末字符后一位置（不含段后换行/空行）
}

/** 对齐操作类型（string union——inline 会话需 JSON 序列化 kind） */
export type AlignOp = 'MATCH' | 'DELETE' | 'INSERT' | 'SPLIT_1_2' | 'SPLIT_1_3' | 'MERGE_2_1' | 'MERGE_3_1'

export interface AlignedPair {
  origIdx: number[]
  modIdx: number[]
}

/** 段级 hunk（computeParagraphHunks 产出；origRange 为传入 original 的 char offsets） */
export interface AlignedHunk {
  id: string
  kind: AlignOp
  origRange: { from: number; to: number }
  origText: string
  modText: string
}

/** 弹窗专用 hunk（三栏合并视图渲染形态） */
export interface MergeHunk {
  index: number
  originalLines: string[]
  modifiedLines: string[]
}

/** 弹窗 segment（旧 DiffSegment 语义，行为零变化） */
export interface MergeSegment {
  type: 'same' | 'hunk'
  lines?: string[]
  hunk?: MergeHunk
}

// ===== frontmatter / 段落 =====

/**
 * 去除 YAML frontmatter；返回正文与正文相对原文的偏移（R7：offset 需加回 frontmatter 长度）
 */
export function splitFrontmatter(text: string): { body: string; offset: number } {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return m ? { body: text.slice(m[0].length), offset: m[0].length } : { body: text, offset: 0 }
}

/**
 * 提取段落（空行是分隔符）+ 每段 char 偏移（相对传入 text）。
 * start = 段首非空行首字符；end = 段末字符后一位置（不含段后换行/空行）。
 * 逐行累计 offset，CRLF 下 \r 计入行宽（与 doc 字符一致，slice 回读自洽）。
 */
export function extractParagraphsWithOffsets(text: string): ParaSpan[] {
  const out: ParaSpan[] = []
  const lines = text.split('\n')
  let lineStart = 0
  let cur: string[] = []
  let curStart = -1
  let curEnd = -1
  const flush = () => {
    if (cur.length > 0) {
      out.push({ text: cur.join('\n'), start: curStart, end: curEnd })
      cur = []
    }
  }
  for (const line of lines) {
    const lineLen = line.length
    if (line.trim() === '') {
      flush() // 空行（含 CRLF 的 \r）分隔——与旧 extractParagraphs 的 trim()==='' 语义一致
    } else if (cur.length === 0) {
      curStart = lineStart
      curEnd = lineStart + lineLen
      cur.push(line)
    } else {
      curEnd = lineStart + lineLen
      cur.push(line)
    }
    lineStart += lineLen + 1 // +1 = 行尾换行符（\n）
  }
  flush()
  return out
}

// ===== 字符频率相似度 =====

/** 字符频率 map */
type CharFreq = Map<string, number>

function buildCharFreq(text: string): CharFreq {
  const freq: CharFreq = new Map()
  for (const c of text) freq.set(c, (freq.get(c) || 0) + 1)
  return freq
}

/** 合并多个频率 map */
function mergeFreqs(...maps: CharFreq[]): CharFreq {
  const merged: CharFreq = new Map()
  for (const m of maps) for (const [c, n] of m) merged.set(c, (merged.get(c) || 0) + n)
  return merged
}

/** 从预计算的频率 map 计算相似度（避免重复创建 Map） */
function simFromFreqs(fa: CharFreq, lenA: number, fb: CharFreq, lenB: number): number {
  if (lenA === 0 && lenB === 0) return 1
  if (lenA === 0 || lenB === 0) return 0
  // 长度比 >5 直接判定不相似（快速拒绝）
  if (lenA > lenB * 5 || lenB > lenA * 5) return 0
  let common = 0
  // 遍历较小的 map 提高效率
  const [smaller, larger] = fa.size <= fb.size ? [fa, fb] : [fb, fa]
  for (const [c, n] of smaller) common += Math.min(n, larger.get(c) || 0)
  return (2 * common) / (lenA + lenB)
}

// ===== DP 段落对齐算法 =====

/**
 * 基于相似度的 DP 段落对齐（性能优化版）
 * 预计算所有频率 map，避免 DP 循环中重复创建
 */
export function alignParagraphs(origParas: ParaSpan[], modParas: ParaSpan[]): AlignedPair[] {
  const n = origParas.length, m = modParas.length
  const SIM_THRESH = 0.15, GAP = -0.05

  // ===== 预计算频率 map =====
  const oFreqs = origParas.map(p => buildCharFreq(p.text))
  const mFreqs = modParas.map(p => buildCharFreq(p.text))
  const oLens = origParas.map(p => p.text.length)
  const mLens = modParas.map(p => p.text.length)

  // 预计算相邻 2/3 段落的合并频率（用于 split/merge）
  const mPairFreqs: CharFreq[] = new Array(m)
  const mPairLens: number[] = new Array(m)
  for (let j = 1; j < m; j++) {
    mPairFreqs[j] = mergeFreqs(mFreqs[j - 1], mFreqs[j])
    mPairLens[j] = mLens[j - 1] + mLens[j]
  }
  const mTriFreqs: CharFreq[] = new Array(m)
  const mTriLens: number[] = new Array(m)
  for (let j = 2; j < m; j++) {
    mTriFreqs[j] = mergeFreqs(mFreqs[j - 2], mFreqs[j - 1], mFreqs[j])
    mTriLens[j] = mLens[j - 2] + mLens[j - 1] + mLens[j]
  }
  const oPairFreqs: CharFreq[] = new Array(n)
  const oPairLens: number[] = new Array(n)
  for (let i = 1; i < n; i++) {
    oPairFreqs[i] = mergeFreqs(oFreqs[i - 1], oFreqs[i])
    oPairLens[i] = oLens[i - 1] + oLens[i]
  }
  const oTriFreqs: CharFreq[] = new Array(n)
  const oTriLens: number[] = new Array(n)
  for (let i = 2; i < n; i++) {
    oTriFreqs[i] = mergeFreqs(oFreqs[i - 2], oFreqs[i - 1], oFreqs[i])
    oTriLens[i] = oLens[i - 2] + oLens[i - 1] + oLens[i]
  }

  // ===== DP =====
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(-1e9))
  const op: AlignOp[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill('MATCH' as AlignOp))
  dp[0][0] = 0
  for (let i = 1; i <= n; i++) { dp[i][0] = i * GAP; op[i][0] = 'DELETE' }
  for (let j = 1; j <= m; j++) { dp[0][j] = j * GAP; op[0][j] = 'INSERT' }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = -1e9, bestOp: AlignOp = 'MATCH'

      // 1:1
      const s11 = simFromFreqs(oFreqs[i - 1], oLens[i - 1], mFreqs[j - 1], mLens[j - 1])
      const v11 = dp[i - 1][j - 1] + (s11 >= SIM_THRESH ? s11 : s11 - 0.5)
      if (v11 > best) { best = v11; bestOp = 'MATCH' }

      // 删除 / 插入
      if (dp[i - 1][j] + GAP > best) { best = dp[i - 1][j] + GAP; bestOp = 'DELETE' }
      if (dp[i][j - 1] + GAP > best) { best = dp[i][j - 1] + GAP; bestOp = 'INSERT' }

      // 1:2 拆分
      if (j >= 2) {
        const s = simFromFreqs(oFreqs[i - 1], oLens[i - 1], mPairFreqs[j - 1], mPairLens[j - 1])
        if (s >= SIM_THRESH) { const v = dp[i - 1][j - 2] + s * 0.95; if (v > best) { best = v; bestOp = 'SPLIT_1_2' } }
      }
      // 1:3 拆分
      if (j >= 3) {
        const s = simFromFreqs(oFreqs[i - 1], oLens[i - 1], mTriFreqs[j - 1], mTriLens[j - 1])
        if (s >= SIM_THRESH) { const v = dp[i - 1][j - 3] + s * 0.9; if (v > best) { best = v; bestOp = 'SPLIT_1_3' } }
      }
      // 2:1 合并
      if (i >= 2) {
        const s = simFromFreqs(oPairFreqs[i - 1], oPairLens[i - 1], mFreqs[j - 1], mLens[j - 1])
        if (s >= SIM_THRESH) { const v = dp[i - 2][j - 1] + s * 0.95; if (v > best) { best = v; bestOp = 'MERGE_2_1' } }
      }
      // 3:1 合并
      if (i >= 3) {
        const s = simFromFreqs(oTriFreqs[i - 1], oTriLens[i - 1], mFreqs[j - 1], mLens[j - 1])
        if (s >= SIM_THRESH) { const v = dp[i - 3][j - 1] + s * 0.9; if (v > best) { best = v; bestOp = 'MERGE_3_1' } }
      }

      dp[i][j] = best; op[i][j] = bestOp
    }
  }

  // 回溯构建对齐结果
  const pairs: AlignedPair[] = []
  let ci = n, cj = m
  while (ci > 0 || cj > 0) {
    if (ci === 0) { pairs.unshift({ origIdx: [], modIdx: [--cj] }); continue }
    if (cj === 0) { pairs.unshift({ origIdx: [--ci], modIdx: [] }); continue }
    switch (op[ci][cj]) {
      case 'MATCH':
        pairs.unshift({ origIdx: [ci - 1], modIdx: [cj - 1] }); ci--; cj--; break
      case 'DELETE':
        pairs.unshift({ origIdx: [ci - 1], modIdx: [] }); ci--; break
      case 'INSERT':
        pairs.unshift({ origIdx: [], modIdx: [cj - 1] }); cj--; break
      case 'SPLIT_1_2':
        pairs.unshift({ origIdx: [ci - 1], modIdx: [cj - 2, cj - 1] }); ci--; cj -= 2; break
      case 'SPLIT_1_3':
        pairs.unshift({ origIdx: [ci - 1], modIdx: [cj - 3, cj - 2, cj - 1] }); ci--; cj -= 3; break
      case 'MERGE_2_1':
        pairs.unshift({ origIdx: [ci - 2, ci - 1], modIdx: [cj - 1] }); ci -= 2; cj--; break
      case 'MERGE_3_1':
        pairs.unshift({ origIdx: [ci - 3, ci - 2, ci - 1], modIdx: [cj - 1] }); ci -= 3; cj--; break
    }
  }
  return pairs
}

// ===== 从对齐结果生成 MergeSegment（弹窗形态，语义与旧 buildSegments/computeSegments 等价） =====

function buildSegments(origParas: ParaSpan[], modParas: ParaSpan[], pairs: AlignedPair[]): MergeSegment[] {
  const segments: MergeSegment[] = []
  let hunkIdx = 0

  /** 段文本 → 行数组 */
  const paraToLines = (para: ParaSpan) => para.text.split('\n')

  /** 多段 → 行数组（段间插入空行） */
  const parasToLines = (paras: ParaSpan[], indices: number[]) => {
    const lines: string[] = []
    indices.forEach((idx, i) => {
      if (i > 0) lines.push('') // 段落间空行
      lines.push(...paraToLines(paras[idx]))
    })
    return lines
  }

  for (let p = 0; p < pairs.length; p++) {
    const pair = pairs[p]
    const origLines = pair.origIdx.length > 0 ? parasToLines(origParas, pair.origIdx) : []
    const modLines = pair.modIdx.length > 0 ? parasToLines(modParas, pair.modIdx) : []

    // 判断是否完全相同
    const isSame = origLines.length > 0 && modLines.length > 0 &&
      origLines.length === modLines.length &&
      origLines.every((l, i) => l === modLines[i])

    if (isSame) {
      segments.push({ type: 'same', lines: origLines })
    } else {
      segments.push({
        type: 'hunk',
        hunk: { index: hunkIdx++, originalLines: origLines, modifiedLines: modLines },
      })
    }

    // 段落之间插入空行同步锚点（最后一组不加）
    if (p < pairs.length - 1) {
      segments.push({ type: 'same', lines: [''] })
    }
  }
  return segments
}

/** 入口：计算弹窗 diff segments（与旧 ThreeWayMerge.computeSegments 语义一致，行为零变化） */
export function buildMergeSegments(original: string, modified: string): MergeSegment[] {
  const cleanOrig = splitFrontmatter(original).body
  const cleanMod = splitFrontmatter(modified).body
  const origParas = extractParagraphsWithOffsets(cleanOrig)
  const modParas = extractParagraphsWithOffsets(cleanMod)
  const pairs = alignParagraphs(origParas, modParas)
  return buildSegments(origParas, modParas, pairs)
}

// ===== 段级 hunk（inline 消费，含 DEL/INS 归一化） =====

/**
 * 计算段级 hunk（offset 已折算回「传入 original 的坐标」）。
 * 与 ThreeWayMerge.computeSegments 同语义（splitFrontmatter 逻辑保留）；
 * 差异 1：返回带 char 偏移的 AlignedHunk（hunk = 段文本有差异的对，kind 取该对的对齐操作）；
 * 差异 2（新增归一化，inline 消费用）：相邻且连续的「DELETE 段对 + INSERT 段对」
 *   （1:1 相似度 < SIM_THRESH 时 DP 会走 DELETE+INSERT 而非 MATCH，见 DP 打分）
 *   合并为单个整段替换 hunk（origRange = [删除段首, 删除段末]、kind='MATCH'），
 *   避免 inline 逐 hunk 接受时「先删后插」在段界产生粘连文本（设计 R6 同源防护）。
 *   弹窗路径不受影响——弹窗用 buildMergeSegments，保持旧的两段两 hunk 形态。
 */
export function computeParagraphHunks(original: string, modified: string): AlignedHunk[] {
  const { body: oBody, offset: oOff } = splitFrontmatter(original)
  const { body: mBody } = splitFrontmatter(modified)
  const oParas = extractParagraphsWithOffsets(oBody)
  const mParas = extractParagraphsWithOffsets(mBody)
  const pairs = alignParagraphs(oParas, mParas)

  const paraTexts = (paras: ParaSpan[], idxs: number[]): string =>
    idxs.map(i => paras[i].text).join('\n\n')

  // 收集 DELETE/INSERT 以便相邻合并
  const out: AlignedHunk[] = []
  let seq = 0
  const pushHunk = (pair: AlignedPair, kind: AlignOp) => {
    const oIdx = pair.origIdx
    const mIdx = pair.modIdx
    let from: number
    let to: number
    if (oIdx.length > 0) {
      from = oParas[oIdx[0]].start + oOff
      to = oParas[oIdx[oIdx.length - 1]].end + oOff
    } else {
      // 纯 INSERT：插在「下一个原文段起始」或正文末尾（段界近似，Task 5 的 A 路径不依赖此边界精度）
      const nextOrig = pairs
        .slice(pairs.indexOf(pair) + 1)
        .find(p => p.origIdx.length > 0)
      from = to = nextOrig ? oParas[nextOrig.origIdx[0]].start + oOff : oBody.length + oOff
    }
    out.push({
      id: `h${seq++}`,
      kind,
      origRange: { from, to },
      origText: paraTexts(oParas, oIdx),
      modText: paraTexts(mParas, mIdx),
    })
  }

  for (let p = 0; p < pairs.length; p++) {
    const pair = pairs[p]
    const same = pair.origIdx.length > 0 && pair.modIdx.length > 0 &&
      pair.origIdx.length === pair.modIdx.length &&
      pair.origIdx.every((oi, k) => oParas[oi].text === mParas[pair.modIdx[k]].text)
    if (same) continue // 完全相同的段对 → 无 hunk
    // 归一化：DELETE 后紧跟 INSERT → 合成整段替换（kind MATCH），跳过下一对
    const opKind = ((): AlignOp => {
      if (pair.origIdx.length === 0) return 'INSERT'
      if (pair.modIdx.length === 0) return 'DELETE'
      if (pair.origIdx.length === 2) return 'MERGE_2_1'
      if (pair.origIdx.length === 3) return 'MERGE_3_1'
      if (pair.modIdx.length === 2) return 'SPLIT_1_2'
      if (pair.modIdx.length === 3) return 'SPLIT_1_3'
      return 'MATCH'
    })()
    const next = pairs[p + 1]
    if (opKind === 'DELETE' && next && next.origIdx.length === 0) {
      const insertPair: AlignedPair = next
      const from = oParas[pair.origIdx[0]].start + oOff
      const to = oParas[pair.origIdx[pair.origIdx.length - 1]].end + oOff
      out.push({
        id: `h${seq++}`,
        kind: 'MATCH',
        origRange: { from, to },
        origText: paraTexts(oParas, pair.origIdx),
        modText: paraTexts(mParas, insertPair.modIdx),
      })
      p++ // 跳过 INSERT 对
      continue
    }
    pushHunk(pair, opKind)
  }
  return out
}
