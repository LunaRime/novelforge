import type { CharacterData } from '../domain/character'

export interface CharacterWriteScope { projectPath: string; token: string }
export interface CharacterEdit { before: CharacterData | null; after: CharacterData | null }
export interface CharacterEditSnapshot { scope: CharacterWriteScope; cards: CharacterData[] }
export interface CharacterEditsInput {
  scope: CharacterWriteScope
  edits: CharacterEdit[]
  relationTargets?: Array<Pick<CharacterData, 'name' | 'uid'>>
}
export interface CharacterFieldWrite { scope: CharacterWriteScope; uid?: string }
export type CharacterEditsResult = { success: true; cards: CharacterData[] } | { success: false; error: string }
