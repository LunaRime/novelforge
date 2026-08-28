/**
 * 模板文件校验 — 纯函数，可单测
 *
 * 模板存储于 ~/.novelforge/templates/*.json，格式：
 * { "schema": "character", "name": "模板名", "description": "...", "data": { ... } }
 * schema 决定 data 结构：character = 角色卡字段（CharacterData 子集）。
 */

export type TemplateSchema = 'character'

export interface CharacterTemplateFile {
  schema: TemplateSchema
  name: string
  description: string
  data: Record<string, unknown>
}

export type ValidateResult =
  | { ok: true; name: string; description: string; data: Record<string, unknown> }
  | { ok: false; error: string }

/** 校验 character 模板：schema/name 必需，data 必须是对象（角色卡字段） */
export function validateCharacterTemplate(parsed: unknown): ValidateResult {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'template is not an object' }
  }
  const tpl = parsed as Record<string, unknown>
  if (tpl.schema !== 'character') {
    return { ok: false, error: `unsupported schema: ${String(tpl.schema)}` }
  }
  const name = typeof tpl.name === 'string' ? tpl.name.trim() : ''
  if (!name) {
    return { ok: false, error: 'template name is required' }
  }
  if (!tpl.data || typeof tpl.data !== 'object' || Array.isArray(tpl.data)) {
    return { ok: false, error: 'template data must be an object' }
  }
  return {
    ok: true,
    name,
    description: typeof tpl.description === 'string' ? tpl.description : '',
    data: tpl.data as Record<string, unknown>,
  }
}
