/**
 * NovelForge 内置 Prompt 模板库
 *
 * 包含全流程创作所需的全部提示词模板
 * 支持三级覆盖：内置 → 全局自定义 → 项目级覆盖
 *
 * 架构生成 Prompt 来源于 AI_NovelGenerator 项目（经专业优化）
 */
import type { TextKey } from '../shared/locale'

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

// ===== 模板显示文本 i18n 映射 =====
// 模板的 name/description/variables 是数据（模块级常量，保存/加载用中文原文），
// 显示时通过映射取 t()，保证语言切换即时生效。

/** 模板 key → 显示名称 i18n key */
export const PROMPT_NAME_KEYS: Record<string, TextKey> = {
  premise: 'arch.storyPremise',
  character_dynamics: 'arch.characterMap',
  world_building: 'arch.worldBuilding',
  synopsis: 'arch.plotOutline',
  chapter_blueprint: 'prompt.name.blueprintAll',
  chapter_blueprint_chunk: 'prompt.name.blueprintChunk',
  infer_single_chapter_blueprint: 'prompt.name.blueprintSingle',
  consistency_check: 'prompt.name.consistency',
  analyze_writing_style: 'prompt.name.styleAnalysis',
  generate_chapter_notes: 'prompt.name.chapterNotes',
  update_character_cards: 'prompt.name.updateCards',
  extract_initial_characters: 'prompt.name.extractCards',
  generate_global_config: 'prompt.name.fullConfig',
  infer_novel_config: 'prompt.name.reverseConfig',
  infer_novel_config_with_vectors: 'prompt.name.vectorConfig',
  first_chapter_draft: 'prompt.name.firstDraft',
  next_chapter_draft: 'prompt.name.nextDraft',
  refine_chapter: 'prompt.name.masterRefine',
  refine_from_review: 'prompt.name.reviewDriven',
}

/** 模板 key → 用途说明 i18n key */
export const PROMPT_DESC_KEYS: Record<string, TextKey> = {
  premise: 'prompt.desc.premise',
  character_dynamics: 'prompt.desc.character_dynamics',
  world_building: 'prompt.desc.world_building',
  synopsis: 'prompt.desc.synopsis',
  chapter_blueprint: 'prompt.desc.chapter_blueprint',
  chapter_blueprint_chunk: 'prompt.desc.chapter_blueprint_chunk',
  infer_single_chapter_blueprint: 'prompt.desc.infer_single_chapter_blueprint',
  consistency_check: 'prompt.desc.consistency_check',
  analyze_writing_style: 'prompt.desc.analyze_writing_style',
  generate_chapter_notes: 'prompt.desc.generate_chapter_notes',
  update_character_cards: 'prompt.desc.update_character_cards',
  extract_initial_characters: 'prompt.desc.extract_initial_characters',
  generate_global_config: 'prompt.desc.generate_global_config',
  infer_novel_config: 'prompt.desc.infer_novel_config',
  infer_novel_config_with_vectors: 'prompt.desc.infer_novel_config_with_vectors',
  first_chapter_draft: 'prompt.desc.first_chapter_draft',
  next_chapter_draft: 'prompt.desc.next_chapter_draft',
  refine_chapter: 'prompt.desc.refine_chapter',
  refine_from_review: 'prompt.desc.refine_from_review',
}

