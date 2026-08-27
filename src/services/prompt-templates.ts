/**
 * NovelForge 内置 Prompt 模板库
 *
 * 包含全流程创作所需的全部提示词模板
 * 支持三级覆盖：内置 → 全局自定义 → 项目级覆盖
 *
 * 架构生成 Prompt 来源于 AI_NovelGenerator 项目（经专业优化）
 */
import type { TextKey } from '../shared/locale'
import { getCurrentLocale, type SupportedLocale } from '../shared/locale'
import { DIR_VELA_INTERNAL, DIR_PROMPTS } from '../shared/project-paths'

export interface PromptTemplate {
  /** 模板唯一标识 */
  key: string
  /** 显示名称 */
  name: string
  /** 用途说明 */
  description: string
  /** 模板内容（支持 {{变量}} 插值）— 中文原文（默认语言） */
  content: string
  /** 语言变体内容（占位符与 content 一致，仅指令文本翻译）；回退链：当前语言 → en-US → content（中文） */
  contentLocales?: Partial<Record<SupportedLocale, string>>
  /** 语言变体系统约束（回退链同上）；渲染时自动追加到 content 末尾 */
  systemSuffixLocales?: Partial<Record<SupportedLocale, string>>
  /** 语言变体角色定位（回退链同上） */
  systemRoleLocales?: Partial<Record<SupportedLocale, string>>
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
import { EN_US_CONTENT, EN_US_ROLE, EN_US_SUFFIX } from './prompts/locales/en-US'
import { RU_CONTENT, RU_ROLE } from './prompts/locales/ru-RU'

/** 合并多语言变体：集中式语言表按 key 挂载 content/systemSuffix/systemRole 变体（不侵入分类文件） */
const BASE_PROMPTS: PromptTemplate[] = [
  ...configPrompts,
  ...architecturePrompts,
  ...draftingPrompts,
  ...editingPrompts,
  ...analysisPrompts,
  ...charactersPrompts,
]

export const BUILTIN_PROMPTS: PromptTemplate[] = BASE_PROMPTS.map(p => {
  const contentLocales: Partial<Record<SupportedLocale, string>> = {}
  const systemSuffixLocales: Partial<Record<SupportedLocale, string>> = {}
  const systemRoleLocales: Partial<Record<SupportedLocale, string>> = {}
  if (EN_US_CONTENT[p.key]) contentLocales['en-US'] = EN_US_CONTENT[p.key]
  if (RU_CONTENT[p.key]) contentLocales['ru-RU'] = RU_CONTENT[p.key]
  if (EN_US_SUFFIX[p.key]) systemSuffixLocales['en-US'] = EN_US_SUFFIX[p.key]
  if (EN_US_ROLE[p.key]) systemRoleLocales['en-US'] = EN_US_ROLE[p.key]
  if (RU_ROLE[p.key]) systemRoleLocales['ru-RU'] = RU_ROLE[p.key]
  return {
    ...p,
    ...(Object.keys(contentLocales).length ? { contentLocales } : {}),
    ...(Object.keys(systemSuffixLocales).length ? { systemSuffixLocales } : {}),
    ...(Object.keys(systemRoleLocales).length ? { systemRoleLocales } : {}),
  }
})

/**
 * 按当前语言解析模板（返回副本，不污染 BUILTIN_PROMPTS 内存对象）
 * 回退链：{lang} → en-US → 中文原文（content / systemSuffix / systemRole 各自独立回退）
 *
 * ⚠️ zh-CN 特例：**跳过 en-US 回退**，直接回退中文原文——中文是模板原文语言
 * （content 恒为中文），回退到 en-US 会让中文用户看到英文模板。
 * 历史 bug：19 个模板全有 en-US 变体 → zh-CN 无变体时恒取 en-US → 设置页
 * 「提示词模板」显示混合语言（自定义过的模板中文、内置模板英文）。
 */
export function localizeTemplate(template: PromptTemplate, locale?: SupportedLocale): PromptTemplate {
  const lang = locale ?? getCurrentLocale()
  const enFallback = lang === 'zh-CN' ? undefined : template.contentLocales?.['en-US']
  const content = template.contentLocales?.[lang] ?? enFallback
  const suffix = template.systemSuffixLocales?.[lang]
    ?? (lang === 'zh-CN' ? undefined : template.systemSuffixLocales?.['en-US'])
  const role = template.systemRoleLocales?.[lang]
    ?? (lang === 'zh-CN' ? undefined : template.systemRoleLocales?.['en-US'])
  if (!content && !suffix && !role) return template
  return {
    ...template,
    ...(content ? { content } : {}),
    ...(suffix ? { systemSuffix: suffix } : {}),
    ...(role ? { systemRole: role } : {}),
  }
}

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
  extract_from_finalized: 'prompt.name.archiveFromFinalized',
  extract_from_finalized_batch: 'prompt.name.batchArchive',
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
  extract_from_finalized: 'prompt.desc.archiveFromFinalized',
  extract_from_finalized_batch: 'prompt.desc.batchArchive',
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
  '全局配置（类型/受众/叙事视角/总章数）': 'prompt.var.novel_config',
  '待回收伏笔清单': 'prompt.var.foreshadowing',
  '角色声音档案（语气/常用词/句长/语体）': 'prompt.var.voice_profile',
  '审稿维度侧重点（可选）': 'prompt.var.review_focus',
  '正文采样文本（3-5章拼接）': 'prompt.var.sample_text',
  '章节标题': 'prompt.var.chapter_name',
  '现有角色卡 JSON 数组（包含 name/role 等基础信息）': 'prompt.var.cards_json',
  '角色图谱纯文本': 'prompt.var.char_map_text',
  '角色名': 'prompt.var.character_name',
  '该角色出现的章节相关段落(带章节号)': 'prompt.var.chapters_segments',
  '多角色及其相关章节段落(带章节号)': 'prompt.var.characters_segments',
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
  // 幂等：已加载/已尝试过则跳过（App 启动 + PromptSettings 挂载双调用点防重复加载）
  if (customPromptsLoaded) return
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
    const promptsDir = `${projectPath}/${DIR_PROMPTS}`

