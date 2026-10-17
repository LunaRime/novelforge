/**
 * DeepSeek DSML（DeepSeek Markup Language）原生工具调用 repair（2026-10-17）
 *
 * 背景（真实事故，勿删）：DeepSeek V4 系列在 OpenAI 兼容端点上，可能把原生工具调用以
 * DSML 文本混进 assistant content（finish_reason=stop、tool_calls=null）——上游 issue
 * deepseek-ai/DeepSeek-V3#1678。旧引擎只认 `<tool_call>{...}</tool_call>` XML，导致
 * ①DSML 原文上屏 ②工具未执行 ③ReAct 循环把泄漏文本当最终回复提前收尾。
 *
 * 兼容形态（全角竖线 U+FF5C；不同版本包裹名与竖线数不同）：
 *   - V4.1：`<｜｜DSML｜｜ calls>` … `</｜｜DSML｜｜ calls>`（`calls` 前可能带空格）
 *   - V4  ：`<｜｜DSML｜｜tool_calls>` / `<｜｜DSML｜｜ invoke name="x">`
 *   - V3/R1：`<｜DSML｜function_calls>`
 *   - 参数：`<…DSML… parameter name="file_path" string="true">值</…DSML… parameter>`
 *     `string="false"` 时值按 JSON literal 解析（数字/布尔/对象），失败回退原字符串；
 *     缺 `string` 属性按字符串处理；参数值可含换行与 `>`。
 *   - 外层 wrapper 可能缺失（只剩 invoke 块）；一条回复里可有多个 wrapper / 多个 invoke。
 *
 * 本模块是**纯函数**：不依赖 React / store / IPC / agent-engine，供引擎全文解析、
 * 流式过滤（agent-engine）、归档恢复（conversation-recovery）、子 agent 转录
 * （subagent/runner）与 store 落盘兜底（agent-store）共用。
 *
 * 两条硬不变量：
 * 1. 不含 DSML token 的文本**逐字原样返回**（零回归，见 `containsDsmlMarkup`）；
 * 2. 只删标记、不 trim 全文——正文空白/换行保持原样。
 */

import { t } from '../../shared/locale'

export interface DsmlToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface DsmlParseError {
  /** 原始 DSML 片段（截断到 300 字符） */
  rawContent: string
  /** 错误原因（i18n） */
  reason: string
  /** 修复建议（i18n） */
  suggestion: string
}

// ===== DSML token 与标签语法 =====

/** 全角竖线（U+FF5C）——DSML 标记的分隔符，注意不是 ASCII `|` */
const FULLWIDTH_BAR = '｜'

/** 1~2 个全角竖线：V3/R1 单竖线，V4/V4.1 双竖线（左右两侧独立匹配） */
const BAR_PATTERN = `(?:${FULLWIDTH_BAR}){1,2}`

/** DSML token 起点：`<` 或 `</` + 1~2 竖线 + DSML + 1~2 竖线 */
const DSML_TOKEN_SOURCE = `</?${BAR_PATTERN}DSML${BAR_PATTERN}`

/** DSML token 最长字符数：`<` + `/` + 2 竖线 + `DSML` + 2 竖线 */
const MAX_DSML_TOKEN_LENGTH = 10

/** 非全局 token 正则（exec/test 不使用 lastIndex，可安全复用） */
const DSML_TOKEN_RE = new RegExp(DSML_TOKEN_SOURCE)

/**
 * 单个完整标签（含 token）：可选闭合斜线 + token + 可选标签名 + 属性串 + `>`。
 * 属性串/标签内不含尖括号——参数值不在标签内部（在开闭标签之间），可含 `>`。
 */
const TAG_AT_RE = new RegExp(
  `^<(/?)${BAR_PATTERN}DSML${BAR_PATTERN}\\s*([A-Za-z_][A-Za-z0-9_-]*)?([^<>]*)>`,
)

/** 外层包裹标签名（不同版本）：`calls` / `tool_calls` / `function_calls` */
const WRAPPER_NAMES: ReadonlySet<string> = new Set(['calls', 'tool_calls', 'function_calls'])

/** 会开启「需要整块吞掉」的标签：wrapper + invoke + parameter */
const BLOCK_OPEN_NAMES: ReadonlySet<string> = new Set([...WRAPPER_NAMES, 'invoke', 'parameter'])

// ===== 基础工具 =====

/** 解析开标签内的属性（name="x" / string="true"，单双引号均兼容；属性名小写归一） */
function parseTagAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? ''
  }
  return attrs
}

