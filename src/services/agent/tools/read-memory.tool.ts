/**
 * read_memory — 按名 / 关键词读取作品记忆（C 档第一轮）
 *
 * 定位：系统提示词的「记忆目录」只给一行摘要，正文由此工具按需取（Denova lore 的 NF 版）。
 * 只读、免确认；manual 条目**也放行**——显式按名取就是 spec §3.4 里的「明确引用」。
 * 与 search_knowledge 的分工写在工具描述里（前者查知识库，本工具查作品记忆文件）。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { parseMemoryFile } from '../../memory/memory-codec'
import type { MemoryFileMeta } from '../../memory/memory-codec'
import { normalizeLoadMode } from '../../../shared/memory-types'
import { buildMemoryCatalog, findLineHint, scoreMemoryEntry, type MemoryLayerEntry } from '../memory-layers'

/** 关键词检索返回条数上限（防止一次拉回整本记忆） */
const MEMORY_SEARCH_TOP_K = 5

function toEntries(list: MemoryFileMeta[]): MemoryLayerEntry[] {
  return list.map(f => ({
    file: f.file, kind: f.kind, loadMode: normalizeLoadMode(f.loadMode), brief: f.brief ?? '', range: f.range,
  }))
}

async function listEntries(): Promise<MemoryLayerEntry[]> {
  const list = await ipc.invoke('memory:list') as MemoryFileMeta[] | null
  return toEntries(Array.isArray(list) ? list : [])
}

async function readBody(file: string): Promise<string | null> {
  const raw = await ipc.invoke('memory:read', file) as string | null
  if (raw === null || raw === undefined) return null
  return (parseMemoryFile(raw) ?? { body: raw }).body.trim()
}

function kindLabel(kind: MemoryLayerEntry['kind']): string {
  switch (kind) {
    case 'chapters': return t('memory.kindChapters')
    case 'volume': return t('memory.kindVolume')
    case 'book': return t('memory.kindBook')
    case 'shared': return t('memory.kindShared')
    default: return t('memory.kindUnknown')
  }
}

export const readMemoryTool = buildAgentTool({
  name: 'read_memory',
  description: t('tool.readMemoryDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: t('tool.readMemoryName') },
      keyword: { type: 'string', description: t('tool.readMemoryKeyword') },
      type: { type: 'string', description: t('tool.readMemoryType'), enum: ['chapters', 'volume', 'book', 'shared'] },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const name = (args.name as string | undefined)?.trim()
    const keyword = (args.keyword as string | undefined)?.trim()
    const type = args.type as MemoryLayerEntry['kind'] | undefined

    let entries: MemoryLayerEntry[]
    try {
      entries = await listEntries()
    } catch {
      return { success: false, content: '', error: t('error.noProject') }
    }
    const scoped = type ? entries.filter(e => e.kind === type) : entries
    const catalog = buildMemoryCatalog(scoped).text

    if (name) {
      // 容忍去后缀名；未知名 → 失败 + 目录（模型据此改道）
      const normalized = name.replace(/\.md$/, '').toLowerCase()
      const hit = scoped.find(e => e.file.toLowerCase() === name.toLowerCase() || e.file.replace(/\.md$/, '').toLowerCase() === normalized)
      const file = hit?.file ?? (/\.md$/i.test(name) ? name : `${name}.md`)
      const body = await readBody(file)
      if (body === null) {
        return {
          success: false,
          content: '',
          error: t('tool.readMemoryNotFound').replace('{name}', file).replace('{catalog}', catalog || t('tool.readMemoryEmpty')),
        }
      }
      return { success: true, content: t('tool.readMemoryContent').replace('{name}', file).replace('{content}', body) }
    }

    if (keyword) {
      const scored: Array<{ e: MemoryLayerEntry; score: number; hint: string }> = []
      for (const e of scoped) {
        const body = await readBody(e.file)
        if (body === null) continue
        const score = scoreMemoryEntry(e, body, keyword)
        if (score > 0) scored.push({ e, score, hint: findLineHint(body, keyword) })
      }
      scored.sort((a, b) => b.score - a.score || a.e.file.localeCompare(b.e.file))
      const top = scored.slice(0, MEMORY_SEARCH_TOP_K)
      if (top.length === 0) {
        return {
          success: true,
          content: t('tool.readMemoryNoMatch').replace('{keyword}', keyword).replace('{catalog}', catalog || t('tool.readMemoryEmpty')),
        }
      }
      const items = top.map(({ e, hint }) => t('tool.readMemoryHit')
        .replace('{name}', e.file)
        .replace('{kind}', kindLabel(e.kind))
        .replace('{brief}', e.brief || '—')
        .replace('{hint}', hint ? t('tool.readMemoryHitHint').replace('{line}', hint) : '')).join('\n')
      return {
        success: true,
        content: t('tool.readMemoryMatches')
          .replace('{keyword}', keyword)
          .replace('{count}', String(top.length))
          .replace('{items}', items),
      }
    }

    return { success: true, content: catalog || t('tool.readMemoryEmpty') }
  },
})
