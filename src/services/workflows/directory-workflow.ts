import type { WorkflowDefinition } from '../../stores/workflow-store'
import type { BlueprintGeneration } from '../../core'
import type { WorkflowContext } from '../../shared/workflow-types'
import { t } from '../../shared/locale'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../ipc-client'
import type { BlueprintData } from '../../../electron/repositories/blueprint-repository'
import { stripThinkingTags, extractAndRepairJSON, parseMarkdownTable } from './workflow-utils'
import { renderLog } from '../render-logger'
import { normalizeBlueprintRole } from '../blueprint-role'
import { registerWorkflow } from './workflow-registry'
import {
  assertChapterBlueprintScope, captureChapterBlueprintScope, createDirectoryBlueprintWriter, isChapterBlueprintScopeCurrent,
} from '../chapters/chapter-blueprint-adapter'

// ==========================================
// 1. 结构与类型导出 (保留对外的向后兼容)
// ==========================================

export type ChapterBlueprint = BlueprintData

const EMPTY_BLUEPRINT: ChapterBlueprint = {
  chapterNumber: 0,
  title: '',
  role: '发展',
  purpose: '',
  keyEvents: '',
  characters: [],
  suspenseHook: '',
  userGuidance: '',
  notes: '',
  notesUpdatedAt: '',
  sortOrder: 0,
  priority: 0,
}

export type DirectoryWorkflowParams = BlueprintGeneration

// ==========================================
// 2. 蓝图解析与文件访问
// ==========================================

/**
 * 从已解析的 JSON 数据中提取蓝图数组并转换为 ChapterBlueprint[]
 * 供 parseTextBlueprints 的 JSON fallback 路径使用
 */
export function parseTextBlueprintsFromParsed(
  parsed: unknown,
  startNum: number,
  endNum: number,
): ChapterBlueprint[] {
  const result: ChapterBlueprint[] = []

  // 辅助：获取章节号
  const getChapterNum = (p: Record<string, unknown>): number => {
    const n = Number(p.chapterNumber ?? p.chapter_number ?? p.chapter ?? p.number ?? p.chapterNum ?? p.id ?? 0)
    return isNaN(n) ? 0 : n
  }

  // 辅助：从对象中提取蓝图数组
  const extractArrayFromObject = (obj: Record<string, unknown>): unknown[] | null => {
    for (const key of ['blueprints', 'chapters', 'chapterBlueprints', 'data', 'results', 'list']) {
      if (Array.isArray(obj[key])) {
        return obj[key] as unknown[]
      }
    }
    for (const val of Object.values(obj)) {
      if (Array.isArray(val) && val.length > 0) {
        return val as unknown[]
      }
    }
    return null
  }

  // 统一提取蓝图数组（支持多种 wrapper key 和嵌套结构）
  let blueprintArray: unknown[] | null = null

  if (Array.isArray(parsed)) {
    const firstItem = parsed[0]
    if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
      const obj = firstItem as Record<string, unknown>
      if (getChapterNum(obj) > 0) {
        blueprintArray = parsed
      } else {
        const allChapters: unknown[] = []
        for (const item of parsed) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const arr = extractArrayFromObject(item as Record<string, unknown>)
            if (arr) allChapters.push(...arr)
          }
        }
        blueprintArray = allChapters.length > 0 ? allChapters : parsed
      }
    } else {
      blueprintArray = parsed
    }
  } else if (parsed && typeof parsed === 'object') {
    blueprintArray = extractArrayFromObject(parsed as Record<string, unknown>)
  }

  if (!blueprintArray || blueprintArray.length === 0) {
    return []
  }

  for (const item of blueprintArray) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const chNum = getChapterNum(p)

    if (chNum <= 0) continue
    if (chNum < startNum || chNum > endNum) continue

    const chars = p.characters ?? p.characterList ?? p.character_list ?? []
    // 容错：AI 可能返回字符串 "角色A, 角色B" 而非数组
    let characterArray: string[]
    if (Array.isArray(chars)) {
      characterArray = chars.map(String)
    } else if (typeof chars === 'string' && chars.trim().length > 0) {
      characterArray = chars.split(/[,，、\s]+/).filter(Boolean)
    } else {
      characterArray = []
    }
    result.push({
      ...EMPTY_BLUEPRINT,
      chapterNumber: chNum,
      title: String(p.title ?? p.chapterTitle ?? p.chapter_title ?? `第${chNum}章`),
      // 归一化：英文模板输出的 role 枚举（Setup/Development...）→ 中文规范值
      role: normalizeBlueprintRole(String(p.role ?? '')),
      purpose: String(p.purpose ?? p.goal ?? ''),
      keyEvents: String(p.keyEvents ?? p.key_events ?? p.events ?? ''),
      characters: characterArray,
      suspenseHook: String(p.suspenseHook ?? p.suspense_hook ?? p.hook ?? ''),
      userGuidance: '',
    })
  }

  const distinctMap = new Map<number, ChapterBlueprint>()
  for (const item of result) {
    if (!distinctMap.has(item.chapterNumber)) distinctMap.set(item.chapterNumber, item)
  }

  return Array.from(distinctMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber)
}

