import type { WorkflowStartRequest } from './start-workflow'
export interface EditorDraftIdentity { id: number; chapterNumber: number; version: number }
export interface DraftEditorPorts<Meta extends EditorDraftIdentity, Revision> {
  project(): { path: string; session: number } | null
  errors: { changed: string; empty: string; create: string }
  metadata(path: string): Promise<Meta | null>
  title(chapterNumber: number): Promise<string | undefined>
  pending(id: number, version: number): Promise<Revision[]>
  reviewCount(id: number, version: number): Promise<number>
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  refresh(): void
  start(request: WorkflowStartRequest): Promise<unknown>
  repairGuard(chapterNumber: number): Promise<{ ok: boolean; message?: string }>
  merge(chapterNumber: number, path: string, revision: string, text: string, expectedContent: string | undefined): Promise<{ success: boolean; error?: string; refreshError?: string }>
  latestReview(id: number, version: number): Promise<{ id: number } | null>
  translate(prompt: string, system: string): Promise<string>
  nextVersion(chapterNumber: number): Promise<number>
  createTranslation(chapterNumber: number, version: number, content: string): Promise<number>
}
/** One editor session is bound to the source project, including time spent in UI confirmation. */
export function createDraftEditorApplication<Meta extends EditorDraftIdentity, Revision>(ports: DraftEditorPorts<Meta, Revision>, initialProject = ports.project()) {
  const source = initialProject ? { ...initialProject } : null
  const assertCurrent = () => {
    const now = ports.project()
    if (!source || !now || now.path !== source.path || now.session !== source.session) throw new Error(ports.errors.changed)
  }
  const step = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertCurrent(); const result = await operation(); assertCurrent(); return result
  }
  return {
    assertCurrent,
    async load(path: string) {
      const meta = await step(() => ports.metadata(path))
      if (!meta) return null
      const chapterTitle = await step(() => ports.title(meta.chapterNumber))
      const pending = await step(() => ports.pending(meta.id, meta.version))
      const reviewCount = await step(() => ports.reviewCount(meta.id, meta.version))
      return { meta: { ...meta, chapterTitle }, pending, reviewCount }
    },
    async save(path: string, text: string) {
      await step(() => ports.write(path, text)); assertCurrent(); ports.refresh()
    },
    async workflow(workflow: 'refine' | 'review' | 'finalize', path: string, meta: Meta, title: string, extras?: { userRefinePrompt?: string; reviewFocus?: string }) {
      const body = await step(() => ports.read(path))
      return step(() => ports.start({ workflow, chapterNumber: meta.chapterNumber, draft: { draftPath: path, draftContent: body, chapterTitle: title, ...extras } }))
    },
    async repair(meta: Meta) {
      const guard = await step(() => ports.repairGuard(meta.chapterNumber))
      if (!guard.ok) return guard
      await step(() => ports.start({ workflow: 'repair_finalize', chapterNumber: meta.chapterNumber }))
      return guard
    },
    async revision(path: string, revisionPath: string) {
      assertCurrent()
      const [originalContent, modifiedContent] = await step(() => Promise.all([ports.read(path), ports.read(revisionPath)]))
      return { originalContent, modifiedContent, revisionPath }
    },
    async merge(meta: Meta, path: string, revision: string, text: string, expectedContent?: string) {
      const result = await step(() => ports.merge(meta.chapterNumber, path, revision, text, expectedContent))
      if (!result.success) return { ...result, pending: undefined, refreshError: undefined }
      try {
        const pending = await step(() => ports.pending(meta.id, meta.version))
        return { success: true as const, pending, refreshError: result.refreshError }
      } catch (error) {
        assertCurrent()
        return { success: true as const, pending: undefined, refreshError: [result.refreshError, String(error)].filter(Boolean).join('; ') }
      }
    },
    async review(meta: Meta) {
      const latest = await step(() => ports.latestReview(meta.id, meta.version))
      if (!latest) return null
      const content = await step(() => ports.read(`vela://review/${latest.id}`))
      return content ? { id: latest.id, content } : null
    },
    async translation(meta: Meta, _text: string, prompt: string, system: string) {
      const translated = (await step(() => ports.translate(prompt, system))).trim()
      if (!translated) throw new Error(ports.errors.empty)
      const version = await step(() => ports.nextVersion(meta.chapterNumber))
      const id = await step(() => ports.createTranslation(meta.chapterNumber, version, translated))
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error(ports.errors.create)
      assertCurrent(); ports.refresh()
      return { id, content: translated }
    },
  }
}
