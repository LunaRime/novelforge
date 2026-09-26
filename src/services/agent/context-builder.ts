/**
 * Agent 智能上下文构建器
 *
 * 采用三级注入策略 + Token 预算管理：
 * - L0 始终注入（~800 token 预算）：项目名称/类型/进度/一句话大纲
 * - L1 编辑器感知（~600 token 预算）：当前打开的 Tab 信息
 * - L2 按需获取：通过 Tool 调用获取详细数据
 *
 * 系统提示词上限：非常驻部分 ~4700 tokens（设计 §4.3：身份/L0/L1/Tool + 名字目录 800 + M1 300）
 * + 常驻记忆段按其自身硬上限另计（C 档第一轮，见 assembleFinalPrompt 注释）。
 */

import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useAgentStore, type AgentMode } from '../../stores/agent-store'
import { t, getCurrentLocale } from '../../shared/locale'
import { appendOutputLanguage } from '../prompt-templates'
import { ipc } from '../ipc-client'
import { parseMemoryFile } from '../memory/memory-codec'
import type { MemoryFileMeta } from '../memory/memory-codec'
import { normalizeLoadMode } from '../../shared/memory-types'
import {
  buildManualMentionSection, buildMemoryCatalog, buildResidentSection, matchMentionedManuals, residentEntries,
  MANUAL_MENTION_BUDGET_TOKENS, RESIDENT_MEMORY_BUDGET_TOKENS, RESIDENT_MEMORY_WARN_TOKENS,
  type MemoryLayerEntry,
} from './memory-layers'
import { toolRegistry } from './tool-registry'
import { skillRegistry, sortSkillsBySource } from './skill-registry'
import type { ContextSegment } from './context-usage'
import { estimateTokens, truncateToTokenBudget } from './token-budget'

/**
 * 系统提示词**非常驻部分**总上限（设计 §4.3：身份/L0/L1/Tool ~3000 + 名字目录 ≤800 + M1 300 ≈ 4700）。
 * C 档第一轮起常驻记忆段另计（最终上限 = 本值 + 常驻段实际 tokens）——常驻有自身硬上限
 * （RESIDENT_MEMORY_BUDGET_TOKENS），若并入本值会让它一超 ~1300 tokens 就在降级链里被整段丢弃。
 */
const TOTAL_BUDGET_TOKENS = 4700

// ===== 上下文构建 =====

/**
 * 构建 Agent 系统提示词（含上下文和 Tool 描述）
 *
 * 所有部分都受 Token 预算约束。
 */
/**
 * 构建 Agent 系统提示词分段：
 * - base：身份 + L0 + L1 + Tool（稳定内容前置，缓存友好段）
 * - memory：M1 会话摘要（自动生成标注节，预算 300 tokens）+ 可扩展 M2 作品记忆（P1）
 * 语言指令由 buildAgentSystemPrompt 统一追加（保持最末尾，#30）
 */
/** 技能目录段预算（独立于工具提示词的 1200 —— 它很小，且是模型发现技能的唯一途径） */
const SKILL_CATALOG_BUDGET_TOKENS = 400
/** 目录单行的字符上限：导入技能的 description 可能是整段话，截断以免独占整段预算 */
const SKILL_LINE_MAX_CHARS = 120

/**
 * 技能目录段：每技能一行（名字 + 一句话描述），超预算按行截断并提示剩余数量。
 * `userInvocable` 不参与过滤 —— 该字段只约束 `/命令`，不约束模型。
 */