/**
 * `string="false"` 的参数值按 JSON literal 解析（数字/布尔/对象/数组），
 * 解析失败回退原字符串；`string="true"`、缺省或其它值一律按字符串处理。
 */
function coerceParamValue(raw: string, stringFlag: string | undefined): unknown {
  if (stringFlag !== 'false') return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/**
 * 是否含 DSML 标记——只按 DSML token 判定（`<` + 1~2 个全角竖线 + `DSML` + 1~2 个全角竖线，
 * 含闭合形态 `</…`）。普通文本里出现的 `<`、`|`（ASCII 竖线）不算。
 */
export function containsDsmlMarkup(text: string): boolean {
  return DSML_TOKEN_RE.test(text)
}

/** 用 t() 组装「检测到 DSML 但无法还原为可执行调用」的解析错误（rawContent 截断 300 字符） */
export function buildUnparsedDsmlError(rawContent: string): DsmlParseError {
  return {
    rawContent: rawContent.slice(0, 300),
    reason: t('engine.parseReasonDsml'),
    suggestion: t('engine.parseSuggestionDsml'),
  }
}

// ===== 全文扫描（标签事件 + 畸形残片） =====

interface DsmlTagEvent {
  start: number
  end: number
  closing: boolean
  /** 标签名（小写；无名称时为空串） */
  name: string
  attrs: Record<string, string>
}

interface RawRange {
  start: number
  end: number
}

/**
 * 扫描全部 DSML 标签事件；token 起点之后到下一个 `<` 之间若形不成合法标签，
 * 记为畸形残片（未闭合到文末时一直删到文末）。
 */
function scanTags(text: string): { events: DsmlTagEvent[]; malformed: RawRange[] } {
  const events: DsmlTagEvent[] = []
  const malformed: RawRange[] = []
  const tokenRe = new RegExp(DSML_TOKEN_SOURCE, 'g')
  let match: RegExpExecArray | null

  while ((match = tokenRe.exec(text)) !== null) {
    const start = match.index
    const tag = TAG_AT_RE.exec(text.slice(start))
    if (!tag) {
      // 标签没用 `>` 闭合：删到下一个 `<`（或文末）；后续 token 仍可继续解析
      const nextLt = text.indexOf('<', start + match[0].length)
      const end = nextLt >= 0 ? nextLt : text.length
      malformed.push({ start, end })
      if (end >= text.length) break
      tokenRe.lastIndex = end
      continue
    }
    events.push({
      start,
      end: start + tag[0].length,
      closing: tag[1] === '/',
      name: (tag[2] ?? '').toLowerCase(),
      attrs: parseTagAttrs(tag[3] ?? ''),
    })
    tokenRe.lastIndex = start + tag[0].length
  }

  return { events, malformed }
}

/** 合并重叠/相邻的待删除区间（区间可能来自嵌套块与标签自身，重复无妨） */
function mergeRanges(ranges: readonly RawRange[]): RawRange[] {
  const sorted = ranges.filter(r => r.end > r.start).sort((a, b) => a.start - b.start)
  const merged: RawRange[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ start: range.start, end: range.end })
    }
  }
  return merged
}

/** 移除全部 DSML 区间后按原顺序收集正文片段（不 trim、不折叠空白） */
function collectTextParts(text: string, ranges: readonly RawRange[]): string[] {
  const textParts: string[] = []
  let cursor = 0
  for (const range of mergeRanges(ranges)) {
    if (range.start > cursor) textParts.push(text.slice(cursor, range.start))
    cursor = Math.max(cursor, range.end)
  }
  if (cursor < text.length) textParts.push(text.slice(cursor))
  return textParts
}

// ===== 结构化解析（正文片段 + 工具调用 + 解析错误） =====

interface WrapperState {
  start: number
  invokeCount: number
}

interface CallState {
  start: number
  name: string
  args: Record<string, unknown>
  /** invoke 内出现未闭合/缺名的 parameter → 参数不可信，整条调用不执行 */
  hasBrokenParam: boolean
}

interface ParamState {
  start: number
  name: string
  stringFlag: string | undefined
  valueStart: number
  /** 打开时是否位于某个 invoke 内（invoke 外的孤立参数块只删不解析） */
  inCall: boolean
}

