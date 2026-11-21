import type { CharacterCard } from '../../stores/character-store'
import type { TextKey } from '../../shared/locale'
import { draftListScope, useDraftStore, type DraftsByChapter } from '../../stores/draft-store'
import { useProjectStore } from '../../stores/project-store'

const emptyDrafts: DraftsByChapter = {}

export function useCharacterChapterDrafts(): DraftsByChapter {
  const scope = useProjectStore(state => state.loading ? null : draftListScope(state))
  return useDraftStore(state => scope && state.draftsScope === scope ? state.draftsByChapter : emptyDrafts)
}

export const relationLabels: Record<string, TextKey> = {
  ally: 'character.relType.ally',
  enemy: 'character.relType.enemy',
  family: 'character.relType.family',
  master_student: 'character.relType.masterStudent',
  lover: 'character.relType.lover',
  rival: 'character.relType.rival',
  neutral: 'character.relType.neutral',
  other: 'character.relType.other',
}

interface CharacterRelation {
  target: string
  type: string
  label: string
  sinceChapter: number
}

function readArray(raw: string | undefined): unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : undefined
  } catch { return undefined }
}

function readChapterNumber(value: unknown): number {
  const chapter = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
  return typeof chapter === 'number' && Number.isSafeInteger(chapter) && chapter > 0 ? chapter : 0
}

export function readAppearanceChapters(raw: string | undefined): number[] {
  const chapters = (readArray(raw) ?? []).map(readChapterNumber).filter(chapter => chapter > 0)
  return [...new Set(chapters)].sort((a, b) => a - b)
}

/** 兼容旧关系文本，同时过滤手动编辑的 JSON 中的无效项目。 */
export function readCharacterRelations(character: Pick<CharacterCard, 'relations' | 'relationships'>): CharacterRelation[] {
  const parse = (items: unknown[], legacy = false): CharacterRelation[] => items.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const target = legacy ? row.name || row.target : row.target
    if (typeof target !== 'string' || !target.trim()) return []
    const label = legacy ? row.relation || row.label : row.label
    return [{
      target: target.trim(),
      type: typeof row.type === 'string' && Object.hasOwn(relationLabels, row.type) ? row.type : 'other',
      label: typeof label === 'string' && label !== row.type ? label.trim() : '',
      sinceChapter: readChapterNumber(row.sinceChapter),
    }]
  })
  const relations = parse(readArray(character.relations) ?? [])
  if (relations.length || !character.relationships) return relations
  const legacy = readArray(character.relationships)
  if (legacy) return parse(legacy, true)
  return character.relationships.split(/[,;，；\n]/).flatMap(line => {
    const match = line.trim().match(/^(.+?)[：:—-]\s*(.+)$/)
    return match ? [{ target: match[1].trim(), type: 'other', label: match[2].trim(), sinceChapter: 0 }] : []
  })
}