function buildSkillCatalogSnippet(): string {
  const skills = sortSkillsBySource(skillRegistry.listAll())
  if (skills.length === 0) return ''
  const header = t('agent.skillCatalogHeader')
  const lines: string[] = []
  let used = estimateTokens(header)
  let omitted = 0
  for (const skill of skills) {
    const raw = `- ${skill.metadata.displayName ?? skill.metadata.name}（${skill.metadata.name}）：${skill.metadata.description}`
    // 单行过长（导入技能的 description 常是整段话）→ 截断该行；**跳过而不是中断**，
    // 否则它一条就能吃光预算、让排在后面的正常技能全部消失（评审 I2）
    const line = raw.length > SKILL_LINE_MAX_CHARS ? `${raw.slice(0, SKILL_LINE_MAX_CHARS)}…` : raw
    const cost = estimateTokens(line)
    if (used + cost > SKILL_CATALOG_BUDGET_TOKENS) {
      omitted++
      continue
    }
    lines.push(line)
    used += cost
  }
  // 保底：预算极紧时至少显示一行（模型至少要能发现"有技能可用"）
  if (lines.length === 0 && skills.length > 0) {
    const first = skills[0]
    lines.push(`- ${first.metadata.displayName ?? first.metadata.name}（${first.metadata.name}）`)
    omitted = skills.length - 1
  }
  const suffix = omitted > 0 ? `\n${t('agent.skillCatalogOmitted').replace('{n}', String(omitted))}` : ''
  return `${header}\n${lines.join('\n')}${suffix}`
}

export function buildAgentSystemSegments(mode: AgentMode): { base: string; memory: string; segments: ContextSegment[] } {
  const sections: string[] = []
  // B 档第二轮 B6：逐段明细（tokens + 字符数 + 来源 + 截断标记），供 context 明细面板展示
  const segments: ContextSegment[] = []
  const push = (key: string, text: string | null | undefined, source?: string, truncated?: boolean): void => {
    if (!text) return
    sections.push(text)
    segments.push({ key, tokens: estimateTokens(text), chars: text.length, source, truncated })
  }

  // 1. Agent 身份与行为指导 (~400 tokens)
  push('identity', buildIdentityPrompt(mode))

  // 2. L0 — 始终注入的项目上下文 (~800 tokens 预算)
  push('l0', buildL0ProjectContext(), t('context.segSourceL0'))

  // 3. L1 — 编辑器感知上下文 (~600 tokens 预算)
  push('l1', buildL1EditorContext(), t('context.segSourceL1'))

  // 4. Tool 系统提示词 (~1200 tokens 预算)
  const toolPrompt = toolRegistry.generateToolPrompt()
  if (toolPrompt) {
    const truncated = truncateToTokenBudget(toolPrompt, 1200)
    const isTruncated = truncated.length < toolPrompt.length
    push(
      'tools',
      isTruncated
        // 截断通知带**签名**（`name(p1?, p2?)`）而不只是名字：实测 30 个工具时提示词共 5435 tokens、
        // 1200 的截断落在第 2 个工具内部 —— 仅列名字等于让被截断的工具**无法被调用**
        // （模型知道有 read_memory，却不知道参数叫 name/keyword/type）。签名全长 ~240 tokens，
        // 换来全部工具可调用（C 档第一轮 T4 实测发现）。
        ? `${truncated}\n\n${t('engine.toolTruncatedNotice').replace('{tools}', toolRegistry.listAll().map(tool => {
          const required = tool.inputSchema.required ?? []
          const params = Object.keys(tool.inputSchema.properties)
            .map(p => (required.includes(p) ? p : `${p}?`))
          return params.length > 0 ? `${tool.name}(${params.join(', ')})` : tool.name
        }).join('、'))}`
        : truncated,
      t('context.segSourceTools').replace('{n}', String(toolRegistry.listAll().length)),
      isTruncated,
    )
  }

  // 5. 技能目录（B 档第一轮）：独立成段、独立预算 —— 模型发现技能的**唯一途径**。
  //    此前技能以 `skill__<name>` 工具形式排在工具清单末尾，而工具提示词有 1200 token 截断
  //    → 先被砍掉的正是技能，模型只能看到一份名字清单。目录只放名字与一句话描述，
  //    全文由 skill 元工具按名加载（懒加载）。
  push('skill-catalog', buildSkillCatalogSnippet(), t('context.segSourceSkills').replace('{n}', String(skillRegistry.listAll().length)))

  const base = sections.join('\n\n---\n\n')

  // ===== M1 会话摘要节（CCR 滚动摘要，自动生成非用户输入；M2 作品记忆 P1 追加于此） =====
  const memoryParts: string[] = []
  const activeConv = useAgentStore.getState().getActiveConversation()
  const summary = activeConv?.rollingSummary
  // B7 失效语义：历史已变动（rewind/恢复原文/编辑消息）时，旧摘要与当前历史不符 ——
  // 宁可不注入，也不能让模型拿着过期摘要当事实
  if (summary && !activeConv?.rollingSummaryInvalidated) {
    const m1 = `${t('ccr.conversationSummaryHeader')}\n${t('ccr.autoGeneratedNotice')}\n\n${truncateToTokenBudget(summary, 300)}`
    memoryParts.push(m1)
    segments.push({
      key: 'memory-m1',
      tokens: estimateTokens(m1),
      chars: m1.length,
      source: t('context.segSourceM1'),
    })
  }
  return { base, memory: memoryParts.join('\n\n---\n\n'), segments }
}

