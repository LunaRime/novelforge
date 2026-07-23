/**
 * NovelForge 内置 Prompt 模板库
 *
 * 包含全流程创作所需的全部提示词模板
 * 支持三级覆盖：内置 → 全局自定义 → 项目级覆盖
 *
 * 架构生成 Prompt 来源于 AI_NovelGenerator 项目（经专业优化）
 */

export interface PromptTemplate {
  /** 模板唯一标识 */
  key: string
  /** 显示名称 */
  name: string
  /** 用途说明 */
  description: string
  /** 模板内容（支持 {{变量}} 插值） */
  content: string
  /** 不可编辑的系统约束（输出格式、JSON schema 等），渲染时自动追加到 content 末尾 */
  systemSuffix?: string
  /** LLM system message 角色定位（由模板统一定义，command 不再硬编码） */
  systemRole?: string
  /** 可用变量列表 */
  variables: Record<string, string>
}

/** 允许用户自定义编辑的模板 Key 列表（其余为系统模板，不可编辑） */
export const EDITABLE_PROMPT_KEYS: string[] = [
  'generate_global_config',
  'premise',
  'character_dynamics',
  'world_building',
  'synopsis',
  'first_chapter_draft',
  'next_chapter_draft',
  'refine_chapter',
  'consistency_check',
  'analyze_writing_style',
  'refine_from_review',
]

/** 全部内置 Prompt 模板（从分类文件导入） */
import { configPrompts } from './prompts/config'
import { architecturePrompts } from './prompts/architecture'
import { draftingPrompts } from './prompts/drafting'
import { editingPrompts } from './prompts/editing'
import { analysisPrompts } from './prompts/analysis'
import { charactersPrompts } from './prompts/characters'

export const BUILTIN_PROMPTS: PromptTemplate[] = [
  ...configPrompts,
  ...architecturePrompts,
  ...draftingPrompts,
  ...editingPrompts,
  ...analysisPrompts,
  ...charactersPrompts,
]


/** 全局自定义覆盖 Prompt 缓存（~/.vela/prompts/） */
const customPrompts: Map<string, PromptTemplate> = new Map()
let customPromptsLoaded = false

/** 项目级自定义覆盖 Prompt 缓存（{project}/.vela/prompts/） */
const projectCustomPrompts: Map<string, PromptTemplate> = new Map()

/** 加载全局自定义 Prompt 覆盖（从 ~/.vela/prompts/ 目录） */
export async function loadCustomPrompts(): Promise<void> {
  try {
    const { ipc } = await import('./ipc-client')
    if (!ipc.isElectron) return

    const velaHome = await ipc.invoke('config:get-vela-home')
    const promptsDir = `${velaHome}/prompts`

    await _loadPromptsFromDir(promptsDir, customPrompts)
    customPromptsLoaded = true
    console.log(`[NovelForge Prompts] 已加载 ${customPrompts.size} 个全局自定义覆盖`)
  } catch {
    // prompts 目录可能不存在，忽略
    customPromptsLoaded = true
  }
}

/** 加载项目级自定义 Prompt 覆盖（从 {projectPath}/.vela/prompts/ 目录） */
export async function loadProjectCustomPrompts(projectPath: string): Promise<void> {
  try {
    projectCustomPrompts.clear()
    const promptsDir = `${projectPath}/.vela/prompts`

    await _loadPromptsFromDir(promptsDir, projectCustomPrompts)
    console.log(`[NovelForge Prompts] 已加载 ${projectCustomPrompts.size} 个项目级自定义覆盖`)
  } catch {
    // 目录不存在时忽略
  }
}

/** 内部工具：从目录加载 JSON 覆盖到指定 Map */
async function _loadPromptsFromDir(dirPath: string, target: Map<string, PromptTemplate>): Promise<void> {
  const { ipc } = await import('./ipc-client')
  const exists = await ipc.invoke('fs:check-exists', dirPath)
  if (!exists) return

  const files = await ipc.invoke('fs:list-dir', dirPath)
  const jsonFiles = files.filter((f) => !f.isDir && f.name.endsWith('.json'))

  for (const file of jsonFiles) {
    const result = await ipc.invoke('fs:read-file', file.path)
    if (result.success && result.content.trim()) {
      try {
        const custom = JSON.parse(result.content) as PromptTemplate
        if (custom.key) {
          target.set(custom.key, custom)
        }
      } catch { /* 忽略无效 JSON */ }
    }
  }
}

/** 根据 key 获取 Prompt 模板（三级优先级：项目级 > 全局级 > 内置） */
export function getPromptTemplate(key: string): PromptTemplate | undefined {
  // 优先级 1：项目级自定义覆盖
  const projectCustom = projectCustomPrompts.get(key)
  if (projectCustom) return projectCustom

  // 优先级 2：全局自定义覆盖
  if (customPromptsLoaded) {
    const globalCustom = customPrompts.get(key)
    if (globalCustom) return globalCustom
  }

  // 优先级 3：内置默认
  return BUILTIN_PROMPTS.find((p) => p.key === key)
}

