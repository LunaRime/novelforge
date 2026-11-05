import { afterEach, beforeEach, expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertProjectWriteHasNoLinks } from './project-write-path'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-write-path-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })
function link(target: string, alias: string) { fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir') }
test('blocks junction parent aliases into chapters before a write', () => {
  const chapters = path.join(root, 'chapters'); fs.mkdirSync(chapters)
  link(chapters, path.join(root, 'notes'))
  expect(() => assertProjectWriteHasNoLinks(path.join(root, 'notes', '0001.md'), root)).toThrow()
})
test('blocks links from project to external directories, including missing child paths', () => {
  const project = path.join(root, 'project'); const external = path.join(root, 'external')
  fs.mkdirSync(project); fs.mkdirSync(external); link(external, path.join(project, 'alias'))
  expect(() => assertProjectWriteHasNoLinks(path.join(project, 'alias', 'new', 'file.md'), project)).toThrow()
})
test('permits ordinary project files and nonexistent nested output directories', () => {
  expect(() => assertProjectWriteHasNoLinks(path.join(root, 'new', 'file.md'), root)).not.toThrow()
})
test('permits a project opened through a root junction but rejects linked children', () => {
  const project = path.join(root, 'project'); const alias = path.join(root, 'root-alias')
  fs.mkdirSync(project); link(project, alias)
  expect(() => assertProjectWriteHasNoLinks(path.join(alias, 'new', 'file.md'), alias)).not.toThrow()
  fs.mkdirSync(path.join(project, 'chapters')); link(path.join(project, 'chapters'), path.join(project, 'notes'))
  expect(() => assertProjectWriteHasNoLinks(path.join(alias, 'notes', '0001.md'), alias)).toThrow()
})
test('does not change explicitly authorized external export policy', () => {
  const project = path.join(root, 'project'); const output = path.join(root, 'output'); const alias = path.join(root, 'export-alias')
  fs.mkdirSync(project); fs.mkdirSync(output); link(output, alias)
  expect(() => assertProjectWriteHasNoLinks(path.join(alias, 'book.md'), project)).not.toThrow()
})
test('rechecking after an async queue detects a directory replaced with a junction', async () => {
  const notes = path.join(root, 'notes'); const chapters = path.join(root, 'chapters')
  fs.mkdirSync(notes); fs.mkdirSync(chapters)
  const candidate = path.join(notes, '0001.md')
  assertProjectWriteHasNoLinks(candidate, root)
  await Promise.resolve()
  fs.renameSync(notes, path.join(root, 'old-notes')); link(chapters, notes)
  expect(() => assertProjectWriteHasNoLinks(candidate, root)).toThrow()
  expect(fs.existsSync(path.join(chapters, '0001.md'))).toBe(false)
})
