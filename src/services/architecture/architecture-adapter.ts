import { createArchitectureDocumentApplication, type ArchitectureDocumentPorts } from '../../core'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../ipc-client'
import { CORE_FIELD_MAP } from '../vela-protocol'
import { startWorkflow } from '../workflows/start-workflow'
import { t } from '../../shared/locale'
import { belongsToWorkflowSource } from '../workflows/workflow-source'

const currentScope: ArchitectureDocumentPorts['scope'] = () => {
  const { currentProject, projectSession } = useProjectStore.getState()
  return currentProject ? { id: currentProject.id, path: currentProject.path, session: projectSession } : null
}
const readFailure = () => new Error(t('tool.readFileFailed'))
function coreField(locator: string): string | null {
  if (!locator.startsWith('vela://')) return null
  const match = /^vela:\/\/core\/(premise|characters|worldbuilding|synopsis)$/.exec(locator)
  if (!match) throw readFailure()
  return CORE_FIELD_MAP[match[1]]
}
function readField(core: object | null, field: string): string | null {
  if (!core) return null
  const content = (core as Record<string, unknown>)[field]
  if (content == null) return null
  if (typeof content !== 'string') throw readFailure()
  return content
}

/** Strict renderer IO: missing core fields are distinct from rejected or malformed reads. */
export function createRendererArchitectureDocumentApplication(locator: string, source = currentScope()) {
  return createArchitectureDocumentApplication({
    scope: currentScope,
    ownsRun: belongsToWorkflowSource,
    read: async path => {
      const field = coreField(path)
      if (field) return readField(await ipc.invoke('db:project-core-get'), field)
      const result = await ipc.invoke('fs:read-file', path)
      if (!result.success || typeof result.content !== 'string') throw new Error(result.error || t('tool.readFileFailed'))
      return result.content
    },
    write: async (path, content) => {
      const field = coreField(path)
      const result = field
        ? await ipc.invoke('db:project-core-update', { [field]: content })
        : await ipc.invoke('fs:write-file', path, content)
      return result.success === true
    },
    readArchitecture: async () => {
      const core = await ipc.invoke('db:project-core-get')
      return {
        premise: readField(core, 'premise') ?? '',
        characters: readField(core, 'charactersArch') ?? '',
        worldbuilding: readField(core, 'worldbuilding') ?? '',
        synopsis: readField(core, 'synopsis') ?? '',
      }
    },
    existingCharacterCount: async () => {
      const characters = await ipc.invoke('db:character-get-all')
      if (!Array.isArray(characters)) throw readFailure()
      return characters.length
    },
    startWorkflow,
  }, locator, source)
}
