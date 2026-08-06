import type { WorkflowDefinition, WorkflowContext, StepCallbacks, WorkflowStep } from '../../stores/workflow-store'
import { t } from '../../shared/locale'
import { useLLMStore } from '../../stores/llm-store'
import { useProjectStore } from '../../stores/project-store'
import { getPromptTemplate } from '../prompt-templates'
import { ipc } from '../ipc-client'
import type { NovelConfig } from '../../shared/ipc-channels'
import type { CharacterData } from '../../../electron/repositories/character-repository'

import { runPostProcessPipeline, stripThinkingTags } from './workflow-utils'

// ==========================================
// 1. 类型定义
// ==========================================

export interface PartialArchData {
  premise_result?: string
  character_dynamics_result?: string
  character_state_result?: string
  world_building_result?: string
  synopsis_result?: string
}

export interface ArchitectureWorkflowParams {
  selectedSteps?: Array<'premise' | 'characters' | 'worldbuilding' | 'synopsis'>
  /** 每步的补充指导（如 { premise: "多强调金手指的限制" }） */
  stepGuidance?: Record<string, string>
}

export interface ConfigGenerationWorkflowParams {
  idea: string
  totalChapters: number
  wordsPerChapter: number
  onGenerated: (config: Partial<NovelConfig>) => void
}

// ==========================================
// 2. 工作流定义
// ==========================================

export function createArchitectureWorkflow(params: ArchitectureWorkflowParams = {}): WorkflowDefinition {
  const sel = params.selectedSteps ?? ['premise', 'characters', 'worldbuilding', 'synopsis']
  const stepDesc = (key: string, defaultDesc: string) => sel.includes(key as never) ? defaultDesc : t('workflow.stepSkipped')
  // 闭包捕获逐步指导，executor 中注入到 context.data
  const guidance = params.stepGuidance || {}

  const allSteps = [
    {
      name: t('arch.storyPremise'),
      key: 'premise',
      description: stepDesc('premise', t('workflow.archPremiseDesc')),
      executor: async (step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GenerateCoreSeedCommand } = await import('./commands/architecture.command')
        return new GenerateCoreSeedCommand().execute({ step, context, callbacks })
      },
    },
    {
      name: t('arch.characterMap'),
      key: 'characters',
      description: stepDesc('characters', t('workflow.archCharactersDesc')),
      executor: async (step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GenerateCharactersCommand } = await import('./commands/architecture.command')
        return new GenerateCharactersCommand().execute({ step, context, callbacks })
      },
    },
    {
      name: t('arch.worldBuilding'),
      key: 'worldbuilding',
      description: stepDesc('worldbuilding', t('workflow.archWorldDesc')),
      executor: async (step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GenerateWorldBuildingCommand } = await import('./commands/architecture.command')
        return new GenerateWorldBuildingCommand().execute({ step, context, callbacks })
      },
    },
    {
      name: t('arch.plotOutline'),
      key: 'synopsis',
      description: stepDesc('synopsis', t('workflow.archSynopsisDesc')),
      executor: async (step: WorkflowStep, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GeneratePlotArchitectureCommand } = await import('./commands/architecture.command')
        return new GeneratePlotArchitectureCommand(sel).execute({ step, context, callbacks })
      },
    },
  ]

  const finalSteps = allSteps.filter(s => sel.includes(s.key as never))

  return {
    type: 'architecture_generation',
    title: t('workflow.generateArch'),
    steps: finalSteps,
    onComplete: { mode: 'silent', message: t('workflow.archDone') },
  }
}

export function createConfigGenerationWorkflow(params: ConfigGenerationWorkflowParams): WorkflowDefinition {
  return {
    type: 'config_generation',
    title: t('workflow.generateConfig'),
    steps: [
      {
        name: t('workflow.analyzeFill'),
        description: t('workflow.configDesc').replace('{n}', String(params.totalChapters)),
        executor: async (step, context, callbacks) => {
          const { GenerateConfigCommand } = await import('./commands/architecture.command')
          const cmd = new GenerateConfigCommand(params.idea, params.totalChapters, params.wordsPerChapter, params.onGenerated)
          return cmd.execute({ step, context, callbacks })
        },
      },
    ],
    onComplete: { mode: 'silent', message: t('workflow.configDone') },
  }
}

