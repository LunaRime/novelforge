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
  // 俄语（P2-2：三语支持漏网——ru-RU 模型输出哨兵此前会污染 tags/cs_* 字段）
  'нет', 'нет данных', 'без изменений', 'нет изменений',
  'не изменился', 'не изменилась', 'не изменилось', 'ничего нового',
  // 占位符号
  '-', '—',
])

/** 去尾部标点（中英文句号/感叹/问号）后判断是否"无变化"占位值 */
export function isNoChangeValue(value: string): boolean {
  const s = String(value ?? '').trim().toLowerCase().replace(/[。.！!？?]+$/g, '')
  if (!s) return true
  if (NO_CHANGE_VARIANTS.has(s)) return true
  // 短语变体：'No new tags'、'no changes at all'
  if (s.startsWith('no new') || s.startsWith('no change') || s.startsWith('no changes')) return true
  // 俄语短语变体：'нет изменений по тегам' 等（含空格前缀，避免误伤 'небо' 等普通词）
  if (s.startsWith('нет ') || s.startsWith('без изменений')) return true
  return false
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
 * 入参可为字符串（逗号/顿号分隔）或数组（元素逐个归一化，含分隔符的元素
 * 不被拆分——与 architecture-workflow createCharacterExtractSteps 的
 * Array.isArray 分支语义对齐）。
 * 整串为哨兵（'无'/'No new tags'）或空 → ''（不覆盖旧标签）；
 * 混合列表剔除哨兵项；上限 8 个。
 */
export function normalizeTagsValue(value: unknown): string {
  if (Array.isArray(value)) {
    const tags = value
      .map(String)
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !isNoChangeValue(s))
    return tags.length > 0 ? JSON.stringify(tags.slice(0, 8)) : ''
  }
  const raw = String(value ?? '')
  if (isNoChangeValue(raw)) return ''
  const tags = raw
    .split(/[，,、;；]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !isNoChangeValue(s))
  return tags.length > 0 ? JSON.stringify(tags.slice(0, 8)) : ''
}

/**
 * 解析角色别名注册表（JSON 数组字符串 → string[]）。
 * 容错：数组元素逐个 trim 去空；字符串按逗号/顿号/分号拆分；非法 JSON → 空数组。
 * 供 matchCharacterName 与档案上下文抽取共用。
 */
export function parseAliases(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (Array.isArray(raw)) {
    return raw.map(String).map(s => s.trim()).filter(Boolean)
  }
  const s = String(raw).trim()
  if (!s || s === '[]') return []
  // 类 JSON 形态（{ 或 [ 开头）：必须可解析为数组，否则视为非法（不回退分隔符拆分）
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) return parsed.map(String).map(x => x.trim()).filter(Boolean)
    } catch {
      /* 非法 JSON → 空数组 */
    }
    return []
  }
  return s.split(/[，,、;；]/).map(x => x.trim()).filter(Boolean)
}

/**
 * 角色名匹配（P0-2 升级：别名注册表 + 存量双形态）：
 * 1. 精确匹配；
 * 2. DB 角色 aliases 注册表包含 rawName（昵称/称号/曾用名变体）；
 * 3. 别名格式「苏晚晴（苏夜）」→ 括号外优先、括号内兜底；
 * 4. 存量旧数据：DB 名带括号（历史写入）← LLM 无括号名，剥离后比对。
 */
export function matchCharacterName<T extends { name: unknown }>(
  characters: T[],
  rawName: string,
): T | undefined {
  const name = String(rawName ?? '').trim()
  const findByName = (n: string): T | undefined => characters.find(c => String(c.name) === n)
  const exact = findByName(name)
  if (exact) return exact
  // 别名注册表：LLM 输出昵称/称号 → DB 角色 aliases 包含该形态
  const aliasHit = characters.find(c => parseAliases((c as { aliases?: unknown }).aliases).includes(name))
  if (aliasHit) return aliasHit
  const m = name.match(/^(.*?)[（(]([^（）()]*)[）)]\s*$/)
  if (m) {
    return findByName(m[1]) ?? findByName(m[2])
  }
  // 存量旧数据：DB 名带括号（如「无名老乞丐（前魂师）」），LLM 输出无括号形态
  return characters.find(c => stripNameAlias(String(c.name)) === name)
}

/**
 * 剥离角色名尾部的括号别名/身份注释（#34 评估修复）：LLM 常输出
 * 「无名老乞丐（前魂师）」形态——若带括号名直接落库（角色名是唯一主键），
 * 后续 LLM 输出「无名老乞丐」时：NEW 去重精确匹配失败 → 重复创建；
 * UPDATES 匹配失败 → 更新静默跳过；正文精确扫描（互动检测/档案上下文）
 * 也永不命中。写入端统一剥离，保证主键稳定。
 * P0-2 升级：迭代剥离嵌套括号（「苏晚（苏夜（少主））」→「苏晚」），
 * 每次只剥"末尾且组内无未闭合括号"的最内层组；
 * 无括号 → 原样返回（幂等）；全括号名 → 返回空串（调用方空名保护兜底）。
 */
export function stripNameAlias(rawName: string): string {
  let name = String(rawName ?? '').trim()
  for (let i = 0; i < 4; i++) {
    const closeIdx = Math.max(name.lastIndexOf('）'), name.lastIndexOf(')'))
    // 末尾必须是闭括号（括号组在名字最尾），且其前存在开括号
    if (closeIdx === -1 || closeIdx !== name.length - 1) break
    const openIdx = Math.max(name.lastIndexOf('（'), name.lastIndexOf('('))
    if (openIdx === -1 || openIdx >= closeIdx) break
    // 找到该开括号对应的首个闭括号（即最内层组的闭合），剥离该组；
    // 嵌套时外层的闭括号保留（「苏晚（苏夜（少主））」→ 先剥「（少主）」→「苏晚（苏夜）」→「苏晚」）
    let innerClose = -1
    for (let j = openIdx + 1; j < name.length; j++) {
      if (name[j] === '）' || name[j] === ')') {
        innerClose = j
        break
      }
    }
    if (innerClose === -1) break
    const base = (name.slice(0, openIdx) + name.slice(innerClose + 1)).trim()
    if (!base) {
      name = '' // 全括号名 → 空串（调用方空名保护兜底）
      break
    }
    name = base
  }
  return name
}