/** 兼容入口（M1 only，同步）：base + memory + 语言指令（语言指令保持最末尾，优先于一切） */
export function buildAgentSystemPrompt(mode: AgentMode): string {
  const segments = buildAgentSystemSegments(mode)
  return assembleFinalPrompt({ base: segments.base, memoryM1: segments.memory, memoryM2: '' })
}

/**
 * 最终拼装（同步/异步共用）：base + M2 + M1 + 语言指令（语言指令保持最末尾）。
 * 段序：base → M2 作品记忆 → M1 会话摘要（M2 比 M1 稳定，前缀缓存友好，设计 §3）；
 * 超限降级顺序 M1 → M2 → L1 → Tool（设计 §4.3，reviewer F1：此前 3800 上限把 M1+M2 整段一起丢）。
 * 导出供单测直接验证降级顺序（合成超限输入）。
 */
export function assembleFinalPrompt(segments: {
  base: string
  memoryM1: string
  memoryM2: string
  memoryResident?: string
  memoryManual?: string
}): string {
  const join = (xs: Array<string | undefined>) => xs.filter((x): x is string => Boolean(x)).join('\n\n---\n\n')
  // 索引：0=base，1=memoryResident，2=M2，3=M1，4=memoryManual
  // （manual 放最末：它是**本轮**才有的易变内容，放末尾可最大化稳定前缀的缓存命中）
  const resident = segments.memoryResident ?? ''
  const manual = segments.memoryManual ?? ''
  const parts: Array<string | undefined> = [segments.base, resident, segments.memoryM2, segments.memoryM1, manual]
  const full = join(parts)
  // C 档第一轮修正 1（+ 评审 I1）：常驻段与 manual 段各有**独立预算**（各自的硬上限，
  // 超限整段丢弃而非截断）。若把它们算进 4700，常驻一超 ~1300 tokens 就会在降级链里被整段
  // 丢掉——硬上限永远够不到，用户设了常驻/明确 @ 了文件却什么都看不到且无提示。
  // 故最终上限 = 4700 + 常驻实际 tokens + manual 实际 tokens。
  const budget = TOTAL_BUDGET_TOKENS + estimateTokens(resident) + estimateTokens(manual)

  if (estimateTokens(full) <= budget) {
    return appendOutputLanguage(full, getCurrentLocale())
  }

  console.warn(`[ContextBuilder] 系统提示词过大 (${estimateTokens(full)} tokens)，按 M1 → M2 → L1 → Tool 顺序降级`)
  // 语言指令后缀（#30：必须保持最末尾；各步预算预留其 token 数）
  const langSuffix = appendOutputLanguage('', getCurrentLocale())
  const langTokens = estimateTokens(langSuffix)
  // 1. 先丢 M1 会话摘要段（压缩滚动摘要，非创作必需）
  parts[3] = undefined
  // 2. 仍超限丢 M2 作品记忆段（名字目录；常驻段 parts[1] / manual 段 parts[4] 不参与降级）
  if (estimateTokens(join(parts)) > budget) {
    if (parts[2]) console.warn('[ContextBuilder] 降级：名字目录段（memory-catalog）被丢弃')
    parts[2] = undefined
  }
  // 3. base 拆回节数组（拼接分隔符 '\n\n---\n\n'），按标题定位裁剪 L1
  const baseSections = (parts[0] ?? '').split('\n\n---\n\n')
  const l1Index = baseSections.findIndex(s => s.startsWith(t('engine.contextEditorHeader')))
  if (l1Index >= 0) {
    baseSections[l1Index] = `${t('engine.contextEditorHeader')}\n${t('engine.contextEditorOmitted')}`
  }
  // 4. 仍超限则裁剪 Tool 至剩余预算（剩余 = 上限 − 语言指令 − 其他节 − 截断提示），保证最终 ≤ 上限
  const marker = `\n\n…${t('engine.toolListTruncated')}`
  const markerTokens = estimateTokens(marker)
  const toolIndex = baseSections.findIndex(s => s.startsWith(t('engine.toolSystemTitle')))
  let toolMarked = false
  if (toolIndex >= 0) {
    const othersTokens = estimateTokens(baseSections.filter((_, i) => i !== toolIndex).join('\n\n---\n\n'))
    const memoryTokens = estimateTokens(join(parts.slice(1)))
    const toolBudget = budget - langTokens - othersTokens - memoryTokens - markerTokens
    if (toolBudget > 0 && estimateTokens(baseSections[toolIndex]) > toolBudget) {
      baseSections[toolIndex] = truncateToTokenBudget(baseSections[toolIndex], toolBudget) + marker
      toolMarked = true
    }
  }
  // 5. 兜底硬截断（各节独立预算下理论不可达）：主体按预算截断，语言指令保持最末尾（#30）。
  //    预算预留截断提示 token——tokenizer 分段拼接非可加，硬截断可能切掉尾部提示，补回保持语义不变量
  const main = join([baseSections.join('\n\n---\n\n'), parts[1], parts[2], parts[3], parts[4]])
  const mainBudget = budget - langTokens - (toolMarked ? markerTokens : 0)
  if (estimateTokens(main) > mainBudget) {
    const cut = truncateToTokenBudget(main, mainBudget)
    const suffix = (toolMarked && !cut.includes(marker) ? marker : '') + langSuffix
    return cut + suffix
  }
  return appendOutputLanguage(main, getCurrentLocale())
}

