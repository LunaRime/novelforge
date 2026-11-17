import { captureCharacterSource, CharacterEditCancelled, isCharacterSourceCurrent, readCharacterEdits, type CharacterSource } from './characters/character-edits-adapter'
import { ipc } from './ipc-client'
import { t } from '../shared/locale'
import type { MergeStats } from './character-card-merge-plan'
import type { CharacterEditSnapshot } from '../core'
export { mergeCardRows, type MergeStats } from './character-card-merge-plan'

/** Bind generated cards to their originating project before model work starts. */
export async function createCharacterCardMerger(
  projectPath: string, source: CharacterSource | null = captureCharacterSource(), snapshot?: CharacterEditSnapshot,
) {
  if (!source || source.path !== projectPath) throw new CharacterEditCancelled(t('error.requestCancelled'))
  const assertCurrent = () => {
    if (!isCharacterSourceCurrent(source)) throw new CharacterEditCancelled(t('error.requestCancelled'))
  }
  assertCurrent()
  const { scope, cards: baseline } = snapshot ?? await readCharacterEdits(source)
  const known = baseline.map(({ name, uid, aliases }) => ({ name, uid, aliases }))
  return {
    assertCurrent,
    merge: async (cards: Array<Record<string, unknown>>): Promise<MergeStats> => {
      assertCurrent()
      if (!cards.length) return { saved: 0, merged: 0, created: 0 }
      const result = await ipc.invoke('db:character-merge-cards', { scope, cards, known }).finally(assertCurrent)
      if (!result.success) throw new Error(result.error)
      return result.stats
    },
  }
}
