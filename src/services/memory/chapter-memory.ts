import { t } from '../../shared/locale'
import { useLLMStore } from '../../stores/llm-store'
import { ipc } from '../ipc-client'
import { calculateCost } from '../llm/prompt-cache'
import { parseMemoryFile, buildChapterEntryBlock, type ChapterSummaryEntry } from './memory-codec'
import { maybeTriggerBookState } from './book-memory'

/** 15 章滚动窗口（无分卷/未命中/进行中卷时） */
const CHAPTERS_PER_FILE = 15

/**
 * 章节 → 记忆文件：优先按分卷边界对齐。
 * 已闭合卷（chapterEnd != 0）→ 卷起始窗口（start = 卷起始，end = 卷结束）；
 * 未命中卷或进行中卷（chapterEnd === 0）→ 15 章滚动窗口（start 从章节号反推，保证章节号恒在 [start, end] 内——审阅修正：进行中卷超 15 章后不再映射到卷起始固定窗口外）。
 */
export function computeMemoryFileRange(
  chapterNumber: number,
  volumes: { volumeNumber: number; chapterStart: number; chapterEnd: number }[],
): { file: string; range: string } {
  const vol = volumes.find(v => chapterNumber >= v.chapterStart && (v.chapterEnd === 0 || chapterNumber <= v.chapterEnd))
  let start: number
  let end: number
  if (vol && vol.chapterEnd !== 0) {
    start = vol.chapterStart
    end = vol.chapterEnd
  } else {
    // 滚动窗口：start 反推使 chapterNumber ∈ [start, start+14]
    start = Math.max(1, Math.floor((chapterNumber - 1) / CHAPTERS_PER_FILE) * CHAPTERS_PER_FILE + 1)
    end = start + CHAPTERS_PER_FILE - 1
  }
  const pad = (n: number) => String(n).padStart(3, '0')
  return { file: `chapters-${pad(start)}-${pad(end)}.md`, range: `${pad(start)}-${pad(end)}` }
}

/** 章节摘要 prompt（budget 路由 + 温度 0.2；输出为六字段清单） */
export function buildChapterSummaryPrompt(chapterNumber: number, chapterTitle: string, draftContent: string): string {
  return [
    // {title} 用函数形式 replace：标题含 $&/$'/$`/$n 时 String.replace 会做 $ 模式插值污染 prompt
    t('memory.summaryPrompt').replace('{n}', String(chapterNumber)).replace('{title}', () => chapterTitle),
    '',
    t('memory.draftLabel'),
    draftContent,
  ].join('\n')
}

/** 调用 LLM 生成章节摘要（budget 路由；失败 throw 由 DAG 步骤容错） */
export async function generateChapterSummary(opts: {
  chapterNumber: number
  chapterTitle: string
  draftContent: string
  modelId: string
}): Promise<ChapterSummaryEntry> {
  const prompt = buildChapterSummaryPrompt(opts.chapterNumber, opts.chapterTitle, opts.draftContent)
  const mid = useLLMStore.getState().getModelForPurpose('summarize') ?? opts.modelId
  const startTime = Date.now()
  const response = await useLLMStore.getState().generate([{ role: 'user', content: prompt }], mid, { temperature: 0.2, priority: 12 })
  const duration = Date.now() - startTime
  const model = useLLMStore.getState().models.find(m => m.id === mid)
  const usage = response.usage
  if (!response.success) throw new Error(response.error ?? 'memory summary failed')
  try {
    // 真实 usage/cost 落库（对照 ccr-summary.ts 先例——此前 token/cost 恒 0，统计失真）
    const cost = usage && model
      ? calculateCost(model, usage.promptTokens, usage.completionTokens, (usage.cachedTokens ?? 0) > 0).totalCost
      : 0
    await ipc.invoke('db:log-llm-call', {
      model_id: mid,
      model_name: model?.name ?? model?.modelName ?? '',
      purpose: 'memory_summary',
      prompt_tokens: usage?.promptTokens ?? 0,
      completion_tokens: usage?.completionTokens ?? 0,
      total_tokens: usage?.totalTokens ?? 0,
      cached_tokens: usage?.cachedTokens ?? 0,
      duration_ms: duration, success: 1, error_message: '', cost,
    })
  } catch { /* 日志失败不影响主流程 */ }
  // 六字段解析：LLM 输出以「关键事件：」等六行格式（prompt 已约束）；解析失败字段降级 '无'
  const text = response.content
  const field = (label: string) => {
    const m = text.match(new RegExp(`${label}[：:]([^\\n]+)`))
    return m ? m[1].trim() : ''
  }
  return {
    chapterNumber: opts.chapterNumber,
    title: opts.chapterTitle,
    keyEvents: field('关键事件'),
    characters: field('出场角色'),
    foreshadowing: field('伏笔'),
    newElements: field('新设定'),
    currentState: field('当前状态'),
  }
}

