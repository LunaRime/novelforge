import { ArchitectureRequestCancelled, createArchitectureDocumentApplication, createArchitectureOverviewApplication, openEditorDocument, type ArchitectureDocumentPorts, type ArchitectureFieldRead, type ArchitectureStep } from '../../core'
import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { ipc } from '../ipc-client'
import { CORE_FIELD_MAP } from '../vela-protocol'
import { startWorkflow } from '../workflows/start-workflow'
import { t } from '../../shared/locale'
import { belongsToWorkflowSource } from '../workflows/workflow-source'
import { createRendererEditorOpenPort } from '../editor/open-editor-document'

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
function readField(core: unknown, field: string): string | null {
  if (core == null) return null
  if (typeof core !== 'object' || Array.isArray(core)) throw readFailure()
  const content = (core as Record<string, unknown>)[field]
  if (content == null) return null
  if (typeof content !== 'string') throw readFailure()
  return content
}

const architectureFields = { premise: 'premise', characters: 'charactersArch', worldbuilding: 'worldbuilding', synopsis: 'synopsis' } as const
async function readArchitectureFields(): Promise<Record<ArchitectureStep, ArchitectureFieldRead>> {
  const core = await ipc.invoke('db:project-core-get')
  const fields = {} as Record<ArchitectureStep, ArchitectureFieldRead>
  for (const step of Object.keys(architectureFields) as ArchitectureStep[]) {
    try {
      const content = readField(core, architectureFields[step])
      fields[step] = core == null ? { status: 'missing' } : { status: 'ready', content: content ?? '' }
    } catch (error) {
      fields[step] = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
  }
  return fields
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
      const fields = await readArchitectureFields()
      const raw = {} as Record<ArchitectureStep, string>
      for (const step of Object.keys(architectureFields) as ArchitectureStep[]) {
        const field = fields[step]
        if (field.status === 'failed') throw new Error(field.error)
        raw[step] = field.status === 'ready' ? field.content : ''
      }
      return raw
    },
    existingCharacterCount: async () => {
      const characters = await ipc.invoke('db:character-get-all')
      if (!Array.isArray(characters)) throw readFailure()
      return characters.length
    },
    startWorkflow,
  }, locator, source)
}

/** Overview queries and existing B1 commands share one immutable project session. */
export function createRendererArchitectureOverviewApplication(source = currentScope()) {
  const app = createArchitectureOverviewApplication({
    scope: currentScope,
    readFields: readArchitectureFields,
    readPostProcess: async () => {
      const run = await ipc.invoke('db:post-process-get-latest-run', 'unknown', 'arch_characters')
      if (run == null) return null
      if (typeof run.allCriticalPassed !== 'boolean') throw readFailure()
      return run.allCriticalPassed
    },
  }, source)
  const commands = createRendererArchitectureDocumentApplication('vela://core/premise', source)
  return {
    load: app.load,
    assertCurrent: app.assertCurrent,
    generate: commands.generate,
    existingCharacterCount: commands.existingCharacterCount,
    extract: commands.extract,
    ownsRun: commands.ownsRun,
    async open(step: ArchitectureStep, name: string) {
      app.assertCurrent()
      const locator = `vela://core/${step}`
      const protectedTab = () => useEditorStore.getState().tabs.find(tab =>
        tab.type === 'arch-file' && tab.filePath === locator && (tab.dirty || tab.inlineSession))
      let localTabId: string | undefined
      const port = createRendererEditorOpenPort()
      return openEditorDocument({ kind: 'path', locator, name, documentKind: 'arch-file' }, {
        ...port,
        scope: () => { app.assertCurrent(); return port.scope() },
        resolve: async (request, check) => {
          app.assertCurrent()
          check()
          if (request.kind !== 'path') throw readFailure()
          const field = coreField(request.locator)
          if (!field) throw readFailure()
          const existing = protectedTab()
          if (existing) {
            localTabId = existing.id
            return { id: existing.id, locator, name: existing.name, kind: 'arch-file', content: existing.content ?? '' }
          }
          const core = await ipc.invoke('db:project-core-get')
          app.assertCurrent()
          check()
          const content = readField(core, field)
          if (core == null) return null
          return { id: request.locator, locator: request.locator, name: request.name, kind: request.documentKind, content: content ?? '' }
        },
        publish: document => {
          app.assertCurrent()
          if (localTabId !== undefined) {
            const current = useEditorStore.getState().tabs.find(tab => tab.id === localTabId && tab.type === 'arch-file' && tab.filePath === locator)
            if (!current) throw new ArchitectureRequestCancelled()
            useEditorStore.getState().setActiveTab(current.id)
            return
          }
          // Protection may begin while the read is pending; only activate that current tab.
          const existing = protectedTab()
          if (existing) useEditorStore.getState().setActiveTab(existing.id)
          else port.publish(document)
        },
      })
    },
    dispose() { app.dispose(); commands.dispose() },
  }
}