// ==========================================
// 3. 工具与指导文本
// ==========================================

export function getPlotStructureGuide(structure: string, totalChapters: number): string {
  const ch20 = Math.round(totalChapters * 0.2)
  const ch25 = Math.round(totalChapters * 0.25)
  const ch50 = Math.round(totalChapters * 0.5)
  const ch75 = Math.round(totalChapters * 0.75)

  switch (structure) {
    case 'heros_journey':
      return `【英雄之旅·十二阶段】（严格按以下阶段组织大纲）\n建议章节分配：全书共 ${totalChapters} 章...` // 为了简洁截断，后台已由架构掌控
    case 'save_the_cat':
      return `【节拍表·十五拍】（严格按以下节拍组织大纲）\n建议章节分配：全书共 ${totalChapters} 章...`
    case 'kishotenketsu':
      return `【起承转合·四段式】（严格按以下四段组织大纲）
建议章节分配：全书共 ${totalChapters} 章
起（约第1章~第${ch25}章，占总篇幅约25%）：介绍世界、角色和日常，建立读者认同
承（约第${ch25 + 1}章~第${ch50}章，占总篇幅约25%）：延续与深化，展现角色关系和冲突苗头
转（约第${ch50 + 1}章~第${ch75}章，占总篇幅约25%）：核心转折，出人意料的变化打破既有格局
合（约第${ch75 + 1}章~第${totalChapters}章，占总篇幅约25%）：收束所有线索，揭示主题，给出结局`
    case 'multi_thread':
      return `【多线叙事】（按多条故事线并行推进的方式组织大纲）
建议章节分配：全书共 ${totalChapters} 章
需要明确以下要素：
1. 主线数量：设定2-4条独立又交织的故事线，每条有独立主角或视角
2. 交汇节点：每条线在第${ch25}章、第${ch50}章、第${ch75}章左右安排交汇碰撞
3. 节奏编排：各线交替出现的节奏，避免某条线长期消失
4. 最终合流：在第${ch75}章前后所有线索开始汇聚，走向统一高潮`
    case 'freeform':
      return `【自由结构】（不限定特定叙事框架，根据故事内容自然编排）
全书共 ${totalChapters} 章。
请根据故事类型和内容特点自行设计最合适的叙事节奏。
核心原则：
1. 保证每10-20章有一个小高潮或悬念释放点
2. 全书应有清晰的开篇建置（前10-15%）和收尾段落（后10-15%）
3. 中段避免节奏单一，适时安排转折点
4. 允许插叙、倒叙、片段式叙事等灵活手法`
    case 'three_act':
    default:
      return `【三幕结构】（严格按以下结构组织大纲）
建议章节分配：全书共 ${totalChapters} 章
第一幕：建置（约第1章~第${ch20}章，占总篇幅约20%）
第二幕：对抗与发展（约第${ch20 + 1}章~第${ch75}章，占总篇幅约55%）
第三幕：高潮与结局（约第${ch75 + 1}章~第${totalChapters}章，占总篇幅约25%）`
  }
}

export function getNarrativePOVLabel(pov: string): string {
  const labels: Record<string, string> = {
    first_person: '第一人称',
    third_limited: '第三人称有限视角',
    third_omniscient: '第三人称全知视角',
    multi_pov: '多视角轮换',
  }
  return labels[pov] || pov
}

// ==========================================
// 4. 角色卡后处理逻辑
// ==========================================

export const ARCH_CHARACTER_SCOPE = 'arch_characters'

/**
 * 从 AI 返回的文本中直接提取角色数据（不依赖 JSON.parse）
 * 解决 AI 生成 JSON 格式不稳定的根本问题
 *
 * 支持格式：
 * - 标准 JSON 数组：[{...}, {...}]
 * - 包裹格式：{ "characters": [...] }
 * - 半结构化文本：每个角色从 "name" 字段开始
 */
function extractCharactersFromText(text: string): Array<Record<string, unknown>> {
  // 1. 找出所有 { ... } 对象块
  const objects: string[] = []
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i
      depth++
    } else if (text[i] === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        objects.push(text.substring(start, i + 1))
        start = -1
      }
    }
  }

  if (objects.length === 0) {
    // 降级：尝试用正则直接提取字段名-值对
    return extractByNamePattern(text)
  }

  const results: Array<Record<string, unknown>> = []

  for (const obj of objects) {
    // 跳过太短的对象（可能不是角色数据）
    if (obj.length < 20) continue

    const card = extractFieldsFromJsonLike(obj)
    if (card && card.name) {
      results.push(card)
    }
  }

  return results.length > 0 ? results : extractByNamePattern(text)
}

