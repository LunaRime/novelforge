/**
 * semantic 触发器 —— 唯一需要 LLM 的触发器（参照 Denova `internal/app/automation/semantic_trigger.go`）
 *
 * 三条安全边界（缺一不可）：
 * 1. **有界上下文**：倒序取最新章节，单章截断 1200 字符，总预算 64KiB（Denova 是 256KiB，NF 收紧）
 * 2. **证据校验**：`evidence_refs` 必须引用上下文中真实出现的 ref/title —— 编造证据**整条丢弃**，
 *    绝不降级为"无证据也触发"
 * 3. **失败不阻断**：模型调用失败 / JSON 非法 → 返回 null + 日志，同 tick 的其他触发器照常评估
 */
import { t } from '../../shared/locale'
import { renderLog } from '../render-logger'
import {
  SEMANTIC_CHAPTER_TRUNCATE,
  SEMANTIC_CONFIDENCE_THRESHOLD,
  SEMANTIC_CONTEXT_BUDGET,
  SEMANTIC_MAX_CHAPTERS,
  type SemanticEvaluation,
  type TriggerContext,
  type TriggerDefinition,
  type TriggerMatch,
} from './types'

export interface SemanticContext {
  text: string
  /** 上下文中真实出现过的 ref/title 集合（证据校验的白名单） */
  allowedRefs: Set<string>
}

/** 有界上下文构建：倒序（最新在前）、单章含头截断、总预算封顶 */
export function buildSemanticContext(
  chapters: Array<{ number: number; title: string; wordCount: number }>,
  readChapterText: (chapterNumber: number) => string,
): SemanticContext {
  const allowedRefs = new Set<string>()
  const parts: string[] = []
  let size = 0

  const recent = chapters.filter(c => c.wordCount > 0).slice().reverse().slice(0, SEMANTIC_MAX_CHAPTERS)

  for (const ch of recent) {
    const header = `【第 ${ch.number} 章 ${ch.title}】(ref: ${ch.number})\n`
    // 与上一块的分隔符也算进本章预算，保证"每章 ≤ SEMANTIC_CHAPTER_TRUNCATE"是硬上限
    const separator = parts.length > 0 ? 2 : 0
    const body = (readChapterText(ch.number) ?? '')
      .slice(0, Math.max(0, SEMANTIC_CHAPTER_TRUNCATE - header.length - separator))
    const block = header + body
    if (size + block.length + separator > SEMANTIC_CONTEXT_BUDGET) break
    parts.push(block)
    size += block.length + separator
    allowedRefs.add(String(ch.number))
    allowedRefs.add(ch.title)
  }

  return { text: parts.join('\n\n'), allowedRefs }
}

/** 提示词（四条约束写死；测试断言其存在） */
function buildPrompt(condition: string, contextText: string): string {
  return [
    '你是写作项目的状态判定器。根据下面的章节上下文，判断给定条件是否成立。',
    '',
    `条件：${condition}`,
    '',
    '严格约束：',
    '1. 证据不足时必须返回 matched=false，不要猜测。',
    `2. confidence 低于 ${SEMANTIC_CONFIDENCE_THRESHOLD} 视为不成立。`,
    '3. evidence_refs 只能引用上下文里出现过的章节号或标题，不得编造。',
    '4. 只输出 JSON，不要任何解释文字。',
    '',
    '输出格式：{"matched": boolean, "confidence": 0~1, "reason": "...", "title": "...", "evidence_refs": ["..."]}',
    '',
    '章节上下文：',
    contextText,
  ].join('\n')
}

/** 解析模型输出（容错提取 JSON 块）；形状或值域不合法一律 null */
export function parseSemanticEvaluation(raw: string): SemanticEvaluation | null {
  if (!raw) return null
  const jsonBlock = raw.match(/\{[\s\S]*\}/)
  if (!jsonBlock) return null

  let obj: unknown
  try {
    obj = JSON.parse(jsonBlock[0])
  } catch {
    return null
  }

  const o = obj as Record<string, unknown>
  const confidence = Number(o.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null

  const refs = Array.isArray(o.evidence_refs) ? o.evidence_refs.map(String) : []
  return {
    matched: o.matched === true,
    confidence,
    reason: String(o.reason ?? ''),
    title: String(o.title ?? ''),
    evidenceRefs: refs,
  }
}

/** 内容指纹（确定性；用于"同一条件 + 同一章节状态只触发一次"） */
function contentHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export async function evaluateSemantic(
  trigger: TriggerDefinition,
  ctx: TriggerContext,
): Promise<TriggerMatch | null> {
  const condition = trigger.semanticCondition?.trim()
  if (!condition || !ctx.callModel || !ctx.readChapterText) return null

  const bounded = buildSemanticContext(ctx.chapters, ctx.readChapterText)
  if (!bounded.text) return null

  let raw: string
  try {
    raw = await ctx.callModel(buildPrompt(condition, bounded.text))
  } catch (e) {
    renderLog('warn', 'Automation', `semantic 触发器模型调用失败：${String(e)}`)
    return null
  }

  const ev = parseSemanticEvaluation(raw)
  if (!ev || !ev.matched) return null
  if (ev.confidence < SEMANTIC_CONFIDENCE_THRESHOLD) return null

  // 证据校验：只要有一条引用不在有界上下文里（编造）→ 整条丢弃
  const verified = ev.evidenceRefs.filter(ref => bounded.allowedRefs.has(ref))
  if (ev.evidenceRefs.length !== verified.length) {
    renderLog('warn', 'Automation', 'semantic 触发器证据越界，已丢弃本次判定')
    return null
  }

  const chapterIdentity = ctx.chapters.filter(c => c.wordCount > 0).map(c => c.number).join(',')
  return {
    triggerId: trigger.id,
    title: ev.title || t('automation.trigger.semanticTitle'),
    summary: ev.reason,
    evidence: verified.map(ref => ({ source: 'semantic', title: ref, ref })),
    fingerprint: `semantic:${trigger.id}:${contentHash(condition)}:${contentHash(chapterIdentity)}`,
  }
}