/**
 * 单趟状态机：一边收集待删除区间（DSML 块/标签/畸形残片），一边还原可执行工具调用。
 *
 * 结构残缺的判定（产出 parseErrors，不让半截调用执行）：
 * - wrapper 闭合时内部没有任何 invoke；
 * - invoke 闭合时参数未闭合/参数缺 name；
 * - invoke 缺 name 属性；
 * - invoke / wrapper 重叠嵌套（上一个未闭合又来新的）；
 * - 文末仍有未闭合的 wrapper / invoke / parameter（只报最外层一条）。
 * 孤立闭合标签（例如只剩 `</… invoke>`）只删标记、不报错——损坏/截断流里太常见。
 */
function analyzeDsml(text: string): {
  textParts: string[]
  toolCalls: DsmlToolCall[]
  parseErrors: DsmlParseError[]
} {
  const { events, malformed } = scanTags(text)
  const ranges: RawRange[] = [...malformed]
  const toolCalls: DsmlToolCall[] = []
  const parseErrors: DsmlParseError[] = []

  const addRange = (start: number, end: number): void => {
    if (end > start) ranges.push({ start, end })
  }
  const addError = (start: number, end: number): void => {
    parseErrors.push(buildUnparsedDsmlError(text.slice(start, end)))
  }

  let wrapper: WrapperState | null = null
  let call: CallState | null = null
  let param: ParamState | null = null

  for (const ev of events) {
    // 标签本身永远从正文里摘掉（即使结构残缺）
    addRange(ev.start, ev.end)

    if (!ev.closing) {
      // ---- 开标签 ----
      if (ev.name === 'parameter') {
        if (param) {
          if (call) call.hasBrokenParam = true
          addRange(param.start, ev.start)
          param = null
        }
        param = {
          start: ev.start,
          name: ev.attrs.name ?? '',
          stringFlag: ev.attrs.string,
          valueStart: ev.end,
          inCall: call !== null,
        }
      } else if (ev.name === 'invoke') {
        if (param) {
          if (call) call.hasBrokenParam = true
          addRange(param.start, ev.start)
          param = null
        }
        if (call) {
          addError(call.start, ev.start)
          addRange(call.start, ev.start)
          call = null
        }
        if (wrapper) wrapper.invokeCount++
        call = { start: ev.start, name: ev.attrs.name ?? '', args: {}, hasBrokenParam: false }
      } else if (WRAPPER_NAMES.has(ev.name)) {
        if (param) {
          if (call) call.hasBrokenParam = true
          addRange(param.start, ev.start)
          param = null
        }
        if (call) {
          addError(call.start, ev.start)
          addRange(call.start, ev.start)
          call = null
        }
        if (wrapper) {
          addError(wrapper.start, ev.start)
          addRange(wrapper.start, ev.start)
          wrapper = null
        }
        wrapper = { start: ev.start, invokeCount: 0 }
      }
      // 其余未知开标签：只删标签，内容留在正文
      continue
    }

    // ---- 闭标签 ----
    if (ev.name === 'parameter') {
      if (!param) continue // 孤立闭合标签：只删标记
      if (param.inCall && call) {
        if (param.name) {
          call.args[param.name] = coerceParamValue(text.slice(param.valueStart, ev.start), param.stringFlag)
        } else {
          call.hasBrokenParam = true // 缺 name 的参数无法落到 arguments
        }
      }
      addRange(param.start, ev.end)
      param = null
      continue
    }

    if (ev.name === 'invoke') {
      if (param) {
        if (call) call.hasBrokenParam = true
        addRange(param.start, ev.start)
        param = null
      }
      if (!call) continue // 孤立闭合标签：只删标记
      if (call.hasBrokenParam) {
        addError(call.start, ev.end) // 参数结构残缺 → 不执行半截调用
      } else if (!call.name) {
        addError(call.start, ev.end)
      } else {
        toolCalls.push({ name: call.name, arguments: call.args })
      }
      addRange(call.start, ev.end)
      call = null
      continue
    }

    if (WRAPPER_NAMES.has(ev.name)) {
      if (param) {
        if (call) call.hasBrokenParam = true
        addRange(param.start, ev.start)
        param = null
      }
      if (call) {
        addError(call.start, ev.start)
        addRange(call.start, ev.start)
        call = null
      }
      if (!wrapper) continue // 孤立闭合标签：只删标记
      if (wrapper.invokeCount === 0) addError(wrapper.start, ev.end)
      addRange(wrapper.start, ev.end)
      wrapper = null
    }
    // 其余未知闭标签：只删标记
  }

  // ---- 文末仍有未闭合结构：删到文末，只报最外层一条错误 ----
  if (wrapper) {
    addError(wrapper.start, text.length)
    addRange(wrapper.start, text.length)
  } else if (call) {
    addError(call.start, text.length)
    addRange(call.start, text.length)
  } else if (param) {
    addError(param.start, text.length)
    addRange(param.start, text.length)
  }

  return { textParts: collectTextParts(text, ranges), toolCalls, parseErrors }
}