/**
 * 读现有文件 → 按章节号替换/追加 → 写回。
 * 审阅修正（Bug 1/2/5）：
 * - 块边界 = [idx, nextIdx)：按下一个「## 第」标题定位，只替换该区间——不再用 filter 误删后续章节字段行
 * - 写回时清除 frontmatter status（stale 生命周期闭环：新摘要生成即恢复非 stale，防重定稿后 M2 永久过滤）
 * - 单章块用 buildChapterEntryBlock（无 frontmatter/标题残留）
 * - 重定稿判定（文件已有本章条目 = 重定稿）由调用方在 DAG 步骤内完成（覆盖生成即清除 stale）
 */
export async function upsertChapterMemory(entry: ChapterSummaryEntry, file: string): Promise<{ file: string; success: boolean }> {
  try {
    const raw = await ipc.invoke('memory:read', file) as string | null
    const existing = parseMemoryFile(raw ?? '')
    const header = `## 第 ${entry.chapterNumber} 章`
    const lines = existing ? existing.body.split('\n') : []
    const idx = lines.findIndex(l => l.startsWith(header))
    const newBlock = buildChapterEntryBlock(entry)
    let body: string[]
    if (idx >= 0) {
      // 块边界：下一个「## 第」标题
      let nextIdx = lines.length
      for (let i = idx + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## 第')) { nextIdx = i; break }
      }
      body = [...lines.slice(0, idx), newBlock, ...lines.slice(nextIdx)]
    } else {
      body = [...lines, '', newBlock]
    }
    // frontmatter：保留 range 等字段，**清除 status**（stale 闭环）
    const fmEntries = Object.entries(existing?.frontmatter ?? {}).filter(([k]) => k !== 'status')
    const fm = fmEntries.length > 0 ? `---\n${fmEntries.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n` : ''
    await ipc.invoke('memory:write', file, `${fm}${body.join('\n')}`)
    return { file, success: true }
  } catch {
    return { file, success: false }
  }
}

/** 卷级摘要文件：纯函数组装（卷头 + 卷内章节条目），不额外 LLM */
export function buildVolumeSummaryFile(
  volume: { volumeNumber: number; title: string; chapterStart: number; chapterEnd: number },
  chapterEntries: ChapterSummaryEntry[],
): string {
  const end = volume.chapterEnd === 0 ? chapterEntries[chapterEntries.length - 1]?.chapterNumber ?? volume.chapterStart : volume.chapterEnd
  const lines = [
    '---', `volume: ${volume.volumeNumber}`, `range: ${volume.chapterStart}-${end}`, '---', '',
    `# 第 ${volume.volumeNumber} 卷 · ${volume.title || '（无题）'}`,
  ]
  for (const e of chapterEntries) {
    lines.push('', `## 第 ${e.chapterNumber} 章 · ${e.title || '（无题）'}`, `- 关键事件：${e.keyEvents || '无'}`, `- 出场角色：${e.characters || '无'}`, `- 伏笔：${e.foreshadowing || '无'}`, `- 新设定：${e.newElements || '无'}`, `- 当前状态：${e.currentState || '无'}`)
  }
  return lines.join('\n')
}