/** 获取指定模板当前生效的来源 */
export function getPromptSource(key: string): 'builtin' | 'global' | 'project' {
  if (projectCustomPrompts.has(key)) return 'project'
  if (customPromptsLoaded && customPrompts.has(key)) return 'global'
  return 'builtin'
}

/** 获取所有模板（合并自定义，保留三级覆盖优先级） */
export function getAllPromptTemplates(): PromptTemplate[] {
  const all = [...BUILTIN_PROMPTS]
  // 用全局自定义覆盖同名内置模板
  for (const [key, custom] of customPrompts) {
    const idx = all.findIndex((p) => p.key === key)
    if (idx >= 0) {
      all[idx] = custom
    } else {
      all.push(custom)
    }
  }
  // 用项目级自定义覆盖
  for (const [key, custom] of projectCustomPrompts) {
    const idx = all.findIndex((p) => p.key === key)
    if (idx >= 0) {
      all[idx] = custom
    } else {
      all.push(custom)
    }
  }
  return all
}

/** 保存全局自定义 Prompt 到 ~/.vela/prompts/ */
export async function saveCustomPrompt(template: PromptTemplate): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const velaHome = await ipc.invoke('config:get-vela-home')
    const dirPath = `${velaHome}/prompts`
    // 确保目录存在
    const exists = await ipc.invoke('fs:check-exists', dirPath)
    if (!exists) await ipc.invoke('fs:mkdir', dirPath)
    const filePath = `${dirPath}/${template.key}.json`

    await ipc.invoke('fs:write-file', filePath, JSON.stringify(template, null, 2))
    customPrompts.set(template.key, template)
    return true
  } catch {
    return false
  }
}

/** 保存项目级自定义 Prompt 到 {projectPath}/.vela/prompts/ */
export async function saveProjectCustomPrompt(projectPath: string, template: PromptTemplate): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const dirPath = `${projectPath}/.vela/prompts`
    // 确保目录存在
    const exists = await ipc.invoke('fs:check-exists', dirPath)
    if (!exists) {
      await ipc.invoke('fs:mkdir', `${projectPath}/.vela`)
      await ipc.invoke('fs:mkdir', dirPath)
    }
    const filePath = `${dirPath}/${template.key}.json`

    await ipc.invoke('fs:write-file', filePath, JSON.stringify(template, null, 2))
    projectCustomPrompts.set(template.key, template)
    return true
  } catch {
    return false
  }
}

/** 删除全局自定义 Prompt（恢复为内置版本） */
export async function deleteCustomPrompt(key: string): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const velaHome = await ipc.invoke('config:get-vela-home')
    const filePath = `${velaHome}/prompts/${key}.json`
    const exists = await ipc.invoke('fs:check-exists', filePath)
    if (exists) await ipc.invoke('fs:write-file', filePath, '')
    customPrompts.delete(key)
    return true
  } catch {
    return false
  }
}

/** 删除项目级自定义 Prompt（恢复为全局/内置版本） */
export async function deleteProjectCustomPrompt(projectPath: string, key: string): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const filePath = `${projectPath}/.vela/prompts/${key}.json`
    const exists = await ipc.invoke('fs:check-exists', filePath)
    if (exists) await ipc.invoke('fs:write-file', filePath, '')
    projectCustomPrompts.delete(key)
    return true
  } catch {
    return false
  }
}

/** 渲染 Prompt 模板（填充变量 + 自动追加内置 systemSuffix + 空段落裁剪） */
export function renderPrompt(template: PromptTemplate, variables: Record<string, string>): string {
  let content = template.content
  for (const [key, value] of Object.entries(variables)) {
    content = content.replaceAll(`{{${key}}}`, value)
  }

  // 自动追加系统约束（始终从内置模板获取，不受用户自定义影响）
  const builtinTemplate = BUILTIN_PROMPTS.find(p => p.key === template.key)
  const suffix = builtinTemplate?.systemSuffix
  if (suffix) {
    let renderedSuffix = suffix
    for (const [key, value] of Object.entries(variables)) {
      renderedSuffix = renderedSuffix.replaceAll(`{{${key}}}`, value)
    }
    content = content + '\n\n' + renderedSuffix
  }

  // 空变量段落裁剪：当可选变量为空时，清除残留的空标签段落，避免分散 LLM 注意力
  content = content
    .replace(/\n★【[^】]*】★[：:]\s*\n?\s*$/gm, '')   // 清除空的 ★【...】★ 标签行
    .replace(/\n【[^】]*（如有[^）]*）[^】]*】\s*\n?\s*$/gm, '') // 清除空的 【...如有...】 标签行
    .replace(/\n{3,}/g, '\n\n') // 合并多余空行

  return content
}
