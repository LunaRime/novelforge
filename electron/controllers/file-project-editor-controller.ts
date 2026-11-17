import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { FileChapterStore, MemoryChapterIndex, openProjectInspection, fileRevision,
  createFileEditorOpenPort, openEditorDocument, type GeneratedBlueprintFields, type MigratedDraftIdentityMap } from '../../src/core'
import type { FileAgentEditProposal, FileDraftCommand, FileImportChapter, FileImportSettingField, FileImportSettings, ProjectChannels } from '../../src/shared/ipc-channels'
import { guardedHandle } from '../security/ipc-guard'
import { assertPathAllowedForIpc } from './fs-controller'
import { createFileDraftLifecycle } from '../services/file-draft-lifecycle'
import { readFileImportSource } from '../services/file-import-source'
import { fileImportIndexPath, indexImportedChapters, readImportInferenceContext } from '../services/file-import-index'
import { applyFileImportSettings, installFileImportSettingVersions, readFileImportSettingBaseline, type SettingBaseline } from '../services/file-import-settings'
import { applyImportBlueprints, readImportBlueprintTargets } from '../services/file-import-blueprints'
import { logger } from '../utils/logger'

const candidateRecord = '.novelforge/file-editor.json'
const identityFile = '.novelforge/draft-identity.json'
const manifestFile = 'migration-manifest.json'
const legacyBarrier = '.novelforge/vela.db'
const retainedFile = '.novelforge/retained.db'
const current = /^doc:\/\/chapter\/(ch_[a-f0-9]{8,64})$/
const historical = /^(?:doc:\/\/history|vela:\/\/draft)\/[1-9][0-9]{0,15}$/
type OpenResult = ProjectChannels['project:file-editor-open']['return']
type Lifecycle = ReturnType<typeof createFileDraftLifecycle>
type InferenceContext = ProjectChannels['project:file-editor-import-inference']['return']
type BlueprintContext = ProjectChannels['project:file-editor-import-blueprints']['return']

interface SettingsOffer {
  id: string
  snapshot?: { baseline: SettingBaseline; revisions: InferenceContext['revisions'] }
}

interface BlueprintOffer {
  id: string
  snapshot?: { revisions: BlueprintContext['revisions']; targetChapterNumbers: number[] }
}

interface FileEditorSession {
  token: string
  projectId: string
  projectPath: string
  repo: FileChapterStore
  documentPort: Awaited<ReturnType<typeof createFileEditorOpenPort>>
  agentEdits: Map<string, FileAgentEditProposal & { chapterId: string; offset: number }>
  assertCandidate: () => Promise<void>
  inspectKind: Awaited<ReturnType<typeof openProjectInspection>>['kind']
  withLifecycle?: <T>(work: (lifecycle: Lifecycle, db: Database.Database) => Promise<T>) => Promise<T>
  settingsOffer?: SettingsOffer
  blueprintOffer?: BlueprintOffer
}

function agentReadLimit(offset: number, limit: number, max: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Invalid file editor Agent read range')
  }
  return Math.min(limit, max)
}

