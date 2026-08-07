/**
 * 蓝图 role（章节定位）值归一化 — 纯函数，无依赖可单测
 *
 * 背景：生成模板按界面语言要求 LLM 输出 role 枚举——中文模板输出
 * 「建置/铺垫/发展/冲突/高潮/转折/收尾」，英文模板输出
 * 「Setup/Teaser/Development/Conflict/Climax/Twist/Wrap-up」。
 * 而 UI 下拉、排序 SQL、校验服务均以中文规范值为准，英文值落库后
 * 目录显示英文原样、下拉空白（beta.2 英文用户反馈）。
 *
 * 此处将解析层收口：任何语言/历史变体 → 中文规范值，非法值兜底「发展」
 * （与解析层既有默认一致，保证幂等——规范值原样返回）。
 */

/** 中文规范值（与生成模板、ChapterCardEditor ROLES 一致） */
const CANONICAL_ROLES = new Set(['建置', '铺垫', '发展', '冲突', '高潮', '转折', '收尾'])

/** 变体 → 规范值（key 为小写；中文无大小写，原样可查） */
const ROLE_ALIASES: Record<string, string> = {
  // 英文模板枚举（prompts/locales/en-US.ts）
  setup: '建置',
  teaser: '铺垫',
  development: '发展',
  conflict: '冲突',
  climax: '高潮',
  twist: '转折',
  'wrap-up': '收尾',
  // 英文 i18n label（locale-data chapter.roles）
  opening: '建置',
  buildup: '铺垫',
  ending: '收尾',
  // 中文历史变体（ChapterCreationDialog「开篇」、排序 SQL/校验服务「开端/结局」）
  开篇: '建置',
  开端: '建置',
  结局: '收尾',
  结尾: '收尾',
}

/** 默认兜底值（与解析层既有 `|| '发展'` 默认一致） */
const DEFAULT_ROLE = '发展'

/**
 * 归一化任意 LLM/用户输入的 role 值为中文规范值。
 * 幂等：规范值原样返回；空/非法值兜底「发展」。
 */
export function normalizeBlueprintRole(value: string): string {
  if (!value) return DEFAULT_ROLE
  const trimmed = value.trim()
  if (CANONICAL_ROLES.has(trimmed)) return trimmed
  return ROLE_ALIASES[trimmed.toLowerCase()] ?? DEFAULT_ROLE
}