    await _loadPromptsFromDir(promptsDir, projectCustomPrompts)
    console.log(`[NovelForge Prompts] 已加载 ${projectCustomPrompts.size} 个项目级自定义覆盖`)
  } catch {
    // 目录不存在时忽略
  }
}

/** 清空项目级 Prompt 覆盖（关闭项目时调用，防旧项目覆盖残留被误用） */
export function clearProjectCustomPrompts(): void {
  projectCustomPrompts.clear()
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
        // 不覆盖内存已有条目——加载是异步的，期间用户可能已保存（内存 Map 是会话内权威，
        // 文件是跨会话持久化；竞态下以 save 优先，避免加载完成把新保存的值覆盖回旧值）
        if (custom.key && !target.has(custom.key)) {
          target.set(custom.key, custom)
        }
      } catch { /* 忽略无效 JSON */ }
    }
  }
}

/** 根据 key 获取 Prompt 模板（三级优先级：项目级 > 全局级 > 内置；按当前语言解析内容） */
export function getPromptTemplate(key: string): PromptTemplate | undefined {
  // 优先级 1：项目级自定义覆盖
  const projectCustom = projectCustomPrompts.get(key)
  if (projectCustom) return localizeTemplate(projectCustom)

  // 优先级 2：全局自定义覆盖
  if (customPromptsLoaded) {
    const globalCustom = customPrompts.get(key)
    if (globalCustom) return localizeTemplate(globalCustom)
  }

  // 优先级 3：内置默认（语言化）
  const builtin = BUILTIN_PROMPTS.find((p) => p.key === key)
  return builtin ? localizeTemplate(builtin) : undefined
}

/** 获取指定模板当前生效的来源 */
export function getPromptSource(key: string): 'builtin' | 'global' | 'project' {
  if (projectCustomPrompts.has(key)) return 'project'
  if (customPromptsLoaded && customPrompts.has(key)) return 'global'
  return 'builtin'
}

/** 获取所有模板（合并自定义，保留三级覆盖优先级；按当前语言解析内容） */
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
  return all.map(t => localizeTemplate(t))
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
    // 保存成功即视为已加载——否则 getPromptTemplate 的 customPromptsLoaded 检查
    // 会跳过内存 Map，导致"保存后 UI 仍显示内置模板"（Issue #19 根因）
    customPromptsLoaded = true
    return true
  } catch {
    return false
  }
}

/** 保存项目级自定义 Prompt 到 {projectPath}/.vela/prompts/ */
export async function saveProjectCustomPrompt(projectPath: string, template: PromptTemplate): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const dirPath = `${projectPath}/${DIR_PROMPTS}`
    // 确保目录存在
    const exists = await ipc.invoke('fs:check-exists', dirPath)
    if (!exists) {
      await ipc.invoke('fs:mkdir', `${projectPath}/${DIR_VELA_INTERNAL}`)
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

/** 删除全局自定义 Prompt（恢复为内置版本）— fs:delete-file 真删除（此前写空文件模拟，残留 0 字节） */
export async function deleteCustomPrompt(key: string): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const velaHome = await ipc.invoke('config:get-vela-home')
    const filePath = `${velaHome}/prompts/${key}.json`
    const result = await ipc.invoke('fs:delete-file', filePath)
    customPrompts.delete(key)
    return result.success
  } catch {
    return false
  }
}

/** 删除项目级自定义 Prompt（恢复为全局/内置版本） */
export async function deleteProjectCustomPrompt(projectPath: string, key: string): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const filePath = `${projectPath}/${DIR_PROMPTS}/${key}.json`
    const result = await ipc.invoke('fs:delete-file', filePath)
    projectCustomPrompts.delete(key)
    return result.success
  } catch {
    return false
  }
}

/** 输出语言指令：追加到模板末尾，约束 LLM 输出语言与界面语言一致（Issue #19 P.S.） */
const OUTPUT_LANGUAGE_NAMES: Record<SupportedLocale, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
  'ru-RU': 'Русский',
}

/**
 * 追加系统级输出语言约束（置于模板最末，优先级最高；不可被用户自定义覆盖）
 * 解决：非中文语言设置下 LLM 按中文模板工作导致输出偏中文
 */
export function appendOutputLanguage(content: string, locale?: SupportedLocale): string {
  const lang = OUTPUT_LANGUAGE_NAMES[locale ?? getCurrentLocale()]
  return `${content}\n\n[System] 请始终使用 ${lang} 输出所有内容。Do not respond in any other language.`
}

// ⚠️ 渲染统一走 services/prompts/prompt-builder.ts 的 BasePromptBuilder（含 USER_INPUT 注入防护
// 与占位符残留警告）。旧 renderPrompt 曾在此处双轨并存（生产零调用、无注入防护），已删除——
// 禁止在此新增渲染函数，一律使用 Builder。