/**
 * 从 Markdown 表格解析结果转换为 ChapterBlueprint[]
 * 与 parseTextBlueprintsFromParsed 逻辑对等，但输入是 table row 而非 JSON
 */
export function parseTextBlueprintsFromTable(
  rows: Array<Record<string, string>>,
  startNum: number,
  endNum: number,
): ChapterBlueprint[] {
  const result: ChapterBlueprint[] = []

  for (const row of rows) {
    const chNum = Number(row.chapterNumber)
    if (isNaN(chNum) || chNum <= 0) continue
    if (chNum < startNum || chNum > endNum) continue

    // 解析角色列表：支持逗号、中文逗号、顿号分隔
    const charStr = row.characters || ''
    const characterArray = charStr
      .split(/[,，、\s]+/)
      .map(s => s.trim())
      .filter(Boolean)

    result.push({
      ...EMPTY_BLUEPRINT,
      chapterNumber: chNum,
      title: row.title || `第${chNum}章`,
      role: normalizeBlueprintRole(row.role),
      purpose: row.purpose || '',
      keyEvents: row.keyEvents || '',
      characters: characterArray,
      suspenseHook: row.suspenseHook || '',
      userGuidance: '',
    })
  }

  // 去重：同一章节号只保留第一条
  const distinctMap = new Map<number, ChapterBlueprint>()
  for (const item of result) {
    if (!distinctMap.has(item.chapterNumber)) {
      distinctMap.set(item.chapterNumber, item)
    }
  }

  return Array.from(distinctMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber)
}

/**
 * 解析 AI 输出的蓝图文本（双路径策略）
 *
 * PATH 1: Markdown 表格（主路径）— 更可靠
 * PATH 2: JSON（fallback 路径）— 向后兼容
 */
