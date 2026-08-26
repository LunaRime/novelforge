// 作品记忆文件通道控制器 — memory:* 5 通道
import { ipcMain } from 'electron'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { getCurrentProjectPath } from '../database'
import { parseMemoryFile, markStaleFrontmatter } from '../utils/memory-codec'
import type { MemoryFileMeta } from '../utils/memory-codec'

const memoryDir = (): string => {
  const p = getCurrentProjectPath()
  if (!p) throw new Error('no project')
  return path.join(p, '.vela', 'memory')
}

/**
 * 记忆文件名白名单校验（F7）：拒绝空名/'.'/'..'/非 .md 后缀——
 * 防路径穿越外的越权名（目录名、脚本文件）与空名误写。返回 basename。
 */
export function assertSafeMemoryFileName(file: string): string {
  const base = path.basename(file)
  if (!base || base === '.' || base === '..' || !base.endsWith('.md')) {
    throw new Error(`unsafe memory file name: ${file}`)
  }
  return base
}

/**
 * kind 白名单分类（F9）：仅 book-state.md 归 book；chapters-/volume- 前缀归对应类；
 * shared（P3）：文件名 shared.md 或 frontmatter type: shared → 跨会话可复用事实，参与 M2 节选注入；
 * 其余无法识别前缀的 .md（用户手放 notes.md 等）kind=unknown——不参与 M2 节选注入。
 */
export function classifyMemoryFileKind(name: string, content?: string | null): MemoryFileMeta['kind'] {
  if (name === 'book-state.md') return 'book'
  if (name.startsWith('chapters-')) return 'chapters'
  if (name.startsWith('volume-')) return 'volume'
  if (name === 'shared.md' || parseMemoryFile(content ?? '')?.frontmatter.type === 'shared') return 'shared'
  return 'unknown'
}

const safeFile = (file: string): string => {
  return path.join(memoryDir(), assertSafeMemoryFileName(file))
}

export function registerMemoryController() {
  ipcMain.handle('memory:list', async (): Promise<MemoryFileMeta[]> => {
    try {
      const dir = memoryDir()
      await fsPromises.mkdir(dir, { recursive: true })
      const entries = await fsPromises.readdir(dir, { withFileTypes: true })
      const out: MemoryFileMeta[] = []
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue
        const raw = await fsPromises.readFile(path.join(dir, e.name), 'utf-8').catch(() => '')
        const parsed = parseMemoryFile(raw)
        const kind = classifyMemoryFileKind(e.name, raw) // F9：白名单分类（P3：frontmatter type: shared 识别），未知前缀 → unknown
        const range = kind === 'chapters' ? e.name.replace(/^chapters-(\d+)-(\d+)\.md$/, '$1-$2') : undefined
        const stat = await fsPromises.stat(path.join(dir, e.name))
        out.push({ file: e.name, kind, range, stale: parsed ? parsed.frontmatter.status === 'stale' : false, mtime: stat.mtimeMs })
      }
      return out.sort((a, b) => b.mtime - a.mtime)
    } catch { return [] }
  })

  ipcMain.handle('memory:read', async (_e, file: string): Promise<string | null> => {
    try { return await fsPromises.readFile(safeFile(file), 'utf-8') } catch { return null }
  })

  ipcMain.handle('memory:write', async (_e, file: string, content: string): Promise<{ success: boolean }> => {
    let temp: string | null = null
    try {
      const dir = memoryDir()
      await fsPromises.mkdir(dir, { recursive: true })
      const target = safeFile(file)
      temp = `${target}.${Date.now()}.tmp`
      await fsPromises.writeFile(temp, content, 'utf-8')
      await fsPromises.rename(temp, target)
      temp = null // 已重命名，无残留
      return { success: true }
    } catch {
      // F7：写失败时清理残留临时文件（防 .tmp 堆积）
      if (temp) await fsPromises.unlink(temp).catch(() => {})
      return { success: false }
    }
  })

  ipcMain.handle('memory:mark-stale', async (_e, file: string): Promise<{ success: boolean }> => {
    let temp: string | null = null
    try {
      const target = safeFile(file)
      const raw = await fsPromises.readFile(target, 'utf-8')
      const marked = markStaleFrontmatter(raw)
      if (marked === raw) return { success: true }
      temp = `${target}.${Date.now()}.tmp`
      await fsPromises.writeFile(temp, marked, 'utf-8')
      await fsPromises.rename(temp, target)
      temp = null // 已重命名，无残留
      return { success: true }
    } catch {
      // F7：写失败时清理残留临时文件（防 .tmp 堆积）
      if (temp) await fsPromises.unlink(temp).catch(() => {})
      return { success: false }
    }
  })

  ipcMain.handle('memory:delete', async (_e, file: string): Promise<{ success: boolean }> => {
    try { await fsPromises.unlink(safeFile(file)); return { success: true } }
    catch (err) { return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { success: true } : { success: false } }
  })
}
