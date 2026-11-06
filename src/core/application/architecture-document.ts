import type { ArchitectureDocumentPorts, ArchitectureStep } from '../ports/architecture-document'
import type { WorkflowReceipt } from './start-workflow'

export class ArchitectureRequestCancelled extends Error {
  constructor() { super('Architecture request is no longer current'); this.name = 'ArchitectureRequestCancelled' }
}
export class ArchitectureDocumentBusy extends Error {
  constructor() { super('Architecture document save is already in progress'); this.name = 'ArchitectureDocumentBusy' }
}

/** One immutable document/project session with independent latest-request lanes. */
export function createArchitectureDocumentApplication(ports: ArchitectureDocumentPorts, locator: string, initial = ports.scope()) {
  const source = initial ? { ...initial } : null
  const versions = { read: 0, status: 0, count: 0, generate: 0, extract: 0 }
  let disposed = false
  let saving = false
  const assertCurrent = () => {
    const current = ports.scope()
    if (disposed || !source || !current || source.id !== current.id || source.path !== current.path || source.session !== current.session) throw new ArchitectureRequestCancelled()
  }
  const begin = (lane: keyof typeof versions) => {
    const version = ++versions[lane]
    return () => { assertCurrent(); if (version !== versions[lane]) throw new ArchitectureRequestCancelled() }
  }
  const step = async <T>(check: () => void, operation: () => Promise<T>): Promise<T> => {
    check()
    try { const value = await operation(); check(); return value }
    catch (error) { check(); throw error }
  }
  return {
    assertCurrent,
    ownsRun(runId: string): boolean { assertCurrent(); return ports.ownsRun?.(runId, source!) ?? false },
    dispose() { disposed = true },
    async read(): Promise<{ status: 'ready'; content: string } | { status: 'missing' }> {
      const content = await step(begin('read'), () => ports.read(locator))
      return content === null ? { status: 'missing' } : { status: 'ready', content }
    },
    async save(content: string): Promise<void> {
      assertCurrent()
      if (saving) throw new ArchitectureDocumentBusy()
      saving = true
      try {
        if (!await step(assertCurrent, () => ports.write(locator, content))) throw new Error('Architecture document write was rejected')
      } finally { saving = false }
    },
    async status(): Promise<Record<ArchitectureStep, boolean>> {
      const raw = await step(begin('status'), () => ports.readArchitecture())
      const generated = (text: string) => text.length > 50 && !text.includes('待生成')
      return { premise: generated(raw.premise), characters: generated(raw.characters), worldbuilding: generated(raw.worldbuilding), synopsis: generated(raw.synopsis) }
    },
    existingCharacterCount() { return step(begin('count'), () => ports.existingCharacterCount()) },
    generate(steps: readonly ArchitectureStep[], guidance: Readonly<Record<string, string>>): Promise<WorkflowReceipt> {
      const selectedSteps = [...steps]
      const stepGuidance = { ...guidance }
      return step(begin('generate'), () => ports.startWorkflow({ workflow: 'generate_architecture', architecture: { selectedSteps, stepGuidance } }))
    },
    async extract(genre: string): Promise<{ status: 'empty' } | { status: 'started'; runId: string }> {
      const check = begin('extract')
      const raw = await step(check, () => ports.readArchitecture())
      if (raw.characters.length < 50) return { status: 'empty' }
      // The source path was copied at construction and checked before dispatch.
      const receipt = await step(check, () => ports.startWorkflow({ workflow: 'extract_arch_characters', projectPath: source!.path, characterDynamicsContent: raw.characters, genre }))
      return { status: 'started', runId: receipt.runId }
    },
  }
}