export function parseTextBlueprints(content: string, startNum: number, endNum: number): ChapterBlueprint[] {
  try {
    const cleanContent = stripThinkingTags(content)

    // ==== PATH 1: Markdown 表格（主路径）====
    const tableRows = parseMarkdownTable(cleanContent)
    if (tableRows && tableRows.length > 0) {
      const result = parseTextBlueprintsFromTable(tableRows, startNum, endNum)
      if (result.length > 0) {
        // LLM 提取日志流：蓝图提取路径可见（info 级，公测/正式版也保留）
        renderLog('info', 'Extract', t('log.render.extractTableSuccess')
          .replace('{count}', String(result.length))
          .replace('{start}', String(startNum))
          .replace('{end}', String(endNum)))
        return result
      }
    }

    // ==== PATH 2: JSON（fallback 路径）====
    renderLog('warn', 'Extract', t('log.render.extractTableEmpty'))

    // 预处理：移除 AI 常见的前导/后随说明文本
    let jsonContent = cleanContent
    const firstBrace = jsonContent.indexOf('{')
    const firstBracket = jsonContent.indexOf('[')
    const lastBrace = jsonContent.lastIndexOf('}')
    const lastBracket = jsonContent.lastIndexOf(']')
    const start = firstBrace !== -1 ? firstBrace : firstBracket
    const end = lastBrace !== -1 ? lastBrace : lastBracket
    if (start !== -1 && end !== -1 && end > start) {
      jsonContent = jsonContent.substring(start, end + 1)
    }

    // 多层级提取 + 修复引擎
    let { parsed, repaired } = extractAndRepairJSON(jsonContent, false)
    if (!parsed) {
      const arrayResult = extractAndRepairJSON(jsonContent, true)
      parsed = arrayResult.parsed
      repaired = repaired || arrayResult.repaired
    }

    if (!parsed) {
      // LLM 提取日志流：失败原因落盘（error 级，含原始内容头部供排查）
      renderLog('error', 'Extract', t('log.render.extractJsonFailed').replace('{content}', () => cleanContent.slice(0, 500)))
      return []
    }

    if (repaired) {
      renderLog('info', 'Extract', Array.isArray(parsed)
        ? t('log.render.extractJsonRepairedArray').replace('{count}', String(parsed.length))
        : t('log.render.extractJsonRepairedObject').replace('{count}', String(Object.keys(parsed as object).length)))
    } else {
      renderLog('debug', 'Extract', t('log.render.extractJsonDirect'))
    }

    const result = parseTextBlueprintsFromParsed(parsed, startNum, endNum)

    if (result.length === 0) {
      console.warn(
        `[parseTextBlueprints] 从已解析数据中未提取到有效蓝图 ` +
        `(期望章节范围 ${startNum}-${endNum})`,
        '\n解析类型:', Array.isArray(parsed) ? '数组' : typeof parsed,
        '\n解析结果:', JSON.stringify(parsed).slice(0, 500),
      )
    }

    return result
  } catch (e) {
    console.error('[parseTextBlueprints] 未预期异常:', e, '\n原始内容前500字:', content.slice(0, 500))
    return []
  }
}

export async function loadDirectoryBlueprints(): Promise<ChapterBlueprint[]> {
  try {
    const blueprints = await ipc.invoke('db:blueprint-get-all')
    return blueprints.sort((a, b) => a.chapterNumber - b.chapterNumber)
  } catch {
    return []
  }
}

export async function saveChapterBlueprint(blueprint: ChapterBlueprint): Promise<void> {
  const result = await ipc.invoke('db:blueprint-upsert', blueprint)
  if (!result.success) {
    throw new Error(t('error.blueprintSaveFailed').replace('{n}', String(blueprint.chapterNumber)).replace('{error}', result.error || t('status.unknown')))
  }
}

export async function getBlueprintCount(): Promise<number> {
  try {
    const blueprints = await ipc.invoke('db:blueprint-get-all')
    return blueprints.length
  } catch {
    return 0
  }
}

// ==========================================
// 3. 工作流定义映射工厂 (Command 调度层)
// ==========================================