/**
 * 从类 JSON 对象字符串中提取字段（容错模式）
 * 使用正则逐个匹配 "field": value 对，容忍格式错误
 */
function extractFieldsFromJsonLike(objStr: string): Record<string, unknown> | null {
  const card: Record<string, unknown> = {}

  // 匹配 "name": "value" 的键值对（支持值中带转义引号）
  const kvPattern = /"(\w+)":\s*"((?:[^"\\]|\\.)*)"/g
  let match: RegExpExecArray | null
  while ((match = kvPattern.exec(objStr)) !== null) {
    card[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n')
  }

  // 也匹配 "name" 后面缺冒号时用空格分隔的模式
  if (!card.name) {
    const nameMatch = objStr.match(/"name"\s*[:=]\s*"([^"]+)"/)
    if (nameMatch) card.name = nameMatch[1]
  }

  return card.name ? card : null
}

/**
 * 降级方案：当无法找到 JSON 对象结构时，直接用 "name" 关键字分割文本
 */
function extractByNamePattern(text: string): Array<Record<string, unknown>> {
  // 按 "name": 或 "name" : 分割
  const parts = text.split(/"name"\s*:\s*"/)
  const results: Array<Record<string, unknown>> = []

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    const nameEnd = part.indexOf('"')
    if (nameEnd === -1) continue
    const name = part.substring(0, nameEnd)

    const card: Record<string, unknown> = { name }
    const kvPattern = /"(\w+)":\s*"((?:[^"\\]|\\.)*)"/g
    let m: RegExpExecArray | null
    while ((m = kvPattern.exec(part)) !== null) {
      if (m[1] !== 'name') card[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\n/g, '\n')
    }

    if (card.name) results.push(card)
  }

  return results
}
export function createCharacterExtractSteps(_projectPath: string, characterDynamicsContent: string, genre: string) {
  return [
    {
      key: 'extract_character_cards',
      label: t('workflow.extractInitialCards'),
      critical: true,
      executor: async (cb: { appendText: (t: string) => void; log: (m: string) => void }) => {
        const { ArchitecturePromptBuilder } = await import('../prompts/prompt-builder')
        const template = getPromptTemplate('extract_initial_characters')
        if (!template) throw new Error(t('error.templateNotFound').replace('{name}', 'extract_initial_characters'))
        const extractPrompt = new ArchitecturePromptBuilder(template).withCharacterDynamics(characterDynamicsContent).withGenre(genre).build()
        const systemRole = template.systemRole || t('role.dataStructurer')

        const llmStore = useLLMStore.getState()
        cb.appendText(t('log.extractCardsStart'))

        let fullContent = ''
        await new Promise<void>((resolve, reject) => {
          llmStore.generateStream(
            [
              { role: 'system', content: systemRole },
              { role: 'user', content: extractPrompt }
            ],
            {
              onChunk: (chunk) => { fullContent += chunk; cb.appendText(chunk) },
              onDone: () => resolve(),
              onError: (err) => reject(new Error(err))
            },
            undefined,
            { responseFormat: { type: 'json_object' } }
          )
        })

        const cleanedCards = stripThinkingTags(fullContent)
        const rawText = cleanedCards.replace(/```json?\n?/g, '').replace(/```/g, '').trim()

        // 使用正则直接提取角色数据，避免 AI 格式不稳定的 JSON.parse
        const parsedCards = extractCharactersFromText(rawText)

        if (parsedCards.length === 0) {
          throw new Error(t('error.roleDataInvalid').replace('{text}', rawText.slice(0, 200)))
        }

        // 防御：AI 可能将文本字段生成为对象或数组，统一转为字符串
        const stringifyField = (val: unknown): string => {
          if (!val) return ''
          if (typeof val === 'string') return val
          if (Array.isArray(val)) return val.map(v => String(v)).join('、')
          if (typeof val === 'object') return JSON.stringify(val, null, 2)
          return String(val)
        }

        // 构建角色卡数据列表
        const validRoles = ['protagonist', 'antagonist', 'supporting', 'minor']
        const characterDataList: Array<Record<string, unknown>> = []
        for (const card of parsedCards) {
          if (!card.name) continue
          const role = validRoles.includes(card.role as string) ? card.role : 'supporting'
          const cleaned: Record<string, unknown> = { name: card.name, role }
          for (const key of ['gender', 'age', 'appearance', 'personality', 'background', 'abilities', 'motivation', 'relationships', 'arc', 'notes']) {
            if (card[key] !== undefined) cleaned[key] = stringifyField(card[key])
          }
          // v7 标签：LLM 输出数组 → 存 JSON 数组字符串（角色列表 JSON.parse 消费）
          if (card.tags !== undefined) {
            const tags = Array.isArray(card.tags)
              ? card.tags.map(String).filter(Boolean)
              : String(card.tags).split(/[，,、]/).map(s => s.trim()).filter(Boolean)
            if (tags.length > 0) cleaned.tags = JSON.stringify(tags.slice(0, 8))
          }
          characterDataList.push(cleaned)
        }

        // 批量写入数据库
        const saveResult = await ipc.invoke('db:character-save-all', characterDataList as unknown as CharacterData[])
        if (!saveResult.success) {
          throw new Error(t('error.characterCardsSave').replace('{error}', saveResult.error || t('status.unknown')))
        }
        cb.log(t('log.extractCardsDone').replace('{n}', String(characterDataList.length)))
      },
    },
  ]
}

