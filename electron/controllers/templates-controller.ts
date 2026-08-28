/**
 * TemplatesController — 角色卡模板管理（保存/列表/获取/删除）
 *
 * 模板存储于 ~/.novelforge/templates/*.json（与技能库同目录模式）：
 * 格式 { "schema": "character", "name": "模板名", "description": "...", "data": { 角色卡字段 } }
 * 文件名校验走 validateCharacterTemplate + 名称清洗（防路径穿越）。
 */
import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { VELA_HOME } from '../utils/config-utils'
import { validateCharacterTemplate } from '../../src/services/template-validator'

const TEMPLATES_DIR = path.join(VELA_HOME, 'templates')

/** 模板元信息（列表返回，不含 data） */
export interface TemplateInfo {
  name: string
  description: string
}

/** 清洗模板文件名：仅保留安全字符，防止路径穿越 */
function sanitizeTemplateName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\.\./g, '')
  return cleaned || `template-${Date.now()}`
}

export function registerTemplatesController(): void {
  // 列表：扫描模板目录（返回元信息）
  ipcMain.handle('templates:list', async (): Promise<TemplateInfo[]> => {
    try {
      await fs.mkdir(TEMPLATES_DIR, { recursive: true })
      const files = await fs.readdir(TEMPLATES_DIR)
      const result: TemplateInfo[] = []
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(TEMPLATES_DIR, file), 'utf-8')
          const parsed = JSON.parse(content) as unknown
          const v = validateCharacterTemplate(parsed)
          if (v.ok) result.push({ name: v.name, description: v.description })
        } catch { /* 单文件解析失败跳过（损坏模板不阻断列表） */ }
      }
      return result.sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  })

  // 获取完整模板（含 data——应用模板时填充角色卡）
  ipcMain.handle('templates:get', async (_e, name: string): Promise<Record<string, unknown> | null> => {
    try {
      const file = path.join(TEMPLATES_DIR, `${sanitizeTemplateName(name)}.json`)
      const content = await fs.readFile(file, 'utf-8')
      const v = validateCharacterTemplate(JSON.parse(content) as unknown)
      return v.ok ? v.data : null
    } catch {
      return null
    }
  })

  // 保存模板：校验 schema → 清洗文件名 → 原子写
  ipcMain.handle('templates:save', async (_e, input: { name: string; description?: string; data: Record<string, unknown> }): Promise<{ success: boolean; error?: string }> => {
    try {
      const v = validateCharacterTemplate({ schema: 'character', name: input.name, description: input.description ?? '', data: input.data })
      if (!v.ok) return { success: false, error: v.error }
      await fs.mkdir(TEMPLATES_DIR, { recursive: true })
      const file = path.join(TEMPLATES_DIR, `${sanitizeTemplateName(v.name)}.json`)
      const tempFile = `${file}.${Date.now()}.tmp`
      await fs.writeFile(tempFile, JSON.stringify({ schema: 'character', name: v.name, description: v.description, data: v.data }, null, 2), 'utf-8')
      await fs.rename(tempFile, file)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 删除模板
  ipcMain.handle('templates:delete', async (_e, name: string): Promise<{ success: boolean }> => {
    try {
      await fs.unlink(path.join(TEMPLATES_DIR, `${sanitizeTemplateName(name)}.json`))
      return { success: true }
    } catch {
      return { success: false }
    }
  })
}