export function createDirectoryWorkflow(params: DirectoryWorkflowParams = { mode: 'full' }): WorkflowDefinition {
  const request = { ...params }
  const source = captureChapterBlueprintScope()
  if (request.mode === 'full' && !request.count) {
    request.expectedTotalChapters ??= useProjectStore.getState().currentProject?.novelConfig.totalChapters
  }
  const assertActive = (context: WorkflowContext) => {
    if (!source) throw new Error(t('error.noProject'))
    assertChapterBlueprintScope(source)
    if (context.cancelled) throw new Error(t('error.workflowCancelled'))
    return source
  }
  return {
    type: 'directory',
    rehydrateParams: { ...request },
    title: request.mode === 'append'
      ? (request.startChapter
        ? t('workflow.dirTitleAppendFrom').replace('{n}', String(request.startChapter))
        : t('workflow.dirTitleAppend'))
      : t('workflow.dirTitleFull'),
    steps: [
      {
        name: t('workflow.dirReadArch'),
        description: t('workflow.dirReadArchDesc'),
        executor: async (_step, context, callbacks) => {
          callbacks.log(t('log.dirReadingArch'))
          const source = assertActive(context)
          const writer = createDirectoryBlueprintWriter(source)
          const connection = await writer.readConnection()
          assertActive(context)
          const core = await ipc.invoke('db:project-core-get')
          assertActive(context)
          if (!core) throw new Error(t('error.coreNotInitialized'))

          const parts: string[] = []
          if (core.premise && core.premise.length > 50) parts.push(core.premise)
          if (core.charactersArch && core.charactersArch.length > 50) parts.push(core.charactersArch)
          if (core.worldbuilding && core.worldbuilding.length > 50) parts.push(core.worldbuilding)
          if (core.synopsis && core.synopsis.length > 50) parts.push(core.synopsis)

          if (parts.length === 0) throw new Error(t('error.noArchitecture'))

          const { mode, startChapter, count, expectedTotalChapters } = request
          const { snapshot, existingBlueprints } = await writer.read({ mode, startChapter, count, expectedTotalChapters }, connection)
          assertActive(context)
          if (mode === 'append') {
            callbacks.log(t('log.dirExistingLoaded').replace('{n}', String(existingBlueprints.length)))
          }
          assertActive(context)
          context.data.directoryWriteSnapshot = snapshot
          context.data.architecture = parts.join('\n\n---\n\n')
          context.data.pacingGuidance = request.pacingGuidance
          context.data.existingBlueprints = mode === 'append' ? existingBlueprints : []
          return t('workflow.archLoadedCount').replace('{n}', String(parts.length))
        },
      },
      {
        name: t('workflow.dirGenerate'),
        description: t('workflow.dirGenerateDesc'),
        executor: async (_step, context, callbacks) => {
          const source = assertActive(context)
          const snapshot = await createDirectoryBlueprintWriter(source).checkConnection(context.data.directoryWriteSnapshot)
          assertActive(context)
          delete context.data.newBlueprints
          if (!snapshot.range) {
            context.data.newBlueprints = []
            return t('workflow.dirNoNewBlueprints')
          }
          const { GenerateDirectoryCommand } = await import('./commands/directory.command')
          assertActive(context)
          const cmd = new GenerateDirectoryCommand(request, source, snapshot.range)
          const blueprints = await cmd.execute({ step: _step, context, callbacks })
          return t('workflow.dirGeneratedCount').replace('{n}', String(blueprints.length))
        },
      },
      {
        name: t('workflow.dirSave'),
        description: t('workflow.dirSaveDesc'),
        executor: async (_step, context, callbacks) => {
          callbacks.log(t('log.dirSaving'))
          const source = assertActive(context)
          const writer = createDirectoryBlueprintWriter(source)
          const snapshot = context.data.directoryWriteSnapshot
          const output = context.data.newBlueprints
          if (Array.isArray(output) && output.length === 0) {
            const checked = await writer.checkConnection(snapshot)
            assertActive(context)
            if (!checked.range) return t('workflow.dirNoNewBlueprints')
          }
          context.finalCommitStarted = true
          await writer.commit(snapshot, output)
          if (!isChapterBlueprintScopeCurrent(source)) return t('workflow.dirSaved')
          try {
            await useProjectStore.getState().refreshFileTree()
          } catch (error) {
            callbacks.log(t('editor.refreshFailed').replace('{error}', () => String(error)))
          }
          return t('workflow.dirSaved')
        },
      },
    ],
    onComplete: {
      mode: 'silent',
      message: request.mode === 'append' ? t('workflow.dirDoneAppend') : t('workflow.dirDoneFull'),
    },
  }
}

// 顶层自注册（rehydrate 重建，L2 任务6）
registerWorkflow('directory', (p) => createDirectoryWorkflow(p as unknown as DirectoryWorkflowParams))
