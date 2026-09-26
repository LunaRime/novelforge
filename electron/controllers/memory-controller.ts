// 作品记忆文件通道控制器 — memory:* 5 通道
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { getCurrentProjectPath } from '../database'
import { parseMemoryFile, markStaleFrontmatter, extractMemoryBrief, normalizeLoadMode } from '../utils/memory-codec'
import { getProjectVelaDir } from '../utils/config-utils'
import type { MemoryFileMeta } from '../utils/memory-codec'
import { guardedHandle } from '../security/ipc-guard'

const memoryDir = (): string => {
  const p = getCurrentProjectPath()
  if (!p) throw new Error('no project')
  return path.join(getProjectVelaDir(p), 'memory')
}

/**
 * 记忆文件名白名单校验（F7）：拒绝空名/'.'/'..'/非 .md 后缀——
 * 防路径穿越外的越权名（目录名、脚本文件）与空名误写。返回 basename。
 */
export function assertSafeMemoryFileName(file: string): string {
  // 先归一化 Windows 反斜杠再取 basename：POSIX（CI ubuntu/macos）的 path.basename
  // 不把 '\' 当分隔符，否则 '..\..\evil.md' 会原样通过守卫（跨平台行为不一致）。
  const base = path.basename(file.replace(/\\/g, '/'))
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

/**
 * 单行元数据（纯函数，供 memory:list 与单测）：列表循环本来就逐个读文件做 kind 分类，
 * 分层与 brief 顺带算出 —— 不额外读盘。
 */
export function buildMemoryFileMeta(name: string, raw: string, mtime: number): MemoryFileMeta {
  const parsed = parseMemoryFile(raw)
  const kind = classifyMemoryFileKind(name, raw)
  return {
    file: name,
    kind,
    loadMode: normalizeLoadMode(parsed?.frontmatter.load_mode),
    brief: extractMemoryBrief(raw),
    range: kind === 'chapters' ? name.replace(/^chapters-(\d+)-(\d+)\.md$/, '$1-$2') : undefined,
    stale: parsed ? parsed.frontmatter.status === 'stale' : false,
    mtime,
  }
}

export function registerMemoryController() {
  guardedHandle('memory:list', async (): Promise<MemoryFileMeta[]> => {
    try {
      const dir = memoryDir()
      await fsPromises.mkdir(dir, { recursive: true })
      const entries = await fsPromises.readdir(dir, { withFileTypes: true })
      const out: MemoryFileMeta[] = []
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue
        const raw = await fsPromises.readFile(path.join(dir, e.name), 'utf-8').catch(() => '')
        const stat = await fsPromises.stat(path.join(dir, e.name))
        out.push(buildMemoryFileMeta(e.name, raw, stat.mtimeMs))
      }
      return out.sort((a, b) => b.mtime - a.mtime)
    } catch { return [] }
  })

  guardedHandle('memory:read', async (_e, file: string): Promise<string | null> => {
    try { return await fsPromises.readFile(safeFile(file), 'utf-8') } catch { return null }
  })

  guardedHandle('memory:write', async (_e, file: string, content: string): Promise<{ success: boolean }> => {
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

  guardedHandle('memory:mark-stale', async (_e, file: string): Promise<{ success: boolean }> => {
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

  guardedHandle('memory:delete', async (_e, file: string): Promise<{ success: boolean }> => {
    try { await fsPromises.unlink(safeFile(file)); return { success: true } }
    catch (err) { return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { success: true } : { success: false } }
  })
}
