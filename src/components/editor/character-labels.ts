import type { TextKey } from '../../shared/locale'
import type { SemanticIconName } from '../ui/SemanticLabel'

/** 侧栏分组与档案字段使用同一组标签和图标。 */
export const characterRoles = {
  protagonist: 'character.roleLabel.protagonist',
  antagonist: 'character.roleLabel.antagonist',
  supporting: 'character.roleLabel.supporting',
  minor: 'character.roleLabel.minor',
} as const satisfies Record<string, TextKey>

export function characterRole(role: string): keyof typeof characterRoles {
  return Object.hasOwn(characterRoles, role) ? role as keyof typeof characterRoles : 'supporting'
}

const tiers = {
  1: { icon: 'core', label: 'character.tierLabel.core' },
  2: { icon: 'important', label: 'character.tierLabel.important' },
  3: { icon: 'incidental', label: 'character.tierLabel.minor' },
} as const satisfies Record<number, { icon: SemanticIconName; label: TextKey }>

export function characterTier(tier: number) {
  return tiers[tier as keyof typeof tiers] ?? tiers[1]
}
