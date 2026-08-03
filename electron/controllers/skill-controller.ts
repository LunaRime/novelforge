/**
 * SkillController — 技能文件管理（导入/列表/删除）
 *
 * 技能文件存储于 ~/.vela/skills/*.md（与 Claude Code skills 目录同模式）：
 * - 导入：写入 .md 文件（名称清洗防路径穿越）
 * - 列表：扫描目录，解析 frontmatter description 作为描述
 * - 删除：移除文件
 */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { VELA_HOME } from '../utils/config-utils'

const SKILLS_DIR = path.join(VELA_HOME, 'skills')

/** 技能文件信息 */
export interface SkillInfo {
  name: string
  description: string
}

/** 确保技能目录存在 */
async function ensureSkillsDir(): Promise<void> {
  await fs.mkdir(SKILLS_DIR, { recursive: true })
}

/** 解析 .md 技能的 frontmatter description（格式：---\ndescription: xxx\n---） */
function parseDescription(content: string): string {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (m) {
    const desc = m[1].match(/^description:\s*(.+)$/m)
    if (desc) return desc[1].trim()
  }
  // fallback：首行非空文本
  const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'))
  return (firstLine ?? '').trim().slice(0, 80)
}

/** 清洗技能名称：仅保留安全字符，防止路径穿越 */
function sanitizeSkillName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\.\./g, '')
  return cleaned || `skill-${Date.now()}`
}

export function registerSkillController(): void {
  // 列表：扫描技能目录
  ipcMain.handle('skill:list', async (): Promise<SkillInfo[]> => {
    try {
      await ensureSkillsDir()
      const files = await fs.readdir(SKILLS_DIR)
      const skills: SkillInfo[] = []
      for (const file of files.filter(f => f.endsWith('.md'))) {
        try {
          const content = await fs.readFile(path.join(SKILLS_DIR, file), 'utf-8')
          skills.push({
            name: file.replace(/\.md$/, ''),
            description: parseDescription(content),
          })
        } catch { /* 单个文件读取失败跳过 */ }
      }
      return skills.sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  })

  // 导入：写入技能文件
  ipcMain.handle('skill:import', async (_event, payload: { name: string; content: string }) => {
    try {
      const name = sanitizeSkillName(payload?.name ?? '')
      const content = String(payload?.content ?? '')
      if (!content.trim()) return { success: false, error: '技能内容为空' }
      await ensureSkillsDir()
      await fs.writeFile(path.join(SKILLS_DIR, `${name}.md`), content, 'utf-8')
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // 删除技能文件
  ipcMain.handle('skill:delete', async (_event, name: string) => {
    try {
      const safe = sanitizeSkillName(name)
      await fs.unlink(path.join(SKILLS_DIR, `${safe}.md`))
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // 选择技能文件（.md 过滤器）
  ipcMain.handle('dialog:select-skill-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择技能文件',
      filters: [{ name: 'Skill 文件', extensions: ['md'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return { name: path.basename(filePath, '.md'), content }
    } catch {
      return null
    }
  })
}