/**
 * 章节文件写入后调用：卷内章节条目完整（覆盖聚合区间）→ 聚合生成 volume-N.md。
 * - 已闭合卷（chapterEnd != 0）：聚合区间 = 卷范围 [chapterStart..chapterEnd]
 * - 进行中卷（chapterEnd === 0，P2 解除 P1 限制）：聚合区间 = [chapterStart..已有条目的最大章节号]
 *   ——上界 = 跨文件解析条目后的最大 chapterNumber，**不是文件 range 的 end**（range 是 15 章
 *   滚动窗口上界如 16-30，未定稿区间按 range 判完整性永远失败）
 * F6 修正：**扫描全部 chapters-*.md** 收集卷范围 [chapterStart..chapterEnd] 内的条目——
 * 卷创建晚于章节定稿/卷边界编辑后，条目散落在旧窗口文件（孤儿化），只读单窗口文件会漏收
 * → 完整性门槛永不过。文件数少（每 15 章一个），成本可忽略。同章条目跨文件重复时按窗口
 * 文件升序取最后出现者（较新窗口胜出）。
 * fix round 2：扫描过滤 **stale 文件**（与 M2 注入侧 fresh 过滤同口径）——失效规则标记的
 * 陈旧窗口（如卷对齐窗口 chapters-001-002.md 字典序在旧滚动 chapters-001-015.md 之前，
 * 后者升序靠后处理会覆盖胜出）不得参与聚合，否则卷摘要用旧条目生成后仍被 M2 注入。
 */
export async function ensureVolumeSummary(
  volume: { volumeNumber: number; title: string; chapterStart: number; chapterEnd: number },
): Promise<{ file: string | null; success: boolean }> {
  try {
    const list = (await ipc.invoke('memory:list')) as { file: string; kind: string; stale: boolean }[] | null
    if (!list) return { file: null, success: false }
    const chapterFiles = list
      .filter(f => !f.stale && (f.kind === 'chapters' || f.file.startsWith('chapters-')))
      .map(f => f.file)
      .sort() // 零填充窗口名升序 = 数值序，后出现的文件为较新窗口
    const byChapter = new Map<number, ChapterSummaryEntry>()
    // 收集上界：已闭合卷 = chapterEnd；进行中卷 = 无上界（收集后按条目最大章节号确定——见下）
    const cap = volume.chapterEnd === 0 ? Number.MAX_SAFE_INTEGER : volume.chapterEnd
    for (const file of chapterFiles) {
      const raw = await ipc.invoke('memory:read', file) as string | null
      if (!raw) continue
      const { body } = parseMemoryFile(raw) ?? { body: raw }
      // 从章节文件正文解析条目（按「## 第 N 章 ·」块；标题从块头分离——审阅修正）
      const blocks = body.split('\n## 第 ')
      for (const b of blocks.slice(1)) {
        const numMatch = b.match(/^(\d+) 章 · (.+)/)
        if (!numMatch) continue
        const num = Number(numMatch[1])
        if (num < volume.chapterStart || num > cap) continue // 只收卷内章节
        const field = (label: string) => { const m = b.match(new RegExp(`${label}：([^\\n]+)`)); return m ? m[1].trim() : '' }
        byChapter.set(num, { chapterNumber: num, title: numMatch[2].trim(), keyEvents: field('关键事件'), characters: field('出场角色'), foreshadowing: field('伏笔'), newElements: field('新设定'), currentState: field('当前状态') })
      }
    }
    if (byChapter.size === 0) return { file: null, success: false } // 无条目：进行中卷无可推断上界
    // 上界语义：进行中卷 = 已收集条目的最大 chapterNumber（⚠️ 不是文件 range 的 end，range 是窗口上界非实际定稿最大章）
    const end = volume.chapterEnd === 0 ? Math.max(...Array.from(byChapter.keys())) : volume.chapterEnd
    // 完整性检查：聚合区间内章节号连续覆盖（已闭合卷 chapterStart..chapterEnd；进行中卷 chapterStart..end）
    const expected = Array.from({ length: end - volume.chapterStart + 1 }, (_, i) => volume.chapterStart + i)
    const has = expected.every(n => byChapter.has(n))
    if (!has) return { file: null, success: false } // 未完整，跳过
    const entries = [...byChapter.values()].sort((a, b) => a.chapterNumber - b.chapterNumber)
    const file = `volume-${String(volume.volumeNumber).padStart(3, '0')}.md` // 零填充防字典序错排（审阅修正）
    await ipc.invoke('memory:write', file, buildVolumeSummaryFile(volume, entries))
    // P2 Task 3：卷聚合成功后检查点触发全书重建（每满 3 个非 stale 卷；低频，失败静默不阻断定稿）
    await maybeTriggerBookState()
    return { file, success: true }
  } catch {
    return { file: null, success: false }
  }
}