/** 变量说明（中文原文）→ i18n key（语言切换时显示层 t() 翻译） */
export const PROMPT_VAR_KEYS: Record<string, TextKey> = {
  '全局写作要求': 'prompt.var.global_guidance',
  '小说类型': 'prompt.var.genre',
  '总章数': 'prompt.var.total_chapters',
  '作者对本步骤的补充指导（可选）': 'prompt.var.step_guidance',
  '主角人设': 'prompt.var.protagonist',
  '故事前提': 'prompt.var.premise',
  '目标字数': 'prompt.var.target_words',
  '文风描述（可选）': 'prompt.var.style_desc',
  '每章字数': 'prompt.var.words_per_chapter',
  '参考作品（可选）': 'prompt.var.reference_works',
  '金手指体系': 'prompt.var.golden_finger',
  '世界观设定': 'prompt.var.world_setting',
  '完整故事架构（故事前提+角色图谱+世界观+情节大纲）': 'prompt.var.full_arch',
  '节奏/风格指导（可选）': 'prompt.var.pacing_guidance',
  '角色状态': 'prompt.var.char_states',
  '章节正文内容': 'prompt.var.chapter_content',
  '章节编号': 'prompt.var.chapter_number',
  '后续章节蓝图（防止剧情提前）': 'prompt.var.future_blueprints',
  '作者本章微操指导（可选）': 'prompt.var.user_guidance',
  '细分类型': 'prompt.var.sub_genre',
  '核心主题/故事简介': 'prompt.var.topic',
  '目标受众': 'prompt.var.target_audience',
  '世界观基盘设定': 'prompt.var.core_setting',
  '核心金手指/卖点': 'prompt.var.golden_finger_selling',
  '世界观基盘': 'prompt.var.world_foundation',
  '角色图谱': 'prompt.var.char_map',
  '世界观': 'prompt.var.world',
  '故事结构详细指导（由系统根据用户选择的结构模式动态注入）': 'prompt.var.structure_guide',
  '叙事视角描述': 'prompt.var.pov',
  '已生成的章节列表（最近100章）': 'prompt.var.chapter_list',
  '起始章节号': 'prompt.var.start_chapter',
  '结束章节号': 'prompt.var.end_chapter',
  '本章正文全文': 'prompt.var.chapter_full',
  '本章序号': 'prompt.var.chapter_seq',
  '本章标题（来自拆章）': 'prompt.var.chapter_title_split',
  '全局配置脱水版': 'prompt.var.config_summary',
  '章节内容': 'prompt.var.chapter_body',
  '上下文检索结果': 'prompt.var.rag_context',
  '审稿维度侧重点（可选）': 'prompt.var.review_focus',
  '正文采样文本（3-5章拼接）': 'prompt.var.sample_text',
  '章节标题': 'prompt.var.chapter_name',
  '现有角色卡 JSON 数组（包含 name/role 等基础信息）': 'prompt.var.cards_json',
  '角色图谱纯文本': 'prompt.var.char_map_text',
  '用户输入的灵感/想法': 'prompt.var.idea',
  '计划总章数': 'prompt.var.planned_chapters',
  '每章计划字数': 'prompt.var.planned_words',
  '知识库代表性采样内容（开头+中段+结尾）': 'prompt.var.kb_sample',
  '向量检索：世界观与力量体系相关片段': 'prompt.var.vec_world',
  '向量检索：主角设定与金手指相关片段': 'prompt.var.vec_protagonist',
  '向量检索：核心矛盾与敌对势力相关片段': 'prompt.var.vec_conflict',
  '向量检索：写作风格与叙事视角相关片段': 'prompt.var.vec_style',
  '第一章正文（开局风格参考）': 'prompt.var.first_chapter',
  '最新一章正文（当前进度参考）': 'prompt.var.latest_chapter',
  '已有总章数': 'prompt.var.existing_chapters',
  '故事架构（故事前提+角色图谱+世界观+情节大纲）': 'prompt.var.arch_summary',
  '本章信息（JSON）': 'prompt.var.chapter_info',
  '章节要点时间线（从蓝图按序拼装）': 'prompt.var.notes_timeline',
  '近期三章简要': 'prompt.var.recent_chapters',
  '上章结尾800字': 'prompt.var.prev_chapter_end',
  '本章蓝图信息（JSON）': 'prompt.var.blueprint_json',
  '知识库检索结果': 'prompt.var.kb_results',
  '章节草稿内容': 'prompt.var.draft_content',
  '章节信息': 'prompt.var.chapter_meta',
  '写作要求': 'prompt.var.writing_req',
  '近章要点（蓝图摘要）': 'prompt.var.recent_notes',
  '近章摘要': 'prompt.var.recent_summary',
  '用户自定义修稿指导（可选）': 'prompt.var.user_refine',
  '审稿报告内容': 'prompt.var.review_report',
  '待修稿内容': 'prompt.var.to_refine',
  '用户额外修稿指导（可选）': 'prompt.var.extra_refine',
}


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
