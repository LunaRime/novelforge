/**
 * 角色卡 LLM 输出归一化 — 纯函数，无依赖可单测
 *
 * 背景：定稿后处理 update_character_cards 依赖中文哨兵（'无'/'无变化'）判断
 * "无更新"（prompt 指示"tags/motivation 无变化填无"）。英文模板指示填英文哨兵，
 * 但 LLM 实际输出变体繁多（'none.'/'No new tags'/'not applicable'/'unchanged'/
 * '-' 等），精确匹配漏网 → tags/motivation 被垃圾串替换、cs_* 动态状态被
 * 'none' 字面量覆盖（beta.2 英文用户"定稿后角色卡被重置"残留路径）。
 *
 * 此处统一为变体感知的哨兵判定 + 枚举归一化，供 finalize/提取链路共用。
 */

/** 无变化哨兵（trim + 小写 + 去尾部标点后比对） */
const NO_CHANGE_VARIANTS = new Set([
  // 中文
  '无', '无变化', '无更新', '无新增', '无新',
  // 英文
  'none', 'nothing', 'nil', 'n/a', 'na',
  'no change', 'no changes', 'no update', 'no updates',
  'not applicable', 'unchanged', 'same',
  // 占位符号
  '-', '—',
])

/** 去尾部标点（中英文句号/感叹/问号）后判断是否"无变化"占位值 */
export function isNoChangeValue(value: string): boolean {
  const s = String(value ?? '').trim().toLowerCase().replace(/[。.！!？?]+$/g, '')
  if (!s) return true
  if (NO_CHANGE_VARIANTS.has(s)) return true
  // 短语变体：'No new tags'、'no changes at all'
  return s.startsWith('no new') || s.startsWith('no change') || s.startsWith('no changes')
}

/** 角色 role 枚举（模板输出 protagonist/antagonist/supporting/minor） */
const VALID_CHARACTER_ROLES = new Set(['protagonist', 'antagonist', 'supporting', 'minor'])

/** 归一化角色 role：大小写变体 → 小写规范枚举；非法/空值兜底 supporting */
export function normalizeCharacterRole(value: string): string {
  const s = String(value ?? '').trim().toLowerCase()
  return VALID_CHARACTER_ROLES.has(s) ? s : 'supporting'
}

/**
 * 归一化 LLM 输出的 tags 为 JSON 数组字符串（角色列表按 JSON.parse 消费）。
 * 整串为哨兵（'无'/'No new tags'）或空 → ''（不覆盖旧标签）；
 * 混合列表剔除哨兵项；上限 8 个。
 */
export function normalizeTagsValue(value: string): string {
  const raw = String(value ?? '')
  if (isNoChangeValue(raw)) return ''
  const tags = raw
    .split(/[，,、;；]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !isNoChangeValue(s))
  return tags.length > 0 ? JSON.stringify(tags.slice(0, 8)) : ''
}