/** 异步装配结果（C 档第一轮）：常驻段独立成段，明细段供 context 面板，M1/M2 保持既有降级语义 */
export interface AgentSystemSegmentsAsync {
  base: string
  /** 常驻记忆段（全文，独立预算，不进 4700 降级链） */
  memoryResident: string
  /** 本轮 @ 显式引用的 manual 正文段（独立预算，不进 4700 降级链） */
  memoryManual: string
  /** 名字目录 + 本轮显式引用的 manual 正文 */
  memoryM2: string
  memoryM1: string
  segments: ContextSegment[]
}

/**
 * 异步版：base + M1（同步段）+ 记忆分层两段（常驻 / 目录）。
 * `userMessage` 用于 manual 的**硬门控**判定（@文件名）——只影响本轮 system 段，
 * 不进会话历史，故后续轮次不会继承（每次 sendMessage 都重新装配）。
 * 记忆读盘失败降级：base + M1 照常，不阻断对话。
 */
export async function buildAgentSystemSegmentsAsync(mode: AgentMode, userMessage = ''): Promise<AgentSystemSegmentsAsync> {
  const { base, memory: m1, segments } = buildAgentSystemSegments(mode)
  let residentText = ''
  let manualText = ''
  let m2 = ''
  try {
    const list = (await ipc.invoke('memory:list')) as MemoryFileMeta[]
    // stale 先行过滤（与既有口径一致）；F9 白名单保留——但**用户显式声明 resident 时尊重其选择**
    const entries: MemoryLayerEntry[] = list
      .filter(f => !f.stale)
      .filter(f => f.kind !== 'unknown' || normalizeLoadMode(f.loadMode) === 'resident')
      .map(f => ({
        file: f.file, kind: f.kind, loadMode: normalizeLoadMode(f.loadMode), brief: f.brief ?? '', range: f.range,
      }))

    // ===== 段 1：常驻记忆（全文，独立预算）=====
    const residents = residentEntries(entries)
    if (residents.length > 0) {
      const contents: Array<{ file: string; body: string }> = []
      for (const e of residents) {
        const raw = await ipc.invoke('memory:read', e.file) as string | null
        if (!raw) continue // 读失败/已被删除：跳过该条，不阻断其余条目
        contents.push({ file: e.file, body: (parseMemoryFile(raw) ?? { body: raw }).body })
      }
      const built = buildResidentSection(contents)
      const files = contents.map(c => c.file).join(', ')
      if (built.overCap) {
        console.warn(`[ContextBuilder] 常驻记忆 ${built.tokens} tokens 超过上限 ${RESIDENT_MEMORY_BUDGET_TOKENS}，本轮未注入`)
        segments.push({
          key: 'memory-resident', tokens: 0, chars: 0,
          warning: t('memory.residentOverCap')
            .replace('{tokens}', String(built.tokens))
            .replace('{cap}', String(RESIDENT_MEMORY_BUDGET_TOKENS)),
        })
      } else if (built.text) {
        residentText = built.text
        segments.push({
          key: 'memory-resident', tokens: built.tokens, chars: built.text.length,
          source: t('context.segSourceResident').replace('{files}', files),
          warning: built.tokens > RESIDENT_MEMORY_WARN_TOKENS
            ? t('memory.residentNearLimit')
              .replace('{tokens}', String(built.tokens))
              .replace('{cap}', String(RESIDENT_MEMORY_BUDGET_TOKENS))
            : undefined,
        })
      }
    }

    // ===== 段 2：名字目录（三级降级）+ 本轮 @ 提及的 manual 正文 =====
    const parts: string[] = []
    const catalog = buildMemoryCatalog(entries)
    if (catalog.text) {
      parts.push(catalog.text)
      segments.push({
        key: 'memory-catalog', tokens: estimateTokens(catalog.text), chars: catalog.text.length,
        // 评审 Minor 7：如实报数——被挤出时给「已列/总数」，不拿总数冒充已列数
        source: t('context.segSourceCatalog').replace('{n}', catalog.omitted > 0
          ? `${catalog.listed}/${catalog.listed + catalog.omitted}`
          : String(catalog.listed)),
      })
    }
    const bodies: Array<{ file: string; body: string }> = []
    for (const file of matchMentionedManuals(userMessage, entries)) {
      const raw = await ipc.invoke('memory:read', file) as string | null
      if (!raw) continue
      bodies.push({ file, body: (parseMemoryFile(raw) ?? { body: raw }).body })
    }
    if (bodies.length > 0) {
      // 评审 I1：manual 正文有**独立预算**（同常驻段口径）——否则长书里 @ 两个大文件就能
      // 把 M2 顶过 4700，降级链会把「本轮显式引用的正文 + 名字目录」整段丢掉且无留痕
      const manual = buildManualMentionSection(bodies)
      const files = bodies.map(b => b.file).join(', ')
      if (manual.overCap) {
        console.warn(`[ContextBuilder] 本轮 @ 引用的记忆 ${manual.tokens} tokens 超过上限 ${MANUAL_MENTION_BUDGET_TOKENS}，正文未注入`)
        segments.push({
          key: 'memory-manual', tokens: 0, chars: 0,
          source: files,
          warning: t('memory.manualOverCap')
            .replace('{tokens}', String(manual.tokens))
            .replace('{cap}', String(MANUAL_MENTION_BUDGET_TOKENS)),
        })
      } else {
        manualText = manual.text
        // source 用文件名（明细面板悬停可查"这段来自哪"）；段标签由 context.seg.memory-manual 提供
        segments.push({
          key: 'memory-manual', tokens: manual.tokens, chars: manual.text.length, source: files,
        })
      }
    }
    if (parts.length > 0) m2 = `${t('memory.injectedHeader')}\n\n${parts.join('\n\n')}`
  } catch {
    // 记忆读盘失败降级：base + M1 照常
  }
  return { base, memoryResident: residentText, memoryManual: manualText, memoryM2: m2, memoryM1: m1, segments }
}

