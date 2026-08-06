/**
 * 导出控制器 — 章节导出为文件夹或 ZIP 压缩包
 *
 * 支持：
 * - 单章导出 / 批量导出
 * - 文件夹格式 / ZIP 压缩格式
 * - 跨平台（Windows/macOS/Linux）
 */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { t } from '../../src/shared/locale'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { getProjectDb } from '../database'
import { logger } from '../utils/logger'
import { safeErrorMessage } from '../utils/error-utils'

// ===== ZIP 写入器（纯 Node.js 内置模块，零外部依赖） =====

/**
 * 轻量级 ZIP64 创建器。
 * 使用 Node.js 内置 zlib + Buffer，无需额外依赖。
 *
 * ZIP 文件结构（简化）：
 *   [Local File Header 1][Compressed Data 1]
 *   [Local File Header 2][Compressed Data 2]
 *   ...
 *   [Central Directory Entry 1][Central Directory Entry 2]...
 *   [End of Central Directory Record]
 */
class ZipWriter {
  private entries: ZipEntry[] = []

  addFile(name: string, content: string | Buffer): void {
    this.entries.push({ name, content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8') })
  }

  async writeToFile(outputPath: string): Promise<void> {
    const zlib = await import('node:zlib')
    const localHeaders: Buffer[] = []
    const centralHeaders: Buffer[] = []
    let localOffset = 0

    for (const entry of this.entries) {
      // 压缩内容
      const compressed = zlib.deflateRawSync(entry.content)
      const crc = crc32(entry.content)
      const nameBuffer = Buffer.from(entry.name, 'utf-8')

      // Local File Header
      const localHeader = Buffer.alloc(30 + nameBuffer.length)
      let pos = 0
      localHeader.writeUInt32LE(0x04034b50, pos); pos += 4  // signature
      localHeader.writeUInt16LE(20, pos); pos += 2            // version needed
      localHeader.writeUInt16LE(0x0800, pos); pos += 2        // general purpose bit flag (UTF-8)
      localHeader.writeUInt16LE(8, pos); pos += 2             // compression method (deflate)
      localHeader.writeUInt16LE(0, pos); pos += 2             // last mod time
      localHeader.writeUInt16LE(0, pos); pos += 2             // last mod date
      localHeader.writeUInt32LE(crc, pos); pos += 4           // crc-32
      localHeader.writeUInt32LE(compressed.length, pos); pos += 4  // compressed size
      localHeader.writeUInt32LE(entry.content.length, pos); pos += 4  // uncompressed size
      localHeader.writeUInt16LE(nameBuffer.length, pos); pos += 2  // file name length
      localHeader.writeUInt16LE(0, pos)                       // extra field length
      nameBuffer.copy(localHeader, pos)

      localHeaders.push(localHeader, compressed)

      // Central Directory Header
      const centralHeader = Buffer.alloc(46 + nameBuffer.length)
      pos = 0
      centralHeader.writeUInt32LE(0x02014b50, pos); pos += 4  // signature
      centralHeader.writeUInt16LE(20, pos); pos += 2           // version made by
      centralHeader.writeUInt16LE(20, pos); pos += 2           // version needed
      centralHeader.writeUInt16LE(0x0800, pos); pos += 2       // general purpose bit flag (UTF-8)
      centralHeader.writeUInt16LE(8, pos); pos += 2            // compression method
      centralHeader.writeUInt16LE(0, pos); pos += 2            // last mod time
      centralHeader.writeUInt16LE(0, pos); pos += 2            // last mod date
      centralHeader.writeUInt32LE(crc, pos); pos += 4          // crc-32
      centralHeader.writeUInt32LE(compressed.length, pos); pos += 4  // compressed size
      centralHeader.writeUInt32LE(entry.content.length, pos); pos += 4  // uncompressed size
      centralHeader.writeUInt16LE(nameBuffer.length, pos); pos += 2  // file name length
      centralHeader.writeUInt16LE(0, pos); pos += 2            // extra field length
      centralHeader.writeUInt16LE(0, pos); pos += 2            // file comment length
      centralHeader.writeUInt16LE(0, pos); pos += 2            // disk number start
      centralHeader.writeUInt16LE(0, pos); pos += 2            // internal file attributes
      centralHeader.writeUInt32LE(0, pos); pos += 4            // external file attributes
      centralHeader.writeUInt32LE(localOffset, pos)            // relative offset of local header
      nameBuffer.copy(centralHeader, pos)

      centralHeaders.push(centralHeader)
      localOffset += localHeader.length + compressed.length
    }

    // End of Central Directory Record
    const centralOffset = localOffset
    const centralSize = Buffer.concat(centralHeaders).length
    const eocd = Buffer.alloc(22)
    let pos = 0
    eocd.writeUInt32LE(0x06054b50, pos); pos += 4  // signature
    eocd.writeUInt16LE(0, pos); pos += 2            // disk number
    eocd.writeUInt16LE(0, pos); pos += 2            // disk with central directory
    eocd.writeUInt16LE(this.entries.length, pos); pos += 2  // entries on disk
    eocd.writeUInt16LE(this.entries.length, pos); pos += 2  // total entries
    eocd.writeUInt32LE(centralSize, pos); pos += 4  // central directory size
    eocd.writeUInt32LE(centralOffset, pos); pos += 4  // central directory offset
    eocd.writeUInt16LE(0, pos)                      // comment length

    // 写入文件
    const dir = path.dirname(outputPath)
    await fsPromises.mkdir(dir, { recursive: true })
    const parts = [...localHeaders, ...centralHeaders, eocd]
    const totalBuffer = Buffer.concat(parts)
    await fsPromises.writeFile(outputPath, totalBuffer)
  }
}

interface ZipEntry {
  name: string
  content: Buffer
}

/** CRC-32 校验码（多项式 0xEDB88320） */
function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320
      } else {
        crc = crc >>> 1
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// ===== 辅助函数 =====

interface ChapterExportMeta {
  chapterNumber: number
  title: string
  content: string
}

async function getFinalizedChapters(chapterNumbers?: number[]): Promise<ChapterExportMeta[]> {
  const db = getProjectDb()
  if (!db) throw new Error(t('error.projectDbNotOpen'))

  const chapters: ChapterExportMeta[] = []

  if (chapterNumbers && chapterNumbers.length > 0) {
    for (const cn of chapterNumbers) {
      const finalized = db.prepare(`
        SELECT d.chapter_number, d.id, c.body
        FROM drafts d JOIN contents c ON d.content_id = c.id
        WHERE d.chapter_number = ? AND d.status = 'finalized'
        ORDER BY d.version DESC LIMIT 1
      `).get(cn) as { chapter_number: number; id: number; body: string } | undefined

      if (finalized) {
        const bp = db.prepare('SELECT title FROM blueprints WHERE chapter_number = ?').get(cn) as { title: string } | undefined
        chapters.push({
          chapterNumber: finalized.chapter_number,
          title: bp?.title || `第${finalized.chapter_number}章`,
          content: finalized.body,
        })
      }
    }
  } else {
    // 导出全部定稿章节
    const rows = db.prepare(`
      SELECT DISTINCT d.chapter_number
      FROM drafts d
      WHERE d.status = 'finalized'
      ORDER BY d.chapter_number
    `).all() as Array<{ chapter_number: number }>

    for (const row of rows) {
      const finalized = db.prepare(`
        SELECT d.chapter_number, d.id, c.body
        FROM drafts d JOIN contents c ON d.content_id = c.id
        WHERE d.chapter_number = ? AND d.status = 'finalized'
        ORDER BY d.version DESC LIMIT 1
      `).get(row.chapter_number) as { chapter_number: number; id: number; body: string } | undefined

      if (finalized) {
        const bp = db.prepare('SELECT title FROM blueprints WHERE chapter_number = ?').get(row.chapter_number) as { title: string } | undefined
        chapters.push({
          chapterNumber: finalized.chapter_number,
          title: bp?.title || `第${finalized.chapter_number}章`,
          content: finalized.body,
        })
      }
    }
  }

  return chapters
}

/** 清理文件名中的非法字符 */
function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'untitled'
}

/** 生成章节文件名 */
function chapterFileName(ch: ChapterExportMeta, ext = '.md'): string {
  const num = String(ch.chapterNumber).padStart(4, '0')
  const title = sanitizeFileName(ch.title)
  return `第${num}章 ${title}${ext}`
}

// ===== IPC 注册 =====

export function registerExportController(): void {
  ipcMain.handle('export:export-chapters', async (_event, params: {
    chapterNumbers?: number[]
    format: 'zip' | 'folder'
    fileFormat: 'md' | 'txt'
    outputPath: string
    projectName: string
  }) => {
    try {
      const { chapterNumbers, format, fileFormat, outputPath, projectName } = params

      const chapters = await getFinalizedChapters(chapterNumbers)
      if (chapters.length === 0) {
        return { success: false, error: t('error.noExportableChapters') }
      }

      const safeProjectName = sanitizeFileName(projectName)
      const ext = fileFormat === 'md' ? '.md' : '.txt'

      /** 获取单章文本内容（.md 保留格式，.txt 去除 Markdown） */
      const getChapterText = (ch: ChapterExportMeta): string => {
        if (fileFormat === 'md') {
          return `# 第${ch.chapterNumber}章 ${ch.title}\n\n${ch.content}`
        }
        // TXT：去除 Markdown 格式标记
        const plain = ch.content
          .replace(/^#{1,6}\s+/gm, '')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(/`(.+?)`/g, '$1')
          .replace(/~~(.+?)~~/g, '$1')
          .replace(/---+/g, '')
          .replace(/\[(.+?)\]\(.+?\)/g, '$1')
          .replace(/!\[.*?\]\(.+?\)/g, '')
          .replace(/>\s+/gm, '')
          .replace(/^\s*[-*+]\s+/gm, '')
          .replace(/^\s*\d+\.\s+/gm, '')
          .trim()
        return `第${ch.chapterNumber}章 ${ch.title}\n\n${plain}`
      }

      if (format === 'folder') {
        // 文件夹格式 — 逐文件写入
        const folderPath = path.join(outputPath, safeProjectName)
        await fsPromises.mkdir(folderPath, { recursive: true })

        for (const ch of chapters) {
          const fileName = chapterFileName(ch, ext)
          await fsPromises.writeFile(path.join(folderPath, fileName), getChapterText(ch), 'utf-8')
        }

        logger.info('Export', t('log.export.folderDone')
          .replace('{path}', folderPath)
          .replace('{count}', String(chapters.length))
          .replace('{format}', fileFormat))
        return { success: true, path: folderPath, chapterCount: chapters.length }
      } else {
        // ZIP 格式
        const zipPath = path.join(outputPath, `${safeProjectName}.zip`)
        const zip = new ZipWriter()

        for (const ch of chapters) {
          const fileName = chapterFileName(ch, ext)
          zip.addFile(`${safeProjectName}/${fileName}`, getChapterText(ch))
        }

        await zip.writeToFile(zipPath)
        logger.info('Export', t('log.export.zipDone')
          .replace('{path}', zipPath)
          .replace('{count}', String(chapters.length))
          .replace('{format}', fileFormat))
        return { success: true, path: zipPath, chapterCount: chapters.length }
      }
    } catch (error) {
      logger.error('Export', t('log.export.failed').replace('{err}', String(error)))
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  /** 打开原生保存/目录选择对话框 */
  ipcMain.handle('export:select-output-dir', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null

      const result = await dialog.showOpenDialog(win, {
        title: t('dialog.selectExportDir'),
        properties: ['openDirectory', 'createDirectory'],
      })

      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    } catch {
      return null
    }
  })

  logger.info('IPC', t('log.ipc.exportRegistered'))
}
