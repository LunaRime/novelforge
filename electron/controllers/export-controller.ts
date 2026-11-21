/**
 * 导出控制器 — 章节导出为文件夹或 ZIP 压缩包
 *
 * 支持：
 * - 单章导出 / 批量导出
 * - 文件夹格式 / ZIP 压缩格式
 * - 跨平台（Windows/macOS/Linux）
 */
import { dialog, BrowserWindow } from 'electron'
import { t } from '../../src/shared/locale'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { getProjectDb } from '../database'
import { grantDirectory, assertPathAllowedForIpc } from './fs-controller'
import { logger } from '../utils/logger'
import { safeErrorMessage } from '../utils/error-utils'
import { guardedHandle } from '../security/ipc-guard'

import { ZipWriter } from '../utils/zip-writer'
import { stripMarkdownUnderline } from '../../src/shared/markdown-underline'

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
  guardedHandle('export:export-chapters', async (_event, params: {
    chapterNumbers?: number[]
    format: 'zip' | 'folder'
    fileFormat: 'md' | 'txt'
    outputPath: string
    projectName: string
  }) => {
    try {
      const { chapterNumbers, format, fileFormat, outputPath, projectName } = params

      // ⚠️ L4 S8 安全修复（评审 blocker B2）：outputPath 来自渲染层，下面直接 mkdir + writeFile
      //   （改造前全程没有任何沙箱校验，可往任意路径写文件）。
      //   目标目录应由 `export:select-output-dir` 的对话框签发授权。
      assertPathAllowedForIpc(outputPath, 'write')

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
        const plain = stripMarkdownUnderline(ch.content)
          .replace(/^#{1,6}\s+/gm, '')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(/`(.+?)`/g, '$1')
          .replace(/~~(.+?)~~/g, '$1')
          .replace(/---+/g, '')
          .replace(/\[(.+?)\]\(.+?\)/g, '$1')
          .replace(/!\[.*?\]\(.+?\)/g, '')
          .replace(/^[\t ]*>[\t ]?/gm, '')
          .replace(/^\s*[-*+]\s+/gm, '')
          .replace(/^\s*\d+\.\s+/gm, '')
          .trim()
        return `第${ch.chapterNumber}章 ${ch.title}\n\n${plain}`
      }

      if (format === 'folder') {
        // 文件夹格式 — 逐文件写入
        const folderPath = path.join(outputPath, safeProjectName)
        assertPathAllowedForIpc(folderPath, 'write')
        await fsPromises.mkdir(folderPath, { recursive: true })

        for (const ch of chapters) {
          const fileName = chapterFileName(ch, ext)
          const target = assertPathAllowedForIpc(path.join(folderPath, fileName), 'write')
          await fsPromises.writeFile(target, getChapterText(ch), 'utf-8')
        }

        logger.info('Export', t('log.export.folderDone')
          .replace('{path}', folderPath)
          .replace('{count}', String(chapters.length))
          .replace('{format}', fileFormat))
        return { success: true, path: folderPath, chapterCount: chapters.length }
      } else {
        // ZIP 格式
        const zipPath = assertPathAllowedForIpc(path.join(outputPath, `${safeProjectName}.zip`), 'write')
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
  guardedHandle('export:select-output-dir', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null

      const result = await dialog.showOpenDialog(win, {
        title: t('dialog.selectExportDir'),
        properties: ['openDirectory', 'createDirectory'],
      })

      if (result.canceled || result.filePaths.length === 0) return null
      // 登记授权目录：导出写入该目录不被沙箱拦截
      grantDirectory(result.filePaths[0])
      return result.filePaths[0]
    } catch {
      return null
    }
  })

  logger.info('IPC', t('log.ipc.exportRegistered'))
}