/** 异步版最终拼装：base + 常驻段 + M2 + M1 + manual 段 + 语言指令（语言指令保持最末尾） */
export async function buildAgentSystemPromptAsync(mode: AgentMode, userMessage = ''): Promise<string> {
  const s = await buildAgentSystemSegmentsAsync(mode, userMessage)
  return assembleFinalPrompt({
    base: s.base, memoryM1: s.memoryM1, memoryM2: s.memoryM2,
    memoryResident: s.memoryResident, memoryManual: s.memoryManual,
  })
}

// ===== 内部构建方法 =====

/** Agent 身份提示词 */
function buildIdentityPrompt(mode: AgentMode): string {
  const modeDesc = mode === 'max'
    ? t('engine.modeMax')
    : mode === 'deep'
      ? t('engine.modeDeep')
      : mode === 'reflective'
        ? t('engine.modeReflective')
        : mode === 'balanced'
          ? t('engine.modeBalanced')
          : mode === 'swift'
            ? t('engine.modeSwift')
            : t('engine.modeQuick')

  return `${t('engine.identityTitle')}

${t('engine.identityIntro')}

${modeDesc}

${t('engine.identityCapabilitiesHeader')}
${t('engine.identityCapabilityArchitecture')}
${t('engine.identityCapabilityTools')}
${t('engine.identityCapabilityWorkflows')}
${t('engine.identityCapabilityRag')}

${t('engine.identityRulesHeader')}
${t('engine.identityRuleLanguage')}
${t('engine.identityRuleProfessional')}
${t('engine.identityRuleUseTools')}
${t('engine.identityRuleExplainWriteOps')}
${t('engine.identityRuleMultiStep')}`
}

