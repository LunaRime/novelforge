import type { CharacterEdit, CharacterEditSnapshot, CharacterEditsInput, CharacterWriteScope } from '../../core'
import { t } from '../../shared/locale'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../ipc-client'

export interface CharacterSource { id: string; path: string; session: number }

export class CharacterEditCancelled extends Error {}

export function captureCharacterSource(): CharacterSource | null {
  const { currentProject, projectSession } = useProjectStore.getState()
  return currentProject ? { id: currentProject.id, path: currentProject.path, session: projectSession } : null
}

export function isCharacterSourceCurrent(source: CharacterSource): boolean {
  const current = captureCharacterSource()
  return current?.id === source.id && current.path === source.path && current.session === source.session
}

function assertCurrent(source: CharacterSource): void {
  if (!isCharacterSourceCurrent(source)) throw new CharacterEditCancelled(t('error.requestCancelled'))
}

export async function readCharacterEdits(source: CharacterSource): Promise<CharacterEditSnapshot> {
  assertCurrent(source)
  const result = await ipc.invoke('db:character-edit-snapshot')
  assertCurrent(source)
  if (result?.scope?.projectPath !== source.path || !result.scope.token || !Array.isArray(result.cards)) {
    throw new Error(t('error.requestCancelled'))
  }
  return result
}

export async function commitCharacterEdits(source: CharacterSource, scope: CharacterWriteScope, edits: CharacterEdit[], relationTargets?: CharacterEditsInput['relationTargets']) {
  assertCurrent(source)
  if (scope.projectPath !== source.path || useProjectStore.getState().loading) throw new CharacterEditCancelled(t('error.requestCancelled'))
  const input = relationTargets ? { scope, edits, relationTargets } : { scope, edits }
  const result = await ipc.invoke('db:character-commit-edits', input).finally(() => assertCurrent(source))
  if (!result?.success) throw new Error(result?.error || t('status.unknown'))
  if (!Array.isArray(result.cards)) throw new Error(t('status.unknown'))
  return result.cards
}
