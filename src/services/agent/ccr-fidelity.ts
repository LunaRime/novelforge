/**
 * CCR 压缩保真检查（P1-2）：零 LLM 成本的**实体保留率** —— 补上压缩链「可证明性
 * 只证省了 token、不证信息还在」的最后一环。
 *
 * 从被压缩批次里抽取三类高价值实体（只抽批次内**实际出现**的，避免误报）：
 * - 写入目标（write-target）：写/编辑类工具调用的目标文件（复用 B5 回执抽取，含失败项
 *   ——「写入失败」同样是后续轮次的关键事实）
 * - 角色名（character）：调用方传入的项目角色名清单 ∩ 批次文本
 * - 章节号（chapter）：批次文本中的「第 N 章 / Chapter N」引用（中文数字归一为阿拉伯数）
 *
 * 摘要文本逐字命中视为保留；保留率低于阈值时**只告警不拦截**——阻断替换会造成
 * 「为了完美而丢更多」（与 B2 可证明性取舍一致）。告警同时是自学习压缩的内容信号源。
 *
 * ⚠️ 已知误报面：别名 / 代词指代 / 章节号书写变体（如「十一」→「11」以外的复杂形态）
 * 会被记为缺失 —— 故阈值保守、只告警；不做 LLM 二次判定（成本随轮次线性上升）。
 */
import type { AgentMessage } from '../../stores/agent-store'
import { extractSideEffectReceipts } from './archive-codec'

export type FidelityEntityKind = 'write-target' | 'character' | 'chapter'

export interface FidelityEntity {
  kind: FidelityEntityKind
  /** 匹配值（chapter 为归一后的阿拉伯数字串；其余为原文本） */
  value: string
}

export interface FidelityReport {
  /** 抽到的实体总数 */
  extracted: number
  /** 在摘要文本中命中的实体数 */
  retained: number
  /** 保留率（无实体时视为 1，即无从告警） */
  ratio: number
  /** 缺失的实体（告警文案与自学习信号用） */
  misses: FidelityEntity[]
  /** 缺失实体涉及的类别（去重）——自学习按类别累积证据 */
  missingKinds: FidelityEntityKind[]
}

/** 告警阈值（保守：误报面见文件头注释；只告警不拦截） */
export const FIDELITY_WARN_RATIO = 0.6
/** 实体太少时不检查（样本太小，噪声大于信号） */
export const FIDELITY_MIN_ENTITIES = 3

/** 匹配归一：去空白 + 全角数字转半角（「第 3 章」≡「第3章」、「３」≡「3」） */
function normalizeForMatch(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

/** 中文数字（≤ 千位）转阿拉伯数字串；无法解析返回 null */
function cnNumToArabic(s: string): string | null {
  const digits: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  }
  if (/^[0-9]+$/.test(s)) return String(parseInt(s, 10))
  let total = 0
  let section = 0
  let num = 0
  let sawAny = false
  for (const ch of s) {
    if (ch === '十') {
      section += (num === 0 ? 1 : num) * 10
      num = 0
      sawAny = true
    } else if (ch === '百') {
      section += (num === 0 ? 1 : num) * 100
      num = 0
      sawAny = true
    } else if (ch in digits) {
      num = digits[ch]
      sawAny = true
    } else {
      return null
    }
  }
  total = section + num
  return sawAny ? String(total) : null
}

/** 章节号引用：中文「第 N 章」+ 英文「Chapter N」；返回归一后的阿拉伯数字串集合 */
export function extractChapterCores(text: string): Set<string> {
  const cores = new Set<string>()
  // 局部正则实例（共享 /g 有 lastIndex 状态，跨调用复用易踩坑）
  const re = /第\s*([0-9０-９一二三四五六七八九十百千零两]+)\s*章|Chapter\s+([0-9]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const raw = m[1] ?? m[2]
    if (!raw) continue
    const num = cnNumToArabic(normalizeForMatch(raw))
    if (num !== null) cores.add(num)
  }
  return cores
}

/**
 * 从被压缩批次抽取实体：
 * - 写入目标：复用回执抽取（同 target 只留最新；读类工具不进）
 * - 角色名：只抽「传入清单 ∩ 批次文本」的名字
 * - 章节号：归一为数字核心（第3章 / 第三章 / Chapter 3 → '3'）
 */
export function collectBatchEntities(
  batch: AgentMessage[],
  opts: { characterNames: string[] },
): FidelityEntity[] {
  const entities: FidelityEntity[] = []
  const seen = new Set<string>()
  const push = (kind: FidelityEntityKind, value: string): void => {
    if (!value) return
    const key = `${kind}:${value}`
    if (seen.has(key)) return
    seen.add(key)
    entities.push({ kind, value })
  }

  for (const receipt of extractSideEffectReceipts(batch)) push('write-target', receipt.target)

  const text = batch.map(m => m.content).join('\n')
  for (const name of opts.characterNames) {
    if (name && text.includes(name)) push('character', name)
  }
  for (const core of extractChapterCores(text)) push('chapter', core)

  return entities
}

/** 逐实体核对摘要文本；命中 = 保留（chapter 按数字核心比对，容忍书写变体） */
export function checkSummaryFidelity(entities: FidelityEntity[], summary: string): FidelityReport {
  const normSummary = normalizeForMatch(summary)
  const summaryChapterCores = extractChapterCores(summary)
  const misses: FidelityEntity[] = []
  let retained = 0
  for (const entity of entities) {
    const ok = entity.kind === 'chapter'
      ? summaryChapterCores.has(entity.value)
      : normSummary.includes(normalizeForMatch(entity.value))
    if (ok) retained++
    else misses.push(entity)
  }
  const extracted = entities.length
  return {
    extracted,
    retained,
    ratio: extracted === 0 ? 1 : retained / extracted,
    misses,
    missingKinds: [...new Set(misses.map(m => m.kind))],
  }
}

/** 是否达到告警条件（实体数达标 + 保留率低于阈值）——调用方据此留痕/标注；
 *  接受 Pick 形状：批次卡读存档里的 `batch.fidelity`（{extracted, retained, ratio}）同用 */
export function shouldWarnFidelity(report: Pick<FidelityReport, 'extracted' | 'ratio'>): boolean {
  return report.extracted >= FIDELITY_MIN_ENTITIES && report.ratio < FIDELITY_WARN_RATIO
}
