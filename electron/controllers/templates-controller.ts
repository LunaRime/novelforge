/**
 * TemplatesController — 角色卡模板管理（保存/列表/获取/删除）
 *
 * 模板存储于 ~/.novelforge/templates/*.json（与技能库同目录模式）：
 * 格式 { "schema": "character", "name": "模板名", "description": "...", "data": { 角色卡字段 } }
 * 文件名校验走 validateCharacterTemplate + 名称清洗（防路径穿越）。
 */
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { NOVELFORGE_HOME } from '../utils/config-utils'
import { validateCharacterTemplate } from '../../src/services/template-validator'
import { guardedHandle } from '../security/ipc-guard'

const TEMPLATES_DIR = path.join(NOVELFORGE_HOME, 'templates')

/** 模板元信息（列表返回，不含 data） */
export interface TemplateInfo {
  file: string
  name: string
  description: string
}

function isTemplateFile(file: string): boolean {
  return typeof file === 'string' && file.endsWith('.json') && !/[\\/:]/.test(file) && !file.includes('\0')
}

/** 清洗模板文件名：仅保留安全字符，防止路径穿越 */
function sanitizeTemplateName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\.\./g, '')
  return cleaned || `template-${Date.now()}`
}

export function registerTemplatesController(): void {
  // 列表：扫描模板目录（返回元信息）
  guardedHandle('templates:list', async (): Promise<TemplateInfo[]> => {
    await fs.mkdir(TEMPLATES_DIR, { recursive: true })
    const files = await fs.readdir(TEMPLATES_DIR)
    const result: TemplateInfo[] = []
    for (const file of files.filter(isTemplateFile)) {
      try {
        const content = await fs.readFile(path.join(TEMPLATES_DIR, file), 'utf-8')
        const v = validateCharacterTemplate(JSON.parse(content) as unknown)
        if (v.ok) result.push({ file, name: v.name, description: v.description })
      } catch (error) {
        if (!(error instanceof SyntaxError) && !['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  })

  // 获取完整模板（含 data——应用模板时填充角色卡）
  guardedHandle('templates:get', async (_e, file: string): Promise<Record<string, unknown> | null> => {
    if (!isTemplateFile(file)) return null
    try {
      const content = await fs.readFile(path.join(TEMPLATES_DIR, file), 'utf-8')
      const v = validateCharacterTemplate(JSON.parse(content) as unknown)
      return v.ok ? v.data : null
    } catch {
      return null
    }
  })

  // 保存模板：校验 schema → 清洗文件名 → 原子写
  guardedHandle('templates:save', async (_e, input: { name: string; description?: string; data: Record<string, unknown> }): Promise<{ success: boolean; error?: string }> => {
    let tempFile: string | undefined
    try {
      const v = validateCharacterTemplate({ schema: 'character', name: input.name, description: input.description ?? '', data: input.data })
      if (!v.ok) return { success: false, error: v.error }
      await fs.mkdir(TEMPLATES_DIR, { recursive: true })
      const file = path.join(TEMPLATES_DIR, `${sanitizeTemplateName(v.name)}.json`)
      tempFile = `${file}.${randomUUID()}.tmp`
      await fs.writeFile(tempFile, JSON.stringify({ schema: 'character', name: v.name, description: v.description, data: v.data }, null, 2), { encoding: 'utf-8', flag: 'wx' })
      await fs.rename(tempFile, file)
      return { success: true }
    } catch (error) {
      if (tempFile) await fs.rm(tempFile, { force: true }).catch(() => {})
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 删除模板
  guardedHandle('templates:delete', async (_e, name: string): Promise<{ success: boolean }> => {
    try {
      await fs.unlink(path.join(TEMPLATES_DIR, `${sanitizeTemplateName(name)}.json`))
      return { success: true }
    } catch {
      return { success: false }
    }
  })
}