/**
 * 从 LLM 输出中解析 DSML 工具调用。
 *
 * 返回：移除 DSML 块（含孤立标签/未闭合块）后按原顺序的正文片段、可执行工具调用、
 * 结构残缺的诊断详情。不含 DSML 时 `textParts=[text]` 且其余为空数组。
 *
 * 注意：正文片段**保留原始空白**（不 trim），供调用方按需拼接/再解析；
 * 工具调用按出现顺序返回。
 */
export function parseDsmlToolCalls(text: string): {
  textParts: string[]
  toolCalls: DsmlToolCall[]
  parseErrors: DsmlParseError[]
} {
  if (!containsDsmlMarkup(text)) {
    return { textParts: [text], toolCalls: [], parseErrors: [] }
  }
  return analyzeDsml(text)
}

/**
 * 删除文本中的 DSML 标记：完整 wrapper 块整块移除；孤立 invoke/parameter 开闭标签
 * 及其成对块移除；未闭合到文末的 DSML 块删到文末。
 *
 * 无 DSML 时**逐字原样返回**（不 trim、不折叠空白）；有 DSML 时也尽量保留正文空白。
 */
export function stripDsmlMarkup(text: string): string {
  if (!containsDsmlMarkup(text)) return text
  return analyzeDsml(text).textParts.join('')
}

/**
 * 只删 DSML **token 标记本身**（`<｜DSML｜` / `<｜｜DSML｜｜`，含闭合形态），不删块内容。
 *
 * 供 observation 注入净化使用（与既有 `sanitizeObservation` 剥 `<tool_call` 同口径）：
 * 工具结果可能来自不可信文件，模型逐字回吐时不能被 `parseToolCalls` 当真实调用执行；
 * 但**不能**整块 `stripDsmlMarkup`——那会连带删除 read_file 读到的用户正文数据。
 *
 * 无 DSML token 时逐字原样返回。
 */
export function stripDsmlTokens(text: string): string {
  if (!containsDsmlMarkup(text)) return text
  const tokenRe = new RegExp(DSML_TOKEN_SOURCE, 'g')
  // 单趟 replace 可能在删除接缝处「删出新 token」（如 `<｜<｜DSML｜DSML｜` → `<｜DSML｜`，
  // 二次核查反例 A3）。循环到不动点：每轮至少删一个 token、长度严格递减 → 必定终止。
  let out = text
  while (containsDsmlMarkup(out)) {
    const next = out.replace(tokenRe, '')
    if (next === out) break // 理论不可达的防御：contains 为 true 时 replace 必减少字符
    out = next
  }
  return out
}

// ===== 流式过滤器 =====

/** 在文本中定位第一个 DSML token 起点（非全局正则，不受 lastIndex 影响） */
function findTokenStart(text: string): { start: number; length: number } | null {
  const match = DSML_TOKEN_RE.exec(text)
  return match ? { start: match.index, length: match[0].length } : null
}

/**
 * 判断 candidate 是否为「DSML 开 token 的严格前缀」——chunk 边界可能把 token 切开
 * （`<`、`<｜`、`<｜｜DSM`、`</｜DSML` 等），这些半截标记不能上屏，必须先扣在缓冲里。
 */
function isDsmlTokenPrefix(candidate: string): boolean {
  if (!candidate.startsWith('<')) return false
  let i = 1
  if (i < candidate.length && candidate[i] === '/') i++

  let leftBars = 0
  while (i < candidate.length && candidate[i] === FULLWIDTH_BAR && leftBars < 2) {
    i++
    leftBars++
  }
  if (i >= candidate.length) return true // `<`、`</`、`<｜`、`<｜｜` 都可能继续补全
  if (leftBars === 0) return false // `<D…` 不可能再变成 token（左侧竖线不能回填）

  const keyword = 'DSML'
  let matched = 0
  while (matched < keyword.length && i < candidate.length && candidate[i] === keyword[matched]) {
    i++
    matched++
  }
  if (matched < keyword.length) return i >= candidate.length // 只有刚好截断在末尾才算前缀

  let rightBars = 0
  while (i < candidate.length && candidate[i] === FULLWIDTH_BAR && rightBars < 2) {
    i++
    rightBars++
  }
  return i >= candidate.length
}

