import type { CharacterData } from '../../core'
import { t } from '../../shared/locale'
import { ipc } from '../ipc-client'

const TEXT_FIELDS = [
  'role', 'gender', 'age', 'appearance', 'personality', 'background',
  'abilities', 'motivation', 'arc', 'notes', 'tags',
] as const

export type CharacterTemplate = Partial<Pick<CharacterData, typeof TEXT_FIELDS[number] | 'tier'>>

function portableFields(data: Record<string, unknown>): CharacterTemplate {
  const fields: CharacterTemplate = {}
  for (const key of TEXT_FIELDS) {
    const value = data[key]
    if (typeof value === 'string') fields[key] = value
  }
  if (data.tier === 1 || data.tier === 2 || data.tier === 3) fields.tier = data.tier
  return fields
}

export function listCharacterTemplates() {
  return ipc.invoke('templates:list')
}

export async function readCharacterTemplate(file: string): Promise<CharacterTemplate> {
  const data = await ipc.invoke('templates:get', file)
  if (!data) throw new Error(t('status.unknown'))
  return portableFields(data)
}

export async function saveCharacterTemplate(card: CharacterData): Promise<void> {
  const result = await ipc.invoke('templates:save', { name: card.name, data: portableFields({ ...card }) })
  if (!result.success) throw new Error(result.error || t('status.unknown'))
}
