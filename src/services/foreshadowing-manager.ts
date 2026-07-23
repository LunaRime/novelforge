/**
 * NovelForge 伏笔管理器 — 追踪全书伏笔的设置与回收
 *
 * 每章定稿后自动扫描：
 * 1. 本章新增的伏笔（新物品/新人物/新谜团/预言）
 * 2. 可回收的旧伏笔（匹配章节中的回收事件）
 *
 * 写稿时注入待回收伏笔列表，确保 AI 不会遗忘。
 */

import { ipc } from './ipc-client'

// ===== 类型定义 =====

export interface ForeshadowingItem {
  id: string
  /** 伏笔内容 */
  content: string
  /** 设置章节 */
  setChapter: number
  /** 回收章节（0 = 未回收） */
  resolvedChapter: number
  /** 类型 */
  type: 'item' | 'character' | 'mystery' | 'prophecy' | 'conflict'
  /** 是否已回收 */
  resolved: boolean
  /** 创建时间 */
  createdAt: string
}

export interface ForeshadowingReport {
  /** 全部伏笔 */
  all: ForeshadowingItem[]
  /** 待回收 */
  pending: ForeshadowingItem[]
  /** 本章新增 */
  newInChapter: ForeshadowingItem[]
  /** 本章回收 */
  resolvedInChapter: ForeshadowingItem[]
}

// ===== 核心函数 =====

/** 生成基于内容的唯一 ID（避免 Date.now() 碰撞和同义重复） */
function makeId(chapterNumber: number, text: string, type: string): string {
  const hash = `${chapterNumber}_${type}_${text}`.slice(0, 50).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
  return `fs_${hash}`
}

/**
 * 扫描章节内容，提取新增伏笔
 */