export function registerFileProjectEditorController() {
  const sessions = new Map<number, FileEditorSession>()
  const observed = new WeakSet<object>()
  const requests = new Map<number, string>()

  guardedHandle('project:file-editor-open', async ({ sender }, projectPath: string, locators: string[]): Promise<OpenResult> => {
    if (!Array.isArray(locators) || locators.length > 100 || locators.some(locator => typeof locator !== 'string' || locator.length > 200)) {
      throw new Error('Invalid file editor tabs')
    }
    const path = assertPathAllowedForIpc(projectPath, 'read')
    if (!observed.has(sender)) {
      observed.add(sender)
      sender.once('destroyed', () => { sessions.delete(sender.id); requests.delete(sender.id) })
    }
    const token = randomUUID()
    requests.set(sender.id, token)
    sessions.delete(sender.id)
    const reader = await openProjectInspection(path)
    const recordText = await reader.readText(candidateRecord)
    const record = JSON.parse(recordText)
    const mapping = await reader.readText(identityFile)
    const identity = JSON.parse(mapping) as MigratedDraftIdentityMap
    const manifest = await reader.readText(manifestFile)
    const project = JSON.parse(await reader.readText('novel.json'))
    if (record?.format !== 1 || project?.schemaVersion !== 1 || typeof project.id !== 'string' ||
        record.projectId !== project.id || identity?.format !== 1 || identity.projectId !== project.id ||
        !Array.isArray(identity.entries) || identity.manifestHash !== fileRevision(manifest) ||
        record.identityHash !== fileRevision(mapping) ||
        (record.lifecycle !== undefined && record.lifecycle !== 1)) throw new Error('Invalid file editor candidate')
    const assertCandidate = async () => {
      if (await reader.kind(legacyBarrier) !== 'directory' || await reader.kind('.vela') !== 'missing' ||
          await reader.readText(candidateRecord) !== recordText || await reader.readText(identityFile) !== mapping ||
          await reader.readText(manifestFile) !== manifest ||
          (record.lifecycle === 1 && await reader.kind(retainedFile) !== 'file')) throw new Error('File editor candidate changed')
    }
    await assertCandidate()
    assertPathAllowedForIpc(path, 'write')
    const repo = await FileChapterStore.open({ projectPath: path, projectId: identity.projectId, index: new MemoryChapterIndex() })
    const withLifecycle: FileEditorSession['withLifecycle'] = record.lifecycle === 1 ? async work => {
      await assertCandidate()
      // Open a separately provisioned copy. The migration backup and legacy DB barrier remain untouched.
      const db = new Database(join(path, retainedFile), { fileMustExist: true })
      try {
        return await work(createFileDraftLifecycle(db, repo, identity.projectId, identity.entries, () => {
          if (requests.get(sender.id) !== token) throw new Error('File editor session changed')
        }), db)
      }
      finally { db.close() }
    } : undefined
    // Resolve pending metadata before returning writable tabs. An ambiguous recovery fails the open.
    if (withLifecycle) await withLifecycle(async (lifecycle, db) => {
      await lifecycle.recover()
      // 旧候选库缺少设定列时仍可打开正文。只有能跟踪版本的字段才可应用推演。
      try { installFileImportSettingVersions(db) }
      catch (error) { logger.warn('FileProjectEditor', String(error)) }
    })
    const chapters = await repo.list()
    const documents = [
      ...chapters.map(chapter => ({ locator: `doc://chapter/${chapter.id}`, name: chapter.title || String(chapter.number) })),
      ...identity.entries.filter(entry => entry.target.kind === 'history').map(entry => ({
        locator: `doc://history/${entry.draftId}`,
        name: chapters.find(chapter => chapter.id === entry.chapterId)?.title || String(entry.draftId),
      })),
    ]
    const names = new Map(documents.map(document => [document.locator, document.name]))
    const numbers = new Map(chapters.map(chapter => [`doc://chapter/${chapter.id}`, chapter.number]))
    const scope = () => ({ projectId: identity.projectId, projectPath: path, session: requests.get(sender.id) === token ? 1 : 2 })
    const portOptions = { projectPath: path, identity, scope, publish: () => {} }
    const port = await createFileEditorOpenPort({ ...portOptions, repo })
    const tabs: OpenResult['tabs'] = []
    const missing: string[] = []
    for (const locator of locators) {
      const result = await openEditorDocument({ kind: 'path', documentKind: 'chapter', locator, name: locator }, port)
      if (result.status === 'missing') { missing.push(locator); continue }
      tabs.push({ ...result.document, name: names.get(result.document.locator) ?? result.document.name, number: numbers.get(result.document.locator) })
    }
    if (withLifecycle && tabs.length) {
      await withLifecycle(async lifecycle => {
        for (const tab of tabs) {
          const id = current.exec(tab.locator)?.[1]
          if (id && tab.revision) tab.lifecycle = await lifecycle.actions(id, tab.revision)
        }
      })
    }
    // Agent 使用相同的定位符与历史映射，只读取现有文件，不刷新编辑器索引。
    const documentPort = await createFileEditorOpenPort({ ...portOptions, repo: {
      byId: async id => (await repo.readByIds([id])).get(id) ?? null,
    } })
    if (requests.get(sender.id) !== token) throw new Error('File editor session changed')
    sessions.set(sender.id, { token, projectId: identity.projectId, projectPath: path, repo, documentPort,
      assertCandidate, inspectKind: reader.kind, withLifecycle, agentEdits: new Map() })
    // 默认接在当前稿之后，导入时还会检查迁移历史占用的章号。
    const importStartNumber = withLifecycle ? chapters.reduce((latest, chapter) => Math.max(latest, chapter.number), 0) + 1 : undefined
    return { token, tabs, missing, documents, importStartNumber }
  })

  function requireAgentSession(senderId: number, token: string) {
    const session = sessions.get(senderId)
    const assertCurrent = () => {
      if (!session || session.token !== token || requests.get(senderId) !== token) throw new Error('Invalid file editor Agent session')
    }
    if (!session) throw new Error('Invalid file editor Agent session')
    assertCurrent()
    return { session, assertCurrent }
  }

  async function readForAgent<T>(senderId: number, token: string,
    work: (session: FileEditorSession, assertCurrent: () => void) => Promise<T>): Promise<T> {
    const { session, assertCurrent } = requireAgentSession(senderId, token)
    assertPathAllowedForIpc(session.projectPath, 'read')
    await session.assertCandidate()
    assertCurrent()
    const result = await work(session, assertCurrent)
    // 文件读取期间可能重开或切换项目，回包前再次核验目录与会话。
    await session.assertCandidate()
    assertCurrent()
    return result
  }

  guardedHandle('project:file-editor-agent-list', async ({ sender }, token: string, offset = 0, limit = 10) => {
    const end = offset + agentReadLimit(offset, limit, 20)
    return readForAgent(sender.id, token, async session => {
      const chapters = await session.repo.readChapterMetadata()
      return { chapters: chapters.slice(offset, end).map(({ id, number, title, status }) => ({
        locator: `doc://chapter/${id}`, number, title: title.slice(0, 160), status,
      })), nextOffset: end < chapters.length ? end : null }
    })
  })

  guardedHandle('project:file-editor-agent-read', async ({ sender }, token: string, locator: string, offset = 0, limit = 440) => {
    if (typeof locator !== 'string' || !(current.test(locator) || historical.test(locator))) throw new Error('Invalid file editor Agent locator')
    const end = offset + agentReadLimit(offset, limit, 440)
    return readForAgent(sender.id, token, async (session, assertCurrent) => {
      // 当前稿与历史稿共用编辑器定位符解析，历史文件继续校验原始映射与摘要。
      const document = await session.documentPort.resolve({ kind: 'path', documentKind: 'chapter', locator, name: locator }, assertCurrent)
      if (!document) throw new Error('File editor Agent chapter is unavailable')
      return { locator: document.locator, content: document.content.slice(offset, end), readOnly: Boolean(document.readOnly),
        revision: document.revision, totalChars: document.content.length, nextOffset: end < document.content.length ? end : null }
    })
  })

  guardedHandle('project:file-editor-agent-propose-edit', async ({ sender }, token: string, locator: string, revision: string,
    original: string, replacement: string): Promise<FileAgentEditProposal> => {
    const id = typeof locator === 'string' ? current.exec(locator)?.[1] : undefined
    if (!id || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision) || typeof original !== 'string' || !original.trim() ||
        original.length > 50000 || typeof replacement !== 'string' || replacement.length > 50000 || original === replacement) {
      throw new Error('Invalid file editor Agent edit proposal')
    }
    const { session, assertCurrent } = requireAgentSession(sender.id, token)
    const { proposal, offset } = await readForAgent(sender.id, token, async () => {
      const stored = (await session.repo.readByIds([id])).get(id)
      assertCurrent()
      if (!stored || stored.revision !== revision || ['finalized', 'archived'].includes(stored.chapter.status)) {
        throw new Error('Chapter changed or is read-only')
      }
      const offset = stored.chapter.content.indexOf(original)
      if (offset < 0 || stored.chapter.content.indexOf(original, offset + 1) !== -1) {
        throw new Error('Agent edit requires a unique original passage')
      }
      return { proposal: { id: randomUUID(), locator, revision, original, replacement }, offset }
    })
    assertCurrent()
    // 保留匹配位点。取消中的旧轮次即使迟到，也只能清理自己的提案。
    const oldest = session.agentEdits.keys().next().value
    if (oldest && session.agentEdits.size >= 8) session.agentEdits.delete(oldest)
    session.agentEdits.set(proposal.id, { ...proposal, chapterId: id, offset })
    return proposal
  })

  guardedHandle('project:file-editor-agent-resolve-edit', async ({ sender }, token: string, proposalId: string,
    decision: 'apply' | 'discard'): Promise<ProjectChannels['project:file-editor-agent-resolve-edit']['return']> => {
    const { session, assertCurrent } = requireAgentSession(sender.id, token)
    const proposal = session.agentEdits.get(proposalId)
    if (!proposal || (decision !== 'apply' && decision !== 'discard')) throw new Error('Invalid file editor Agent edit proposal')
    if (decision === 'discard') {
      session.agentEdits.delete(proposalId)
      return { status: 'discarded' }
    }
    const result = await saveChapter(session, proposal.chapterId, proposal.revision, body =>
      body.slice(0, proposal.offset) + proposal.replacement + body.slice(proposal.offset + proposal.original.length), () => {
      assertCurrent()
      if (!session.agentEdits.has(proposalId)) throw new Error('File editor Agent edit proposal changed')
    })
    session.agentEdits.delete(proposalId)
    return { status: 'saved', locator: proposal.locator, content: result.chapter.content, revision: result.revision, indexed: result.indexed }
  })

  guardedHandle('project:file-editor-save', async ({ sender }, token: string, locator: string, revision: string, content: string) => {
    const session = sessions.get(sender.id)
    const id = current.exec(locator)?.[1]
    if (!session || session.token !== token || requests.get(sender.id) !== token ||
        !id || typeof content !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid file editor save')
    const result = await saveChapter(session, id, revision, () => content, () => {
      if (requests.get(sender.id) !== token) throw new Error('File editor session changed')
    })
    return { revision: result.revision, indexed: result.indexed }
  })

  async function saveChapter(session: FileEditorSession, id: string, revision: string, nextContent: (body: string) => string,
    assertCurrent: () => void) {
    assertPathAllowedForIpc(session.projectPath, 'write')
    await session.assertCandidate()
    assertCurrent()
    return session.repo.withCommitLock(async repo => {
      // 跨存储操作须先完成恢复，普通保存才能推进正文 revision。
      if (session.withLifecycle) await session.withLifecycle(async lifecycle => lifecycle.assertIdle())
      const stored = await repo.byId(id)
      if (!stored || stored.revision !== revision || ['finalized', 'archived'].includes(stored.chapter.status)) {
        throw new Error('Chapter changed or is read-only')
      }
      assertCurrent()
      const content = nextContent(stored.chapter.content)
      return repo.save({ ...stored.chapter, content, updatedAt: new Date().toISOString() }, { expectedRevision: revision, assertCurrent })
    })
  }

  function requireLifecycleSession(senderId: number, token: string) {
    const session = sessions.get(senderId)
    if (!session?.withLifecycle || session.token !== token || requests.get(senderId) !== token) {
      throw new Error('Invalid file editor lifecycle session')
    }
    const assertCurrent = () => {
      if (requests.get(senderId) !== token) throw new Error('File editor session changed')
    }
    return { session, withLifecycle: session.withLifecycle, assertCurrent }
  }

  function mutate<T>(senderId: number, token: string, work: (lifecycle: Lifecycle) => Promise<T>): Promise<T> {
    const { session, withLifecycle, assertCurrent } = requireLifecycleSession(senderId, token)
    assertPathAllowedForIpc(session.projectPath, 'write')
    return withLifecycle(lifecycle => {
      // 打开保留库前有异步校验，执行写入前再次确认会话仍有效。
      assertCurrent()
      return work(lifecycle)
    })
  }

  guardedHandle('project:file-editor-commit', async ({ sender }, token: string, command: FileDraftCommand) =>
    mutate(sender.id, token, lifecycle => lifecycle.commit(command)))

  guardedHandle('project:file-editor-import', async ({ sender }, token: string, firstNumber: number, chapters: FileImportChapter[]) =>
    mutate(sender.id, token, lifecycle => lifecycle.importChapters(firstNumber, chapters)))

  async function loadImportSource(session: FileEditorSession, assertCurrent: () => void, firstNumber: number, chapters: FileImportChapter[]) {
    await session.assertCandidate()
    assertCurrent()
    // 单独用只读连接查询回执，读取输入时不初始化写入服务或重放待提交意图。
    const db = new Database(join(session.projectPath, retainedFile), { readonly: true, fileMustExist: true })
    try {
      const snapshot = await readFileImportSource(db, session.repo, session.projectId, firstNumber, chapters)
      await session.assertCandidate()
      assertCurrent()
      return snapshot
    } finally { db.close() }
  }

  function assertImportRevisions(chapters: InferenceContext['revisions'], revisions: InferenceContext['revisions']) {
    if (chapters.length !== revisions.length || revisions.some(({ chapterId, revision }, index) =>
      chapters[index].chapterId !== chapterId || chapters[index].revision !== revision)) throw new Error('Imported preview source changed')
  }

  guardedHandle('project:file-editor-import-source', async ({ sender }, token: string, firstNumber: number, chapters: FileImportChapter[]) => {
    const { session, assertCurrent } = requireLifecycleSession(sender.id, token)
    assertPathAllowedForIpc(session.projectPath, 'read')
    return loadImportSource(session, assertCurrent, firstNumber, chapters)
  })

  async function checkedImportIndexPath(session: FileEditorSession, mustExist = false) {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      const kind = await session.inspectKind(fileImportIndexPath + suffix)
      if (kind !== 'file' && kind !== 'missing') throw new Error('Unsafe file import index path')
      if (mustExist && !suffix && kind === 'missing') throw new Error('File import index is missing')
    }
    return join(session.projectPath, fileImportIndexPath)
  }

  guardedHandle('project:file-editor-index-import', async ({ sender }, token: string, firstNumber: number, chapters: FileImportChapter[]) => {
    const { session, assertCurrent } = requireLifecycleSession(sender.id, token)
    assertPathAllowedForIpc(session.projectPath, 'write')
    await session.assertCandidate()
    assertCurrent()
    return session.repo.withCommitLock(async () => {
      // 在同一把章节写锁内校验发布回执和 revision，再提交派生索引。
      const snapshot = await loadImportSource(session, assertCurrent, firstNumber, chapters)
      const path = await checkedImportIndexPath(session)
      assertCurrent()
      return indexImportedChapters(path, snapshot.chapters)
    })
  })

  guardedHandle('project:file-editor-import-inference', async ({ sender }, token: string, firstNumber: number, chapters: FileImportChapter[]): Promise<InferenceContext> => {
    const { session, assertCurrent } = requireLifecycleSession(sender.id, token)
    assertPathAllowedForIpc(session.projectPath, 'read')
    // 只保留当前会话最近一次预览，较早请求的回包不能替换它。
    const offer: SettingsOffer = { id: randomUUID() }
    session.settingsOffer = offer
    const snapshot = await loadImportSource(session, assertCurrent, firstNumber, chapters)
    const path = await checkedImportIndexPath(session, true)
    assertCurrent()
    if (session.settingsOffer !== offer) throw new Error('File editor settings offer changed')
    const context = readImportInferenceContext(path, snapshot)
    const db = new Database(join(session.projectPath, retainedFile), { readonly: true, fileMustExist: true })
    try {
      const baseline = readFileImportSettingBaseline(db)
      const available = Object.keys(baseline) as FileImportSettingField[]
      if (available.length) {
        offer.snapshot = { baseline, revisions: context.revisions }
        context.settingsOffer = { id: offer.id, available, occupied: available.filter(field => baseline[field]?.occupied) }
      }
      return context
    } finally { db.close() }
  })

  guardedHandle('project:file-editor-apply-import-settings', async ({ sender }, token: string, offerId: string,
    firstNumber: number, chapters: FileImportChapter[], settings: FileImportSettings) => {
    const { session, assertCurrent } = requireLifecycleSession(sender.id, token)
    assertPathAllowedForIpc(session.projectPath, 'write')
    const offer = session.settingsOffer
    const baseline = offer?.snapshot
    if (!offer || !baseline || offer.id !== offerId) throw new Error('Invalid file editor settings offer')
    await session.assertCandidate()
    assertCurrent()
    return session.repo.withCommitLock(async () => {
      const current = await loadImportSource(session, assertCurrent, firstNumber, chapters)
      if (session.settingsOffer !== offer) throw new Error('File editor settings offer changed')
      // 章节锁内重新核对整批正文，再打开此候选的保留库写设定。
      assertImportRevisions(current.chapters, baseline.revisions)
      const db = new Database(join(session.projectPath, retainedFile), { fileMustExist: true })
      try {
        const receipt = applyFileImportSettings(db, baseline.baseline, settings)
        session.settingsOffer = undefined
        return receipt
      } finally { db.close() }
    })
  })

  guardedHandle('project:file-editor-import-blueprints', async ({ sender }, token: string, firstNumber: number,
    chapters: FileImportChapter[]): Promise<BlueprintContext> => {
    const { session, assertCurrent } = requireLifecycleSession(sender.id, token)
    assertPathAllowedForIpc(session.projectPath, 'read')
    const offer: BlueprintOffer = { id: randomUUID() }
    session.blueprintOffer = offer
    const snapshot = await loadImportSource(session, assertCurrent, firstNumber, chapters)
    if (session.blueprintOffer !== offer) throw new Error('File editor blueprint offer changed')
    const db = new Database(join(session.projectPath, retainedFile), { readonly: true, fileMustExist: true })
    try {
      if (!snapshot.chapters.length) throw new Error('No published chapters to infer')
      const { available, existingChapterNumbers } = readImportBlueprintTargets(db, snapshot.chapters.map(chapter => chapter.number))
      const existing = new Set(existingChapterNumbers)
      const candidates = snapshot.chapters.filter(chapter => !existing.has(chapter.number))
        .map(({ number, title, content }) => ({ number, title, content: content.slice(0, 6000) }))
      const revisions = snapshot.chapters.map(({ chapterId, revision }) => ({ chapterId, revision }))
      const offerId = available && candidates.length ? offer.id : undefined
      // 现有蓝图的章号不进入生成或应用名单，即便后来被删除也要重新预览才能补入。
      if (offerId) offer.snapshot = { revisions, targetChapterNumbers: candidates.map(chapter => chapter.number) }
      return { projectId: snapshot.projectId, candidates, existingChapterNumbers, revisions, offerId }
    } finally { db.close() }
  })

  guardedHandle('project:file-editor-apply-import-blueprints', async ({ sender }, token: string, offerId: string,
    firstNumber: number, chapters: FileImportChapter[], items: GeneratedBlueprintFields[]) => {
    const { session, assertCurrent } = requireLifecycleSession(sender.id, token)
    assertPathAllowedForIpc(session.projectPath, 'write')
    const offer = session.blueprintOffer
    const target = offer?.snapshot
    if (!offer || !target || offer.id !== offerId) throw new Error('Invalid file editor blueprint offer')
    await session.assertCandidate()
    assertCurrent()
    return session.repo.withCommitLock(async () => {
      const current = await loadImportSource(session, assertCurrent, firstNumber, chapters)
      if (session.blueprintOffer !== offer) throw new Error('File editor blueprint offer changed')
      assertImportRevisions(current.chapters, target.revisions)
      const db = new Database(join(session.projectPath, retainedFile), { fileMustExist: true })
      try {
        const receipt = applyImportBlueprints(db, { projectPath: session.projectPath, token }, assertCurrent,
          target.targetChapterNumbers, items)
        session.blueprintOffer = undefined
        return receipt
      } finally { db.close() }
    })
  })

  guardedHandle('project:file-editor-preview', async ({ sender }, token: string, chapterId: string, revisionId: number) => {
    const session = sessions.get(sender.id)
    if (!session?.withLifecycle || session.token !== token || requests.get(sender.id) !== token ||
        !Number.isSafeInteger(revisionId) || revisionId < 1) throw new Error('Invalid file editor preview')
    assertPathAllowedForIpc(session.projectPath, 'read')
    return session.withLifecycle(async lifecycle => {
      if (requests.get(sender.id) !== token) throw new Error('File editor session changed')
      return lifecycle.preview(chapterId, revisionId)
    })
  })

  guardedHandle('project:file-editor-close', ({ sender }, token: string) => {
    if (sessions.get(sender.id)?.token !== token) return
    sessions.delete(sender.id)
    if (requests.get(sender.id) === token) requests.delete(sender.id)
  })
}