/**
 * L0 — 始终注入的项目上下文
 * Token 预算：~800 tokens
 */
function buildL0ProjectContext(): string | null {
  const project = useProjectStore.getState().currentProject
  if (!project) return null

  // 旧项目数据库可能缺 novelConfig（类型上非可选），运行时兜底避免崩溃
  const cfg = project.novelConfig ?? {}
  const parts: string[] = [
    t('engine.contextProjectHeader'),
    t('engine.contextProjectName').replace('{name}', project.name),
  ]

  if (cfg.genre) {
    parts.push(`${t('engine.contextGenre').replace('{genre}', cfg.genre)}${cfg.subGenre ? ' · ' + cfg.subGenre : ''}`)
  }
  if (cfg.targetAudience) {
    parts.push(t('engine.contextTargetAudience').replace('{audience}', cfg.targetAudience))
  }
  if (cfg.totalChapters) {
    parts.push(t('engine.contextTotalChapters').replace('{n}', String(cfg.totalChapters)))
  }
  if (cfg.wordsPerChapter) {
    parts.push(t('engine.contextWordsPerChapter').replace('{n}', String(cfg.wordsPerChapter)))
  }
  if (cfg.narrativePOV) {
    const povMap: Record<string, string> = {
      'third_limited': t('engine.povThirdLimited'),
      'first_person': t('engine.povFirstPerson'),
      'third_omniscient': t('engine.povThirdOmniscient'),
      'multi_pov': t('engine.povMulti'),
    }
    parts.push(t('engine.contextPov').replace('{pov}', povMap[cfg.narrativePOV] ?? cfg.narrativePOV))
  }
  if (cfg.coreOutline) {
    // Token 感知截断（~80 tokens 预算）
    const { text, truncated } = applyTokenTruncation(cfg.coreOutline, 80)
    parts.push(`${t('engine.contextCoreOutline').replace('{text}', text)}${truncated ? t('engine.truncatedHint') : ''}`)
  }
  if (cfg.writingStyle) {
    // Token 感知截断（~40 tokens 预算）
    const { text, truncated } = applyTokenTruncation(cfg.writingStyle, 40)
    parts.push(`${t('engine.contextWritingStyle').replace('{text}', text)}${truncated ? t('engine.truncatedHint') : ''}`)
  }

  // 检查 L0 总预算
  const full = parts.join('\n')
  if (estimateTokens(full) > 800) {
    // 裁剪大纲和风格部分（⚠️ 低风险修复：追加截断提示——模型曾把截断后的配置当完整内容回答）
    const trimmed = truncateToTokenBudget(full, 800)
    return trimmed + t('engine.truncatedHint')
  }

  return full
}