export function scanNewForeshadowing(
  content: string,
  chapterNumber: number,
): ForeshadowingItem[] {
  const items: ForeshadowingItem[] = []

  // 检测"神秘物品"类伏笔
  const itemPatterns = [
    /(?:发现|捡到|获得|得到|继承|传承)(?:了)?(?:一[枚把柄张颗粒瓶份] )?([^，。；]{3,20}(?:戒指|剑|刀|枪|丹[药丸]|秘籍|功法|法宝|灵器|神器|令牌|地图|钥匙|玉简|卷轴|遗物|宝[物藏箱]))/g,
    /([^，。；]{2,10}(?:戒指|剑|刀|枪|丹药|秘籍|法宝))(?:(?:发[光亮]|震动|共鸣|异[变动]|显[灵圣]))/g,
  ]
  for (const p of itemPatterns) {
    let m: RegExpExecArray | null
    while ((m = p.exec(content)) !== null) {
      const matchText = m[0].trim()
      items.push({
        id: makeId(chapterNumber, matchText, 'item'),
        content: `第${chapterNumber}章: ${matchText}`,
        setChapter: chapterNumber,
        resolvedChapter: 0,
        type: 'item',
        resolved: false,
        createdAt: new Date().toISOString(),
      })
    }
  }

  // 检测"谜团/悬念"类伏笔
  const mysteryPatterns = [
    /(?:究竟|到底)([^？?]{5,30})(?:？|\?)/g,
    /(?:谜[团题]|秘密|真相|来历不明|身世)([^。；！]{3,20})/g,
  ]
  for (const p of mysteryPatterns) {
    let m: RegExpExecArray | null
    while ((m = p.exec(content)) !== null) {
      const matchText = m[0].trim()
      items.push({
        id: makeId(chapterNumber, matchText, 'mystery'),
        content: `第${chapterNumber}章: ${matchText}`,
        setChapter: chapterNumber,
        resolvedChapter: 0,
        type: 'mystery',
        resolved: false,
        createdAt: new Date().toISOString(),
      })
    }
  }

  // 检测"预言/预示"类伏笔
  const prophecyPattern = /(?:预言|预示|未来|终将|注定|必将|命运)([^。；！]{4,30})/g
  let m2: RegExpExecArray | null
  while ((m2 = prophecyPattern.exec(content)) !== null) {
    const matchText = m2[0].trim()
    items.push({
      id: makeId(chapterNumber, matchText, 'prophecy'),
      content: `第${chapterNumber}章: ${matchText}`,
      setChapter: chapterNumber,
      resolvedChapter: 0,
      type: 'prophecy',
      resolved: false,
      createdAt: new Date().toISOString(),
    })
  }

  // 基于内容去重（同一文本 + 同一类型 → 保留一个）
  const seen = new Set<string>()
  const deduped = items.filter(item => {
    const key = `${item.type}_${item.content}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return deduped.slice(0, 5) // 每章最多 5 个新伏笔
}

/**
 * 检测本章是否回收了旧伏笔
 */
export function detectResolvedForeshadowing(
  content: string,
  pendingItems: ForeshadowingItem[],
  chapterNumber: number,
): ForeshadowingItem[] {
  const resolved: ForeshadowingItem[] = []

  for (const item of pendingItems) {
    const keywords = item.content.replace(/第\d+章[:：]\s*/, '').slice(0, 20)
    const keywordParts = keywords.split(/[，。；！？\s]+/).filter(k => k.length >= 2)

    let matchCount = 0
    for (const kw of keywordParts) {
      if (content.includes(kw)) matchCount++
    }

    if (keywordParts.length > 0 && matchCount / keywordParts.length >= 0.6) {
      resolved.push({ ...item, resolvedChapter: chapterNumber, resolved: true })
    }
  }

  return resolved
}

/**
 * 保存伏笔列表到项目配置
 */
export async function saveForeshadowing(items: ForeshadowingItem[]): Promise<void> {
  try {
    const core = await ipc.invoke('db:project-core-get')
    if (core) {
      let states: Record<string, unknown> = {}
      try { states = JSON.parse(core.characterStates || '{}') } catch { /* ignore */ }
      states.pendingForeshadowing = items.filter(i => !i.resolved).map(i => i.content)
      await ipc.invoke('db:project-core-update', { characterStates: JSON.stringify(states) })
    }
  } catch (e) { console.warn('[foreshadowing] 保存伏笔失败:', e) }
}

/**
 * 加载全部伏笔（从 pendingForeshadowing 读取，与 saveForeshadowing 键名一致）
 */
export async function loadAllForeshadowing(): Promise<ForeshadowingItem[]> {
  try {
    const core = await ipc.invoke('db:project-core-get')
    if (core?.characterStates) {
      const states = JSON.parse(core.characterStates)
      if (states.pendingForeshadowing) return states.pendingForeshadowing
    }
  } catch { /* ignore */ }
  return []
}

/**
 * 格式化待回收伏笔列表（用于 prompt 注入）
 */
export function formatPendingForPrompt(items: ForeshadowingItem[]): string {
  const pending = items.filter(i => !i.resolved)
  if (pending.length === 0) return ''
  return pending.map((f, i) => `${i + 1}. [第${f.setChapter}章] ${f.content} (${f.type})`).join('\n')
}

// ===== LLM 语义确认（降低误报率） =====

/**
 * 使用 LLM 对正则候选进行语义确认
 *
 * 正则匹配的 "发现戒指" 可能只是普通描写（如 "她发现了桌上的戒指"），
 * 而非真正的伏笔设置。通过 LLM 进行二次确认可以大幅降低误报率。
 *
 * @param candidates 正则筛选出的候选伏笔
 * @param chapterContent 完整章节内容（提供上下文）
 * @returns 经 LLM 确认的伏笔列表
 */
export async function confirmForeshadowingWithLLM(
  candidates: ForeshadowingItem[],
  chapterContent: string,
): Promise<ForeshadowingItem[]> {
  if (candidates.length === 0) return []

  try {
    const { useLLMStore } = await import('../stores/llm-store')
    const llm = useLLMStore.getState()

    // 构建候选列表供 LLM 判断
    const candidateList = candidates
      .map((c, i) => `${i + 1}. [${c.type}] "${c.content}"`)
      .join('\n')

    const prompt = `你是一位专业的小说分析编辑。请判断以下从章节中提取的候选伏笔是否**真正设置了伏笔**。

伏笔的定义：作者刻意设置的、将在后续章节中发挥作用的信息、物品、谜团或冲突线索。
非伏笔的例子：普通描写（"她戴上戒指出门"）、日常行为（"他捡起掉落的笔"）。

章节内容（片段）：
${chapterContent.slice(0, 3000)}

候选伏笔列表：
${candidateList}

请只输出一个 JSON 数组，包含**确认为真正伏笔**的候选编号。格式：{"confirmed": [1, 3, 5]}

注意：
- 排除"普通描写"和"日常行为"（如穿戴、丢失、借用物品等非情节驱动的动作）
- 确认"刻意设置"的线索（暗示能力、埋下矛盾、引入关键物品等）`

    const response = await llm.generateStream?.([{
      role: 'system',
      content: '你是一个专业的小说分析编辑。只输出 JSON，不要有任何解释。',
    }, {
      role: 'user',
      content: prompt,
    }], {
      onChunk: () => { /* 静默 */ },
      onError: () => { /* 静默 */ },
    }) as unknown as string | undefined

    if (!response) return candidates // LLM 不可用时返回全部候选

    // 解析结果
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return candidates

    const result = JSON.parse(jsonMatch[0]) as { confirmed?: number[] }
    if (!result.confirmed || !Array.isArray(result.confirmed)) return candidates

    const confirmedSet = new Set(result.confirmed)
    return candidates.filter((_, i) => confirmedSet.has(i + 1))
  } catch {
    // LLM 不可用或解析失败时降级为全部候选（保持原有正则行为）
    return candidates
  }
}

/**
 * 带 LLM 确认的伏笔扫描
 * 先正则预筛 → LLM 确认 → 返回高置信度结果
 */
export async function scanNewForeshadowingWithLLM(
  content: string,
  chapterNumber: number,
): Promise<ForeshadowingItem[]> {
  const candidates = scanNewForeshadowing(content, chapterNumber)
  if (candidates.length === 0) return []
  return confirmForeshadowingWithLLM(candidates, content)
}