/** 文本末尾最长的「DSML token 前缀」长度（0 = 末尾无半截标记，可全部上屏） */
function partialTokenSuffixLength(text: string): number {
  const max = Math.min(text.length, MAX_DSML_TOKEN_LENGTH)
  for (let length = max; length >= 1; length--) {
    if (isDsmlTokenPrefix(text.slice(text.length - length))) return length
  }
  return 0
}

/**
 * 创建流式安全过滤器（每轮生成新建一个实例）。
 *
 * `push(chunk)`：返回当前**可安全上屏**的文本——完整 DSML 块整块吞掉；块未闭合时从开
 * token 起扣在内部缓冲；token 被 chunk 边界切开（`<｜`、`<｜｜DSML` …）不泄漏半截标记。
 * `flush()`：生成结束时返回残余安全文本，丢弃未闭合 DSML 残片（由全文解析/清洗兜底）。
 *
 * 实现要点：只在「确认不是 DSML token 前缀」时才放行文本，因此普通正文最多延迟一个
 * token 长度显示；一旦进入 DSML 块，按块标签名等待对应闭标签，不在中途放行任何字节。
 */
export function createDsmlStreamFilter(): { push(chunk: string): string; flush(): string } {
  let buffer = ''
  /** 当前正在吞掉的 DSML 块标签名（null = 普通正文态） */
  let blockTag: string | null = null

  function tryConsumeCloseTag(name: string): boolean {
    const closeRe = new RegExp(`</${BAR_PATTERN}DSML${BAR_PATTERN}\\s*${name}\\s*>`)
    const match = closeRe.exec(buffer)
    if (!match) return false
    buffer = buffer.slice(match.index + match[0].length)
    blockTag = null
    return true
  }

  function drain(): string {
    let out = ''
    for (;;) {
      if (blockTag) {
        // 块内：整块吞掉，闭标签未到就继续扣缓冲（跨 chunk 安全）
        if (!tryConsumeCloseTag(blockTag)) return out
        continue
      }

      const token = findTokenStart(buffer)
      if (!token) {
        // 没有完整 token 起点：只扣住末尾可能是半截 token 的后缀
        const keep = partialTokenSuffixLength(buffer)
        out += buffer.slice(0, buffer.length - keep)
        buffer = buffer.slice(buffer.length - keep)
        return out
      }

      out += buffer.slice(0, token.start)

      const tag = TAG_AT_RE.exec(buffer.slice(token.start))
      if (!tag) {
        // 标签在下一个 `<` 之前没闭合：丢弃畸形 token 段，等后续 chunk（未闭合则 flush 丢弃）
        const nextLt = buffer.indexOf('<', token.start + token.length)
        if (nextLt < 0) {
          buffer = buffer.slice(token.start)
          return out
        }
        buffer = buffer.slice(nextLt)
        continue
      }

      const closing = tag[1] === '/'
      const name = (tag[2] ?? '').toLowerCase()
      buffer = buffer.slice(token.start + tag[0].length)

      if (!closing && BLOCK_OPEN_NAMES.has(name)) {
        blockTag = name
        continue
      }
      // 闭合标签 / 未知标签：吞掉标签本身继续扫描
    }
  }

  return {
    push(chunk: string): string {
      if (!chunk) return ''
      buffer += chunk
      return drain()
    },
    flush(): string {
      if (blockTag) {
        // 未闭合的 DSML 块：残片丢弃（全文 parse/strip 兜底）
        buffer = ''
        blockTag = null
        return ''
      }
      const token = findTokenStart(buffer)
      if (token && token.start === 0) {
        // 只到一半的 DSML 开标签：整个残片丢弃
        buffer = ''
        return ''
      }
      const safe = token ? buffer.slice(0, token.start) : buffer
      buffer = ''
      const keep = partialTokenSuffixLength(safe)
      if (keep === 0) return safe
      // 半截标记里已出现全角竖线才肯定是 DSML 残片；只有 `<` / `</` 时可能是正文，
      // 放行避免「无 DSML 正文丢字」（最终的正文仍以全文解析为准）。
      const tail = safe.slice(safe.length - keep)
      return tail.includes(FULLWIDTH_BAR) ? safe.slice(0, safe.length - keep) : safe
    },
  }
}
