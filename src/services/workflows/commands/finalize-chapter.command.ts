import { t } from '../../../shared/locale'
import { computeTextStats } from '../../text-stats'
import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { useLLMStore } from '../../../stores/llm-store'
import { getPromptTemplate } from '../../prompt-templates'
import { PostProcessPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'

import {
  runPostProcessPipeline,
  getChapterFinalizeScope,
  stripThinkingTags,
  type PostProcessStep,
} from '../workflow-utils'
import type { ChapterInfo } from '../chapter-workflow'
import type { CharacterData } from '../../../../electron/repositories/character-repository'
import type { StepCallbacks } from '../../../stores/workflow-store'
import { isNoChangeValue, normalizeCharacterRole, normalizeTagsValue, matchCharacterName, stripNameAlias } from '../../character-normalize'
import { buildNamePositions, hasProximity, closestNamePair, hasDialogueMarker } from '../relation-utils'

export interface FinalizeChapterParams {
  draftPath: string
  draftContent: string
  chapterNumber: number
  chapterInfo: ChapterInfo
}

// ===== 工具函数：流式调用大模型并返回完整文本 =====

/**
 * 使用 PromptBuilder 调用 LLM（不依赖 BaseWorkflowCommand 实例）
 * 独立函数，可被 PostProcessStep 的 executor 直接调用
 */
async function callLLMForPostProcess(
  builder: { build: () => string; getSystemRole: () => string },
  callbacks: { appendText: (text: string) => void },
  options?: { responseFormat?: { type: string } },
): Promise<string> {
  const llmStore = useLLMStore.getState()
  if (!llmStore.defaultModelId) throw new Error(t('error.noDefaultModel'))

  const modelId = llmStore.defaultModelId
  const model = llmStore.models.find(m => m.id === modelId)
  const startTime = Date.now()

  const logLLMCall = (success: boolean, errorMessage?: string) => {
    const duration = Date.now() - startTime
    ipc.invoke('db:log-llm-call', {
      model_id: modelId,
      model_name: model?.name ?? model?.modelName ?? '',
      purpose: 'post_process',
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      duration_ms: duration,
      success: success ? 1 : 0,
      error_message: errorMessage ?? '',
    }).catch(() => { })
  }

  return new Promise<string>((resolve, reject) => {
    let fullContent = ''
    llmStore.generateStream(
      [
        { role: 'system', content: builder.getSystemRole() },
        { role: 'user', content: builder.build() },
      ],
      {
        onChunk: (chunk) => { fullContent += chunk; callbacks.appendText(chunk) },
        onDone: (text, usage) => {
          if (usage) {
            ipc.invoke('db:log-llm-call', {
              model_id: modelId,
              model_name: model?.name ?? model?.modelName ?? '',
              purpose: 'post_process',
              prompt_tokens: usage.promptTokens,
              completion_tokens: usage.completionTokens,
              total_tokens: usage.totalTokens,
              duration_ms: Date.now() - startTime,
              success: 1,
            }).catch(() => { })
          } else {
            logLLMCall(true)
          }
          const raw = text || fullContent
          resolve(stripThinkingTags(raw))
        },
        onError: (err) => {
          logLLMCall(false, err || t('log.render.llmStreamFailed'))
          reject(new Error(err || t('log.render.llmStreamFailed')))
        },
      },
      undefined,
      options,
    )
  })
}


// ===== 后处理步骤构建器 =====

/**
 * 构建章节定稿后处理步骤列表
 *
 * 每个步骤都是独立的 PostProcessStep，由 runPostProcessPipeline
 * 统一调度执行、持久化状态、支持单步重试。
 * 导出供 createRepairFinalizeWorkflow 复用。
 *
 * @param project       当前项目信息
 * @param chapterNumber 章节号
 * @param chapterTitle  章节标题
 * @param draftContent  定稿正文内容
 */
export function buildFinalizePostProcessSteps(
  _project: { path: string },
  chapterNumber: number,
  chapterTitle: string,
  draftContent: string,
): PostProcessStep[] {
  const steps: PostProcessStep[] = []

  // ─── 步骤 1: 导入知识库（无依赖，可独立执行）─────────────────────
  steps.push({
    key: 'kb_import',
    label: t('workflow.importKB'),
    critical: true,
    dependsOn: [],
    executor: async (callbacks) => {
      const contentFileName = chapterTitle
        ? `第${chapterNumber}章 ${chapterTitle}.txt`
        : `chapter_${chapterNumber}.txt`
      const result = await ipc.invoke('kb:import-text', draftContent, contentFileName, _project.path) as { success: boolean; error?: string; chunkCount?: number }
      if (result.success) {
        callbacks.log(t('log.finalize.kbImported').replace('{count}', String(result.chunkCount)))
      } else {
        throw new Error(t('error.kbImportFailed').replace('{error}', String(result.error)))
      }
    },
  })

  // ─── 步骤 2: 本章剧情要点提取 ─────────────────────────────────────
  const notesTemplate = getPromptTemplate('generate_chapter_notes')
  if (notesTemplate) {
    steps.push({
      key: 'chapter_notes',
      label: t('workflow.chapterKeyPoints'),
      critical: true,
      dependsOn: ['kb_import'],
      executor: async (callbacks) => {
        const notesBuilder = new PostProcessPromptBuilder(notesTemplate)
          .withChapterContent(draftContent)
          .withChapterNumber(chapterNumber)
          .withChapterTitle(chapterTitle)

        const cleanNotes = await callLLMForPostProcess(notesBuilder, callbacks)

        // 写入蓝图 JSON 的 notes 字段
        await ipc.invoke('db:blueprint-update-notes', chapterNumber, cleanNotes)
        callbacks.log(t('log.finalize.notesDone'))
      },
    })
  }

  // ─── 步骤 3: 角色状态更新 ────────────────────────────────────────
  const cardTemplate = getPromptTemplate('update_character_cards')
  if (cardTemplate) {
    steps.push({
      key: 'character_cards',
      label: t('workflow.characterStateUpdate'),
      critical: false,
      dependsOn: ['kb_import'],  // 仅依赖 KB 导入完成，可与 chapter_notes 并行
      executor: async (callbacks) => {
        // 读取现有角色卡
        const allChars = (await ipc.invoke('db:character-get-all')) as unknown as CharacterData[]
        const simpleCards = allChars.map((c) => ({ name: c.name, role: c.role }))

        // ⚠️ M 级修复：分段注入（首 5000 + 尾 3000 + 中间抽样）——此前只喂前 5000 字，
        //    后半章的角色变化模型完全看不到，却按 prompt 指示"tags 无变化填无"——
        //    系统用确定性"无"占位把真实变化过滤掉了
        const chapterContent = (() => {
          const first = draftContent.slice(0, 5000)
          if (draftContent.length <= 5000) return first
          const last = draftContent.slice(-3000)
          const middle = draftContent.length > 12000
            ? draftContent.slice(6000, 8000)
            : ''
          return first + (middle ? `\n\n[中段抽样]\n${middle}` : '') + `\n\n[结尾]\n${last}`
        })()

        const cardBuilder = new PostProcessPromptBuilder(cardTemplate)
          .withChapterContent(chapterContent)
          .withChapterNumber(chapterNumber)
          .withExistingCardsJson(simpleCards)

        const cardsResult = await callLLMForPostProcess(cardBuilder, callbacks)

        // 解析 Markdown 表格格式的角色状态更新（比 JSON 更稳定）
        const { parseMarkdownTable, robustParseJSON, splitCharacterUpdateSections } = await import('../workflow-utils')
        // 分段容忍 LLM 变体：无 ### 前缀/带方括号 `[UPDATES（...）`/中文注释（用户实测输出形态）
        const updSections = splitCharacterUpdateSections(cardsResult)
        let updateRows: Array<Record<string, string>> = []
        let newRows: Array<Record<string, string>> = []

        for (const sec of updSections) {
          if (sec.label === 'UPDATES') {
            updateRows = parseMarkdownTable(sec.content) || []
          } else if (sec.label === 'NEW') {
            newRows = parseMarkdownTable(sec.content) || []
          }
        }
        // 如果没有分段，尝试整体解析——按角色名是否已存在分类：
        //   历史事故：唯一一张 NEW 表被整体当 UPDATES → allChars.find 找不到 → continue
        //   静默跳过，新角色全部丢失。回退时按存在性分流，不存在的名字进 newRows。
        if (updateRows.length === 0 && newRows.length === 0) {
          const fallbackRows = parseMarkdownTable(cardsResult) || []
          // #34：存在性判定用 matchCharacterName（精确 + 括号别名双形态），
          // 此前精确匹配——DB 名带括号时「无名老乞丐（前魂师）」vs「无名老乞丐」判定为不存在
          updateRows = fallbackRows.filter(r => matchCharacterName(allChars, r.name || ''))
          newRows = fallbackRows.filter(r => !matchCharacterName(allChars, r.name || '') && (r.name || ''))
        }

        // L2: JSON 回退（字段映射与 Markdown 表格一致：currentState + tags/motivation + NEW 详情）
        if (updateRows.length === 0 && newRows.length === 0) {
          const jsonParsed = robustParseJSON(cardsResult, false)
          if (jsonParsed && typeof jsonParsed === 'object') {
            const obj = jsonParsed as Record<string, unknown>
            const jUpdates = (Array.isArray(obj.updates) ? obj.updates : []) as Array<Record<string, unknown>>
            const jNewChars = (Array.isArray(obj.newCharacters) ? obj.newCharacters : []) as Array<Record<string, unknown>>
            const jChars = (Array.isArray(obj.characters) ? obj.characters : []) as Array<Record<string, unknown>>
            const src = jUpdates.length > 0 ? jUpdates : jChars
            const mapState = (c: Record<string, unknown>) => {
              const st = (c.currentState as Record<string, unknown> | undefined) ?? {}
              return {
                name: String(c.name || ''),
                location: String(st.location || c.location || ''),
                powerLevel: String(st.powerLevel || c.powerLevel || ''),
                physicalState: String(st.physicalState || c.physicalState || ''),
                mentalState: String(st.mentalState || c.mentalState || ''),
                keyItems: String(st.keyItems || c.keyItems || ''),
                recentEvents: String(st.recentEvents || c.recentEvents || ''),
                tags: typeof c.tags === 'string' ? c.tags : (Array.isArray(c.tags) ? (c.tags as unknown[]).join('、') : ''),
                motivation: String(c.motivation || ''),
                appearance: String(c.appearance || ''),
                personality: String(c.personality || ''),
              }
            }
            if (src.length > 0) {
              updateRows = src.map(mapState)
            }
            if (jNewChars.length > 0) {
              newRows = jNewChars.map(mapState)
            }
            if (updateRows.length > 0 || newRows.length > 0) {
              callbacks.log(t('log.finalize.charStateJsonFallback'))
            }
          }
        }

        // L1 + L2 均失败：记录可诊断日志（步骤以成功完成，但 0 更新——用户/开发者有线索）
        if (updateRows.length === 0 && newRows.length === 0) {
          callbacks.log(t('log.finalize.charStateParseFailed'))
        }

        // LLM 输出归一化：tags → JSON 数组字符串（角色列表按 JSON.parse 消费）
        // ⚠️ P1 加固：哨兵判定升级为变体感知（character-normalize）——'none.'/'No new tags'/
        //    'not applicable'/'unchanged'/'-' 等英文常见变体此前绕过精确匹配，
        //    导致 tags/motivation 被垃圾串替换、cs_* 状态被 'none' 字面量覆盖
        // 哨兵判定/枚举归一化统一走 character-normalize（变体感知，可单测）
        // LLM 占位"无/无变化/none/no changes"变体 → null（不覆盖已有值）
        const cleanOptional = (value: string): string | null => {
          const s = String(value ?? '').trim()
          return isNoChangeValue(s) ? null : s
        }
        const cleanText = (value: string): string => {
          const s = String(value ?? '').trim()
          return isNoChangeValue(s) ? '' : s
        }

        if (updateRows.length > 0) {
          for (const row of updateRows) {
            const name = row.name || ''
            if (!name) continue
            // 别名格式「苏晚晴（苏夜）」→ 剥离括号匹配 DB 角色（精确匹配失败会静默跳过更新）
            const dbChar = matchCharacterName(allChars, name)
            if (dbChar) {
              // ⚠️ 更新目标必须用 DB 规范名（dbChar.name）：此前传 LLM 原始名 name——
              //     LLM 名带括号而 DB 名不带时，WHERE name = '苏晚晴（苏夜）' 匹配不到行，
              //     匹配成功但更新静默落空（#34 评估发现）
              // cs_* 六字段哨兵值（无/无变化/none 变体）→ null → SQL CASE WHEN 保旧值。
              // ⚠️ 合并已下沉 repository 层（写时刻以 DB 当前值为基准，SQL 层 CASE 保旧列）——
              //    不再读快照合并，消除并发定稿/LLM 调用期间旧快照覆盖新状态的竞态
              const newState = {
                location: cleanOptional(row.location) ?? '',
                powerLevel: cleanOptional(row.powerLevel) ?? '',
                physicalState: cleanOptional(row.physicalState) ?? '',
                mentalState: cleanOptional(row.mentalState) ?? '',
                keyItems: cleanOptional(row.keyItems) ?? '',
                recentEvents: cleanOptional(row.recentEvents) ?? '',
                updatedAtChapter: chapterNumber,
              }
              // 标签/核心动机：有更新才覆盖（COALESCE），LLM 输出"无"变体保留旧值
              await ipc.invoke('db:character-update-state', dbChar.name, newState, {
                tags: normalizeTagsValue(row.tags ?? '') || null,
                motivation: cleanOptional(row.motivation ?? ''),
              })
              callbacks.log(t('log.finalize.charStateUpdated').replace('{name}', name))
            } else {
              // 角色已被删除但 LLM 仍输出 → 记录可诊断日志（此前静默丢弃，排查无线索）
              callbacks.log(t('log.finalize.charUpdateSkipped').replace('{name}', name))
            }
          }
        }

        if (newRows.length > 0) {
          let newCharCount = 0
          for (const row of newRows) {
            // #34：写入端剥离括号别名（「无名老乞丐（前魂师）」→「无名老乞丐」），
            // 保证主键稳定——带括号名落库后与后续无括号输出分裂成两条记录
            const name = stripNameAlias(row.name || '')
            // NEW 表哨兵：LLM 用「无」/「-」表示无新出场角色——此前会真的创建名为「无」的角色；
            // 去重用 matchCharacterName（精确 + 别名双形态）：已有角色被 LLM 误写进 NEW 时跳过创建
            if (!name || isNoChangeValue(name) || matchCharacterName(allChars, row.name || '')) continue
            newCharCount++
            // ⚠️ P1 加固：role 枚举归一化（'Protagonist' 大写入库此前绕过 tier 推导/排序/UI 分级）
            const role = normalizeCharacterRole(row.role)
            await ipc.invoke('db:character-upsert', {
              name: name,
              role,
              gender: '', age: '',
              appearance: cleanText(row.appearance ?? ''),
              personality: cleanText(row.personality ?? ''),
              background: '', abilities: '',
              motivation: cleanOptional(row.motivation ?? '') ?? '',
              relationships: '', arc: '', notes: '',
              // tier 按 role 推导（P2 修复：此前恒 2——新主角/反派 DB tier=2 与「protagonist/antagonist → tier 1」规则矛盾）
              tier: role === 'protagonist' || role === 'antagonist' ? 1 : (role === 'minor' ? 3 : 2),
              tags: normalizeTagsValue(row.tags ?? ''),
              appearChapters: JSON.stringify([chapterNumber]), // 登记出场章节
              relations: '[]',
              currentState: {
                location: row.location || '',
                powerLevel: row.powerLevel || '',
                physicalState: row.physicalState || '',
                mentalState: row.mentalState || '',
                keyItems: row.keyItems || '',
                recentEvents: row.recentEvents || '',
                updatedAtChapter: chapterNumber,
              }
            })
          }
          if (newCharCount > 0) {
            callbacks.log(t('log.finalize.newChars').replace('{count}', String(newCharCount)))
          }
        }
      },
    })
  }

  // ─── 步骤 3.8: 关系自动检测 ────────────────────────────────────────
  steps.push({
    key: 'relation_detect',
    label: t('workflow.relationDetect'),
    critical: false,
    dependsOn: ['character_cards'],
    executor: async (callbacks: StepCallbacks) => {
      callbacks.log(t('log.finalize.detectingRelations'))
      try {
        const allChars = await ipc.invoke('db:character-get-all') as CharacterData[]
        let detected = 0

        // P1-6：只对 active 角色做关系检测与出场统计——dead/departed 退出候选，
        // 角色库"只增不减"时关系检测 O(C²) 不再随死亡角色膨胀
        const activeChars = allChars.filter(c => (c.status ?? 'active') === 'active')

        // ⚠️ 性能优化：预扫描正文一次建立角色名位置索引（O(N + C×M)），
        //    角色对检查走双指针最小间距（O(C²)）——原实现每对做两次全文 indexOf 为 O(C² × N)，
        //    且仅比较首出现位置（正文多处同现时可能漏判）
        const namePositions = buildNamePositions(
          draftContent,
          activeChars.map(c => c.name).filter((n): n is string => Boolean(n)),
        )

        for (const char of activeChars) {
          if (!char.name) continue
          let rels: Array<{ target: string; type: string; label: string; sinceChapter: number }> = []
          try { rels = JSON.parse(char.relations || '[]') } catch { rels = [] }

          // 更新出场章节
          let chaps: number[] = []
          try { chaps = JSON.parse(char.appearChapters || '[]') } catch { chaps = [] }
          // ⚠️ P0 修复：chapsChanged 必须先记录再 push——此前 `chaps.includes()` 在 push 后恒 true，
          //    导致每个角色每次定稿都触发 upsert（连同 detected 循环外累计，一个角色有变化全量角色被写）
          const chapsChanged = !chaps.includes(chapterNumber)
          if (chapsChanged) {
            chaps.push(chapterNumber)
            chaps.sort((a: number, b: number) => a - b)
          }

          // P1-6：出场统计（仅正文中出现时更新；首章未记录时登记 firstChapter）
          const appearsHere = (namePositions.get(char.name) ?? []).length > 0
          const appearCount = (char.appearCount ?? 0) + (appearsHere ? 1 : 0)
          const firstChapter = appearsHere && !(char.firstChapter ?? 0) ? chapterNumber : (char.firstChapter ?? 0)
          const lastChapter = appearsHere ? chapterNumber : (char.lastChapter ?? 0)

          // 检测新关系：在正文中查找 "角色名：关系描述" 或 "与XXX的关系"
          // P1-5：纯共现（500 字内同场出现）不再直接建关系——群像戏会生成大量
          // 无意义 'other' 关系；要求 100 字内直接接触 或 区间内有对话标记（引号/说/道）
          let detectedForChar = 0
          for (const other of activeChars) {
            if (other.name === char.name) continue
            const alreadyRelated = rels.some(r => r.target === other.name)
            if (alreadyRelated) continue

            const posA = namePositions.get(char.name) ?? []
            const posB = namePositions.get(other.name) ?? []
            // 外层窗口仍为 500 字（同场），互动判定收紧：
            // 最小间距 < 100（直接接触）或 最小间距区间内有对话标记
            if (hasProximity(posA, posB, 500)) {
              const pair = closestNamePair(posA, posB)
              if (!pair) continue
              const minPos = Math.min(pair[0], pair[1])
              const maxPos = Math.max(pair[0], pair[1])
              const gap = maxPos - minPos
              const interactive = gap < 100 || hasDialogueMarker(draftContent, minPos, maxPos)
              if (!interactive) continue
              rels.push({
                target: other.name,
                type: 'other',
                label: t('workflow.chapterInteraction').replace('{n}', String(chapterNumber)),
                sinceChapter: chapterNumber,
              })
              detectedForChar++
            }
          }
          detected += detectedForChar

          // 仅在确有变更时 upsert；**全量回填所有字段**——此前 payload 只带 7 个字段，
          // 仓库 upsert 是全列覆盖 → gender/age/appearance/.../notes（含 [VOICE:] 块）/currentState 全被清空
          if (chapsChanged || detectedForChar > 0) {
            await ipc.invoke('db:character-upsert', {
              ...char,
              name: char.name,
              role: String(char.role || 'supporting'),
              tier: Number(char.tier ?? 2),
              tags: String(char.tags || ''),
              appearChapters: JSON.stringify(chaps),
              relations: JSON.stringify(rels),
              appearCount,
              firstChapter,
              lastChapter,
            })
          }
        }
        if (detected > 0) callbacks.log(t('log.finalize.relationsDetected').replace('{count}', String(detected)))
        else callbacks.log(t('log.finalize.noRelations'))
      } catch (e) {
        callbacks.log(t('log.finalize.relationDetectFailed').replace('{error}', () => String(e)))
      }
    },
  })

  // ─── 步骤 4: 文风自动学习（每5章触发一次）─────────────────────────
  if (chapterNumber % 5 === 0) {
    steps.push({
      key: 'style_analysis',
      label: t('workflow.styleLearning'),
      critical: false,
      dependsOn: ['kb_import'],
      executor: async (callbacks) => {
        callbacks.log(t('log.finalize.styleLearning'))
        const { AnalyzeWritingStyleCommand } = await import('./analyze-style.command')
        await new AnalyzeWritingStyleCommand().execute({
          step: { id: '', name: '', description: '', status: 'pending' as const, logs: [] },
          context: { data: {}, cancelled: false },
          callbacks,
        })
        callbacks.log(t('log.finalize.styleDone'))
      },
    })
  }

  // 步骤 3.2: 伏笔扫描
  const voiceIdx = steps.length - (chapterNumber % 5 === 0 ? 2 : 1)
  steps.splice(voiceIdx, 0, {
    key: 'foreshadowing_scan',
    label: t('workflow.foreshadowScan'),
    critical: false,
    dependsOn: ['kb_import'],
    executor: async (callbacks: StepCallbacks) => {
      try {
        const { scanNewForeshadowing, detectResolvedForeshadowing, loadAllForeshadowing, saveForeshadowing } = await import('../../foreshadowing-manager')
        const all = await loadAllForeshadowing()
        const news = scanNewForeshadowing(draftContent, chapterNumber)
        const done = detectResolvedForeshadowing(draftContent, all, chapterNumber)
        const merged = [...all.filter(i => !done.some(d => d.id === i.id)), ...news]
        await saveForeshadowing(merged)
        if (news.length) callbacks.log(t('log.finalize.foreshadow').replace('{added}', String(news.length)).replace('{resolved}', String(done.length)))
      } catch (e) { callbacks.log(t('log.finalize.foreshadowFailed').replace('{error}', () => String(e))) }
    },
  })

  // ─── 步骤 5: 正文质量审计（重复词/衔接/术语/蓝图完成度/违禁词/时间线）──
  // 全部非关键：审计发现问题不影响定稿，日志提示可触发修稿
  steps.push({
    key: 'content_audit',
    label: t('workflow.contentAudit'),
    critical: false,
    dependsOn: ['kb_import'],
    executor: async (callbacks: StepCallbacks) => {
      // ===== 审计上下文（跨章基线/细纲锚点/豁免词/白名单）——与终审自省共用收集 =====
      const { collectAuditContext, auditText } = await import('../../audit/audit-context')
      const ctx = await collectAuditContext(chapterNumber)
      const result = auditText(ctx, draftContent)

      if (result.passed) {
        callbacks.log(`✅ ${result.summary}`)
      } else {
        for (const issue of result.issues) {
          callbacks.log(`⚠️ [${issue.kind}] ${issue.message}`)
        }
        callbacks.log(t('log.finalize.auditSummary').replace('{summary}', result.summary))
      }
    },
  })

  // ─── 步骤: 章节记忆摘要（P1 作品记忆——非关键：失败不影响定稿） ──────
  steps.push({
    key: 'chapter_memory',
    label: t('workflow.chapterMemory'),
    critical: false,
    dependsOn: ['kb_import'],
    executor: async (callbacks: StepCallbacks) => {
      try {
        const { generateChapterSummary, computeMemoryFileRange, upsertChapterMemory, ensureVolumeSummary } = await import('../../memory/chapter-memory')
        const volumes = (await ipc.invoke('db:volume-get-all')) as { volumeNumber: number; title: string; chapterStart: number; chapterEnd: number }[]
        const { file } = computeMemoryFileRange(chapterNumber, volumes)
        const modelId = useLLMStore.getState().defaultModelId ?? ''
        const entry = await generateChapterSummary({ chapterNumber, chapterTitle, draftContent, modelId })
        const result = await upsertChapterMemory(entry, file)
        if (result.success) {
          callbacks.log(t('log.finalize.memoryDone').replace('{file}', file))
          // 卷级聚合：upsert 成功后检查所在卷（已闭合卷且卷内章节条目完整 → 生成 volume-NNN.md；否则静默跳过）
          const vol = volumes.find(v => entry.chapterNumber >= v.chapterStart && (v.chapterEnd === 0 || entry.chapterNumber <= v.chapterEnd))
          if (vol) await ensureVolumeSummary(vol, file)
        } else {
          callbacks.log(t('log.finalize.memoryFailed'))
        }
      } catch (e) {
        callbacks.log(t('log.finalize.memoryFailed').replace('{error}', () => String(e)))
      }
    },
  })

  // 步骤 3.5: 角色声音分析
  steps.splice(voiceIdx + 1, 0, {
    key: 'voice_analysis',
    label: t('workflow.voiceAnalysis'),
    critical: false,
    dependsOn: ['kb_import'],
    executor: async (callbacks: StepCallbacks) => {
      callbacks.log(t('log.finalize.analyzingVoice'))
      try {
        const { analyzeCharacterVoice, upsertVoiceProfile } = await import('../../character-voice-analyzer')
        const characters = await ipc.invoke('db:character-get-all') as CharacterData[]
        let analyzed = 0
        for (const char of characters) {
          if (!char.name) continue
          try {
            // ⚠️ P0 修复：get-all 返回全列（含 currentState/tier/tags/appearChapters/relations），
            //    upsert 用 ...existing 全量回填——此前只带 12 个字段，仓库 upsert 全列覆盖
            //    把 v7 元数据与动态状态（cs_*）全部清空（注释声称"防止覆写"实际正是覆写）
            const existing = char
            const profile = analyzeCharacterVoice(draftContent, char.name)
            if (profile.topWords.length > 0) {
              // upsert：剥离旧 VOICE 块 → 合并新旧档案 → 单块写回（防止 notes 膨胀 + 读端取到旧档案）
              const updatedNotes = upsertVoiceProfile(existing.notes || '', profile)
              await ipc.invoke('db:character-upsert', {
                ...existing,
                name: existing.name,
                role: existing.role || 'supporting',
                notes: updatedNotes,
              } as never)
              analyzed++
            }
          } catch { /* skip */ }
        }
        callbacks.log(t('log.finalize.voiceDone').replace('{done}', String(analyzed)).replace('{total}', String(characters.length)))
      } catch (e) {
        callbacks.log(t('log.finalize.voiceFailed').replace('{error}', () => String(e)))
      }
    },
  })

  return steps
}

// ===== 定稿命令 =====

export class FinalizeChapterCommand extends BaseWorkflowCommand<void> {
  constructor(private params: FinalizeChapterParams) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<void> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('error.noProject'))

    const refinedDraftText = this.params.draftContent
    if (!refinedDraftText) throw new Error(t('error.noFinalizedContent'))

    callbacks.log(t('log.finalize.start'))

    // 1. 获取对应草稿并将库内状态变更为 finalized（同时同步定稿期可能微调过的正文）
    const { parseDraftMeta } = await import('../chapter-workflow')
    const dbDraft = await parseDraftMeta(this.params.draftPath)
    if (!dbDraft) throw new Error(t('error.draftStateFlow'))

    // wordCount 用统一"有效字数"口径（汉字 + 英文单词）
    const novelWordCount = computeTextStats(refinedDraftText).novelWordCount
    await ipc.invoke('db:draft-update-content', dbDraft.id, refinedDraftText, novelWordCount)
    await ipc.invoke('db:draft-update-status', dbDraft.id, 'finalized', novelWordCount)

    // 【重要】：除了写入 DB，对于已定稿的章节需要实体化为物理文件放在根目录，供外部系统读取或备份
    const safeTitle = this.params.chapterInfo.title ? ` ${this.params.chapterInfo.title.replace(/[/\\]/g, '_')}` : ''
    const physicalPath = `${project.path}/${t('inject.chapterFileName')
      .replace('{chapter}', String(this.params.chapterNumber))
      .replace('{title}', () => safeTitle)}`
    try {
      const titleLine = this.params.chapterInfo.title
        ? t('inject.chapterTitleLineWithTitle')
          .replace('{chapter}', String(this.params.chapterNumber))
          .replace('{title}', () => this.params.chapterInfo.title)
        : t('inject.chapterTitleLineNoTitle').replace('{chapter}', String(this.params.chapterNumber))
      const contentToWrite = titleLine + refinedDraftText.replace(/^#+ .*\n*/, '')
      await ipc.invoke('fs:write-file', physicalPath, contentToWrite)
    } catch (e) {
      callbacks.log(t('log.finalize.fileWriteFailed').replace('{error}', () => String(e)))
    }

    callbacks.log(t('log.finalize.written')
      .replace('{chapter}', String(this.params.chapterNumber))
      .replace('{title}', safeTitle))

    // 3. 通过 PostProcessPipeline 执行后处理（状态持久化 + 支持重试）
    callbacks.log(t('log.finalize.startingPostProcess'))

    const scope = getChapterFinalizeScope(this.params.chapterNumber)
    const sourceLabel = t('inject.finalize.sourceLabel').replace('{chapter}', String(this.params.chapterNumber))
    const steps = buildFinalizePostProcessSteps(
      project,
      this.params.chapterNumber,
      this.params.chapterInfo.title,
      refinedDraftText,
    )

    await runPostProcessPipeline(project.path, scope, sourceLabel, steps, callbacks)

    callbacks.log(t('log.finalize.allDone').replace('{chapter}', String(this.params.chapterNumber)))
    useProjectStore.getState().refreshFileTree()

    // 通过 EventBus 通知 ProjectService 执行定稿后的统一刷新
    const { globalEventBus } = await import('../../../shared/event-bus')
    globalEventBus.emit('FINALIZE_COMPLETE', { chapterNumber: this.params.chapterNumber })
  }
}