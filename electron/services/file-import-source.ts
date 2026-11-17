import { ChapterError, fileRevision, readFileChapterCommitReceipt, type ChapterIndexDatabase, type FileChapterStore } from '../../src/core'
import type { FileImportChapter, ProjectChannels } from '../../src/shared/ipc-channels'

export function* fileImportEntries(projectId: string, firstNumber: number, chapters: FileImportChapter[]) {
  if (!Array.isArray(chapters) || chapters.length === 0 || !Number.isSafeInteger(firstNumber) || firstNumber < 1 ||
      !Number.isSafeInteger(firstNumber + (chapters.length - 1))) {
    throw new ChapterError('invalid-chapter', 'Invalid file chapter import')
  }
  // 首次写入前检查整批输入，包括稀疏数组中缺失的章节。
  for (const chapter of chapters) {
    if (typeof chapter?.title !== 'string' || typeof chapter.content !== 'string') {
      throw new ChapterError('invalid-chapter', 'Invalid file chapter import')
    }
  }
  for (const [index, { title, content }] of chapters.entries()) {
    const number = firstNumber + index
    // 操作 ID 绑定项目、目标章号和拆章内容，重启后可用相同输入找到原回执。
    const operationId = fileRevision(JSON.stringify(['import', projectId, number, title, content]))
    yield { operationId, chapterId: `ch_${operationId}`, number, title, content }
  }
}

export async function readFileImportSource(db: ChapterIndexDatabase, repo: FileChapterStore, projectId: string,
  firstNumber: number, chapters: FileImportChapter[]): Promise<ProjectChannels['project:file-editor-import-source']['return']> {
  const committed = []
  for (const { operationId, chapterId, number } of fileImportEntries(projectId, firstNumber, chapters)) {
    const receipt = readFileChapterCommitReceipt(db, projectId, operationId)
    // 导入遇到冲突或中断时停止，只有请求开头连续的已提交章属于本次快照。
    if (!receipt) break
    committed.push({ chapterId, number, revision: receipt.revision })
  }

  const stored = await repo.readByIds(committed.map(entry => entry.chapterId))
  return { projectId, chapters: committed.map(({ chapterId, number, revision }) => {
    const current = stored.get(chapterId)
    if (!current || current.chapter.number !== number || current.revision !== revision) {
      throw new ChapterError('conflict', `Imported chapter ${number} changed since publication`)
    }
    return { chapterId, number, revision, title: current.chapter.title, content: current.chapter.content }
  }) }
}
