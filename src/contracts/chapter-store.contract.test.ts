import { afterEach, describe, expect, test } from 'vitest'
import { mkdtemp, readFile, readdir, rename, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileChapterStore, MemoryChapterIndex, writeChapter, type Chapter } from '../core'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'novelforge-core-'))
  roots.push(root)
  const index = new MemoryChapterIndex()
  const repo = await FileChapterStore.open({ projectPath: root, projectId: 'project-a', index })
  return { root, index, repo }
}
function chapter(overrides: Partial<Chapter> = {}): Chapter {
  return { projectId: 'project-a', id: 'ch_12345678', number: 1, title: '雨夜: "序"\n续',
    status: 'draft', content: '正文\r\n---\n结尾\n', createdAt: '2026-11-05T00:00:00Z',
    updatedAt: '2026-11-05T00:00:00Z', ...overrides }
}
describe('章节存储契约', () => {
  test('创建仅用序号命名，frontmatter 和正文无损往返', async () => {
    const { repo, root } = await fixture()
    const ch = chapter()
    const saved = await writeChapter(repo, ch, { expectedRevision: null })
    expect(await readdir(join(root, 'chapters'))).toEqual(['0001.md'])
    expect(await repo.byId(ch.id)).toEqual(saved)
    expect(saved.chapter).toEqual(ch)
    await expect(repo.save(ch, { expectedRevision: null })).rejects.toMatchObject({ code: 'conflict' })
  })
  test('重排保留 id、正文和历史，拒绝覆盖另一章', async () => {
    const { repo, root } = await fixture()
    const first = await repo.save(chapter(), { expectedRevision: null })
    await repo.save(chapter({ id: 'ch_87654321', number: 2 }), { expectedRevision: null })
    await expect(repo.save(chapter({ number: 2 }), { expectedRevision: first.revision })).rejects.toMatchObject({ code: 'number-conflict' })
    const moved = await repo.save(chapter({ number: 3 }), { expectedRevision: first.revision })
    expect(moved.chapter.id).toBe(first.chapter.id)
    expect((await readdir(join(root, 'chapters'))).sort()).toEqual(['0002.md', '0003.md'])
    expect(await readdir(join(root, 'history', first.chapter.id))).toHaveLength(1)
  })
  test('外部改名后重扫按 id 找回', async () => {
    const { repo, root } = await fixture()
    await repo.save(chapter(), { expectedRevision: null })
    await rename(join(root, 'chapters/0001.md'), join(root, 'chapters/外部改名.md'))
    await repo.rescan()
    expect((await repo.byId('ch_12345678'))?.chapter.content).toBe(chapter().content)
    expect((await repo.list())[0].path).toBe('chapters/外部改名.md')
  })
  test('外部编辑重载索引，拒绝旧 revision 保存', async () => {
    const { repo, root } = await fixture()
    const saved = await repo.save(chapter(), { expectedRevision: null })
    const file = join(root, 'chapters/0001.md')
    await writeFile(file, (await readFile(file, 'utf8')).replace('正文', '外部正文'))
    const changed = await repo.byId(saved.chapter.id)
    expect(changed?.chapter.content).toContain('外部正文')
    expect((await repo.list())[0].revision).toBe(changed?.revision)
    await expect(repo.save(chapter(), { expectedRevision: saved.revision })).rejects.toMatchObject({ code: 'conflict' })
  })
  test('索引可重建，重复 id 不会悄悄吞章', async () => {
    const { repo, root, index } = await fixture()
    await repo.save(chapter(), { expectedRevision: null })
    await index.replace([])
    expect(await repo.list()).toHaveLength(0)
    await repo.rescan()
    expect(await repo.list()).toHaveLength(1)
    await writeFile(join(root, 'chapters/duplicate.md'), await readFile(join(root, 'chapters/0001.md')))
    await expect(repo.rescan()).rejects.toMatchObject({ code: 'duplicate-id' })
    expect(await repo.list()).toHaveLength(1)
  })
  test('崩溃 tmp 不作为正文，保留可能仍在写入的 tmp', async () => {
    const { repo, root } = await fixture()
    await repo.save(chapter(), { expectedRevision: null })
    await writeFile(join(root, 'chapters/0002.md.999.tmp'), '半截')
    expect(await repo.rescan()).toHaveLength(1)
    expect(await readdir(join(root, 'chapters'))).toContain('0002.md.999.tmp')
  })
  test('拒绝跨项目写入、项目身份变更与路径 id', async () => {
    const { repo, root } = await fixture()
    await expect(repo.save(chapter({ projectId: 'project-b' }), { expectedRevision: null })).rejects.toMatchObject({ code: 'project-mismatch' })
    await expect(repo.byId('../escape')).rejects.toMatchObject({ code: 'invalid-chapter' })
    await writeFile(join(root, 'novel.json'), JSON.stringify({ id: 'project-b' }))
    await expect(repo.save(chapter(), { expectedRevision: null })).rejects.toMatchObject({ code: 'project-mismatch' })
  })
  test('同 revision 并发写最多成功一个，删除可从历史恢复', async () => {
    const { repo, root } = await fixture()
    const saved = await repo.save(chapter(), { expectedRevision: null })
    const results = await Promise.allSettled(['A', 'B'].map(content => repo.save(chapter({ content }), { expectedRevision: saved.revision })))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const current = await repo.byId(saved.chapter.id)
    await repo.remove(saved.chapter.id, { expectedRevision: current!.revision })
    expect(await repo.byId(saved.chapter.id)).toBeNull()
    expect((await readdir(join(root, 'history', saved.chapter.id))).length).toBeGreaterThan(0)
  })
  test('索引失败不撤回已保存文件，重扫可恢复', async () => {
    const { repo, index } = await fixture()
    const original = index.replace.bind(index)
    index.replace = async () => { throw new Error('index unavailable') }
    const saved = await repo.save(chapter(), { expectedRevision: null })
    expect(saved.indexed).toBe(false)
    index.replace = original
    expect(await repo.rescan()).toHaveLength(1)
  })
  test('拒绝章节符号链接，不跟随到项目外', async () => {
    const { repo, root } = await fixture()
    await repo.save(chapter(), { expectedRevision: null })
    try { await symlink(join(root, 'novel.json'), join(root, 'chapters/link.md')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error }
    await expect(repo.rescan()).rejects.toMatchObject({ code: 'unsafe-path' })
  })
  test('异步保存期间调用方修改对象不会改变本次项目身份或正文', async () => {
    const { repo } = await fixture()
    const input = chapter()
    const saving = repo.save(input, { expectedRevision: null })
    input.projectId = 'project-b'
    input.content = '调用方后来改过'
    const saved = await saving
    expect(saved.chapter.projectId).toBe('project-a')
    expect(saved.chapter.content).toBe(chapter().content)
  })
})
