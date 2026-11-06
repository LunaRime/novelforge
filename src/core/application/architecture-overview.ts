import type { ArchitectureScope, ArchitectureStep } from '../ports/architecture-document'
import type { ArchitectureFieldOverview, ArchitectureOverviewPorts, ArchitectureOverviewResult } from '../ports/architecture-overview'
import { ArchitectureRequestCancelled } from './architecture-document'

const steps: readonly ArchitectureStep[] = ['premise', 'characters', 'worldbuilding', 'synopsis']
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** One overview session; every load replaces the preceding request, including its errors. */
export function createArchitectureOverviewApplication(ports: ArchitectureOverviewPorts, initial: ArchitectureScope | null = ports.scope()) {
  const source = initial ? { ...initial } : null
  let disposed = false
  let version = 0
  const assertCurrent = () => {
    const current = ports.scope()
    if (disposed || !source || !current || source.id !== current.id || source.path !== current.path || source.session !== current.session) throw new ArchitectureRequestCancelled()
  }
  return {
    assertCurrent,
    dispose() { disposed = true },
    async load(): Promise<ArchitectureOverviewResult> {
      const request = ++version
      const check = () => { assertCurrent(); if (request !== version) throw new ArchitectureRequestCancelled() }
      check()
      const fields = {} as Record<ArchitectureStep, ArchitectureFieldOverview>
      try {
        const raw = await ports.readFields()
        check()
        for (const step of steps) {
          const field = raw[step]
          if (field.status !== 'ready') fields[step] = field
          else {
            const generated = field.content.length > 50 && !field.content.includes('待生成')
            fields[step] = { status: 'ready', generated, wordCount: generated ? field.content.length : 0 }
          }
        }
      } catch (error) {
        check()
        for (const step of steps) fields[step] = { status: 'failed', error: message(error) }
      }
      check()
      let postProcess: ArchitectureOverviewResult['postProcess']
      try {
        const allCriticalPassed = await ports.readPostProcess()
        check()
        postProcess = { status: 'ready', allCriticalPassed }
      } catch (error) {
        check()
        postProcess = { status: 'failed', error: message(error) }
      }
      check()
      return { fields, postProcess }
    },
  }
}