export function runArchCharacterExtract(projectPath: string, characterDynamicsContent: string, genre: string): void {
  const steps = createCharacterExtractSteps(projectPath, characterDynamicsContent, genre)
  import('../../stores/workflow-store').then(async ({ useWorkflowStore }) => {
    await useWorkflowStore.getState().startWorkflow({
      type: 'post_process',
      title: t('workflow.postProcessCards'),
      steps: [
        {
          name: t('workflow.extractCards'),
          description: t('workflow.extractCardsDesc'),
          executor: async (_step, _ctx, callbacks) => {
            const { globalEventBus } = await import('../../shared/event-bus')
            const archStatus = await runPostProcessPipeline(projectPath, ARCH_CHARACTER_SCOPE, t('workflow.archCharacterSource'), steps, callbacks)
            if (archStatus.allCriticalPassed) {
              // 角色卡提取成功 → 通过 EventBus 通知 ProjectService 刷新
              globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {})
            } else {
              // 提取失败 → 记录详细错误日志
              const failedStep = steps.find(s => {
                const stepResult = archStatus.steps[s.key]
                return stepResult && !stepResult.ok
              })
              const errMsg = failedStep
                ? `${failedStep.label}: ${archStatus.steps[failedStep.key]?.error || t('status.unknown')}`
                : t('log.extractFailedUnknown')
              callbacks.log(`❌ ${errMsg}`)
              globalEventBus.emit('CHARACTER_EXTRACT_FAILED', { error: errMsg })
              globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {})
            }
          },
        },
      ],
    })
  })
}

export async function repairArchCharacterCards(projectPath: string): Promise<void> {
  const core = await ipc.invoke('db:project-core-get')
  if (!core?.charactersArch || core.charactersArch.length < 50) throw new Error(t('error.cannotExtractCards'))

  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error(t('error.noProject'))

  const steps = createCharacterExtractSteps(projectPath, core.charactersArch, project.novelConfig.genre)
  const { useWorkflowStore } = await import('../../stores/workflow-store')
  await useWorkflowStore.getState().startWorkflow({
    type: 'post_process',
    title: t('workflow.fixCards'),
    steps: [
      {
        name: t('workflow.retryCards'),
        description: t('workflow.retryCardsDesc'),
        executor: async (_step, _ctx, callbacks) => {
          const { globalEventBus } = await import('../../shared/event-bus')
          const archStatus = await runPostProcessPipeline(projectPath, ARCH_CHARACTER_SCOPE, t('workflow.archCharacterSource'), steps, callbacks, { onlyFailed: true })
          if (archStatus.allCriticalPassed) {
            globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {})
          } else {
            globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {})
          }
        },
      },
    ],
  })
}

