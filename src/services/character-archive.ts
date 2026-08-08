// src/services/character-archive.ts
import { robustParseJSON } from './workflows/workflow-utils'
import { isNoChangeValue, normalizeTagsValue, stripNameAlias } from './character-normalize'

export interface ChapterContent { chapterNumber: number; content: string }
export interface RoleContextSegment { chapterNumber: number; text: string }

/** 按角色名出现位置抽取 ±window 字上下文段落;maxSegments 预算截断(重叠段不合并——预算上限保证 token 可控) */
export function extractRoleContextSegments(
  chapters: ChapterContent[],
  name: string,
  windowChars = 800,
  maxSegments = 8,
): RoleContextSegment[] {
  const segments: RoleContextSegment[] = []
  // #34：双形态扫描——历史数据可能含「无名老乞丐（前魂师）」整名，正文只写
  // 「无名老乞丐」；完整名与剥离形态都扫，否则该角色档案生成零上下文
  const forms = [...new Set([name, stripNameAlias(name)])].filter(Boolean)
  for (const ch of chapters) {
    for (const form of forms) {
      let idx = ch.content.indexOf(form)
      while (idx !== -1) {
        const start = Math.max(0, idx - windowChars)
        const end = Math.min(ch.content.length, idx + form.length + windowChars)
        segments.push({ chapterNumber: ch.chapterNumber, text: ch.content.slice(start, end) })
        if (segments.length >= maxSegments) return segments
        idx = ch.content.indexOf(form, idx + form.length)
      }
    }
  }
  return segments
}

/** 档案 10 字段键(mergeFields 白名单) */
export const ARCHIVE_FIELDS = ['gender', 'age', 'appearance', 'personality', 'background', 'abilities', 'motivation', 'relationships', 'arc', 'notes'] as const

/** 任一档案字段为空/哨兵 → 需要生成(前置过滤省 token) */
export function hasBlankArchiveFields(char: Record<string, unknown>): boolean {
  return ARCHIVE_FIELDS.some(f => {
    const v = String(char[f] ?? '').trim()
    return v === '' || isNoChangeValue(v)
  })
}

/** LLM JSON 输出 → 档案字段白名单归一化;非法 → null */
export function parseArchiveJson(raw: string, charName: string): Record<string, string> | null {
  void charName // 签名保留 charName(接口契约),当前实现不依赖角色名
  const parsed = robustParseJSON(raw, false)
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const f of ARCHIVE_FIELDS) {
    const v = obj[f]
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s && !isNoChangeValue(s)) out[f] = s
  }
  if (obj.tags !== undefined && obj.tags !== null) {
    // 直接传原始值:normalizeTagsValue 的 Array.isArray 分支对数组元素逐个归一化
    // (不走分隔符 split——含逗号的元素不会被拆碎,与 architecture-workflow
    // createCharacterExtractSteps 的 Array.isArray 分支对齐)
    const tags = normalizeTagsValue(obj.tags)
    if (tags) out.tags = tags
  }
  return Object.keys(out).length > 0 ? out : null
}