/**
 * L1 — 编辑器感知上下文
 * Token 预算：~600 tokens
 */
function buildL1EditorContext(): string | null {
  const parts: string[] = []

  // 当前打开的编辑器 Tab
  const editorState = useEditorStore.getState()
  if (editorState.tabs.length > 0) {
    const activeTab = editorState.tabs.find(tab => tab.id === editorState.activeTabId)
    const tabSummaries = editorState.tabs.slice(0, 5).map(tab => {
      const active = tab.id === editorState.activeTabId ? t('engine.contextTabActive') : ''
      const dirty = tab.dirty ? t('engine.contextTabDirty') : ''
      return `  - ${tab.name} (${tab.type})${active}${dirty}`
    }).join('\n')

    let tabSection = `${t('engine.contextEditorHeader')}\n${t('engine.contextEditorOpenFiles')}\n${tabSummaries}`
    if (editorState.tabs.length > 5) {
      tabSection += `\n  …${t('engine.contextTabsMore').replace('{n}', String(editorState.tabs.length))}`
    }
    parts.push(tabSection)

    // 如果当前活跃 Tab 有内容且不太长，注入内容摘要
    if (activeTab?.content && activeTab.content.length > 0) {
      // Token 感知截断（~120 tokens 预算）
      const { text, truncated } = applyTokenTruncation(activeTab.content, 120)
      const fileHeader = `${t('engine.contextActiveFileHeader')}\n${t('engine.contextActiveFileName').replace('{name}', activeTab.name)}`
      if (truncated) {
        parts.push(`${fileHeader}\n\`\`\`\n${text}\n${t('engine.contextActiveFileTruncated')}\n\`\`\``)
      } else {
        parts.push(`${fileHeader}\n\`\`\`\n${text}\n\`\`\``)
      }
    }
  }

  // 当前工作流状态
  const workflowState = useWorkflowStore.getState()
  if (workflowState.hasActiveRun()) {
    const run = workflowState.currentRun
    if (run) {
      parts.push(`${t('engine.contextWorkflowHeader')}\n${t('engine.contextWorkflowRunning').replace('{title}', run.title).replace('{progress}', `${run.currentStepIndex + 1}/${run.steps.length}`)}`)
    }
  }

  if (parts.length === 0) return null

  const full = parts.join('\n\n')
  if (estimateTokens(full) > 600) {
    return truncateToTokenBudget(full, 600)
  }

  return full
}

// ===== Token 截断辅助 =====

/** Token 感知截断的结果 */
interface TruncationResult {
  text: string
  truncated: boolean
  tokensUsed: number
}

/**
 * 在预算内截断文本，返回截断结果。
 * 统一所有上下文构建中的截断逻辑。
 */
function applyTokenTruncation(text: string, maxTokens: number): TruncationResult {
  const tokens = estimateTokens(text)
  if (tokens <= maxTokens) {
    return { text, truncated: false, tokensUsed: tokens }
  }
  const truncated = truncateToTokenBudget(text, maxTokens)
  return {
    text: truncated,
    truncated: truncated.length < text.length,
    tokensUsed: estimateTokens(truncated),
  }
}
